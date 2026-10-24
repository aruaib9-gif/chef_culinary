import { Router } from 'express'
import { one, many } from '../../db/pool.js'

export const dashboard = Router()

// Home dashboard KPIs (spec §9.6).
dashboard.get('/', async (req, res) => {
  const isSuper = req.user.role === 'super_admin'
  const [counts, finance, recentLeads, recentApps, lowAttendance, openRequests] = await Promise.all([
    one(`SELECT
          (SELECT COUNT(*) FROM students WHERE status = 'active')::int AS active_students,
          (SELECT COUNT(*) FROM students)::int AS total_students,
          (SELECT COUNT(*) FROM cohorts WHERE status = 'active')::int AS active_cohorts,
          (SELECT COUNT(*) FROM leads WHERE status = 'new')::int AS new_leads,
          (SELECT COUNT(*) FROM leads WHERE created_at > now() - interval '7 days')::int AS leads_this_week,
          (SELECT COUNT(*) FROM applications WHERE status IN ('received', 'under_review'))::int AS applications_pending,
          (SELECT COUNT(*) FROM results WHERE status = 'draft')::int AS draft_results`),
    isSuper
      ? one(`SELECT
          COALESCE((SELECT SUM(amount_kobo) FROM payments WHERE status = 'success' AND paid_at >= date_trunc('month', now())), 0) AS income_this_month,
          COALESCE((SELECT SUM(amount_kobo) FROM payments WHERE status = 'success' AND paid_at >= date_trunc('day', now())), 0) AS income_today,
          COALESCE((SELECT SUM(CASE WHEN kind = 'charge' THEN amount_kobo ELSE -amount_kobo END) FROM invoices WHERE voided_at IS NULL), 0)
            - COALESCE((SELECT SUM(amount_kobo) FROM payments WHERE status = 'success'), 0) AS outstanding`)
      : null,
    many(`SELECT id, name, programme_interest, source, created_at FROM leads ORDER BY created_at DESC LIMIT 5`),
    many(`SELECT a.id, a.reference, a.status, a.submitted_at, a.data->'personal'->>'fullName' AS full_name, p.name AS programme_name
            FROM applications a LEFT JOIN programmes p ON p.id = a.programme_id
           WHERE a.status <> 'draft' ORDER BY a.submitted_at DESC LIMIT 5`),
    many(`SELECT s.id, s.first_name, s.last_name, s.student_number, c.name AS cohort_name,
                 ROUND(100.0 * COUNT(*) FILTER (WHERE a.status IN ('present','late')) / COUNT(*))::int AS rate
            FROM attendance a JOIN students s ON s.id = a.student_id JOIN cohorts c ON c.id = a.cohort_id
           WHERE s.status = 'active' AND c.status = 'active'
           GROUP BY s.id, c.name HAVING COUNT(*) >= 3
              AND 100.0 * COUNT(*) FILTER (WHERE a.status IN ('present','late')) / COUNT(*) < 75
           ORDER BY rate LIMIT 8`),
    one(`SELECT COUNT(*)::int AS n FROM student_requests WHERE status IN ('open', 'in_progress')`),
  ])
  const monthly = isSuper
    ? await many(`SELECT to_char(date_trunc('month', paid_at), 'YYYY-MM') AS month, SUM(amount_kobo) AS total
                    FROM payments WHERE status = 'success' AND paid_at > now() - interval '6 months'
                   GROUP BY 1 ORDER BY 1`)
    : []
  res.json({ counts, finance, monthly, recentLeads, recentApps, lowAttendance, openRequests: openRequests.n })
})
