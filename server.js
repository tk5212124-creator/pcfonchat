// pcfonchat - PC と iPhone で文字・ファイルをやり取りする最小チャット
// 依存パッケージなし。Node.js 18+ で `node server.js` するだけ。
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PORT = Number(process.env.PORT) || 3000;
const PASSWORD = process.env.PASSWORD || ''; // 設定するとBasic認証が有効になる
const MAX_UPLOAD = (Number(process.env.MAX_UPLOAD_MB) || 200) * 1024 * 1024;
const DATA_DIR = path.join(__dirname, 'data');
const FILE_DIR = path.join(DATA_DIR, 'files');
const DB = path.join(DATA_DIR, 'messages.json');
const PUBLIC = path.join(__dirname, 'public');

fs.mkdirSync(FILE_DIR, { recursive: true });
let messages = [];
try { messages = JSON.parse(fs.readFileSync(DB, 'utf8')); } catch {}
let nextId = messages.reduce((m, x) => Math.max(m, x.id), 0) + 1;
const save = () => fs.writeFile(DB, JSON.stringify(messages), () => {});

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.heic': 'image/heic', '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.json': 'application/json',
};

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function authorized(req) {
  if (!PASSWORD) return true;
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const pass = Buffer.from(h.slice(6), 'base64').toString().split(':').slice(1).join(':');
  const a = Buffer.from(pass), b = Buffer.from(PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readJson(req, cb) {
  let s = '';
  req.on('data', (c) => { s += c; if (s.length > 1e6) req.destroy(); });
  req.on('end', () => { try { cb(JSON.parse(s)); } catch { cb(null); } });
}

function serveFile(res, file, download) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, { error: 'not found' });
    const headers = { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size };
    if (download) headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(download)}`;
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  if (!authorized(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="pcfonchat"' });
    return res.end('password required');
  }
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  // メッセージ一覧（since 以降のみ返す）
  if (req.method === 'GET' && p === '/api/messages') {
    const since = Number(url.searchParams.get('since')) || 0;
    return send(res, 200, { messages: messages.filter((m) => m.id > since), ids: messages.map((m) => m.id) });
  }

  // テキスト送信
  if (req.method === 'POST' && p === '/api/messages') {
    return readJson(req, (b) => {
      if (!b || typeof b.text !== 'string' || !b.text.trim()) return send(res, 400, { error: 'empty' });
      const m = { id: nextId++, from: String(b.from || '').slice(0, 20), time: Date.now(), text: b.text.slice(0, 100000) };
      messages.push(m); save(); send(res, 200, m);
    });
  }

  // ファイル送信（本文がそのままファイル）
  if (req.method === 'POST' && p === '/api/upload') {
    const name = path.basename(url.searchParams.get('name') || 'file').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 120) || 'file';
    const stored = crypto.randomBytes(6).toString('hex') + path.extname(name).toLowerCase();
    const dest = path.join(FILE_DIR, stored);
    let size = 0;
    const out = fs.createWriteStream(dest);
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_UPLOAD) { req.unpipe(out); out.destroy(); fs.unlink(dest, () => {}); send(res, 413, { error: 'too large' }); req.destroy(); }
    });
    req.pipe(out);
    out.on('finish', () => {
      if (size > MAX_UPLOAD) return;
      const m = {
        id: nextId++, from: String(url.searchParams.get('from') || '').slice(0, 20), time: Date.now(),
        file: { name, stored, size, type: String(req.headers['content-type'] || '') },
      };
      messages.push(m); save(); send(res, 200, m);
    });
    return;
  }

  // 削除
  const del = p.match(/^\/api\/messages\/(\d+)$/);
  if (req.method === 'DELETE' && del) {
    const i = messages.findIndex((m) => m.id === Number(del[1]));
    if (i >= 0) {
      const [m] = messages.splice(i, 1);
      if (m.file) fs.unlink(path.join(FILE_DIR, m.file.stored), () => {});
      save();
    }
    return send(res, 200, { ok: true });
  }

  // アップロード済みファイル
  const f = p.match(/^\/files\/([0-9a-f]{12}(\.[a-z0-9]{1,10})?)$/);
  if (req.method === 'GET' && f) {
    const m = messages.find((x) => x.file && x.file.stored === f[1]);
    return serveFile(res, path.join(FILE_DIR, f[1]), url.searchParams.has('dl') && m ? m.file.name : null);
  }

  // 画面
  if (req.method === 'GET' && (p === '/' || p === '/index.html')) return serveFile(res, path.join(PUBLIC, 'index.html'));
  send(res, 404, { error: 'not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`pcfonchat 起動: http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) console.log(`  iPhoneからは → http://${a.address}:${PORT}`);
  if (!PASSWORD) console.log('  (パスワードなし。PASSWORD=xxx node server.js で設定できます)');
});
