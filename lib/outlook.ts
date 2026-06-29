import { supabase } from '@/lib/supabase'
import { encrypt, decrypt } from '@/lib/crypto'
import { extractAndSave } from '@/lib/extract'

const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
export const OUTLOOK_SCOPE = 'offline_access Mail.Read User.Read'

// Returns a valid Graph access token, refreshing if the cached one expired.
// Microsoft rotates refresh tokens, so we store a new one when returned.
async function getAccessToken(connection: any): Promise<string | null> {
  const now = Date.now()
  const expiresAt = connection.access_token_expires_at
    ? new Date(connection.access_token_expires_at).getTime()
    : 0

  if (connection.access_token && expiresAt > now + 60_000) {
    return decrypt(connection.access_token)
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID || '',
      client_secret: process.env.MICROSOFT_CLIENT_SECRET || '',
      refresh_token: decrypt(connection.refresh_token),
      grant_type: 'refresh_token',
      scope: OUTLOOK_SCOPE
    })
  })
  const tokens = await res.json()
  if (!tokens.access_token) {
    console.error('Failed to refresh Outlook token', tokens)
    return null
  }

  const update: any = {
    access_token: encrypt(tokens.access_token),
    access_token_expires_at: new Date(now + (tokens.expires_in || 3600) * 1000).toISOString()
  }
  if (tokens.refresh_token) update.refresh_token = encrypt(tokens.refresh_token)
  await supabase.from('outlook_connections').update(update).eq('id', connection.id)

  return tokens.access_token
}

function senderMatches(fromAddr: string, domains: string[]) {
  const addr = fromAddr.toLowerCase()
  return domains.some(d => addr === d || addr.endsWith('@' + d) || addr.endsWith('.' + d))
}

// Syncs new school emails from one Outlook connection via Microsoft Graph.
// Capped per run to stay within serverless time limits.
export async function syncOutlookConnection(connection: any, limit = 10): Promise<{ processed: number; error?: string }> {
  const domains: string[] = connection.school_domains || []
  if (domains.length === 0) return { processed: 0, error: 'no school domains set' }

  const token = await getAccessToken(connection)
  if (!token) return { processed: 0, error: 'token refresh failed' }

  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('id', connection.user_id)
    .single()
  if (!user) return { processed: 0, error: 'user not found' }

  // Get recent messages (the default order is newest first) and filter by date
  // and sender ourselves. Graph's $filter/$orderby combinations on the messages
  // endpoint are finicky and error easily, so we keep the query minimal.
  const listUrl =
    `https://graph.microsoft.com/v1.0/me/messages` +
    `?$select=id,subject,from,receivedDateTime,hasAttachments` +
    `&$top=50`

  const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } })
  const list = await listRes.json()
  if (!list.value) {
    console.error('Outlook message list failed:', JSON.stringify(list))
    return { processed: 0, error: 'graph list failed' }
  }

  const sinceMs = Date.now() - 7 * 86400000

  let processed = 0
  for (const meta of list.value) {
    if (processed >= limit) break

    const receivedMs = meta.receivedDateTime ? new Date(meta.receivedDateTime).getTime() : 0
    if (receivedMs < sinceMs) continue

    const fromAddr = meta.from?.emailAddress?.address || ''
    if (!senderMatches(fromAddr, domains)) continue

    const { data: seen } = await supabase
      .from('outlook_processed_messages')
      .select('id')
      .eq('user_id', connection.user_id)
      .eq('message_id', meta.id)
      .maybeSingle()
    if (seen) continue

    // Fetch the full message body
    const msgRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${meta.id}?$select=subject,body,hasAttachments`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const msg = await msgRes.json()

    const isHtml = msg.body?.contentType === 'html'
    const emailHtml = isHtml ? (msg.body?.content || '') : ''
    const emailText = isHtml ? emailHtml.replace(/<[^>]+>/g, ' ') : (msg.body?.content || '')

    const pdfBuffers: Buffer[] = []
    if (msg.hasAttachments) {
      const attRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/messages/${meta.id}/attachments`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      const att = await attRes.json()
      for (const a of att.value || []) {
        if (
          a['@odata.type'] === '#microsoft.graph.fileAttachment' &&
          (a.contentType === 'application/pdf' || a.name?.toLowerCase().endsWith('.pdf')) &&
          a.contentBytes
        ) {
          pdfBuffers.push(Buffer.from(a.contentBytes, 'base64'))
        }
      }
    }

    try {
      await extractAndSave({
        user,
        subject: msg.subject || meta.subject || '',
        emailText,
        emailHtml,
        pdfBuffers,
        endpoint: 'outlook/sync'
      })
    } catch (err) {
      console.error('Outlook extraction failed for message', meta.id, err)
    }

    await supabase.from('outlook_processed_messages').insert({
      user_id: connection.user_id,
      message_id: meta.id
    })
    processed++
  }

  await supabase
    .from('outlook_connections')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('id', connection.id)

  return { processed }
}
