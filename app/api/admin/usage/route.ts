import { supabase } from '@/lib/supabase'

const USD_TO_GBP = 0.79
const SONNET_INPUT_PER_M = 3.0
const SONNET_OUTPUT_PER_M = 15.0

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const { data: users } = await supabase.from('users').select('id, email')
  if (!users) return Response.json({ error: 'No users found' })

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString()

  const { data: usage } = await supabase
    .from('token_usage')
    .select('user_id, input_tokens, output_tokens')
    .gte('created_at', monthStart)
    .lt('created_at', monthEnd)

  if (!usage) return Response.json({ error: 'No usage data' })

  const perUser: Record<string, { input_tokens: number; output_tokens: number; api_calls: number }> = {}
  for (const row of usage) {
    if (!perUser[row.user_id]) {
      perUser[row.user_id] = { input_tokens: 0, output_tokens: 0, api_calls: 0 }
    }
    perUser[row.user_id].input_tokens += row.input_tokens
    perUser[row.user_id].output_tokens += row.output_tokens
    perUser[row.user_id].api_calls++
  }

  const daysElapsed = Math.max(1, now.getDate())
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()

  const report = users.map(user => {
    const u = perUser[user.id] || { input_tokens: 0, output_tokens: 0, api_calls: 0 }
    const inputCostUsd = (u.input_tokens / 1_000_000) * SONNET_INPUT_PER_M
    const outputCostUsd = (u.output_tokens / 1_000_000) * SONNET_OUTPUT_PER_M
    const totalCostUsd = inputCostUsd + outputCostUsd
    const totalCostGbp = totalCostUsd * USD_TO_GBP
    const projectedMonthlyGbp = (totalCostGbp / daysElapsed) * daysInMonth

    return {
      email: user.email,
      api_calls: u.api_calls,
      input_tokens: u.input_tokens,
      output_tokens: u.output_tokens,
      cost_so_far_gbp: `£${totalCostGbp.toFixed(4)}`,
      projected_monthly_gbp: `£${projectedMonthlyGbp.toFixed(2)}`,
    }
  })

  return Response.json({
    month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    days_elapsed: daysElapsed,
    days_in_month: daysInMonth,
    users: report,
  })
}
