# NOGIKU 予約サイト｜進捗メモ（引き継ぎ用）

最終更新: 2026-08-01（その2）

新しいチャットで続ける場合は、まずこれを読めば状況をつかめます。

---

## 全体像
- サイト本体: GitHub `nogiku-sauna/nogiku-sauna`、GitHub Pages 公開（`https://nogikusauna.github.io`）。
- ドメイン: `nogikusauna.com`（取得済み・有効）。ただし **DNS不具合（下記）**。
- 予約サーバー(VPS): Xserver VPS、Ubuntu 26.04、IP `162.43.28.12`、稼働中。

## サーバー（稼働中）
- 操作: VPSパネル→シリアルコンソールで root ログイン（コピペ不可）。
- 反映方法: GitHubにpush → サーバーで `cd ~/app` →（改行）→ `git pull` →（改行）→ `systemctl restart nogiku`。
  ※ コマンドは必ず1行ずつ別々に。続けて打つと `nogikucd` のようにくっついて失敗する。
- アプリ: `/root/app/server.js`（Node標準のみ、ポート3000）。systemd `nogiku`。nginx 80/443→3000。
- スクリプト: `deploy.sh` `tls.sh` `enable-ssh.sh` `nip.sh`。

## ⚠️ DNS（対応中）
- `nogikusauna.com` が lame delegation（ns1-3.xdomain.ne.jp が REFUSED）。**Xserverサポートに問い合わせ済み・返信待ち**。
- 回避策: 仮住所 **`162-43-28-12.nip.io`**（IPに自動変換）を使用中。https取得済み。
  作業・確認は全部 `https://162-43-28-12.nip.io/...` で行う。DNSが直ったら `api.nogikusauna.com` に戻す。

## Square 連携（★ここまで動作確認済み）
- 本番トークン＋Location IDは `/root/app/.env` に保存済み（`/setup`は完了・ロック済み）。
- **重要**: コードは Location ID をSquareから自動取得（`getLocationId()`）するので、.envのLocation値が誤っていても動く。正しい Location ID = **LZJF4DD421H6K**。
- server.js のエンドポイント:
  - `/health` 動作確認（configuredを返す）
  - `/setup` トークン登録（1回・ロック済み）
  - `/inspect` Squareのメニュー/スタッフID一覧【一時用・後で撤去】
  - `/availability?variation=<id>&days=<n>` 空き状況取得【★動作OK・SearchAvailability】
- Square API: 本番 `https://connect.squareup.com`、`Square-Version: 2025-07-16`、fetchに20秒タイムアウト。

## Squareのメニュー構成（/inspect で全ID取得可）
すべて APPOINTMENTS_SERVICE。人数1〜5名の variation あり（夏割は8/31まで）。
- 天照 (土日祝＆特日)120分: item `O3NCUHKOFOWR6RGHX6TFNXFH`
- 天照 (平日)120分: item `6LXRATROAVOD6QXXL34DSUW2`（1名 `YVJRCWQIX4SXB4NEDPCWL6VL` ¥5000 等）
- 月読 (土日祝＆特日)120分: item `C4TSXG7QRZVXYASOYSMGDGZT`
- 月読 (平日)120分: item `X6AYINI6H65GZANXSMSY2FL3`
- 180分旅館【天照】: item `QGLJ7W3QVO3WTTULM3TAD3Q5`（duration 130分）
- 180分旅館【月読】: item `W6KUMXH6YB3BERXYBUEBAXVN`
- team member（＝部屋/資源）: 天照=`TMzc9GebpIkMxUb0`(特)/`TMkUyIWqjJLi62G0`(割引)、月読=`TMh6z9yTDHRfPxmH`(特)/`TMJG-4ajKA9GQkZv`(割引)。
  `TM3buQXp9VXnounF`(木村)は is_bookable:false だが SearchAvailability に出る点に注意。
- 空き時間はUTCで返る → 表示は JST(+9) に変換。平日/土日祝は同じ枠が出る→料金は「日付で variation を振り分け」。

## 予約の方針（利用者の理想）
サイトで ①プラン(天照/月読/180分旅館) ②人数(1〜5) ③日時 を選ぶ → 金額表示 →
「進む」で **Squareの決済ページ（Payment Link）** に飛んで支払い。空き時間は本当の空きだけ表示（SearchAvailability）。
枠の開閉はSquare側で行い、サイトは自動で映す。

## ★ここまで動作確認済み（2026-08-01 その2）
- `/quote?plan=&people=&start_at=` … 平日/土日祝/特日(HOLIDAYS_2026+SPECIAL_DAYS=8/13-15)を自動判定し、
  正しいvariationと価格を返す【テストOK: 8/2(日)天照2名→土日祝¥9,600】
- `/paylink?plan=&people=&start_at=` … CreatePaymentLinkで決済ページ生成【テストOK: square.link発行、
  ページに「サウナのぎく/天照(土日祝＆特日)120分貸切 ¥9,600」表示確認済み】
- plan名: amaterasu120 / tsukuyomi120 / ryokan180_amaterasu / ryokan180_tsukuyomi（MENU定数にID表）

## ★★ booking.html 本連携 完了（2026-08-01 その3・通しテスト成功）
- 正しいサイトURLは **https://nogiku-sauna.github.io/nogiku-sauna/**（ハイフン入り＋リポジトリ名パス）。
- server.js に CORS（origin: https://nogiku-sauna.github.io）と `/slots?plan=&people=&date=`（その日の空き枠）を実装。
- booking.html を全面接続: プラン→人数→日付 → `/slots` で本物の空き表示（JST変換、空なしメッセージ有）
  → 確認モーダル → `/paylink` → Square決済ページへ遷移。
- 通しテスト成功: 8/2(日)2名 → 土日祝¥9,600表示 → 13:00枠 → Squareチェックアウト(¥9,600)到達。
- paylinkのredirect_urlは https://nogiku-sauna.github.io/nogiku-sauna/booking.html?paid=1

## 次にやること
1. `ryokan180_booking.html`（180分旅館ページの予約UI）も同様にAPI接続（booking.htmlは180分旅館も選べるので優先度は要相談）。
2. ⚠️ 運用上の注意: /paylink は決済のみで **Squareの予約台帳(Bookings)には自動登録されない**。
   支払いの payment_note に「プラン/人数/日時(JST)」が入るので、当面は店側がSquare注文を見て手動登録。
   将来は CreateBooking + webhook で自動化。
3. 動作最終確認（少額の本決済テスト等は店側判断）→ 一般公開の案内。
4. `/setup` `/inspect` エンドポイントの撤去（安全のため）。
5. DNS復旧後（Xserverサポート返信待ち）、API_BASE と証明書を `api.nogikusauna.com` に切替。
6. VPS自動更新オフ設定。

## 進め方メモ
- 利用者は非エンジニア。中学生に説明するイメージでやさしく、日本語で。
- コンソールは貼り付け不可。長い秘密情報はブラウザの `/setup` から入れた。
- VPSは1ヶ月お試し。自動更新オフは未設定（時間あるとき）。
