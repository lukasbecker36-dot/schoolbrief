import { supabase } from '@/lib/supabase'
import { getSessionUser } from '@/lib/auth'

export const runtime = 'nodejs'

// Returns the signed-in user's account details and children. Replaces the old
// unauthenticated verify endpoint — the user comes from the session cookie,
// and only the fields the manage page needs are returned.
export async function GET(req: Request) {
  const user = await getSessionUser(req)
  if (!user) {
    return Response.json({ error: 'Not signed in' }, { status: 401 })
  }

  const { data: children } = await supabase
    .from('children')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })

  return Response.json({
    user: {
      email: user.email,
      inbound_address: user.inbound_address,
      secondary_email: user.secondary_email
    },
    children: children || []
  })
}
