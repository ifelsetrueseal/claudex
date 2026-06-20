import { search } from '@claudex/core'
import type { Dictionary, Entry, EntryType } from '@claudex/core'

type Filter = 'all' | EntryType | 'new'
type Lang = 'en' | 'ko'

const DATA_URL = `${import.meta.env.BASE_URL}data/entries.json`
const COMMANDS_DOC = 'https://code.claude.com/docs/en/commands'
const LANG_KEY = 'claudex-lang'
const NEW_WINDOW_DAYS = 21 // how long an entry keeps its NEW badge after first seen

const I18N = {
  en: {
    tagline: 'Claude Code built-in commands & bundled skills · updated regularly',
    search: 'Search commands & skills…  (e.g. clear, review, model)',
    all: 'All',
    command: 'Commands',
    skill: 'Skills',
    empty: 'No results. Try another search.',
    loading: 'Loading…',
    registered: (n: number) => `<strong>${n}</strong> entries registered`,
    updated: (d: string) => `updated ${d}`,
    source: 'source:',
    aliases: 'aliases:',
    newBadge: 'NEW',
    copy: 'Copy command',
    loadError: 'Failed to load data. Did you run <code>pnpm sync</code> first?',
    footerLead: 'claudex is an unofficial tool. Data from',
    footerSource: 'Anthropic official docs',
    footerDaily: 'Auto-collected and indexed.',
  },
  ko: {
    tagline: 'Claude Code 빌트인 명령어와 번들 스킬 도감 · 주기적 업데이트',
    search: '명령어·스킬 검색…  (예: clear, review, model)',
    all: '전체',
    command: '명령어',
    skill: '스킬',
    empty: '결과 없음. 다른 검색어를 시도해보세요.',
    loading: '불러오는 중…',
    registered: (n: number) => `<strong>${n}</strong>개 등록됨`,
    updated: (d: string) => `업데이트 ${d}`,
    source: '출처:',
    aliases: '별칭:',
    newBadge: '신규',
    copy: '명령어 복사',
    loadError: '데이터를 불러오지 못했습니다. <code>pnpm sync</code> 를 먼저 실행했나요?',
    footerLead: 'claudex는 비공식 도구입니다. 데이터 출처는',
    footerSource: 'Anthropic 공식 문서',
    footerDaily: '매일 자동 수집되어 색인됩니다.',
  },
} as const

const els = {
  q: document.getElementById('q') as HTMLInputElement,
  results: document.getElementById('results') as HTMLElement,
  count: document.getElementById('count') as HTMLElement,
  meta: document.getElementById('meta') as HTMLElement,
  tagline: document.getElementById('tagline') as HTMLElement,
  footer: document.getElementById('footer') as HTMLElement,
  tabs: Array.from(document.querySelectorAll<HTMLButtonElement>('.tab')),
  langs: Array.from(document.querySelectorAll<HTMLButtonElement>('.lang button')),
}

let all: Entry[] = []
let dict: Dictionary | null = null
let filter: Filter = 'all'
let lang: Lang = detectLang()

function detectLang(): Lang {
  const saved = localStorage.getItem(LANG_KEY)
  if (saved === 'en' || saved === 'ko') return saved
  return (navigator.language || '').toLowerCase().startsWith('ko') ? 'ko' : 'en'
}

function t() {
  return I18N[lang]
}

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
 * Render inline markdown (links + `code`) from a description safely.
 * Only http(s) links become anchors; everything is escaped before output and
 * highlight is applied only to text that contains no markup.
 */
function renderDesc(md: string, words: string[]): string {
  const re = /(`[^`]+`)|(\[[^\]]+\]\([^)]+\))/g
  let out = ''
  let last = 0
  let m: RegExpExecArray | null

  const text = (s: string) => highlight(esc(s.replace(/\*\*/g, '').replace(/__/g, '')), words)

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

/** New = first seen after tracking began, and still within the badge window. */
function isNew(entry: Entry): boolean {
  if (!dict?.baselineAt || !entry.firstSeen) return false
  if (entry.firstSeen <= dict.baselineAt) return false
  const ageDays = (Date.now() - Date.parse(entry.firstSeen)) / 86_400_000
  return ageDays <= NEW_WINDOW_DAYS
}

function renderEntry(entry: Entry, words: string[]): string {
  const fresh = isNew(entry)
  const badge =
    entry.type === 'skill'
      ? '<span class="badge skill">SKILL</span>'
      : '<span class="badge cmd">CMD</span>'
  const newBadge = fresh ? `<span class="badge new">${esc(t().newBadge)}</span>` : ''
  const ver = entry.minVersion ? `<span class="ver">v${esc(entry.minVersion)}</span>` : ''
  // Show Korean description when selected and available; fall back to English.
  const desc = lang === 'ko' && entry.descriptionKo ? entry.descriptionKo : entry.description
  const aliases = entry.aliases.length
    ? `<div class="aliases">${esc(t().aliases)} ${entry.aliases.map((a) => `<code>${esc(a)}</code>`).join(' ')}</div>`
    : ''
  return `<article class="entry ${entry.type}${fresh ? ' is-new' : ''}">
    <div class="entry-head">
      <span class="name">${renderName(entry.name, words)}${renderArgs(entry.args)}</span>
      ${newBadge}${badge}${ver}
      <button class="copy" type="button" data-cmd="${esc(entry.name)}" title="${esc(t().copy)}" aria-label="${esc(t().copy)}: ${esc(entry.name)}">⧉</button>
    </div>
    ${desc ? `<p class="desc">${renderDesc(desc, words)}</p>` : ''}
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
  if (filter === 'new') scored = scored.filter(isNew)
  else if (filter !== 'all') scored = scored.filter((e) => e.type === filter)

  els.count.innerHTML = `<b>${scored.length}</b> / ${all.length}`
  els.results.innerHTML = scored.length
    ? scored.map((e) => renderEntry(e, words)).join('')
    : `<p class="empty">${esc(t().empty)}</p>`
}

function setFilter(next: Filter): void {
  filter = next
  for (const tab of els.tabs) {
    tab.setAttribute('aria-selected', String(tab.dataset.filter === next))
  }
  update()
}

function renderMeta(): void {
  if (!dict) return
  const d = new Date(dict.fetchedAt)
  const stamp = Number.isNaN(d.getTime()) ? dict.fetchedAt : d.toISOString().slice(0, 10)
  const sources = dict.sources
    .map(
      (u) =>
        `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(new URL(u).pathname.replace(/^\/en\//, ''))}</a>`,
    )
    .join(' · ')
  els.meta.innerHTML = `<span>${t().registered(dict.count)}</span>
    <span>${esc(t().updated(stamp))}</span>
    <span>${esc(t().source)} ${sources}</span>`
}

/** Apply all language-dependent static text and re-render. */
function applyLang(): void {
  document.documentElement.lang = lang
  els.tagline.textContent = t().tagline
  els.q.placeholder = t().search

  // The NEW tab only appears when new entries exist; reset away from it if empty.
  const newCount = all.filter(isNew).length
  if (filter === 'new' && newCount === 0) filter = 'all'

  for (const tab of els.tabs) {
    const key = (tab.dataset.filter as Filter) ?? 'all'
    if (key === 'new') {
      tab.textContent = `${t().newBadge} (${newCount})`
      tab.hidden = newCount === 0
    } else if (key === 'all') {
      tab.textContent = t().all
    } else {
      tab.textContent = t()[key]
    }
    tab.setAttribute('aria-selected', String(key === filter))
  }
  for (const b of els.langs) {
    b.setAttribute('aria-pressed', String(b.dataset.lang === lang))
  }
  els.footer.innerHTML = `${esc(t().footerLead)} <a href="${COMMANDS_DOC}" target="_blank" rel="noopener noreferrer">${esc(t().footerSource)}</a>.<br />${esc(t().footerDaily)}`
  renderMeta()
  update()
}

function setLang(next: Lang): void {
  lang = next
  localStorage.setItem(LANG_KEY, next)
  applyLang()
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function copyText(s: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(s)
    return true
  } catch {
    // Fallback for non-secure contexts / older browsers.
    try {
      const ta = document.createElement('textarea')
      ta.value = s
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}

/** Delegated handler so copy buttons survive result re-renders. */
function onResultsClick(e: MouseEvent): void {
  const btn = (e.target as HTMLElement).closest('.copy') as HTMLButtonElement | null
  if (!btn) return
  const cmd = btn.dataset.cmd ?? ''
  void copyText(cmd).then((ok) => {
    if (!ok) return
    const original = btn.textContent
    btn.textContent = '✓'
    btn.classList.add('ok')
    setTimeout(() => {
      btn.textContent = original
      btn.classList.remove('ok')
    }, 1200)
  })
}

function debounce<T extends (...a: never[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout>
  return ((...args: never[]) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }) as T
}

async function boot(): Promise<void> {
  els.results.innerHTML = `<p class="status">${esc(t().loading)}</p>`
  try {
    const res = await fetch(DATA_URL)
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    dict = (await res.json()) as Dictionary
    all = dict.entries
  } catch (err) {
    els.results.innerHTML = `<p class="empty">${t().loadError}</p>`
    console.error(err)
    // Still apply static UI text so the language toggle works.
    els.tagline.textContent = t().tagline
    els.q.placeholder = t().search
    return
  }

  applyLang()

  els.q.addEventListener('input', debounce(update, 80))
  els.results.addEventListener('click', onResultsClick)
  for (const tab of els.tabs) {
    tab.addEventListener('click', () => setFilter((tab.dataset.filter as Filter) ?? 'all'))
  }
  for (const b of els.langs) {
    b.addEventListener('click', () => setLang((b.dataset.lang as Lang) ?? 'en'))
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
