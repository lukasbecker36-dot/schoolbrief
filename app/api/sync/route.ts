import { supabase } from '@/lib/supabase'
import { syncConnection } from '@/lib/gmail'
import { syncOutlookConnection } from '@/lib/outlook'

export const runtime = 'nodejs'
export const maxDuration = 60

// Unified daily cron: pulls new school emails from every connected Gmail and
// Outlook account. One endpoint so we stay within the hosting cron limit.
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  let total = 0
  const report: any[] = []

  const { data: gmail } = await supabase.from('gmail_connections').select('*')
  for (const conn of gmail || []) {
    const result = await syncConnection(conn, 10)
    total += result.processed
    report.push({ provider: 'gmail', user_id: conn.user_id, ...result })
  }

  const { data: outlook } = await supabase.from('outlook_connections').select('*')
  for (const conn of outlook || []) {
    const result = await syncOutlookConnection(conn, 10)
    total += result.processed
    report.push({ provider: 'outlook', user_id: conn.user_id, ...result })
  }

  return Response.json({ message: `Processed ${total} new emails`, report })
}
