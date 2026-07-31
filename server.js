// ==========================================================================
// NOGIKU 予約サーバー (server.js)
// Node.js 標準機能のみ（追加インストール不要 / fetch は Node18+ 内蔵）
//
// この段階でできること:
//   - /health         動作確認
//   - /setup          Squareのトークン等をブラウザから安全に登録（1回だけ）
//   - トークンは /root/app/.env に保存（GitHubには上げない）
// ==========================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ENV_PATH = path.join(__dirname, '.env');

// ---- .env から設定を読み込む ----
function loadConfig() {
  const cfg = {};
  try {
    const txt = fs.readFileSync(ENV_PATH, 'utf8');
    txt.split(/\r?\n/).forEach(line => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) cfg[m[1]] = m[2];
    });
  } catch (e) { /* まだ無ければ空 */ }
  return cfg;
}
let config = loadConfig();

function isConfigured() {
  return !!(config.SQUARE_ACCESS_TOKEN && config.SQUARE_LOCATION_ID);
}

function saveConfig(token, locationId) {
  const content =
    'SQUARE_ACCESS_TOKEN=' + token + '\n' +
    'SQUARE_LOCATION_ID=' + locationId + '\n';
  fs.writeFileSync(ENV_PATH, content, { mode: 0o600 });
  config = loadConfig();
}

// ---- Square API（本番）でトークンの動作確認 ----
async function squareListLocations(token) {
  try {
    const res = await fetch('https://connect.squareup.com/v2/locations', {
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      }
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { error: String(e) } };
  }
}

// ---- 設定ページのHTML ----
function setupPage(message, messageColor) {
  const msg = message
    ? `<div class="msg" style="color:${messageColor || '#2b2620'}">${message}</div>`
    : '';
  const locked = isConfigured();
  const form = locked ? '' : `
    <form method="POST" action="/setup">
      <label>Square アクセストークン（本番）</label>
      <input type="password" name="token" placeholder="EAAA... で始まる長い文字列" autocomplete="off" required>
      <label>Square Location ID</label>
      <input type="text" name="location" placeholder="LZJF... のような文字列" autocomplete="off" required>
      <button type="submit">保存してSquareにつなぐ</button>
    </form>`;
  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>NOGIKU セットアップ</title>
<style>
  body{font-family:sans-serif;background:#efe8d4;color:#2b2620;margin:0;padding:24px;}
  .card{max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:28px;box-shadow:0 6px 24px rgba(0,0,0,.08);}
  h1{font-size:18px;margin:0 0 6px;}
  p{font-size:13px;line-height:1.8;color:#5a5248;}
  label{display:block;font-size:13px;font-weight:700;margin:16px 0 6px;}
  input{width:100%;box-sizing:border-box;padding:12px;border:1px solid #d8cfb8;border-radius:8px;font-size:14px;}
  button{margin-top:20px;width:100%;padding:14px;border:none;border-radius:8px;background:#2b2620;color:#fff;font-size:15px;font-weight:700;cursor:pointer;}
  .msg{font-size:14px;font-weight:700;margin:12px 0;line-height:1.7;}
  .note{font-size:12px;color:#9a8f7a;margin-top:18px;}
</style></head>
<body><div class="card">
  <h1>NOGIKU 予約システム｜Square設定</h1>
  <p>パスワードマネージャーからコピーして、下の欄に貼り付けてください。ここで入れた情報はサーバーの中だけに保管され、外からは見えません。</p>
  ${msg}
  ${form}
  <div class="note">※ この画面のURLは他の人に教えないでください。設定は安全のため1回だけ有効です。</div>
</div></body></html>`;
}

// ---- サーバー本体 ----
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  // 動作確認
  if (url === '/health') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({
      ok: true, service: 'nogiku-booking',
      configured: isConfigured(), time: new Date().toISOString()
    }));
    return;
  }

  // 設定ページ（表示）
  if (url === '/setup' && req.method === 'GET') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (isConfigured()) {
      res.end(setupPage('✅ すでに設定済みです（安全のため、上書きはできません）。', '#1a7f3c'));
    } else {
      res.end(setupPage('', ''));
    }
    return;
  }

  // 設定ページ（保存）
  if (url === '/setup' && req.method === 'POST') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (isConfigured()) {
      res.statusCode = 403;
      res.end(setupPage('❌ すでに設定済みのため、変更できません。', '#b00'));
      return;
    }
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', async () => {
      const params = new URLSearchParams(body);
      const token = (params.get('token') || '').trim();
      const location = (params.get('location') || '').trim();
      if (!token || !location) {
        res.end(setupPage('⚠️ トークンとLocation IDの両方を入れてください。', '#b00'));
        return;
      }
      const r = await squareListLocations(token);
      if (!r.ok) {
        res.end(setupPage('❌ Squareに接続できませんでした（トークンが違うかもしれません）。もう一度お試しください。（エラー: ' + r.status + '）', '#b00'));
        return;
      }
      saveConfig(token, location);
      const locs = (r.data.locations || [])
        .map(l => '・' + (l.name || '(名称なし)') + ' … ' + l.id).join('<br>');
      res.end(setupPage('✅ 成功！ Squareとつながり、保存できました。<br><br>登録されている店舗：<br>' + locs, '#1a7f3c'));
    });
    return;
  }

  // その他
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ message: 'NOGIKU booking server is running.' }));
});

server.listen(PORT, () => {
  console.log('NOGIKU booking server listening on port ' + PORT);
});
