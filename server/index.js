'use strict';
// Shared-world host for Crimson Ronin Gang mode.
// Serves the game HTML and a WebSocket at /ws and /crimson-ronin/ws. Up to five players share one island: one clock,
// one set of clans, buildings, land and rival gangs, saved to server/data/world.json (see lib/ for how).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const store = require('./lib/store');
const { createNet } = require('./lib/net');

const PORT = parseInt(process.env.PORT || '8091', 10);
const BIND = process.env.BIND || '127.0.0.1';
const ROOT = process.env.STATIC_ROOT || path.join(__dirname, '..');
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const SAVE = path.join(DATA, 'world.json');
const QUIET = process.env.QUIET === '1';
const log = (...a) => { if (!QUIET) console.log(...a); };

fs.mkdirSync(DATA, { recursive: true });
const loaded = store.load(SAVE);
const db = loaded.db;
log('world: ' + loaded.note + ' (v' + db.v + ', ' + Object.keys(db.players).length + ' players, ' + Object.keys(db.gangs).length + ' clans)');

let dirty = true, saveT = 0;
function touch() { dirty = true; }
function flush() {
  if (!dirty) return;
  dirty = false;
  try { store.save(SAVE, db); } catch (e) { console.warn('world save:', e.message); dirty = true; }
}
const net = createNet({ db, touch, log });
setInterval(() => { try { net.tick(1); } catch (e) { console.error('tick', e); } if (Date.now() - saveT > 4000) { saveT = Date.now(); flush(); } }, 1000);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { flush(); process.exit(0); });

function mime(f) {
  if (f.endsWith('.html')) return 'text/html; charset=utf-8';
  if (f.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (f.endsWith('.css')) return 'text/css; charset=utf-8';
  if (f.endsWith('.json')) return 'application/json';
  if (f.endsWith('.png')) return 'image/png';
  if (f.endsWith('.jpg') || f.endsWith('.jpeg')) return 'image/jpeg';
  if (f.endsWith('.svg')) return 'image/svg+xml';
  if (f.endsWith('.md')) return 'text/markdown; charset=utf-8';
  return 'application/octet-stream';
}
function safeJoin(root, urlPath) {
  let rel;
  try { rel = decodeURIComponent(urlPath.split('?')[0]); } catch (e) { return null; }
  rel = rel.replace(/^\/crimson-ronin\/?/, '/').replace(/^\/+/, '');
  const full = path.normalize(path.join(root, rel || 'Crimson Ronin.html'));
  if (!full.startsWith(path.normalize(root))) return null;
  // the world file and the server's own code are not served
  if (full.startsWith(path.normalize(DATA)) || full.includes(path.sep + 'node_modules' + path.sep)) return null;
  return full;
}

const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/health' || u === '/crimson-ronin/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, players: net.byId.size, max: net.MAX_PLAYERS, host: net.hostId, day: db.clock.day }));
    return;
  }
  let file = safeJoin(ROOT, u);
  if (!file) { res.writeHead(403); res.end(); return; }
  if (u === '/' || u === '/crimson-ronin' || u === '/crimson-ronin/' || u.endsWith('/')) {
    const html = path.join(ROOT, 'Crimson Ronin.html');
    if (fs.existsSync(html)) file = html;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': mime(file), 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 });
server.on('upgrade', (req, socket, head) => {
  const u = req.url.split('?')[0];
  if (u !== '/ws' && u !== '/crimson-ronin/ws') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});
wss.on('connection', ws => {
  net.onConnect(ws);
  ws.on('message', data => { try { net.onMsg(ws, data.toString()); } catch (e) { console.error(e); } });
  ws.on('close', () => { try { net.onClose(ws); } catch (e) { console.error(e); } flush(); });
  ws.on('error', () => {});
});

server.listen(PORT, BIND, () => {
  log('Crimson Ronin Gang world on http://' + BIND + ':' + PORT + '/');
  log('WebSocket /ws and /crimson-ronin/ws · up to ' + net.MAX_PLAYERS + ' players · data ' + SAVE);
});

module.exports = { server, net, db, flush };
