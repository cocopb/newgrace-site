// 기도 요청 전달: 홈페이지 폼 → (이 함수) → 구글 Apps Script → 구글 시트 저장 + 메일 알림
// Cloudflare 환경 변수(보안 비밀)로 두 값을 넣어야 동작해요.
//   PRAYER_URL   : Apps Script 웹 앱 URL (https://script.google.com/macros/s/.../exec)
//   PRAYER_TOKEN : Apps Script 코드의 TOKEN 과 똑같은 값
// 이 두 값은 GitHub 코드에 넣지 않아요. 그래서 Apps Script 주소가 외부에 드러나지 않아요.

const MAX_NAME = 40;
const MAX_BODY = 2000;

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function onRequestPost({ request, env }) {
  if (!env.PRAYER_URL || !env.PRAYER_TOKEN) return json({ ok: false, error: 'not_configured' }, 503);

  // 우리 사이트에서 보낸 요청만 받기
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== new URL(request.url).host) return json({ ok: false, error: 'forbidden' }, 403);
    } catch (e) {
      return json({ ok: false, error: 'forbidden' }, 403);
    }
  }

  let d;
  try { d = await request.json(); } catch (e) { return json({ ok: false, error: 'bad_request' }, 400); }
  if (!d || typeof d !== 'object') return json({ ok: false, error: 'bad_request' }, 400);

  // 스팸 로봇 걸러내기: 숨은 칸이 채워졌거나, 화면을 연 지 3초도 안 돼서 보낸 경우 (조용히 성공처럼 응답)
  if (d.website) return json({ ok: true });
  if (typeof d.elapsed === 'number' && d.elapsed < 3000) return json({ ok: true });

  const name = String(d.name || '').trim().slice(0, MAX_NAME);
  const body = String(d.body || '').trim().slice(0, MAX_BODY);
  if (!name || !body) return json({ ok: false, error: 'empty' }, 400);

  try {
    const r = await fetch(env.PRAYER_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: env.PRAYER_TOKEN, name: name, body: body }),
      redirect: 'follow',
    });
    const text = await r.text();
    let res = null;
    try { res = JSON.parse(text); } catch (e) {}
    if (res && res.ok) return json({ ok: true });
    return json({ ok: false, error: (res && res.error) || 'upstream' }, 502);
  } catch (e) {
    return json({ ok: false, error: 'upstream' }, 502);
  }
}

export function onRequest() {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
