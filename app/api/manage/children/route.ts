import { supabase } from '@/lib/supabase'

export async function POST(req: Request) {
  const { userId, name, yearLevel } = await req.json()

  const { data: child, error } = await supabase
    .from('children')
    .insert({ user_id: userId, name, year_level: yearLevel })
    .select()
    .single()

  if (error) return Response.json({ error }, { status: 500 })
  return Response.json({ child })
}

export async function DELETE(req: Request) {
  const { childId } = await req.json()

  await supabase.from('children').delete().eq('id', childId)
  return Response.json({ success: true })
}

export async function PATCH(req: Request) {
  const { childId, yearLevel } = await req.json()

  await supabase
    .from('children')
    .update({ year_level: yearLevel })
    .eq('id', childId)

  return Response.json({ success: true })
}