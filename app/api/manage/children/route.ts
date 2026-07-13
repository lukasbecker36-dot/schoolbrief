import { supabase } from '@/lib/supabase'
import { getSessionUser } from '@/lib/auth'

export const runtime = 'nodejs'

// Confirms a child belongs to the signed-in user before any mutation.
async function ownsChild(userId: string, childId: string) {
  const { data: child } = await supabase
    .from('children')
    .select('id')
    .eq('id', childId)
    .eq('user_id', userId)
    .single()
  return !!child
}

export async function POST(req: Request) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: 'Not signed in' }, { status: 401 })

  const { name, yearLevel, schoolName } = await req.json()
  if (!name || typeof name !== 'string') {
    return Response.json({ error: 'Name required' }, { status: 400 })
  }

  const { data: child, error } = await supabase
    .from('children')
    .insert({ user_id: user.id, name, year_level: yearLevel, school_name: schoolName })
    .select()
    .single()

  if (error) {
    console.error('Add child failed:', error)
    return Response.json({ error: 'Failed to add child' }, { status: 500 })
  }
  return Response.json({ child })
}

export async function DELETE(req: Request) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: 'Not signed in' }, { status: 401 })

  const { childId } = await req.json()
  if (!childId || !(await ownsChild(user.id, childId))) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  await supabase.from('children').delete().eq('id', childId).eq('user_id', user.id)
  return Response.json({ success: true })
}

export async function PATCH(req: Request) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: 'Not signed in' }, { status: 401 })

  const { childId, yearLevel } = await req.json()
  if (!childId || !(await ownsChild(user.id, childId))) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  await supabase
    .from('children')
    .update({ year_level: yearLevel })
    .eq('id', childId)
    .eq('user_id', user.id)

  return Response.json({ success: true })
}
