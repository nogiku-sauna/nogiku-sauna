# NOGIKU 予約サイト｜進捗メモ（引き継ぎ用）

最終更新: 2026-08-01

新しいチャットで続ける場合は、まずこれを読めば状況をつかめます。

---

## 全体像

- **サイト本体**: GitHub リポジトリ `nogiku-sauna/nogiku-sauna`、GitHub Pages 公開（`https://nogikusauna.github.io`）。
- **独自ドメイン**: `nogikusauna.com`（Xserverドメイン取得済み、利用期限 2027/07/31、自動更新）。
- **予約サーバー(VPS)**: Xserver VPS、Ubuntu 26.04、IP `162.43.28.12`、稼働中。

## サーバーの状態（完成・稼働中）

- 操作: VPSパネル →「シリアルコンソール」で root ログイン（rootパスワードは利用者が保持。コンソールはコピペ不可）。
- 変更の反映方法: 「GitHubにpush → サーバーで `cd ~/app && git pull` → `systemctl restart nogiku` またはスクリプト実行」。
- アプリ: `/root/app/server.js`（Node標準機能のみ、ポート3000）。systemdサービス名 `nogiku`。
- nginx: 80/443 → 127.0.0.1:3000。ufw で 22/80/443 許可。
- スクリプト（リポジトリ直下）: `deploy.sh`（常時起動+nginx+ufw）, `tls.sh`（api用https）, `enable-ssh.sh`（SSH許可）, `nip.sh`（仮住所https）。

## Square 連携（★トークン登録まで完了）

- Square開発者アプリ「nogiku-booking」の **本番(Production)アクセストークン** と **Location ID** を、
  サーバーの `/root/app/.env` に保存済み（`/setup` ページから登録。1回限りでロック済み）。
- 確認済み: 店舗名「湯布院プライベートサウナ＆温泉 NOGIKU（サウナのぎく）」/ **Location ID = LZJF4DD421H6K**。
- Squareの予約機能(Bookings)は利用中で、**天照・月読・180分旅館** をサービス(メニュー)として登録済み。
- server.js には `/setup`（トークン登録）と `/health`（`configured:true/false`を返す）がある。

## ⚠️ DNSの問題（対応中）

- `nogikusauna.com` が **lame delegation** 状態。Xserverのネームサーバー(ns1-3.xdomain.ne.jp / 157.112.144.243, 202.226.36.195, 35.75.124.160)が
  ドメインのクエリに **REFUSED** を返し、世界から名前解決できない（DNSレコード自体は正しく登録されている）。
- **Xserverサポートに問い合わせ済み**（返信待ち）。これはXserver側の不具合。
- **回避策を導入済み**: 仮の住所 `162-43-28-12.nip.io`（自動でIPに変換）を使用。
  Let's Encrypt証明書取得済み、`https://162-43-28-12.nip.io/health` と `/setup` は正常動作。
  nginx は `api.nogikusauna.com` と `162-43-28-12.nip.io` の両方を server_name に持つ。
- DNSが直ったら、APIの向き先を `api.nogikusauna.com` に戻す（cert取得し直し）。

## 次にやること（Square予約連携の実装）

1. Squareのカタログ(サービス)を取得して、天照/月読/180分旅館の **service variation ID** と、担当 **team member ID** を確認。
   （server.js に一時的な確認用エンドポイントを足して、ブラウザで一覧を見るのが楽）
2. server.js に予約用エンドポイントを実装（Square REST API を fetch で呼ぶ / 本番 https://connect.squareup.com）:
   - 空き状況 SearchAvailability
   - 予約確定 CreateBooking
   - 決済 Payment Links
   - `https://nogikusauna.github.io` からの呼び出しを許可（CORSヘッダ）。
3. フロント（`booking.html` / `ryokan180_booking.html`）を、APIを呼ぶよう接続。
   当面は `https://162-43-28-12.nip.io/...` を使い、DNSが直ったら `https://api.nogikusauna.com/...` に切替。
4. Square Sandboxでの確認 → 本番。
5. 最後に `/setup` エンドポイントは撤去（安全のため）。
6. （別件）`nogikusauna.com` 本体を GitHub Pages に向けて正式公開。

## 進め方メモ

- 利用者は非エンジニア。中学生に説明するイメージでやさしく、日本語で。
- コンソールは貼り付け不可 → 短いコマンド＋`git pull`＋スクリプトで進める。長い秘密情報はブラウザの `/setup` 経由で入れた。
- VPSは1ヶ月お試し契約。自動更新オフの設定は未確認（時間があるとき対応）。
