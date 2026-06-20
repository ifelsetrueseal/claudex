/** Source A — built-in slash commands from the commands reference. */
import type { Entry } from '@claudex/core'
import {
  cleanDescription,
  extractAliases,
  fetchText,
  parseTableRows,
  toSearchText,
  unescapePipes,
} from './lib/markdown'

export const COMMANDS_URL = 'https://code.claude.com/docs/en/commands.md'

/** Split a first-cell value like "/advisor [model|off]" into name + args. */
function splitNameArgs(cell: string): { name: string; args: string } {
  const m = /^(\/[\w-]+)/.exec(cell)
  if (!m) return { name: cell, args: '' }
  return { name: m[1], args: unescapePipes(cell.slice(m[1].length).trim()) }
}

export async function fetchCommands(): Promise<Entry[]> {
  const md = await fetchText(COMMANDS_URL)
  const entries: Entry[] = []

  for (const row of parseTableRows(md)) {
    if (!row.cell.startsWith('/')) continue
    const { name, args } = splitNameArgs(row.cell)
    const description = cleanDescription(row.description)
    entries.push({
      type: 'command',
      name,
      args,
      hasRequiredArg: /<[^>]+>/.test(args),
      description,
      aliases: extractAliases(description),
      searchText: toSearchText(description),
    })
  }

  return entries
}
