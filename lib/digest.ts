import { supabase } from '@/lib/supabase'
import { Resend } from 'resend'
import { noticeRestatesEvent } from '@/lib/text'

function extractTimes(text: string) {
  const matches = (text || '').match(/\b\d{1,2}[:.]\d{2}\s*(?:am|pm)?\b|\b\d{1,2}\s*(?:am|pm)\b/gi) || []
  return [...new Set(matches.map(t => t.toLowerCase().replace(/\s+/g, '').replace(':', '.')))]
}

export function formatDate(date: Date) {
  return date.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  })
}

function formatEventDate(dateStr: string) {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  })
}

function formatShortDate(dateStr: string) {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short'
  })
}

function sectionHeading(icon: string, title: string) {
  return `
    <tr>
      <td style="padding: 24px 0 8px 0; border-top: 1px solid #eee;">
        <h2 style="font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; color: #888; margin: 0;">${icon} ${title}</h2>
      </td>
    </tr>
  `
}

function renderEventGroup(events: any[]) {
  const grouped: { [key: string]: any[] } = {}
  for (const event of events) {
    if (!grouped[event.event_date]) grouped[event.event_date] = []
    grouped[event.event_date].push(event)
  }

  return Object.entries(grouped)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dayEvents]) => {
      const eventItems = dayEvents.map(e => `
        <tr>
          <td style="padding: 6px 0; border-bottom: 1px solid #f5f5f5;">
            <strong style="color: #1a1a1a;">${e.title}</strong>
            ${e.action_required ? '<span style="background:#fff3cd;color:#856404;font-size:11px;padding:2px 6px;border-radius:4px;margin-left:8px;">Action needed</span>' : ''}
            <br>
            <span style="color: #666; font-size: 14px;">${e.description}</span>
            ${e.conflictNote ? `<br><span style="color: #b45309; font-size: 13px;">⚠️ ${e.conflictNote}</span>` : ''}
            ${e.moreDetail ? `<br><span style="color: #888; font-size: 13px;">See the school's original email for the full details.</span>` : ''}
          </td>
        </tr>
      `).join('')

      return `
        <tr>
          <td style="padding: 14px 0 4px 0;">
            <strong style="font-size: 15px; color: #2563eb;">${formatEventDate(date)}</strong>
          </td>
        </tr>
        ${eventItems}
      `
    }).join('')
}

function renderListGroup(events: any[]) {
  return events.map(e => `
    <tr>
      <td style="padding: 8px 0; border-bottom: 1px solid #f5f5f5;">
        <strong style="color: #2563eb; font-size: 13px;">${formatShortDate(e.event_date)}</strong>
        <strong style="color: #1a1a1a; margin-left: 8px;">${e.title}</strong>
        ${e.action_required ? '<span style="background:#fff3cd;color:#856404;font-size:11px;padding:2px 6px;border-radius:4px;margin-left:8px;">Action needed</span>' : ''}
        <br>
        <span style="color: #666; font-size: 14px;">${e.description}</span>
        ${e.moreDetail ? `<br><span style="color: #888; font-size: 13px;">See the school's original email for the full details.</span>` : ''}
      </td>
    </tr>
  `).join('')
}

function renderOtherEventsCompact(events: any[]) {
  return events.map(e => `
    <tr>
      <td style="padding: 4px 0; border-bottom: 1px solid #f5f5f5;">
        <strong style="color: #2563eb; font-size: 12px;">${formatShortDate(e.event_date)}</strong>
        <span style="color: #1a1a1a; margin-left: 8px; font-size: 13px;">${e.title}</span>
      </td>
    </tr>
  `).join('')
}

function renderNotices(notices: any[]) {
  return notices.map(n => `
    <tr>
      <td style="padding: 8px 0; border-bottom: 1px solid #f5f5f5;">
        <strong style="color: #1a1a1a;">${n.title}</strong><br>
        <span style="color: #666; font-size: 14px;">${n.content}</span>
      </td>
    </tr>
  `).join('')
}

function renderLearning(learning: any[]) {
  return learning.map(n => `
    <tr>
      <td style="padding: 8px 0; border-bottom: 1px solid #f5f5f5;">
        <strong style="color: #1a1a1a;">${n.title}</strong><br>
        <span style="color: #666; font-size: 14px;">${n.content}</span>
      </td>
    </tr>
  `).join('')
}

function formatDigest(
  thisWeek: any[],
  lookingAhead: any[],
  notices: any[],
  learning: any[],
  otherEvents: any[]
) {
  let body = ''

  if (notices.length > 0) {
    body += sectionHeading('📌', 'Notices')
    body += renderNotices(notices)
  }

  if (thisWeek.length > 0) {
    body += sectionHeading('📅', 'This week')
    body += renderEventGroup(thisWeek)
  }

  if (learning.length > 0) {
    body += sectionHeading('📚', 'This week\'s learning')
    body += renderLearning(learning)
  }

  if (lookingAhead.length > 0) {
    body += sectionHeading('🔭', 'Looking ahead')
    body += renderListGroup(lookingAhead)
  }

  if (otherEvents.length > 0) {
    body += sectionHeading('🎉', 'Other events & activities')
    body += renderOtherEventsCompact(otherEvents)
  }

  if (!body) {
    body = `<tr><td style="padding: 24px 0;"><p style="color: #666;">No school news today. Enjoy the quiet!</p></td></tr>`
  }

  return `
    <!DOCTYPE html>
    <html>
    <body style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #1a1a1a;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="border-bottom: 3px solid #2563eb; padding-bottom: 16px;">
            <h1 style="margin: 0; font-size: 24px; color: #2563eb;">SchoolBrief</h1>
            <p style="margin: 4px 0 0 0; color: #666; font-size: 14px;">Your daily school summary</p>
          </td>
        </tr>
        ${body}
        <tr>
          <td style="padding-top: 32px; border-top: 1px solid #eee; color: #999; font-size: 12px;">
            You're receiving this because you signed up at schoolbrief.uk · <a href="https://schoolbrief.uk/manage" style="color: #999;">Manage your account</a>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `
}

// Build the digest HTML for a single user. Returns the html and whether it
// contained any real content (used by the cron to skip empty digests).
export async function buildDigestForUser(
  user: any
): Promise<{ html: string; hasContent: boolean; shownNoticeIds: string[] }> {
  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]

  const sevenDays = new Date(today)
  sevenDays.setDate(today.getDate() + 7)
  const sevenDaysStr = sevenDays.toISOString().split('T')[0]

  const thirtyDays = new Date(today)
  thirtyDays.setDate(today.getDate() + 30)
  const thirtyDaysStr = thirtyDays.toISOString().split('T')[0]

  const { data: allEvents } = await supabase
    .from('events')
    .select('*')
    .eq('user_id', user.id)
    .gte('event_date', todayStr)
    .lte('event_date', thirtyDaysStr)
    .order('event_date', { ascending: true })

  const { data: allNotices, error: noticesError } = await supabase
    .from('notices')
    .select('*')
    .eq('user_id', user.id)
    .gte('expires_at', todayStr)
    .order('category', { ascending: true })
    .order('created_at', { ascending: false })

  if (noticesError) console.error('Digest notices query failed:', noticesError)

  const schoolEvents = (allEvents || []).filter(e => e.is_school_event !== false)
  const otherEvents = (allEvents || []).filter(e => e.is_school_event === false)

  const thisWeek = schoolEvents.filter(e => e.event_date <= sevenDaysStr)
  const lookingAhead = schoolEvents.filter(e =>
    e.event_date > sevenDaysStr &&
    e.event_date <= thirtyDaysStr
  )
  const otherUpcoming = otherEvents.filter(e => e.event_date <= thirtyDaysStr)

  // Drop day-specific notices whose day has already passed (e.g. a "for today
  // only" arrangement that arrived too late for that day's digest). Done in JS
  // so the query never depends on the event_date column existing/being set —
  // notices with no event_date are always kept.
  const activeNotices = (allNotices || []).filter(
    (n: any) => !n.event_date || n.event_date >= todayStr
  )

  const learning = activeNotices.filter(n => n.category === 'learning')
  const allCurrentNotices = activeNotices.filter(n => n.category === 'notice')

  // A dated notice -- a deadline, a consent form -- stays live until its date,
  // which can be weeks away: the Light Up Hassocks poster competition arrived on
  // 14 September for a 3 November deadline, and appeared in every morning's
  // digest in between. So a dated notice is shown when it's new, then again in
  // the final week before its date, and not in between. Undated notices already
  // last a single day and are unaffected.
  //
  // "New" means not yet sent, recorded in first_shown_at when a digest actually
  // goes out -- guessing from created_at would double up or drop a notice
  // whenever the cron ran late. Until that column exists, fall back to the
  // guess.
  const hasShownColumn = (allNotices || []).some(n => 'first_shown_at' in n)
  const dayAgo = Date.now() - 24 * 3600_000
  const isNew = (n: { first_shown_at?: string | null; created_at: string }) =>
    hasShownColumn
      ? !n.first_shown_at || String(n.first_shown_at).slice(0, 10) === todayStr
      : new Date(n.created_at).getTime() >= dayAgo
  const rawNotices = allCurrentNotices.filter(n =>
    !n.event_date || isNew(n) || n.event_date <= sevenDaysStr
  )

  // Dedupe notices that duplicate a This Week event. If the notice mentions a
  // time the calendar event doesn't, flag a possible change on the event rather
  // than showing two contradictory entries.
  // Every school name this user's own rows mention, so the shared comparison
  // can discount them. Without this a notice was hidden whenever it shared the
  // school prefix and any one generic word with an unrelated event: a clubs
  // sign-up deadline disappeared because a Bikeability event also said
  // "deadline".
  const schoolNames = [
    ...(allEvents || []).map((e: any) => e.school_name),
    ...(allNotices || []).map((n: any) => n.school_name)
  ].filter(Boolean)

  // Compare against everything the digest will show, not just this week --
  // the PGL consent notice restates a trip that sits in Looking ahead.
  const upcoming = [...thisWeek, ...lookingAhead]

  const notices = rawNotices.filter(notice => {
    const match = upcoming.find(e =>
      noticeRestatesEvent(notice.title, notice.event_date || null, e.title, e.event_date, schoolNames)
    )
    if (!match) return true

    // The notice we are dropping often carried far more than the event's one
    // line -- the Bikeability notice ran 632 characters against the event's
    // 126, with the kit list, the 1:2 on-road ratio and the SEND contact. Point
    // the parent at the source rather than losing that silently. Only when the
    // notice is genuinely fuller, not merely a longer way of saying the same.
    const noticeLength = (notice.content || '').length
    const eventLength = (match.description || '').length
    if (noticeLength > eventLength * 1.5 && noticeLength - eventLength >= 150) {
      match.moreDetail = true
    }

    const eventTimes = extractTimes(`${match.title} ${match.description}`)
    const noticeTimes = extractTimes(`${notice.title} ${notice.content}`)
    const newTimes = noticeTimes.filter(t => !eventTimes.includes(t))
    if (eventTimes.length > 0 && newTimes.length > 0) {
      match.conflictNote = 'A more recent email may have changed the time for this event — please check the original school email to confirm.'
    }
    return false
  })

  const hasContent =
    thisWeek.length > 0 ||
    lookingAhead.length > 0 ||
    notices.length > 0 ||
    learning.length > 0 ||
    otherUpcoming.length > 0

  const html = formatDigest(thisWeek, lookingAhead, notices, learning, otherUpcoming)
  return { html, hasContent, shownNoticeIds: notices.map(n => n.id) }
}

// Build and send the digest to a single user. When `force` is true the digest
// is sent even if there's no content (used by the onboarding "see it now"
// button); the cron leaves it false so empty digests are skipped.
export async function sendDigestForUser(user: any, force = false): Promise<boolean> {
  const { html, hasContent, shownNoticeIds } = await buildDigestForUser(user)
  if (!hasContent && !force) return false

  const resend = new Resend(process.env.RESEND_API_KEY)
  const recipients = [user.email]
  if (user.secondary_email) recipients.push(user.secondary_email)

  const sent = await resend.emails.send({
    from: 'SchoolBrief <digest@schoolbrief.uk>',
    to: recipients,
    subject: `📅 Your school week ahead — ${formatDate(new Date())}`,
    html
  })
  if (sent.error) {
    console.error('Digest send failed for', user.email, sent.error)
    return false
  }

  // Record each notice's first appearance, so a dated one isn't repeated every
  // morning until its date. Only after a real send -- previews don't count.
  // Best effort: a missed stamp costs one extra appearance, and this no-ops
  // until the column exists.
  if (shownNoticeIds.length > 0) {
    const { error } = await supabase
      .from('notices')
      .update({ first_shown_at: new Date().toISOString() })
      .in('id', shownNoticeIds)
      .is('first_shown_at', null)
    if (error && error.code !== '42703') console.error('Failed to stamp shown notices:', error.message)
  }
  return true
}
