// ==========================================================================
// NOGIKU 予約サーバー (server.js)
// Node.js の標準機能だけで動きます（追加インストール不要）。
// この段階は「土台の動作確認」用のスケルトンです。
// Square 連携は次の段階で追加します。
// ==========================================================================

const http = require('http');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  // 動作確認用エンドポイント
  if (req.url === '/health') {
    res.statusCode = 200;
    res.end(JSON.stringify({
      ok: true,
      service: 'nogiku-booking',
      stage: 'skeleton',
      time: new Date().toISOString()
    }));
    return;
  }

  res.statusCode = 200;
  res.end(JSON.stringify({ message: 'NOGIKU booking server is running.' }));
});

server.listen(PORT, () => {
  console.log('NOGIKU booking server listening on port ' + PORT);
});
