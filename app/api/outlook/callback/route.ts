import { supabase } from '@/lib/supabase'
import { encrypt, verifyState } from '@/lib/crypto'
import { OUTLOOK_SCOPE } from '@/lib/outlook'

export const runtime = 'nodejs'

// Handles Microsoft's redirect back after the user grants (or denies) access.
export async function GET(req: Request) {
  const { searchParams, origin } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const oauthError = searchParams.get('error')

  const fail = (reason: string) =>
    Response.redirect(`${origin}/outlook/connected?status=error&reason=${reason}`)

  if (oauthError || !code || !state) return fail('denied')

  const email = verifyState(state)
  if (!email) return fail('badstate')

  const redirectUri = `${origin}/api/outlook/callback`
  const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.MICROSOFT_CLIENT_ID || '',
      client_secret: process.env.MICROSOFT_CLIENT_SECRET || '',
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      scope: OUTLOOK_SCOPE
    })
  })
  const tokens = await tokenRes.json()

  if (!tokens.refresh_token) {
    console.error('Outlook OAuth: no refresh token returned', tokens)
    return fail('norefresh')
  }

  // Find out which Microsoft account was connected.
  let connectedEmail = email
  try {
    const profileRes = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    })
    const profile = await profileRes.json()
    connectedEmail = profile.mail || profile.userPrincipalName || email
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
    .from('outlook_connections')
    .upsert({
      user_id: user.id,
      microsoft_email: connectedEmail,
      refresh_token: encrypt(tokens.refresh_token),
      access_token: encrypt(tokens.access_token),
      access_token_expires_at: expiresAt
    }, { onConflict: 'user_id' })

  if (upsertError) {
    console.error('Outlook OAuth: failed to store connection', upsertError)
    return fail('storage')
  }

  return Response.redirect(`${origin}/outlook/connected?status=ok&email=${encodeURIComponent(email)}`)
}
