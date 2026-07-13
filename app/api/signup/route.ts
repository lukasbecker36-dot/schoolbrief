import { supabase } from '@/lib/supabase'
import { createSessionToken, sessionCookie, sendLoginEmail } from '@/lib/auth'
import { rateLimit, clientIp } from '@/lib/ratelimit'

export const runtime = 'nodejs'

function generateId(length: number) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { email: rawEmail, inviteCode } = body

    const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : ''
    if (!email) {
      return Response.json({ error: 'Email required' }, { status: 400 })
    }

    // Cap signup attempts per caller (also throttles invite-code guessing).
    if (!(await rateLimit(`signup-ip:${clientIp(req)}`, 10, 3600))) {
      return Response.json({ error: 'Too many attempts — try again later' }, { status: 429 })
    }

    // Check invite code
    const validCodes = (process.env.INVITE_CODES || '').split(',').map(c => c.trim().toUpperCase())
    if (!inviteCode || !validCodes.includes(inviteCode.trim().toUpperCase())) {
      return Response.json({ error: 'Invalid invite code' }, { status: 403 })
    }

    // If the account already exists, don't reveal anything about it — email a
    // sign-in link to the address on file instead.
    const { data: existing } = await supabase
      .from('users')
      .select('id, email')
      .eq('email', email)
      .single()

    if (existing) {
      const { origin } = new URL(req.url)
      await sendLoginEmail(existing, origin)
      return Response.json({ existing: true })
    }

    // Create new user
    const inboundAddress = `${generateId(8)}@in.schoolbrief.uk`

    const { data: user, error } = await supabase
      .from('users')
      .insert({ email, inbound_address: inboundAddress })
      .select()
      .single()

    if (error) {
      console.error('Insert error:', error)
      return Response.json({ error: 'Signup failed' }, { status: 500 })
    }

    // Sign the new user in straight away so onboarding works without a
    // round-trip through the login email.
    const session = createSessionToken(user.id)
    return Response.json(
      { address: user.inbound_address },
      { headers: { 'Set-Cookie': sessionCookie(session) } }
    )
  } catch (err) {
    console.error('Caught error:', err)
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}
