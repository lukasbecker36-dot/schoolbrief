import { supabase } from '@/lib/supabase'
import Anthropic from '@anthropic-ai/sdk'

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
  })

  // Get all users
  const { data: users } = await supabase
    .from('users')
    .select('*')

  if (!users) return Response.json({ message: 'No users' })

  let totalDeleted = 0
  let totalKept = 0
  const report: any[] = []

  for (const user of users) {
    // Get all upcoming events for this user
    const today = new Date().toISOString().split('T')[0]
    const { data: events } = await supabase
      .from('events')
      .select('*')
      .eq('user_id', user.id)
      .gte('event_date', today)
      .order('event_date', { ascending: true })

    if (!events || events.length === 0) continue

    // Group events by date
    const byDate: { [date: string]: any[] } = {}
    for (const e of events) {
      if (!byDate[e.event_date]) byDate[e.event_date] = []
      byDate[e.event_date].push(e)
    }

    const userReport = { email: user.email, dates: [] as any[] }

    // For each date with multiple events, ask Claude to identify duplicates
    for (const [date, dateEvents] of Object.entries(byDate)) {
      if (dateEvents.length < 2) {
        totalKept++
        continue
      }

      console.log(`Processing ${user.email} - ${date} - ${dateEvents.length} events`)

      const prompt = `You are deduplicating school calendar events for the same date.

Below are ${dateEvents.length} events all on ${date}. Some may be duplicates of each other (same underlying event, just extracted from different emails).

Events:
${dateEvents.map((e, i) => `[${i}] id=${e.id}
  title: ${e.title}
  description: ${e.description}
  action_required: ${e.action_required}
`).join('\n')}

Your task: identify which events are duplicates and decide which ones to KEEP and which to DELETE.

Rules:
- Two events are duplicates if they refer to the same underlying real-world event (e.g. "FoWs Bake Off" and "FOWS Junior Bake Off" are duplicates)
- Different events on the same date are NOT duplicates (e.g. "Mini Marathon" and "Year 2 Wakehurst trip" both on 13 May are separate events)
- For each duplicate group, keep the ONE event with the most useful information (prefer action_required=true if any version has it; prefer the most detailed description)
- Return all event IDs to delete

Return ONLY a JSON object like this, no other text:
{
  "delete": ["id1", "id2"],
  "reasoning": "brief explanation"
}`

      try {
        const message = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }]
        })

        const responseText = message.content[0].type === 'text' ? message.content[0].text : '{}'
        let cleanJson = responseText.replace(/```json\n?/g, '').replace(/```/g, '').trim()
// Extract just the JSON object — sometimes Claude adds trailing text
const jsonMatch = cleanJson.match(/\{[\s\S]*\}/)
if (jsonMatch) cleanJson = jsonMatch[0]
        const result = JSON.parse(cleanJson)

        const idsToDelete: string[] = result.delete || []
        
        userReport.dates.push({
          date,
          totalEvents: dateEvents.length,
          deleted: idsToDelete.length,
          kept: dateEvents.length - idsToDelete.length,
          reasoning: result.reasoning
        })

        if (idsToDelete.length > 0) {
          await supabase
            .from('events')
            .delete()
            .in('id', idsToDelete)
          
          totalDeleted += idsToDelete.length
          totalKept += (dateEvents.length - idsToDelete.length)
          console.log(`  Deleted ${idsToDelete.length}, kept ${dateEvents.length - idsToDelete.length}`)
        } else {
          totalKept += dateEvents.length
        }

      } catch (err) {
        console.error(`Error processing ${date}:`, err)
        userReport.dates.push({ date, error: String(err) })
      }
    }

    report.push(userReport)
  }

  return Response.json({
    message: `Done! Deleted ${totalDeleted} duplicates, kept ${totalKept}`,
    totalDeleted,
    totalKept,
    report
  })
}