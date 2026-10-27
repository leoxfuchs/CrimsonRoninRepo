'use strict';
// The world on disk: one JSON file, written atomically (a temp file renamed over the old one), versioned, and migrated
// forward when an older world is loaded. Missing or broken optional parts are rebuilt rather than refusing to start.
const fs = require('fs');
const path = require('path');

const VERSION = 2;

function fresh() {
  return {
    v: VERSION,
    clock: { tod: 0.32, day: 1, rain: false, rainT: 120 },
    players: {}, gangs: {}, invites: [], apps: [],
    world: { info: null, camps: {}, rivals: {}, cells: {}, events: [], parked: {} },
    seq: { gang: 0, struct: 0, npc: 0, visitor: 0, contract: 0, app: 0, inv: 0, log: 0 }
  };
}

// version 1: players, gangs (one fixed camp slot, ten building levels, one NPC, a dog), invites
function migrate(db) {
  const out = fresh();
  if (!db || typeof db !== 'object') return out;
  if (db.v === VERSION) {
    Object.assign(out, db);
    for (const k of Object.keys(fresh())) if (out[k] === undefined || out[k] === null) out[k] = fresh()[k];
    out.world = Object.assign(fresh().world, db.world || {});
    out.seq = Object.assign(fresh().seq, db.seq || {});
    out.clock = Object.assign(fresh().clock, db.clock || {});
    return out;
  }
  // v1 → v2
  out.players = db.players && typeof db.players === 'object' ? db.players : {};
  out.invites = [];
  const v1 = db.gangs && typeof db.gangs === 'object' ? db.gangs : {};
  for (const [id, g] of Object.entries(v1)) {
    if (!g || typeof g !== 'object') continue;
    out.gangs[id] = { id, v1: { slot: g.slot | 0, buildings: g.buildings || {}, npc: g.npc || null }, name: g.name, leader: g.leader, members: Array.isArray(g.members) ? g.members : [], dog: g.dog || null, world: g.world || null };
  }
  return out;
}

function load(file) {
  try {
    if (!fs.existsSync(file)) return { db: fresh(), note: 'new world' };
    const raw = fs.readFileSync(file, 'utf8');
    const db = migrate(JSON.parse(raw));
    return { db, note: 'loaded' };
  } catch (e) {
    // a corrupt file is kept beside the new one, never thrown away
    try { fs.copyFileSync(file, file + '.corrupt-' + Date.now()); } catch (e2) {}
    return { db: fresh(), note: 'corrupt world set aside: ' + e.message };
  }
}

function save(file, db) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, file);
}

module.exports = { VERSION, fresh, migrate, load, save };
