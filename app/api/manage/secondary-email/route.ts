import { supabase } from '@/lib/supabase'
import { getSessionUser } from '@/lib/auth'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: 'Not signed in' }, { status: 401 })

  const { email } = await req.json()
  const cleanedEmail = email?.trim() || null

  const { error } = await supabase
    .from('users')
    .update({ secondary_email: cleanedEmail })
    .eq('id', user.id)

  if (error) {
    console.error('Secondary email update failed:', error)
    return Response.json({ error: 'Failed to update' }, { status: 500 })
  }

  return Response.json({ success: true })
}
