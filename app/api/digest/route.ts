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

  const fourteenDays = new Date(today)
  fourteenDays.setDate(today.getDate() + 14)
  const fourteenDaysStr = fourteenDays.toISOString().split('T')[0]

  let emailsSent = 0

  for (const user of users) {
    // Get all upcoming events for next 30 days
    const { data: allEvents } = await supabase
      .from('events')
      .select('*')
      .eq('user_id', user.id)
      .gte('event_date', todayStr)
      .lte('event_date', thirtyDaysStr)
      .order('event_date', { ascending: true })

    if (!allEvents || allEvents.length === 0) continue

    // Section 1: This week (next 7 days)
    const thisWeek = allEvents.filter(e => 
      e.event_date <= sevenDaysStr
    )

    // Section 2: Action needed soon (action_required, next 14 days, not already in this week)
    const actionsNeeded = allEvents.filter(e => 
      e.action_required && 
      e.event_date > sevenDaysStr && 
      e.event_date <= fourteenDaysStr
    )

    // Section 3: Looking ahead (8-30 days, non action items not in this week)
    const lookingAhead = allEvents.filter(e => 
      e.event_date > sevenDaysStr && 
      e.event_date <= thirtyDaysStr &&
      !actionsNeeded.includes(e)
    )

    const emailBody = formatDigest(thisWeek, actionsNeeded, lookingAhead)

    await resend.emails.send({
      from: 'SchoolBrief <digest@schoolbrief.uk>',
      to: user.email,
      subject: `📅 Your school week ahead — ${formatDate(today)}`,
      html: emailBody
    })

    emailsSent++
    console.log(`✅ Sent digest to ${user.email}`)
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

function renderEventGroup(events: any[]) {
  const grouped: { [key: string]: any[] } = {}
  for (const event of events) {
    if (!grouped[event.event_date]) {
      grouped[event.event_date] = []
    }
    grouped[event.event_date].push(event)
  }

  return Object.entries(grouped)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dayEvents]) => {
      const eventItems = dayEvents.map(e => `
        <tr>
          <td style="padding: 6px 0; border-bottom: 1px solid #f0f0f0;">
            <strong style="color: #1a1a1a;">${e.title}</strong>
            ${e.action_required ? '<span style="background:#fff3cd;color:#856404;font-size:11px;padding:2px 6px;border-radius:4px;margin-left:8px;">Action needed</span>' : ''}
            <br>
            <span style="color: #666; font-size: 14px;">${e.description}</span>
          </td>
        </tr>
      `).join('')

      return `
        <tr>
          <td style="padding: 16px 0 6px 0;">
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
      <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">
        <strong style="color: #2563eb; font-size: 13px;">${formatShortDate(e.event_date)}</strong>
        <strong style="color: #1a1a1a; margin-left: 8px;">${e.title}</strong>
        ${e.action_required ? '<span style="background:#fff3cd;color:#856404;font-size:11px;padding:2px 6px;border-radius:4px;margin-left:8px;">Action needed</span>' : ''}
        <br>
        <span style="color: #666; font-size: 14px;">${e.description}</span>
      </td>
    </tr>
  `).join('')
}

function formatDigest(thisWeek: any[], actionsNeeded: any[], lookingAhead: any[]) {
  const sectionStyle = `padding: 24px 0 8px 0; border-top: 1px solid #eee; margin-top: 16px;`
  const sectionHeading = (icon: string, title: string) => `
    <tr>
      <td style="${sectionStyle}">
        <h2 style="font-size: 14px; letter-spacing: 0.05em; text-transform: uppercase; color: #888; margin: 0;">${icon} ${title}</h2>
      </td>
    </tr>
  `

  let body = ''

  if (thisWeek.length > 0) {
    body += sectionHeading('📅', 'This week')
    body += renderEventGroup(thisWeek)
  }

  if (actionsNeeded.length > 0) {
    body += sectionHeading('⚠️', 'Action needed soon')
    body += renderListGroup(actionsNeeded)
  }

  if (lookingAhead.length > 0) {
    body += sectionHeading('🔭', 'Looking ahead')
    body += renderListGroup(lookingAhead)
  }

  if (!body) {
    body = `<tr><td style="padding: 24px 0;"><p style="color: #666;">No upcoming events this week. Enjoy the quiet!</p></td></tr>`
  }

  return `
    <!DOCTYPE html>
    <html>
    <body style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #1a1a1a;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="border-bottom: 3px solid #2563eb; padding-bottom: 16px;">
            <h1 style="margin: 0; font-size: 24px; color: #2563eb;">SchoolBrief</h1>
            <p style="margin: 4px 0 0 0; color: #666; font-size: 14px;">Your week ahead at school</p>
          </td>
        </tr>
        ${body}
        <tr>
          <td style="padding-top: 32px; border-top: 1px solid #eee; color: #999; font-size: 12px;">
            You're receiving this because you signed up at schoolbrief.uk
          </td>
        </tr>
      </table>
    </body>
    </html>
  `
}