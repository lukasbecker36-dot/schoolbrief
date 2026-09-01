import { supabase } from '@/lib/supabase'
import { syncConnection } from '@/lib/gmail'
import { syncOutlookConnection } from '@/lib/outlook'
import { SYNC_TIME_BUDGET_MS } from '@/lib/extract'

export const runtime = 'nodejs'
export const maxDuration = 60

// Unified daily cron: pulls new school emails from every connected Gmail and
// Outlook account. One endpoint so we stay within the hosting cron limit.
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  // One budget for the whole run, not per connection, so the last connection
  // in the list can't be starved by the ones before it.
  const deadline = Date.now() + SYNC_TIME_BUDGET_MS
  let total = 0
  const report: any[] = []

  const { data: gmail } = await supabase.from('gmail_connections').select('*')
  for (const conn of gmail || []) {
    if (Date.now() > deadline) {
      report.push({ provider: 'gmail', user_id: conn.user_id, skipped: 'out of time' })
      continue
    }
    const result = await syncConnection(conn, 10, deadline)
    total += result.processed
    report.push({ provider: 'gmail', user_id: conn.user_id, ...result })
  }

  const { data: outlook } = await supabase.from('outlook_connections').select('*')
  for (const conn of outlook || []) {
    if (Date.now() > deadline) {
      report.push({ provider: 'outlook', user_id: conn.user_id, skipped: 'out of time' })
      continue
    }
    const result = await syncOutlookConnection(conn, 10, deadline)
    total += result.processed
    report.push({ provider: 'outlook', user_id: conn.user_id, ...result })
  }

  return Response.json({ message: `Processed ${total} new emails`, report })
}
