import { SCHOOL_STOPWORDS } from '@/lib/text'

// Year-group filtering, enforced in code rather than asked for in the prompt.
//
// The prompt has said "YEAR GROUP FILTERING IS ABSOLUTE" in capitals for months
// and it still leaks. The 11 September newsletter produced "Sam — Y4 Parent
// Information Session" with the description "this is for Y4 families only; Sam
// is in Y3 so this is not directly relevant but included as a whole-school
// item" -- the model reasoned its way past the rule and then attached a child's
// name to someone else's event, which is worse than simply including it.
//
// So the model's output is checked instead of trusted: if an item names year
// groups and none of them belongs to a child at that school, it is dropped.
//
// Deliberately biased towards keeping things. A missing year group means keep
// (whole-school), an unrecognised school means keep, and every parse ambiguity
// resolves towards more year groups rather than fewer -- since more candidates
// can only make a match likelier. Wrongly dropping a real event for this
// family is a worse failure than letting an irrelevant one through.

// "Year 4", "Yr4", "Y5", "Years 4 and 5", "Y3-Y6", "Y4/Y5"
const YEAR_PHRASE = /\b(?:years?|yrs?|y)\s*\.?\s*(\d{1,2}(?:\s*(?:-|–|\/|,|&|and|to)\s*(?:y(?:ear)?s?\s*)?\d{1,2})*)/gi

// Class codes carry the year: 4WH, 4TW, 6JB. Two capitals keeps this tight
// enough to avoid times and dates.
const CLASS_CODE = /\b(\d{1,2})[A-Z]{2}\b/g

// "Reception to Year 11", "Reception - Y6", "Nursery through to Year 2".
// A whole-school span written this way names only its endpoints.
const SPAN_FROM_RECEPTION =
  /\b(reception|nursery)\b[^.]{0,24}?(?:-|–|to|through|up\s*to|until)[^.]{0,16}?(?:year|yr|y)\s*\.?\s*(\d{1,2})\b/gi

// "Reception" is also what schools call the front desk: "pay by card at the
// reception machine", "hand entries in at reception". Counting those as the year
// group dropped a whole-school stationery request from a family with no
// Reception child. So it only counts as a year group when it reads like one --
// followed by class/children/parents, opening a title, sitting next to another
// year group, or written "Year R".
const RECEPTION_AS_YEAR = [
  /\breception\b\s*(?:class(?:es)?|year|pupils|children|kids|cohort|parents|families|intake|teachers?)\b/i,
  /(?:^|[:\u2014\u2013-])\s*reception\b/i,
  /\breception\b[^.]{0,20}\b(?:year|yr|y)\s*\d/i,
  /\b(?:year|yr|y)\s*\d[^.]{0,20}\breception\b/i,
  /\b(?:year|yr)\s*r\b/i
]

const KEY_STAGES: Record<string, number[]> = {
  ks1: [1, 2],
  ks2: [3, 4, 5, 6],
  ks3: [7, 8, 9],
  ks4: [10, 11]
}

function addRange(into: Set<string>, from: number, to: number, wide = false) {
  if (to < from) [from, to] = [to, from]
  // A bare numeric span of more than six years is more likely two unrelated
  // numbers than a real range, so ignore it -- unless the caller knows it is a
  // genuine whole-school span.
  if (!wide && to - from > 6) return
  for (let y = from; y <= to; y++) if (y >= 1 && y <= 13) into.add(String(y))
}

// Every year group a piece of text explicitly names. Empty means it named none,
// which is treated as whole-school.
export function mentionedYearGroups(text: string): string[] {
  const found = new Set<string>()
  const raw = String(text || '')

  if (RECEPTION_AS_YEAR.some(re => re.test(raw))) found.add('reception')
  if (/\bnursery\b/i.test(raw)) found.add('nursery')

  for (const [stage, years] of Object.entries(KEY_STAGES)) {
    if (new RegExp(`\\b${stage}\\b`, 'i').test(raw)) for (const y of years) found.add(String(y))
  }

  // A span from Reception up to a numbered year covers everything in between:
  // "open to pupils from Reception to Year 11" names reception and 11 but means
  // all of them. Unexpanded, a family with a Year 2 child looked like no match
  // and the item was dropped -- which is exactly what happened to an MP's
  // Christmas card competition open to the whole school.
  for (const match of raw.matchAll(SPAN_FROM_RECEPTION)) {
    found.add('reception')
    addRange(found, 1, Number(match[2]), true)
  }

  for (const match of raw.matchAll(YEAR_PHRASE)) {
    const group = match[1]
    const numbers = [...group.matchAll(/\d{1,2}/g)].map(m => Number(m[0]))
    const ranged = /-|–|\bto\b/.test(group)
    if (ranged && numbers.length >= 2) {
      for (let i = 0; i < numbers.length - 1; i++) addRange(found, numbers[i], numbers[i + 1])
    }
    for (const n of numbers) if (n >= 1 && n <= 13) found.add(String(n))
  }

  for (const match of raw.matchAll(CLASS_CODE)) {
    const n = Number(match[1])
    if (n >= 1 && n <= 13) found.add(String(n))
  }

  return [...found]
}

// "Year 6" -> "6", "Reception" -> "reception", "Y3" -> "3"
export function canonicalYearLevel(yearLevel: string): string {
  const v = String(yearLevel || '').toLowerCase().trim()
  if (/reception|^rec\b|^yr$/.test(v)) return 'reception'
  if (/nursery/.test(v)) return 'nursery'
  const n = v.match(/\d{1,2}/)
  return n ? String(Number(n[0])) : v
}

function schoolWords(name: string): Set<string> {
  return new Set(
    String(name || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(w => w.length > 2 && !SCHOOL_STOPWORDS.has(w) && w !== 'the')
  )
}

// Children at the school an item came from. An unknown or unmatched school
// returns everyone, so we never filter on a school we failed to recognise.
function childrenAtSchool(children: any[], schoolName: string | null | undefined): any[] {
  const target = schoolWords(schoolName || '')
  if (target.size === 0) return children
  const matched = children.filter(c => {
    const words = schoolWords(c?.school_name || '')
    for (const w of words) if (target.has(w)) return true
    return false
  })
  return matched.length > 0 ? matched : children
}

// Should this extracted item be kept for this family?
//
// The title is judged on its own when it names a year group, because a
// description cannot be trusted to be about the same year: the model excuses
// itself in prose -- "this is for Y4 families only; Sam is in Y3 so this is not
// directly relevant but included as a whole-school diary item" -- and naming the
// child's own year there would otherwise smuggle the item straight past a check
// on the combined text. The title is the label the parent reads, so the title
// decides. Only when the title names no year group at all does the description
// get a say.
export function matchesAChildsYearGroup(
  title: string,
  description: string | null | undefined,
  schoolName: string | null | undefined,
  children: any[]
): boolean {
  const relevant = childrenAtSchool(children || [], schoolName)
  if (relevant.length === 0) return true // no children on record: keep everything
  const childYears = relevant.map(c => canonicalYearLevel(c.year_level))

  const titleYears = mentionedYearGroups(title)
  if (titleYears.length > 0) return titleYears.some(yr => childYears.includes(yr))

  const bodyYears = mentionedYearGroups(`${title || ''} ${description || ''}`)
  if (bodyYears.length === 0) return true // whole-school or unspecified
  return bodyYears.some(yr => childYears.includes(yr))
}
