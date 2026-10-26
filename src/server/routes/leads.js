import { z } from 'zod'
import { Lead } from '../db/models.js'
import { Router, rateLimit, defer } from '../http.js'
import { config } from '../config.js'
import { parse, optionalText, requiredText } from '../lib/validate.js'
import { sendMail, layout } from '../lib/mailer.js'

export const leads = new Router()

const leadSchema = z
  .object({
    name: requiredText(120),
    email: z.string().trim().toLowerCase().email('Enter a valid email address').max(254).optional().or(z.literal('')),
    phone: z.string().trim().max(30).optional(),
    programmeInterest: optionalText(200),
    preferredStart: optionalText(100),
    heardAbout: optionalText(200),
    message: optionalText(3000),
    source: z.enum(['enquiry', 'brochure', 'visit', 'newsletter', 'popup', 'catering', 'employer', 'event']).default('enquiry'),
    consent: z.literal(true, { message: 'Consent is required' }),
    website: z.string().max(0).optional(), // honeypot
  })
  .refine((v) => v.email || v.phone, { message: 'Enter an email or phone number', path: ['email'] })

// Public enquiry / brochure / book-a-visit / newsletter submissions (spec §6.1).
leads.post('/', rateLimit({ windowMs: 60 * 60_000, limit: 15, message: 'Too many submissions. Please try again later.' }), async (req, res) => {
  const body = parse(leadSchema, req.body)
  const row = await Lead.create({
    name: body.name, email: body.email || null, phone: body.phone || null, programme_interest: body.programmeInterest,
    preferred_start: body.preferredStart, heard_about: body.heardAbout, message: body.message, source: body.source, consent: true,
  })

  // Spec §6.2: instant auto-reply to the visitor, and a notification to management.
  if (body.email) {
    defer(() => sendMail({
      to: body.email,
      subject: 'Thank you for contacting The Chefs Culinary Academy',
      html: layout({
        heading: `Thank you, ${body.name.split(' ')[0]}!`,
        paragraphs: [
          'We have received your details and a member of our admissions team will be in touch shortly.',
          'In the meantime, you can explore our programmes, fees and upcoming intakes on our website.',
        ],
        action: { label: 'View programmes', url: `${config.webUrl}/programmes` },
      }),
    }))
  }
  if (config.adminNotifyEmails.length) {
    defer(() => sendMail({
      to: config.adminNotifyEmails,
      subject: `New ${body.source} lead: ${body.name}`,
      html: layout({
        heading: 'New website lead',
        paragraphs: [
          `${body.name} · ${body.email || '—'} · ${body.phone || '—'}`,
          `Interest: ${body.programmeInterest ?? '—'} · Source: ${body.source}`,
          body.message ?? '',
        ],
        action: { label: 'Open leads dashboard', url: `${config.adminUrl}/leads` },
      }),
    }))
  }
  res.status(201).json({ id: row._id })
})
