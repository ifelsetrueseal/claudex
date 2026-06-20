/** Shared markdown parsing helpers for the collection scripts. */

export const DOCS_BASE = 'https://code.claude.com/docs'

/** Matches a markdown table row whose first cell is a backtick-wrapped value:
 *  `| `<cell>` | <rest...> |`. The first cell is captured even when the
 *  description contains escaped pipes (`\|`) or `[a|b]` notation, because the
 *  command is delimited by backticks and the description is everything up to the
 *  final pipe. */
const TABLE_ROW_RE = /^\s*\|\s*`([^`]+)`\s*\|(.*)\|\s*$/

export interface TableRow {
  /** Raw first-cell content, backticks removed, e.g. "/advisor [model|off]". */
  cell: string
  /** Raw description cell (markdown, not yet cleaned). */
  description: string
}

/** Extract every backtick-first-cell table row from a markdown block. */
export function parseTableRows(md: string): TableRow[] {
  const rows: TableRow[] = []
  for (const line of md.split('\n')) {
    const m = TABLE_ROW_RE.exec(line)
    if (!m) continue
    rows.push({ cell: unescapePipes(m[1].trim()), description: m[2].trim() })
  }
  return rows
}

/** Markdown tables escape literal pipes as `\|`; restore them. */
export function unescapePipes(s: string): string {
  return s.replace(/\\\|/g, '|')
}

/** Drop MDX/JSX comments such as the inline min-version markers. */
export function stripMdxComments(s: string): string {
  return s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
}

/** Turn root-relative doc links (`](/en/foo)`) into absolute URLs. */
export function absolutizeLinks(md: string): string {
  return md.replace(/\]\(\/(?!\/)/g, `](${DOCS_BASE}/`)
}

/** Produce the stored, display-ready description from a raw table cell. */
export function cleanDescription(raw: string): string {
  return absolutizeLinks(stripMdxComments(unescapePipes(raw)))
    .replace(/\s+/g, ' ')
    .trim()
}

/** Strip markdown syntax to plain text for the search index. */
export function toSearchText(description: string): string {
  return description
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links -> link text
    .replace(/`([^`]+)`/g, '$1') // inline code -> code text
    .replace(/[*_#>]/g, '') // emphasis / heading markers
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Aliases appear in descriptions as "Alias: `/bg`" or "Aliases: `/reset`, `/new`".
 * The keyword regex MUST be /Alias(?:es)?:/ — /Aliases?:/ would make the "e"
 * mandatory and miss the singular "Alias:". Slash-commands are collected within
 * ~60 chars after the keyword.
 */
export function extractAliases(description: string): string[] {
  const m = /Alias(?:es)?:/i.exec(description)
  if (!m) return []
  const after = description.slice(m.index + m[0].length, m.index + m[0].length + 60)
  const found = after.match(/\/[\w-]+/g) ?? []
  return [...new Set(found)]
}

/** Fetch a document as text, throwing a useful error on failure. */
export async function fetchText(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`)
  return res.text()
}
