// Paystack webhook: settles payments even if the student closes the browser before the redirect (spec §10).
import { Router } from 'express'
import { tx, db } from '../db/pool.js'
import { validWebhookSignature, verifyTransaction } from '../lib/paystack.js'
import { settleGatewayPayment, emailReceipt } from '../lib/finance.js'

export const payments = Router()

payments.post('/paystack/webhook', async (req, res) => {
  if (!validWebhookSignature(req.rawBody, req.get('x-paystack-signature'))) return res.sendStatus(401)
  const event = req.body
  if (event?.event === 'charge.success' && event.data?.reference) {
    // Re-verify with Paystack rather than trusting the payload alone.
    const data = await verifyTransaction(event.data.reference)
    const result = await tx((t) => settleGatewayPayment(t, event.data.reference, data))
    if (result?.newlySettled) emailReceipt(db, result.payment.id).catch((e) => console.error(e))
  }
  res.sendStatus(200)
})
