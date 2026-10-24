import { app } from './app.js'
import { config } from './config.js'
import { pool } from './db/pool.js'

const server = app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`)
})

process.on('unhandledRejection', (err) => console.error('unhandled rejection', err))

// Render sends SIGTERM on deploys: finish in-flight requests, then close the pool.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(async () => {
      await pool.end().catch(() => {})
      process.exit(0)
    })
    setTimeout(() => process.exit(1), 10_000).unref()
  })
}
