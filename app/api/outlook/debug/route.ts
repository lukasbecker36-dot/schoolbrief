import { supabase } from '@/lib/supabase'
import { debugListMessages } from '@/lib/outlook'

export const runtime = 'nodejs'

// Temporary diagnostic endpoint. Protected by CRON_SECRET. Returns what Graph
// reports for a connected mailbox so we can see senders/dates vs school_domains.
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const email = searchParams.get('email')
  if (!email) return Response.json({ error: 'email required' }, { status: 400 })

  const { data: user } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .single()
  if (!user) return Response.json({ error: 'user not found' }, { status: 404 })

  const { data: conn } = await supabase
    .from('outlook_connections')
    .select('*')
    .eq('user_id', user.id)
    .single()
  if (!conn) return Response.json({ error: 'no outlook connection for this user' }, { status: 404 })

  const result = await debugListMessages(conn)
  return Response.json(result)
}
