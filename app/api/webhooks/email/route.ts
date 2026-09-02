import { simpleParser } from 'mailparser'
import { supabase } from '@/lib/supabase'
import { Resend } from 'resend'
import { extractAndSave } from '@/lib/extract'

// SendGrid Inbound Parse can post either the raw MIME message in an `email`
// field, or the message already broken into `subject`/`text`/`html` plus one
// form part per attachment. Raw mode is simpler to consume but base64-encodes
// the attachments inside the blob, inflating the payload by about 37% -- enough
// to push a 3.5MB school email past the 4.5MB request body limit, where it is
// rejected before this handler ever runs. Parsed mode sends attachments as
// binary parts, so the same email arrives comfortably under the limit.
//
// Both shapes are accepted so the SendGrid setting can be flipped before or
// after a deploy, in either order, without dropping mail in between.
type InboundAttachment = { filename: string; contentType: string; content: Buffer }

type InboundEmail = {
  subject: string
  text: string
  html: string
  fromText: string
  attachments: InboundAttachment[]
}

async function readRawMime(raw: string): Promise<InboundEmail> {
  const parsed = await simpleParser(raw)
  return {
    subject: parsed.subject || '',
    text: parsed.text || '',
    html: typeof parsed.html === 'string' ? parsed.html : '',
    fromText: parsed.from?.text || '',
    attachments: (parsed.attachments || []).map((a: any) => ({
      filename: a.filename || '',
      contentType: a.contentType || '',
      content: a.content as Buffer
    }))
  }
}

async function readParsedFields(formData: FormData): Promise<InboundEmail> {
  let info: Record<string, any> = {}
  try {
    info = JSON.parse(String(formData.get('attachment-info') || '{}'))
  } catch {
    // attachment-info is advisory; the file parts carry names of their own.
  }

  const attachments: InboundAttachment[] = []
  for (const [key, value] of formData.entries()) {
    // Skip `attachments` (a count) and `attachment-info` (JSON) -- both strings.
    if (!key.startsWith('attachment') || typeof value === 'string') continue
    const file = value as File
    const meta = info[key] || {}
    attachments.push({
      filename: String(meta.filename || file.name || ''),
      contentType: String(meta.type || file.type || ''),
      content: Buffer.from(await file.arrayBuffer())
    })
  }

  return {
    subject: String(formData.get('subject') || ''),
    text: String(formData.get('text') || ''),
    html: String(formData.get('html') || ''),
    fromText: String(formData.get('from') || ''),
    attachments
  }
}

const isPdf = (a: InboundAttachment) =>
  a.contentType === 'application/pdf' || a.filename.toLowerCase().endsWith('.pdf')

const isDocx = (a: InboundAttachment) =>
  a.contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
  a.filename.toLowerCase().endsWith('.docx')

const isEml = (a: InboundAttachment) =>
  a.contentType === 'message/rfc822' || a.filename.toLowerCase().endsWith('.eml')

function addressOf(fromText: string): string | null {
  const angled = fromText.match(/<([^>]+)>/)
  return (angled ? angled[1] : fromText).trim() || null
}

// Audit trail for forwarded mail. This route answers 200 to everything so that
// SendGrid never retries, which means a failure is otherwise invisible: no row,
// no subject, nothing to tell a parent why their email never appeared. Best
// effort only -- an audit write must never break delivery, and it no-ops until
// the table exists. Note this cannot see a payload rejected for size, since the
// platform turns those away before the handler runs.
async function recordInbound(toAddress: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('inbound_emails')
      .insert({ to_address: toAddress || null, outcome: 'received' })
      .select('id')
      .single()
    if (error) {
      console.error('inbound_emails insert failed:', error.message)
      return null
    }
    return data?.id ?? null
  } catch (err) {
    console.error('inbound_emails insert threw:', err)
    return null
  }
}

async function updateInbound(id: string | null, fields: Record<string, any>) {
  if (!id) return
  try {
    const { error } = await supabase.from('inbound_emails').update(fields).eq('id', id)
    if (error) console.error('inbound_emails update failed:', error.message)
  } catch (err) {
    console.error('inbound_emails update threw:', err)
  }
}

export async function POST(req: Request) {
  let inboundId: string | null = null

  try {
    // Shared-secret check so only SendGrid (whose Inbound Parse URL includes
    // ?secret=...) can feed us email. Enforced only once WEBHOOK_SECRET is set,
    // so the SendGrid URL can be updated first without dropping mail. Returns
    // 200 either way to avoid retry loops.
    if (process.env.WEBHOOK_SECRET) {
      const { searchParams } = new URL(req.url)
      if (searchParams.get('secret') !== process.env.WEBHOOK_SECRET) {
        console.error('Webhook called without valid secret — ignoring')
        return new Response('ok', { status: 200 })
      }
    }

    const formData = await req.formData()

    const to = formData.get('to') as string
    const rawEmail = formData.get('email')

    // Logged before parsing: a malformed MIME that breaks simpleParser is one
    // of the ways an email can disappear here, and it has to leave a trace.
    inboundId = await recordInbound(to)

    const inbound =
      typeof rawEmail === 'string' && rawEmail.length > 0
        ? await readRawMime(rawEmail)
        : await readParsedFields(formData)

    // SendGrid only sends a `text` field when the message has a text/plain
    // part, and mailparser likewise leaves it empty for HTML-only mail. Without
    // a fallback the body reaching Claude would be empty and the email would
    // extract nothing, having apparently arrived fine. The Gmail sync already
    // does this.
    const emailText = inbound.text || inbound.html.replace(/<[^>]+>/g, ' ')
    const subject = inbound.subject

    await updateInbound(inboundId, {
      from_address: addressOf(inbound.fromText),
      subject
    })

    console.log('📧 Email received!')
    console.log('Mode:', typeof rawEmail === 'string' && rawEmail.length > 0 ? 'raw MIME' : 'parsed fields')
    console.log('To:', to)
    console.log('Subject:', subject)
    console.log('Attachments:', inbound.attachments.length)

    // Find the user
    const inboundAddress = to.split('<').pop()?.replace('>', '').trim() || to
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('inbound_address', inboundAddress)
      .single()

    if (!user) {
      console.log('No user found for address:', inboundAddress)
      await updateInbound(inboundId, { outcome: 'no_user' })
      return new Response('ok', { status: 200 })
    }

    console.log('Found user:', user.email)
    await updateInbound(inboundId, { user_id: user.id })

    // Detect Gmail forwarding confirmation email and forward to parent
    const isGmailConfirmation =
      (inbound.fromText.includes('forwarding-noreply@google.com') ||
       subject?.toLowerCase().includes('gmail forwarding confirmation') ||
       subject?.toLowerCase().includes('forwarding confirmation'))

    if (isGmailConfirmation) {
      console.log('📨 Gmail forwarding confirmation detected — forwarding to parent')

      const resend = new Resend(process.env.RESEND_API_KEY)

      await resend.emails.send({
        from: 'SchoolBrief <digest@schoolbrief.uk>',
        to: user.email,
        subject: `Action needed: Confirm your Gmail forwarding`,
        html: `
          <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            <h1 style="color: #2563eb; font-size: 24px;">SchoolBrief</h1>
            <p style="color: #1a1a1a;">Almost there! Gmail needs you to confirm that you want to forward emails to SchoolBrief.</p>
            <p style="color: #1a1a1a;">We've received a confirmation email from Gmail on your behalf. Here are the details:</p>
            <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
              ${inbound.html || `<pre>${inbound.text}</pre>`}
            </div>
            <p style="color: #666; font-size: 14px;">Click the confirmation link above to activate forwarding. Once confirmed, your school emails will start flowing into SchoolBrief automatically.</p>
          </div>
        `
      })

      console.log('✅ Confirmation email forwarded to', user.email)
      await updateInbound(inboundId, { outcome: 'forwarding_confirmation' })
      return new Response('ok', { status: 200 })
    }

    // If this user has an active email connection (Gmail/Outlook) pulling their
    // school mail directly, skip the forwarded copy to avoid double-processing
    // the same email. Only counts connections that are actually configured
    // (school senders set), so a half-finished connection doesn't black-hole mail.
    const [{ data: gmailConn }, { data: outlookConn }] = await Promise.all([
      supabase.from('gmail_connections').select('school_domains').eq('user_id', user.id).maybeSingle(),
      supabase.from('outlook_connections').select('school_domains').eq('user_id', user.id).maybeSingle()
    ])
    const hasActiveConnection =
      (gmailConn?.school_domains?.length ?? 0) > 0 ||
      (outlookConn?.school_domains?.length ?? 0) > 0
    if (hasActiveConnection) {
      console.log('User has an active email connection — skipping forwarded copy to avoid double-processing')
      await updateInbound(inboundId, { outcome: 'skipped_connection' })
      return new Response('ok', { status: 200 })
    }

    // Record the first email we ever receive for this user (drives the
    // onboarding "we got your email" confirmation). Only sets it once.
    await supabase
      .from('users')
      .update({ first_email_received_at: new Date().toISOString() })
      .eq('id', user.id)
      .is('first_email_received_at', null)

    // Collect PDF and Word attachments — real attachments plus any nested
    // inside forwarded .eml attachments.
    const pdfBuffers: Buffer[] = inbound.attachments.filter(isPdf).map(a => a.content)
    const docxBuffers: Buffer[] = inbound.attachments.filter(isDocx).map(a => a.content)

    for (const eml of inbound.attachments.filter(isEml)) {
      try {
        const inner = await readRawMime(eml.content.toString('utf8'))
        for (const a of inner.attachments) {
          if (isPdf(a)) pdfBuffers.push(a.content)
          else if (isDocx(a)) docxBuffers.push(a.content)
        }
      } catch (err) {
        console.error('Error parsing .eml attachment:', err)
      }
    }

    const emailHtml = inbound.html

    await extractAndSave({
      user,
      subject,
      emailText,
      emailHtml,
      pdfBuffers,
      docxBuffers,
      endpoint: 'webhooks/email'
    })

    console.log('✅ Done!')
    await updateInbound(inboundId, { outcome: 'extracted' })
    return new Response('ok', { status: 200 })

  } catch (err) {
    console.error('Error:', err)
    await updateInbound(inboundId, {
      outcome: 'error',
      error: err instanceof Error ? err.message : String(err)
    })
    return new Response('ok', { status: 200 })
  }
}
