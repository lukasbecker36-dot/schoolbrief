export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    
    const to = formData.get('to') as string
    const from = formData.get('from') as string
    const subject = formData.get('subject') as string
    const text = formData.get('text') as string

    console.log('📧 Email received!')
    console.log('To:', to)
    console.log('From:', from)
    console.log('Subject:', subject)
    console.log('Body preview:', text?.slice(0, 200))

    return new Response('ok', { status: 200 })

  } catch (err) {
    console.error(err)
    return new Response('ok', { status: 200 })
  }
}