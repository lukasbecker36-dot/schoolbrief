import { supabase } from '@/lib/supabase'
import { syncConnection } from '@/lib/gmail'

export const runtime = 'nodejs'
export const maxDuration = 60

// Daily cron (runs before the digest) that pulls new school emails from every
// connected Gmail account and feeds them into the extraction pipeline.
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const { data: connections } = await supabase
    .from('gmail_connections')
    .select('*')

  if (!connections || connections.length === 0) {
    return Response.json({ message: 'No Gmail connections' })
  }

  let total = 0
  const report: any[] = []
  for (const conn of connections) {
    const result = await syncConnection(conn, 10)
    total += result.processed
    report.push({ user_id: conn.user_id, ...result })
  }

  return Response.json({ message: `Processed ${total} new emails`, report })
}
