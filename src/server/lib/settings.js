import { Setting, GradingScheme } from '../db/models.js'
import { connectDb } from '../db/mongo.js'
import { site } from '../../shared/site.js'
import { defaultGradingScheme } from '../../shared/gradingScheme.js'

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
  await connectDb()
  const rows = await Setting.find().lean()
  const stored = Object.fromEntries(rows.map((r) => [r._id, r.value]))
  cache = Object.fromEntries(
    Object.entries(settingDefaults).map(([k, def]) => [k, { ...def, ...(stored[k] ?? {}) }]),
  )
  cachedAt = Date.now()
  return cache
}

export async function saveSetting(key, value, userId) {
  await Setting.updateOne({ _id: key }, { $set: { value, updated_by: userId } }, { upsert: true })
  cache = null
}

/** The course's own scheme if it has one, else the default scheme, else the built-in one. */
export async function getGradingScheme(id) {
  const row = (id && (await GradingScheme.findById(id).lean())) || (await GradingScheme.findOne({ is_default: true }).lean())
  return row ? { id: row._id, name: row.name, definition: row.definition } : { id: null, name: 'Default', definition: defaultGradingScheme }
}
