// Management overview report (spec §9.6). Detailed CSV exports live with each module.
import { Programme, Student, Application, Lead, Certificate, Result } from '../../db/models.js'
import { Router } from '../../http.js'

export const reports = new Router()

reports.get('/overview', async (req, res) => {
  const [programmes, byProgramme, funnel, leadSources, statuses, certificates, avg] = await Promise.all([
    Programme.find({}, 'name sort_order').sort({ sort_order: 1, name: 1 }).lean(),
    Student.aggregate([{ $group: { _id: { p: '$programme_id', s: '$status' }, n: { $sum: 1 } } }]),
    Application.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    Lead.aggregate([
      { $group: { _id: '$source', n: { $sum: 1 }, converted: { $sum: { $cond: [{ $in: ['$status', ['applied', 'enrolled']] }, 1, 0] } } } },
      { $sort: { n: -1 } },
    ]),
    Student.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    Certificate.countDocuments({ revoked_at: null }),
    Result.aggregate([{ $match: { status: 'published' } }, { $group: { _id: null, a: { $avg: '$total' } } }]),
  ])
  const enrolment = programmes.map((p) => {
    const rows = byProgramme.filter((r) => String(r._id.p) === String(p._id))
    const count = (st) => rows.filter((r) => !st || r._id.s === st).reduce((s, r) => s + r.n, 0)
    return { programme: p.name, students: count(), active: count('active'), graduated: count('graduated') }
  })
  res.json({
    enrolment,
    funnel: funnel.map((f) => ({ status: f._id, n: f.n })),
    leadSources: leadSources.map((l) => ({ source: l._id, n: l.n, converted: l.converted })),
    statuses: statuses.map((s) => ({ status: s._id, n: s.n })),
    outcomes: { certificates, average_score: avg[0] ? Math.round(avg[0].a * 10) / 10 : null },
  })
})
