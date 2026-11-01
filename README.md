# pcfonchat

PC と iPhone で文字・画像・ファイルをやり取りするための、超軽量チャット。
依存パッケージなし（Node.js だけ）。中身は `server.js` と `public/` の HTML だけです。

## 使い方

1. PC に [Node.js](https://nodejs.org/) (18 以上) を入れる
2. このフォルダで起動

   ```bash
   node server.js
   ```

3. 表示された URL を開く
   - PC: `http://localhost:3000`
   - iPhone（PC と同じ Wi-Fi）: `http://192.168.x.x:3000` ← 起動時に表示されます
   - iPhone では Safari の共有ボタン →「ホーム画面に追加」でアプリっぽく使えます

## できること

- テキスト送信（PC は Enter で送信 / Shift+Enter で改行、iPhone は ↑ ボタン）
- 画像・ファイル送信（📎ボタン、PC では Ctrl+V 貼り付けやドラッグ&ドロップも可）
- 各メッセージの「コピー」「保存」「削除」ボタン
- 2秒ごとに自動更新、他の端末での削除も反映
- URL は自動でリンク化、ダークモード対応

## インターネットに公開する

どこからでも（外出先の 4G/5G からでも）使えるようにする方法です。**必ず `PASSWORD` を設定してください。**
公開すると最初にログイン画面が出ます。一度ログインすれば、その端末では1年間ログインしたままになります。

### 方法A: 自宅の PC をそのまま公開する（無料・おすすめ）

データは自分の PC に残ります。PC の電源が入っている間だけ使えます。
[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) を使うと、ルーターの設定なしで HTTPS の URL がもらえます。

1. `cloudflared` をインストール（Windows: `winget install Cloudflare.cloudflared` / Mac: `brew install cloudflared`）
2. パスワード付きでアプリを起動

   ```bash
   PASSWORD=長くて推測されにくい文字列 node server.js
   ```

3. 別のターミナルで

   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```

4. 表示された `https://xxxx.trycloudflare.com` を iPhone で開く

※ この「お試しトンネル」は起動するたびに URL が変わります。固定の URL にしたい場合は、Cloudflare アカウントと自分のドメインで名前付きトンネルを作成してください。

### 方法B: クラウド（Fly.io）に置く（PC の電源を切っても使える）

`Dockerfile` と `fly.toml` を同梱しています。データは永続ボリューム（`/data`）に保存されます。
費用は少額です（使った分だけ課金。料金は Fly.io の最新情報を確認してください）。

```bash
fly launch --no-deploy --copy-config
```

```bash
fly volumes create pcfonchat_data --size 1 --region nrt
```

```bash
fly secrets set PASSWORD=長くて推測されにくい文字列
```

```bash
fly deploy
```

`https://<アプリ名>.fly.dev` で開けます。`Dockerfile` があるので Railway など、他の Docker 対応サービスでも動きます（`/data` に永続ボリュームをつけ、環境変数 `PASSWORD` を設定してください）。

### 公開時のセキュリティ対策（実装済み）

- パスワードログイン（Cookie は HttpOnly・HTTPS なら Secure）
- 総当たり対策（同じ IP から 15 分に 10 回失敗するとロック）
- `NODE_ENV=production` のときは、パスワード未設定だと起動しない
- 他サイトからの書き込みをブロック（CSRF 対策）
- アップロードされたファイルはスクリプトが実行できない状態で配信
- ファイルの URL は推測できないランダムな名前で、ログインしていないと見られない

## 設定（環境変数）

| 変数 | 既定値 | 説明 |
| --- | --- | --- |
| `PORT` | `3000` | ポート番号 |
| `PASSWORD` | なし | ログイン用のパスワード（公開時は必須）。変更すると全端末がログアウトされます |
| `MAX_UPLOAD_MB` | `200` | 1ファイルの最大サイズ |
| `KEEP_DAYS` | `0` | この日数より古いメッセージ・ファイルを自動削除（0 = しない） |
| `DATA_DIR` | `./data` | 保存先フォルダ |

Windows (PowerShell) で環境変数を付けて起動する場合:

```powershell
$env:PASSWORD="himitsu"; node server.js
```

## メモ

- データは `data/` フォルダ（`messages.json` とアップロードファイル）に保存されます。全部消したいときはこのフォルダを削除。
- 同じ Wi-Fi の iPhone から開けないときは、PC のファイアウォールでポート 3000 の受信を許可してください。
- http 接続のときは、iPhone での画像の「コピー」ボタンが効かないことがあります（HTTPS で公開すれば動きます）。その場合は画像を長押しして保存/コピーしてください。
- iPhone の「ホーム画面に追加」から開いた場合、Safari とは別にもう一度ログインが必要です。
