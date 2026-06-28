import { supabase } from '@/lib/supabase'
import { sendDigestForUser } from '@/lib/digest'

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const { data: users } = await supabase
    .from('users')
    .select('*')

  if (!users || users.length === 0) {
    return Response.json({ message: 'No users found' })
  }

  let emailsSent = 0

  for (const user of users) {
    const sent = await sendDigestForUser(user)
    if (sent) {
      emailsSent++
      console.log(`✅ Sent digest to ${user.email}`)
    }
  }

  return Response.json({ message: `Sent ${emailsSent} digests` })
}
