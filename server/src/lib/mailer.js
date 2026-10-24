import nodemailer from 'nodemailer'
import { config } from '../config.js'
import { query } from '../db/pool.js'

const transport = config.smtp.host
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    })
  : null

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// Branded HTML wrapper. `paragraphs` are plain strings (escaped); `action` is an optional button.
export function layout({ heading, paragraphs = [], action }) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px;line-height:1.55">${escape(p)}</p>`).join('')
  const button = action
    ? `<p style="margin:22px 0"><a href="${escape(action.url)}" style="background:#c2541b;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600">${escape(action.label)}</a></p>`
    : ''
  return `<div style="background:#f6efe3;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#2e221b">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden">
    <div style="background:#c2541b;color:#fff;padding:18px 24px;font-weight:700;letter-spacing:.04em">THE CHEFS CULINARY ACADEMY</div>
    <div style="padding:24px"><h2 style="margin:0 0 16px;font-size:20px">${escape(heading)}</h2>${body}${button}</div>
    <div style="padding:14px 24px;font-size:12px;color:#6b5d54;border-top:1px solid #e7dac9">Chimatem Complex, Psychiatric Road, Rumigbo/Rumuola, Port Harcourt · 08117248206</div>
  </div></div>`
}

/**
 * Sends an email. Without SMTP configured (local dev), the message is printed to the console instead.
 * Never throws: callers treat email as best-effort and the outcome is recorded in message_log.
 */
export async function sendMail({ to, subject, html, text, attachments, sentBy = null }) {
  const recipients = [].concat(to).filter(Boolean)
  if (!recipients.length) return { ok: false }
  let status = 'sent'
  let error = null
  try {
    if (transport) {
      await transport.sendMail({ from: config.smtp.from, to: recipients.join(', '), subject, html, text, attachments })
    } else {
      status = 'logged'
      console.log(`\n✉️  [email not sent — SMTP not configured]\nTo: ${recipients.join(', ')}\nSubject: ${subject}\n${text ?? html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}\n`)
    }
  } catch (err) {
    status = 'failed'
    error = err.message
    console.error('email failed', err)
  }
  for (const r of recipients) {
    query('INSERT INTO message_log (channel, recipient, subject, status, error, sent_by) VALUES ($1,$2,$3,$4,$5,$6)', [
      'email', r, subject, status, error, sentBy,
    ]).catch(() => {})
  }
  return { ok: status !== 'failed', status }
}

export const emailConfigured = () => Boolean(transport)
