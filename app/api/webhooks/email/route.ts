import { simpleParser } from 'mailparser'
import { supabase } from '@/lib/supabase'
import Anthropic from '@anthropic-ai/sdk'
import { Resend } from 'resend'

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
    // Detect Gmail forwarding confirmation email and forward to parent
const isGmailConfirmation = 
  (parsed.from?.text?.includes('forwarding-noreply@google.com') ||
   subject?.toLowerCase().includes('gmail forwarding confirmation') ||
   subject?.toLowerCase().includes('forwarding confirmation'))

if (isGmailConfirmation) {
  console.log('📨 Gmail forwarding confirmation detected — forwarding to parent')
  
  const resend = new Resend(process.env.RESEND_API_KEY)
  
  await resend.emails.send({
    from: 'SchoolBrief <digest@schoolbrief.uk>',
    to: user.email,
    subject: `Action needed: Confirm your Gmail forwarding`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <h1 style="color: #2563eb; font-size: 24px;">SchoolBrief</h1>
        <p style="color: #1a1a1a;">Almost there! Gmail needs you to confirm that you want to forward emails to SchoolBrief.</p>
        <p style="color: #1a1a1a;">We've received a confirmation email from Gmail on your behalf. Here are the details:</p>
        <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
          ${parsed.html || `<pre>${parsed.text}</pre>`}
        </div>
        <p style="color: #666; font-size: 14px;">Click the confirmation link above to activate forwarding. Once confirmed, your school emails will start flowing into SchoolBrief automatically.</p>
      </div>
    `
  })
  
  console.log('✅ Confirmation email forwarded to', user.email)
  return new Response('ok', { status: 200 })
}
    // Get the user's children
    const { data: children } = await supabase
      .from('children')
      .select('*')
      .eq('user_id', user.id)

    // Get upcoming events already in the database (next 60 days)
    const todayStr = new Date().toISOString().split('T')[0]
    const sixtyDaysOut = new Date()
    sixtyDaysOut.setDate(sixtyDaysOut.getDate() + 60)
    const sixtyDaysStr = sixtyDaysOut.toISOString().split('T')[0]

    const { data: existingEvents } = await supabase
      .from('events')
      .select('title, event_date, description')
      .eq('user_id', user.id)
      .gte('event_date', todayStr)
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

// Log all attachments for debugging
for (const a of parsed.attachments || []) {
  console.log('Attachment:', a.filename, a.contentType)
}

// Add PDF attachments first (Claude recommends docs before text)
const pdfAttachments = (parsed.attachments || []).filter(
  (a: any) => a.contentType === 'application/pdf' || a.filename?.toLowerCase().endsWith('.pdf')
)

// Extract text from .eml attachments (forwarded emails)
let emlText = ''
const emlAttachments = (parsed.attachments || []).filter(
  (a: any) => a.contentType === 'message/rfc822' || a.filename?.toLowerCase().endsWith('.eml')
)
for (const eml of emlAttachments) {
  try {
    const innerParsed = await simpleParser(eml.content)
    emlText += `\n--- Forwarded email: ${innerParsed.subject} ---\n`
    emlText += innerParsed.text || ''
    console.log('Extracted text from .eml attachment:', innerParsed.subject)
    for (const innerAttachment of innerParsed.attachments || []) {
      if (innerAttachment.contentType === 'application/pdf' ||
          innerAttachment.filename?.toLowerCase().endsWith('.pdf')) {
        console.log('Found PDF inside .eml:', innerAttachment.filename)
        pdfAttachments.push(innerAttachment)
      }
    }
  } catch (err) {
    console.error('Error parsing .eml attachment:', err)
  }
}

// Push real PDF attachments into content
for (const pdf of pdfAttachments) {
  console.log('Including PDF attachment:', pdf.filename)
  content.push({
    type: 'document',
    source: {
      type: 'base64',
      media_type: 'application/pdf',
      data: pdf.content.toString('base64')
    }
  })
}

// Extract PDF URLs from email body and fetch them
const emailHtml = typeof parsed.html === 'string' ? parsed.html : ''
const pdfUrlMatches = (emailText + emailHtml).match(/https?:\/\/[^\s"<>]+\.pdf[^\s"<>]*/gi) || []
const uniquePdfUrls = [...new Set(pdfUrlMatches)]
console.log('PDF URLs found in email:', uniquePdfUrls.length)

for (const url of uniquePdfUrls) {
  try {
    console.log('Fetching PDF from URL:', url)
    const response = await fetch(url)
    if (response.ok) {
      const buffer = await response.arrayBuffer()
      const base64 = Buffer.from(buffer).toString('base64')
      content.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: base64
        }
      })
      console.log('Successfully fetched PDF from URL')
    }
  } catch (err) {
    console.error('Failed to fetch PDF from URL:', url, err)
  }
}

    
    // Add the text prompt
    content.push({
      type: 'text',
      text: `You are helping extract useful information from school emails for a parent.

${childrenContext}

${existingContext}

Identify which school this email is from by looking at the email subject, body header, or any school name mentioned. The sender email domain may be a third-party platform (e.g. parentmail.co.uk) — in that case look for the school name in the email content itself.

You must classify each piece of information into one of four categories:

CATEGORY 1 — SCHOOL EVENTS (things organised by the school happening on a specific future date)
Examples: trips, sports day, bake off, assemblies, performances, fundraisers, deadlines, school-organised clubs
Rules:
- ONLY include events that are organised and run by the school itself
- Extract year-specific events as SEPARATE events — never combine two year groups into one entry
- YEAR GROUP FILTERING IS ABSOLUTE: If an event mentions a specific year group (e.g. "Year 4 trip", "Y6 visit"), check if any child is in that EXACT year group at that school. If not, OMIT the event entirely from your response. Do NOT include it for "context" or "completeness". Do NOT include it with a note saying "not relevant" or "disregard". Simply do not output it at all.
- Example: If parent has James in Year 5 at Windmills, and email mentions "Y4 Butser Farm Trip" and "Y6 Brighton Trip", neither of these should appear in your output. They should be omitted completely.
- Whole-school events (no year group specified) should be included normally.
- If the event matches a specific child by year group, prefix the title with their name (e.g. "James — Brighton Pavilion Trip")
- If no specific child can be identified but it is a whole-school event, prefix with school name (e.g. "Windmills: Mini Marathon")
- Inherit year/child context into related deadlines (e.g. permission form for a Year 5 trip → tag to Year 5 child)
- Do NOT re-extract events already in the EXISTING EVENTS list unless there is significantly new information
- is_school_event: true

CATEGORY 2 — NOTICES (short-term announcements from the school, no specific future date)
Examples: staffing changes, policy updates, road safety reminders, general school news
Rules:
- ONLY include notices from the school itself — not third-party advertisements or community notices
- These are one-off announcements relevant today but not ongoing
- Include school name in title
- expires_in_days: 1

CATEGORY 3 — LEARNING (weekly overviews for a specific child)
Examples: "Weekly Overview", "Weekly Wonders", "Class Newsletter", "This Week in Year 2"
Rules:
- ONLY classify as learning if this email is specifically dedicated to summarising what a child or class has been learning that week
- Signs it IS a learning overview: lists specific subjects, topics, books, vocabulary, skills, or curriculum areas covered that week; typically sent weekly by a class teacher
- Signs it is NOT a learning overview: a general school newsletter mentioning activities in passing, an event email involving learning activities
- These replace the previous week's overview for that child
- Always tag to the specific child by name
- expires_in_days: 7
- Summarise the key learning themes in 2-3 sentences

CATEGORY 4 — OTHER EVENTS (community, commercial, or third-party events mentioned in school emails)
Examples: holiday clubs, community festivals, external sports events, paid activities, charity events not run by the school
Rules:
- These are events mentioned in school communications but NOT organised by the school
- Include enough detail for parents to act on them if interested
- is_school_event: false

Return ONLY a JSON object in this exact format, no other text:
{
  "events": [
    {
      "title": "event title",
      "event_date": "YYYY-MM-DD",
      "description": "one sentence summary",
      "action_required": true/false,
      "school_name": "school name",
      "is_school_event": true
    }
  ],
  "other_events": [
    {
      "title": "event title",
      "event_date": "YYYY-MM-DD",
      "description": "one sentence summary",
      "action_required": false,
      "school_name": null,
      "is_school_event": false
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
      "title": "child name — Week of [date as 'D Month YYYY', e.g. '5 May 2026']",
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
      max_tokens: 4096,
      messages: [{ role: 'user', content }]
    })

    const responseText = message.content[0].type === 'text' ? message.content[0].text : '{}'
    console.log('Claude response:', responseText)

    let cleanJson = responseText.replace(/```json\n?/g, '').replace(/```/g, '').trim()
    const jsonMatch = cleanJson.match(/\{[\s\S]*\}/)
    if (jsonMatch) cleanJson = jsonMatch[0]

    const result = JSON.parse(cleanJson)
    const events = result.events || []
    const otherEvents = result.other_events || []
    const notices = result.notices || []
    const learning = result.learning || []

    console.log(`Extracted: ${events.length} events, ${otherEvents.length} other events, ${notices.length} notices, ${learning.length} learning`)

    // Save school events
    for (const event of events) {
      await supabase.from('events').insert({
        user_id: user.id,
        title: event.title,
        event_date: event.event_date,
        description: event.description,
        action_required: event.action_required,
        source_email_subject: subject,
        school_name: event.school_name || null,
        is_school_event: true
      })
    }

    // Save other events
    for (const event of otherEvents) {
      await supabase.from('events').insert({
        user_id: user.id,
        title: event.title,
        event_date: event.event_date,
        description: event.description,
        action_required: false,
        source_email_subject: subject,
        school_name: null,
        is_school_event: false
      })
    }

    // Save notices and learning
    for (const notice of [...notices, ...learning]) {
      if (notice.category === 'learning' && notice.child_name) {
        const child = children?.find((c: any) => c.name === notice.child_name)
        if (child) {
          // Delete previous learning entry for this child
          await supabase
            .from('notices')
            .delete()
            .eq('user_id', user.id)
            .eq('child_id', child.id)
            .eq('category', 'learning')

          const expiresAt = new Date()
          expiresAt.setDate(expiresAt.getDate() + (notice.expires_in_days || 7))

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
        // Check for similar existing notice to avoid duplicates
        const todayStr = new Date().toISOString().split('T')[0]
        const { data: existingNotices } = await supabase
          .from('notices')
          .select('title')
          .eq('user_id', user.id)
          .eq('category', 'notice')
          .gte('expires_at', todayStr)

        // Simple duplicate check — if a notice with very similar title exists, skip
        const similarExists = existingNotices?.some((n: any) => {
          const existingWords = n.title.toLowerCase().split(' ')
          const newWords = notice.title.toLowerCase().split(' ')
          const commonWords = existingWords.filter((w: string) => newWords.includes(w) && w.length > 3)
          return commonWords.length >= 2
        })

        if (similarExists) {
          console.log('Skipping duplicate notice:', notice.title)
        } else {
          const expiresAt = new Date()
          expiresAt.setDate(expiresAt.getDate() + (notice.expires_in_days || 1))

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
    }

    console.log('✅ Done!')
    return new Response('ok', { status: 200 })

  } catch (err) {
    console.error('Error:', err)
    return new Response('ok', { status: 200 })
  }
}