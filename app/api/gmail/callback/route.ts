import { supabase } from '@/lib/supabase'
import { encrypt, verifyState } from '@/lib/crypto'

export const runtime = 'nodejs'

// Handles Google's redirect back after the user grants (or denies) access.
// Exchanges the auth code for tokens and stores them encrypted.
export async function GET(req: Request) {
  const { searchParams, origin } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const oauthError = searchParams.get('error')

  const fail = (reason: string) =>
    Response.redirect(`${origin}/gmail/connected?status=error&reason=${reason}`)

  if (oauthError || !code || !state) return fail('denied')

  const email = verifyState(state)
  if (!email) return fail('badstate')

  // Exchange the authorization code for tokens
  const redirectUri = `${origin}/api/gmail/callback`
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })
  })
  const tokens = await tokenRes.json()

  // A refresh token is required to poll the mailbox later. Google only returns
  // one when access_type=offline and the user hasn't already granted before
  // (hence prompt=consent in the connect route).
  if (!tokens.refresh_token) {
    console.error('Gmail OAuth: no refresh token returned', tokens)
    return fail('norefresh')
  }

  // Find out which Google account was actually connected.
  let connectedEmail = email
  try {
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    })
    const profile = await profileRes.json()
    if (profile.email) connectedEmail = profile.email
  } catch {
    // fall back to the signup email
  }

  const { data: user } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .single()

  if (!user) return fail('nouser')

  const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString()

  const { error: upsertError } = await supabase
    .from('gmail_connections')
    .upsert({
      user_id: user.id,
      google_email: connectedEmail,
      refresh_token: encrypt(tokens.refresh_token),
      access_token: encrypt(tokens.access_token),
      access_token_expires_at: expiresAt
    }, { onConflict: 'user_id' })

  if (upsertError) {
    console.error('Gmail OAuth: failed to store connection', upsertError)
    return fail('storage')
  }

  return Response.redirect(`${origin}/gmail/connected?status=ok`)
}
