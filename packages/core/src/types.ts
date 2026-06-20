export type EntryType = 'command' | 'skill'

export interface Entry {
  /** 'command' (built-in slash command) or 'skill' (bundled skill). */
  type: EntryType
  /** Slash-prefixed name, e.g. "/clear". */
  name: string
  /** Raw argument notation, e.g. "<path>", "[instructions]", "". */
  args: string
  /** True when args contains at least one required `<...>` placeholder. */
  hasRequiredArg: boolean
  /** Description in markdown (relative links absolutized). English (source). */
  description: string
  /** Korean translation of `description` (markdown; links/code preserved).
   *  Empty string when not yet translated. */
  descriptionKo: string
  /** Aliases, e.g. ["/reset", "/new"]. */
  aliases: string[]
  /** Plain text (markdown/links stripped) used for searching. */
  searchText: string
}

export interface Dictionary {
  /** ISO timestamp of when the index was built. */
  fetchedAt: string
  /** Source document URLs the entries were collected from. */
  sources: string[]
  /** Number of entries. */
  count: number
  entries: Entry[]
}
