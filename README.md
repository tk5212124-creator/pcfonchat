# pcfonchat

PC と iPhone で文字・画像・ファイルをやり取りするための、超軽量チャット。
依存パッケージなし（Node.js だけ）。中身は `server.js` と `public/index.html` の2ファイルだけです。

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

## 設定（環境変数）

| 変数 | 既定値 | 説明 |
| --- | --- | --- |
| `PORT` | `3000` | ポート番号 |
| `PASSWORD` | なし | 設定するとパスワード付きに（ユーザー名は何でもOK） |
| `MAX_UPLOAD_MB` | `200` | 1ファイルの最大サイズ |

```bash
PASSWORD=himitsu node server.js
```

Windows (PowerShell) の場合:

```powershell
$env:PASSWORD="himitsu"; node server.js
```

## メモ

- データは `data/` フォルダ（`messages.json` とアップロードファイル）に保存されます。全部消したいときはこのフォルダを削除。
- iPhone から開けないときは、PC のファイアウォールでポート 3000 の受信を許可してください。
- http 接続のため、iPhone での画像の「コピー」ボタンは効かない場合があります。画像を長押しして保存/コピーしてください（テキストのコピーは動きます）。
- LAN 内での利用を想定しています。インターネットに公開する場合は必ず `PASSWORD` を設定し、HTTPS の背後に置いてください。
