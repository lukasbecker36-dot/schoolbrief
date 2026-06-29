import { supabase } from '@/lib/supabase'
import { syncConnection } from '@/lib/gmail'

export const runtime = 'nodejs'
export const maxDuration = 60

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

    const { data: connection, error } = await supabase
      .from('gmail_connections')
      .update({ school_domains: list })
      .eq('user_id', user.id)
      .select()
      .single()

    if (error) {
      console.error('Failed to save school domains:', error)
      return Response.json({ error: 'Save failed' }, { status: 500 })
    }

    // Best-effort immediate sync so the user sees results right away. Capped low
    // to stay within the time limit; the daily cron picks up anything missed.
    let processed = 0
    try {
      const result = await syncConnection(connection, 2)
      processed = result.processed
    } catch (err) {
      console.error('Initial Gmail sync failed:', err)
    }

    return Response.json({ saved: true, domains: list, processed })
  } catch (err) {
    console.error('Domains error:', err)
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}
