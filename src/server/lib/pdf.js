// PDF documents with the academy letterhead (spec §13 "consistent printable documents", §14 "Documents").
import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'
import path from 'node:path'
import { config } from '../config.js'
import { formatKobo } from './money.js'
import { getSettings } from './settings.js'

// Read from disk at runtime; next.config.mjs ships this folder with the API functions.
const LOGO = path.join(process.cwd(), 'src/server/assets/logo.jpg')
const BRAND = '#c2541b'
const INK = '#2e221b'
const MUTED = '#6b5d54'
const LINE = '#e7dac9'

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Lagos' }) : '—'

function render(build, options = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, ...options })
    const chunks = []
    doc.on('data', (c) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    Promise.resolve(build(doc)).then(() => doc.end(), reject)
  })
}

async function letterhead(doc, title) {
  const { site } = await getSettings()
  const top = 40
  doc.image(LOGO, 50, top, { width: 62 })
  doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(16).text(site.name.toUpperCase(), 124, top + 6, { characterSpacing: 0.6 })
  doc.fillColor(MUTED).font('Helvetica').fontSize(8.5)
    .text(site.address, 124, top + 28)
    .text(`${site.phone}  ·  ${site.emails.join('  ·  ')}`, 124, top + 40)
  doc.moveTo(50, top + 74).lineTo(545, top + 74).lineWidth(1.5).strokeColor(BRAND).stroke()
  if (title) {
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(14).text(title.toUpperCase(), 50, top + 90, { align: 'center', width: 495, characterSpacing: 1 })
  }
  doc.y = top + (title ? 120 : 92)
  doc.x = 50
  return site
}

function footer(doc, text) {
  const y = doc.page.height - 60
  doc.moveTo(50, y).lineTo(545, y).lineWidth(0.5).strokeColor(LINE).stroke()
  doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text(text, 50, y + 8, { width: 495, align: 'center' })
}

async function qr(doc, url, x, y, size = 80) {
  const png = await QRCode.toBuffer(url, { margin: 1, width: size * 3, color: { dark: INK } })
  doc.image(png, x, y, { width: size })
}

function keyValues(doc, pairs, { x = 50, width = 495, labelWidth = 130 } = {}) {
  for (const [label, value] of pairs) {
    const y = doc.y
    doc.fillColor(MUTED).font('Helvetica').fontSize(9.5).text(label, x, y, { width: labelWidth })
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(9.5).text(value ?? '—', x + labelWidth, y, { width: width - labelWidth })
    doc.moveDown(0.45)
  }
}

// Simple table: columns = [{ label, width, align }], rows = arrays of strings.
function table(doc, columns, rows, { x = 50 } = {}) {
  const pad = 5
  const drawRow = (cells, { header = false, shade = false } = {}) => {
    doc.font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5)
    const heights = cells.map((c, i) => doc.heightOfString(String(c ?? ''), { width: columns[i].width - pad * 2 }))
    const h = Math.max(...heights) + pad * 2
    if (doc.y + h > doc.page.height - 80) doc.addPage()
    const y = doc.y
    const total = columns.reduce((s, c) => s + c.width, 0)
    if (header) doc.rect(x, y, total, h).fill(BRAND)
    else if (shade) doc.rect(x, y, total, h).fill('#fdf5ef')
    let cx = x
    cells.forEach((c, i) => {
      doc.fillColor(header ? '#ffffff' : INK).text(String(c ?? ''), cx + pad, y + pad, { width: columns[i].width - pad * 2, align: columns[i].align ?? 'left' })
      cx += columns[i].width
    })
    doc.moveTo(x, y + h).lineTo(x + total, y + h).lineWidth(0.5).strokeColor(LINE).stroke()
    doc.y = y + h
    doc.x = x
  }
  drawRow(columns.map((c) => c.label), { header: true })
  rows.forEach((r, i) => drawRow(r, { shade: i % 2 === 1 }))
  doc.moveDown(0.8)
}

// ─────────────────────────────── Documents ───────────────────────────────

export function receiptPdf({ payment, student }) {
  return render(async (doc) => {
    await letterhead(doc, 'Official Receipt')
    keyValues(doc, [
      ['Receipt number', payment.receipt_number],
      ['Date', fmtDate(payment.paid_at)],
      ['Received from', `${student.first_name} ${student.last_name}`],
      ['Student ID', student.student_number],
      ['Programme', student.programme_name ?? '—'],
      ['Payment for', payment.purpose],
      ['Method', payment.method.replace(/_/g, ' ')],
      ['Reference', payment.reference ?? '—'],
    ])
    doc.moveDown(0.6)
    const y = doc.y
    doc.rect(50, y, 495, 46).fill('#fdf5ef')
    doc.fillColor(MUTED).font('Helvetica').fontSize(10).text('Amount paid', 66, y + 10)
    doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(18).text(formatKobo(payment.amount_kobo), 66, y + 10, { width: 463, align: 'right' })
    doc.y = y + 60
    doc.fillColor(INK).font('Helvetica').fontSize(9.5)
      .text(`Outstanding balance after this payment: ${formatKobo(Math.max(0, student.balance_kobo ?? 0))}`, 50)
    doc.moveDown(2)
    doc.fillColor(MUTED).fontSize(8.5).text('This receipt was generated electronically and is valid without a signature.', 50)
    footer(doc, `Receipt ${payment.receipt_number} · The Chefs Culinary Academy`)
  })
}

export function resultSlipPdf({ student, cohort, rows, summary, verificationCode, scheme }) {
  return render(async (doc) => {
    await letterhead(doc, 'Statement of Results')
    keyValues(doc, [
      ['Student', `${student.first_name} ${student.last_name}`],
      ['Student ID', student.student_number],
      ['Programme', cohort.programme_name],
      ['Cohort', cohort.name],
    ])
    doc.moveDown(0.5)
    const practicalMax = scheme.components.find((c) => c.id === 'practical')?.max ?? 70
    const theoryMax = scheme.components.find((c) => c.id === 'theory')?.max ?? 30
    table(
      doc,
      [
        { label: 'Course', width: 175 },
        { label: `Practical /${practicalMax}`, width: 70, align: 'center' },
        { label: `Theory /${theoryMax}`, width: 60, align: 'center' },
        { label: 'Total /100', width: 60, align: 'center' },
        { label: 'Grade', width: 45, align: 'center' },
        { label: 'Remark', width: 85 },
      ],
      rows.map((r) => [r.course_name, r.practical, r.theory, r.total, r.grade, r.remark]),
    )
    keyValues(doc, [
      ['Courses', String(summary.count)],
      ['Average score', summary.average != null ? summary.average.toFixed(1) : '—'],
      ['Overall grade', summary.grade ?? '—'],
      ...(summary.position ? [['Position in class', `${summary.position} of ${summary.classSize}`]] : []),
    ])
    doc.moveDown(0.6)
    doc.fillColor(MUTED).font('Helvetica').fontSize(8)
      .text(`Grading: ${scheme.bands.map((b) => `${b.grade} ${b.min}–${b.max} (${b.remark})`).join(' · ')}`, 50, doc.y, { width: 495 })
    const url = `${config.webUrl}/verify?code=${verificationCode}`
    const y = doc.page.height - 165
    await qr(doc, url, 50, y)
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text(`Verification code: ${verificationCode}`, 140, y + 18)
    doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(`Verify at ${config.webUrl}/verify`, 140, y + 34)
    doc.text(`Issued ${fmtDate(new Date())}`, 140, y + 48)
    footer(doc, 'This statement is valid only if the verification code matches the academy’s records.')
  })
}

export function admissionLetterPdf({ application, programme, cohort, studentNumber }) {
  return render(async (doc) => {
    const site = await letterhead(doc, null)
    const p = application.data?.personal ?? {}
    doc.fillColor(INK).font('Helvetica').fontSize(10)
    doc.text(fmtDate(application.decided_at ?? new Date()), { align: 'right' })
    doc.moveDown()
    doc.text(p.fullName ?? '')
    if (p.address) doc.text(p.address)
    if (p.city || p.state) doc.text([p.city, p.state].filter(Boolean).join(', '))
    doc.moveDown()
    doc.font('Helvetica-Bold').fontSize(12).fillColor(BRAND).text('OFFER OF ADMISSION')
    doc.moveDown(0.6)
    doc.font('Helvetica').fontSize(10).fillColor(INK)
    const first = (p.fullName ?? '').split(' ')[0] || 'Applicant'
    const para = (t) => { doc.text(t, { align: 'justify', lineGap: 2 }); doc.moveDown(0.7) }
    para(`Dear ${first},`)
    para(`Following a review of your application (reference ${application.reference}), we are pleased to offer you admission to the ${programme.name} at ${site.name}.`)
    keyValues(doc, [
      ['Programme', programme.name],
      ['Cohort', cohort?.name ?? 'To be confirmed'],
      ['Start date', cohort?.starts_on ? fmtDate(cohort.starts_on) : 'To be confirmed'],
      ['Duration', programme.duration_weeks ? `${programme.duration_weeks} weeks` : '—'],
      ['Schedule', cohort?.schedule ?? programme.schedule ?? '—'],
      ['Tuition', programme.fee_kobo ? formatKobo(cohort?.fee_kobo ?? programme.fee_kobo) : 'As advised'],
      ...(studentNumber ? [['Student ID', studentNumber]] : []),
    ], { x: 70, width: 455 })
    doc.moveDown(0.4)
    para('To secure your place, please complete your fee payment (or the first instalment) before the start date through the student portal, or at the academy office. Your student portal account gives you access to your timetable, materials, results and receipts.')
    para('We look forward to welcoming you to our kitchens.')
    doc.text('Yours sincerely,')
    doc.moveDown(2.2)
    doc.font('Helvetica-Bold').text('Management')
    doc.font('Helvetica').text(site.name)
    footer(doc, `${site.legalName} · ${site.address}`)
  })
}

export function certificatePdf({ certificate, student }) {
  return render(async (doc) => {
    const { site } = await getSettings()
    const w = doc.page.width
    const h = doc.page.height
    doc.rect(18, 18, w - 36, h - 36).lineWidth(3).strokeColor(BRAND).stroke()
    doc.rect(28, 28, w - 56, h - 56).lineWidth(0.8).strokeColor(BRAND).stroke()
    doc.image(LOGO, w / 2 - 38, 52, { width: 76 })
    doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(16).text(site.name.toUpperCase(), 0, 140, { align: 'center', width: w, characterSpacing: 1.2 })
    doc.fillColor(INK).font('Times-Roman').fontSize(36).text('Certificate', 0, 180, { align: 'center', width: w })
    doc.fontSize(16).fillColor(MUTED).text('of Completion', 0, 222, { align: 'center', width: w })
    doc.font('Helvetica').fontSize(11).fillColor(MUTED).text('This is to certify that', 0, 262, { align: 'center', width: w })
    doc.font('Times-BoldItalic').fontSize(30).fillColor(INK).text(`${student.first_name} ${student.last_name}`, 0, 284, { align: 'center', width: w })
    doc.font('Helvetica').fontSize(11).fillColor(MUTED).text('has successfully completed the', 0, 330, { align: 'center', width: w })
    doc.font('Helvetica-Bold').fontSize(16).fillColor(BRAND).text(certificate.title, 60, 350, { align: 'center', width: w - 120 })
    const extra = [certificate.grade ? `with an overall grade of ${certificate.grade}` : null, `awarded on ${fmtDate(certificate.issued_on)}`].filter(Boolean).join(', ')
    doc.font('Helvetica').fontSize(11).fillColor(INK).text(extra, 0, doc.y + 8, { align: 'center', width: w })

    const baseY = h - 150
    doc.moveTo(w - 250, baseY + 30).lineTo(w - 70, baseY + 30).lineWidth(0.8).strokeColor(INK).stroke()
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('Management', w - 250, baseY + 36, { width: 180, align: 'center' })
    await qr(doc, `${config.webUrl}/verify?code=${certificate.verification_code}`, 70, baseY - 10, 78)
    doc.fontSize(8).fillColor(MUTED)
      .text(`Certificate no. ${certificate.serial}`, 156, baseY + 4)
      .text(`Student ID ${student.student_number}`, 156, baseY + 17)
      .text(`Verify: ${config.webUrl}/verify · code ${certificate.verification_code}`, 156, baseY + 30)
  }, { size: 'A4', layout: 'landscape', margin: 0 })
}

export function idCardPdf({ student, photo }) {
  // CR80 card size (85.6 × 54 mm) in points.
  return render(async (doc) => {
    const { site } = await getSettings()
    const w = 242.6
    doc.rect(0, 0, w, 30).fill(BRAND)
    doc.image(LOGO, 6, 3, { width: 24 })
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(7.5).text(site.name.toUpperCase(), 34, 11, { width: w - 40 })
    if (photo) {
      try { doc.image(photo, 8, 38, { fit: [52, 64] }) } catch { /* unsupported image format */ }
    } else {
      doc.rect(8, 38, 52, 64).strokeColor(LINE).stroke()
    }
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text(`${student.first_name} ${student.last_name}`, 68, 40, { width: 120 })
    doc.font('Helvetica').fontSize(7).fillColor(MUTED)
      .text(student.student_number, 68, 56)
      .text(student.programme_name ?? '', 68, 66, { width: 115 })
      .text(student.cohort_name ?? '', 68, 86, { width: 115 })
    await qr(doc, `${config.webUrl}/verify?student=${encodeURIComponent(student.student_number)}`, 190, 50, 46)
    doc.rect(0, 146, w, 7).fill(BRAND)
  }, { size: [242.6, 153], margin: 0 })
}

export function sponsorInvoicePdf({ invoice, cohort }) {
  return render(async (doc) => {
    await letterhead(doc, 'Invoice')
    keyValues(doc, [
      ['Invoice number', invoice.invoice_number],
      ['Issued', fmtDate(invoice.issued_on)],
      ['Due', fmtDate(invoice.due_date)],
      ['Bill to', invoice.sponsor_name],
      ['Email', invoice.sponsor_email ?? '—'],
      ['Cohort', cohort ? `${cohort.name} (${cohort.programme_name})` : '—'],
      ['Status', invoice.status.toUpperCase()],
    ])
    doc.moveDown(0.6)
    table(doc, [{ label: 'Description', width: 375 }, { label: 'Amount', width: 120, align: 'right' }], [
      [invoice.description, formatKobo(invoice.amount_kobo)],
    ])
    doc.font('Helvetica-Bold').fontSize(12).fillColor(BRAND).text(`Total due: ${formatKobo(invoice.amount_kobo)}`, 50, doc.y, { width: 495, align: 'right' })
    footer(doc, 'Please quote the invoice number with your payment.')
  })
}
