# NOGIKU 予約サイト 引き継ぎメモ

最終更新：2026-08-04
担当：吉見紳一（しん）／ NOGIKU サウナ（湯布院）

---

## 0. このメモの読み方（新しいチャットの Claude へ）

このファイルは、チャットが変わっても作業を続けられるようにするための引き継ぎ書です。
まずここを全部読んでから作業を始めてください。
**ユーザーへの説明は「中学生に伝えるイメージ」で、専門用語を避けてください。**

**GitHub の編集は Claude 自身ができます。詳しくは「13. Claude がブラウザを操作する方法」を必ず読むこと。**

---

## 1. 何を作っているか

Square の標準予約ページの代わりになる、**自社の予約サイト**。

やりたいことの本質（ユーザーの言葉）：
> サイトで人数、プラン、時間帯まで選んで金額が出て、そのまま決済に必要な情報を入れるページに飛べる

つまり **選ぶ → 金額が出る → そのまま決済** を1本の流れにする。

---

## 2. 今どこまでできているか

### 動いているもの

| 内容 | 状態 |
|---|---|
| プラン・人数・日時を選ぶ3ステップUI | 完成 |
| Square の空き枠だけを表示（自動反映） | 完成 |
| 平日/土日祝・人数による自動料金計算 | 完成 |
| 10分間の枠おさえ（二重予約防止） | 完成 |
| 決済が終わってから予約確定＝通知が飛ぶ | 完成 |
| リピーター様の顧客情報ひも付け（電話番号で照合） | 完成 |
| お客様情報の端末保存（チェックボックスで本人が選べる） | 完成 |
| 2画面の確認フロー（①確認だけ ②入力フォーム） | 完成 |
| 公開前チェックリスト（32項目） | 完成・未実行 |
| データ分析ダッシュボード | 完成・動作確認済み |

### まだのもの

- **週次レポート**（毎週月曜の朝にメールでダッシュボードの内容を送る）
- **公開前チェックリストの実行**（社員さんと一緒にやる。ユーザーが一人のため保留中）
- **テスト用の入口を閉じる作業**（公開前に必須。下の「7. 公開前にやること」参照）
- **DNS の切り替え**（エックスサーバーのサポート返答待ち）
- **VPS 自動更新オフ**の設定

---

## 3. URL 一覧

| 何 | URL |
|---|---|
| 予約ページ（120分） | https://nogiku-sauna.github.io/nogiku-sauna/booking.html |
| 予約ページ（180分旅館） | https://nogiku-sauna.github.io/nogiku-sauna/ryokan180_booking.html |
| 公開前チェックリスト | https://nogiku-sauna.github.io/nogiku-sauna/checklist.html |
| データ分析ダッシュボード | https://162-43-28-12.nip.io/dashboard |
| CSVダウンロード | https://162-43-28-12.nip.io/analytics.csv |
| GitHub | https://github.com/nogiku-sauna/nogiku-sauna |

---

## 4. サーバーの構成

- **Xserver VPS**（IP: 162.43.28.12）
- OS: Ubuntu / サービス名 `nogiku`（systemd）
- アプリ本体: `/root/app/server.js`（Node.js 標準ライブラリのみ。npm パッケージ不使用）
- nginx がリバースプロキシ（80/443 → 127.0.0.1:3000）
- HTTPS: certbot / Let's Encrypt
- ドメインは **nip.io** を仮利用中：`162-43-28-12.nip.io`
  - 本来使いたい `nogikusauna.com` は **DNS の設定不備（lame delegation）** で使えない
  - `ns1-3.xdomain.ne.jp` が REFUSED を返す状態。エックスサーバーに問い合わせ済み・返答待ち

### データの保存場所（サーバー内）

| ファイル | 中身 |
|---|---|
| `pending.json` | 枠おさえの状態 |
| `analytics.csv` | 行動ログ（個人情報なし・都道府県のみ） |
| `.env` | Square のトークン等（**絶対にチャットに貼らない**） |

---

## 5. 作業の進め方（重要）

### サイト（HTML）を直すとき
1. Claude がファイルを作る
2. **Claude が GitHub のウェブ画面から直接コミット**（手順は 13 参照）
3. GitHub Pages に自動反映

### サーバー（server.js）を直すとき
1. Claude がファイルを作る
2. Claude が GitHub にコミット
3. **ユーザーがシリアルコンソールで下記を1行ずつ実行**

```
cd ~/app
```
```
git pull
```
```
systemctl restart nogiku
```

> **注意：コマンドは必ず1行ずつ渡すこと。**
> まとめて書くとシリアルコンソールで連結されて失敗します。

---

## 6. 絶対に守ること（安全のルール）

1. **Square のアクセストークンをチャットに貼らせない。**
   必ずブラウザの `/setup` ページからユーザー本人が入力する。
2. **カード情報は自社サイトを通らない。** Square が全部処理する。
3. **個人情報（氏名・電話・メール）は分析ログに書かない。** 都道府県のみ記録。
4. **端末保存のデータはお客様の端末の中だけ。** サーバーには送らない。

---

## 7. 公開前にやること（未着手）

チェックリストの項目30〜32に相当。

- [ ] テスト用の入口を閉じる：`/setup` `/inspect` `/cancel-booking` `/complete-orders`
- [ ] サーバーが落ちたとき自動で再起動するか確認
- [ ] 「決済は通ったのに予約が入らなかった」場合の検知を強化
- [ ] 2台のスマホで同時予約テスト（枠おさえがちゃんと効くか）
- [ ] 32項目チェックリストを社員さんと実行

---

## 8. 未解決の問題

### ① カレンダーからの返金ができない
- Square アプリの **カレンダー → 予約をクリック → 顧客情報 → 払い戻し** でエラー
  - エラー文言：「このお取引は払い戻しの対象ではなくなりました」
  - このとき表示金額が **4,500円**（実際は5,000円）
- **お取引（Transactions）の項目からなら普通に払い戻せる**（表示は5,000円）
- 原因未特定。**Claude は過去に「残高不足では」と2回誤った推測をしてユーザーに訂正されている。推測で答えないこと。**
- 現在の運用：**お取引から返金 → カレンダーの予約は手動でキャンセル**
- 困りごと：お取引の一覧には**名前が出ない**ので、対象のお客様を探すのが手間

### ② DNS（nogikusauna.com が使えない）
- エックスサーバーのサポート返答待ち
- 直ったら `api.nogikusauna.com` に切り替える

---

## 9. 過去に起きた不具合と直し方（同じ失敗を繰り返さないため）

| 症状 | 原因 | 対処 |
|---|---|---|
| 存在しない時間帯（15:00/17:00/19:00）が表示 | 木村達行さんの個人カレンダー（`is_bookable:false`）が枠を生成 | `getBookableTeam()` で予約可能スタッフのみに絞る |
| `accepted_payment_status` エラー | フィールド名が違う | `status: 'PENDING'` が正しい |
| Location ID が違う | `.env` にアプリIDが入っていた | `getLocationId()` で自動取得 |
| 電話番号が弾かれる | E.164 形式が必要 | `+81` 変換を追加 |
| 決済画面で名前が出ない／氏名が重複表示 | `given_name` に氏名をまとめて入れていた | `family_name`/`given_name` に分割 |
| 決済画面で姓名が逆 | Square の左欄は `first_name` | 姓→`first_name` に入れ替え |
| 決済直後に「ご注文が完了しませんでした」 | `completeOrder()` を20秒後に実行していて Square の処理中だった | **10分後に遅延実行**に変更 |
| 枠おさえが効いていない | 決済ページに飛んだ時点でしか押さえていなかった | `/hold` `/release` を追加し、**入力フォームを開いた瞬間**に押さえる |
| `/complete-orders` が504 | 一度に処理しすぎ | 5件ずつに変更 |

---

## 10. server.js の主要な部分

### メニュー定義
`MENU` に プラン × 人数 × 平日/土日祝 → Square の variation ID を対応表として持つ。
プランは4つ：`amaterasu120` / `tsukuyomi120` / `ryokan180_amaterasu` / `ryokan180_tsukuyomi`
（180分旅館は土日祝の設定なし＝`holiday: null`）

`HOLIDAYS_2026` に祝日、`SPECIAL_DAYS` にお盆（8/13〜15）を登録。

### 枠おさえの仕組み
```js
const HOLD_MINUTES = 10;
activeHolds()        // 生きている押さえだけ取り出す
isHeld(startAt,team) // その枠が押さえられているか
sweepPending()       // 20秒ごとに実行：決済済み→予約作成／期限切れ→解放
```

### 主なエンドポイント
`/health` `/setup` `/inspect` `/slots` `/hold` `/release` `/book` `/quote`
`/paylink` `/paid-check` `/cancel-booking` `/complete-orders` `/failures`
`/notifications` `/analytics` `/analytics.csv` `/dashboard`

### 分析ログの列
```
記録日時(JST),段階,プラン,部屋,人数,予約日,予約時刻,曜日区分,都道府県,金額,
セッションID,新規/リピーター,流入元,何日前,端末
```
段階は `①時間を選択` `②決済ページへ` `③決済完了` `×入力画面で中断` `×時間切れ`

---

## 11. 使っている Square の API

- Bookings / Catalog / Customers / Orders / Payment Links（Online Checkout）
- `Square-Version: 2025-07-16`
- ベースURL: `https://connect.squareup.com`
- Location ID: `LZJF4DD421H6K`

---

## 12. 次にやること（おすすめ順）

1. **公開前の安全対策**（テスト用の入口を閉じる）← Claude が作業
2. **チェックリストの実行**（社員さんと一緒に）
3. **週次レポート**（毎週月曜の朝にメール）

---

## 13. Claude がブラウザを操作する方法（重要・引き継ぎ）

**GitHub の編集・コミットは Claude 自身ができます。ユーザーに手作業をお願いしないこと。**

- 使うのは **Chrome のブラウザ操作ツール（claude-in-chrome）**。API キーやトークンは不要。
- ツールが読み込まれていない場合は **ToolSearch** で読み込む：
  `select:mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__tabs_context_mcp`
- ユーザーの Chrome は **GitHub にログイン済み**。そのまま編集できる。

### ファイルを丸ごと書き換える手順（実績あり）

1. `https://github.com/nogiku-sauna/nogiku-sauna/edit/main/ファイル名` を開く
2. エディタ内をクリック → **ctrl+a**（実キー）で全選択
3. **javascript_tool で paste イベントを送り込む**（GitHub は CodeMirror。type では遅すぎる）

```js
const text = ["1行目","2行目"].join("\n");
const cm = document.querySelector('.cm-content');
cm.focus();
const dt = new DataTransfer();
dt.setData('text/plain', text);
cm.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true}));
```

4. 右上の **Commit changes...** をクリック
5. コミットメッセージを入力 → **Commit changes**
6. `blob` ページを開いて反映を確認する

> **コツ**
> - `.cm-content` に直接 paste イベントを送る。`textarea` は存在しない。
> - **必ず全文を貼り直すこと。** `ctrl+End` でカーソルを末尾に送っても効かず、
->   追記のつもりが先頭に入ってしまう事故が起きた。

### Claude にできないこと

- **サーバーのコマンド実行**（シリアルコンソール）はユーザーにお願いする。
  Claude の bash はサンドボックスなので VPS には届かない。
  必ず **1行ずつ** 渡すこと。
