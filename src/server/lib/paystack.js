import crypto from 'node:crypto'
import { config } from '../config.js'
import { HttpError } from '../http.js'

const BASE = 'https://api.paystack.co'

export const paystackEnabled = () => Boolean(config.paystackSecretKey)

async function call(path, { method = 'GET', body } = {}) {
  if (!paystackEnabled()) throw new HttpError(503, 'Online payments are not available yet. Please pay at the academy office or by bank transfer.')
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${config.paystackSecretKey}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.status) throw new HttpError(502, data?.message ?? 'Payment gateway error')
  return data.data
}

// Card details never touch our server — the student is redirected to Paystack's hosted checkout (spec §10).
export const initializeTransaction = ({ email, amountKobo, reference, callbackUrl, metadata }) =>
  call('/transaction/initialize', {
    method: 'POST',
    body: {
      email,
      amount: amountKobo,
      currency: 'NGN',
      reference,
      callback_url: callbackUrl,
      metadata,
      channels: ['card', 'bank', 'ussd', 'bank_transfer'],
    },
  })

export const verifyTransaction = (reference) => call(`/transaction/verify/${encodeURIComponent(reference)}`)

export function validWebhookSignature(rawBody, signature) {
  if (!paystackEnabled() || !rawBody || !signature) return false
  const expected = crypto.createHmac('sha512', config.paystackSecretKey).update(rawBody).digest('hex')
  return expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
}
