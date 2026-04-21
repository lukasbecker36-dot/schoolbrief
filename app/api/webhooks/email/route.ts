import { simpleParser } from 'mailparser'

export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    
    const to = formData.get('to') as string
    const rawEmail = formData.get('email') as string

    // Parse the raw MIME email into clean fields
    const parsed = await simpleParser(rawEmail)

    console.log('📧 Email received!')
    console.log('To:', to)
    console.log('From:', parsed.from?.text)
    console.log('Subject:', parsed.subject)
    console.log('Body:', parsed.text?.slice(0, 500))

    return new Response('ok', { status: 200 })

  } catch (err) {
    console.error('Error parsing email:', err)
    return new Response('ok', { status: 200 })
  }
}