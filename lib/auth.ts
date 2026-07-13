import crypto from 'crypto'
import { supabase } from '@/lib/supabase'
import { Resend } from 'resend'

// Magic-link auth. Login tokens are short-lived HMAC-signed links emailed to
// the user; sessions are longer-lived signed tokens stored in an httpOnly
// cookie. Prefer a dedicated AUTH_SECRET; falls back to CRON_SECRET so a
// deploy without the new env var doesn't take the site down.
const LOGIN_TOKEN_TTL_MS = 15 * 60_000
const SESSION_TTL_MS = 30 * 24 * 3600_000

function getSecret() {
  const s = process.env.AUTH_SECRET || process.env.CRON_SECRET || ''
  if (!s) throw new Error('Neither AUTH_SECRET nor CRON_SECRET is set')
  return s
}

function sign(payload: string) {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('hex')
}

function timingSafeEqual(a: string, b: string) {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb)
}

function createToken(kind: string, userId: string, ttlMs: number) {
  const payload = `${kind}|${userId}|${Date.now() + ttlMs}|${crypto.randomBytes(8).toString('hex')}`
  return Buffer.from(`${payload}|${sign(payload)}`).toString('base64url')
}

function verifyToken(kind: string, token: string): string | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8')
    const parts = decoded.split('|')
    if (parts.length !== 5) return null
    const [k, userId, exp, nonce, sig] = parts
    if (k !== kind) return null
    if (!timingSafeEqual(sig, sign(`${k}|${userId}|${exp}|${nonce}`))) return null
    if (Date.now() > Number(exp)) return null
    return userId
  } catch {
    return null
  }
}

export const createLoginToken = (userId: string) => createToken('login', userId, LOGIN_TOKEN_TTL_MS)
export const verifyLoginToken = (token: string) => verifyToken('login', token)
export const createSessionToken = (userId: string) => createToken('session', userId, SESSION_TTL_MS)

export function sessionCookie(token: string) {
  return `sb_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
}

export function getSessionUserId(req: Request): string | null {
  const cookie = req.headers.get('cookie') || ''
  const m = cookie.match(/(?:^|;\s*)sb_session=([^;\s]+)/)
  if (!m) return null
  return verifyToken('session', m[1])
}

export async function getSessionUser(req: Request): Promise<any | null> {
  const userId = getSessionUserId(req)
  if (!userId) return null
  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single()
  return user || null
}

// Emails a sign-in link to an existing user. Used by the login flow and by
// signup when the email already has an account.
export async function sendLoginEmail(user: { id: string; email: string }, origin: string) {
  const token = createLoginToken(user.id)
  const link = `${origin}/api/auth/verify?token=${token}`
  const resend = new Resend(process.env.RESEND_API_KEY)
  await resend.emails.send({
    from: 'SchoolBrief <digest@schoolbrief.uk>',
    to: user.email,
    subject: 'Your SchoolBrief sign-in link',
    html: `
      <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <h1 style="color: #2563eb; font-size: 24px;">SchoolBrief</h1>
        <p style="color: #1a1a1a;">Click the button below to sign in to your SchoolBrief account.</p>
        <a href="${link}" style="display: inline-block; background: #2563eb; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; margin: 16px 0;">Sign in to SchoolBrief</a>
        <p style="color: #666; font-size: 14px;">This link expires in 15 minutes. If you didn't request it, you can safely ignore this email.</p>
      </div>
    `
  })
}
