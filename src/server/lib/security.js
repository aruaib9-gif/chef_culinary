import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import { config } from '../config.js'

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url')

// Tokens are stored as keyed hashes so a database leak doesn't expose live sessions.
export const hashToken = (token) => crypto.createHmac('sha256', config.secret).update(token).digest('hex')

export const otpCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')

export const hashPassword = (pw) => bcrypt.hash(pw, 12)
export const checkPassword = (pw, hash) => bcrypt.compare(pw, hash)

// Readable, unambiguous codes for certificates / result slips (no 0/O/1/I).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function verificationCode(length = 10) {
  const bytes = crypto.randomBytes(length)
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')
}

export function tempPassword() {
  return `${verificationCode(4)}-${verificationCode(4)}-${crypto.randomInt(10, 99)}`
}

export function timingSafeEqualHex(a, b) {
  const ab = Buffer.from(a, 'hex')
  const bb = Buffer.from(b, 'hex')
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb)
}
