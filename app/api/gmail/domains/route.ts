import { after } from 'next/server'
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

    // Kick off the first sync in the background so the save returns instantly.
    // The connected page polls /api/gmail/status and watches last_synced_at to
    // know when this finishes. The daily cron picks up anything not reached
    // within the function's time budget.
    const baselineSyncedAt = connection.last_synced_at || null
    after(async () => {
      try {
        await syncConnection(connection, 4)
      } catch (err) {
        console.error('Background Gmail sync failed:', err)
      }
    })

    return Response.json({ saved: true, domains: list, baselineSyncedAt })
  } catch (err) {
    console.error('Domains error:', err)
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}
