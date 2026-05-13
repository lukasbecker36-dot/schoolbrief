import { supabase } from '@/lib/supabase'
import { Resend } from 'resend'

export async function GET(req: Request) {
  const resend = new Resend(process.env.RESEND_API_KEY)

  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const { data: users } = await supabase
    .from('users')
    .select('*')

  if (!users || users.length === 0) {
    return Response.json({ message: 'No users found' })
  }

  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]

  const sevenDays = new Date(today)
  sevenDays.setDate(today.getDate() + 7)
  const sevenDaysStr = sevenDays.toISOString().split('T')[0]

  const thirtyDays = new Date(today)
  thirtyDays.setDate(today.getDate() + 30)
  const thirtyDaysStr = thirtyDays.toISOString().split('T')[0]

  let emailsSent = 0

  for (const user of users) {
    // Get all upcoming events
    const { data: allEvents } = await supabase
      .from('events')
      .select('*')
      .eq('user_id', user.id)
      .gte('event_date', todayStr)
      .lte('event_date', thirtyDaysStr)
      .order('event_date', { ascending: true })

    // Get active notices and learning
    const { data: allNotices } = await supabase
      .from('notices')
      .select('*')
      .eq('user_id', user.id)
      .gte('expires_at', todayStr)
      .order('category', { ascending: true })
      .order('created_at', { ascending: false })

    const hasContent = (allEvents && allEvents.length > 0) || 
                       (allNotices && allNotices.length > 0)
    if (!hasContent) continue

    // Split events into sections
    const schoolEvents = (allEvents || []).filter(e => e.is_school_event !== false)
    const otherEvents = (allEvents || []).filter(e => e.is_school_event === false)

    const thisWeek = schoolEvents.filter(e => e.event_date <= sevenDaysStr)
    const lookingAhead = schoolEvents.filter(e =>
      e.event_date > sevenDaysStr &&
      e.event_date <= thirtyDaysStr
    )
    const otherUpcoming = otherEvents.filter(e => e.event_date <= thirtyDaysStr)

    // Split notices into types
    const notices = (allNotices || []).filter(n => n.category === 'notice')
    const learning = (allNotices || []).filter(n => n.category === 'learning')

    const emailBody = formatDigest(thisWeek, lookingAhead, notices, learning, otherUpcoming)

    const recipients = [user.email]
    if (user.secondary_email) recipients.push(user.secondary_email)

    await resend.emails.send({
      from: 'SchoolBrief <digest@schoolbrief.uk>',
      to: recipients,
      subject: `📅 Your school week ahead — ${formatDate(today)}`,
      html: emailBody
    })

    emailsSent++
    console.log(`✅ Sent digest to ${recipients.join(', ')}`)
  }

  return Response.json({ message: `Sent ${emailsSent} digests` })
}

function formatDate(date: Date) {
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
    body += renderListGroup(otherEvents)
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