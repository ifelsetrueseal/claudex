/**
 * DeepL-based EN→KO translation for entry descriptions.
 *
 * Markdown safety: URLs and inline code must NOT be translated or reformatted.
 * We escape the text, wrap the untranslatable spans in `<x>…</x>`, and use
 * DeepL's XML tag handling with `ignore_tags=x`. Link display text stays outside
 * the tags so it still gets translated. After translation we strip the wrappers
 * and unescape. Only DEEPL_API_KEY (free keys end in ":fx") is needed.
 */

const BATCH = 40 // DeepL allows up to 50 text params per request

/** Free keys end in ":fx" and use api-free; paid/developer keys use api. */
function endpointFor(apiKey: string): string {
  return apiKey.trim().endsWith(':fx')
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate'
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Escape, then wrap inline code and markdown link URLs in ignore tags. */
export function maskMarkdown(md: string): string {
  let s = escapeXml(md)
  // `inline code` -> <x>`inline code`</x>  (backticks preserved, not translated)
  s = s.replace(/`[^`]+`/g, (m) => `<x>${m}</x>`)
  // [text](url) -> [text](<x>url</x>)  (text still translatable, url frozen)
  s = s.replace(/(\]\()([^)]+)(\))/g, (_m, open, url, close) => `${open}<x>${url}</x>${close}`)
  return s
}

/** Remove ignore-tag wrappers and unescape entities. */
export function unmask(s: string): string {
  return s
    .replace(/<\/?x>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function* chunks<T>(arr: T[], size: number): Generator<T[]> {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size)
}

/**
 * Translate texts EN→KO, preserving order. Markdown links/code are kept intact.
 * Throws on API error so a failed run never silently writes bad data.
 */
export async function translateBatch(texts: string[], apiKey: string): Promise<string[]> {
  const url = endpointFor(apiKey)
  const out: string[] = []
  for (const chunk of chunks(texts, BATCH)) {
    const body = new URLSearchParams()
    body.set('source_lang', 'EN')
    body.set('target_lang', 'KO')
    body.set('tag_handling', 'xml')
    body.set('ignore_tags', 'x')
    for (const t of chunk) body.append('text', maskMarkdown(t))

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    })
    if (!res.ok) {
      throw new Error(`DeepL request failed: ${res.status} ${res.statusText} — ${await res.text()}`)
    }
    const json = (await res.json()) as { translations: { text: string }[] }
    for (const tr of json.translations) out.push(unmask(tr.text))
  }
  return out
}
