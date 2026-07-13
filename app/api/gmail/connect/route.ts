import { signState } from '@/lib/crypto'
import { getSessionUser } from '@/lib/auth'

export const runtime = 'nodejs'

// Kicks off the Gmail OAuth flow for the signed-in user. Redirects to Google's
// consent screen requesting offline read-only access to their mailbox.
export async function GET(req: Request) {
  const { origin } = new URL(req.url)

  const user = await getSessionUser(req)
  if (!user) {
    return Response.redirect(`${origin}/manage?login=required`)
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
    state: signState(user.email),
    login_hint: user.email
  })

  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`)
}
