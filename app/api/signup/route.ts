import { supabase } from '@/lib/supabase'
import { nanoid } from 'nanoid'

export async function POST(req: Request) {
  const { email } = await req.json()

  if (!email) {
    return Response.json({ error: 'Email required' }, { status: 400 })
  }

  // Check if user already exists
  const { data: existing } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .single()

  if (existing) {
    return Response.json({ address: existing.inbound_address })
  }

  // Create new user with unique inbound address
  const inboundAddress = `${nanoid(8)}@in.schoolbrief.uk`
  
  const { data: user, error } = await supabase
    .from('users')
    .insert({ email, inbound_address: inboundAddress })
    .select()
    .single()

  if (error) {
    console.error(error)
    return Response.json({ error: 'Signup failed' }, { status: 500 })
  }

  return Response.json({ address: user.inbound_address })
}