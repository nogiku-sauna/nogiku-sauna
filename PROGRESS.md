# NOGIKU 予約サイト｜進捗メモ（引き継ぎ用）

最終更新: 2026-08-01（その4）

新しいチャットで続ける場合は、まずこれを読めば状況をつかめます。

---

## 全体像
- サイト: GitHub `nogiku-sauna/nogiku-sauna` → **https://nogiku-sauna.github.io/nogiku-sauna/**
- ドメイン: `nogikusauna.com`（取得済み・有効）だが **DNS不具合**（下記）。
- 予約サーバー: Xserver VPS、Ubuntu 26.04、IP `162.43.28.12`、稼働中。

## サーバー操作
- VPSパネル →「シリアルコンソール」で root ログイン（**コピペ不可**）。
- 反映手順（**必ず1行ずつ別々に**。続けて打つと `nogikucd` のようにくっついて失敗）:
  `cd ~/app` → `git pull` → `systemctl restart nogiku`
- アプリ `/root/app/server.js`（Node標準のみ・ポート3000）、systemd `nogiku`、nginx 80/443→3000、ufw 22/80/443。
- スクリプト: `deploy.sh` `tls.sh` `enable-ssh.sh` `nip.sh`。※SSHはこのPCにsshが無く未使用。

## ⚠️ DNS（未解決・Xserverサポート返信待ち）
- `nogikusauna.com` が lame delegation（ns1-3.xdomain.ne.jp が REFUSED）。世界から名前解決できない。
- **回避策**: 仮住所 **`https://162-43-28-12.nip.io`** を使用中（Let's Encrypt取得済み）。
  フロントの `API_BASE` もこれ。DNS復旧後に `api.nogikusauna.com` へ切替＋証明書取り直し。

## ★ 予約システム 完成（本番動作確認済み）
**流れ**: プラン→人数→日付 → 本当の空き枠表示 → 時間選択 → 名前/電話/メール/住所/メモ入力
→「はい、進む」で **Square予約を自動登録（10分仮押さえ）** → Square決済ページ（電話・メールはプリフィル済、カード番号のみ入力／Google Pay可）。

### server.js のエンドポイント
- `/health` 動作確認
- `/setup` トークン登録（**完了・ロック済み**／最後に撤去する）
- `/inspect` Squareのメニュー・スタッフID一覧（**一時用・撤去する**）
- `/slots?plan=&people=&date=` その日の空き枠（**is_bookable な"部屋"のみ**採用）
- `/quote?plan=&people=&start_at=` 料金確認
- `/paylink?...` 決済リンクのみ作成（旧・現在フロントは未使用）
- `/book?plan=&people=&start_at=&team=&name=&tel=&email=&addr=&note=` ★本番用：顧客登録→予約作成→決済リンク
- `/cancel-booking?id=` 予約キャンセル（**一時用・撤去する**）

### 10分ルール（自動管理）
- `pending.json` に監視登録。`sweepPending()` が **1分ごと**に確認（`HOLD_MINUTES = 10`）。
- 支払い確認 → 予約の seller_note に **【決済確認済み】** を追記。
- 10分未払い → **予約を自動キャンセル**（枠復活）＋決済リンク削除。

### 重要な実装メモ
- Location IDは `getLocationId()` でSquareから自動取得（.envの値が誤っていても動く）。正: `LZJF4DD421H6K`
- **木村達行(`TM3buQXp9VXnounF`, is_bookable:false)の枠は除外必須**。含めると 15:00/17:00 等の実在しない枠が出る。
  → `getBookableTeam()` で is_bookable のみ採用。部屋: 天照=`TMzc9GebpIkMxUb0`/`TMkUyIWqjJLi62G0`、月読=`TMh6z9yTDHRfPxmH`/`TMJG-4ajKA9GQkZv`
- 電話番号は **+81形式に変換**して渡す（日本式のままだとエラー）。
- メールは形式チェック（`test@example.com` 等の架空アドレスはSquareが拒否）。失敗時はプリフィル無しで自動リトライ。
- Square API: `https://connect.squareup.com`、`Square-Version: 2025-07-16`、fetch 20秒タイムアウト。
- 空き時間はUTCで返るのでJST(+9)変換して表示。平日/土日祝・特日(8/13-15)で variation を自動振り分け（MENU定数）。

### フロント（両方とも接続完了）
- `booking.html` … 120分/180分旅館の両方
- `ryokan180_booking.html` … 180分旅館ページ用（120分貸切のみも選択可）
- CORS許可 origin: `https://nogiku-sauna.github.io`
- 決済後のredirect: `https://nogiku-sauna.github.io/nogiku-sauna/booking.html?paid=1`

## 法務・セキュリティ（確認済み）
- カード情報はサイトを通らずSquare側のみ。全通信https。
- 予約フォームに利用目的とプライバシーポリシー(`privacy.html`)リンクを明示済み。
- 住所欄は任意扱い、注記は「※ 市区町村まででOK」のみ（利用目的の説明はプライバシーポリシーに集約）。

## 残タスク
1. **`/setup` `/inspect` `/cancel-booking` の撤去**（安全のため。本番公開前に必須）
2. DNS復旧後: `API_BASE` と証明書を `api.nogikusauna.com` へ切替
3. VPSの**自動更新オフ**設定（1ヶ月お試し契約のため）
4. 任意: カレンダーで一目で分かるよう、決済済みを顧客名の頭に「済」を付ける等の改善
5. `nogikusauna.com` 本体をGitHub Pagesに向けて正式公開

## 進め方メモ
- 利用者は非エンジニア。**中学生に説明するイメージ**でやさしく日本語で。
- 変更は必ず GitHub にpush → サーバーで git pull → restart。
- テスト予約を入れたら **必ず `/cancel-booking` で削除**すること。
