import { AuditLog } from '../db/models.js'

// Records an admin action (spec §9.6, §12). Never throws — auditing must not break the request.
// Pass `session` to write inside a transaction.
export async function audit(req, action, entity, entityId, details, session) {
  try {
    await AuditLog.create(
      [{ user_id: req.user?.id ?? null, action, entity, entity_id: entityId == null ? null : String(entityId), details: details ?? null, ip: req.ip }],
      session ? { session } : undefined,
    )
  } catch (err) {
    console.error('audit failed', err)
  }
}
