import { supabase } from '@/lib/supabase'
import Anthropic from '@anthropic-ai/sdk'
import mammoth from 'mammoth'
import { noticesAreSimilar, isUmbrellaSummary } from '@/lib/text'
import { matchesAChildsYearGroup } from '@/lib/yeargroups'

// A start-of-term newsletter can carry dozens of events; at 4096 the reply was
// cut off mid-JSON, the parse threw, and the email was marked processed with
// nothing saved. Headroom is free — we're billed on tokens generated, not on
// the ceiling.
const MAX_OUTPUT_TOKENS = 16000

// Both sync jobs run as serverless functions with maxDuration = 60. Stop
// starting new extractions this far into a run so it can return a report
// instead of being killed mid-message; whatever is left drains next run.
export const SYNC_TIME_BUDGET_MS = 45_000

// SSRF guard for the attacker-controlled PDF URLs found in inbound emails.
// Allow only https to a public hostname — reject IP literals and internal names
// so a crafted email can't make the server fetch cloud metadata or intranet
// hosts. Redirects are disabled at the fetch call so a public URL can't bounce
// to an internal one.
function isFetchablePdfUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false

  const host = url.hostname.toLowerCase()

  // Block obvious internal names.
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return false
  }

  // Block IPv6 literals outright (rare for legit PDF hosts).
  if (host.includes(':')) return false

  // Block IPv4 literals in private / loopback / link-local / CGNAT ranges.
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    if (a === 10) return false
    if (a === 127) return false
    if (a === 0) return false
    if (a === 169 && b === 254) return false // link-local incl. 169.254.169.254 metadata
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 168) return false
    if (a === 100 && b >= 64 && b <= 127) return false // CGNAT
    // any other bare IPv4 literal is allowed but suspicious; keep it simple and allow public ones
  }

  return true
}

type ExtractInput = {
  user: any
  subject: string
  emailText: string
  emailHtml?: string
  pdfBuffers?: Buffer[]
  docxBuffers?: Buffer[]
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
  docxBuffers = [],
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
  // tokenised PDF links rather than real attachments). Capped and SSRF-guarded:
  // these URLs are attacker-controlled (they come from an inbound email), so we
  // only fetch public https hosts, never internal/loopback/metadata addresses.
  const pdfUrlMatches = (emailText + emailHtml).match(/https?:\/\/[^\s"<>]+\.pdf[^\s"<>]*/gi) || []
  const uniquePdfUrls = [...new Set(pdfUrlMatches)].filter(isFetchablePdfUrl).slice(0, 10)
  for (const url of uniquePdfUrls) {
    try {
      // Bounded fetch — a slow or dead PDF link must never hang the request.
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 10_000)
      const response = await fetch(url, { signal: controller.signal, redirect: 'error' })
      clearTimeout(timer)
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

  // Claude accepts PDFs as documents but not Word files, so pull the text out
  // and append it to the body. School letters are routinely .docx -- the
  // Bikeability parent letter carrying the course dates was one, and its
  // contents were being dropped on the floor.
  let attachmentText = ''
  for (const docx of docxBuffers) {
    try {
      const { value } = await mammoth.extractRawText({ buffer: docx })
      const text = (value || '').trim()
      if (text) attachmentText += `\n\n--- Attached Word document ---\n${text}`
    } catch (err) {
      console.error('Failed to read .docx attachment:', err)
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
- RECURRING WEEKLY ACTIVITIES ARE NOT EVENTS: an extra-curricular clubs list, timetable or termly schedule (e.g. "Autumn Term clubs", "clubs list") must NOT become one event per club. A club runs every week for the whole term, so pinning it to a single date is misleading and floods the digest with dozens of entries. Omit every club from events. DO extract the sign-up deadline itself as a single event, dated the day the forms close, with action_required true -- a deadline is a dated calendar item and belongs here, unlike the clubs themselves. Capture the detail of the list as one notice as well (see CATEGORY 2).
- The test is repetition, not who runs it: a one-off session on a named date IS an event; anything described as weekly or termly ("Mondays after school", "every Tuesday", "Fridays 3-3.50pm") is NOT.
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

CATEGORY 2 — NOTICES (announcements to act on today or tomorrow, or with no date at all)
Examples: staffing changes, policy updates, road safety reminders, general school news
Rules:
- ONLY include notices from the school itself — not third-party advertisements or community notices
- These are one-off announcements relevant today but not ongoing
- Do NOT produce a catch-all notice summarising the email as a whole (e.g. "General Newsletter — 11th September") when its contents are already being extracted as individual notices and events. Extract the individual items; the summary duplicates them and adds nothing. Only summarise the email as one notice if it contains nothing that stands alone.
- A clubs list or timetable email becomes a SINGLE notice: say that the term's schedule is out, how to sign up, and above all the deadline. Do NOT list the individual clubs. Leave its event_date null; the sign-up deadline is extracted as an event (see CATEGORY 1), which is what keeps it in the digest until the day it matters.
- Include school name in title
- A notice is for something to act on TODAY or TOMORROW ("bring a packed lunch tomorrow, no hot meals", "PE kit needed in the morning", "front gate closed today"), or for news with no date at all (staffing changes, policy updates). Set event_date to that day in YYYY-MM-DD format when it is today or tomorrow, otherwise null.
- ANYTHING DATED FURTHER AHEAD THAN TOMORROW IS AN EVENT, NOT A NOTICE. A consent deadline three weeks away, a competition closing next month, a trip in October: extract those as CATEGORY 1 events with action_required set, and do NOT also write a notice for them. The digest carries events until the day they happen, moving them from Looking ahead into This week as they approach; a notice would simply repeat underneath every morning in the meantime.
- Because a notice is only ever about today or tomorrow, put everything the parent needs to act on into its content -- what to bring, by when, who to contact.
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
      "event_date": "YYYY-MM-DD or null",
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
Email body: ${emailText}${attachmentText}`
  })

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: MAX_OUTPUT_TOKENS,
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

  if (message.stop_reason === 'max_tokens') {
    throw new Error(
      `Extraction hit the ${MAX_OUTPUT_TOKENS}-token output limit — nothing saved for "${subject}"`
    )
  }

  const responseText = message.content[0].type === 'text' ? message.content[0].text : '{}'

  let cleanJson = responseText.replace(/```json\n?/g, '').replace(/```/g, '').trim()
  const jsonMatch = cleanJson.match(/\{[\s\S]*\}/)
  if (jsonMatch) cleanJson = jsonMatch[0]

  let result: any
  try {
    result = JSON.parse(cleanJson)
  } catch {
    throw new Error(`Extraction returned unparseable JSON — nothing saved for "${subject}"`)
  }
  // The prompt's year-group rule is not reliably obeyed -- a newsletter
  // produced "Sam - Y4 Parent Information Session" whose own description said
  // "Sam is in Y3 so this is not directly relevant" -- so check the output
  // rather than trusting it. Biased towards keeping: only an item that names
  // year groups, none of which belong to a child at that school, is dropped.
  const droppedForYearGroup: string[] = []
  const rightYearGroup = (item: any) => {
    if (matchesAChildsYearGroup(item?.title || '', item?.description, item?.school_name, children || [])) return true
    droppedForYearGroup.push(String(item?.title || '(untitled)'))
    return false
  }

  const events = (result.events || []).filter(rightYearGroup)
  const otherEvents = (result.other_events || []).filter(rightYearGroup)
  if (droppedForYearGroup.length > 0) {
    console.log(
      `Dropped ${droppedForYearGroup.length} item(s) for a year group no child is in: ` +
      droppedForYearGroup.join(' | ')
    )
  }
  const rawNotices = result.notices || []
  const learning = result.learning || []

  // Drop a notice that merely labels the email ("General Newsletter -- 11th
  // September") when its contents have already been extracted as their own
  // notices and events. If it is the only thing we got, keep it: better a
  // summary than nothing.
  const umbrellaSchoolNames = [
    ...(children || []).map((c: any) => c.school_name),
    ...rawNotices.map((n: any) => n.school_name)
  ].filter(Boolean)
  const specificNotices = rawNotices.filter((n: any) => !isUmbrellaSummary(n?.title || '', umbrellaSchoolNames))
  const droppedUmbrella = rawNotices.length - specificNotices.length
  const haveSomethingElse =
    events.length + otherEvents.length + specificNotices.length + learning.length > 0
  const notices = haveSomethingElse ? specificNotices : rawNotices
  if (droppedUmbrella > 0 && haveSomethingElse) {
    console.log(`Dropped ${droppedUmbrella} umbrella newsletter notice(s) already covered by individual items`)
  }

  console.log(`Extracted: ${events.length} events, ${otherEvents.length} other events, ${notices.length} notices, ${learning.length} learning`)

  // The same email can be forwarded more than once, and three copies arriving
  // within four minutes each read the existing-events list before the others had
  // written to it -- so the prompt-level dedupe saw nothing and the digest showed
  // the same event twice. Check at the point of insert instead, against the same
  // date only, so distinct events never collapse into each other.
  const schoolNamesForDedupe = [
    ...(children || []).map((c: any) => c.school_name)
  ].filter(Boolean)

  const alreadySaved = async (event: any) => {
    if (!event?.event_date) return false
    const { data: sameDay } = await supabase
      .from('events')
      .select('title')
      .eq('user_id', user.id)
      .eq('event_date', event.event_date)
    const clash = (sameDay || []).find((e: any) =>
      noticesAreSimilar(e.title, event.title, [...schoolNamesForDedupe, event.school_name].filter(Boolean))
    )
    if (clash) console.log(`Skipping duplicate event: ${event.title} (matches "${clash.title}")`)
    return !!clash
  }

  // Save school events
  for (const event of events) {
    if (await alreadySaved(event)) continue
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
    if (await alreadySaved(event)) continue
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

      const schoolNames = [
        notice.school_name,
        ...(children || []).map((c: any) => c.school_name)
      ].filter(Boolean)

      const similarExists = existingNotices?.some((n: any) =>
        noticesAreSimilar(n.title, notice.title, schoolNames)
      )

      if (similarExists) {
        console.log('Skipping duplicate notice:', notice.title)
      } else {
        let eventDate = notice.event_date && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(notice.event_date)
          ? notice.event_date
          : null

        // A notice is for today or tomorrow. A date further out belongs on an
        // event, which the digest carries until the day itself; left on a
        // notice it kept the notice alive -- and therefore printed -- every
        // morning until then. A poster competition dated seven weeks out ran in
        // fifty consecutive digests. Drop the date rather than the notice, so it
        // shows once and expires normally.
        const tomorrow = new Date()
        tomorrow.setDate(tomorrow.getDate() + 1)
        const tomorrowStr = tomorrow.toISOString().split('T')[0]
        if (eventDate && eventDate > tomorrowStr) {
          console.log(`Notice dated beyond tomorrow (${eventDate}); dropping the date: ${notice.title}`)
          eventDate = null
        }

        // A notice about a specific future day has to outlive the default one
        // day, or it drops out of the digest long before the thing it warns
        // about: a clubs sign-up closing on the 9th expired on the 2nd. Keep
        // it alive until the day it refers to.
        const expiresAt = new Date()
        expiresAt.setDate(expiresAt.getDate() + (notice.expires_in_days || 1))
        let expiresAtStr = expiresAt.toISOString().split('T')[0]
        if (eventDate && eventDate > expiresAtStr) expiresAtStr = eventDate

        const { error: noticeInsertError } = await supabase.from('notices').insert({
          user_id: user.id,
          school_name: notice.school_name || null,
          category: notice.category,
          title: notice.title,
          content: notice.content,
          event_date: eventDate,
          expires_at: expiresAtStr
        })
        if (noticeInsertError) console.error('Notice insert failed:', noticeInsertError)
      }
    }
  }
}

// Marks a synced message as handled. A failed extraction is recorded with its
// error rather than as a clean row, so it can be found and replayed (delete the
// row, re-run the sync) instead of vanishing. Falls back to a bare insert while
// the subject/error columns don't exist yet, so this can deploy before the
// migration runs.
export async function recordProcessedMessage(
  table: 'gmail_processed_messages' | 'outlook_processed_messages',
  userId: string,
  messageId: string,
  subject: string,
  extractionError?: string
) {
  const { error } = await supabase.from(table).insert({
    user_id: userId,
    message_id: messageId,
    subject: subject || null,
    error: extractionError || null
  })
  if (!error) return

  if (error.code === '42703') {
    const { error: fallbackError } = await supabase
      .from(table)
      .insert({ user_id: userId, message_id: messageId })
    if (fallbackError) console.error(`Failed to record processed message in ${table}:`, fallbackError)
    return
  }
  console.error(`Failed to record processed message in ${table}:`, error)
}
