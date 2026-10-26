import { parse as parseCsv } from 'csv-parse/sync'

// Parses an uploaded CSV buffer into objects keyed by normalised header (lower_snake_case).
export function readCsv(buffer) {
  return parseCsv(buffer, {
    bom: true,
    columns: (headers) => headers.map((h) => String(h).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')),
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  })
}

const cell = (v) => {
  if (v == null) return ''
  const s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v)
  // Quote, and neutralise spreadsheet formula injection.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s
  return /[",\n\r]/.test(safe) || safe !== s ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function toCsv(rows, columns) {
  const cols = columns ?? Object.keys(rows[0] ?? {}).map((key) => ({ key, label: key }))
  const lines = [cols.map((c) => cell(c.label)).join(',')]
  for (const row of rows) lines.push(cols.map((c) => cell(typeof c.value === 'function' ? c.value(row) : row[c.key])).join(','))
  return '﻿' + lines.join('\r\n')
}

export function sendCsv(res, filename, rows, columns) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.send(toCsv(rows, columns))
}
