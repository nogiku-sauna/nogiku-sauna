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
let bookableTeamCachedAt = 0;
const BOOKABLE_TEAM_TTL_MS = 60 * 60 * 1000; // 1時間ごとに取り直す（部屋を追加しても再起動不要）
async function getBookableTeam() {
  if (bookableTeamCache && Date.now() - bookableTeamCachedAt < BOOKABLE_TEAM_TTL_MS) return bookableTeamCache;
  const r = await sq('GET', '/v2/bookings/team-member-booking-profiles');
  const set = new Set();
  (r.data.team_member_booking_profiles || []).forEach(t => {
    if (t.is_bookable) set.add(t.team_member_id);
  });
  if (set.size) { bookableTeamCache = set; bookableTeamCachedAt = Date.now(); return set; }
  return bookableTeamCache || set;   // 取り直しに失敗したら、前回の一覧をそのまま使う
}

// ---- 空き検索（「部屋」のスタッフだけに絞って Square に問い合わせる） ----
//   2026-09-30：部屋ではない個人スタッフも同じメニューを担当できる設定になっており、
//   同じ時間に両方が空いていると Square がどちらか一方をランダムに返すため、
//   部屋の空き枠が表示されないことがあった。team_member_id_filter で部屋だけに絞る。
//   ・絞り込み用の一覧が空なら、今まで通り絞らずに検索する
//   ・絞り込み付きの検索がエラーになったら、絞らずにもう一度検索する
async function searchAvailability(startAt, endAt, locId, variation, teamIds) {
  const seg = { service_variation_id: variation };
  const ids = (teamIds || []).filter(Boolean);
  if (ids.length) seg.team_member_id_filter = { any: ids };
  const body = { query: { filter: {
    start_at_range: { start_at: startAt, end_at: endAt },
    location_id: locId,
    segment_filters: [seg]
  } } };
  let r = await sq('POST', '/v2/bookings/availability/search', body);
  const failed = !r.ok || (r.data.errors && r.data.errors.length);
  if (ids.length && failed) {
    console.error('空き検索（部屋に絞り込み）でエラー。絞り込みなしで再検索:', JSON.stringify(r.data.errors || r.data));
    delete seg.team_member_id_filter;
    r = await sq('POST', '/v2/bookings/availability/search', body);
  }
  return r;
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
// 仮押さえ管理（D案）
//  「はい、進む」を押した時点では Square には何も入れず、
//  サーバー内で 10分間だけ枠を確保する（＝この間はメールもSMSも飛ばない）。
//  決済が完了した瞬間に Square へ予約を登録し、そこで確認メール/SMSが届く。
// ==========================================================================
const PENDING_PATH = path.join(__dirname, 'pending.json');
const HOLD_MINUTES = 10; // 仮押さえの有効時間（分）

function loadPending() { try { return JSON.parse(fs.readFileSync(PENDING_PATH, 'utf8')); } catch (e) { return []; } }
function savePending(list) { try { fs.writeFileSync(PENDING_PATH, JSON.stringify(list)); } catch (e) {} }

// 期限切れを取り除いた、有効な仮押さえだけを返す
function activeHolds() {
  const now = Date.now();
  return loadPending().filter(h => !h.done && (now - h.created_at) / 60000 < HOLD_MINUTES);
}
// その枠が今、他の人に仮押さえされているか
function isHeld(startAt, team) {
  return activeHolds().some(h => h.start_at === startAt && h.team === team);
}

// ---- 空き枠の短時間キャッシュ ----
//  Squareの空き検索は同じ質問でも結果がぶれるため、一度「空き」と分かった枠を
//  少しの間だけ覚えておき、表示がちらつかないようにする。
//  （※予約確定の直前に改めて空きを確認するので、埋まった枠が通ることはない）
const SLOT_CACHE_MS = 90 * 1000;
const slotCache = new Map();
function rememberSlots(key, list) {
  let m = slotCache.get(key);
  if (!m) { m = new Map(); slotCache.set(key, m); }
  const now = Date.now();
  list.forEach(s => m.set(s.start_at + '|' + s.team, { start_at: s.start_at, team: s.team, at: now }));
  for (const [k, v] of m) if (now - v.at > SLOT_CACHE_MS) m.delete(k);
  if (slotCache.size > 200) slotCache.clear();
  return [...m.values()];
}

// 決済が終わった仮押さえを Square の予約に変える
// 本当に支払いが完了したかを確認する（未払い残高0＋各支払いがCOMPLETED）
async function isReallyPaid(order) {
  if (!order) return false;
  const due = (order.net_amount_due_money && typeof order.net_amount_due_money.amount === 'number')
    ? order.net_amount_due_money.amount : null;
  if (due === null || due > 0) return false;
  const tenders = order.tenders || [];
  if (tenders.length === 0) return false;
  for (const t of tenders) {
    if (!t.payment_id) return false;
    try {
      const pr = await sq('GET', '/v2/payments/' + t.payment_id);
      if (!pr.data.payment || pr.data.payment.status !== 'COMPLETED') return false;
    } catch (e) { return false; }
  }
  return true;
}

// 決済の確認は、同時に2つ走らないようにする。
//   （20秒ごとの確認と、お客様が決済から戻った時の確認が重なると、
//     同じ予約を2回作ろうとして、2回目が「予約できなかった」扱いになるため）
let sweepRunning = null;
function sweepPending() {
  if (sweepRunning) return sweepRunning;          // 実行中なら、その終わりを待つだけ
  sweepRunning = sweepPendingOnce().finally(() => { sweepRunning = null; });
  return sweepRunning;
}
async function sweepPendingOnce() {
  const list = loadPending();
  if (!list.length) return;
  const now = Date.now();
  const keep = [];
  for (const h of list) {
    if (h.done) continue;                                   // 済み → 破棄
    const ageMin = (now - h.created_at) / 60000;
    // 入力画面だけの仮押さえ（まだ決済ページに進んでいない）
    if (!h.order_id) {
      if (ageMin < HOLD_MINUTES) keep.push(h);
      continue;
    }
    try {
      const or = await sq('GET', '/v2/orders/' + h.order_id);
      const order = or.data.order || {};
      const paid = await isReallyPaid(order);
      if (paid) {
        // 統計：決済完了
        const pp = planParts(h.plan);
        const jp = jstParts(h.start_at);
        const total = (order.total_money && order.total_money.amount) || '';
        // 先に本予約を作る（この中でお客様照合が走り、h.repeat に 新規/リピーター が入る）
        await createBookingFromHold(h);                     // ★決済完了 → 本予約を作成
        logEvent([jstNow(), '③決済完了', pp.name, pp.room, h.people,
                  jp.date, jp.time, isHolidayJST(h.start_at) ? '土日祝' : '平日',
                  prefOnly(h.addr), total, h.id,
                  h.repeat || '', h.src || '', daysAhead(h.start_at), h.dev || ''],
                  { '市区町村': cityOnly(h.addr), '支払い方法': 'Web事前決済' });
        continue;
      }
    } catch (e) {}
    if (ageMin >= HOLD_MINUTES) {
      // 統計：時間切れ（決済されなかった）
      const pp = planParts(h.plan);
      const jp = jstParts(h.start_at);
      logEvent([jstNow(), '×時間切れ', pp.name, pp.room, h.people || '',
                jp.date, jp.time, isHolidayJST(h.start_at) ? '土日祝' : '平日',
                prefOnly(h.addr), '', h.id], cityOnly(h.addr));
      try { await sq('DELETE', '/v2/online-checkout/payment-links/' + h.link_id); } catch (e) {}
      continue;                                             // 期限切れ → 仮押さえ解除
    }
    keep.push(h);                                           // まだ有効 → 継続
  }
  // 確認している間に、ほかのお客様が新しく仮押さえ・決済ページへ進んだ分を消さないように、
  // 最新の一覧から「今回の確認で終わった分（予約済み・時間切れ）」だけを取り除いて保存する
  const keepIds = new Set(keep.map(h => h.id));
  const dropIds = new Set(list.filter(h => !keepIds.has(h.id)).map(h => h.id));
  savePending(loadPending().filter(h => !dropIds.has(h.id)));
}

// 仮押さえの情報から、Square に本予約を登録する
async function createBookingFromHold(h) {
  try {
    const locId = await getLocationId();
    const co = await sq('GET', '/v2/catalog/object/' + h.variation);
    const version = co.data.object && co.data.object.version;
    if (!version) return;

    // お客様情報（同じ電話番号があれば、その方に紐づける＝リピーター対応）
    let customerId = null;
    const address = h.addr ? { address_line_1: h.addr, country: 'JP' } : undefined;
    if (address && h.zip) address.postal_code = h.zip;
    if (h.telE164) {
      const search = await sq('POST', '/v2/customers/search', {
        limit: 1, query: { filter: { phone_number: { exact: h.telE164 } } }
      });
      const found = (search.data.customers || [])[0];
      h.repeat = found ? 'リピーター' : '新規';   // 統計用
      if (found) {
        customerId = found.id;
        const upd = (h.lastName || h.firstName)
          ? { family_name: h.lastName || '', given_name: h.firstName || '' }
          : { given_name: h.name };
        if (h.email) upd.email_address = h.email;
        if (address) upd.address = address;
        await sq('PUT', '/v2/customers/' + customerId, upd);
      }
    }
    if (!customerId) {
      const custBody = {
        idempotency_key: 'cus-' + h.id,
        note: 'Webサイト予約'
      };
      if (h.lastName || h.firstName) {
        custBody.family_name = h.lastName || '';
        custBody.given_name = h.firstName || '';
      } else {
        custBody.given_name = h.name;
      }
      if (h.telE164) custBody.phone_number = h.telE164;
      if (h.email) custBody.email_address = h.email;
      if (address) custBody.address = address;
      const cr = await sq('POST', '/v2/customers', custBody);
      customerId = cr.data.customer && cr.data.customer.id;
    }

    const booking = {
      location_id: locId,
      start_at: h.start_at,
      customer_note: h.note || '',
      seller_note: 'Webサイト予約【決済済み】' + h.label + ' ' + h.people + '名 / ' + h.name + '様 / TEL:' + h.tel
        + (h.email ? ' / ' + h.email : '') + (h.addr ? ' / ご住所:' + h.addr : '')
        + ' / 規約・キャンセルポリシー同意:済(' + (h.terms_agreed_at || '日時不明') + ')',
      appointment_segments: [{
        team_member_id: h.team,
        service_variation_id: h.variation,
        service_variation_version: version
      }]
    };
    if (customerId) booking.customer_id = customerId;
    const br = await sq('POST', '/v2/bookings', {
      idempotency_key: 'bk-' + h.id,   // 同じ仮押さえから二重に作らないための鍵
      booking
    });
    if (br.ok) {
      notifyStore(h);          // お店へ予約通知（Squareは API 経由だと通知を送らないため）
      // ※「注文の自動完了」はここでは行わない。
      //   決済直後に注文を変更すると、お客様の画面に「ご注文が完了しませんでした」と
      //   誤ったエラーが出てしまうため。完了処理は10分後に安全に行う（下記）。
      const oid = h.order_id;
      setTimeout(() => { completeOrder(oid); }, 10 * 60 * 1000);
    }
    if (!br.ok) {
      // ★万一この枠が埋まっていた場合（要対応：返金や別時間のご案内）
      console.error('[要対応] 決済済みだが予約作成に失敗:', h.name, h.tel, h.start_at,
        JSON.stringify(br.data.errors || br.data));
      // 連絡に必要な項目だけ保存する（住所・ご要望など不要な個人情報は保存しない）
      const fails = loadFailures();
      fails.push({
        at: new Date().toISOString(),
        name: h.name, tel: h.tel, email: h.email,
        label: h.label, people: h.people, start_at: h.start_at,
        errors: br.data.errors || null
      });
      saveFailures(fails);
      notifyFailure(h, '決済は完了しましたが、Squareに予約を作成できませんでした（その枠がすでに埋まっていた等）。');
    }
  } catch (e) {
    console.error('[要対応] 予約作成で例外:', String(e));
    // 通信エラーなどで、予約が作れたかどうか分からない場合も、お店に確認してもらう
    try {
      const fails = loadFailures();
      fails.push({
        at: new Date().toISOString(),
        name: h.name, tel: h.tel, email: h.email,
        label: h.label, people: h.people, start_at: h.start_at,
        errors: [{ detail: '予約作成中にエラー（作成できたか不明）: ' + String(e).slice(0, 200) }]
      });
      saveFailures(fails);
    } catch (e2) {}
    notifyFailure(h, '予約の作成中にエラーが起きたため、予約が作れたかどうか分かりません。Squareのカレンダーを確認してください。');
  }
}

// 決済済みなのに予約が作れなかった時、お店にすぐ「要対応」メールを送る
//   （データ画面の赤い警告だけでは、画面を開くまで気づけないため）
function notifyFailure(h, reason) {
  try {
    const jp = jstParts(h.start_at);
    const body = [
      '【NOGIKU・要対応】お支払い済みのご予約で問題が起きました',
      '',
      reason,
      '',
      'プラン : ' + (h.label || ''),
      '人数   : ' + (h.people || '') + '名',
      '日時   : ' + jp.date + ' ' + jp.time + '〜',
      '',
      'お名前 : ' + (h.name || '') + ' 様',
      'お電話 : ' + (h.tel || ''),
      'メール : ' + (h.email || '（未入力）'),
      '',
      '▼ 対応のお願い',
      '1. Squareのカレンダーで、この日時に予約が入っているか確認してください。',
      '2. 入っていない場合は、お客様に連絡し、別の時間のご案内か、',
      '   Squareの「お取引」からの返金をお願いします。',
      '※ データ画面の上部にも、赤い警告として表示されています。'
    ].join('\n');
    const { execFile } = require('child_process');
    const subject = '【NOGIKU・要対応】決済済みの予約で問題（' + jp.date + ' ' + jp.time + '）';
    const child = execFile('mail', ['-s', subject, STORE_EMAIL], (err) => {
      if (err) console.error('要対応メール送信エラー:', err.message);
    });
    child.stdin.write(body);
    child.stdin.end();
  } catch (e) { console.error('要対応メールのエラー:', String(e)); }
}

// ==========================================================================
// 行動ログ（個人が特定できない統計用。名前・電話・メールは記録しません）
//   どの枠が選ばれたか／どこまで進んだか／どの地域からか
// ==========================================================================
const LOG_PATH = path.join(__dirname, 'analytics.csv');
const LOG_HEADER = '記録日時(JST),段階,プラン,部屋,人数,予約日,予約時刻,曜日区分,都道府県,金額,セッションID,新規/リピーター,流入元,何日前,端末,市区町村,支払い方法\n';
const LOG_NAMES = LOG_HEADER.trim().split(',');
const LOG_COLS = LOG_NAMES.length;
// 2026-09-28に「市区町村」列を追加。古いanalytics.csvの見出し行に列名が無ければ、最初の1回だけ見出しを付け足す
// （データの行はそのまま。古い行の市区町村は空欄として扱われる）
let logHeaderChecked = false;
function ensureLogHeader() {
  if (logHeaderChecked) return;
  logHeaderChecked = true;
  try {
    if (!fs.existsSync(LOG_PATH)) return;
    const csv = fs.readFileSync(LOG_PATH, 'utf8');
    const nl = csv.indexOf('\n');
    const first = (nl >= 0 ? csv.slice(0, nl) : csv).replace(/\r$/, '');
    // 後から追加した列（市区町村・支払い方法）のうち、見出しに無いものを右端に付け足す
    const have = first.replace(/^\ufeff/, '').split(',');
    const missing = ['市区町村', '支払い方法'].filter(c => have.indexOf(c) === -1);
    if (!missing.length) return;
    fs.writeFileSync(LOG_PATH, first + ',' + missing.join(',') + (nl >= 0 ? csv.slice(nl) : '\n'));
  } catch (e) {}
}
ensureLogHeader();
// extras に { 市区町村: '由布市', 支払い方法: '…' } のように渡すと、列の数をそろえた上で該当の列に入れる
//   （文字列を渡した場合は「市区町村」として扱う：以前の呼び出し方との互換）
function logEvent(row, extras) {
  try {
    if (!fs.existsSync(LOG_PATH)) fs.writeFileSync(LOG_PATH, '﻿' + LOG_HEADER);
    else ensureLogHeader();
    if (typeof extras === 'string') extras = { '市区町村': extras };
    const keys = Object.keys(extras || {}).filter(k => extras[k] !== undefined && extras[k] !== null && extras[k] !== '');
    if (keys.length) {
      row = row.slice();
      while (row.length < LOG_COLS) row.push('');
      keys.forEach(k => { const i = LOG_NAMES.indexOf(k); if (i >= 0) row[i] = extras[k]; });
      while (row.length && row[row.length - 1] === '') row.pop();
    }
    const esc = v => {
      let s = String(v == null ? '' : v);
      if (/^[=+@\t\r]/.test(s) || /^-[^0-9]/.test(s)) s = "'" + s;  // 表計算ソフトで数式として動かないように
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    fs.appendFileSync(LOG_PATH, row.map(esc).join(',') + '\n');
  } catch (e) {}
}
function jstNow() {
  return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
}
// analytics.csv を読み込んで、1行=1オブジェクトの配列にする（ダッシュボード表示・キャンセル処理で共用）
function loadAnalyticsRows() {
  let rows = [];
  try {
    const csv = fs.readFileSync(LOG_PATH, 'utf8').replace(/^﻿/, '');
    const lines = csv.split('\n').filter(l => l.trim());
    const head = lines.shift().split(',');
    rows = lines.map(line => {
      // 簡易CSVパース（"..." の中のカンマに対応）
      const cells = []; let cur = ''; let q = false;
      for (const ch of line) {
        if (ch === '"') q = !q;
        else if (ch === ',' && !q) { cells.push(cur); cur = ''; }
        else cur += ch;
      }
      cells.push(cur);
      const o = {};
      head.forEach((h, i) => o[h] = (cells[i] || '').trim());
      return o;
    });
  } catch (e) {}
  return rows;
}
function escHtml(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
// キャンセル処理・取り消しの確認画面（共通の簡単なテンプレート）
function simpleConfirmPage(heading, bodyHtml, actionHref, actionLabel, backHref) {
  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(heading)} - NOGIKU 予約データ</title>
<style>
  body{margin:0;background:#efe8d4;color:#2b2620;font-family:"Hiragino Sans","Yu Gothic",-apple-system,sans-serif;line-height:1.8;}
  .wrap{max-width:520px;margin:60px auto;padding:0 20px;}
  .card{background:#fff;border:1px solid #d9cfae;border-radius:16px;padding:28px 24px;}
  h1{font-size:18px;margin:0 0 16px;}
  p{font-size:14px;margin:0 0 12px;}
  .btn{display:inline-block;padding:11px 22px;border-radius:100px;text-decoration:none;font-weight:800;font-size:14px;margin:6px 8px 0 0;}
  .btn.go{background:#a33;color:#fff;}
  .btn.back{background:#fff;color:#2b2620;border:1px solid #d9cfae;}
</style></head>
<body><div class="wrap"><div class="card">
  <h1>${escHtml(heading)}</h1>
  ${bodyHtml}
  <div style="margin-top:20px;">
    ${actionHref ? `<a class="btn go" href="${actionHref}">${escHtml(actionLabel)}</a>` : ''}
    <a class="btn back" href="${backHref}">戻る</a>
  </div>
</div></div></body></html>`;
}
function jstParts(isoUtc) {
  const d = new Date(new Date(isoUtc).getTime() + 9 * 3600000);
  return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) };
}
const ROOM_LABEL = { amaterasu: '天照', tsukuyomi: '月読' };
function planParts(plan) {
  if (!plan) return { name: '', room: '' };
  if (plan.startsWith('ryokan180_')) return { name: '180分旅館', room: ROOM_LABEL[plan.replace('ryokan180_', '')] || '' };
  return { name: '120分', room: ROOM_LABEL[plan.replace('120', '')] || '' };
}
// どこから来たお客様か（Instagram・検索・直接など）
function sourceLabel(ref, utm) {
  if (utm) return String(utm).slice(0, 40);  // ?utm=... が付いていればそれを優先
  if (!ref) return '直接・不明';
  const r = String(ref).toLowerCase();
  if (r.includes('instagram') || r.includes('l.instagram')) return 'Instagram';
  if (r.includes('google')) return 'Google検索';
  if (r.includes('yahoo')) return 'Yahoo検索';
  if (r.includes('t.co') || r.includes('twitter') || r.includes('x.com')) return 'X(Twitter)';
  if (r.includes('facebook')) return 'Facebook';
  if (r.includes('line')) return 'LINE';
  if (r.includes('tiktok')) return 'TikTok';
  if (r.includes('nogiku')) return 'サイト内';
  try { return new URL(ref).hostname; } catch (e) { return 'その他'; }
}
// スマホかパソコンか
function deviceLabel(ua) {
  if (!ua) return '';
  const u = String(ua).toLowerCase();
  if (u.includes('ipad') || (u.includes('android') && !u.includes('mobile'))) return 'タブレット';
  if (u.includes('iphone') || u.includes('android') || u.includes('mobile')) return 'スマホ';
  return 'パソコン';
}
// 予約日の何日前に申し込まれたか
function daysAhead(startAtUtc) {
  const days = (new Date(startAtUtc).getTime() - Date.now()) / 86400000;
  return Math.max(0, Math.round(days));
}

// 住所から都道府県だけ取り出す（市区町村以下は記録しない）
function prefOnly(addr) {
  if (!addr) return '';
  const m = String(addr).match(/^(北海道|東京都|京都府|大阪府|.{2,3}[県])/);
  return m ? m[1] : '';
}

// 住所から市区町村の名前だけ取り出す（番地・建物名は記録しない）
//   例：「大分県由布市湯布院町川上…」→「由布市」／「福岡県福岡市博多区…」→「福岡市」（区は記録しない）
//       「大分県玖珠郡九重町…」→「九重町」（郡は省く）／「東京都新宿区…」→「新宿区」（東京23区は区まで）
//   名前の途中に「市・町・村」が入る地名は、下の一覧で先に判定する
const CITY_SPECIAL = ['四日市市', '廿日市市', '野々市市', '大町市', '十日町市', '武蔵村山市', '東村山市', '村山市',
  '村上市', '田村市', '大村市', '羽村市', '町田市', '市川市', '市原市', '市川三郷町', '市貝町'];
function cityOnly(addr) {
  if (!addr) return '';
  let s = String(addr).replace(/\s/g, '');
  const pref = prefOnly(s);
  if (pref) s = s.slice(pref.length);
  const sp = CITY_SPECIAL.find(c => s.startsWith(c));
  if (sp) return sp;
  // 「〇〇郡△△町」は郡を省いて町村名だけ
  const g = s.match(/^(.{1,4}?)郡(.{1,6}?[町村])/);
  if (g) return g[2];
  // 1文字目以降で最初に出てくる「市」「町」「村」（東京都だけは「区」も）までを市区町村名とみなす
  const re = pref === '東京都' ? /^(.{1,7}?[市区町村])/ : /^(.{1,7}?[市町村])/;
  const m = s.match(re);
  return m ? m[1] : '';
}

// ==========================================================================
// 「注文」を自動で完了にする
//   サウナの予約では商品の受け渡し管理は不要なので、
//   決済＆予約作成が済んだら注文を完了扱いにして、通知バッジを残さない
// ==========================================================================
async function completeOrder(orderId) {
  if (!orderId) return;
  try {
    const or = await sq('GET', '/v2/orders/' + orderId);
    const order = or.data.order;
    if (!order) return;
    const locId = order.location_id || await getLocationId();

    // 受け渡し情報（fulfillment）があれば完了にする
    const fulfillments = order.fulfillments || [];
    if (fulfillments.length) {
      const updated = fulfillments
        .filter(f => f.state !== 'COMPLETED' && f.state !== 'CANCELED')
        .map(f => ({ uid: f.uid, state: 'COMPLETED' }));
      if (updated.length) {
        await sq('PUT', '/v2/orders/' + orderId, {
          idempotency_key: 'ful-' + orderId,
          order: { location_id: locId, version: order.version, fulfillments: updated }
        });
      }
    }

    // 注文そのものも「完了」にする
    const fresh = await sq('GET', '/v2/orders/' + orderId);
    const ver = (fresh.data.order && fresh.data.order.version) || order.version;
    if ((fresh.data.order || order).state !== 'COMPLETED') {
      await sq('PUT', '/v2/orders/' + orderId, {
        idempotency_key: 'cmp-' + orderId,
        order: { location_id: locId, version: ver, state: 'COMPLETED' }
      });
    }
  } catch (e) { console.error('注文完了処理エラー:', String(e)); }
}

// ==========================================================================
// お店への予約通知
//   SquareはAPI経由の予約だとお店に通知を送らないため、こちらから知らせる
//   （サーバーの mail コマンドを使用。届かない場合は notifications.json に残る）
// ==========================================================================
const STORE_EMAIL = 'nogikusauna@gmail.com';
const NOTIFY_PATH = path.join(__dirname, 'notifications.json');
function notifyStore(h) {
  const jp = jstParts(h.start_at);
  const wd = ['日','月','火','水','木','金','土'][new Date(jp.date + 'T00:00:00Z').getUTCDay()];
  const body = [
    '【NOGIKU】新しいご予約が入りました',
    '',
    'プラン : ' + h.label,
    '人数   : ' + h.people + '名',
    '日時   : ' + jp.date + '（' + wd + '）' + jp.time + '〜',
    '',
    'お名前 : ' + (h.name || '') + ' 様',
    'お電話 : ' + (h.tel || ''),
    'メール : ' + (h.email || '（未入力）'),
    'ご住所 : ' + (h.addr || '（未入力）'),
    'ご要望 : ' + (h.note || 'なし'),
    '',
    '※ お支払いは完了しています。',
    '※ Squareの予約カレンダーにも登録済みです。'
  ].join('\n');

  try {
    // ※ シェルを経由せず mail コマンドを直接呼び出す（お客様の入力がコマンドとして
    //    実行されてしまう「コマンドインジェクション」を防ぐため。本文は標準入力で渡す）
    const { execFile } = require('child_process');
    const subject = '【NOGIKU】新しいご予約（' + jp.date + ' ' + jp.time + '）';
    const child = execFile('mail', ['-s', subject, STORE_EMAIL], (err) => {
      if (err) console.error('通知メール送信エラー:', err.message);
    });
    child.stdin.write(body);
    child.stdin.end();
  } catch (e) { console.error('通知エラー:', String(e)); }

  // 送信できなかった場合に備えて記録も残す（個人情報は保存しない：日時・プラン・人数のみ）
  try {
    let list = [];
    try { list = JSON.parse(fs.readFileSync(NOTIFY_PATH, 'utf8')); } catch (e) {}
    list.push({ at: jstNow(), date: jp.date, time: jp.time, plan: h.label, people: h.people });
    if (list.length > 200) list = list.slice(-200);
    fs.writeFileSync(NOTIFY_PATH, JSON.stringify(list, null, 2));
  } catch (e) {}
}

// 決済済みなのに予約が作れなかったケースの記録（お店が確認するため）
//   ※ 連絡に必要な氏名・電話・メールのみ保存し、住所などは保存しない。
//     30日を過ぎた記録は読み込み時に自動で削除する（対応済みのはずのため）
const FAIL_PATH = path.join(__dirname, 'failures.json');
const FAILURE_RETENTION_MS = 30 * 24 * 3600 * 1000;
function loadFailures() {
  try {
    const list = JSON.parse(fs.readFileSync(FAIL_PATH, 'utf8'));
    const cutoff = Date.now() - FAILURE_RETENTION_MS;
    const kept = list.filter(f => new Date(f.at).getTime() > cutoff);
    if (kept.length !== list.length) saveFailures(kept);
    return kept;
  } catch (e) { return []; }
}
function saveFailures(list) { try { fs.writeFileSync(FAIL_PATH, JSON.stringify(list, null, 2)); } catch (e) {} }

setInterval(sweepPending, 20 * 1000); // 20秒ごとに確認（決済後すぐ予約を作るため）
setTimeout(sweepPending, 10 * 1000);  // 起動直後にも1回

// ==========================================================================
// データ分析ダッシュボード（お店の判断に使う画面）
// ==========================================================================
// ==========================================================================
// サイトに来た人の数（日ごと・流入元ごとの合計だけを残す。個人は記録しない）
//   visits.json = { "2026-10-06": { "Instagram": 12, "Googleマップ": 3 }, ... }
// ==========================================================================
const VISITS_PATH = path.join(__dirname, 'visits.json');
function loadVisits() { try { return JSON.parse(fs.readFileSync(VISITS_PATH, 'utf8')) || {}; } catch (e) { return {}; } }
function addVisit(src) {
  try {
    const v = loadVisits();
    const d = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    const day = v[d] || (v[d] = {});
    if (!(src in day) && Object.keys(day).length >= 300) src = 'その他';  // いたずらで種類が増えすぎないように
    day[src] = (day[src] || 0) + 1;
    fs.writeFileSync(VISITS_PATH, JSON.stringify(v));
  } catch (e) {}
}
// 期間内の合計（from/to は 'YYYY-MM-DD'、空なら制限なし）
function sumVisits(from, to) {
  const v = loadVisits(), m = {};
  Object.keys(v).forEach(d => {
    if (from && d < from) return;
    if (to && d > to) return;
    Object.entries(v[d] || {}).forEach(([k, n]) => { m[k] = (m[k] || 0) + n; });
  });
  return m;
}
const BOT_UA = /bot|crawl|spider|slurp|preview|headless|lighthouse|facebookexternalhit|embedly|curl|wget|python|monitor/i;

function dashboardPage(rows, failures, period, from, to, key, allRows, msg, visitCounts) {
  period = period || 'all';
  from = from || '';
  to = to || '';
  key = key || '';
  const keyQS = 'key=' + encodeURIComponent(key);
  const periodLabel = (from || to)
    ? ((from || '最初') + ' 〜 ' + (to || '今日'))
    : (period === 'day' ? '今日' : period === 'yesterday' ? '昨日' : period === 'week' ? '今週' : period === 'month' ? '今月' : '全期間');
  const esc = v => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // 期間の絞り込み用に、日付だけ取り出す
  const clicks = rows.filter(r => r['段階'] === '①時間を選択');
  const forms  = rows.filter(r => r['段階'] === '②決済ページへ');
  const dropForm = rows.filter(r => r['段階'] === '×入力画面で中断');
  const dropTime = rows.filter(r => r['段階'] === '×時間切れ');

  // キャンセル状態の判定：③決済完了のあとに「④キャンセル」「④キャンセル取消」が
  // 追記されていたら、同じセッションIDの中で一番新しい記録を「今の状態」とする
  //   ※ 2026-09-30修正：期間で絞り込む前の「全部の記録」から判定する。
  //     （以前は、予約した月とキャンセルした月が違うと、キャンセルが反映されなかった）
  const stateRows = allRows || rows;
  const cancelStatus = {};
  const extraCancelled = {};
  stateRows.forEach(r => {
    const sid = r['セッションID'];
    if (!sid) return;
    if (r['段階'] === '④キャンセル' || r['段階'] === '④キャンセル取消') cancelStatus[sid] = (r['段階'] === '④キャンセル');
    if (r['段階'] === '⑤追加売上取消') extraCancelled[sid] = true;
  });
  const isCancelledRow = r => !!(r['セッションID'] && cancelStatus[r['セッションID']]);
  const yen = v => (parseInt(v || '0', 10) || 0);

  const paidAll = rows.filter(r => r['段階'] === '③決済完了');
  const paid = paidAll.filter(r => !isCancelledRow(r));           // キャンセル済みは集計から除外
  const cancelledList = paidAll.filter(r => isCancelledRow(r));
  const isPhone = r => r['流入元'] === '電話';
  const paidOnline = paid.filter(r => !isPhone(r));               // ネット予約だけ（成約率・進み具合に使う）
  const phoneCount = paid.length - paidOnline.length;

  const sales = paid.reduce((a, r) => a + yen(r['金額']), 0);                 // 予約の売上（キャンセル分を除く）
  const cancelledSales = cancelledList.reduce((a, r) => a + yen(r['金額']), 0);
  const extraList = rows.filter(r => r['段階'] === '⑤追加売上' && !extraCancelled[r['セッションID']]);
  // 追加売上込みの客単価・追加売上は、追加売上を月ごとに入れる仕組みのため「今月」「全期間」「期間指定」で表示する
  //  （「今日」「今週」では、月末日付の追加売上が紛れ込まないように数えない）
  const showCust = (from || to) || period === 'month' || period === 'all';
  const extraSales = showCust ? extraList.reduce((a, r) => a + yen(r['金額']), 0) : 0;   // 追加売上（月ごとの合計）
  const totalSales = sales + extraSales;
  const cvr = clicks.length ? Math.round(paidOnline.length / clicks.length * 1000) / 10 : 0;
  const avg = paid.length ? Math.round(sales / paid.length) : 0;
  const custAvg = paid.length ? Math.round(totalSales / paid.length) : 0;
  const cancelRate = paidAll.length ? Math.round(cancelledList.length / paidAll.length * 1000) / 10 : 0;
  // 追加売上の入力済み一覧（期間に関係なく、新しい月から）
  const extraAll = stateRows.filter(r => r['段階'] === '⑤追加売上' && !extraCancelled[r['セッションID']])
    .sort((a, b) => (a['予約日'] < b['予約日'] ? 1 : -1));
  const MSGS = {
    phone_ok: ['ok', '電話予約を追加しました。'],
    phone_ng: ['ng', '電話予約を追加できませんでした。日付・時間・人数・金額を確認してください。'],
    extra_ok: ['ok', '追加売上を追加しました。'],
    extra_ng: ['ng', '追加売上を追加できませんでした。月と金額を確認してください。'],
    extra_cancel: ['ok', '追加売上を取り消しました。']
  };
  const flash = MSGS[msg];
  const thisMonth = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7);
  const todayJ = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

  // 集計のしかた
  const countBy = (list, key, mapper) => {
    const m = {};
    list.forEach(r => {
      const k = mapper ? mapper(r) : (r[key] || '（不明）');
      if (!k) return;
      m[k] = (m[k] || 0) + 1;
    });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  };

  // 棒グラフのHTMLを作る
  const bars = (data, unit) => {
    if (!data.length) return '<p class="empty">まだデータがありません</p>';
    const max = data[0][1];
    return data.map(([k, v]) => `
      <div class="bar-row">
        <div class="bar-label">${esc(k)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${max ? v / max * 100 : 0}%"></div></div>
        <div class="bar-value">${v}${unit || '件'}</div>
      </div>`).join('');
  };

  const planData   = countBy(paid, 'プラン');
  const roomData   = countBy(paid, '部屋');
  const peopleData = countBy(paid, null, r => (r['人数'] ? r['人数'] + '名' : ''));
  const timeData   = countBy(paid, '予約時刻');
  const wdData     = countBy(paid, '曜日区分');
  const prefData   = countBy(paid, '都道府県');
  const cityData   = countBy(paid, null, r => (r['市区町村'] ? (r['都道府県'] || '') + r['市区町村'] : ''));
  const srcClick   = countBy(clicks, '流入元');
  // サイトに来た人 × 時間を選んだ人 × 予約した人 を、流入元ごとに並べる
  const vc = visitCounts || {};
  const clickMap = Object.fromEntries(srcClick), paidMap = Object.fromEntries(countBy(paid, '流入元'));
  const srcKeys = Array.from(new Set([].concat(Object.keys(vc), Object.keys(clickMap), Object.keys(paidMap))))
    .sort((a, b) => ((vc[b] || 0) - (vc[a] || 0)) || ((clickMap[b] || 0) - (clickMap[a] || 0)));
  const vTotal = Object.values(vc).reduce((a, b) => a + b, 0);
  const visitTableHtml = srcKeys.length ? `<div class="card" style="overflow-x:auto;margin-bottom:26px;"><table>
    <tr><th>どこから来たか</th><th style="text-align:right;">サイトに来た人</th><th style="text-align:right;">時間を選んだ人</th><th style="text-align:right;">予約した人</th></tr>
    ${srcKeys.map(k => `<tr><td>${esc(k)}</td><td style="text-align:right;">${vc[k] || 0}人</td><td style="text-align:right;">${clickMap[k] || 0}人</td><td style="text-align:right;">${paidMap[k] || 0}件</td></tr>`).join('')}
    <tr style="font-weight:700;"><td>合計</td><td style="text-align:right;">${vTotal}人</td><td style="text-align:right;">${clicks.length}人</td><td style="text-align:right;">${paid.length}件</td></tr>
  </table>
  <p class="fnote" style="margin-top:10px;">※「サイトに来た人」は、1回の訪問で1人として数えています（同じ人が日を変えて来た場合は、また1人と数えます）。2026年10月6日から数え始めました。電話予約は「電話」として、予約した人にだけ入ります。</p></div>`
    : '<div class="card" style="margin-bottom:26px;"><p class="empty">まだデータがありません</p></div>';
  const srcPaid    = countBy(paid, '流入元');
  const repeatData = countBy(paid, '新規/リピーター');
  const devData    = countBy(clicks, '端末');
  const aheadData  = countBy(paid, null, r => {
    const d = parseInt(r['何日前'] || '', 10);
    if (isNaN(d)) return '';
    if (d === 0) return '当日';
    if (d <= 3) return '1〜3日前';
    if (d <= 7) return '4〜7日前';
    if (d <= 14) return '8〜14日前';
    return '15日以上前';
  });

  // 決済完了の予約一覧（支払いがあった新しい順。キャンセルがしやすいように、最近の動きとは別に表示）
  const paidListHtml = paidAll.slice().sort((a, b) => (a['記録日時(JST)'] < b['記録日時(JST)'] ? 1 : -1)).map(r => {
    const sid = r['セッションID'] || '';
    const cancelled = isCancelledRow(r);
    const action = cancelled
      ? '<span style="color:#a33;font-weight:700;">キャンセル済み</span><br><a class="uncancel-link" href="/confirm-uncancel?id=' + encodeURIComponent(sid) + '&' + keyQS + '">（取り消しを戻す）</a>'
      : '<a class="cancel-link" href="/confirm-cancel?id=' + encodeURIComponent(sid) + '&' + keyQS + '">キャンセルにする</a>';
    return `
    <tr${cancelled ? ' style="opacity:.5;"' : ''}>
      <td>${esc(r['記録日時(JST)'] || '')}</td>
      <td>${esc(r['予約日'] || '')} ${esc(r['予約時刻'] || '')}</td>
      <td>${esc(r['プラン'] || '')} ${esc(r['部屋'] || '')}</td>
      <td>${esc(r['人数'] || '')}${r['人数'] ? '名' : ''}</td>
      <td>${cancelled ? '<s>¥' + yen(r['金額']).toLocaleString() + '</s>' : '¥' + yen(r['金額']).toLocaleString()}</td>
      <td>${esc(r['流入元'] || '')}</td>
      <td>${esc((r['都道府県'] || '') + (r['市区町村'] || ''))}</td>
      <td>${action}</td>
    </tr>`;
  }).join('');

  // 最近の動き（新しい順に200件。③決済完了の行にはキャンセル操作のリンクを付ける）
  const RECENT_COUNT = 200;
  //   ※ 2026-09-30：「×入力画面で中断」は数が多く大事な行が埋もれるため一覧には出さない（人数は「どこまで進んだか」に表示）
  const recent = rows.filter(r => r['段階'] !== '×入力画面で中断').slice(-RECENT_COUNT).reverse().map(r => {
    const stage = r['段階'] || '';
    const sid = r['セッションID'] || '';
    let actionCell = '';
    const amt = yen(r['金額']);
    let amountCell = r['金額'] ? '¥' + amt.toLocaleString() : '';
    if (stage === '④キャンセル' && amt) amountCell = '<span style="color:#a33;font-weight:700;">−¥' + amt.toLocaleString() + '</span>';
    if (stage === '④キャンセル取消' && amt) amountCell = '<span style="color:#2f6b4a;">（¥' + amt.toLocaleString() + ' を戻す）</span>';
    if (stage === '⑤追加売上') {
      amountCell = '<span style="color:#2f6b4a;font-weight:700;">+¥' + amt.toLocaleString() + '</span>';
      actionCell = extraCancelled[sid] ? '<span style="color:#a33;">取り消し済み</span>'
        : '<a class="uncancel-link" href="/cancel-extra?id=' + encodeURIComponent(sid) + '&' + keyQS + '">（取り消す）</a>';
    }
    if (stage === '⑤追加売上取消' && amt) amountCell = '<span style="color:#a33;">−¥' + amt.toLocaleString() + '</span>';
    if (stage === '③決済完了' && sid) {
      if (isCancelledRow(r)) {
        actionCell = '<span style="color:#a33;font-weight:700;">キャンセル済み</span><br>'
          + '<a class="uncancel-link" href="/confirm-uncancel?id=' + encodeURIComponent(sid) + '&' + keyQS + '">（取り消しを戻す）</a>';
      } else {
        actionCell = '<a class="cancel-link" href="/confirm-cancel?id=' + encodeURIComponent(sid) + '&' + keyQS + '">キャンセルにする</a>';
      }
    }
    return `
    <tr>
      <td>${esc(r['記録日時(JST)'] || '')}</td>
      <td><span class="stage s${esc(stage.charAt(0))}">${esc(stage)}</span></td>
      <td>${stage.charAt(0) === '⑤' ? esc((r['予約日'] || '') + '分') : esc(r['プラン'] || '') + ' ' + esc(r['部屋'] || '')}</td>
      <td>${esc(r['人数'] || '')}${r['人数'] ? '名' : ''}</td>
      <td>${stage.charAt(0) === '⑤' ? '' : esc(r['予約日'] || '') + ' ' + esc(r['予約時刻'] || '')}</td>
      <td>${esc(r['流入元'] || '')}</td>
      <td>${esc((r['都道府県'] || '') + (r['市区町村'] || ''))}</td>
      <td>${amountCell}</td>
      <td>${actionCell}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>NOGIKU 予約データ</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Shippori+Mincho+B1:wght@700&display=swap" rel="stylesheet">
<style>
  :root{--cream:#efe8d4;--paper:#fff;--ink:#2b2620;--sub:#83795f;--line:#d9cfae;
        --ember:#df571d;--ok:#3f7d5c;--font-display:"Shippori Mincho B1",serif;}
  *{box-sizing:border-box;}
  body{margin:0;background:var(--cream);color:var(--ink);
       font-family:"Inter","Hiragino Sans","Yu Gothic",-apple-system,sans-serif;line-height:1.8;}
  .wrap{max-width:960px;margin:0 auto;padding:0 16px 60px;}
  header{text-align:center;padding:30px 0 18px;}
  header h1{font-family:var(--font-display);font-size:22px;margin:0 0 6px;}
  header p{font-size:12.5px;color:var(--sub);margin:0;}

  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:26px;}
  .kpi{background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:16px 18px;text-align:center;}
  .kpi .label{font-size:11.5px;color:var(--sub);font-weight:700;}
  .kpi .value{font-size:26px;font-weight:800;color:var(--ember);line-height:1.3;}
  .kpi .unit{font-size:13px;font-weight:700;color:var(--sub);}

  .funnel{background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:20px;margin-bottom:26px;}
  .funnel h2{margin-top:0;}
  .fstep{display:flex;align-items:center;gap:12px;margin-bottom:10px;}
  .fstep .fname{width:130px;font-size:13px;font-weight:700;flex:0 0 auto;}
  .fstep .ftrack{flex:1;height:26px;background:var(--cream);border-radius:6px;overflow:hidden;}
  .fstep .ffill{height:100%;background:var(--ok);opacity:.85;}
  .fstep .fnum{width:90px;text-align:right;font-size:13px;font-weight:800;flex:0 0 auto;}
  .fnote{font-size:12px;color:var(--sub);margin:10px 0 0;}

  h2{font-family:var(--font-display);font-size:16px;margin:26px 0 12px;
     padding-left:10px;border-left:4px solid var(--ember);}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;}
  .card{background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:18px 20px;}
  .card h3{font-size:14px;margin:0 0 14px;font-weight:800;}

  .bar-row{display:flex;align-items:center;gap:10px;margin-bottom:8px;}
  .bar-label{width:110px;font-size:12.5px;flex:0 0 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .bar-track{flex:1;height:18px;background:var(--cream);border-radius:4px;overflow:hidden;}
  .bar-fill{height:100%;background:var(--ember);opacity:.8;}
  .bar-value{width:52px;text-align:right;font-size:12px;font-weight:800;flex:0 0 auto;}
  .empty{font-size:12.5px;color:var(--sub);margin:0;}

  table{width:100%;border-collapse:collapse;font-size:12px;}
  th,td{padding:7px 8px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap;}
  th{color:var(--sub);font-size:11px;font-weight:700;}
  .stage{display:inline-block;padding:2px 8px;border-radius:100px;font-size:11px;font-weight:800;}
  .stage.s①{background:#e8eef5;color:#2f5d8a;}
  .stage.s②{background:#f5eee0;color:#a8611f;}
  .stage.s③{background:#e3ede4;color:#2f6b4a;}
  .stage.s×{background:#f3e6e6;color:#a33;}
  .stage.s④{background:#f3e6e6;color:#a33;}
  .stage.s⑤{background:#eef0e0;color:#5b6b1f;}
  .kpi .note{font-size:11px;color:var(--sub);line-height:1.5;margin-top:2px;}
  .flash{border-radius:12px;padding:12px 16px;margin-bottom:18px;font-size:13.5px;font-weight:700;}
  .flash.ok{background:#e3ede4;color:#2f6b4a;} .flash.ng{background:#fdecea;color:#a33;}
  .entry{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:13px;}
  .entry label{display:flex;flex-direction:column;font-size:11px;color:var(--sub);font-weight:700;gap:2px;}
  .entry input,.entry select{padding:7px 9px;border:1px solid var(--line);border-radius:8px;font-size:13px;font-family:inherit;background:#fff;color:var(--ink);}
  .entry button{padding:9px 18px;border:none;border-radius:100px;background:#2b2620;color:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;align-self:flex-end;}
  .hint{font-size:11.5px;color:var(--sub);margin:10px 0 0;line-height:1.7;}
  .cancel-link{color:#a33;text-decoration:none;font-weight:700;font-size:12px;}
  .uncancel-link{font-size:11px;color:#83795f;}
  .scroll{overflow-x:auto;}

  .actions{text-align:center;margin:26px 0 0;}
  .actions a{display:inline-block;padding:11px 20px;border-radius:100px;background:var(--ember);
             color:#fff;text-decoration:none;font-size:13px;font-weight:800;margin:0 4px;}
  .actions a.sub{background:var(--paper);color:var(--ink);border:1px solid var(--line);}
</style></head>
<body><div class="wrap">
${(failures && failures.length) ? `
  <div style="background:#fdecea;border:2px solid #c0392b;border-radius:14px;padding:18px 20px;margin-bottom:22px;">
    <div style="font-size:17px;font-weight:800;color:#c0392b;margin-bottom:8px;">⚠️ 至急ご確認ください</div>
    <div style="font-size:14px;color:#2b2620;line-height:1.9;">
      お支払いは完了したのに、ご予約が作成できなかったお客様が <b>${failures.length}件</b> あります。<br>
      お客様は「予約できた」と思っている可能性があります。至急、ご連絡のうえ返金または別のお時間のご案内をお願いします。
    </div>
    <div style="margin-top:12px;font-size:13px;">
      ${failures.slice(-5).reverse().map(f => {
        const jp = f.start_at ? new Date(new Date(f.start_at).getTime() + 9*3600000).toISOString().slice(0,16).replace('T',' ') : '(不明)';
        return `<div style="background:#fff;border-radius:8px;padding:10px 12px;margin-bottom:6px;">
          <b>${esc(f.name || '(お名前不明)')}</b> 様 ／ ${esc(f.tel || '(電話不明)')} ／ ${esc(f.email || '')}<br>
          ご希望：${esc(f.label || '')} ${esc(f.people || '')}名 ／ ${esc(jp)}〜
        </div>`;
      }).join('')}
    </div>
  </div>` : ''}

  <header>
    <h1>NOGIKU 予約データ</h1>
    <p>${new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' ')} 現在（${periodLabel}）</p>
  </header>

  ${flash ? '<div class="flash ' + flash[0] + '">' + esc(flash[1]) + '</div>' : ''}
  <div style="display:flex;gap:8px;justify-content:center;margin-bottom:22px;flex-wrap:wrap;">
    ${[['day','今日'],['yesterday','昨日'],['week','今週'],['month','今月'],['all','全期間']].map(function(p){
      var v = p[0], l = p[1], on = !(from || to) && (period === v);
      return '<a href="/dashboard?period=' + v + '&' + keyQS + '" style="padding:9px 20px;border-radius:100px;text-decoration:none;font-size:13.5px;font-weight:700;border:1px solid ' + (on ? '#df571d' : '#d9cfae') + ';background:' + (on ? '#df571d' : '#fff') + ';color:' + (on ? '#fff' : '#2b2620') + ';">' + l + '</a>';
    }).join('')}
  </div>

  <form method="get" action="/dashboard" style="display:flex;gap:8px;justify-content:center;align-items:center;margin-bottom:24px;flex-wrap:wrap;font-size:13px;color:#83795f;">
    <input type="hidden" name="key" value="${esc(key)}">
    <span>期間を指定：</span>
    <input type="date" name="from" value="${esc(from)}" style="padding:7px 10px;border:1px solid #d9cfae;border-radius:8px;font-size:13px;font-family:inherit;">
    <span>〜</span>
    <input type="date" name="to" value="${esc(to)}" style="padding:7px 10px;border:1px solid #d9cfae;border-radius:8px;font-size:13px;font-family:inherit;">
    <button type="submit" style="padding:8px 18px;border:none;border-radius:100px;background:#2b2620;color:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;">表示</button>
  </form>

  <div class="kpis">
    <div class="kpi"><div class="label">予約件数</div><div class="value">${paid.length}<span class="unit">件</span></div>
      <div class="note">${phoneCount ? 'うち電話予約 ' + phoneCount + '件' : 'キャンセル分を除く'}</div></div>
    <div class="kpi"><div class="label">予約の売上</div><div class="value">¥${sales.toLocaleString()}</div>
      <div class="note">${cancelledSales ? '¥' + (sales + cancelledSales).toLocaleString() + ' − キャンセル ¥' + cancelledSales.toLocaleString() : 'キャンセル分を除く'}</div></div>
    <div class="kpi"><div class="label">追加売上</div><div class="value">${showCust ? '¥' + extraSales.toLocaleString() : '—'}</div>
      <div class="note">${showCust ? 'レンタル品・ドリンクなど（月ごとの合計）' : '「今月」か月単位の期間で表示'}</div></div>
    <div class="kpi"><div class="label">合計の売上</div><div class="value">¥${totalSales.toLocaleString()}</div>
      <div class="note">予約の売上＋追加売上</div></div>
    <div class="kpi"><div class="label">成約率</div><div class="value">${cvr}<span class="unit">%</span></div>
      <div class="note">ネット予約のみ</div></div>
    <div class="kpi"><div class="label">平均単価（予約のみ）</div><div class="value">¥${avg.toLocaleString()}</div>
      <div class="note">予約の売上 ÷ 予約件数</div></div>
    <div class="kpi"><div class="label">客単価（追加売上込み）</div><div class="value">${showCust ? '¥' + custAvg.toLocaleString() : '—'}</div>
      <div class="note">${showCust ? '合計の売上 ÷ 予約件数' : '「今月」か月単位の期間で表示'}</div></div>
    <div class="kpi"><div class="label">キャンセル件数</div><div class="value" style="color:#a33;">${cancelledList.length}<span class="unit">件</span></div></div>
    <div class="kpi"><div class="label">キャンセル率</div><div class="value" style="color:#a33;">${cancelRate}<span class="unit">%</span></div></div>
  </div>

  <h2>決済完了の予約一覧（支払いがあった新しい順・${esc(periodLabel)}）</h2>
  <div class="card scroll" style="margin-bottom:26px;max-height:520px;overflow-y:auto;">
    ${paidAll.length ? `<table>
      <tr><th>支払日時</th><th>利用日時</th><th>プラン</th><th>人数</th><th>金額</th><th>流入元</th><th>地域</th><th>状態・操作</th></tr>
      ${paidListHtml}
    </table>
    <p class="hint">※ 電話予約は、利用日時を支払日時として表示しています。キャンセル済みの予約は薄い色で表示し、売上には含めていません。</p>`
    : '<p class="empty">この期間の決済完了の予約はありません</p>'}
  </div>

  <h2>サイトに来た人（どこから来たか・${esc(periodLabel)}）</h2>
  ${visitTableHtml}

  <div class="funnel">
    <h2 style="border:none;padding:0;margin:0 0 14px;">お客様がどこまで進んだか</h2>
    <div class="fstep">
      <div class="fname">① 時間を選んだ</div>
      <div class="ftrack"><div class="ffill" style="width:100%"></div></div>
      <div class="fnum">${clicks.length} 人</div>
    </div>
    <div class="fstep">
      <div class="fname">② 決済ページへ</div>
      <div class="ftrack"><div class="ffill" style="width:${clicks.length ? forms.length / clicks.length * 100 : 0}%"></div></div>
      <div class="fnum">${forms.length} 人</div>
    </div>
    <div class="fstep">
      <div class="fname">③ 決済まで完了</div>
      <div class="ftrack"><div class="ffill" style="width:${clicks.length ? Math.min(100, paidOnline.length / clicks.length * 100) : 0}%"></div></div>
      <div class="fnum">${paidOnline.length} 人</div>
    </div>
    <p class="fnote">
      入力画面で離脱：${dropForm.length}人 ／ 決済ページで離脱（10分切れ）：${dropTime.length}人${phoneCount ? ' ／ 電話予約：' + phoneCount + '件（この表には含みません）' : ''}<br>
      ※ ②が①より大きく減っていれば「入力が面倒」、③が②より大きく減っていれば「決済で迷っている」サインです。
    </p>
  </div>

  <h2>お客様のこと</h2>
  <div class="grid">
    <div class="card"><h3>新規 / リピーター</h3>${bars(repeatData)}</div>
    <div class="card"><h3>どこから来たか（流入元・予約した人）</h3>${bars(srcPaid)}</div>
    <div class="card"><h3>どこから来たか（流入元・時間を選んだ人）</h3>${bars(srcClick, '人')}</div>
    <div class="card"><h3>都道府県</h3>${bars(prefData)}</div>
    <div class="card"><h3>市区町村（ご記入いただいた方のみ）</h3>${bars(cityData)}</div>
    <div class="card"><h3>端末（時間を選んだ人）</h3>${bars(devData, '人')}</div>
    <div class="card"><h3>何日前に予約したか</h3>${bars(aheadData)}</div>
  </div>

  <h2>売れ方のこと</h2>
  <div class="grid">
    <div class="card"><h3>プラン別</h3>${bars(planData)}</div>
    <div class="card"><h3>部屋別（天照 / 月読）</h3>${bars(roomData)}</div>
    <div class="card"><h3>人数別</h3>${bars(peopleData)}</div>
    <div class="card"><h3>人気の時間帯</h3>${bars(timeData)}</div>
    <div class="card"><h3>平日 / 土日祝</h3>${bars(wdData)}</div>
  </div>

  <h2>手入力（電話予約・追加売上）</h2>
  <div class="grid">
    <div class="card">
      <h3>電話予約を追加する</h3>
      <form class="entry" method="get" action="/add-phone">
        <input type="hidden" name="key" value="${esc(key)}">
        <label>利用日<input type="date" name="date" value="${todayJ}" required></label>
        <label>時間<input type="time" name="time" value="11:00" step="1800" required></label>
        <label>プラン<select name="plan"><option>120分</option><option>180分旅館</option></select></label>
        <label>部屋<select name="room"><option>天照</option><option>月読</option></select></label>
        <label>人数<select name="people">${[1,2,3,4,5].map(n => '<option value="' + n + '"' + (n === 2 ? ' selected' : '') + '>' + n + '名</option>').join('')}</select></label>
        <label>金額（円）<input type="number" name="amount" min="0" step="100" required style="width:110px;"></label>
        <label>都道府県（任意）<input type="text" name="pref" placeholder="大分県" style="width:90px;"></label>
        <label>市区町村（任意）<input type="text" name="city" placeholder="由布市" style="width:90px;"></label>
        <button type="submit">追加する</button>
      </form>
      <p class="hint">※ 流入元は「電話」、支払い方法は「当日現地払い」として記録し、利用日の売上として数えます。<br>
      ※ ここに入力しても、Squareのカレンダーには登録されません。カレンダーへの登録はSquareで行ってください。<br>
      ※ 間違えた場合は、下の「最近の動き」から「キャンセルにする」で取り消せます。</p>
    </div>
    <div class="card">
      <h3>追加売上（レンタル品・ドリンクなど）を入力する</h3>
      <form class="entry" method="get" action="/add-extra">
        <input type="hidden" name="key" value="${esc(key)}">
        <label>何月分<input type="month" name="month" value="${thisMonth}" required></label>
        <label>合計金額（円）<input type="number" name="amount" min="1" step="1" required style="width:130px;"></label>
        <button type="submit">追加する</button>
      </form>
      <p class="hint">※ 月末に、その月の合計をまとめて入力してください。同じ月に何回か分けて入力すると、合算されます。</p>
      ${extraAll.length ? '<table style="margin-top:10px;"><tr><th>月</th><th>金額</th><th></th></tr>' + extraAll.slice(0, 12).map(r =>
        '<tr><td>' + esc(r['予約日']) + '分</td><td>¥' + yen(r['金額']).toLocaleString() + '</td><td><a class="uncancel-link" href="/cancel-extra?id=' + encodeURIComponent(r['セッションID']) + '&' + keyQS + '">取り消す</a></td></tr>').join('') + '</table>'
        : '<p class="empty" style="margin-top:10px;">まだ入力はありません</p>'}
    </div>
  </div>

  <h2>最近の動き（新しい順に200件・入力画面での中断は除く）</h2>
  <div class="card scroll">
    ${rows.length ? `<table>
      <tr><th>記録日時</th><th>段階</th><th>プラン</th><th>人数</th><th>予約日時</th><th>流入元</th><th>地域</th><th>金額</th><th>操作</th></tr>
      ${recent}
    </table>` : '<p class="empty">まだデータがありません</p>'}
  </div>

  <div class="actions">
    <a href="/analytics.csv?${keyQS}">CSVでダウンロード</a>
    <a href="/dashboard?${keyQS}" class="sub">最新に更新</a>
  </div>

</div></body></html>`;
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

// ---- 同じ相手からの連続アクセスを制限（仮押さえの買い占め・いたずら対策） ----
const RATE = new Map();
function tooMany(ip, kind, max, windowMs) {
  const k = kind + '|' + ip, now = Date.now();
  const arr = (RATE.get(k) || []).filter(t => now - t < windowMs);
  arr.push(now); RATE.set(k, arr);
  if (RATE.size > 5000) RATE.clear();
  return arr.length > max;
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const clientIp = String(req.headers['x-real-ip'] || req.socket.remoteAddress || '');
  const LIMITS = { '/hold': 30, '/book': 15, '/paid-check': 30, '/release': 60, '/slots': 200, '/visit': 60 };
  if (LIMITS[url] && tooMany(clientIp, url, LIMITS[url], 10 * 60000)) {
    res.statusCode = 429;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, message: 'アクセスが集中しています。少し時間をおいてお試しください。' }));
    return;
  }

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

  // ==========================================================================
  // 管理用ページの保護（公開前の安全対策）
  //  ・開発用に作った入口は完全に閉じる
  //  ・お客様の個人情報を含む画面は「合言葉」が必要
  // ==========================================================================
  const ADMIN_KEY = config.ADMIN_KEY || '';
  const CLOSED_PATHS = ['/setup', '/inspect', '/cancel-booking', '/complete-orders', '/paylink', '/availability', '/quote'];
  const SECRET_PATHS = ['/notifications', '/failures', '/dashboard', '/confirm-cancel', '/do-cancel', '/confirm-uncancel', '/do-uncancel',
    '/analytics', '/analytics.csv', '/add-phone', '/add-extra', '/cancel-extra'];
  function notFound() {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Not Found');
  }
  if (CLOSED_PATHS.indexOf(url) !== -1) { notFound(); return; }
  if (SECRET_PATHS.indexOf(url) !== -1) {
    const givenKey = new URLSearchParams(req.url.split('?')[1] || '').get('key');
    if (!ADMIN_KEY || ADMIN_KEY.length < 16 || givenKey !== ADMIN_KEY) { notFound(); return; }
  }

  // ---- サイトに来た人を数える（ページを開いた時に1回だけ呼ばれる。人数を足すだけ） ----
  if (url === '/visit' && (req.method === 'GET' || req.method === 'POST')) {
    const q = new URLSearchParams(req.url.split('?')[1] || '');
    if (!BOT_UA.test(String(req.headers['user-agent'] || ''))) {
      addVisit(sourceLabel(q.get('ref') || '', q.get('utm')));
    }
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
      const bookable = await getBookableTeam();
      const roomIds = [...bookable];
      // 念のため数回問い合わせて結果を合体する（部屋に絞り込んだので、結果のぶれは原則起きない）
      const SEARCH_TRIES = 3;
      let r = { status: 0, data: {} };
      const found = [];
      for (let i = 0; i < SEARCH_TRIES; i++) {
        r = await searchAvailability(startAt, endAt, locId, variation, roomIds);
        (r.data.availabilities || []).forEach(a => {
          (a.appointment_segments || []).forEach(seg => {
            found.push({ start_at: a.start_at, team: seg.team_member_id });
          });
        });
      }
      // 短時間キャッシュに覚えさせ、直近に見つかった枠もあわせて表示（ちらつき防止）
      const stable = rememberSlots(plan + '|' + people + '|' + date, found);
      const seen = new Set();
      const slots = [];
      const nowMs2 = Date.now();
      stable.forEach(av => {
        // 「部屋」(予約可能スタッフ)の枠だけを採用。個人カレンダー由来の枠は除外
        if (!bookable.has(av.team)) return;
        // すでに過ぎた時間は出さない
        if (new Date(av.start_at).getTime() <= nowMs2) return;
        // 他のお客様がお手続き中（仮押さえ）の枠は表示しない
        if (!seen.has(av.start_at) && !isHeld(av.start_at, av.team)) {
          seen.add(av.start_at);
          slots.push({ start_at: av.start_at, team: av.team });
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
  // ---- 入力画面を開いた時点の仮押さえ（お客様情報の入力中も枠を守る） ----
  if (url === '/hold' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const q = new URLSearchParams((req.url.split('?')[1] || ''));
    const startAt = q.get('start_at');
    const team = q.get('team');
    const prev = q.get('prev'); // 前の仮押さえ（戻る操作のとき解除する）
    if (!startAt || !team) { res.statusCode = 400; res.end(JSON.stringify({ ok: false })); return; }
    const holdPeople = parseInt(q.get('people') || '0', 10);
    if (!MENU[q.get('plan')] || !(holdPeople >= 1 && holdPeople <= 10) || isNaN(new Date(startAt).getTime())
        || !/^[A-Za-z0-9_-]{1,64}$/.test(team)) {
      res.statusCode = 400; res.end(JSON.stringify({ ok: false })); return;
    }

    let list = loadPending();
    if (prev) list = list.filter(h => h.id !== prev);           // 前の仮押さえを解除
    const now = Date.now();
    const held = list.some(h => !h.done && h.start_at === startAt && h.team === team
      && (now - h.created_at) / 60000 < HOLD_MINUTES);
    if (held) {
      savePending(list);
      res.end(JSON.stringify({ ok: false, message: 'この枠は現在ほかのお客様がお手続き中です。少し時間をおくか、別の時間をお選びください。' }));
      return;
    }
    const holdId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const src = sourceLabel(q.get('ref') || '', q.get('utm'));
    const dev = deviceLabel(req.headers['user-agent']);
    list.push({ id: holdId, created_at: now, start_at: startAt, team, stage: 'form',
                plan: q.get('plan') || '', people: String(holdPeople),
                src, dev });
    savePending(list);
    // 統計：時間枠が選ばれた（入力画面を開いた）
    const pp = planParts(q.get('plan'));
    const jp = jstParts(startAt);
    logEvent([jstNow(), '①時間を選択', pp.name, pp.room, holdPeople,
              jp.date, jp.time, isHolidayJST(startAt) ? '土日祝' : '平日', '', '', holdId,
              '', src, daysAhead(startAt), dev]);
    res.end(JSON.stringify({ ok: true, hold_id: holdId, minutes: HOLD_MINUTES }));
    return;
  }

  // ---- 仮押さえの解除（入力画面を閉じたとき） ----
  if (url === '/release' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const q = new URLSearchParams((req.url.split('?')[1] || ''));
    const id = q.get('id');
    if (id) {
      const h = loadPending().find(x => x.id === id);
      if (h && !h.order_id) {   // 決済ページに進む前にやめた場合だけ記録
        const pp = planParts(h.plan);
        const jp = jstParts(h.start_at);
        logEvent([jstNow(), '×入力画面で中断', pp.name, pp.room, h.people || '',
                  jp.date, jp.time, isHolidayJST(h.start_at) ? '土日祝' : '平日', '', '', id]);
      }
      savePending(loadPending().filter(x => x.id !== id));
    }
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ---- たまっている未完了の注文をまとめて完了にする（一時用） ----
  if (url === '/complete-orders' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    (async () => {
      const locId = await getLocationId();
      const q2 = new URLSearchParams((req.url.split('?')[1] || ''));
      const limit = Math.min(parseInt(q2.get('limit') || '5', 10) || 5, 20);
      const r = await sq('POST', '/v2/orders/search', {
        location_ids: [locId],
        query: { filter: { state_filter: { states: ['OPEN'] } } },
        limit
      });
      const orders = r.data.orders || [];
      let done = 0;
      for (const o of orders) {
        const paid = (o.tenders && o.tenders.length > 0);
        // 決済から10分たっていない注文は触らない（お客様の画面にエラーが出るため）
        const ageMin = (Date.now() - new Date(o.created_at).getTime()) / 60000;
        if (paid && ageMin >= 10) { await completeOrder(o.id); done++; }
      }
      res.end(JSON.stringify({
        ok: true, 未完了だった件数: orders.length, 完了にした件数: done,
        残りがあれば: orders.length >= limit ? 'もう一度このページを開いてください' : 'すべて完了しました'
      }));
    })();
    return;
  }

  // ---- 予約通知の履歴（新しい順に表示） ----
  if (url === '/notifications' && req.method === 'GET') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    try {
      const list = JSON.parse(fs.readFileSync(NOTIFY_PATH, 'utf8'));
      res.end(list.slice().reverse().map(n =>
        '━━━━━━ ' + n.at + ' ━━━━━━\n' + n.date + ' ' + n.time + '〜 / ' + n.plan + ' / ' + n.people + '名'
      ).join('\n\n') + '\n\n※ お客様のお名前・連絡先はここには保存していません。Squareの予約カレンダーをご確認ください。');
    } catch (e) { res.end('まだ予約通知はありません。'); }
    return;
  }

  // ---- データ分析ダッシュボード ----
  if (url === '/dashboard' && req.method === 'GET') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    let rows = [];
    try {
      const csv = fs.readFileSync(LOG_PATH, 'utf8').replace(/^﻿/, '');
      const lines = csv.split('\n').filter(l => l.trim());
      const head = lines.shift().split(',');
      rows = lines.map(line => {
        // 簡易CSVパース（"..." の中のカンマに対応）
        const cells = []; let cur = ''; let q = false;
        for (const ch of line) {
          if (ch === '"') q = !q;
          else if (ch === ',' && !q) { cells.push(cur); cur = ''; }
          else cur += ch;
        }
        cells.push(cur);
        const o = {};
        head.forEach((h, i) => o[h] = (cells[i] || '').trim());
        return o;
      });
    } catch (e) {}
    // キャンセル状態などは期間に関係なく「全部の記録」から判定するため、絞り込む前の一覧を残しておく
    const allRows = rows;
    // ---- 期間の絞り込み（今日／今週／今月／全期間） ----
    const dq = new URLSearchParams(req.url.split('?')[1] || '');
    const dashKey = dq.get('key') || '';
    const period = dq.get('period') || 'all';
    const nowJ = new Date(Date.now() + 9 * 3600000);
    const todayStr = nowJ.toISOString().slice(0, 10);
    const monthStr = nowJ.toISOString().slice(0, 7);
    const dowMon = (nowJ.getUTCDay() + 6) % 7;
    const mondayStr = new Date(nowJ.getTime() - dowMon * 86400000).toISOString().slice(0, 10);
    const yesterdayStr = new Date(nowJ.getTime() - 86400000).toISOString().slice(0, 10);
    const fromStr = (dq.get('from') || '').slice(0, 10);
    const toStr = (dq.get('to') || '').slice(0, 10);
    if (fromStr || toStr) {
      rows = rows.filter(r => {
        const d = (r['記録日時(JST)'] || '').slice(0, 10);
        if (!d) return false;
        if (fromStr && d < fromStr) return false;
        if (toStr && d > toStr) return false;
        return true;
      });
    } else if (period !== 'all') {
      rows = rows.filter(r => {
        const d = (r['記録日時(JST)'] || '').slice(0, 10);
        if (!d) return false;
        if (period === 'day') return d === todayStr;
        if (period === 'yesterday') return d === yesterdayStr;
        if (period === 'week') return d >= mondayStr;
        if (period === 'month') return d.slice(0, 7) === monthStr;
        return true;
      });
    }
    let vFrom = '', vTo = '';
    if (fromStr || toStr) { vFrom = fromStr; vTo = toStr; }
    else if (period === 'day') { vFrom = vTo = todayStr; }
    else if (period === 'yesterday') { vFrom = vTo = yesterdayStr; }
    else if (period === 'week') { vFrom = mondayStr; }
    else if (period === 'month') { vFrom = monthStr + '-01'; }
    res.end(dashboardPage(rows, loadFailures(), period, fromStr, toStr, dashKey, allRows, dq.get('msg') || '', sumVisits(vFrom, vTo)));
    return;
  }

  // ---- 電話予約の手入力（データ画面から） ----
  //   ※ 予約データの画面に記録するためだけのもの。Squareのカレンダーへの登録は別途Squareで行う
  //   ※ 電話予約は当日現地払いのため、「利用日時」を記録日時にする（＝利用した日の売上として数える）
  if (url === '/add-phone' && req.method === 'GET') {
    const q = new URLSearchParams(req.url.split('?')[1] || '');
    const key = q.get('key') || '';
    const back = (m) => { res.statusCode = 302; res.setHeader('Location', '/dashboard?key=' + encodeURIComponent(key) + '&msg=' + m); res.end(); };
    const date = (q.get('date') || '').trim();
    const time = (q.get('time') || '').trim();
    const planName = q.get('plan') === '180分旅館' ? '180分旅館' : '120分';
    const room = q.get('room') === '月読' ? '月読' : '天照';
    const people = parseInt(q.get('people') || '0', 10);
    const amount = parseInt(String(q.get('amount') || '').replace(/[^0-9]/g, ''), 10);
    const pref = (q.get('pref') || '').trim().slice(0, 10);
    const city = (q.get('city') || '').trim().slice(0, 20);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || !(people >= 1 && people <= 10)
        || !(amount >= 0 && amount <= 1000000)) { back('phone_ng'); return; }
    const visitUtc = new Date(date + 'T' + time + ':00+09:00').toISOString();
    const sid = 'tel' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    logEvent([date + ' ' + time + ':00', '③決済完了', planName, room, people, date, time,
              isHolidayJST(visitUtc) ? '土日祝' : '平日', pref, amount, sid, '', '電話', daysAhead(visitUtc), ''],
             { '市区町村': city, '支払い方法': '当日現地払い' });
    back('phone_ok');
    return;
  }

  // ---- 追加売上（レンタル品・ドリンクなど）の月ごとの合計を入力 ----
  //   記録日時はその月の末日にする（「今月」「期間指定」で、その月の売上として数えるため）
  if (url === '/add-extra' && req.method === 'GET') {
    const q = new URLSearchParams(req.url.split('?')[1] || '');
    const key = q.get('key') || '';
    const back = (m) => { res.statusCode = 302; res.setHeader('Location', '/dashboard?period=month&key=' + encodeURIComponent(key) + '&msg=' + m); res.end(); };
    const month = (q.get('month') || '').trim();
    const amount = parseInt(String(q.get('amount') || '').replace(/[^0-9]/g, ''), 10);
    if (!/^\d{4}-\d{2}$/.test(month) || !(amount > 0 && amount <= 10000000)) { back('extra_ng'); return; }
    const [yy, mm] = month.split('-').map(Number);
    const lastDay = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    const sid = 'ex' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    logEvent([month + '-' + String(lastDay).padStart(2, '0') + ' 23:59:00', '⑤追加売上', '追加売上', '', '', month, '', '', '', amount, sid]);
    back('extra_ok');
    return;
  }

  // ---- 追加売上の取り消し（入力ミスの訂正用。確認画面 → 実行） ----
  if (url === '/cancel-extra' && req.method === 'GET') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const q = new URLSearchParams(req.url.split('?')[1] || '');
    const id = q.get('id') || '';
    const key = q.get('key') || '';
    const keyQS = 'key=' + encodeURIComponent(key);
    const all = loadAnalyticsRows();
    const target = all.find(r => r['セッションID'] === id && r['段階'] === '⑤追加売上');
    const already = all.some(r => r['セッションID'] === id && r['段階'] === '⑤追加売上取消');
    if (!target || already) {
      res.end(simpleConfirmPage('見つかりませんでした', '<p>対象の追加売上が見つからないか、すでに取り消されています。</p>', '', '', '/dashboard?' + keyQS));
      return;
    }
    if (q.get('go') !== '1') {
      res.end(simpleConfirmPage('追加売上の取り消し',
        `<p>${escHtml(target['予約日'])}分の追加売上 ¥${Number(target['金額'] || 0).toLocaleString()} を取り消します。よろしいですか？</p>`,
        '/cancel-extra?id=' + encodeURIComponent(id) + '&go=1&' + keyQS, '取り消す', '/dashboard?' + keyQS));
      return;
    }
    logEvent([jstNow(), '⑤追加売上取消', '追加売上', '', '', target['予約日'] || '', '', '', '', target['金額'] || '', id]);
    res.statusCode = 302;
    res.setHeader('Location', '/dashboard?' + keyQS + '&msg=extra_cancel');
    res.end();
    return;
  }

  // ---- キャンセル処理：確認画面 ----
  if (url === '/confirm-cancel' && req.method === 'GET') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const q = new URLSearchParams(req.url.split('?')[1] || '');
    const id = q.get('id') || '';
    const key = q.get('key') || '';
    const keyQS = 'key=' + encodeURIComponent(key);
    const rows = loadAnalyticsRows();
    const target = rows.find(r => r['セッションID'] === id && r['段階'] === '③決済完了');
    if (!target) {
      res.end(simpleConfirmPage('見つかりませんでした', '<p>対象の予約データが見つかりませんでした。すでに処理済みか、IDが間違っている可能性があります。</p>', '', '', '/dashboard?' + keyQS));
      return;
    }
    const body = `<p>以下の予約をキャンセル扱いにします。よろしいですか？</p>
      <p>${escHtml(target['予約日'])} ${escHtml(target['予約時刻'])}〜<br>
      ${escHtml(target['プラン'])} ${escHtml(target['部屋'])} / ${escHtml(target['人数'])}名<br>
      金額：${target['金額'] ? '¥' + Number(target['金額']).toLocaleString() : ''}</p>
      <p style="color:#a33;font-size:13px;">※ この操作は後から「取り消しを戻す」で元に戻せます。</p>`;
    res.end(simpleConfirmPage('キャンセル処理の確認', body,
      '/do-cancel?id=' + encodeURIComponent(id) + '&' + keyQS, 'キャンセルにする',
      '/dashboard?' + keyQS));
    return;
  }

  // ---- キャンセル処理：実行 ----
  if (url === '/do-cancel' && req.method === 'GET') {
    const q = new URLSearchParams(req.url.split('?')[1] || '');
    const id = q.get('id') || '';
    const key = q.get('key') || '';
    const rows = loadAnalyticsRows();
    const target = rows.find(r => r['セッションID'] === id && r['段階'] === '③決済完了');
    if (target) {
      logEvent([jstNow(), '④キャンセル', target['プラン'] || '', target['部屋'] || '', target['人数'] || '',
        target['予約日'] || '', target['予約時刻'] || '', target['曜日区分'] || '',
        target['都道府県'] || '', target['金額'] || '', id,
        target['新規/リピーター'] || '', target['流入元'] || '', target['何日前'] || '', target['端末'] || ''],
        { '市区町村': target['市区町村'] || '', '支払い方法': target['支払い方法'] || '' });
    }
    res.statusCode = 302;
    res.setHeader('Location', '/dashboard?key=' + encodeURIComponent(key));
    res.end();
    return;
  }

  // ---- キャンセル取り消し：確認画面 ----
  if (url === '/confirm-uncancel' && req.method === 'GET') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const q = new URLSearchParams(req.url.split('?')[1] || '');
    const id = q.get('id') || '';
    const key = q.get('key') || '';
    const keyQS = 'key=' + encodeURIComponent(key);
    const rows = loadAnalyticsRows();
    const target = rows.find(r => r['セッションID'] === id && r['段階'] === '③決済完了');
    if (!target) {
      res.end(simpleConfirmPage('見つかりませんでした', '<p>対象の予約データが見つかりませんでした。</p>', '', '', '/dashboard?' + keyQS));
      return;
    }
    const body = `<p>以下の予約の「キャンセル」を取り消し、通常の予約に戻します。よろしいですか？</p>
      <p>${escHtml(target['予約日'])} ${escHtml(target['予約時刻'])}〜<br>
      ${escHtml(target['プラン'])} ${escHtml(target['部屋'])} / ${escHtml(target['人数'])}名</p>`;
    res.end(simpleConfirmPage('キャンセル取り消しの確認', body,
      '/do-uncancel?id=' + encodeURIComponent(id) + '&' + keyQS, '取り消しを戻す',
      '/dashboard?' + keyQS));
    return;
  }

  // ---- キャンセル取り消し：実行 ----
  if (url === '/do-uncancel' && req.method === 'GET') {
    const q = new URLSearchParams(req.url.split('?')[1] || '');
    const id = q.get('id') || '';
    const key = q.get('key') || '';
    const rows = loadAnalyticsRows();
    const target = rows.find(r => r['セッションID'] === id && r['段階'] === '③決済完了');
    if (target) {
      logEvent([jstNow(), '④キャンセル取消', target['プラン'] || '', target['部屋'] || '', target['人数'] || '',
        target['予約日'] || '', target['予約時刻'] || '', target['曜日区分'] || '',
        target['都道府県'] || '', target['金額'] || '', id,
        target['新規/リピーター'] || '', target['流入元'] || '', target['何日前'] || '', target['端末'] || ''],
        { '市区町村': target['市区町村'] || '', '支払い方法': target['支払い方法'] || '' });
    }
    res.statusCode = 302;
    res.setHeader('Location', '/dashboard?key=' + encodeURIComponent(key));
    res.end();
    return;
  }

  // ---- 統計データの表示（ブラウザで中身を確認する用） ----
  if (url === '/analytics' && req.method === 'GET') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    try { res.end(fs.readFileSync(LOG_PATH, 'utf8')); }
    catch (e) { res.end('まだデータがありません。'); }
    return;
  }

  // ---- 統計データのダウンロード（CSV） ----
  if (url === '/analytics.csv' && req.method === 'GET') {
    try {
      const csv = fs.readFileSync(LOG_PATH, 'utf8');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="nogiku_analytics.csv"');
      res.end(csv);
    } catch (e) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('まだデータがありません。');
    }
    return;
  }

  // お名前・電話番号などの個人情報は、URLに乗らない POST で受け取る（サーバーの記録に残さないため）。
  // 古いページ（ブラウザに残っているもの）のために、しばらくは GET も受け付ける。
  if (url === '/book' && (req.method === 'GET' || req.method === 'POST')) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (!isConfigured()) { res.statusCode = 400; res.end(JSON.stringify({ ok: false, message: 'not configured' })); return; }
    const runBook = (q) => {
    const plan = q.get('plan');
      const people = parseInt(q.get('people') || '0', 10);
      const startAt = q.get('start_at');
      const team = q.get('team');
      const name = (q.get('name') || '').trim().slice(0, 60);
      const lastName = (q.get('last_name') || '').trim().slice(0, 30);
      const firstName = (q.get('first_name') || '').trim().slice(0, 30);
      const tel = (q.get('tel') || '').trim().slice(0, 30);
      const email = (q.get('email') || '').trim().slice(0, 100);
      const note = (q.get('note') || '').trim().slice(0, 500);
      const addr = (q.get('addr') || '').trim().slice(0, 120);
      const zip = (q.get('zip') || '').trim().slice(0, 12);
      const termsAgreed = q.get('terms') === '1';
      if (!plan || !people || !startAt || !team || !name || !tel) {
        res.statusCode = 400; res.end(JSON.stringify({ ok: false, message: 'お名前と電話番号は必須です' })); return;
      }
      if (!termsAgreed) {
        res.statusCode = 400; res.end(JSON.stringify({ ok: false, message: 'ご利用規約・キャンセルポリシーへの同意が必要です' })); return;
      }
      const variation = pickVariation(plan, people, startAt);
      if (!variation) { res.statusCode = 400; res.end(JSON.stringify({ ok: false, message: 'プランを認識できませんでした' })); return; }
  
      // 自分の仮押さえ（入力画面で確保したもの）は引き継ぐ。他人のものなら断る
      const myHoldId = q.get('hold');
      const nowMs = Date.now();
      const others = loadPending().some(h => !h.done && h.id !== myHoldId
        && h.start_at === startAt && h.team === team
        && (nowMs - h.created_at) / 60000 < HOLD_MINUTES);
      if (others) {
        res.end(JSON.stringify({ ok: false, message: 'この枠は現在ほかのお客様がお手続き中です。少し時間をおくか、別の時間をお選びください。' }));
        return;
      }
  
      (async () => {
        const locId = await getLocationId();
  
        // Square側でまだ空いているか、念のため直前に確認（前後1時間の幅で照合）
        const t0 = new Date(startAt).getTime();
        // Squareの返事はぶれるため、複数回たずねて一度でも見つかれば「空き」とみなす
        //  （本当に埋まっていれば何回聞いても出てこないので、二重予約にはならない）
        const CHECK_TRIES = 3;
        let avail = { ok: false, data: {} };
        let stillFree = false;
        for (let i = 0; i < CHECK_TRIES && !stillFree; i++) {
          avail = await searchAvailability(
            new Date(t0 - 3600000).toISOString(),
            new Date(t0 + 3600000).toISOString(),
            locId, variation, team ? [team] : []);
          stillFree = (avail.data.availabilities || []).some(a =>
            new Date(a.start_at).getTime() === t0 &&
            (a.appointment_segments || []).some(sg => sg.team_member_id === team));
        }
        // 確認できない場合（APIエラー等）は通す。決済後に作成できなければ /failures に記録される
        if (avail.ok && !stillFree) {
          res.end(JSON.stringify({
            ok: false,
            message: 'この枠はちょうど埋まってしまいました。別の時間をお選びください。',
            debug: {
              asked: startAt, team,
              found: (avail.data.availabilities || []).map(a => ({
                start_at: a.start_at, teams: (a.appointment_segments || []).map(x => x.team_member_id)
              }))
            }
          }));
          return;
        }
  
        // 決済ページを作る（※Squareへの予約登録は、決済が終わってから）
        const jst = new Date(new Date(startAt).getTime() + 9 * 3600000);
        const when = jst.toISOString().slice(0, 16).replace('T', ' ');
        const telDigits = tel.replace(/[^0-9]/g, '');
        const telE164 = telDigits.length >= 10
          ? (telDigits.startsWith('0') ? '+81' + telDigits.slice(1) : '+' + telDigits) : '';
        const prefill = {};
        if (email && /.+@.+\..+/.test(email)) prefill.buyer_email = email;
        if (/^\+\d{10,15}$/.test(telE164)) prefill.buyer_phone_number = telE164;
        // 決済ページの「姓」「名」も先に埋めておく
        // Squareの決済ページは左が「姓」、右が「名」なので、first/last を入れ替えて渡す
        if (lastName || firstName) {
          prefill.buyer_address = { country: 'JP' };
          if (lastName) prefill.buyer_address.first_name = lastName;
          if (firstName) prefill.buyer_address.last_name = firstName;
        }
  
        const linkBody = {
          idempotency_key: 'pl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
          order: {
            location_id: locId,
            line_items: [{
              quantity: '1',
              catalog_object_id: variation,
              // 取引一覧でお客様名がすぐ分かるようにする（返金時に探しやすくするため）
              note: (name ? name + '様 ' : '') + when.slice(5) + ' ' + people + '名'
            }]
          },
          checkout_options: {
            redirect_url: 'https://nogikusauna.com/booking.html?paid=1',
            ask_for_shipping_address: false
          },
          pre_populated_data: Object.keys(prefill).length ? prefill : undefined,
          payment_note: name + '様 ' + MENU[plan].label + ' ' + people + '名 ' + when + '(JST)'
        };
        const pr = await sq('POST', '/v2/online-checkout/payment-links', linkBody);
        let link = pr.data.payment_link || {};
        if (!link.url && Object.keys(prefill).length) {
          delete linkBody.pre_populated_data;
          linkBody.idempotency_key = 'pl2-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
          const retry = await sq('POST', '/v2/online-checkout/payment-links', linkBody);
          link = retry.data.payment_link || {};
        }
        if (!link.url) {
          res.end(JSON.stringify({ ok: false, message: 'お支払いページの作成に失敗しました。時間をおいてお試しください。', errors: pr.data.errors || null }));
          return;
        }
  
        // 仮押さえを「決済待ち」に更新（入力画面で確保した時間から数える）
        const plist = loadPending().filter(h => h.id !== myHoldId);
        const prevHold = loadPending().find(h => h.id === myHoldId);
        const src2 = (prevHold && prevHold.src) || sourceLabel(q.get('ref') || '', q.get('utm'));
        const dev2 = (prevHold && prevHold.dev) || deviceLabel(req.headers['user-agent']);
        const holdId = myHoldId || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
        plist.push({
          id: holdId, created_at: prevHold ? prevHold.created_at : Date.now(),
          order_id: link.order_id, link_id: link.id,
          plan, people, start_at: startAt, team, variation,
          label: MENU[plan].label,
          name, lastName, firstName, tel, telE164, email, addr, zip, note,
          terms_agreed_at: jstNow(),
          src: src2, dev: dev2
        });
        savePending(plist);
  
        // 統計：決済ページへ進んだ
        const pp2 = planParts(plan);
        const jp2 = jstParts(startAt);
        logEvent([jstNow(), '②決済ページへ', pp2.name, pp2.room, people,
                  jp2.date, jp2.time, isHolidayJST(startAt) ? '土日祝' : '平日',
                  prefOnly(addr), '', holdId, '', src2, daysAhead(startAt), dev2], cityOnly(addr));
  
        res.end(JSON.stringify({ ok: true, hold_id: holdId, url: link.url }));
      })();
    };
    if (req.method === 'POST') {
      let raw = '';
      req.on('data', c => { raw += c; if (raw.length > 20000) { req.destroy(); } });
      req.on('end', () => runBook(new URLSearchParams(raw)));
    } else {
      runBook(new URLSearchParams((req.url.split('?')[1] || '')));
    }
    return;
  }

  // ---- 要対応リスト（決済済みなのに予約が作れなかったケース） ----
  if (url === '/failures' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(loadFailures(), null, 2));
    return;
  }

  // ---- 決済完了の即時チェック（決済ページから戻ってきた直後に呼ばれる） ----
  if (url === '/paid-check' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    (async () => { try { await sweepPending(); } catch (e) {} res.end(JSON.stringify({ ok: true })); })();
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
        checkout_options: { redirect_url: 'https://nogikusauna.com/booking.html?paid=1' },
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

server.listen(PORT, process.env.HOST || '127.0.0.1', () => console.log('NOGIKU booking server listening on port ' + PORT));
