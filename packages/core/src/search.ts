import type { Entry } from './types'

export interface SearchResult {
  entry: Entry
  score: number
}

/**
 * Score a single query word against an entry.
 * name exact (100) > name prefix (50) > name substring (30) > alias (20) > description (8).
 * Returns 0 when the word matches nowhere.
 */
function scoreWord(entry: Entry, word: string): number {
  // Users type "clear", not "/clear" — normalize the leading slash on both sides
  // so exact/prefix matches still win.
  const w = word.replace(/^\/+/, '')
  if (!w) return 0
  const name = entry.name.replace(/^\/+/, '').toLowerCase()
  if (name === w) return 100
  if (name.startsWith(w)) return 50
  if (name.includes(w)) return 30
  if (entry.aliases.some((a) => a.replace(/^\/+/, '').toLowerCase().includes(w))) return 20
  if (entry.searchText.toLowerCase().includes(w)) return 8
  return 0
}

/**
 * Pure, platform-independent search.
 * - Multiple words are AND-ed: every word must match somewhere, or the entry is excluded.
 * - Score is the sum of per-word scores; sorted by score desc, then name asc.
 * - An empty query returns every entry with score 0, sorted by name.
 */
export function search(entries: Entry[], query: string): SearchResult[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)

  if (words.length === 0) {
    return [...entries]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => ({ entry, score: 0 }))
  }

  const results: SearchResult[] = []
  for (const entry of entries) {
    let total = 0
    let matchedAll = true
    for (const word of words) {
      const s = scoreWord(entry, word)
      if (s === 0) {
        matchedAll = false
        break
      }
      total += s
    }
    if (matchedAll) results.push({ entry, score: total })
  }

  results.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
  return results
}
