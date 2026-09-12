import { supabase } from '@/lib/supabase'
import { canonicalYearLevel } from '@/lib/yeargroups'

// Moving children up a year on 1 September.
//
// Year groups were entered once and never changed, which was harmless while the
// year group only nudged the extraction prompt. It stopped being harmless when
// the year-group filter started enforcing them in code: a stale year now
// silently removes a child's real events rather than merely letting irrelevant
// ones through. So the app has to turn the year over itself.
//
// Each child carries the academic year its year group was last set for. A run
// on or after 1 September finds any child still stamped with an earlier year,
// moves them up one, and re-stamps. Children with no stamp yet are stamped
// without being moved -- their year group was entered for the year we are in,
// so promoting them would be wrong. That makes the first run after deployment a
// no-op by design, and every subsequent September a single promotion.

// The academic year is labelled by the calendar year its September falls in, so
// 12 Sep 2026 and 1 Mar 2027 are both academic year 2026.
export function academicYearStart(now: Date = new Date()): number {
  return now.getUTCMonth() + 1 >= 9 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
}

// The next year group up, or null to leave this child alone. Nursery becomes
// Reception, Reception becomes Year 1, and Year 13 stays put; anything we cannot
// read is left untouched rather than guessed at.
export function nextYearLevel(current: string): string | null {
  const canonical = canonicalYearLevel(current)
  if (canonical === 'nursery') return 'Reception'
  if (canonical === 'reception') return 'Year 1'
  const n = Number(canonical)
  if (!Number.isInteger(n) || n < 1 || n >= 13) return null
  return `Year ${n + 1}`
}

type Promotion = { name: string; from: string; to: string }

// Idempotent: safe to call on every cron run, and from more than one of them.
export async function promoteYearGroupsIfDue(): Promise<{
  academicYear: number
  promoted: Promotion[]
  stamped: number
  skipped: string[]
  error?: string
}> {
  const academicYear = academicYearStart()
  const promoted: Promotion[] = []
  const skipped: string[] = []
  let stamped = 0

  // select('*') so this still runs before the column exists.
  const { data: children, error } = await supabase.from('children').select('*')
  if (error) {
    console.error('Year rollover: could not read children:', error.message)
    return { academicYear, promoted, stamped, skipped, error: error.message }
  }

  for (const child of children || []) {
    const setFor = child.year_updated_for ?? null

    // Never seen before: record which year the current value belongs to and
    // leave the value alone.
    if (setFor === null) {
      const { error: stampError } = await supabase
        .from('children')
        .update({ year_updated_for: academicYear })
        .eq('id', child.id)
      if (stampError) {
        if (stampError.code === '42703') {
          console.log('Year rollover: year_updated_for column not present yet — skipping')
          return { academicYear, promoted, stamped, skipped, error: 'column missing' }
        }
        console.error('Year rollover: stamp failed for', child.id, stampError.message)
        continue
      }
      stamped++
      continue
    }

    if (Number(setFor) >= academicYear) continue // already current

    const next = nextYearLevel(child.year_level)
    if (!next) {
      // Unreadable, or already at the top of school: re-stamp so we don't
      // reconsider it every day, but leave the year group as it stands.
      await supabase.from('children').update({ year_updated_for: academicYear }).eq('id', child.id)
      skipped.push(`${child.name} (${child.year_level})`)
      continue
    }

    const { error: updateError } = await supabase
      .from('children')
      .update({ year_level: next, year_updated_for: academicYear })
      .eq('id', child.id)
    if (updateError) {
      console.error('Year rollover: promotion failed for', child.id, updateError.message)
      continue
    }
    promoted.push({ name: child.name, from: child.year_level, to: next })
  }

  if (promoted.length > 0) {
    console.log(
      `Year rollover to ${academicYear}: ` +
      promoted.map(p => `${p.name} ${p.from} -> ${p.to}`).join(', ')
    )
  }
  if (stamped > 0) console.log(`Year rollover: stamped ${stamped} child(ren) as current for ${academicYear}`)
  if (skipped.length > 0) console.log(`Year rollover: left alone -> ${skipped.join(', ')}`)

  return { academicYear, promoted, stamped, skipped }
}
