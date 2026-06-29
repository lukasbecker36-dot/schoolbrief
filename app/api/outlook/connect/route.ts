import { signState } from '@/lib/crypto'
import { OUTLOOK_SCOPE } from '@/lib/outlook'

export const runtime = 'nodejs'

// Kicks off the Microsoft OAuth flow for Outlook/Hotmail/Live accounts.
export async function GET(req: Request) {
  const { searchParams, origin } = new URL(req.url)
  const email = searchParams.get('email')
  if (!email) {
    return new Response('Email required', { status: 400 })
  }

  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID || '',
    response_type: 'code',
    redirect_uri: `${origin}/api/outlook/callback`,
    response_mode: 'query',
    scope: OUTLOOK_SCOPE,
    state: signState(email),
    login_hint: email,
    prompt: 'consent'
  })

  return Response.redirect(
    `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`
  )
}
