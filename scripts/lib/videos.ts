/** Pull recent official Claude Code videos from Anthropic's YouTube RSS feeds.
 *  Free, no API key. Run at build time; results are stored statically. */
import type { OfficialVideo } from '@claudex/core'
import { fetchText } from './markdown'

// @claude is all Claude-product content → show everything. @anthropic-ai mixes in
// research/announcements → keep a light relevance filter there.
const CHANNELS = [
  { id: 'UCV03SRZXJEz-hchIAogeJOg', filterRelevant: false }, // @claude
  { id: 'UCrDwWp7EBBv4NwvScIpBDOA', filterRelevant: true }, // @anthropic-ai
]

// Relevance filter (only applied where filterRelevant is true).
const RELEVANT = /claude code|cowork|\bmcp\b|subagent|slash command|agent skill/i

const feedUrl = (channelId: string) =>
  `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x?(\w+);/g, (_m, code: string) =>
      String.fromCodePoint(code.startsWith('x') ? parseInt(code.slice(1), 16) : parseInt(code, 10)),
    )
}

function parseFeed(xml: string, filterRelevant: boolean): OfficialVideo[] {
  const out: OfficialVideo[] = []
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1]
    const videoId = /<yt:videoId>([^<]+)<\/yt:videoId>/.exec(e)?.[1]
    const title = decodeEntities(/<title>([^<]*)<\/title>/.exec(e)?.[1] ?? '').trim()
    const published = /<published>([^<]+)<\/published>/.exec(e)?.[1] ?? ''
    if (!videoId || !title) continue
    if (filterRelevant && !RELEVANT.test(title)) continue
    out.push({ videoId, title, url: `https://www.youtube.com/watch?v=${videoId}`, published })
  }
  return out
}

/** Return the most recent relevant videos across channels, deduped, newest first. */
export async function fetchOfficialVideos(limit = 20): Promise<OfficialVideo[]> {
  const all: OfficialVideo[] = []
  for (const ch of CHANNELS) {
    try {
      all.push(...parseFeed(await fetchText(feedUrl(ch.id)), ch.filterRelevant))
    } catch (err) {
      console.warn(`video feed ${ch.id} failed: ${(err as Error).message}`)
    }
  }
  const seen = new Set<string>()
  return all
    .filter((v) => (seen.has(v.videoId) ? false : seen.add(v.videoId)))
    .sort((a, b) => b.published.localeCompare(a.published))
    .slice(0, limit)
}
