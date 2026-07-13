import { verifyLoginToken, createSessionToken, sessionCookie } from '@/lib/auth'

export const runtime = 'nodejs'

// The link in the sign-in email lands here. Valid token → set the session
// cookie and continue to the manage page; otherwise bounce back with a hint.
export async function GET(req: Request) {
  const { searchParams, origin } = new URL(req.url)
  const token = searchParams.get('token') || ''

  const userId = verifyLoginToken(token)
  if (!userId) {
    return Response.redirect(`${origin}/manage?login=expired`)
  }

  const session = createSessionToken(userId)
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${origin}/manage`,
      'Set-Cookie': sessionCookie(session)
    }
  })
}
