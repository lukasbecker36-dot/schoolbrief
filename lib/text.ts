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
  return new Set(
    String(title).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3 && !noise.has(w))
  )
}

export function noticesAreSimilar(a: string, b: string, schoolNames: string[]): boolean {
  const aw = distinctiveWords(a, schoolNames)
  const bw = distinctiveWords(b, schoolNames)
  if (aw.size === 0 || bw.size === 0) return false
  let common = 0
  for (const w of aw) if (bw.has(w)) common++
  return common >= 2 && common >= Math.min(aw.size, bw.size) * 0.5
}

