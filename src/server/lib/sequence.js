import { Counter } from '../db/models.js'

/** Atomically increments and returns a named counter (safe across concurrent requests and instances). */
export async function nextSeq(name, session) {
  const doc = await Counter.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after', session }).lean()
  return doc.seq
}

const year = () => new Date().getFullYear()
const pad = (n, w) => String(n).padStart(w, '0')

export const nextStudentNumber = async (session) => `CCA/${year()}/${pad(await nextSeq('student_number', session), 4)}`
export const nextReceiptNumber = async (session) => `RCT-${year()}-${pad(await nextSeq('receipt', session), 6)}`
export const nextCertificateSerial = async (session) => `CCA-${year()}-${pad(await nextSeq('certificate', session), 5)}`
export const nextSponsorInvoiceNumber = async (session) => `INV-${year()}-${pad(await nextSeq('sponsor_invoice', session), 4)}`
