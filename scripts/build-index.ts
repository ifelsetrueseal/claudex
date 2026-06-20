/** Merge sources A + B into the canonical dictionary at packages/core/data. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Dictionary, Entry, Resource } from '@claudex/core'
import { COMMANDS_URL, fetchCommands } from './fetch-commands'
import { SKILLS_URL, fetchSkills } from './fetch-skills'
import { toSearchText } from './lib/markdown'
import { translateBatch } from './lib/translate'
import { fetchOfficialVideos } from './lib/videos'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CORE_PATH = resolve(__dirname, '../packages/core/data/entries.json')
const WEB_PATH = resolve(__dirname, '../apps/web/public/data/entries.json')
const RESOURCES_PATH = resolve(__dirname, '../packages/core/data/resources.json')

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

/** Load curated links keyed by entry name (keys starting with "_" are notes). */
function loadResources(): Record<string, Resource[]> {
  if (!existsSync(RESOURCES_PATH)) return {}
  const raw = JSON.parse(readFileSync(RESOURCES_PATH, 'utf8')) as Record<string, unknown>
  const map: Record<string, Resource[]> = {}
  for (const [name, val] of Object.entries(raw)) {
    if (name.startsWith('_') || !Array.isArray(val)) continue
    map[name] = val as Resource[]
  }
  return map
}

/**
 * Populate `descriptionKo` (EN→KO) incrementally:
 * - Reuse a prior translation whenever the English description is unchanged
 *   (cache hit → no API call). Only changed/new descriptions are translated,
 *   so monthly DeepL usage stays far inside the free tier.
 * - Translation runs only when DEEPL_API_KEY is set; otherwise prior Korean is
 *   preserved and new entries stay empty (UI falls back to English).
 * - When Korean exists, its plain text is appended to `searchText` so Korean
 *   queries match too.
 */
async function applyTranslations(entries: Entry[], prevByName: Map<string, Entry>): Promise<void> {
  const apiKey = process.env.DEEPL_API_KEY
  const pending: Entry[] = []

  for (const e of entries) {
    const prev = prevByName.get(e.name)
    if (prev && prev.description === e.description && prev.descriptionKo) {
      e.descriptionKo = prev.descriptionKo // cache hit
    } else {
      e.descriptionKo = prev?.descriptionKo ?? '' // tentative; translated below if key present
      pending.push(e)
    }
  }

  if (pending.length === 0) {
    console.log('translations: all cached (0 to translate)')
  } else if (!apiKey) {
    console.log(`translations: DEEPL_API_KEY not set — skipping ${pending.length} entries (kept prior KO)`)
  } else {
    console.log(`translations: translating ${pending.length} changed/new descriptions via DeepL…`)
    const translated = await translateBatch(pending.map((e) => e.description), apiKey)
    pending.forEach((e, i) => (e.descriptionKo = translated[i]))
  }

  // Make Korean text searchable too (searchText is regenerated EN-only upstream).
  for (const e of entries) {
    if (e.descriptionKo) e.searchText = `${e.searchText} ${toSearchText(e.descriptionKo)}`.trim()
  }
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

  // Load the previous index once: reused for the translation cache AND the diff.
  const prev: Dictionary | null = existsSync(CORE_PATH)
    ? (JSON.parse(readFileSync(CORE_PATH, 'utf8')) as Dictionary)
    : null
  const prevByName = new Map<string, Entry>((prev?.entries ?? []).map((e) => [e.name, e]))

  // Track when each entry first appeared. The baseline is the date tracking
  // began; on the first run every entry shares it (so nothing is flagged "new").
  const today = new Date().toISOString().slice(0, 10)
  const baselineAt = prev?.baselineAt ?? today
  let newCount = 0
  for (const e of entries) {
    e.firstSeen = prevByName.get(e.name)?.firstSeen || today
    if (e.firstSeen > baselineAt) newCount++
  }
  console.log(`firstSeen: baseline ${baselineAt}, ${newCount} entries newer than baseline`)

  // Attach curated links from resources.json (keyed by entry name).
  const resourceMap = loadResources()
  let resourceCount = 0
  for (const e of entries) {
    e.resources = resourceMap[e.name] ?? []
    if (e.resources.length) resourceCount++
  }
  console.log(`resources: attached to ${resourceCount} entries`)

  // Fill descriptionKo (incremental, cache-aware) before diffing.
  await applyTranslations(entries, prevByName)

  // Pull official Claude Code videos (RSS, no key). Keep previous on failure.
  let officialVideos = prev?.officialVideos ?? []
  const fetchedVideos = await fetchOfficialVideos(8)
  if (fetchedVideos.length) officialVideos = fetchedVideos
  console.log(`official videos: ${officialVideos.length}`)

  // Compare against the previous index (entries only, ignoring fetchedAt).
  // When nothing changed, keep the previous fetchedAt so the written file is
  // byte-identical — that way the daily/weekly CI run produces no empty commit.
  let fetchedAt = new Date().toISOString()
  if (prev) {
    const changed =
      JSON.stringify(prev.entries) !== JSON.stringify(entries) ||
      JSON.stringify(prev.officialVideos) !== JSON.stringify(officialVideos)
    if (changed) {
      console.log('entries CHANGED since last sync')
    } else {
      console.log('no entry changes since last sync — preserving fetchedAt (no-op write)')
      fetchedAt = prev.fetchedAt
    }
  } else {
    console.log('no previous index — creating fresh')
  }

  const dict: Dictionary = {
    fetchedAt,
    baselineAt,
    sources: [COMMANDS_URL, SKILLS_URL],
    count: entries.length,
    entries,
    officialVideos,
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
