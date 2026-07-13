import { supabase } from '@/lib/supabase'
import { getSessionUser } from '@/lib/auth'

export const runtime = 'nodejs'

// Polled by the post-signup page to confirm we've received the user's first
// forwarded email and report what we extracted from it. The user comes from
// the session cookie set at signup.
export async function GET(req: Request) {
  try {
    const user = await getSessionUser(req)
    if (!user) {
      return Response.json({ error: 'Not signed in' }, { status: 401 })
    }

    const todayStr = new Date().toISOString().split('T')[0]

    const { data: events } = await supabase
      .from('events')
      .select('school_name, created_at')
      .eq('user_id', user.id)
      .gte('event_date', todayStr)

    const { count: noticeCount } = await supabase
      .from('notices')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('expires_at', todayStr)

    const { count: childCount } = await supabase
      .from('children')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)

    // Most recently extracted school name, for a friendly confirmation message.
    const sortedEvents = (events || []).sort((a, b) =>
      (b.created_at || '').localeCompare(a.created_at || '')
    )
    const schoolName = sortedEvents.find(e => e.school_name)?.school_name || null

    return Response.json({
      received: !!user.first_email_received_at,
      eventCount: events?.length || 0,
      noticeCount: noticeCount || 0,
      schoolName,
      hasChildren: (childCount || 0) > 0
    })
  } catch (err) {
    console.error('Onboarding status error:', err)
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}
