import { search } from '@claudex/core'
import type { Dictionary, Entry, EntryType } from '@claudex/core'

type Filter = 'all' | EntryType

const DATA_URL = `${import.meta.env.BASE_URL}data/entries.json`

const els = {
  q: document.getElementById('q') as HTMLInputElement,
  results: document.getElementById('results') as HTMLElement,
  count: document.getElementById('count') as HTMLElement,
  meta: document.getElementById('meta') as HTMLElement,
  tabs: Array.from(document.querySelectorAll<HTMLButtonElement>('.tab')),
}

let all: Entry[] = []
let filter: Filter = 'all'

// ---------------------------------------------------------------------------
// Safe rendering helpers (escape first, then add controlled markup)
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Wrap query matches in <mark>. Input MUST already be escaped and tag-free. */
function highlight(escaped: string, words: string[]): string {
  const pat = words.filter(Boolean).map(escRegex).join('|')
  if (!pat) return escaped
  return escaped.replace(new RegExp(`(${pat})`, 'gi'), '<mark>$1</mark>')
}

/** Render the argument notation, coloring <required> gold and [optional] cyan. */
function renderArgs(args: string): string {
  if (!args) return ''
  const re = /(<[^>]+>|\[[^\]]+\])/g
  let out = ''
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(args))) {
    if (m.index > last) out += esc(args.slice(last, m.index))
    const cls = m[0][0] === '<' ? 'arg-req' : 'arg-opt'
    out += `<span class="${cls}">${esc(m[0])}</span>`
    last = re.lastIndex
  }
  if (last < args.length) out += esc(args.slice(last))
  return ` ${out}`
}

function renderName(name: string, words: string[]): string {
  const rest = name.startsWith('/') ? name.slice(1) : name
  return `<span class="slash">/</span>${highlight(esc(rest), words)}`
}

/**
 * Render inline markdown (links + `code`) from the description safely.
 * Only http(s) links become anchors; everything is escaped before output and
 * highlight is applied only to text that contains no markup.
 */
function renderDesc(md: string, words: string[]): string {
  const re = /(`[^`]+`)|(\[[^\]]+\]\([^)]+\))/g
  let out = ''
  let last = 0
  let m: RegExpExecArray | null

  const text = (t: string) => highlight(esc(t.replace(/\*\*/g, '').replace(/__/g, '')), words)

  while ((m = re.exec(md))) {
    if (m.index > last) out += text(md.slice(last, m.index))
    if (m[1]) {
      out += `<code>${highlight(esc(m[1].slice(1, -1)), words)}</code>`
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(m[2])
      if (link && /^https?:\/\//i.test(link[2])) {
        out += `<a href="${esc(link[2])}" target="_blank" rel="noopener noreferrer">${highlight(esc(link[1]), words)}</a>`
      } else if (link) {
        out += text(link[1])
      } else {
        out += text(m[2])
      }
    }
    last = re.lastIndex
  }
  if (last < md.length) out += text(md.slice(last))
  return out
}

function renderEntry(entry: Entry, words: string[]): string {
  const badge =
    entry.type === 'skill'
      ? '<span class="badge skill">SKILL</span>'
      : '<span class="badge cmd">CMD</span>'
  const aliases = entry.aliases.length
    ? `<div class="aliases">aliases: ${entry.aliases.map((a) => `<code>${esc(a)}</code>`).join(' ')}</div>`
    : ''
  return `<article class="entry ${entry.type}">
    <div class="entry-head">
      <span class="name">${renderName(entry.name, words)}${renderArgs(entry.args)}</span>
      ${badge}
    </div>
    ${entry.description ? `<p class="desc">${renderDesc(entry.description, words)}</p>` : ''}
    ${aliases}
  </article>`
}

// ---------------------------------------------------------------------------
// Search + render flow (search logic lives in @claudex/core)
// ---------------------------------------------------------------------------

function update(): void {
  const query = els.q.value.trim()
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)

  let scored = search(all, query).map((r) => r.entry)
  if (filter !== 'all') scored = scored.filter((e) => e.type === filter)

  els.count.innerHTML = `<b>${scored.length}</b> / ${all.length}`

  els.results.innerHTML = scored.length
    ? scored.map((e) => renderEntry(e, words)).join('')
    : '<p class="empty">결과 없음. 다른 검색어를 시도해보세요.</p>'
}

function setFilter(next: Filter): void {
  filter = next
  for (const tab of els.tabs) {
    tab.setAttribute('aria-selected', String(tab.dataset.filter === next))
  }
  update()
}

function renderMeta(dict: Dictionary): void {
  const date = new Date(dict.fetchedAt)
  const stamp = Number.isNaN(date.getTime())
    ? dict.fetchedAt
    : date.toISOString().slice(0, 10)
  const sources = dict.sources
    .map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(new URL(u).pathname.replace(/^\/en\//, ''))}</a>`)
    .join(' · ')
  els.meta.innerHTML = `<span><strong>${dict.count}</strong> entries registered</span>
    <span>updated ${esc(stamp)}</span>
    <span>출처: ${sources}</span>`
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function debounce<T extends (...a: never[]) => void>(fn: T, ms: number): T {
  let t: ReturnType<typeof setTimeout>
  return ((...args: never[]) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }) as T
}

async function boot(): Promise<void> {
  try {
    const res = await fetch(DATA_URL)
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    const dict = (await res.json()) as Dictionary
    all = dict.entries
    renderMeta(dict)
    update()
  } catch (err) {
    els.results.innerHTML = `<p class="empty">데이터를 불러오지 못했습니다. <code>pnpm sync</code> 를 먼저 실행했는지 확인하세요.</p>`
    console.error(err)
    return
  }

  els.q.addEventListener('input', debounce(update, 80))
  for (const tab of els.tabs) {
    tab.addEventListener('click', () => setFilter((tab.dataset.filter as Filter) ?? 'all'))
  }

  // "/" focuses the search box (unless already typing in a field).
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
    const active = document.activeElement
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return
    e.preventDefault()
    els.q.focus()
  })
}

void boot()
