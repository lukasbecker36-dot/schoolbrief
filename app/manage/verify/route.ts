import { supabase } from '@/lib/supabase'

export async function POST(req: Request) {
  const { email } = await req.json()

  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .single()

  if (!user) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const { data: children } = await supabase
    .from('children')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })

  return Response.json({ user, children })
}