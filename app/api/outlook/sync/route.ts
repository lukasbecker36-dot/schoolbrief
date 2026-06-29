import { supabase } from '@/lib/supabase'
import { syncOutlookConnection } from '@/lib/outlook'

export const runtime = 'nodejs'
export const maxDuration = 60

// Pulls new school emails from every connected Outlook account. Callable on its
// own; the scheduled cron uses the unified /api/sync endpoint.
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const { data: connections } = await supabase
    .from('outlook_connections')
    .select('*')

  if (!connections || connections.length === 0) {
    return Response.json({ message: 'No Outlook connections' })
  }

  let total = 0
  const report: any[] = []
  for (const conn of connections) {
    const result = await syncOutlookConnection(conn, 10)
    total += result.processed
    report.push({ user_id: conn.user_id, ...result })
  }

  return Response.json({ message: `Processed ${total} new emails`, report })
}
