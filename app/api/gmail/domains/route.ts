import { supabase } from '@/lib/supabase'

// Stores the school sender domains/addresses we're allowed to read from a
// connected Gmail account, so we only ever pull school mail.
export async function POST(req: Request) {
  try {
    const { email, domains } = await req.json()
    if (!email || !domains) {
      return Response.json({ error: 'Email and domains required' }, { status: 400 })
    }

    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single()

    if (!user) {
      return Response.json({ error: 'User not found' }, { status: 404 })
    }

    // Normalise into a clean list of lowercase domains/addresses.
    const list = String(domains)
      .split(/[,\s]+/)
      .map(d => d.trim().toLowerCase().replace(/^@/, ''))
      .filter(Boolean)

    const { error } = await supabase
      .from('gmail_connections')
      .update({ school_domains: list })
      .eq('user_id', user.id)

    if (error) {
      console.error('Failed to save school domains:', error)
      return Response.json({ error: 'Save failed' }, { status: 500 })
    }

    return Response.json({ saved: true, domains: list })
  } catch (err) {
    console.error('Domains error:', err)
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}
