# NOGIKU 予約サイト｜進捗メモ（引き継ぎ用）

最終更新: 2026-08-02

新しいチャットで続ける場合は、まずこれを読めば状況をつかめます。

---

## 全体像
- サイト: GitHub `nogiku-sauna/nogiku-sauna` → **https://nogiku-sauna.github.io/nogiku-sauna/**
- ドメイン: `nogikusauna.com`（取得済み）だが **DNS不具合**（下記）
- 予約サーバー: Xserver VPS、Ubuntu 26.04、IP `162.43.28.12`、稼働中

## サーバー操作
- VPSパネル →「シリアルコンソール」で root ログイン（**コピペ不可**）
- 反映手順（**必ず1行ずつ別々に**。続けて打つと `nogikucd` のようにくっついて失敗）:
  `cd ~/app` → `git pull` → `systemctl restart nogiku`
- アプリ `/root/app/server.js`（Node標準のみ・ポート3000）、systemd `nogiku`、nginx 80/443→3000

## ⚠️ DNS（未解決・Xserverサポート返信待ち）
- `nogikusauna.com` が lame delegation（ns1-3.xdomain.ne.jp が REFUSED）
- **回避策**: 仮住所 `https://162-43-28-12.nip.io` を使用中（フロントの `API_BASE` もこれ）

## ★★ 予約フロー（D案・2026-08-02 完成・動作確認済み）
**重要な設計**: 「お支払いへ進む」時点では **Squareに何も登録しない**。
サーバー内で10分間だけ枠を確保 → **決済完了後にSquareへ予約登録** → そこで初めて確認メール/SMSが届く。

### なぜこの形か（経緯）
- 当初は先に予約を作っていたが、**決済前にSquareの確定メール/SMSが飛んでしまう**問題が発生。
- `status: 'PENDING'` を試したがSquare側が自動でACCEPTEDにするためNG（設定変更は既存Square予約ページにも影響するため却下）。
- Squareの「個人の予定ブロック」はAPIから作成不可。
- → サーバー内で仮押さえを持つD案を採用。

### 仕組み
- `pending.json` に仮押さえを保存（`HOLD_MINUTES = 10`）
- `activeHolds()` / `isHeld(startAt, team)` … 有効な仮押さえの判定
- `/slots` は **仮押さえ中の枠を除外**して返す（他の人には見えない）
- `sweepPending()` が **20秒ごと**に決済状況を確認 → 決済済みなら `createBookingFromHold()` で本予約作成
- 10分未払い → 仮押さえ解除＋決済リンク削除（Squareには何も残らない）
- 決済済みなのに予約作成に失敗した場合 → `failures.json` に記録、`/failures` で確認可能（要返金対応）
- 二重予約防止: `idempotency_key: 'bk-' + hold.id`

### エンドポイント
- `/health` 動作確認
- `/setup` トークン登録（**完了・ロック済み**／公開前に撤去）
- `/inspect` Squareのメニュー・スタッフID一覧（**一時用・撤去する**）
- `/slots?plan=&people=&date=` 空き枠（is_bookableな"部屋"のみ＋仮押さえ除外）
- `/book?plan=&people=&start_at=&team=&name=&tel=&email=&addr=&zip=&note=` ★仮押さえ＋決済リンク作成
- `/paid-check` 決済完了の即時チェック（決済後の戻り時に呼ばれる）
- `/failures` 要対応リスト
- `/cancel-booking?id=` 予約キャンセル（**一時用・撤去する**）
- `/quote` `/paylink` は旧・未使用

### 重要な実装メモ
- Location IDは `getLocationId()` で自動取得。正: `LZJF4DD421H6K`
- **木村達行(`TM3buQXp9VXnounF`, is_bookable:false)の枠は除外必須**（含めると実在しない15:00/17:00等が出る）
  → `getBookableTeam()` で is_bookable のみ採用。部屋: 天照=`TMzc9GebpIkMxUb0`/`TMkUyIWqjJLi62G0`、月読=`TMh6z9yTDHRfPxmH`/`TMJG-4ajKA9GQkZv`
- 電話番号は **+81形式に変換**して渡す。メールは形式チェック（架空アドレスはSquareが拒否）
- 空き確認の照合は `new Date().getTime()` で比較（文字列一致だと失敗する）
- **リピーター対応**: 電話番号(+81形式)で既存顧客を検索 → いれば紐づけ＋情報更新、いなければ新規作成
- 空き時間はUTC → JST(+9)変換。平日/土日祝・特日(8/13-15)で variation 自動振り分け（MENU定数）

## フロント
- `booking.html` … 3ステップ（①プラン ②人数 ③日にち）＋順番チェック（赤枠＋メッセージ、5秒で消える）
  - 確認モーダルは **2画面構成**: 1画面目=内容確認のみ / 2画面目=Square形式の入力
  - 入力項目（Square準拠・必須マークなし）: 電話番号(🇯🇵+81) / 姓・名 / メール / 住所(郵便番号・都道府県select・市区町村・住所1・住所2) / ご要望
  - 決済後に `?paid=1` で戻ると「ご予約ありがとうございます」表示＋`/paid-check` 実行
- `ryokan180_booking.html` … API接続済みだが **確認モーダルは旧1画面形式のまま**（booking.htmlと同じ2画面＋Square形式に揃える作業が残っている）
- CORS許可: `https://nogiku-sauna.github.io`

## 残タスク
1. `ryokan180_booking.html` の確認モーダルを booking.html と同じ2画面・Square形式に統一
2. **`/setup` `/inspect` `/cancel-booking` の撤去**（公開前に必須）
3. DNS復旧後: `API_BASE` と証明書を `api.nogikusauna.com` へ切替
4. VPSの**自動更新オフ**設定（1ヶ月お試し契約）
5. 公開後、**旧Square予約ページを非公開に**（Instagram等のリンクも差し替え）
   → これによりサイト経由の予約が一本化され、オーバーブッキングの心配がなくなる

## 進め方メモ
- 利用者は非エンジニア。**中学生に説明するイメージ**でやさしく日本語で。
- 変更は GitHub にpush → サーバーで git pull → restart。
- テスト予約後は `/cancel-booking` で削除（※D案では決済しない限りSquareに何も入らないので通常は不要）
