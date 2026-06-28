import crypto from 'crypto'

// AES-256-GCM encryption for Gmail OAuth tokens at rest. Key is a 32-byte hex
// string in GMAIL_TOKEN_ENCRYPTION_KEY (generate with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
function getKey() {
  const hex = process.env.GMAIL_TOKEN_ENCRYPTION_KEY || ''
  const key = Buffer.from(hex, 'hex')
  if (key.length !== 32) {
    throw new Error('GMAIL_TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars)')
  }
  return key
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join(':')
}

export function decrypt(payload: string): string {
  const [ivHex, tagHex, encHex] = payload.split(':')
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return Buffer.concat([
    decipher.update(Buffer.from(encHex, 'hex')),
    decipher.final()
  ]).toString('utf8')
}

// Signed OAuth state to tie the callback back to the user who started the flow
// and protect against CSRF. Signed with CRON_SECRET (already configured).
export function signState(email: string): string {
  const nonce = crypto.randomBytes(8).toString('hex')
  const payload = `${email}|${nonce}`
  const sig = crypto.createHmac('sha256', process.env.CRON_SECRET || '').update(payload).digest('hex')
  return Buffer.from(`${payload}|${sig}`).toString('base64url')
}

export function verifyState(state: string): string | null {
  try {
    const decoded = Buffer.from(state, 'base64url').toString('utf8')
    const [email, nonce, sig] = decoded.split('|')
    const expected = crypto.createHmac('sha256', process.env.CRON_SECRET || '')
      .update(`${email}|${nonce}`)
      .digest('hex')
    if (!sig || sig.length !== expected.length) return null
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
    return email
  } catch {
    return null
  }
}
