/** Pull recent official Claude Code videos from Anthropic's YouTube RSS feeds.
 *  Free, no API key. Run at build time; results are stored statically. */
import type { OfficialVideo } from '@claudex/core'
import { fetchText } from './markdown'

// @claude (product) + @anthropic-ai (announcements/research)
const CHANNEL_IDS = ['UCV03SRZXJEz-hchIAogeJOg', 'UCrDwWp7EBBv4NwvScIpBDOA']

// Keep only Claude Code-relevant titles (the feeds also carry unrelated content).
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

function parseFeed(xml: string): OfficialVideo[] {
  const out: OfficialVideo[] = []
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1]
    const videoId = /<yt:videoId>([^<]+)<\/yt:videoId>/.exec(e)?.[1]
    const title = decodeEntities(/<title>([^<]*)<\/title>/.exec(e)?.[1] ?? '').trim()
    const published = /<published>([^<]+)<\/published>/.exec(e)?.[1] ?? ''
    if (!videoId || !title || !RELEVANT.test(title)) continue
    out.push({ videoId, title, url: `https://www.youtube.com/watch?v=${videoId}`, published })
  }
  return out
}

/** Return the most recent relevant videos across channels, deduped, newest first. */
export async function fetchOfficialVideos(limit = 8): Promise<OfficialVideo[]> {
  const all: OfficialVideo[] = []
  for (const id of CHANNEL_IDS) {
    try {
      all.push(...parseFeed(await fetchText(feedUrl(id))))
    } catch (err) {
      console.warn(`video feed ${id} failed: ${(err as Error).message}`)
    }
  }
  const seen = new Set<string>()
  return all
    .filter((v) => (seen.has(v.videoId) ? false : seen.add(v.videoId)))
    .sort((a, b) => b.published.localeCompare(a.published))
    .slice(0, limit)
}
