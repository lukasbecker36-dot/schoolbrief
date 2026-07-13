import { supabase } from '@/lib/supabase'
import { sendDigestForUser } from '@/lib/digest'
import { getSessionUser } from '@/lib/auth'

export const runtime = 'nodejs'
export const maxDuration = 60

// Powers the "see your digest now" buttons. Sends the digest to the signed-in
// user's own registered email, built from whatever has been extracted so far.
// An admin can also trigger it for a specific user with the CRON_SECRET.
export async function POST(req: Request) {
  try {
    let user = await getSessionUser(req)

    // Admin path: bearer CRON_SECRET + { email } in the body.
    if (!user) {
      const authHeader = req.headers.get('authorization')
      if (authHeader === `Bearer ${process.env.CRON_SECRET}`) {
        const { email } = await req.json().catch(() => ({}))
        if (email) {
          const { data } = await supabase.from('users').select('*').eq('email', email).single()
          user = data
        }
      }
    }

    if (!user) {
      return Response.json({ error: 'Not signed in' }, { status: 401 })
    }

    await sendDigestForUser(user, true)
    return Response.json({ sent: true })
  } catch (err) {
    console.error('Onboarding send-digest error:', err)
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}
