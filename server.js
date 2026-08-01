// ==========================================================================
// NOGIKU 予約サーバー (server.js)
// Node.js 標準機能のみ（追加インストール不要 / fetch は Node18+ 内蔵）
//
//   /health   動作確認
//   /setup    Squareトークン登録（1回だけ）
//   /inspect  Squareの登録内容（メニュー/スタッフのID）を確認【後で撤去する一時用】
// ==========================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ENV_PATH = path.join(__dirname, '.env');
const SQUARE_BASE = 'https://connect.squareup.com';

// ---- .env 読み込み ----
function loadConfig() {
  const cfg = {};
  try {
    const txt = fs.readFileSync(ENV_PATH, 'utf8');
    txt.split(/\r?\n/).forEach(line => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) cfg[m[1]] = m[2];
    });
  } catch (e) {}
  return cfg;
}
let config = loadConfig();
function isConfigured() { return !!(config.SQUARE_ACCESS_TOKEN && config.SQUARE_LOCATION_ID); }
function saveConfig(token, locationId) {
  fs.writeFileSync(ENV_PATH,
    'SQUARE_ACCESS_TOKEN=' + token + '\n' + 'SQUARE_LOCATION_ID=' + locationId + '\n',
    { mode: 0o600 });
  config = loadConfig();
}

// ---- Square API ヘルパー ----
async function sq(method, apiPath, body) {
  try {
    const res = await fetch(SQUARE_BASE + apiPath, {
      method,
      headers: {
        'Authorization': 'Bearer ' + config.SQUARE_ACCESS_TOKEN,
        'Content-Type': 'application/json',
        'Square-Version': '2025-07-16'
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { error: String(e) } };
  }
}

// ---- 正しい Location ID を Square から取得（入力ミス対策・キャッシュ） ----
let cachedLocationId = null;
async function getLocationId() {
  if (cachedLocationId) return cachedLocationId;
  const r = await sq('GET', '/v2/locations');
  const locs = (r.data.locations || []);
  if (locs.length) { cachedLocationId = locs[0].id; return cachedLocationId; }
  return config.SQUARE_LOCATION_ID;
}

// ---- 設定ページHTML ----
function setupPage(message, color) {
  const msg = message ? `<div class="msg" style="color:${color || '#2b2620'}">${message}</div>` : '';
  const form = isConfigured() ? '' : `
    <form method="POST" action="/setup">
      <label>Square アクセストークン（本番）</label>
      <input type="password" name="token" placeholder="EAAA... で始まる長い文字列" autocomplete="off" required>
      <label>Square Location ID</label>
      <input type="text" name="location" placeholder="LZJF... のような文字列" autocomplete="off" required>
      <button type="submit">保存してSquareにつなぐ</button>
    </form>`;
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><title>NOGIKU セットアップ</title>
<style>body{font-family:sans-serif;background:#efe8d4;color:#2b2620;margin:0;padding:24px}
.card{max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:28px;box-shadow:0 6px 24px rgba(0,0,0,.08)}
h1{font-size:18px;margin:0 0 6px}p{font-size:13px;line-height:1.8;color:#5a5248}
label{display:block;font-size:13px;font-weight:700;margin:16px 0 6px}
input{width:100%;box-sizing:border-box;padding:12px;border:1px solid #d8cfb8;border-radius:8px;font-size:14px}
button{margin-top:20px;width:100%;padding:14px;border:none;border-radius:8px;background:#2b2620;color:#fff;font-size:15px;font-weight:700;cursor:pointer}
.msg{font-size:14px;font-weight:700;margin:12px 0;line-height:1.7}.note{font-size:12px;color:#9a8f7a;margin-top:18px}</style></head>
<body><div class="card"><h1>NOGIKU 予約システム｜Square設定</h1>
<p>パスワードマネージャーからコピーして、下の欄に貼り付けてください。ここで入れた情報はサーバーの中だけに保管され、外からは見えません。</p>
${msg}${form}
<div class="note">※ この画面のURLは他の人に教えないでください。設定は安全のため1回だけ有効です。</div></div></body></html>`;
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (url === '/health') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: true, service: 'nogiku-booking', configured: isConfigured(), time: new Date().toISOString() }));
    return;
  }

  if (url === '/setup' && req.method === 'GET') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(isConfigured() ? setupPage('✅ すでに設定済みです（安全のため、上書きはできません）。', '#1a7f3c') : setupPage('', ''));
    return;
  }

  if (url === '/setup' && req.method === 'POST') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (isConfigured()) { res.statusCode = 403; res.end(setupPage('❌ すでに設定済みのため、変更できません。', '#b00')); return; }
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', async () => {
      const p = new URLSearchParams(body);
      const token = (p.get('token') || '').trim();
      const location = (p.get('location') || '').trim();
      if (!token || !location) { res.end(setupPage('⚠️ トークンとLocation IDの両方を入れてください。', '#b00')); return; }
      config.SQUARE_ACCESS_TOKEN = token; // 検証用に一時セット
      const r = await sq('GET', '/v2/locations');
      if (!r.ok) { config = loadConfig(); res.end(setupPage('❌ Squareに接続できませんでした（トークンが違うかもしれません）。もう一度お試しください。（エラー: ' + r.status + '）', '#b00')); return; }
      saveConfig(token, location);
      const locs = (r.data.locations || []).map(l => '・' + (l.name || '(名称なし)') + ' … ' + l.id).join('<br>');
      res.end(setupPage('✅ 成功！ Squareとつながり、保存できました。<br><br>登録されている店舗：<br>' + locs, '#1a7f3c'));
    });
    return;
  }

  // ---- 一時用：Squareの登録内容を確認 ----
  if (url === '/inspect' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (!isConfigured()) { res.statusCode = 400; res.end(JSON.stringify({ error: 'not configured' })); return; }
    (async () => {
      const out = {};
      const loc = await sq('GET', '/v2/locations');
      out.locations_status = loc.status;
      const cat = await sq('GET', '/v2/catalog/list?types=ITEM');
      out.catalog_status = cat.status;
      out.services = (cat.data.objects || []).map(o => ({
        item_id: o.id,
        name: o.item_data && o.item_data.name,
        product_type: o.item_data && o.item_data.product_type,
        variations: ((o.item_data && o.item_data.variations) || []).map(v => ({
          variation_id: v.id,
          name: v.item_variation_data && v.item_variation_data.name,
          price: v.item_variation_data && v.item_variation_data.price_money,
          service_duration_ms: v.item_variation_data && v.item_variation_data.service_duration,
          team_member_ids: v.item_variation_data && v.item_variation_data.team_member_ids
        }))
      }));
      const team = await sq('GET', '/v2/bookings/team-member-booking-profiles');
      out.team_status = team.status;
      out.team = (team.data.team_member_booking_profiles || []).map(t => ({
        team_member_id: t.team_member_id, display_name: t.display_name, is_bookable: t.is_bookable
      }));
      if (cat.data.errors) out.catalog_errors = cat.data.errors;
      if (team.data.errors) out.team_errors = team.data.errors;
      res.end(JSON.stringify(out, null, 2));
    })();
    return;
  }

  // ---- 空き状況（テスト用） ----
  if (url === '/availability' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (!isConfigured()) { res.statusCode = 400; res.end(JSON.stringify({ error: 'not configured' })); return; }
    const q = new URLSearchParams((req.url.split('?')[1] || ''));
    const variation = q.get('variation');
    const days = Math.min(parseInt(q.get('days') || '7', 10) || 7, 31);
    if (!variation) { res.statusCode = 400; res.end(JSON.stringify({ error: 'variation required' })); return; }
    (async () => {
      const now = new Date();
      const startAt = new Date(now.getTime() + 60 * 1000).toISOString();
      const endAt = new Date(now.getTime() + days * 86400000).toISOString();
      const locId = await getLocationId();
      const body = { query: { filter: {
        start_at_range: { start_at: startAt, end_at: endAt },
        location_id: locId,
        segment_filters: [{ service_variation_id: variation }]
      } } };
      const r = await sq('POST', '/v2/bookings/availability/search', body);
      const slots = (r.data.availabilities || []).map(a => ({
        start_at: a.start_at,
        team: (a.appointment_segments || []).map(s => s.team_member_id)
      }));
      res.end(JSON.stringify({ status: r.status, count: slots.length, errors: r.data.errors || null, slots: slots.slice(0, 300) }, null, 2));
    })();
    return;
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ message: 'NOGIKU booking server is running.' }));
});

server.listen(PORT, () => console.log('NOGIKU booking server listening on port ' + PORT));
