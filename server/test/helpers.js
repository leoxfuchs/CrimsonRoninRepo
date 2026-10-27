'use strict';
// Test helpers: a real world host in a child process on a free port with its own data folder, and players that
// connect to it over WebSocket and wait for the messages they expect.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const WebSocket = require('ws');

function freePort() { return new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); }); }
function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'crimson-world-')); }

async function startServer(o = {}) {
  const port = o.port || await freePort(), dir = o.dir || tmpDir();
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'index.js')], { env: Object.assign({}, process.env, { PORT: String(port), BIND: '127.0.0.1', DATA_DIR: dir, QUIET: '1' }), stdio: ['ignore', 'pipe', 'pipe'] });
  let errText = ''; proc.stderr.on('data', d => { errText += d; });
  for (let i = 0; i < 100; i++) {
    try { await new Promise((res, rej) => { const r = require('http').get('http://127.0.0.1:' + port + '/health', x => { x.resume(); x.statusCode === 200 ? res() : rej(); }); r.on('error', rej); }); break; }
    catch (e) { await sleep(60); }
  }
  return { port, dir, proc, url: 'ws://127.0.0.1:' + port + '/ws', stop: () => new Promise(res => { if (proc.exitCode !== null) return res(); proc.once('exit', res); proc.kill('SIGTERM'); }), err: () => errText };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Player {
  constructor(url, name, token) { this.url = url; this.name = name; this.token = token; this.msgs = []; this.waiters = []; this.rid = 0; }
  open() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(this.url);
      this.ws.on('open', () => { this.ws.send(JSON.stringify({ t: 'hello', v: 2, name: this.name, token: this.token, look: { skin: 1 } })); res(this); });
      this.ws.on('message', d => { const m = JSON.parse(d.toString()); if (m.t === 'welcome') { this.id = m.id; this.token = m.token; this.welcome = m; } const w = this.waiters.find(w => w.test(m)); if (w) { this.waiters.splice(this.waiters.indexOf(w), 1); w.res(m); } else this.msgs.push(m); });
      this.ws.on('error', rej);
      this.ws.on('close', () => { this.closed = true; });
    });
  }
  async join() { await this.open(); return this.wait(m => m.t === 'welcome' || m.t === 'full', 3000); }
  wait(test, ms = 3000) {
    const hit = this.msgs.find(test); if (hit) { this.msgs.splice(this.msgs.indexOf(hit), 1); return Promise.resolve(hit); }
    return new Promise((res, rej) => { const w = { test, res }; this.waiters.push(w); setTimeout(() => { const i = this.waiters.indexOf(w); if (i >= 0) { this.waiters.splice(i, 1); rej(new Error(this.name + ': timed out waiting')); } }, ms); });
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  async req(op, args = {}, rid) { const id = rid || (this.name + ':' + (++this.rid)); this.send(Object.assign({ t: 'req', op, rid: id }, args)); return this.wait(m => m.t === 'res' && m.rid === id); }
  drain(t) { this.msgs = this.msgs.filter(m => m.t !== t); }
  close() { return new Promise(res => { if (!this.ws || this.closed) return res(); this.ws.once('close', res); this.ws.close(); }); }
}

module.exports = { startServer, Player, sleep, tmpDir, freePort };
