import { query } from '../db/pool.js'

// Records an admin action (spec §9.6, §12). Never throws — auditing must not break the request.
export async function audit(req, action, entity, entityId, details, db = { query }) {
  try {
    await db.query(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, details, ip) VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.user?.id ?? null, action, entity, entityId == null ? null : String(entityId), details ?? null, req.ip],
    )
  } catch (err) {
    console.error('audit failed', err)
  }
}
