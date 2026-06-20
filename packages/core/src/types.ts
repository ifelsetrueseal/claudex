export type EntryType = 'command' | 'skill'

/** A curated external link for an entry (video, doc, blog post). */
export interface Resource {
  type: 'youtube' | 'docs' | 'blog' | 'link'
  title: string
  url: string
}

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
  /** Date (YYYY-MM-DD) this entry first appeared in our index. Drives the NEW
   *  badge. Carried forward across syncs; set to the run date when first seen. */
  firstSeen: string
  /** Claude Code version this entry was introduced in (e.g. "2.1.169"), parsed
   *  from a leading `min-version` marker in the docs. Empty when not stated. */
  minVersion: string
  /** Curated external links (videos, etc.), merged from data/resources.json. */
  resources: Resource[]
}

/** An official Claude Code video pulled from Anthropic's YouTube feeds. */
export interface OfficialVideo {
  videoId: string
  title: string
  url: string
  published: string
}

export interface Dictionary {
  /** ISO timestamp of when the index was built. */
  fetchedAt: string
  /** Date (YYYY-MM-DD) firstSeen tracking began. Entries with firstSeen newer
   *  than this are genuinely new (the initial batch all equals this date). */
  baselineAt: string
  /** Source document URLs the entries were collected from. */
  sources: string[]
  /** Number of entries. */
  count: number
  entries: Entry[]
  /** Recent official Claude Code videos (auto-collected from YouTube RSS). */
  officialVideos: OfficialVideo[]
}
