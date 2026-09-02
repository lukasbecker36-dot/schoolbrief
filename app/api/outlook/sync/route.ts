import { supabase } from '@/lib/supabase'
import { syncOutlookConnection } from '@/lib/outlook'
import { SYNC_TIME_BUDGET_MS } from '@/lib/extract'

export const runtime = 'nodejs'
export const maxDuration = 60

// Pulls new school emails from every connected Outlook account. Callable on its
// own; the scheduled cron uses the unified /api/sync endpoint.
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  // One-off backfills: ?days=30 widens the look-back for this run only, for
  // recovering mail that predates a connection being set up (or a period when
  // the sync was broken). The cron never passes it, so the daily window stays
  // at 7. Capped at 90 so a stray value can't start an unbounded crawl.
  const { searchParams } = new URL(req.url)
  const windowDays = Math.min(Math.max(parseInt(searchParams.get('days') || '7', 10) || 7, 1), 90)

  const { data: connections } = await supabase
    .from('outlook_connections')
    .select('*')

  if (!connections || connections.length === 0) {
    return Response.json({ message: 'No Outlook connections' })
  }

  // One budget across every connection, as the unified cron does.
  const deadline = Date.now() + SYNC_TIME_BUDGET_MS
  let total = 0
  const report: any[] = []
  for (const conn of connections) {
    const result = await syncOutlookConnection(conn, 10, deadline, windowDays)
    total += result.processed
    report.push({ user_id: conn.user_id, ...result })
  }

  return Response.json({ message: `Processed ${total} new emails`, windowDays, report })
}
