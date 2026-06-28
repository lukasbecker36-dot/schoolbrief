import { simpleParser } from 'mailparser'
import { supabase } from '@/lib/supabase'
import { Resend } from 'resend'
import { extractAndSave } from '@/lib/extract'

export async function POST(req: Request) {
  try {
    const formData = await req.formData()

    const to = formData.get('to') as string
    const rawEmail = formData.get('email') as string

    const parsed = await simpleParser(rawEmail)
    const emailText = parsed.text || ''
    const subject = parsed.subject || ''

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
      return new Response('ok', { status: 200 })
    }

    console.log('Found user:', user.email)

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
    return new Response('ok', { status: 200 })

  } catch (err) {
    console.error('Error:', err)
    return new Response('ok', { status: 200 })
  }
}
