// Health check and scheduled jobs.
import mongoose from 'mongoose'
import { config } from '../config.js'
import { runDailyJobs } from '../jobs/daily.js'
import { Router, HttpError } from '../http.js'

export const systemRoutes = new Router()

systemRoutes.get('/health', async (req, res) => {
  await mongoose.connection.db.admin().ping()
  res.json({ status: 'ok' })
})

// Vercel Cron calls this daily with `Authorization: Bearer $CRON_SECRET`.
systemRoutes.get('/cron/daily', async (req, res) => {
  if (!config.cronSecret || req.get('authorization') !== `Bearer ${config.cronSecret}`) throw new HttpError(401, 'Unauthorized')
  const result = await runDailyJobs()
  console.log(JSON.stringify({ job: 'daily', ...result }))
  res.json(result)
})
