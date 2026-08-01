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
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000)
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { error: String(e && e.message ? e.message : e) } };
  }
}

// ==========================================================================
// メニュー対応表（/inspect で取得したSquareの実データ）
//   plan: amaterasu120 / tsukuyomi120 / ryokan180_amaterasu / ryokan180_tsukuyomi
//   120分は「平日」と「土日祝・特日」で料金メニューが分かれる
// ==========================================================================
const MENU = {
  amaterasu120: {
    label: '天照 120分貸切',
    weekday: { 1:'YVJRCWQIX4SXB4NEDPCWL6VL',2:'7LP2A5PUFRRZUI6E2VBRBHID',3:'SEO7DVQQMTNYIKTPBLSY3T53',4:'3X564SXFJ3JER3XMO67AOJ4M',5:'WT7XXVSIS7UMTKTUOEGPDKU2' },
    holiday: { 1:'T7GNHDJA62UK6BI24GEEBC2B',2:'4QSL5OYITODPQ54CZWZVAKDK',3:'NRLFIOC26QLKDUPWVM6CA7ZI',4:'SP7PHX4ZGMWDTFSWDRZJSRRJ',5:'TKOUU5MSZ2NVMJAIJC4KDYFV' }
  },
  tsukuyomi120: {
    label: '月読 120分貸切',
    weekday: { 1:'TIJUIW7GE4MXZEXNGUXEAXC6',2:'AIUVFZW34M3Z2NTADXY4I6B4',3:'2WEFEGGZKPL2GWLPL3LKYNK3',4:'UAVFOTCGW62OERW7NPVPJ5JM',5:'MSHYH6EN3TLE7AVG4UC5Q3EE' },
    holiday: { 1:'6RUMOXUGE7JQLUBFTXXHVIKQ',2:'SR62JOXUEXSQ7SVXB5ZB3YBP',3:'GNPJMNVXCROGY5A3B5QRWEIF',4:'3L72QN23TDOEPVQCEVZUH3R4',5:'WAFI7J47OVOLMUA7ZQTTLSEL' }
  },
  ryokan180_amaterasu: {
    label: '180分旅館【天照】',
    weekday: { 1:'4CZZJQGB76AA352SLPKRZ4HA',2:'O3MAUOBVO3BTH6VJ3G7IYTAA',3:'W2KMMKTDJMZJEMFIVJPLAIAA',4:'L7WJRIVOSLDT7JH6STGN5XDJ',5:'NQXWVHUPCABZ3KN4LEQJE5Q5' },
    holiday: null // 曜日にかかわらず同料金
  },
  ryokan180_tsukuyomi: {
    label: '180分旅館【月読】',
    weekday: { 1:'KULD6NPUA5TF2TPNVADNMOWG',2:'4DPZL6GJUB7TEQQNPHUCGWXN',3:'LE7SJ5JFH3HUVHGGZGOJRNAD',4:'QRWEQ5L4SLIZ3MFBM6XUJHIQ',5:'YY7IJ5LFKR623NG6HDCBG2WP' },
    holiday: null
  }
};

// 2026年の日本の祝日（土日祝・特日の判定用）
const HOLIDAYS_2026 = new Set([
  '2026-01-01','2026-01-12','2026-02-11','2026-02-23','2026-03-20',
  '2026-04-29','2026-05-03','2026-05-04','2026-05-05','2026-05-06',
  '2026-07-20','2026-08-11','2026-09-21','2026-09-22','2026-09-23',
  '2026-10-12','2026-11-03','2026-11-23'
]);
// 特日（お盆など、お店が「土日祝扱い」にしたい日。必要に応じて追加）
const SPECIAL_DAYS = new Set([ '2026-08-13','2026-08-14','2026-08-15' ]);

// UTCの日時文字列 → 日本時間の日付(YYYY-MM-DD)と判定
function jstDateStr(isoUtc) {
  const d = new Date(new Date(isoUtc).getTime() + 9 * 3600000);
  return d.toISOString().slice(0, 10);
}
function isHolidayJST(isoUtc) {
  const ds = jstDateStr(isoUtc);
  const dow = new Date(ds + 'T00:00:00Z').getUTCDay(); // 0=日,6=土
  return dow === 0 || dow === 6 || HOLIDAYS_2026.has(ds) || SPECIAL_DAYS.has(ds);
}
// プラン＋人数＋日時 → 使うメニュー(variation)を決める
function pickVariation(plan, people, startAtUtc) {
  const m = MENU[plan];
  if (!m) return null;
  const table = (m.holiday && isHolidayJST(startAtUtc)) ? m.holiday : m.weekday;
  return table[people] || null;
}

// ---- 予約可能な「部屋」(スタッフ)だけを使う（オーナー等の個人カレンダーを除外） ----
let bookableTeamCache = null;
async function getBookableTeam() {
  if (bookableTeamCache) return bookableTeamCache;
  const r = await sq('GET', '/v2/bookings/team-member-booking-profiles');
  const set = new Set();
  (r.data.team_member_booking_profiles || []).forEach(t => {
    if (t.is_bookable) set.add(t.team_member_id);
  });
  if (set.size) bookableTeamCache = set;
  return set;
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

// ==========================================================================
// 未決済予約の自動管理（30分ルール）
//  - 支払い確認 → 予約メモに【決済確認済み】を追記
//  - 30分未払い → 予約を自動キャンセルして枠を解放（決済リンクも無効化）
// ==========================================================================
const PENDING_PATH = path.join(__dirname, 'pending.json');
const HOLD_MINUTES = 10; // 仮押さえの有効時間（分）
function loadPending() { try { return JSON.parse(fs.readFileSync(PENDING_PATH, 'utf8')); } catch (e) { return []; } }
function savePending(list) { try { fs.writeFileSync(PENDING_PATH, JSON.stringify(list)); } catch (e) {} }
async function sweepPending() {
  let list = loadPending();
  if (!list.length) return;
  const keep = [];
  for (const p of list) {
    try {
      const or = await sq('GET', '/v2/orders/' + p.order_id);
      const order = or.data.order || {};
      const paid = (order.tenders && order.tenders.length > 0) || order.state === 'COMPLETED';
      if (paid) {
        try {
          const br = await sq('GET', '/v2/bookings/' + p.booking_id);
          const bk = br.data.booking;
          if (bk && bk.status && !String(bk.status).startsWith('CANCELLED')) {
            await sq('PUT', '/v2/bookings/' + p.booking_id, {
              booking: { version: bk.version, seller_note: ((bk.seller_note || '') + '【決済確認済み】').slice(0, 4000) }
            });
          }
        } catch (e) {}
        continue; // 支払い済み → 監視終了
      }
      const ageMin = (Date.now() - p.created_at) / 60000;
      if (ageMin >= HOLD_MINUTES) {
        try {
          const br = await sq('GET', '/v2/bookings/' + p.booking_id);
          const bk = br.data.booking;
          if (bk && bk.status && !String(bk.status).startsWith('CANCELLED')) {
            await sq('POST', '/v2/bookings/' + p.booking_id + '/cancel', { booking_version: bk.version });
          }
        } catch (e) {}
        try { await sq('DELETE', '/v2/online-checkout/payment-links/' + p.link_id); } catch (e) {}
        continue; // 期限切れ → キャンセルして監視終了
      }
      keep.push(p); // まだ30分以内 → 監視続行
    } catch (e) { keep.push(p); }
  }
  savePending(keep);
}
setInterval(sweepPending, 60 * 1000); // 1分ごとに見回り
setTimeout(sweepPending, 15 * 1000);  // 起動直後にも1回

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

  // ---- CORS: サイトからの呼び出しを許可 ----
  const origin = req.headers.origin || '';
  if (origin === 'https://nogiku-sauna.github.io' || origin === 'https://nogikusauna.com' || origin === 'https://www.nogikusauna.com') {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.statusCode = 204; res.end(); return;
  }

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

  // ---- その日の空き枠（サイトの予約画面が使う） ----
  if (url === '/slots' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (!isConfigured()) { res.statusCode = 400; res.end(JSON.stringify({ error: 'not configured' })); return; }
    const q = new URLSearchParams((req.url.split('?')[1] || ''));
    const plan = q.get('plan');
    const people = parseInt(q.get('people') || '0', 10);
    const date = q.get('date'); // YYYY-MM-DD（日本時間の日付）
    if (!plan || !people || !date) { res.statusCode = 400; res.end(JSON.stringify({ error: 'plan, people, date required' })); return; }
    const noonUtc = date + 'T03:00:00Z'; // その日の正午(JST)で平日/休日を判定
    const variation = pickVariation(plan, people, noonUtc);
    if (!variation) { res.statusCode = 400; res.end(JSON.stringify({ error: 'unknown plan/people' })); return; }
    (async () => {
      const dayStart = new Date(date + 'T00:00:00+09:00').getTime();
      const dayEnd = new Date(date + 'T23:59:59+09:00').getTime();
      const now = Date.now();
      if (dayEnd < now) { res.end(JSON.stringify({ holiday: isHolidayJST(noonUtc), slots: [] })); return; }
      const startAt = new Date(Math.max(dayStart, now + 60000)).toISOString();
      const endAt = new Date(dayEnd).toISOString();
      const locId = await getLocationId();
      const body = { query: { filter: {
        start_at_range: { start_at: startAt, end_at: endAt },
        location_id: locId,
        segment_filters: [{ service_variation_id: variation }]
      } } };
      const r = await sq('POST', '/v2/bookings/availability/search', body);
      const bookable = await getBookableTeam();
      const seen = new Set();
      const slots = [];
      (r.data.availabilities || []).forEach(a => {
        // 「部屋」(予約可能スタッフ)の枠だけを採用。個人カレンダー由来の枠は除外
        const seg = (a.appointment_segments || []).find(s => bookable.has(s.team_member_id));
        if (seg && !seen.has(a.start_at)) {
          seen.add(a.start_at);
          slots.push({ start_at: a.start_at, team: seg.team_member_id });
        }
      });
      slots.sort((x, y) => (x.start_at < y.start_at ? -1 : 1));
      res.end(JSON.stringify({
        status: r.status,
        holiday: isHolidayJST(noonUtc),
        variation_id: variation,
        errors: r.data.errors || null,
        slots
      }));
    })();
    return;
  }

  // ---- 予約の確保＋決済ページ（★予約はSquareのカレンダーに自動登録される） ----
  if (url === '/book' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (!isConfigured()) { res.statusCode = 400; res.end(JSON.stringify({ ok: false, message: 'not configured' })); return; }
    const q = new URLSearchParams((req.url.split('?')[1] || ''));
    const plan = q.get('plan');
    const people = parseInt(q.get('people') || '0', 10);
    const startAt = q.get('start_at');
    const team = q.get('team');
    const name = (q.get('name') || '').trim().slice(0, 60);
    const tel = (q.get('tel') || '').trim().slice(0, 30);
    const email = (q.get('email') || '').trim().slice(0, 100);
    const note = (q.get('note') || '').trim().slice(0, 500);
    const addr = (q.get('addr') || '').trim().slice(0, 120);
    if (!plan || !people || !startAt || !team || !name || !tel) {
      res.statusCode = 400; res.end(JSON.stringify({ ok: false, message: 'お名前と電話番号は必須です' })); return;
    }
    const variation = pickVariation(plan, people, startAt);
    if (!variation) { res.statusCode = 400; res.end(JSON.stringify({ ok: false, message: 'プランを認識できませんでした' })); return; }
    (async () => {
      const locId = await getLocationId();
      // メニューの最新バージョン番号（予約作成に必要）
      const co = await sq('GET', '/v2/catalog/object/' + variation);
      const version = co.data.object && co.data.object.version;
      if (!version) { res.end(JSON.stringify({ ok: false, message: 'メニュー情報を取得できませんでした' })); return; }
      // 1) お客様情報を登録（名前・電話・メール）
      const telDigits = tel.replace(/[^0-9]/g, '');
      const custBody = {
        idempotency_key: 'cus-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        given_name: name,
        note: 'Webサイト予約' + (addr ? '／ご住所（お客様申告）：' + addr : '')
      };
      if (telDigits.length >= 10) custBody.phone_number = telDigits.startsWith('0') ? '+81' + telDigits.slice(1) : '+' + telDigits;
      if (addr) custBody.address = { address_line_1: addr, country: 'JP' };
      if (email) custBody.email_address = email;
      const cr = await sq('POST', '/v2/customers', custBody);
      const customerId = cr.data.customer && cr.data.customer.id;
      // 2) 予約をSquareカレンダーに登録（この時点で枠が埋まる）
      const booking = {
        location_id: locId,
        start_at: startAt,
        customer_note: note,
        seller_note: 'Webサイト予約 ' + MENU[plan].label + ' ' + people + '名 / ' + name + '様 / TEL:' + tel + (email ? ' / ' + email : '') + (addr ? ' / ご住所:' + addr : '') + '（入金確認待ち）',
        appointment_segments: [{
          team_member_id: team,
          service_variation_id: variation,
          service_variation_version: version
        }]
      };
      if (customerId) booking.customer_id = customerId;
      const br = await sq('POST', '/v2/bookings', {
        idempotency_key: 'bk-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        booking
      });
      if (!br.ok) {
        const detail = (br.data.errors || []).map(e => e.detail).join(' / ');
        res.end(JSON.stringify({ ok: false, message: 'この枠は確保できませんでした。別の時間をお試しください。', errors: br.data.errors || null, detail }));
        return;
      }
      const bookingId = br.data.booking && br.data.booking.id;
      // 3) 決済ページを作成
      const jst = new Date(new Date(startAt).getTime() + 9 * 3600000);
      const when = jst.toISOString().slice(0, 16).replace('T', ' ');
      // 電話番号は数字のみ（国際形式）に整えてから渡す。合わない場合は渡さない
      const digits = tel.replace(/[^0-9]/g, '');
      const e164 = digits.startsWith('0') ? '+81' + digits.slice(1) : (digits ? '+' + digits : '');
      const prefill = {};
      if (email && /.+@.+\..+/.test(email)) prefill.buyer_email = email;
      if (/^\+\d{10,15}$/.test(e164)) prefill.buyer_phone_number = e164;
      const pr = await sq('POST', '/v2/online-checkout/payment-links', {
        idempotency_key: 'pl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        order: { location_id: locId, line_items: [{ quantity: '1', catalog_object_id: variation }] },
        checkout_options: {
          redirect_url: 'https://nogiku-sauna.github.io/nogiku-sauna/booking.html?paid=1',
          ask_for_shipping_address: false
        },
        pre_populated_data: Object.keys(prefill).length ? prefill : undefined,
        payment_note: name + '様 ' + MENU[plan].label + ' ' + people + '名 ' + when + '(JST) 予約ID:' + (bookingId || '不明')
      });
      let link = pr.data.payment_link || {};
      // プリフィル情報が原因で失敗した場合は、情報なしでもう一度作る（予約を無駄にしない）
      if (!link.url && Object.keys(prefill).length) {
        const retry = await sq('POST', '/v2/online-checkout/payment-links', {
          idempotency_key: 'pl2-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
          order: { location_id: locId, line_items: [{ quantity: '1', catalog_object_id: variation }] },
          checkout_options: {
            redirect_url: 'https://nogiku-sauna.github.io/nogiku-sauna/booking.html?paid=1',
            ask_for_shipping_address: false
          },
          payment_note: name + '様 ' + MENU[plan].label + ' ' + people + '名 ' + when + '(JST) 予約ID:' + (bookingId || '不明')
        });
        link = retry.data.payment_link || {};
      }
      if (!link.url) {
        res.end(JSON.stringify({ ok: false, message: '予約は確保しましたが、決済ページの作成に失敗しました。お店にご連絡ください。', booking_id: bookingId, status: pr.status, errors: pr.data.errors || null }));
        return;
      }
      // 仮押さえの監視リストに登録（10分未払いなら自動キャンセル）
      const plist = loadPending();
      plist.push({ booking_id: bookingId, order_id: link.order_id, link_id: link.id, created_at: Date.now() });
      savePending(plist);
      res.end(JSON.stringify({ ok: true, booking_id: bookingId, url: link.url }));
    })();
    return;
  }

  // ---- 予約のキャンセル（テスト予約の削除用・一時的） ----
  if (url === '/cancel-booking' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (!isConfigured()) { res.statusCode = 400; res.end(JSON.stringify({ ok: false })); return; }
    const q = new URLSearchParams((req.url.split('?')[1] || ''));
    const id = q.get('id');
    if (!id) { res.statusCode = 400; res.end(JSON.stringify({ ok: false, message: 'id required' })); return; }
    (async () => {
      const br = await sq('GET', '/v2/bookings/' + id);
      const bk = br.data.booking;
      if (!bk) { res.end(JSON.stringify({ ok: false, message: '予約が見つかりません', errors: br.data.errors || null })); return; }
      const cr = await sq('POST', '/v2/bookings/' + id + '/cancel', { booking_version: bk.version });
      res.end(JSON.stringify({ ok: cr.ok, status: cr.status, booking_status: cr.data.booking && cr.data.booking.status, errors: cr.data.errors || null }));
    })();
    return;
  }

  // ---- 料金の確認（プラン・人数・日時 → 金額とメニュー） ----
  if (url === '/quote' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (!isConfigured()) { res.statusCode = 400; res.end(JSON.stringify({ error: 'not configured' })); return; }
    const q = new URLSearchParams((req.url.split('?')[1] || ''));
    const plan = q.get('plan');
    const people = parseInt(q.get('people') || '0', 10);
    const startAt = q.get('start_at');
    if (!plan || !people || !startAt) { res.statusCode = 400; res.end(JSON.stringify({ error: 'plan, people, start_at required' })); return; }
    const variation = pickVariation(plan, people, startAt);
    if (!variation) { res.statusCode = 400; res.end(JSON.stringify({ error: 'unknown plan/people' })); return; }
    (async () => {
      const r = await sq('GET', '/v2/catalog/object/' + variation);
      const v = r.data.object && r.data.object.item_variation_data;
      res.end(JSON.stringify({
        status: r.status,
        plan, people, start_at: startAt,
        holiday: isHolidayJST(startAt),
        variation_id: variation,
        name: v && v.name,
        price: v && v.price_money,
        errors: r.data.errors || null
      }, null, 2));
    })();
    return;
  }

  // ---- 決済ページ作成（Square Payment Link） ----
  if (url === '/paylink' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (!isConfigured()) { res.statusCode = 400; res.end(JSON.stringify({ error: 'not configured' })); return; }
    const q = new URLSearchParams((req.url.split('?')[1] || ''));
    const plan = q.get('plan');
    const people = parseInt(q.get('people') || '0', 10);
    const startAt = q.get('start_at');
    if (!plan || !people || !startAt) { res.statusCode = 400; res.end(JSON.stringify({ error: 'plan, people, start_at required' })); return; }
    const variation = pickVariation(plan, people, startAt);
    if (!variation) { res.statusCode = 400; res.end(JSON.stringify({ error: 'unknown plan/people' })); return; }
    (async () => {
      const locId = await getLocationId();
      const jst = new Date(new Date(startAt).getTime() + 9 * 3600000);
      const when = jst.toISOString().slice(0, 16).replace('T', ' ');
      const body = {
        idempotency_key: 'nogiku-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        order: {
          location_id: locId,
          line_items: [{ quantity: '1', catalog_object_id: variation }]
        },
        checkout_options: { redirect_url: 'https://nogiku-sauna.github.io/nogiku-sauna/booking.html?paid=1' },
        payment_note: MENU[plan].label + ' ' + people + '名 ' + when + '(JST)'
      };
      const r = await sq('POST', '/v2/online-checkout/payment-links', body);
      const link = r.data.payment_link || {};
      res.end(JSON.stringify({
        status: r.status,
        url: link.url || null,
        order_id: link.order_id || null,
        errors: r.data.errors || null
      }, null, 2));
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
