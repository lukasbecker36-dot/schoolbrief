import { simpleParser } from 'mailparser'
import { supabase } from '@/lib/supabase'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
})

export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    
    const to = formData.get('to') as string
    const rawEmail = formData.get('email') as string

    // Parse the raw email
    const parsed = await simpleParser(rawEmail)
    const emailText = parsed.text || ''
    const subject = parsed.subject || ''

    console.log('📧 Email received!')
    console.log('To:', to)
    console.log('Subject:', subject)

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

    // Send to Claude for extraction
    const message = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `You are helping extract school events from a parent email newsletter.

Extract any events, deadlines, or reminders from this email. For each one return:
- title: short name of the event
- event_date: the date in YYYY-MM-DD format (today is ${new Date().toISOString().split('T')[0]})
- description: one sentence summary including any actions the parent needs to take
- action_required: true if the parent needs to do something (pay money, return a form, bring something), false otherwise

Return ONLY a JSON array, no other text. If there are no events, return an empty array [].

Email subject: ${subject}
Email body: ${emailText}`
        }
      ]
    })

    const responseText = message.content[0].type === 'text' ? message.content[0].text : '[]'
    console.log('Claude response:', responseText)

    // Parse the events
    const events = JSON.parse(responseText)
    console.log('Extracted events:', events.length)

    // Save each event to the database
    for (const event of events) {
      await supabase.from('events').insert({
        user_id: user.id,
        title: event.title,
        event_date: event.event_date,
        description: event.description,
        action_required: event.action_required,
        source_email_subject: subject
      })
    }

    console.log('✅ Done! Saved', events.length, 'events')
    return new Response('ok', { status: 200 })

  } catch (err) {
    console.error('Error:', err)
    return new Response('ok', { status: 200 })
  }
}