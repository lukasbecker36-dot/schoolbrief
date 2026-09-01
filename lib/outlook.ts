import { supabase } from '@/lib/supabase'
import { encrypt, decrypt } from '@/lib/crypto'
import { extractAndSave } from '@/lib/extract'

const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
export const OUTLOOK_SCOPE = 'offline_access Mail.Read User.Read'

// Pages of 100 to walk back through the 7-day window without unbounded work.
const MAX_LIST_PAGES = 10

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
export async function syncOutlookConnection(
  connection: any,
  limit = 10
): Promise<{ processed: number; scanned?: number; matched?: number; error?: string }> {
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

  // Graph's message collection spans every folder (including Deleted Items and
  // Clutter) and has no documented default sort order, so a bare $top slice can
  // silently return the same arbitrary messages every run and never include the
  // school's mail. Filter and sort server-side on receivedDateTime instead, and
  // page through the window. Ordering rule: a property in $orderby must also
  // appear in $filter, ahead of any other property, or Graph rejects the query
  // with InefficientFilter.
  const sinceIso = new Date(Date.now() - 7 * 86400000).toISOString()
  const firstPageUrl =
    `https://graph.microsoft.com/v1.0/me/messages` +
    `?$select=id,subject,from,receivedDateTime,hasAttachments` +
    `&$filter=${encodeURIComponent(`receivedDateTime ge ${sinceIso}`)}` +
    `&$orderby=${encodeURIComponent('receivedDateTime desc')}` +
    `&$top=100`

  let nextUrl: string | null = firstPageUrl
  let scanned = 0
  const matches: any[] = []

  for (let page = 0; page < MAX_LIST_PAGES && nextUrl; page++) {
    const listRes = await fetch(nextUrl, { headers: { Authorization: `Bearer ${token}` } })
    const list: any = await listRes.json()
    if (!list.value) {
      console.error('Outlook message list failed:', JSON.stringify(list))
      // A later page failing still leaves the earlier matches worth processing.
      if (page === 0) return { processed: 0, scanned: 0, matched: 0, error: 'graph list failed' }
      break
    }

    scanned += list.value.length
    for (const meta of list.value) {
      const fromAddr = meta.from?.emailAddress?.address || ''
      if (senderMatches(fromAddr, domains)) matches.push(meta)
    }
    nextUrl = list['@odata.nextLink'] || null
  }

  // Newest first, so a backlog bigger than `limit` drains over repeated runs.
  let processed = 0
  for (const meta of matches) {
    if (processed >= limit) break

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

  return { processed, scanned, matched: matches.length }
}
