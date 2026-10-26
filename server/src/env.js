// Loads server/.env into process.env when present. Values already set in the environment win
// (Render, systemd and cPanel's Node.js App screen can all set variables directly).
// Works on Node 20.12+, so the app doesn't depend on Node 22's --env-file-if-exists flag.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const file = fileURLToPath(new URL('../.env', import.meta.url))
if (existsSync(file)) process.loadEnvFile(file)
