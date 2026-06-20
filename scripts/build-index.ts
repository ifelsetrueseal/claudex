/** Merge sources A + B into the canonical dictionary at packages/core/data. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Dictionary, Entry } from '@claudex/core'
import { COMMANDS_URL, fetchCommands } from './fetch-commands'
import { SKILLS_URL, fetchSkills } from './fetch-skills'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CORE_PATH = resolve(__dirname, '../packages/core/data/entries.json')
const WEB_PATH = resolve(__dirname, '../apps/web/public/data/entries.json')

const PLACEHOLDER = 'Bundled skill'

/**
 * Merge by name. Many bundled skills also appear in commands.md (richer text);
 * for those we keep the existing description but flip the type to 'skill' and
 * union the aliases. A skill seen only in source B is added as-is.
 */
function merge(commands: Entry[], skills: Entry[]): Entry[] {
  const byName = new Map<string, Entry>()
  for (const c of commands) byName.set(c.name, { ...c })

  for (const s of skills) {
    const existing = byName.get(s.name)
    if (!existing) {
      byName.set(s.name, { ...s })
      continue
    }
    existing.type = 'skill'
    existing.aliases = [...new Set([...existing.aliases, ...s.aliases])]
    // Prefer the richer (longer) real description.
    if (
      s.description &&
      s.description !== PLACEHOLDER &&
      s.description.length > existing.description.length
    ) {
      existing.description = s.description
      existing.searchText = s.searchText
    }
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function writeJson(path: string, dict: Dictionary): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(dict, null, 2) + '\n')
}

async function main(): Promise<void> {
  const [commands, skills] = await Promise.all([fetchCommands(), fetchSkills()])
  console.log(`fetched ${commands.length} commands, ${skills.length} skills`)

  // Guard against silent doc-structure changes.
  if (commands.length < 30) {
    throw new Error(`Only ${commands.length} commands parsed — commands.md structure may have changed.`)
  }
  if (skills.length < 3) {
    throw new Error(`Only ${skills.length} skills parsed — skills.md structure may have changed.`)
  }

  const entries = merge(commands, skills)
  const skillCount = entries.filter((e) => e.type === 'skill').length
  console.log(`merged into ${entries.length} entries (${skillCount} marked as skill)`)

  // Report changes (entries only, ignoring fetchedAt) for a stable diff log.
  if (existsSync(CORE_PATH)) {
    const prev = JSON.parse(readFileSync(CORE_PATH, 'utf8')) as Dictionary
    const changed = JSON.stringify(prev.entries) !== JSON.stringify(entries)
    console.log(changed ? 'entries CHANGED since last sync' : 'no entry changes since last sync')
  } else {
    console.log('no previous index — creating fresh')
  }

  const dict: Dictionary = {
    fetchedAt: new Date().toISOString(),
    sources: [COMMANDS_URL, SKILLS_URL],
    count: entries.length,
    entries,
  }

  writeJson(CORE_PATH, dict)
  writeJson(WEB_PATH, dict)
  console.log(`wrote ${CORE_PATH}`)
  console.log(`wrote ${WEB_PATH}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
