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
      text: `You are helping extract useful information from school emails for a parent.

${childrenContext}

${existingContext}

Identify which school this email is from by looking at the email subject, body header, or any school name mentioned. The sender email domain may be a third-party platform (e.g. parentmail.co.uk) — in that case look for the school name in the email content itself.

You must classify each piece of information into one of three categories:

CATEGORY 1 — EVENTS (things happening on a specific future date)
Examples: trips, sports day, bake off, assemblies, performances, fundraisers, deadlines
Rules:
- Extract year-specific events as SEPARATE events — never combine two year groups into one
- If an event is clearly for a year group that NONE of the children attend at that school, SKIP it
- If the event matches a specific child, prefix the title with their name (e.g. "James — Brighton Pavilion Trip")
- If no specific child, prefix with school name (e.g. "Windmills: Mini Marathon")
- Inherit year/child context into related deadlines (e.g. permission form for a Year 5 trip → tag to Year 5 child)
- Do NOT re-extract events already in the EXISTING EVENTS list unless there is new information

CATEGORY 2 — NOTICES (short-term announcements, no specific future date)
Examples: staffing changes, policy updates (Pokémon ban), road safety reminders, general school news
Rules:
- These are one-off announcements that are relevant today but not ongoing
- Include school name in title so parent knows which school it refers to
- expires_in_days: 1 (they expire after 1 day)

CATEGORY 3 — LEARNING (weekly overviews for a specific child)
Examples: "Year 2 Weekly Overview", "Reception Weekly Wonders", class newsletters
Rules:
- These replace the previous week's overview for that child
- Always tag to the specific child by name
- expires_in_days: 7 (they expire after one week)
- Summarise the key learning themes in 2-3 sentences in the content field

Return ONLY a JSON object in this exact format, no other text:
{
  "events": [
    {
      "title": "event title",
      "event_date": "YYYY-MM-DD",
      "description": "one sentence summary",
      "action_required": true/false,
      "school_name": "school name"
    }
  ],
  "notices": [
    {
      "title": "notice title",
      "content": "one paragraph summary",
      "school_name": "school name",
      "category": "notice",
      "expires_in_days": 1
    }
  ],
  "learning": [
    {
      "title": "child name — Week of [date]",
      "content": "2-3 sentence summary of this week's learning",
      "child_name": "exact child name from the list above",
      "school_name": "school name",
      "category": "learning",
      "expires_in_days": 7
    }
  ]
}

Today's date is ${new Date().toISOString().split('T')[0]}.
Email subject: ${subject}
Email body: ${emailText}`
    })

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{ role: 'user', content }]
    })

    const responseText = message.content[0].type === 'text' ? message.content[0].text : '{}'
console.log('Claude response:', responseText)

let cleanJson = responseText.replace(/```json\n?/g, '').replace(/```/g, '').trim()
const jsonMatch = cleanJson.match(/\{[\s\S]*\}/)
if (jsonMatch) cleanJson = jsonMatch[0]

const result = JSON.parse(cleanJson)
const events = result.events || []
const notices = result.notices || []
const learning = result.learning || []

console.log(`Extracted: ${events.length} events, ${notices.length} notices, ${learning.length} learning`)

// Save events
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

// Save notices and learning
const today = new Date()
for (const notice of [...notices, ...learning]) {
  // For learning, delete the previous one for this child first
  if (notice.category === 'learning' && notice.child_name) {
    const child = children?.find((c: any) => c.name === notice.child_name)
    if (child) {
      await supabase
        .from('notices')
        .delete()
        .eq('user_id', user.id)
        .eq('child_id', child.id)
        .eq('category', 'learning')
      
      const expiresAt = new Date(today)
      expiresAt.setDate(today.getDate() + (notice.expires_in_days || 7))

      await supabase.from('notices').insert({
        user_id: user.id,
        child_id: child.id,
        school_name: notice.school_name || null,
        category: notice.category,
        title: notice.title,
        content: notice.content,
        expires_at: expiresAt.toISOString().split('T')[0]
      })
    }
  } else {
    const expiresAt = new Date(today)
    expiresAt.setDate(today.getDate() + (notice.expires_in_days || 1))

    await supabase.from('notices').insert({
      user_id: user.id,
      school_name: notice.school_name || null,
      category: notice.category,
      title: notice.title,
      content: notice.content,
      expires_at: expiresAt.toISOString().split('T')[0]
    })
  }
}

console.log('✅ Done!')
    return new Response('ok', { status: 200 })

  } catch (err) {
    console.error('Error:', err)
    return new Response('ok', { status: 200 })
  }
}