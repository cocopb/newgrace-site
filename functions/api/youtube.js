// 새은혜교회 유튜브 채널의 최신 영상 목록을 돌려주는 기능
// 주소: /api/youtube  (Cloudflare Pages Functions)
//
// 가져오는 순서
//  ① YouTube Data API (Cloudflare 설정에 YT_API_KEY가 있으면) – 가장 안정적
//  ② 유튜브 RSS 피드 (채널 → 업로드 재생목록)
//  ③ 모두 실패하면 마지막으로 성공했던 결과
// 성공한 결과는 10분 동안 재사용해서 API 사용량을 아껴요.

const CHANNEL_ID = 'UCsDQiQTRLlhI5z17cuj_-SQ';
const UPLOADS = 'UU' + CHANNEL_ID.slice(2);
const FEEDS = [
  `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`,
  `https://www.youtube.com/feeds/videos.xml?playlist_id=${UPLOADS}`,
];
const FRESH_KEY = 'https://newgrace-cache.internal/youtube-fresh';
const LAST_GOOD_KEY = 'https://newgrace-cache.internal/youtube-last-good';

const decode = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&amp;/g, '&');

export function parseFeed(xml) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].slice(0, 10).map(([, e]) => {
    const pick = (re) => (e.match(re) || [])[1] || '';
    return {
      id: pick(/<yt:videoId>([^<]+)<\/yt:videoId>/),
      title: decode(pick(/<title>([\s\S]*?)<\/title>/)).trim(),
      published: pick(/<published>([^<]+)<\/published>/),
      description: decode(pick(/<media:description>([\s\S]*?)<\/media:description>/)),
    };
  }).filter((v) => v.id);
}

export function parseApi(data) {
  return (data.items || []).map((it) => ({
    id: it.snippet?.resourceId?.videoId || '',
    title: (it.snippet?.title || '').trim(),
    published: it.contentDetails?.videoPublishedAt || it.snippet?.publishedAt || '',
    description: it.snippet?.description || '',
  })).filter((v) => v.id && v.title !== 'Private video' && v.title !== 'Deleted video');
}

const json = (body, status = 200, maxAge = 600) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': status === 200 ? `public, max-age=${maxAge}` : 'no-store',
  },
});

async function fromApi(key) {
  const url = 'https://www.googleapis.com/youtube/v3/playlistItems'
    + `?part=snippet,contentDetails&maxResults=10&playlistId=${UPLOADS}&key=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`api ${res.status}`);
  const videos = parseApi(await res.json());
  if (!videos.length) throw new Error('api empty');
  return videos;
}

async function fromFeed(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; NewGraceChurchSite/1.0)' },
    cf: { cacheTtlByStatus: { '200-299': 600, '400-599': 0 } },
  });
  if (!res.ok) throw new Error(`feed ${res.status}`);
  const videos = parseFeed(await res.text());
  if (!videos.length) throw new Error('feed empty');
  return videos;
}

export async function onRequest(context) {
  const cache = caches.default;

  // 10분 안에 받아온 결과가 있으면 그대로 사용
  const fresh = await cache.match(FRESH_KEY);
  if (fresh) return json(await fresh.json());

  const sources = [];
  const key = context.env && context.env.YT_API_KEY;
  if (key) sources.push(() => fromApi(key));
  FEEDS.forEach((u) => sources.push(() => fromFeed(u)));

  const errors = [];
  for (const get of sources) {
    try {
      const videos = await get();
      const body = { videos, savedAt: new Date().toISOString() };
      context.waitUntil(Promise.all([
        cache.put(FRESH_KEY, json(body, 200, 600)),
        cache.put(LAST_GOOD_KEY, json(body, 200, 60 * 60 * 24 * 30)),
      ]));
      return json(body);
    } catch (err) {
      errors.push(String(err));
    }
  }

  const saved = await cache.match(LAST_GOOD_KEY);
  if (saved) return json({ ...(await saved.json()), stale: true }, 200, 300);
  return json({ videos: [], error: errors.join(' / '), hasKey: Boolean(key) }, 502);
}
