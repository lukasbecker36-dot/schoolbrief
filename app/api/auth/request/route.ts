import { supabase } from '@/lib/supabase'
import { sendLoginEmail } from '@/lib/auth'
import { rateLimit, clientIp } from '@/lib/ratelimit'

export const runtime = 'nodejs'

// Requests a magic sign-in link. Always returns ok so the endpoint can't be
// used to enumerate which emails have accounts.
export async function POST(req: Request) {
  try {
    const { email } = await req.json()
    if (!email || typeof email !== 'string') {
      return Response.json({ error: 'Email required' }, { status: 400 })
    }

    // Cap login emails per address and per caller.
    const ipOk = await rateLimit(`auth-ip:${clientIp(req)}`, 10, 3600)
    const emailOk = await rateLimit(`auth-email:${email.trim().toLowerCase()}`, 5, 900)
    if (!ipOk || !emailOk) {
      return Response.json({ error: 'Too many requests — try again later' }, { status: 429 })
    }

    const { data: user } = await supabase
      .from('users')
      .select('id, email')
      .eq('email', email.trim().toLowerCase())
      .single()

    if (user) {
      const { origin } = new URL(req.url)
      await sendLoginEmail(user, origin)
    }

    return Response.json({ ok: true })
  } catch (err) {
    console.error('Auth request error:', err)
    return Response.json({ ok: true })
  }
}
