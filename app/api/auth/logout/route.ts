import { clearedSessionCookie } from '@/lib/auth'

export const runtime = 'nodejs'

// Signs the browser out by expiring the session cookie, then returns to the
// homepage. POST only, so a link prefetch or a stray image tag can't log
// someone out.
export async function POST(req: Request) {
  const { origin } = new URL(req.url)
  return new Response(null, {
    status: 303,
    headers: {
      Location: `${origin}/`,
      'Set-Cookie': clearedSessionCookie()
    }
  })
}
