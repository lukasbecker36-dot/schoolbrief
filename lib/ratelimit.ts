import { supabase } from '@/lib/supabase'

// Fixed-window rate limiter backed by the rate_limits table, so it holds
// across serverless instances. Read-modify-write races can slightly undercount
// under parallel load, which is acceptable — this is abuse protection, not
// billing. Fails open: if the table is missing or the query errors, requests
// are allowed and the error is logged.
export async function rateLimit(key: string, max: number, windowSecs: number): Promise<boolean> {
  try {
    const now = Date.now()
    const { data: row, error } = await supabase
      .from('rate_limits')
      .select('*')
      .eq('key', key)
      .maybeSingle()

    if (error) {
      console.error('Rate limit lookup failed (allowing request):', error)
      return true
    }

    if (!row || now - new Date(row.window_start).getTime() > windowSecs * 1000) {
      await supabase
        .from('rate_limits')
        .upsert({ key, count: 1, window_start: new Date(now).toISOString() })
      return true
    }

    if (row.count >= max) return false

    await supabase
      .from('rate_limits')
      .update({ count: row.count + 1 })
      .eq('key', key)
    return true
  } catch (err) {
    console.error('Rate limit error (allowing request):', err)
    return true
  }
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for') || ''
  return fwd.split(',')[0].trim() || 'unknown'
}
