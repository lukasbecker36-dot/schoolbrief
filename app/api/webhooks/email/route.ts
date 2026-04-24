import { simpleParser } from 'mailparser'
import { supabase } from '@/lib/supabase'
import Anthropic from '@anthropic-ai/sdk'

export async function POST(req: Request) {
  try {
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    })

    const formData = await req.formData()
    
    const to = formData.get('to') as string
    const rawEmail = formData.get('email') as string

    const parsed = await simpleParser(rawEmail)
    const emailText = parsed.text || ''
    const subject = parsed.subject || ''

    console.log('📧 Email received!')
    console.log('To:', to)
    console.log('Subject:', subject)
    console.log('Attachments:', parsed.attachments?.length || 0)

    // Find the user
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
    // Get the user's children
const { data: children } = await supabase
  .from('children')
  .select('*')
  .eq('user_id', user.id)

const childrenContext = children && children.length > 0
  ? `The parent has the following children:\n${children.map((c: any) => `- ${c.name} (${c.year_level})`).join('\n')}`
  : 'No children registered — include all events.'

console.log('Children:', childrenContext)

    // Build the content array for Claude — text + any PDF attachments
    const content: any[] = []

    // Add PDF attachments first (Claude recommends docs before text)
    const pdfAttachments = (parsed.attachments || []).filter(
      a => a.contentType === 'application/pdf' || a.filename?.toLowerCase().endsWith('.pdf')
    )

    for (const pdf of pdfAttachments) {
      console.log('Including PDF:', pdf.filename)
      content.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: pdf.content.toString('base64')
        }
      })
    }

    // Add the text prompt
    content.push({
      type: 'text',
      text: `You are helping extract school events from a parent email newsletter.

${childrenContext}

Extract any events, deadlines, or reminders from this email AND any attached PDFs. Follow these rules:
- If the event is clearly for a specific year group that NONE of the children are in, skip it entirely
- If the event mentions a child's name that matches one of the children above, include their name in the title
- If the event is for all years or year group is unspecified, include it

For each relevant event return:
- title: short name of the event, include child's name if relevant (e.g. "Emma — Book Fair")
- event_date: the date in YYYY-MM-DD format (today is ${new Date().toISOString().split('T')[0]})
- description: one sentence summary including any actions the parent needs to take
- action_required: true if the parent needs to do something (pay money, return a form, bring something), false otherwise

Return ONLY a JSON array, no other text. If there are no relevant events, return an empty array [].

Email subject: ${subject}
Email body: ${emailText}`
    })

    const message = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 2048,
      messages: [{ role: 'user', content }]
    })

    const responseText = message.content[0].type === 'text' ? message.content[0].text : '[]'
    console.log('Claude response:', responseText)

    const cleanJson = responseText.replace(/```json\n?/g, '').replace(/```/g, '').trim()
    const events = JSON.parse(cleanJson)
    console.log('Extracted events:', events.length)

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