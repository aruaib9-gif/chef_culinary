import { Student, Cohort, Lead, Application, Result, Payment, Invoice, Attendance, StudentRequest, Programme } from '../../db/models.js'
import { byIds, pick } from '../../lib/lookup.js'
import { Router } from '../../http.js'

export const dashboard = new Router()

const sum = async (Model, match, field = '$amount_kobo') => (await Model.aggregate([{ $match: match }, { $group: { _id: null, t: { $sum: field } } }]))[0]?.t ?? 0

// Home dashboard KPIs (spec §9.6).
dashboard.get('/', async (req, res) => {
  const isSuper = req.user.role === 'super_admin'
  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const weekAgo = new Date(Date.now() - 7 * 86_400_000)

  const [activeStudents, totalStudents, activeCohorts, newLeads, leadsThisWeek, appsPending, draftResults] = await Promise.all([
    Student.countDocuments({ status: 'active' }),
    Student.countDocuments(),
    Cohort.countDocuments({ status: 'active' }),
    Lead.countDocuments({ status: 'new' }),
    Lead.countDocuments({ created_at: { $gt: weekAgo } }),
    Application.countDocuments({ status: { $in: ['received', 'under_review'] } }),
    Result.countDocuments({ status: 'draft' }),
  ])

  let finance = null
  let monthly = []
  if (isSuper) {
    const [incomeMonth, incomeToday, charges, credits, paid] = await Promise.all([
      sum(Payment, { status: 'success', paid_at: { $gte: monthStart } }),
      sum(Payment, { status: 'success', paid_at: { $gte: dayStart } }),
      sum(Invoice, { voided_at: null, kind: 'charge' }),
      sum(Invoice, { voided_at: null, kind: { $ne: 'charge' } }),
      sum(Payment, { status: 'success' }),
    ])
    finance = { income_this_month: incomeMonth, income_today: incomeToday, outstanding: charges - credits - paid }
    monthly = (await Payment.aggregate([
      { $match: { status: 'success', paid_at: { $gt: new Date(Date.now() - 183 * 86_400_000) } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$paid_at' } }, total: { $sum: '$amount_kobo' } } },
      { $sort: { _id: 1 } },
    ])).map((m) => ({ month: m._id, total: m.total }))
  }

  const [recentLeads, apps, lowAttendance, openRequests] = await Promise.all([
    Lead.find({}, 'name programme_interest source created_at').sort({ created_at: -1 }).limit(5).lean(),
    Application.find({ status: { $ne: 'draft' } }).sort({ submitted_at: -1 }).limit(5).lean(),
    lowAttendanceStudents(),
    StudentRequest.countDocuments({ status: { $in: ['open', 'in_progress'] } }),
  ])
  const programmes = await byIds(Programme, apps.map((a) => a.programme_id), 'name')
  const recentApps = apps.map((a) => ({
    id: a._id, reference: a.reference, status: a.status, submitted_at: a.submitted_at,
    full_name: a.data?.personal?.fullName ?? null, programme_name: pick(programmes, a.programme_id, 'name'),
  }))

  res.json({
    counts: {
      active_students: activeStudents, total_students: totalStudents, active_cohorts: activeCohorts, new_leads: newLeads,
      leads_this_week: leadsThisWeek, applications_pending: appsPending, draft_results: draftResults,
    },
    finance, monthly, recentLeads, recentApps, lowAttendance, openRequests,
  })
})

// Active students in active cohorts with at least 3 marked sessions and under 75% attendance.
async function lowAttendanceStudents() {
  const activeCohorts = await Cohort.find({ status: 'active' }, 'name').lean()
  if (!activeCohorts.length) return []
  const rows = await Attendance.aggregate([
    { $match: { cohort_id: { $in: activeCohorts.map((c) => c._id) } } },
    {
      $group: {
        _id: { student: '$student_id', cohort: '$cohort_id' },
        total: { $sum: 1 },
        attended: { $sum: { $cond: [{ $in: ['$status', ['present', 'late']] }, 1, 0] } },
      },
    },
    { $match: { total: { $gte: 3 } } },
    { $project: { total: 1, rate: { $round: [{ $multiply: [{ $divide: ['$attended', '$total'] }, 100] }, 0] } } },
    { $match: { rate: { $lt: 75 } } },
    { $sort: { rate: 1 } },
    { $limit: 8 },
  ])
  const students = await byIds(Student, rows.map((r) => r._id.student), 'first_name last_name student_number status')
  const cohortNames = new Map(activeCohorts.map((c) => [String(c._id), c.name]))
  return rows
    .filter((r) => students.get(String(r._id.student))?.status === 'active')
    .map((r) => {
      const s = students.get(String(r._id.student))
      return { id: String(r._id.student), first_name: s.first_name, last_name: s.last_name, student_number: s.student_number, cohort_name: cohortNames.get(String(r._id.cohort)), rate: r.rate }
    })
}
