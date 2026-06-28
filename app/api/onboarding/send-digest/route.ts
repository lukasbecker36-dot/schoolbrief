import { supabase } from '@/lib/supabase'
import { sendDigestForUser } from '@/lib/digest'

// Powers the onboarding "see your digest now" button. Sends the digest to the
// user's own registered email immediately, built from whatever they've
// forwarded so far. Only ever sends to the address on file, so there's nothing
// to spoof beyond triggering a real user's own digest early.
export async function POST(req: Request) {
  try {
    const { email } = await req.json()
    if (!email) {
      return Response.json({ error: 'Email required' }, { status: 400 })
    }

    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single()

    if (!user) {
      return Response.json({ error: 'User not found' }, { status: 404 })
    }

    await sendDigestForUser(user, true)
    return Response.json({ sent: true })
  } catch (err) {
    console.error('Onboarding send-digest error:', err)
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}
