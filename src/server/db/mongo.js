import mongoose from 'mongoose'
import { config, assertConfig } from '../config.js'

mongoose.set('strictQuery', true)

// One connection per server instance, reused across requests (and across hot reloads in dev).
const cache = (globalThis.__ccaMongo ??= { conn: null, promise: null })

export async function connectDb() {
  if (cache.conn) return cache.conn
  assertConfig()
  cache.promise ??= mongoose
    .connect(config.mongoUri, { maxPoolSize: 10, serverSelectionTimeoutMS: 10_000 })
    .then(async (m) => {
      const { syncIndexes } = await import('./models.js')
      await syncIndexes()
      return m
    })
    .catch((err) => {
      cache.promise = null
      throw err
    })
  cache.conn = await cache.promise
  return cache.conn
}

/**
 * Runs fn(session) in a MongoDB transaction (MongoDB Atlas and replica sets).
 * fn may be retried on transient errors, so keep emails and other side effects outside it.
 */
export async function withTransaction(fn) {
  await connectDb()
  const session = await mongoose.startSession()
  try {
    let result
    await session.withTransaction(async () => {
      result = await fn(session)
    })
    return result
  } finally {
    await session.endSession()
  }
}

export const { ObjectId } = mongoose.Types
export const isObjectId = (v) => typeof v === 'string' && /^[a-f\d]{24}$/i.test(v)
export const oid = (v) => (v == null || v === '' ? null : v instanceof ObjectId ? v : new ObjectId(String(v)))
