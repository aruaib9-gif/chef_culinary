const naira = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 0,
})

export function formatFee(amount) {
  return amount == null ? 'Fee on request' : naira.format(amount)
}

// Fee rules: 7.5% VAT on tuition, plus a one-off registration fee (amounts in naira).
export const VAT_RATE = 0.075
export const REGISTRATION_FEE = 15_000

export function feeBreakdown(tuition) {
  if (tuition == null) return null
  const vat = Math.round(tuition * VAT_RATE)
  return { tuition, vat, registration: REGISTRATION_FEE, total: tuition + vat + REGISTRATION_FEE }
}
