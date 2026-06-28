import { supabase } from '@/lib/supabase'
import Anthropic from '@anthropic-ai/sdk'

type ExtractInput = {
  user: any
  subject: string
  emailText: string
  emailHtml?: string
  pdfBuffers?: Buffer[]
  endpoint: string // for token usage tracking, e.g. 'webhooks/email' or 'gmail/sync'
}

// Shared extraction pipeline: given the text/PDFs of a single school email,
// asks Claude to classify it and saves events/notices/learning for the user.
// Used by both the SendGrid webhook and the Gmail sync job.
export async function extractAndSave({
  user,
  subject,
  emailText,
  emailHtml = '',
  pdfBuffers = [],
  endpoint
}: ExtractInput) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

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

  const childrenContext = children && children.length > 0
    ? `The parent has the following children:\n${children.map((c: any) => `- ${c.name} (${c.year_level}${c.school_name ? `, ${c.school_name}` : ''})`).join('\n')}`
    : 'No children registered — include all events.'

  // Build the content array for Claude — PDFs first (Claude recommends docs
  // before text), then any PDFs linked in the body, then the text prompt.
  const content: any[] = []

  for (const pdf of pdfBuffers) {
    content.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64') }
    })
  }

  // Extract PDF URLs from the body and fetch them (handles ParentMail's
  // tokenised PDF links rather than real attachments).
  const pdfUrlMatches = (emailText + emailHtml).match(/https?:\/\/[^\s"<>]+\.pdf[^\s"<>]*/gi) || []
  const uniquePdfUrls = [...new Set(pdfUrlMatches)]
  for (const url of uniquePdfUrls) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        const buffer = await response.arrayBuffer()
        content.push({
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: Buffer.from(buffer).toString('base64')
          }
        })
      }
    } catch (err) {
      console.error('Failed to fetch PDF from URL:', url, err)
    }
  }

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
- If an event already exists in the EXISTING EVENTS list (matching by approximate title and exact date), DO NOT create a new entry — even if the new email contains more detail. Instead, simply omit it from your response and the existing entry will remain. The only exception is if the event has been cancelled, moved to a different date, or fundamentally changed in nature (in which case extract it and note the change clearly in the description).
- Matching: titles are considered the same if they share the core event name (e.g. "Sports Day" matches "Year 2 Sports Day" matches "Sam — Year 2 Sports Day" — all on the same date). Don't be deceived by different child prefixes or extra descriptive words.
- is_school_event: true

CATEGORY 2 — NOTICES (short-term announcements from the school, no specific future date)
Examples: staffing changes, policy updates, road safety reminders, general school news
Rules:
- ONLY include notices from the school itself — not third-party advertisements or community notices
- These are one-off announcements relevant today but not ongoing
- Include school name in title
- Also include as a notice any event happening TODAY or TOMORROW that is too soon to add to the calendar meaningfully — these should be captured as notices so parents see them immediately.
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

  const { error: tokenError } = await supabase.from('token_usage').insert({
    user_id: user.id,
    endpoint,
    input_tokens: message.usage.input_tokens,
    output_tokens: message.usage.output_tokens,
    model: 'claude-sonnet-4-6'
  })
  if (tokenError) console.error('Token usage insert failed:', tokenError)

  const responseText = message.content[0].type === 'text' ? message.content[0].text : '{}'

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
      const { data: existingNotices } = await supabase
        .from('notices')
        .select('title')
        .eq('user_id', user.id)
        .eq('category', 'notice')
        .gte('expires_at', todayStr)

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
}
