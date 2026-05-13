import { supabase } from '@/lib/supabase'

export async function POST(req: Request) {
  const { userId, email } = await req.json()

  const cleanedEmail = email?.trim() || null

  const { error } = await supabase
    .from('users')
    .update({ secondary_email: cleanedEmail })
    .eq('id', userId)

  if (error) {
    console.error(error)
    return Response.json({ error: 'Failed to update' }, { status: 500 })
  }

  return Response.json({ success: true })
}
