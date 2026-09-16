/* =============================================================
   YETIPSY MINI APP 1.1 — Audit.gs
   所有重要动作都写一条记录（AuditLogs Sheet，最多保留 5000 条）
   ============================================================= */

function audit(userId, userType, action, targetType, targetId, oldValue, newValue) {
  dbInsert('audit', {
    logId:      dbNextId('LOG', 'audit'),
    userId:     userId || '',
    userType:   userType || '',
    action:     action,
    targetType: targetType || '',
    targetId:   targetId || '',
    oldValue:   oldValue === undefined || oldValue === null ? '' : String(oldValue),
    newValue:   newValue === undefined || newValue === null ? '' : String(newValue),
    createdAt:  nowISO()
  });
}
