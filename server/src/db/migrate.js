// Minimal forward-only migration runner: applies db/migrations/*.sql in name order, once each.
import { readdir, readFile } from 'node:fs/promises'
import { pool } from './pool.js'

const dir = new URL('./migrations/', import.meta.url)

await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`)

const { rows } = await pool.query('SELECT name FROM schema_migrations')
const applied = new Set(rows.map((r) => r.name))
const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()

for (const file of files) {
  if (applied.has(file)) continue
  const sql = await readFile(new URL(file, dir), 'utf8')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(sql)
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
    await client.query('COMMIT')
    console.log(`applied ${file}`)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

await pool.end()
