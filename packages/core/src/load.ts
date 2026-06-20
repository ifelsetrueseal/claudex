import type { Dictionary } from './types'

/**
 * Platform-independent data loader shared by web / extension / desktop.
 *
 * Strategy: return the best locally-available dictionary instantly (cache if
 * newer than the bundled copy, else bundled), and — when `remoteUrl` is given —
 * refresh from the network in the background, calling `onUpdate` and writing the
 * cache only when a strictly newer build arrives.
 *
 * Everything platform-specific is injected: the remote URL, and the cache get/set
 * (localStorage, chrome.storage, a file, …). `fetch` is the only global used and
 * is available across all target runtimes.
 */
export interface LoadDictionaryOptions {
  /** Bundled fallback, imported at build time. Always present. */
  bundled: Dictionary
  /** Optional URL to fetch a fresher copy from. */
  remoteUrl?: string
  /** Read a previously cached dictionary (platform storage). */
  cacheGet?: () => Promise<Dictionary | null> | Dictionary | null
  /** Persist a freshly fetched dictionary. */
  cacheSet?: (dict: Dictionary) => Promise<void> | void
  /** Called when a strictly newer remote build is fetched in the background. */
  onUpdate?: (dict: Dictionary) => void
}

function isDictionary(x: unknown): x is Dictionary {
  return (
    !!x &&
    typeof x === 'object' &&
    Array.isArray((x as Dictionary).entries) &&
    typeof (x as Dictionary).fetchedAt === 'string'
  )
}

export async function loadDictionary(opts: LoadDictionaryOptions): Promise<Dictionary> {
  const { bundled, remoteUrl, cacheGet, cacheSet, onUpdate } = opts

  let current = bundled
  if (cacheGet) {
    try {
      const cached = await cacheGet()
      if (isDictionary(cached) && cached.fetchedAt >= bundled.fetchedAt) current = cached
    } catch {
      /* ignore cache read errors */
    }
  }

  if (remoteUrl) {
    // Background refresh — never blocks first render.
    void (async () => {
      try {
        const res = await fetch(remoteUrl)
        if (!res.ok) return
        const remote: unknown = await res.json()
        if (isDictionary(remote) && remote.fetchedAt > current.fetchedAt) {
          await cacheSet?.(remote)
          onUpdate?.(remote)
        }
      } catch {
        /* offline / network error → keep current */
      }
    })()
  }

  return current
}
