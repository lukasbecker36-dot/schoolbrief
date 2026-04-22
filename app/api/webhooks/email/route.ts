import { simpleParser } from 'mailparser'
import { supabase } from '@/lib/supabase'

export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    
    const to = formData.get('to') as string
    const rawEmail = formData.get('email') as string

    // Parse the raw email
    const parsed = await simpleParser(rawEmail)

    console.log('📧 Email received!')
    console.log('To:', to)
    console.log('From:', parsed.from?.text)
    console.log('Subject:', parsed.subject)
    console.log('Body:', parsed.text?.slice(0, 500))

    // Find the user this email belongs to
    const inboundAddress = to.split('<').pop()?.replace('>', '').trim() || to
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('inbound_address', inboundAddress)
      .single()

    if (!user) {
      console.log('No user found for address:', inboundAddress)
      return new Response('ok', { status: 200 })
    }

    console.log('Found user:', user.email)

    return new Response('ok', { status: 200 })

  } catch (err) {
    console.error('Error:', err)
    return new Response('ok', { status: 200 })
  }
}