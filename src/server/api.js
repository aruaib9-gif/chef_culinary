// The whole API as one router, served by src/app/api/[...path]/route.js.
import { Router, dispatch } from './http.js'
import { connectDb } from './db/mongo.js'
import { authenticate } from './middleware/auth.js'
import { auth } from './routes/auth.js'
import { applications } from './routes/applications.js'
import { student } from './routes/student.js'
import { admin } from './routes/admin/index.js'
import { programmes } from './routes/programmes.js'
import { leads } from './routes/leads.js'
import { publicRoutes } from './routes/public.js'
import { payments } from './routes/payments.js'
import { uploads } from './routes/uploads.js'
import { videos } from './routes/videos.js'
import { systemRoutes } from './routes/system.js'

const api = new Router()
api.use('/', systemRoutes) // /health, /cron/daily
api.use('/auth', auth)
api.use('/applications', applications)
api.use('/student', student)
api.use('/admin', admin)
api.use('/programmes', programmes)
api.use('/leads', leads)
api.use('/public', publicRoutes)
api.use('/payments', payments)
api.use('/uploads', uploads)
api.use('/videos', videos)

export function handleApi(request) {
  return dispatch(api, request, async (req) => {
    await connectDb()
    await authenticate(req)
  })
}
