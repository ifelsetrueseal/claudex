/** Source B — bundled skills from the skills reference. */
import type { Entry } from '@claudex/core'
import {
  cleanDescription,
  fetchText,
  parseTableRows,
  toSearchText,
} from './lib/markdown'

export const SKILLS_URL = 'https://code.claude.com/docs/en/skills.md'

/** Isolate the "## Bundled skills" section (up to the next level-2 heading). */
function bundledSection(md: string): string {
  const start = md.search(/^##\s+Bundled skills\b/m)
  if (start === -1) return ''
  const rest = md.slice(start)
  const next = rest.slice(1).search(/^##\s+(?!#)/m)
  return next === -1 ? rest : rest.slice(0, next + 1)
}

function makeSkill(name: string, description: string): Entry {
  return {
    type: 'skill',
    name,
    args: '',
    hasRequiredArg: false,
    description,
    descriptionKo: '',
    aliases: [],
    searchText: toSearchText(description),
    firstSeen: '',
    minVersion: '',
    resources: [],
  }
}

export async function fetchSkills(): Promise<Entry[]> {
  const md = await fetchText(SKILLS_URL)
  const section = bundledSection(md)
  if (!section) return []

  const byName = new Map<string, Entry>()

  // 1) The "Run and verify your app" table gives name + real description.
  for (const row of parseTableRows(section)) {
    if (!row.cell.startsWith('/')) continue
    byName.set(row.cell, makeSkill(row.cell, cleanDescription(row.description)))
  }

  // 2) Inline-mentioned bundled skills (e.g. "including `/code-review`, ...").
  //    These have no table, so they get a placeholder description.
  for (const m of section.matchAll(/`(\/[\w-]+)`/g)) {
    const name = m[1]
    if (!byName.has(name)) byName.set(name, makeSkill(name, 'Bundled skill'))
  }

  return [...byName.values()]
}
