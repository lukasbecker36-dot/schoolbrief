import { after } from 'next/server'
import { supabase } from '@/lib/supabase'
import { syncOutlookConnection } from '@/lib/outlook'
import { getSessionUser } from '@/lib/auth'

export const runtime = 'nodejs'
export const maxDuration = 60

// Stores the school sender domains/addresses for the signed-in user's connected
// Outlook account and kicks off the first sync in the background (the connected
// page polls for it).
export async function POST(req: Request) {
  try {
    const user = await getSessionUser(req)
    if (!user) return Response.json({ error: 'Not signed in' }, { status: 401 })

    const { domains } = await req.json()
    if (!domains) {
      return Response.json({ error: 'Domains required' }, { status: 400 })
    }

    const list = String(domains)
      .split(/[,\s]+/)
      .map(d => d.trim().toLowerCase().replace(/^@/, ''))
      .filter(Boolean)

    const { data: connection, error } = await supabase
      .from('outlook_connections')
      .update({ school_domains: list })
      .eq('user_id', user.id)
      .select()
      .single()

    if (error) {
      console.error('Failed to save Outlook school domains:', error)
      return Response.json({ error: 'Save failed' }, { status: 500 })
    }

    const baselineSyncedAt = connection.last_synced_at || null
    after(async () => {
      try {
        await syncOutlookConnection(connection, 4)
      } catch (err) {
        console.error('Background Outlook sync failed:', err)
      }
    })

    return Response.json({ saved: true, domains: list, baselineSyncedAt })
  } catch (err) {
    console.error('Outlook domains error:', err)
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}
