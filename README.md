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

## 離れた場所から使う（非公開・おすすめ）: Tailscale

[Tailscale](https://tailscale.com/) は、**自分の端末どうしだけ**を暗号化した通信でつなぐ無料の VPN です。

- アプリはインターネットに一切公開されません。自分の Tailscale アカウントにログインした端末からしか届きません
- 通信は端末どうしで直接暗号化されます（WireGuard）。Tailscale の会社のサーバーも中身は見られません
- データ（メッセージ・ファイル）は自分の PC にだけ保存されます
- 外出先の 4G/5G や別の Wi-Fi からでも使えます（PC の電源が入っている間）

```
iPhone ──(暗号化トンネル)──▶ 自宅 PC の pcfonchat
          ※ 第三者・インターネット上の他人からは見えない
```

### 手順

1. PC と iPhone の両方に Tailscale を入れて、**同じアカウント**でログイン
   - PC: https://tailscale.com/download
   - iPhone: App Store で「Tailscale」
2. PC でアプリを起動（PC 内からだけ接続を受け付ける設定）

   ```bash
   HOST=127.0.0.1 node server.js
   ```

   Windows (PowerShell):

   ```powershell
   $env:HOST="127.0.0.1"; node server.js
   ```

3. 別のターミナルで、Tailscale の中だけに HTTPS で公開

   ```bash
   tailscale serve --bg 3000
   ```

   表示された `https://<PC名>.<tailnet名>.ts.net` を iPhone の Safari で開く（iPhone の Tailscale は ON にしておく）。

   ※ 初回は Tailscale の管理画面で「HTTPS Certificates」と「MagicDNS」の有効化を求められることがあります。表示に従って ON にしてください。

`tailscale serve` は **Tailscale ネットワークの中だけ**の公開です。似た名前の `tailscale funnel` はインターネット全体への公開になるので**使わないでください**。

止めるとき: `tailscale serve --https=443 off`

### さらに安全にするなら

- `PASSWORD` も設定しておく（万一 PC や iPhone を他人に触られたときの保険）
- `KEEP_DAYS=7` などで古いデータを自動削除する
- Tailscale のアカウントは 2 段階認証を ON にする

### 手軽な代替: `tailscale serve` を使わない場合

`node server.js`（HOST 指定なし）で起動し、iPhone から `http://<PC の Tailscale IP（100.x.x.x）>:3000` を開いても使えます。
この場合も通信は Tailscale で暗号化されますが、同じ Wi-Fi の他の人からも PC の 3000 番に届くため、`PASSWORD` の設定をおすすめします。また http なので iPhone で画像のコピーボタンは効きません。

## （参考）インターネットに公開する方法

不特定の人から URL にアクセスできる状態になるため、**情報漏洩を避けたい場合はおすすめしません**。どうしても必要な場合のみ使い、必ず `PASSWORD` を設定してください。

- Cloudflare Tunnel: `cloudflared tunnel --url http://localhost:3000`（自宅 PC を HTTPS で公開）
- Fly.io など: 同梱の `Dockerfile` / `fly.toml` を使ってクラウドに配置（データはクラウドに保存されます）

### セキュリティ対策（実装済み）

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
| `HOST` | `0.0.0.0` | 待ち受けるアドレス。`127.0.0.1` にすると PC 内（と `tailscale serve`）からのみ接続可 |
| `PASSWORD` | なし | ログイン用のパスワード（インターネット公開時は必須）。変更すると全端末がログアウトされます |
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
