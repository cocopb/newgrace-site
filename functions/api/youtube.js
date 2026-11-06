// 새은혜교회 유튜브 채널의 최신 영상 목록을 돌려주는 기능
// 주소: /api/youtube  (Cloudflare Pages Functions)
const CHANNEL_ID = 'UCsDQiQTRLlhI5z17cuj_-SQ';
const FEED = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;

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

export async function onRequest() {
  try {
    const res = await fetch(FEED, { cf: { cacheTtl: 600, cacheEverything: true } });
    if (!res.ok) throw new Error('feed ' + res.status);
    const videos = parseFeed(await res.text());
    return new Response(JSON.stringify({ videos }), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=600',   // 10분마다 새로 확인
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ videos: [], error: String(err) }), {
      status: 502, headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
}
