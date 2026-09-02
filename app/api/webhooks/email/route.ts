import { simpleParser } from 'mailparser'
import { supabase } from '@/lib/supabase'
import { Resend } from 'resend'
import { extractAndSave } from '@/lib/extract'

// Audit trail for forwarded mail. This route answers 200 to everything so that
// SendGrid never retries, which means a failure is otherwise invisible: no row,
// no subject, nothing to tell a parent why their email never appeared. Best
// effort only -- an audit write must never break delivery, and it no-ops until
// the table exists.
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
    const rawEmail = formData.get('email') as string

    // Logged before parsing: a malformed MIME that breaks simpleParser is one
    // of the ways an email can disappear here, and it has to leave a trace.
    inboundId = await recordInbound(to)

    const parsed = await simpleParser(rawEmail)
    const emailText = parsed.text || ''
    const subject = parsed.subject || ''

    await updateInbound(inboundId, {
      from_address: parsed.from?.value?.[0]?.address || parsed.from?.text || null,
      subject
    })

    console.log('📧 Email received!')
    console.log('To:', to)
    console.log('Subject:', subject)
    console.log('Attachments:', parsed.attachments?.length || 0)

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
      (parsed.from?.text?.includes('forwarding-noreply@google.com') ||
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
              ${parsed.html || `<pre>${parsed.text}</pre>`}
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

    // Collect PDF attachments — real attachments plus any nested inside
    // forwarded .eml attachments.
    const pdfAttachments = (parsed.attachments || []).filter(
      (a: any) => a.contentType === 'application/pdf' || a.filename?.toLowerCase().endsWith('.pdf')
    )

    const emlAttachments = (parsed.attachments || []).filter(
      (a: any) => a.contentType === 'message/rfc822' || a.filename?.toLowerCase().endsWith('.eml')
    )
    for (const eml of emlAttachments) {
      try {
        const innerParsed = await simpleParser(eml.content as Buffer)
        for (const innerAttachment of innerParsed.attachments || []) {
          if (innerAttachment.contentType === 'application/pdf' ||
              innerAttachment.filename?.toLowerCase().endsWith('.pdf')) {
            pdfAttachments.push(innerAttachment)
          }
        }
      } catch (err) {
        console.error('Error parsing .eml attachment:', err)
      }
    }

    const pdfBuffers = pdfAttachments.map((p: any) => p.content as Buffer)
    const emailHtml = typeof parsed.html === 'string' ? parsed.html : ''

    await extractAndSave({
      user,
      subject,
      emailText,
      emailHtml,
      pdfBuffers,
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
