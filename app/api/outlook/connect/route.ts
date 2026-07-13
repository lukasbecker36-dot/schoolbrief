import { signState } from '@/lib/crypto'
import { getSessionUser } from '@/lib/auth'
import { OUTLOOK_SCOPE } from '@/lib/outlook'

export const runtime = 'nodejs'

// Kicks off the Microsoft OAuth flow for the signed-in user.
export async function GET(req: Request) {
  const { origin } = new URL(req.url)

  const user = await getSessionUser(req)
  if (!user) {
    return Response.redirect(`${origin}/manage?login=required`)
  }

  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID || '',
    response_type: 'code',
    redirect_uri: `${origin}/api/outlook/callback`,
    response_mode: 'query',
    scope: OUTLOOK_SCOPE,
    state: signState(user.email),
    login_hint: user.email,
    prompt: 'consent'
  })

  return Response.redirect(
    `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`
  )
}
