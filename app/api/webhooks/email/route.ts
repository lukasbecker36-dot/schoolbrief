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
// Get upcoming events already in the database (next 60 days)
const today = new Date().toISOString().split('T')[0]
const sixtyDaysOut = new Date()
sixtyDaysOut.setDate(sixtyDaysOut.getDate() + 60)
const sixtyDaysStr = sixtyDaysOut.toISOString().split('T')[0]

const { data: existingEvents } = await supabase
  .from('events')
  .select('title, event_date, description')
  .eq('user_id', user.id)
  .gte('event_date', today)
  .lte('event_date', sixtyDaysStr)
  .order('event_date', { ascending: true })

const existingContext = existingEvents && existingEvents.length > 0
  ? `EXISTING EVENTS already in this parent's calendar (do NOT extract these again):\n${existingEvents.map((e: any) => `- ${e.event_date}: ${e.title} (${e.description})`).join('\n')}`
  : 'No existing events in calendar yet.'

console.log('Existing events:', existingEvents?.length || 0)
const childrenContext = children && children.length > 0
  ? `The parent has the following children:\n${children.map((c: any) => `- ${c.name} (${c.year_level}${c.school_name ? `, ${c.school_name}` : ''})`).join('\n')}`
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

SCHOOL IDENTIFICATION:
- Identify which school this email is from by looking at the email subject, body header, or any school name mentioned. Store this as the school name for all events extracted from this email.
- The sender email domain may be a third-party platform (e.g. parentmail.co.uk, schoop.co.uk) — in that case, look for the school name in the email content itself.

YEAR GROUP AND CHILD MATCHING:
- If an event mentions a specific year group, check if any of the parent's children are in that year group AT THAT SCHOOL
- If the year group clearly does not match any child at that school, SKIP the event entirely
- If the event is for all year groups, or year group is unspecified, INCLUDE it
- Extract year-specific events as SEPARATE events — never combine two year groups into one event entry
- If an event matches a specific child, prefix the title with their name (e.g. "James — Book Fair")

CONTEXT INHERITANCE:
- If a deadline or reminder is clearly related to a specific trip or event mentioned elsewhere in the email, inherit the year group and child context from that event
- For example, if the email is about a Year 5 trip and mentions a permission form deadline, tag the deadline with the Year 5 child's name too

SCHOOL ATTRIBUTION:
- If an event has no specific year group or child attached, include the school name in the title so parents with multiple schools know which school it refers to (e.g. "Windmills: Mini Marathon" or "Hassocks Infants: Walk to School Week")
- If the child's name is already in the title, you don't need to add the school name too

Return ONLY a JSON array with these fields per event, no other text:
- title: event name following the rules above
- event_date: YYYY-MM-DD format (today is ${new Date().toISOString().split('T')[0]})
- description: one sentence summary including any parent actions needed
- action_required: true if parent needs to do something, false otherwise
- school_name: the school this event is from

If there are no relevant events, return [].

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
    source_email_subject: subject,
    school_name: event.school_name || null
  })
}

    console.log('✅ Done! Saved', events.length, 'events')
    return new Response('ok', { status: 200 })

  } catch (err) {
    console.error('Error:', err)
    return new Response('ok', { status: 200 })
  }
}