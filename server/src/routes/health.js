import { Router } from 'express'
import { query } from '../db/pool.js'

export const health = Router()

health.get('/', async (req, res) => {
  await query('SELECT 1')
  res.json({ status: 'ok' })
})
