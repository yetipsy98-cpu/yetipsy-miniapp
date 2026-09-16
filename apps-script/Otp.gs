/* =============================================================
   YETIPSY MINI APP 1.1 — Otp.gs
   -------------------------------------------------------------
   WhatsApp OTP（README §6.4）

   安全规则：
   - 验证码只存在后端，资料库只存 SHA-256 hash，日志绝不写明文
   - 同一号码 OTP_RESEND_SECONDS 秒内只能发一次
   - 最多尝试 OTP_MAX_ATTEMPTS 次
   - 验证成功后签发一次性 verificationToken（5 分钟内有效，用一次即失效）
   - customerLogin 必须带上这个 proof 才能建立 / 取得 session

   WhatsApp Cloud API 的 token 只能放在 Apps Script 的 Script Properties：
     WHATSAPP_TOKEN            永久存取 token（EAAG...）
     WHATSAPP_PHONE_NUMBER_ID  电话号码 ID（不含 +）
     WHATSAPP_TEMPLATE_NAME    （可选）已核准的模板名称
     WHATSAPP_TEMPLATE_LANG    （可选）预设 en_US
   ============================================================= */

function otpConfigured() {
  var p = PropertiesService.getScriptProperties();
  return !!(p.getProperty('WHATSAPP_TOKEN') && p.getProperty('WHATSAPP_PHONE_NUMBER_ID'));
}

/** 产生 6 位数字验证码 */
function generateOtpCode() {
  var n = '';
  for (var i = 0; i < 6; i++) n += String(Math.floor(Math.random() * 10));
  return n;
}

function otpCodeHash(phone, code) {
  return sha256(String(phone) + '|' + String(code));
}

/* -------------------------------------------------------------
   API
   ------------------------------------------------------------- */

function requestCustomerOtp(data) {
  var res = normalizePhoneE164(data.phone, data.countryCode);
  if (!res.ok) return err('INVALID_PHONE', phoneErrorMessage(res.reason));

  if (!boolSetting('OTP_ENABLED', false)) {
    return ok({ otpEnabled: false, sent: false, message: 'OTP is disabled on the server.' });
  }
  if (!otpConfigured()) return err('OTP_NOT_CONFIGURED');

  var resend = numSetting('OTP_RESEND_SECONDS', 60);
  var key = 'otp:' + res.phone;
  if (rateLimitLocked(key)) {
    return err('RATE_LIMITED', 'Please wait before requesting another code. / 请稍后再索取验证码。');
  }

  var code = generateOtpCode();
  var ttlMinutes = numSetting('OTP_TTL_MINUTES', 10);

  dbInsert('otpCodes', {
    otpId: dbNextId('OTP', 'otp'),
    phone: res.phone,
    codeHash: otpCodeHash(res.phone, code),
    channel: setting('OTP_CHANNEL', 'WHATSAPP'),
    status: 'PENDING',
    attempts: 0,
    verificationTokenHash: '',
    createdAt: nowISO(),
    expiresAt: new Date(Date.now() + ttlMinutes * 60000).toISOString(),
    verifiedAt: '',
    lastSentAt: nowISO()
  });

  audit('SYSTEM', 'SYSTEM', 'OTP_REQUESTED', 'CUSTOMER', res.phone, '', '');

  var sent = sendWhatsAppOtp(res.phone, code);
  if (!sent.ok) {
    audit('SYSTEM', 'SYSTEM', 'OTP_SEND_FAILED', 'CUSTOMER', res.phone, '', sent.message);
    return fail('OTP_SEND_FAILED', 'Could not send the code. / 验证码发送失败，请通知店员。');
  }

  rateLimitSet(key, { count: 1, until: Date.now() + resend * 1000 }, resend);

  return ok({
    otpEnabled: true,
    sent: true,
    phone: res.phone,
    channel: setting('OTP_CHANNEL', 'WHATSAPP'),
    expiresAt: new Date(Date.now() + ttlMinutes * 60000).toISOString(),
    resendSeconds: resend
  });
}

function verifyCustomerOtp(data) {
  var res = normalizePhoneE164(data.phone, data.countryCode);
  if (!res.ok) return err('INVALID_PHONE', phoneErrorMessage(res.reason));

  var code = String(data.code || '').replace(/[^0-9]/g, '');
  if (code.length !== 6) return err('OTP_INVALID');

  var maxAttempts = numSetting('OTP_MAX_ATTEMPTS', 5);
  var record = null;
  dbRecent('otpCodes').forEach(function (r) {
    if (!record && r.phone === res.phone && r.status === 'PENDING') record = r;
  });

  if (!record) return err('OTP_INVALID');
  if (new Date(record.expiresAt).getTime() < Date.now()) {
    record.status = 'EXPIRED';
    return err('OTP_INVALID');
  }

  record.attempts = (Number(record.attempts) || 0) + 1;

  if (record.codeHash !== otpCodeHash(res.phone, code)) {
    if (record.attempts >= maxAttempts) record.status = 'FAILED';
    audit('SYSTEM', 'SYSTEM', 'OTP_FAILED', 'CUSTOMER', res.phone, '', String(record.attempts));
    return err('OTP_INVALID');
  }

  record.status = 'VERIFIED';
  record.verifiedAt = nowISO();

  /* 一次性 proof：customerLogin 必须带回来，前端无法伪造 */
  var proof = randomToken(16);
  record.verificationTokenHash = sha256(proof);

  audit('SYSTEM', 'SYSTEM', 'OTP_VERIFIED', 'CUSTOMER', res.phone, '', '');

  return ok({
    verified: true,
    phone: res.phone,
    verificationToken: proof,
    expiresAt: new Date(Date.now() + 5 * 60000).toISOString()
  });
}

/**
 * customerLogin 用：确认 proof 有效并让它失效（只能用一次）。
 * @return {boolean}
 */
function consumeVerificationToken(proof, phone) {
  if (!proof) return false;
  var hash = sha256(proof);
  var record = null;
  dbRecent('otpCodes').forEach(function (r) {
    if (!record && r.verificationTokenHash === hash) record = r;
  });
  if (!record) return false;
  if (record.status !== 'VERIFIED') return false;
  if (record.phone !== phone) return false;
  /* proof 只在 verifyCustomerOtp 后 5 分钟内有效 */
  var verifiedAt = new Date(record.verifiedAt).getTime();
  if (!verifiedAt || Date.now() - verifiedAt > 5 * 60000) return false;

  record.verificationTokenHash = '';      // 用掉即失效
  return true;
}

/* -------------------------------------------------------------
   WhatsApp Cloud API
   ------------------------------------------------------------- */

function sendWhatsAppOtp(phone, code) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('WHATSAPP_TOKEN');
  var phoneId = props.getProperty('WHATSAPP_PHONE_NUMBER_ID');
  if (!token || !phoneId) return { ok: false, message: 'WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID not set' };

  var template = props.getProperty('WHATSAPP_TEMPLATE_NAME');
  var lang = props.getProperty('WHATSAPP_TEMPLATE_LANG') || 'en_US';
  var to = String(phone).replace(/^\+/, '');

  var body;
  if (template) {
    body = {
      messaging_product: 'whatsapp',
      to: to,
      type: 'template',
      template: {
        name: template,
        language: { code: lang },
        components: [{ type: 'body', parameters: [{ type: 'text', text: code }] }]
      }
    };
  } else {
    body = {
      messaging_product: 'whatsapp',
      to: to,
      type: 'text',
      text: { body: 'YETIPSY verification code 验证码: ' + code + ' (valid 10 minutes)' }
    };
  }

  try {
    var response = UrlFetchApp.fetch('https://graph.facebook.com/v19.0/' + phoneId + '/messages', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
    var status = response.getResponseCode();
    if (status >= 200 && status < 300) return { ok: true };
    return { ok: false, message: 'WhatsApp API HTTP ' + status };
  } catch (e) {
    return { ok: false, message: e.message || 'WhatsApp API error' };
  }
}
