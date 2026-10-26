// Paystack webhook: settles payments even if the student closes the browser before the redirect (spec §10).
import { withTransaction } from '../db/mongo.js'
import { validWebhookSignature, verifyTransaction } from '../lib/paystack.js'
import { settleGatewayPayment, emailReceipt } from '../lib/finance.js'
import { Router, defer } from '../http.js'

export const payments = new Router()

payments.post('/paystack/webhook', async (req, res) => {
  if (!validWebhookSignature(req.rawBody, req.get('x-paystack-signature'))) return res.sendStatus(401)
  const event = req.body
  if (event?.event === 'charge.success' && event.data?.reference) {
    // Re-verify with Paystack rather than trusting the payload alone.
    const data = await verifyTransaction(event.data.reference)
    const result = await withTransaction((session) => settleGatewayPayment(session, event.data.reference, data))
    if (result?.newlySettled) defer(() => emailReceipt(result.payment._id))
  }
  res.sendStatus(200)
})
