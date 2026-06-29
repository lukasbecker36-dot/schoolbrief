import { supabase } from '@/lib/supabase'

// Polled by the connected page while a background Gmail sync runs. The page
// watches lastSyncedAt: when it changes from the baseline, the sync has
// finished and the counts reflect what was pulled in.
export async function POST(req: Request) {
  try {
    const { email } = await req.json()
    if (!email) {
      return Response.json({ error: 'Email required' }, { status: 400 })
    }

    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single()

    if (!user) {
      return Response.json({ error: 'User not found' }, { status: 404 })
    }

    const { data: conn } = await supabase
      .from('gmail_connections')
      .select('last_synced_at')
      .eq('user_id', user.id)
      .single()

    const todayStr = new Date().toISOString().split('T')[0]

    const { count: eventCount } = await supabase
      .from('events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('event_date', todayStr)

    const { count: noticeCount } = await supabase
      .from('notices')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('expires_at', todayStr)

    return Response.json({
      lastSyncedAt: conn?.last_synced_at || null,
      eventCount: eventCount || 0,
      noticeCount: noticeCount || 0
    })
  } catch (err) {
    console.error('Gmail status error:', err)
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}
