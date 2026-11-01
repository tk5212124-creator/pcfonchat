// pcfonchat - PC と iPhone で文字・ファイルをやり取りする最小チャット
// 依存パッケージなし。Node.js 18+ で `node server.js` するだけ。
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PORT = Number(process.env.PORT) || 3000;
// 127.0.0.1 にすると PC 自身（と tailscale serve）からしか接続できなくなる
const HOST = process.env.HOST || '0.0.0.0';
const PASSWORD = process.env.PASSWORD || ''; // 設定するとログインが必要になる（公開時は必須）
const MAX_UPLOAD = (Number(process.env.MAX_UPLOAD_MB) || 200) * 1024 * 1024;
const KEEP_DAYS = Number(process.env.KEEP_DAYS) || 0; // 0 = 自動削除しない
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const FILE_DIR = path.join(DATA_DIR, 'files');
const DB = path.join(DATA_DIR, 'messages.json');
const PUBLIC = path.join(__dirname, 'public');
const COOKIE = 'pcf';

if (!PASSWORD && process.env.NODE_ENV === 'production') {
  console.error('公開環境では PASSWORD を設定してください。');
  process.exit(1);
}

fs.mkdirSync(FILE_DIR, { recursive: true });
let messages = [];
try { messages = JSON.parse(fs.readFileSync(DB, 'utf8')); } catch {}
let nextId = messages.reduce((m, x) => Math.max(m, x.id), 0) + 1;
function save() {
  const tmp = DB + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(messages));
  fs.renameSync(tmp, DB);
}

// ---- 認証（パスワード → 長期間有効な Cookie） ----
// 鍵はデータフォルダに保存するので再起動してもログイン状態が保たれる。
// パスワードを変えると全端末がログアウトされる。
const SECRET_FILE = path.join(DATA_DIR, '.secret');
let secret;
try { secret = fs.readFileSync(SECRET_FILE, 'utf8'); } catch {
  secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
}
const token = crypto.createHmac('sha256', secret).update('login:' + PASSWORD).digest('hex');
const safeEq = (a, b) => { a = Buffer.from(String(a)); b = Buffer.from(String(b)); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((x) => x[0]));
const authorized = (req) => !PASSWORD || safeEq(cookies(req)[COOKIE] || '', token);
const isHttps = (req) => req.socket.encrypted || String(req.headers['x-forwarded-proto'] || '').split(',')[0] === 'https';
const clientIp = (req) => String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

// 総当たり対策: IP ごとに 15 分で 10 回まで
const fails = new Map();
function tooMany(ip) {
  const f = fails.get(ip);
  if (f && Date.now() - f.since > 15 * 60e3) { fails.delete(ip); return false; }
  return f && f.n >= 10;
}
function addFail(ip) { const f = fails.get(ip) || { n: 0, since: Date.now() }; f.n++; fails.set(ip, f); }

// ---- 古いメッセージの自動削除 ----
function removeMessage(i) {
  const [m] = messages.splice(i, 1);
  if (m.file) fs.unlink(path.join(FILE_DIR, m.file.stored), () => {});
}
function cleanup() {
  if (!KEEP_DAYS) return;
  const limit = Date.now() - KEEP_DAYS * 86400e3;
  let changed = false;
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].time < limit) { removeMessage(i); changed = true; }
  if (changed) save();
}
cleanup();
setInterval(cleanup, 3600e3);

// ---- HTTP ----
const MIME = {
  '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.heic': 'image/heic', '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg',
};

const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

function send(res, code, body, type = 'application/json', extra = {}) {
  res.writeHead(code, { ...BASE_HEADERS, 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req, cb) {
  let s = '';
  req.on('data', (c) => { s += c; if (s.length > 1e6) req.destroy(); });
  req.on('end', () => cb(s));
}
const readJson = (req, cb) => readBody(req, (s) => { try { cb(JSON.parse(s)); } catch { cb(null); } });

function serveFile(res, file, { download, upload } = {}) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, { error: 'not found' });
    const headers = {
      ...BASE_HEADERS,
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': upload ? 'private, max-age=31536000, immutable' : 'no-cache',
    };
    // アップロードされたファイルはスクリプト実行を禁止して配信
    if (upload) headers['Content-Security-Policy'] = "sandbox; default-src 'none'; img-src 'self'; media-src 'self'";
    if (download) headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(download)}`;
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  });
}

// ブラウザ以外のサイトからの書き込みを防ぐ（CSRF 対策）
function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  const hosts = [req.headers.host, ...String(req.headers['x-forwarded-host'] || '').split(',')].map((h) => String(h || '').trim()).filter(Boolean);
  try { return hosts.includes(new URL(o).host); } catch { return false; }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (req.method !== 'GET' && !sameOrigin(req)) return send(res, 403, { error: 'bad origin' });

  // ログイン
  if (req.method === 'GET' && p === '/login') return serveFile(res, path.join(PUBLIC, 'login.html'));
  if (req.method === 'POST' && p === '/login') {
    const ip = clientIp(req);
    if (tooMany(ip)) return send(res, 429, { error: '試行回数が多すぎます。しばらく待ってください。' });
    return readJson(req, (b) => {
      if (!PASSWORD || (b && safeEq(b.password || '', PASSWORD))) {
        fails.delete(ip);
        const c = `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${isHttps(req) ? '; Secure' : ''}`;
        return send(res, 200, { ok: true }, 'application/json', { 'Set-Cookie': c });
      }
      addFail(ip);
      setTimeout(() => send(res, 401, { error: 'パスワードが違います' }), 500);
    });
  }
  if (req.method === 'POST' && p === '/logout') {
    return send(res, 200, { ok: true }, 'application/json', { 'Set-Cookie': `${COOKIE}=; Path=/; Max-Age=0` });
  }
  if (req.method === 'GET' && p === '/healthz') return send(res, 200, 'ok', 'text/plain');

  if (!authorized(req)) {
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) { res.writeHead(302, { Location: '/login' }); return res.end(); }
    return send(res, 401, { error: 'login required' });
  }

  // メッセージ一覧（since 以降のみ返す）
  if (req.method === 'GET' && p === '/api/messages') {
    const since = Number(url.searchParams.get('since')) || 0;
    return send(res, 200, { messages: messages.filter((m) => m.id > since), ids: messages.map((m) => m.id), auth: !!PASSWORD });
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
    if (Number(req.headers['content-length']) > MAX_UPLOAD) return send(res, 413, { error: 'too large' });
    const name = path.basename(url.searchParams.get('name') || 'file').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 120) || 'file';
    const ext = (path.extname(name).toLowerCase().match(/^\.[a-z0-9]{1,10}$/) || [''])[0];
    const stored = crypto.randomBytes(12).toString('hex') + ext;
    const dest = path.join(FILE_DIR, stored);
    let size = 0, aborted = false;
    const out = fs.createWriteStream(dest);
    const fail = (code) => { if (aborted) return; aborted = true; req.unpipe(out); out.destroy(); fs.unlink(dest, () => {}); send(res, code, { error: 'upload failed' }); };
    req.on('data', (c) => { size += c.length; if (size > MAX_UPLOAD) { fail(413); req.destroy(); } });
    req.on('aborted', () => fail(400));
    out.on('error', () => fail(500));
    req.pipe(out);
    out.on('finish', () => {
      if (aborted) return;
      const m = {
        id: nextId++, from: String(url.searchParams.get('from') || '').slice(0, 20), time: Date.now(),
        file: { name, stored, size, type: String(req.headers['content-type'] || '').slice(0, 100) },
      };
      messages.push(m); save(); send(res, 200, m);
    });
    return;
  }

  // 削除
  const del = p.match(/^\/api\/messages\/(\d+)$/);
  if (req.method === 'DELETE' && del) {
    const i = messages.findIndex((m) => m.id === Number(del[1]));
    if (i >= 0) { removeMessage(i); save(); }
    return send(res, 200, { ok: true });
  }

  // アップロード済みファイル
  const f = p.match(/^\/files\/([0-9a-f]{12}(?:[0-9a-f]{12})?(\.[a-z0-9]{1,10})?)$/);
  if (req.method === 'GET' && f) {
    const m = messages.find((x) => x.file && x.file.stored === f[1]);
    if (!m) return send(res, 404, { error: 'not found' });
    return serveFile(res, path.join(FILE_DIR, f[1]), { upload: true, download: url.searchParams.has('dl') ? m.file.name : null });
  }

  // 画面
  if (req.method === 'GET' && (p === '/' || p === '/index.html')) return serveFile(res, path.join(PUBLIC, 'index.html'));
  send(res, 404, { error: 'not found' });
});

server.requestTimeout = 0; // 大きいファイルのアップロードを途中で切らない
server.listen(PORT, HOST, () => {
  console.log(`pcfonchat 起動: http://localhost:${PORT}  (データ: ${DATA_DIR})`);
  if (HOST === '127.0.0.1' || HOST === 'localhost') console.log('  この PC 内からのみ接続を受け付けます（Tailscale 経由は tailscale serve を使用）');
  else for (const list of Object.values(os.networkInterfaces()))
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) console.log(`  同じネットワーク/Tailscaleから → http://${a.address}:${PORT}`);
  if (!PASSWORD) console.log('  ⚠ パスワードなし。PASSWORD=xxx を設定するとログインが必要になります');
});
