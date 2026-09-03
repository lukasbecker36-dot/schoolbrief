import { supabase } from '@/lib/supabase'
import { Resend } from 'resend'

// A mailbox connection can die permanently -- a revoked grant, or a refresh
// token that simply expired -- and until now that failed in silence: the sync
// logged to console, returned early, and tried again every morning for two
// months without anyone noticing. One connection was dead from 6 July to 2
// September.
//
// Alerts go to the operator (ADMIN_EMAIL), not to the parent. While the Google
// OAuth app sits in "Testing" its refresh tokens expire after 7 days, so asking
// a parent to reconnect would buy them a week and then break again; that prompt
// belongs in the product only once the app is verified.
//
// Writes are best effort and never break a sync, and no-op until the columns
// exist, so this deploys safely ahead of the migration.
type ConnectionTable = 'gmail_connections' | 'outlook_connections'

const ALERT_INTERVAL_MS = 7 * 24 * 3600_000

async function patch(table: ConnectionTable, id: string, fields: Record<string, any>): Promise<boolean> {
  try {
    const { error } = await supabase.from(table).update(fields).eq('id', id)
    if (error) {
      // 42703 = column does not exist; the migration hasn't been run yet.
      if (error.code !== '42703') console.error(`${table} update failed:`, error.message)
      return false
    }
    return true
  } catch (err) {
    console.error(`${table} update threw:`, err)
    return false
  }
}

// Records why a connection could not be used, and alerts the operator at most
// once a week per connection so a permanent failure is noticed but a daily cron
// cannot turn into a daily email.
export async function recordConnectionFailure(
  table: ConnectionTable,
  connection: any,
  reason: string
) {
  const now = new Date()
  await patch(table, connection.id, {
    last_error: reason,
    last_error_at: now.toISOString()
  })

  const lastAlert = connection.alerted_at ? new Date(connection.alerted_at).getTime() : 0
  if (now.getTime() - lastAlert < ALERT_INTERVAL_MS) return

  const to = process.env.ADMIN_EMAIL
  if (!to) return

  const provider = table === 'gmail_connections' ? 'Gmail' : 'Outlook'
  const account = connection.google_email || connection.microsoft_email || connection.user_id
  const since = connection.last_synced_at || 'never'

  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    await resend.emails.send({
      from: 'SchoolBrief <digest@schoolbrief.uk>',
      to,
      subject: `⚠️ SchoolBrief: ${provider} connection failing for ${account}`,
      html: `
        <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #1a1a1a;">
          <h1 style="color: #2563eb; font-size: 20px;">A mailbox connection is failing</h1>
          <p><strong>${provider}</strong> · ${account}</p>
          <p style="color: #666;">Last successful sync: ${since}</p>
          <p style="background:#f5f5f5; padding:12px; border-radius:6px; color:#1a1a1a; font-size:14px;">${reason}</p>
          <p style="color: #666; font-size: 14px;">
            This account's school emails are not being collected. If the refresh token has expired or the
            grant was revoked, the parent has to reconnect from the manage page.
          </p>
          <p style="color: #999; font-size: 12px;">You'll get at most one of these per connection per week.</p>
        </div>
      `
    })
    await patch(table, connection.id, { alerted_at: now.toISOString() })
  } catch (err) {
    console.error('Failed to send connection failure alert:', err)
  }
}

// Clears the error once a connection works again, so a later failure alerts
// afresh rather than being suppressed by the old timestamp.
export async function clearConnectionError(table: ConnectionTable, connection: any) {
  if (!connection.last_error && !connection.alerted_at) return
  await patch(table, connection.id, {
    last_error: null,
    last_error_at: null,
    alerted_at: null
  })
}
