// 予約データ（analytics.csv）から、同じ予約の「③決済完了」が2行以上ある場合に、2行目以降を取り除く。
// 使い方（VPS）： cd ~/app → systemctl stop nogiku → node fix-duplicate.js → systemctl start nogiku
// 実行前の状態は analytics_before_fix.csv に自動で控えを取る。
const fs = require('fs');
const path = require('path');
const LOG = path.join(__dirname, 'analytics.csv');
const raw = fs.readFileSync(LOG, 'utf8');
fs.writeFileSync(path.join(__dirname, 'analytics_before_fix.csv'), raw);
const split = line => {
  const cells = []; let cur = ''; let q = false;
  for (const ch of line) {
    if (ch === '"') { q = !q; cur += ch; }
    else if (ch === ',' && !q) { cells.push(cur); cur = ''; }
    else cur += ch;
  }
  cells.push(cur);
  return cells.map(c => c.replace(/^"|"$/g, '').replace(/""/g, '"'));
};
const lines = raw.split('\n');
const head = split(lines[0].replace(/^﻿/, ''));
const iStage = head.indexOf('段階'), iSid = head.indexOf('セッションID');
const seen = new Set();
let removed = 0;
const out = lines.filter((line, n) => {
  if (n === 0 || !line.trim()) return true;
  const c = split(line);
  if (c[iStage] !== '③決済完了' || !c[iSid]) return true;
  if (seen.has(c[iSid])) { removed++; return false; }
  seen.add(c[iSid]);
  return true;
});
fs.writeFileSync(LOG, out.join('\n'));
console.log('重複していた「③決済完了」を ' + removed + ' 行 取り除きました。');
