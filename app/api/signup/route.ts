import { supabase } from '@/lib/supabase'

function generateId(length: number) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { email, inviteCode } = body

    if (!email) {
      return Response.json({ error: 'Email required' }, { status: 400 })
    }

    // Check invite code
    const validCodes = (process.env.INVITE_CODES || '').split(',').map(c => c.trim())
    if (!inviteCode || !validCodes.includes(inviteCode.trim().toUpperCase())) {
      return Response.json({ error: 'Invalid invite code' }, { status: 403 })
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

    // Create new user
    const inboundAddress = `${generateId(8)}@in.schoolbrief.uk`
    
    const { data: user, error } = await supabase
      .from('users')
      .insert({ email, inbound_address: inboundAddress })
      .select()
      .single()

    if (error) {
      console.error('Insert error:', error)
      return Response.json({ error: 'Signup failed' }, { status: 500 })
    }

    return Response.json({ address: user.inbound_address })

  } catch (err) {
    console.error('Caught error:', err)
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}