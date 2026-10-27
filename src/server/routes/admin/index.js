import { Router } from '../../http.js'
import { requireAdmin } from '../../middleware/auth.js'
import { dashboard } from './dashboard.js'
import { leads } from './leads.js'
import { applications } from './applications.js'
import { students } from './students.js'
import { academics } from './academics.js'
import { results } from './results.js'
import { attendance } from './attendance.js'
import { learning } from './learning.js'
import { finance } from './finance.js'
import { certificates } from './certificates.js'
import { services } from './services.js'
import { reports } from './reports.js'
import { system } from './system.js'
import { gallery } from './gallery.js'

// Back office (spec §9). Everything requires a staff or super-admin session;
// finance, publishing, users and settings are further restricted to super admins inside each module.
export const admin = new Router()
admin.use(requireAdmin)

admin.use('/dashboard', dashboard)
admin.use('/leads', leads)
admin.use('/applications', applications)
admin.use('/students', students)
admin.use('/', academics) // /programmes, /courses, /cohorts, /grading-schemes, /timetable
admin.use('/results', results)
admin.use('/attendance', attendance)
admin.use('/', learning) // /materials, /assignments, /announcements, /messaging
admin.use('/finance', finance)
admin.use('/certificates', certificates)
admin.use('/', services) // /requests, /feedback
admin.use('/reports', reports)
admin.use('/gallery', gallery)
admin.use('/', system) // /users, /settings, /audit-log, /message-log
