// Management overview report (spec §9.6). Detailed CSV exports live with each module:
// /students/export.csv, /results/export.csv, /attendance/report.csv, /finance/report.csv, /leads/export.csv.
import { Router } from 'express'
import { many, one } from '../../db/pool.js'

export const reports = Router()

reports.get('/overview', async (req, res) => {
  const [enrolment, funnel, leadSources, statuses, outcomes] = await Promise.all([
    many(`SELECT p.name AS programme, COUNT(s.id)::int AS students,
                 COUNT(s.id) FILTER (WHERE s.status = 'active')::int AS active,
                 COUNT(s.id) FILTER (WHERE s.status = 'graduated')::int AS graduated
            FROM programmes p LEFT JOIN students s ON s.programme_id = p.id GROUP BY p.id ORDER BY p.sort_order, p.name`),
    many(`SELECT status, COUNT(*)::int AS n FROM applications GROUP BY status`),
    many(`SELECT source, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE status IN ('applied','enrolled'))::int AS converted FROM leads GROUP BY source ORDER BY n DESC`),
    many(`SELECT status, COUNT(*)::int AS n FROM students GROUP BY status`),
    one(`SELECT (SELECT COUNT(*) FROM certificates WHERE revoked_at IS NULL)::int AS certificates,
                (SELECT ROUND(AVG(total), 1)::float FROM results WHERE status = 'published') AS average_score`),
  ])
  res.json({ enrolment, funnel, leadSources, statuses, outcomes })
})
