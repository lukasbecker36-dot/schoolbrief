import { supabase } from '@/lib/supabase'
import { encrypt, decrypt } from '@/lib/crypto'
import { extractAndSave } from '@/lib/extract'

// Returns a valid access token for a connection, refreshing via the stored
// refresh token if the cached one has expired. Returns null if refresh fails
// (e.g. the user revoked access).
async function getAccessToken(connection: any): Promise<string | null> {
  const now = Date.now()
  const expiresAt = connection.access_token_expires_at
    ? new Date(connection.access_token_expires_at).getTime()
    : 0

  if (connection.access_token && expiresAt > now + 60_000) {
    return decrypt(connection.access_token)
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      refresh_token: decrypt(connection.refresh_token),
      grant_type: 'refresh_token'
    })
  })
  const tokens = await res.json()
  if (!tokens.access_token) {
    console.error('Failed to refresh Gmail token', tokens)
    return null
  }

  const newExpiry = new Date(now + (tokens.expires_in || 3600) * 1000).toISOString()
  await supabase
    .from('gmail_connections')
    .update({
      access_token: encrypt(tokens.access_token),
      access_token_expires_at: newExpiry
    })
    .eq('id', connection.id)

  return tokens.access_token
}

function b64urlDecode(data: string): Buffer {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

// Pulls subject, text/html bodies and PDF attachment references out of a Gmail
// API message payload (which nests parts recursively).
function parseGmailMessage(message: any) {
  const headers = message.payload?.headers || []
  const subject = headers.find((h: any) => h.name.toLowerCase() === 'subject')?.value || ''

  let text = ''
  let html = ''
  const pdfParts: { attachmentId: string }[] = []

  function walk(part: any) {
    if (!part) return
    const mime = part.mimeType || ''
    if (mime === 'text/plain' && part.body?.data) {
      text += b64urlDecode(part.body.data).toString('utf8')
    } else if (mime === 'text/html' && part.body?.data) {
      html += b64urlDecode(part.body.data).toString('utf8')
    } else if (
      (mime === 'application/pdf' || part.filename?.toLowerCase().endsWith('.pdf')) &&
      part.body?.attachmentId
    ) {
      pdfParts.push({ attachmentId: part.body.attachmentId })
    }
    for (const sub of part.parts || []) walk(sub)
  }
  walk(message.payload)

  return { subject, text, html, pdfParts }
}

async function fetchAttachment(token: string, messageId: string, attachmentId: string): Promise<Buffer | null> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!res.ok) return null
  const data = await res.json()
  if (!data.data) return null
  return b64urlDecode(data.data)
}

// Syncs new school emails for one connection. Caps the number processed per run
// to stay within serverless time limits — repeated runs drain any backlog.
export async function syncConnection(connection: any, limit = 10): Promise<{ processed: number; error?: string }> {
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

  const query = `from:(${domains.join(' OR ')}) newer_than:7d`
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${limit}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const list = await listRes.json()
  const messages = list.messages || []

  let processed = 0
  for (const m of messages) {
    const { data: seen } = await supabase
      .from('gmail_processed_messages')
      .select('id')
      .eq('user_id', connection.user_id)
      .eq('message_id', m.id)
      .maybeSingle()
    if (seen) continue

    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const message = await msgRes.json()
    const { subject, text, html, pdfParts } = parseGmailMessage(message)

    const pdfBuffers: Buffer[] = []
    for (const p of pdfParts) {
      const buf = await fetchAttachment(token, m.id, p.attachmentId)
      if (buf) pdfBuffers.push(buf)
    }

    try {
      await extractAndSave({
        user,
        subject,
        emailText: text || html.replace(/<[^>]+>/g, ' '),
        emailHtml: html,
        pdfBuffers,
        endpoint: 'gmail/sync'
      })
    } catch (err) {
      console.error('Gmail extraction failed for message', m.id, err)
    }

    // Mark processed regardless, so a single bad email can't loop forever.
    await supabase.from('gmail_processed_messages').insert({
      user_id: connection.user_id,
      message_id: m.id
    })
    processed++
  }

  await supabase
    .from('gmail_connections')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('id', connection.id)

  return { processed }
}
