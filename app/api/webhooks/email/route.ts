export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    
    const to = formData.get('to') as string
    const from = formData.get('from') as string
    const subject = formData.get('subject') as string
    const rawEmail = formData.get('email') as string

    console.log('📧 Email received!')
    console.log('To:', to)
    console.log('From:', from)
    console.log('Subject:', subject)
    console.log('Raw email preview:', rawEmail?.slice(0, 300))

    return new Response('ok', { status: 200 })

  } catch (err) {
    console.error(err)
    return new Response('ok', { status: 200 })
  }
}