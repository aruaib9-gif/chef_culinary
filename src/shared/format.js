const naira = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 0,
})

export function formatFee(amount) {
  return amount == null ? 'Fee on request' : naira.format(amount)
}
