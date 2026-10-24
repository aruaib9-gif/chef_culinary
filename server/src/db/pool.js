import pg from 'pg'
import { config } from '../config.js'

// BIGINT (int8) and COUNT come back as strings by default; our ids and kobo amounts fit in a JS number.
pg.types.setTypeParser(20, (v) => Number(v))
pg.types.setTypeParser(1700, (v) => Number(v)) // NUMERIC
pg.types.setTypeParser(1082, (v) => v) // DATE stays 'YYYY-MM-DD' (no timezone shifting)

// Render Postgres requires SSL for external connections; the internal URL works without it.
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
  max: Number(process.env.DATABASE_POOL_MAX) || 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
})

pool.on('error', (err) => console.error('idle database client error', err))

export const query = (text, params) => pool.query(text, params)

export async function one(text, params) {
  const { rows } = await pool.query(text, params)
  return rows[0] ?? null
}

export async function many(text, params) {
  const { rows } = await pool.query(text, params)
  return rows
}

// Runs fn(client) inside a transaction; client has the same query/one/many helpers.
export async function tx(fn) {
  const client = await pool.connect()
  const db = {
    query: (t, p) => client.query(t, p),
    one: async (t, p) => (await client.query(t, p)).rows[0] ?? null,
    many: async (t, p) => (await client.query(t, p)).rows,
  }
  try {
    await client.query('BEGIN')
    const result = await fn(db)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// The non-transactional equivalent, so helpers can accept either.
export const db = { query, one, many }
