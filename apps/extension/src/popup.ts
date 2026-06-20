import { loadDictionary, search } from '@claudex/core'
import type { Dictionary, Entry, EntryType } from '@claudex/core'
import bundledData from '@claudex/core/data/entries.json'

type Filter = 'all' | EntryType | 'new' | 'videos'
type Lang = 'en' | 'ko'

const bundled = bundledData as unknown as Dictionary
const REMOTE_URL =
  'https://raw.githubusercontent.com/ifelsetrueseal/claudex/main/packages/core/data/entries.json'
const LANG_KEY = 'claudex-lang'
const NEW_WINDOW_DAYS = 21

const I18N = {
  en: {
    search: 'Search… (e.g. clear, review)',
    all: 'All',
    command: 'Commands',
    skill: 'Skills',
    newBadge: 'NEW',
    videos: 'Videos',
    aliases: 'aliases:',
    empty: 'No results.',
    copy: 'Copy command',
    meta: (n: number, d: string) => `${n} entries · ${d}`,
  },
  ko: {
    search: '검색… (예: clear, review)',
    all: '전체',
    command: '명령어',
    skill: '스킬',
    newBadge: '신규',
    videos: '영상',
    aliases: '별칭:',
    empty: '결과 없음.',
    copy: '명령어 복사',
    meta: (n: number, d: string) => `${n}개 · ${d}`,
  },
} as const

const els = {
  q: document.getElementById('q') as HTMLInputElement,
  list: document.getElementById('list') as HTMLElement,
  count: document.getElementById('count') as HTMLElement,
  meta: document.getElementById('meta') as HTMLElement,
  tabs: Array.from(document.querySelectorAll<HTMLButtonElement>('.tab')),
  langs: Array.from(document.querySelectorAll<HTMLButtonElement>('.lang button')),
}

let dict: Dictionary = bundled
let lang: Lang = detectLang()
let filter: Filter = 'all'

function detectLang(): Lang {
  const saved = localStorage.getItem(LANG_KEY)
  if (saved === 'en' || saved === 'ko') return saved
  return (navigator.language || '').toLowerCase().startsWith('ko') ? 'ko' : 'en'
}
const t = () => I18N[lang]

// --- chrome.storage cache adapter ---
function cacheGet(): Promise<Dictionary | null> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get('dict', (o) => resolve((o?.dict as Dictionary) ?? null))
    } catch {
      resolve(null)
    }
  })
}
function cacheSet(d: Dictionary): Promise<void> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set({ dict: d }, () => resolve())
    } catch {
      resolve()
    }
  })
}

// --- safe rendering ---
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
function hl(escaped: string, words: string[]): string {
  const pat = words.filter(Boolean).map(escRegex).join('|')
  return pat ? escaped.replace(new RegExp(`(${pat})`, 'gi'), '<mark>$1</mark>') : escaped
}
function renderArgs(args: string): string {
  if (!args) return ''
  const re = /(<[^>]+>|\[[^\]]+\])/g
  let out = ''
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(args))) {
    if (m.index > last) out += esc(args.slice(last, m.index))
    out += `<span class="${m[0][0] === '<' ? 'arg-req' : 'arg-opt'}">${esc(m[0])}</span>`
    last = re.lastIndex
  }
  if (last < args.length) out += esc(args.slice(last))
  return ` ${out}`
}
function renderName(name: string, words: string[]): string {
  const rest = name.startsWith('/') ? name.slice(1) : name
  return `<span class="slash">/</span>${hl(esc(rest), words)}`
}
function renderDesc(md: string, words: string[]): string {
  const re = /(`[^`]+`)|(\[[^\]]+\]\([^)]+\))/g
  let out = ''
  let last = 0
  let m: RegExpExecArray | null
  const text = (s: string) => hl(esc(s.replace(/\*\*/g, '').replace(/__/g, '')), words)
  while ((m = re.exec(md))) {
    if (m.index > last) out += text(md.slice(last, m.index))
    if (m[1]) {
      out += `<code>${hl(esc(m[1].slice(1, -1)), words)}</code>`
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(m[2])
      if (link && /^https?:\/\//i.test(link[2])) {
        out += `<a href="${esc(link[2])}" target="_blank" rel="noopener noreferrer">${hl(esc(link[1]), words)}</a>`
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
function isNew(e: Entry): boolean {
  if (!dict.baselineAt || !e.firstSeen || e.firstSeen <= dict.baselineAt) return false
  return (Date.now() - Date.parse(e.firstSeen)) / 86_400_000 <= NEW_WINDOW_DAYS
}
function renderEntry(e: Entry, words: string[]): string {
  const fresh = isNew(e)
  const desc = lang === 'ko' && e.descriptionKo ? e.descriptionKo : e.description
  const badge =
    e.type === 'skill'
      ? '<span class="badge skill">SKILL</span>'
      : '<span class="badge cmd">CMD</span>'
  const newBadge = fresh ? `<span class="badge new">${esc(t().newBadge)}</span>` : ''
  const ver = e.minVersion ? `<span class="ver">v${esc(e.minVersion)}</span>` : ''
  const aliases = e.aliases.length
    ? `<div class="aliases">${esc(t().aliases)} ${e.aliases.map((a) => `<code>${esc(a)}</code>`).join(' ')}</div>`
    : ''
  return `<article class="entry ${e.type}${fresh ? ' is-new' : ''}">
    <div class="head">
      <span class="name">${renderName(e.name, words)}${renderArgs(e.args)}</span>
      ${newBadge}${badge}${ver}
      <button class="copy" type="button" data-cmd="${esc(e.name)}" title="${esc(t().copy)}">⧉</button>
    </div>
    ${desc ? `<p class="desc">${renderDesc(desc, words)}</p>` : ''}
    ${aliases}
  </article>`
}

// --- flow ---
function renderVideosView(): void {
  const vids = dict.officialVideos ?? []
  els.count.innerHTML = `<b>${vids.length}</b>`
  els.list.innerHTML = vids.length
    ? `<div class="vgrid">${vids
        .map(
          (v) =>
            `<a class="vcard" href="${esc(v.url)}" target="_blank" rel="noopener noreferrer">
              <img loading="lazy" src="https://i.ytimg.com/vi/${esc(v.videoId)}/mqdefault.jpg" alt="" />
              <div class="vt">${esc(v.title)}</div>
            </a>`,
        )
        .join('')}</div>`
    : `<p class="empty">${esc(t().empty)}</p>`
}

function update(): void {
  if (filter === 'videos') {
    renderVideosView()
    return
  }
  const query = els.q.value.trim()
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  let rows = search(dict.entries, query).map((r) => r.entry)
  if (filter === 'new') rows = rows.filter(isNew)
  else if (filter !== 'all') rows = rows.filter((e) => e.type === filter)

  els.count.innerHTML = `<b>${rows.length}</b> / ${dict.entries.length}`
  els.list.innerHTML = rows.length
    ? rows.map((e) => renderEntry(e, words)).join('')
    : `<p class="empty">${esc(t().empty)}</p>`
}

function applyLang(): void {
  document.documentElement.lang = lang
  els.q.placeholder = t().search
  const newCount = dict.entries.filter(isNew).length
  const videoCount = dict.officialVideos?.length ?? 0
  if (filter === 'new' && newCount === 0) filter = 'all'
  if (filter === 'videos' && videoCount === 0) filter = 'all'
  for (const tab of els.tabs) {
    const key = (tab.dataset.filter as Filter) ?? 'all'
    if (key === 'new') {
      tab.textContent = `${t().newBadge} (${newCount})`
      tab.hidden = newCount === 0
    } else if (key === 'videos') {
      tab.textContent = t().videos
      tab.hidden = videoCount === 0
    } else if (key === 'all') {
      tab.textContent = t().all
    } else {
      tab.textContent = t()[key]
    }
    tab.setAttribute('aria-selected', String(key === filter))
  }
  const stamp = (dict.fetchedAt || '').slice(0, 10)
  els.meta.textContent = t().meta(dict.entries.length, stamp)
  update()
}

function setFilter(next: Filter): void {
  filter = next
  for (const tab of els.tabs) tab.setAttribute('aria-selected', String(tab.dataset.filter === next))
  update()
}
function setLang(next: Lang): void {
  lang = next
  localStorage.setItem(LANG_KEY, next)
  for (const b of els.langs) b.setAttribute('aria-pressed', String(b.dataset.lang === next))
  applyLang()
}

async function boot(): Promise<void> {
  dict = await loadDictionary({
    bundled,
    remoteUrl: REMOTE_URL,
    cacheGet,
    cacheSet,
    onUpdate: (fresh) => {
      dict = fresh
      applyLang()
    },
  })

  for (const b of els.langs) b.setAttribute('aria-pressed', String(b.dataset.lang === lang))
  applyLang()

  els.q.addEventListener('input', () => update())
  for (const tab of els.tabs) {
    tab.addEventListener('click', () => setFilter((tab.dataset.filter as Filter) ?? 'all'))
  }
  for (const b of els.langs) {
    b.addEventListener('click', () => setLang((b.dataset.lang as Lang) ?? 'en'))
  }
  els.list.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.copy') as HTMLButtonElement | null
    if (!btn) return
    void navigator.clipboard.writeText(btn.dataset.cmd ?? '').then(() => {
      const orig = btn.textContent
      btn.textContent = '✓'
      btn.classList.add('ok')
      setTimeout(() => {
        btn.textContent = orig
        btn.classList.remove('ok')
      }, 1200)
    })
  })
  els.q.focus()
}

void boot()
