'use strict';
// Small helpers shared by the world host: ids, clean strings and numbers from the network, a seeded random.
const crypto = require('crypto');

function nid(n = 8) { return crypto.randomBytes(n).toString('hex'); }
function now() { return Date.now(); }
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

// a name, a title, a line of text: control characters out, whitespace folded, cut to length
function cleanText(raw, max = 24, fallback = '') {
  const s = String(raw == null ? '' : raw).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  return s || fallback;
}
// a longer block (a history, a founding story): newlines kept, nothing else
function cleanBlock(raw, max = 600) {
  return String(raw == null ? '' : raw).replace(/\r/g, '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}
function cleanName(raw, fallback) { return cleanText(raw, 24, fallback || 'Ronin'); }
const HEX = /^#[0-9a-fA-F]{6}$/;
function cleanHex(raw, fallback = '#888888') { const s = String(raw || ''); return HEX.test(s) ? s.toLowerCase() : fallback; }
function num(raw, lo, hi, fallback = lo) { const n = +raw; return Number.isFinite(n) ? clamp(n, lo, hi) : fallback; }
function int(raw, lo, hi, fallback = lo) { return Math.round(num(raw, lo, hi, fallback)); }
function pickOne(raw, list, fallback) { return list.includes(raw) ? raw : (fallback === undefined ? list[0] : fallback); }
function bool(raw) { return raw === true || raw === 1 || raw === 'true'; }

// a small deterministic random (mulberry32), for anything the server rolls that should be reproducible in tests
function RNG(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hashStr(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

// a request id seen once is answered once: repeated sends (a double click, a resend after a hiccup) do nothing more
class Seen {
  constructor(max = 256) { this.max = max; this.set = new Set(); this.order = []; }
  first(key) {
    if (!key) return true;
    if (this.set.has(key)) return false;
    this.set.add(key); this.order.push(key);
    if (this.order.length > this.max) this.set.delete(this.order.shift());
    return true;
  }
}
// at most `n` of something per `ms` (a flood of building requests, invites, chat)
class Rate {
  constructor(n, ms) { this.n = n; this.ms = ms; this.t = []; }
  ok(at = Date.now()) { this.t = this.t.filter(x => at - x < this.ms); if (this.t.length >= this.n) return false; this.t.push(at); return true; }
}

module.exports = { nid, now, clamp, dist, cleanText, cleanBlock, cleanName, cleanHex, num, int, pickOne, bool, RNG, hashStr, Seen, Rate, HEX };
