import { many, query } from '../db/pool.js'
import { site } from '@cca/shared/site'
import { defaultGradingScheme } from '@cca/shared/grading-scheme'

// Defaults for every admin-editable setting. Stored values override these key by key.
export const settingDefaults = {
  site: {
    name: site.name,
    legalName: site.legalName,
    address: site.address,
    phone: site.phone,
    emails: site.emails,
    whatsappNumber: site.phoneIntl,
    whatsappMessage: site.whatsappMessage,
  },
  social: site.social,
  results: {
    withholdIfOwing: false, // hide published results while a student has an outstanding balance
    showPositions: false, // show class position on result sheets
  },
  attendance: { lowAttendanceThreshold: 75 },
  security: { requireAdminTwoFactor: false },
}

export const publicSettingKeys = ['site', 'social']

let cache = null
let cachedAt = 0

export async function getSettings() {
  if (cache && Date.now() - cachedAt < 30_000) return cache
  const rows = await many('SELECT key, value FROM settings')
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  cache = Object.fromEntries(
    Object.entries(settingDefaults).map(([k, def]) => [k, { ...def, ...(stored[k] ?? {}) }]),
  )
  cachedAt = Date.now()
  return cache
}

export async function saveSetting(key, value, userId) {
  await query(
    `INSERT INTO settings (key, value, updated_by) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [key, value, userId],
  )
  cache = null
}

export async function getGradingScheme(db, id) {
  const row = id
    ? await db.one('SELECT id, name, definition FROM grading_schemes WHERE id = $1', [id])
    : await db.one('SELECT id, name, definition FROM grading_schemes WHERE is_default LIMIT 1')
  return row ?? { id: null, name: 'Default', definition: defaultGradingScheme }
}
