import { supabase } from '@/lib/supabase'
import { Resend } from 'resend'

export async function GET(req: Request) {
  // Verify this is called from Vercel Cron
  const resend = new Resend(process.env.RESEND_API_KEY)
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  // Get all users
  const { data: users } = await supabase
    .from('users')
    .select('*')

  if (!users || users.length === 0) {
    return Response.json({ message: 'No users found' })
  }

  const today = new Date()
  const sevenDaysFromNow = new Date(today)
  sevenDaysFromNow.setDate(today.getDate() + 7)

  const todayStr = today.toISOString().split('T')[0]
  const sevenDaysStr = sevenDaysFromNow.toISOString().split('T')[0]

  let emailsSent = 0

  for (const user of users) {
    // Get their upcoming events
    const { data: events } = await supabase
      .from('events')
      .select('*')
      .eq('user_id', user.id)
      .gte('event_date', todayStr)
      .lte('event_date', sevenDaysStr)
      .order('event_date', { ascending: true })

    if (!events || events.length === 0) continue

    // Format the email body
    const emailBody = formatDigest(events)

    // Send the email
    await resend.emails.send({
      from: 'SchoolBrief <digest@schoolbrief.uk>',
      to: user.email,
      subject: `📅 Your school week ahead — ${formatDate(today)}`,
      html: emailBody
    })

    emailsSent++
    console.log(`✅ Sent digest to ${user.email} with ${events.length} events`)
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

function formatDigest(events: any[]) {
  // Group events by date
  const grouped: { [key: string]: any[] } = {}
  for (const event of events) {
    if (!grouped[event.event_date]) {
      grouped[event.event_date] = []
    }
    grouped[event.event_date].push(event)
  }

  const rows = Object.entries(grouped)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dayEvents]) => {
      const eventItems = dayEvents.map(e => `
        <tr>
          <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">
            <strong style="color: #1a1a1a;">${e.title}</strong>
            ${e.action_required ? '<span style="background:#fff3cd;color:#856404;font-size:11px;padding:2px 6px;border-radius:4px;margin-left:8px;">Action needed</span>' : ''}
            <br>
            <span style="color: #666; font-size: 14px;">${e.description}</span>
          </td>
        </tr>
      `).join('')

      return `
        <tr>
          <td style="padding: 20px 0 8px 0;">
            <strong style="font-size: 16px; color: #2563eb;">${formatEventDate(date)}</strong>
          </td>
        </tr>
        ${eventItems}
      `
    }).join('')

  return `
    <!DOCTYPE html>
    <html>
    <body style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #1a1a1a;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="border-bottom: 3px solid #2563eb; padding-bottom: 16px; margin-bottom: 24px;">
            <h1 style="margin: 0; font-size: 24px; color: #2563eb;">SchoolBrief</h1>
            <p style="margin: 4px 0 0 0; color: #666; font-size: 14px;">Your week ahead at school</p>
          </td>
        </tr>
        ${rows}
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