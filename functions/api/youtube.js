// 새은혜교회 유튜브 채널의 최신 영상 목록을 돌려주는 기능
// 주소: /api/youtube  (Cloudflare Pages Functions)
//
// 유튜브 피드 서버는 가끔 몇 시간씩 404를 돌려줄 때가 있어요.
// 그래서 ① 채널 피드 → ② 업로드 재생목록 피드 순서로 시도하고,
// 둘 다 실패하면 ③ 마지막으로 성공했던 결과를 대신 보여줘요.

const CHANNEL_ID = 'UCsDQiQTRLlhI5z17cuj_-SQ';
const FEEDS = [
  `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`,
  `https://www.youtube.com/feeds/videos.xml?playlist_id=UU${CHANNEL_ID.slice(2)}`,
];
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

const json = (body, status = 200, maxAge = 600) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': status === 200 ? `public, max-age=${maxAge}` : 'no-store',
  },
});

async function fetchFeed(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; NewGraceChurchSite/1.0)' },
    // 성공한 응답만 10분 캐시하고, 실패한 응답은 캐시하지 않아요
    cf: { cacheTtlByStatus: { '200-299': 600, '400-599': 0 } },
  });
  if (!res.ok) throw new Error(`feed ${res.status}`);
  const videos = parseFeed(await res.text());
  if (!videos.length) throw new Error('feed empty');
  return videos;
}

export async function onRequest(context) {
  const cache = caches.default;
  const errors = [];

  for (const url of FEEDS) {
    try {
      const videos = await fetchFeed(url);
      // 성공한 결과를 30일 동안 보관 (유튜브가 막혔을 때 대신 쓰기 위해)
      const keep = json({ videos, savedAt: new Date().toISOString() }, 200, 60 * 60 * 24 * 30);
      context.waitUntil(cache.put(LAST_GOOD_KEY, keep));
      return json({ videos });
    } catch (err) {
      errors.push(String(err));
    }
  }

  // 유튜브가 모두 실패 → 마지막으로 성공했던 결과 사용
  const saved = await cache.match(LAST_GOOD_KEY);
  if (saved) {
    const data = await saved.json();
    return json({ ...data, stale: true }, 200, 300);
  }
  return json({ videos: [], error: errors.join(' / ') }, 502);
}
