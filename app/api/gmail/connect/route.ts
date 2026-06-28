import { signState } from '@/lib/crypto'

export const runtime = 'nodejs'

// Kicks off the Gmail OAuth flow. Redirects the user to Google's consent screen
// requesting offline read-only access to their mailbox.
export async function GET(req: Request) {
  const { searchParams, origin } = new URL(req.url)
  const email = searchParams.get('email')
  if (!email) {
    return new Response('Email required', { status: 400 })
  }

  const redirectUri = `${origin}/api/gmail/callback`
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/userinfo.email'
    ].join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: signState(email),
    login_hint: email
  })

  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`)
}
