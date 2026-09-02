// Comparing school-notice titles. Titles are required by the prompt to carry
// the school name, so a naive shared-word count marks every notice from one
// school as a duplicate of the last: "Windmills Junior School - Medication in
// School" and "Windmills Junior School: Packed Lunch Tomorrow" already share
// two words before you reach what they are about. Drop the school's own words
// before comparing, and require the overlap to be a real share of the shorter
// title rather than just two hits.
//
// Used both when saving a notice (skip a genuine repeat) and when building the
// digest (hide a notice that restates an event of the same week). Both had
// their own copy of the naive version, and both suppressed real news.
export const SCHOOL_STOPWORDS = new Set([
  'school', 'schools', 'junior', 'juniors', 'infant', 'infants', 'primary',
  'secondary', 'academy', 'college', 'nursery', 'preschool'
])

export function distinctiveWords(title: string, schoolNames: string[]): Set<string> {
  const noise = new Set(SCHOOL_STOPWORDS)
  for (const name of schoolNames) {
    for (const w of String(name).toLowerCase().split(/[^a-z0-9]+/)) {
      if (w.length > 3) noise.add(w)
    }
  }
  const words = new Set<string>()
  for (const raw of String(title).split(/[^A-Za-z0-9]+/)) {
    if (!raw) continue
    const w = raw.toLowerCase()
    if (noise.has(w)) continue
    // An all-caps token is an acronym (PGL, PTA, SEND) and is as distinctive as
    // a long word, so don't discard it for being short.
    const isAcronym = raw.length >= 2 && raw === raw.toUpperCase() && /[A-Z]/.test(raw)
    if (w.length > 3 || isAcronym) words.add(w)
  }
  return words
}

export function sharedDistinctiveWords(a: string, b: string, schoolNames: string[]): number {
  const aw = distinctiveWords(a, schoolNames)
  const bw = distinctiveWords(b, schoolNames)
  let common = 0
  for (const w of aw) if (bw.has(w)) common++
  return common
}

// Is this notice a repeat of one already saved? Used at extraction time.
export function noticesAreSimilar(a: string, b: string, schoolNames: string[]): boolean {
  const aw = distinctiveWords(a, schoolNames)
  const bw = distinctiveWords(b, schoolNames)
  if (aw.size === 0 || bw.size === 0) return false
  const common = sharedDistinctiveWords(a, b, schoolNames)
  return common >= 2 && common >= Math.min(aw.size, bw.size) * 0.5
}

// Does this notice restate an event the digest already shows? A shared day is
// the strong signal -- a notice dated the same day as an event, with any word
// in common, is almost always the same item said twice ("PGL Medical Consent
// Form" against "PGL Residential Trip" on the 14th). Without a shared day it
// takes two words, so an unrelated notice that merely says "deadline" survives.
export function noticeRestatesEvent(
  noticeTitle: string,
  noticeDate: string | null,
  eventTitle: string,
  eventDate: string | null,
  schoolNames: string[]
): boolean {
  const shared = sharedDistinctiveWords(noticeTitle, eventTitle, schoolNames)
  if (shared === 0) return false
  if (noticeDate && eventDate && noticeDate === eventDate) return true
  return shared >= 2
}

