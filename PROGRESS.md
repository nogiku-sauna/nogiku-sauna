# NOGIKU 予約サイト｜進捗メモ（引き継ぎ用）

最終更新: 2026-07-31

このメモは「今どこまで進んだか」と「次にやること」の記録です。
新しいチャットで続ける場合は、まずこれを読めば状況をつかめます。

---

## 全体像

- **サイト本体**: この GitHub リポジトリ `nogiku-sauna/nogiku-sauna`。
  GitHub Pages で公開中（`https://nogikusauna.github.io`）。
- **独自ドメイン**: `nogikusauna.com`（Xserverドメインで取得済み、Xserverネームサーバー使用）。
  ※ まだサイト本体（apex）には向けていない。予約API用に `api` サブドメインだけ設定済み。
- **予約サーバー(VPS)**: Xserver VPS、Ubuntu 26.04、IP `162.43.28.12`。
  1ヶ月契約・自動更新オフ予定（お試し中）。支払いはプリペイド(コンビニ)。

## サーバーの状態（完成済み）

- 操作方法: XserverのVPSパネル →「シリアルコンソール」で root ログイン。
  **コンソールはコピー＆ペースト不可** → 変更は「GitHubにpush → サーバーで `cd ~/app && git pull` → スクリプト実行」で行う。
- アプリ本体: `/root/app`（このリポジトリを clone したもの）。`server.js`（Nodeの標準機能のみ、ポート3000）。
- 常時起動: systemd サービス名 `nogiku`（`systemctl status/restart nogiku`）。
- リバースプロキシ: nginx が 80/443 → 127.0.0.1:3000 に橋渡し。
- ファイアウォール: ufw で 22/80/443 許可。Xserver パケットフィルターで「Web(80/443)」許可済み。
- ドメイン: `api.nogikusauna.com` → `162.43.28.12`（Aレコード）。
- HTTPS: Let's Encrypt 証明書取得済み（certbot、自動更新設定済み、期限 2026-10-29）。
- **動作確認OK**: `https://api.nogikusauna.com/health` が JSON を返す。

### 使ったスクリプト（リポジトリ直下）
- `server.js` … 予約サーバー本体（現在は動作確認用スケルトン）
- `deploy.sh` … systemd + nginx + ufw の設定
- `tls.sh` … certbot で HTTPS 設定

## Square（未着手・次の本命）

- Square 開発者アプリ「nogiku-booking」作成済み。
- **本番(Production)のアクセストークン** と **Location ID** は、ユーザーのGoogleパスワードマネージャーに保管済み。
- 重要: **アクセストークンはチャットに貼らない**。サーバー上の秘密ファイル（例 `/root/app/.env`、gitには含めない）に、ユーザーが直接入力する。

## 次にやること（Square連携）

1. Square トークンをサーバーに安全に置く（`.env` などに、ユーザーが直接入力）。
2. `server.js` に予約用エンドポイントを実装（Square REST API を fetch で呼ぶ）:
   - 空き状況（SearchAvailability）
   - 予約確定（CreateBooking）
   - 決済ページ（Payment Links）
   - `https://nogikusauna.github.io` からの呼び出しを許可（CORS）。
3. フロント（`booking.html` / `ryokan180_booking.html`）を、`https://api.nogikusauna.com/...` を呼ぶように接続。
4. まず Square の Sandbox（テスト）で動作確認 → OKなら本番へ。
5. （最後に）`nogikusauna.com` 本体を GitHub Pages に向けて、正式アドレスで公開。

## 事前に確認したいこと（Square）

- Square で「予約(Appointments/Bookings)」を使っているか、サービス（120分/180分など）が
  カタログに登録されているか。→ 予約APIの作り方が変わるため。

## 進め方メモ

- ユーザーは非エンジニア。**中学生に説明するイメージ**でやさしく、日本語で。
- コンソールは貼り付け不可 → 短いコマンド＋`git pull`＋スクリプトで進める。
