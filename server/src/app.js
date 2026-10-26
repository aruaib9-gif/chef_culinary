import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { config } from './config.js'
import { health } from './routes/health.js'
import { programmes } from './routes/programmes.js'
import { leads } from './routes/leads.js'
import { publicRoutes } from './routes/public.js'
import { auth } from './routes/auth.js'
import { applications } from './routes/applications.js'
import { student } from './routes/student.js'
import { payments } from './routes/payments.js'
import { admin } from './routes/admin/index.js'
import { authenticate } from './middleware/auth.js'
import { notFound, errorHandler } from './middleware/errors.js'

export const app = express()

app.set('trust proxy', 1) // behind Render's load balancer
app.disable('x-powered-by')
app.use(helmet())
// In development any localhost port is allowed, since Vite picks a new port when one is busy.
const devOrigin = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
app.use(
  cors({
    origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin) || (!config.isProd && devOrigin.test(origin))),
    credentials: false, // bearer tokens, no cookies
    exposedHeaders: ['Content-Disposition'],
    maxAge: 600,
  }),
)
// Keep the raw body so the Paystack webhook signature can be checked.
app.use(express.json({ limit: '1mb', verify: (req, res, buf) => { req.rawBody = buf } }))
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})
app.use(authenticate)

app.use('/api/health', health)
app.use('/api/programmes', programmes)
app.use('/api/leads', leads)
app.use('/api/public', publicRoutes)
app.use('/api/auth', auth)
app.use('/api/applications', applications)
app.use('/api/student', student)
app.use('/api/payments', payments)
app.use('/api/admin', admin)

app.use(notFound)
app.use(errorHandler)
