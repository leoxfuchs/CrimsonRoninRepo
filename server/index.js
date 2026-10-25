'use strict';
// Shared-world host for Crimson Ronin Gang mode.
// Serves the game HTML and a WebSocket at /ws and /crimson-ronin/ws.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.env.PORT || '8091', 10);
const BIND = process.env.BIND || '127.0.0.1';
const ROOT = process.env.STATIC_ROOT || path.join(__dirname, '..');
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const SAVE = path.join(DATA, 'world.json');

const MP_SLOTS = [
  { id: 'kusamura', name: 'Kusamura Ridge', near: 'village', x: 108, y: 128 },
  { id: 'hanaori', name: 'Hanaori Fold', near: 'shrine', x: 56, y: 162 },
  { id: 'isonami', name: 'Isonami Backshore', near: 'coast', x: 126, y: 162 },
  { id: 'yukimura', name: 'Yukimura Gatefield', near: 'pass', x: 78, y: 78 },
  { id: 'hanamachi', name: 'Hanamachi South Pasture', near: 'castle', x: 154, y: 70 }
];
const BUILDINGS = {
  quarters: { name: 'Sleeping room', costs: [80, 220, 520], bonus: ['Heal 1 HP/s asleep', 'Heal 2 HP/s · clothes chest', 'Heal 4 HP/s · clothes chest'] },
  forge: { name: 'Forge', costs: [120, 320, 800], bonus: ['+8% damage', '+16% damage', '+24% damage'] },
  shrine: { name: 'Shrine', costs: [80, 240, 600], bonus: ['+10 max health', '+25 max health', '+40 max health'] },
  dojo: { name: 'Dojo', costs: [100, 280, 700], bonus: ['+10 stamina', '+25 stamina', '+40 stamina'] },
  barracks: { name: 'Barracks', costs: [150, 400, 900], bonus: ['Room for 1 sworn blade', 'Room for 1 sworn blade', 'Room for 1 sworn blade'] },
  kura: { name: 'Treasury', costs: [100, 300, 700], bonus: ['Store mon', '4% a day', '12% a day'] },
  garden: { name: 'Herb garden', costs: [80, 220, 550], bonus: ['+1 bandage on rest', '+2 bandages', '+3 bandages, +1 sake'] },
  walls: { name: 'Walls & lanterns', costs: [80, 250, 650], bonus: ['Bamboo. Outsiders take two breaths to push through.', 'Wood fences. Ten breaths to force.', 'Stone. Nobody comes in but you.'] },
  stables: { name: 'Stables', costs: [200, 600, 1500], bonus: ['Hitching posts (2 horses)', 'Small shed (4 horses, +12% speed)', 'Full stable (6 horses, +28% speed)'] },
  hearth: { name: 'Campfire', costs: [60, 180, 420], bonus: ['A fire to sit around', 'Lanterns and bedrolls', 'A shelter over the fire'] }
};

function emptyBuildings() {
  const o = {};
  for (const k of Object.keys(BUILDINGS)) o[k] = 0;
  return o;
}
function nid(n = 8) { return crypto.randomBytes(n).toString('hex'); }
function now() { return Date.now(); }

const DOG_COST = 120;

let db = { players: {}, gangs: {}, invites: [] };
try {
  fs.mkdirSync(DATA, { recursive: true });
  if (fs.existsSync(SAVE)) db = Object.assign(db, JSON.parse(fs.readFileSync(SAVE, 'utf8')));
} catch (e) { console.warn('world load:', e.message); }

let dirty = false, saveT = 0;
function touch() { dirty = true; }
function flush() {
  if (!dirty) return;
  dirty = false;
  try {
    const tmp = SAVE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, SAVE);
  } catch (e) { console.warn('world save:', e.message); }
}
setInterval(() => { if (Date.now() - saveT > 4000) { saveT = Date.now(); flush(); } }, 1000);
process.on('SIGINT', () => { flush(); process.exit(0); });
process.on('SIGTERM', () => { flush(); process.exit(0); });

const clients = new Map(); // ws -> { id, token }
function player(id) { return db.players[id]; }
function gangOf(id) { const p = player(id); return p && p.gangId ? db.gangs[p.gangId] : null; }
function send(ws, msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function broadcast(msg, except) {
  const s = JSON.stringify(msg);
  for (const [ws] of clients) if (ws !== except && ws.readyState === 1) ws.send(s);
}
function toGang(g, msg, except) {
  if (!g) return;
  const s = JSON.stringify(msg);
  for (const [ws, c] of clients) {
    if (ws === except) continue;
    const p = player(c.id);
    if (p && p.gangId === g.id && ws.readyState === 1) ws.send(s);
  }
}
function compactNpc(m) {
  if (!m || m.alive === false) return null;
  return {
    id: String(m.id || ('n_' + nid(3))),
    name: cleanName(m.name, 'Ronin'),
    look: m.look && typeof m.look === 'object' ? m.look : {},
    wpn: m.wpn || 'katana',
    armor: m.armor | 0,
    maxHp: m.maxHp || 90,
    skill: +m.skill || 0.5,
    level: m.level || 1,
    alive: true,
    atkSpeed: m.atkSpeed || 1,
    title: String(m.title || '').slice(0, 24)
  };
}
function compactDog(d, fallbackBuyer) {
  if (!d || typeof d !== 'object') return null;
  return {
    name: cleanName(d.name, 'Miso').slice(0, 16),
    coat: d.coat | 0,
    buyer: d.buyer || fallbackBuyer || null
  };
}
function trimGang(g) {
  if (!g) return g;
  if (Array.isArray(g.npcs)) {
    if (!g.npc) g.npc = g.npcs.find(x => x && x.alive !== false) || null;
    delete g.npcs;
  }
  if (Array.isArray(g.npc)) g.npc = g.npc[0] || null;
  g.npc = compactNpc(g.npc);
  g.dog = compactDog(g.dog, g.leader);
  if (!g.world || typeof g.world !== 'object') g.world = g.world || null;
  if (!Array.isArray(g.members)) g.members = [];
  return g;
}
function adoptNpc(g) {
  if (!g || g.npc) return;
  const lead = player(g.leader);
  const list = lead && Array.isArray(lead.gang) ? lead.gang.filter(m => m && m.alive !== false) : [];
  if (list[0]) g.npc = compactNpc(list[0]);
}
function stripExtraNpcs() {
  for (const g of Object.values(db.gangs || {})) {
    trimGang(g);
    adoptNpc(g);
    for (const id of g.members || []) {
      const p = player(id);
      if (p) p.gang = g.npc ? [g.npc] : [];
    }
  }
}
stripExtraNpcs();

function publicPlayer(p, online) {
  return {
    id: p.id, name: p.name, look: p.look, x: p.x, y: p.y, face: p.face || 0,
    hp: p.hp, maxHp: p.maxHp || 100, wpn: p.wpn, armor: p.armor || 0,
    pose: p.pose || 'idle', state: p.pose || 'idle',
    armed: !!(p.wpn && p.wpn !== 'fists'),
    atk: p.atk || null, draw: p.draw || null,
    walk: p.walk || 0, moving: !!p.moving, crouch: !!p.crouch,
    mounted: !!p.mounted, seat: p.seat || 0,
    mountOf: p.mountOf || null, horse: p.horse, dog: p.dog || null,
    gangId: p.gangId, online: !!online
  };
}
function publicGang(g) {
  if (!g) return null;
  trimGang(g);
  return {
    id: g.id, name: g.name, leader: g.leader, members: (g.members || []).slice(),
    slot: g.slot, buildings: g.buildings,
    npc: g.npc || null, dog: g.dog || null, world: g.world || null
  };
}
function snapshotWorld() {
  return { slots: MP_SLOTS, buildings: BUILDINGS, gangs: db.gangs };
}
function usedSlots() { return new Set(Object.values(db.gangs).map(g => g.slot)); }
function nextSlot() {
  const used = usedSlots();
  for (let i = 0; i < MP_SLOTS.length; i++) if (!used.has(i)) return i;
  return 0;
}
function makeGang(leaderId, name) {
  const id = 'g_' + nid(4);
  const g = { id, leader: leaderId, members: [leaderId], slot: nextSlot(), name: name || 'Nameless gang', buildings: emptyBuildings(), npc: null, dog: null, world: null };
  db.gangs[id] = g; touch();
  return g;
}
function campPos(g) {
  const s = MP_SLOTS[g.slot] || MP_SLOTS[0];
  return [s.x, s.y + 1];
}
function cleanName(raw, fallback) {
  const n = String(raw || '').replace(/\s+/g, ' ').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 24);
  return n || fallback || 'Ronin';
}
function setName(p, raw) {
  const old = p.name;
  p.name = cleanName(raw, old);
  const g = gangOf(p.id);
  if (g && g.leader === p.id && (g.name === old + '\'s gang' || g.name === 'Nameless gang')) g.name = p.name + '\'s gang';
  touch();
  return p.name;
}

function hello(ws, m) {
  let p = m.token && Object.values(db.players).find(x => x.token === m.token);
  if (!p) {
    const id = 'p_' + nid(4);
    p = {
      id, token: nid(12), name: cleanName(m.name, 'Ronin'), look: m.look || {},
      gold: 240, bank: 0, honor: 0, xp: 0, level: 1, perks: {},
      weapons: ['katana'], stash: [], wpn: 'katana', lastBlade: 'katana',
      armors: [0], armor: 0, bandages: 3, sake: 0,
      horse: { coat: 0, name: 'Scrag', spdMul: 0.55 },
      x: 108, y: 130, face: 0, hp: 100, maxHp: 100, pose: 'idle',
      mounted: false, seat: 0, mountOf: null, gangId: null, day: 1, tod: 0.32
    };
    const g = makeGang(id, p.name + '\'s gang');
    p.gangId = g.id;
    const [x, y] = campPos(g); p.x = x; p.y = y;
    db.players[id] = p; touch();
  } else {
    if (m.look) p.look = m.look;
    if (m.name) setName(p, m.name);
    else touch();
  }
  if (!p.gangId || !db.gangs[p.gangId]) {
    const g = makeGang(p.id, p.name + '\'s gang');
    p.gangId = g.id; touch();
  }
  clients.set(ws, { id: p.id, token: p.token });
  const g = gangOf(p.id);
  if (g) { trimGang(g); adoptNpc(g); p.gang = g.npc ? [g.npc] : []; }
  send(ws, { t: 'welcome', id: p.id, token: p.token, you: p, gang: publicGang(g), world: snapshotWorld(), slots: MP_SLOTS });
  const others = [];
  for (const [ow, c] of clients) if (c.id !== p.id) { const q = player(c.id); if (q) others.push(publicPlayer(q, true)); }
  send(ws, { t: 'players', list: others });
  broadcast({ t: 'player', p: publicPlayer(p, true) }, ws);
}

function onMsg(ws, raw) {
  let m; try { m = JSON.parse(raw); } catch (e) { return; }
  const c = clients.get(ws);
  if (!c) {
    if (m.t === 'hello' || m.t === 'join') hello(ws, m);
    return;
  }
  const p = player(c.id); if (!p) return;
  switch (m.t) {
    case 'pose':
    case 'state': {
      p.x = +m.x || p.x; p.y = +m.y || p.y; p.face = +m.face || 0;
      p.hp = m.hp; p.maxHp = m.maxHp; p.wpn = m.wpn; p.armor = m.armor;
      p.pose = m.pose || m.state || p.pose; p.atk = m.atk || null; p.draw = m.draw || null;
      p.walk = m.walk || 0; p.moving = !!m.moving; p.crouch = !!m.crouch;
      p.armed = m.armed != null ? !!m.armed : !!(p.wpn && p.wpn !== 'fists');
      p.mounted = !!m.mounted; p.seat = m.seat | 0; p.mountOf = m.mountOf || null;
      if (m.look) p.look = m.look;
      if (m.horse) p.horse = Object.assign(p.horse || {}, m.horse);
      if (m.dog) p.dog = m.dog; else if (m.dog === null) p.dog = null;
      broadcast({
        t: 'state', id: p.id, x: p.x, y: p.y, face: p.face, hp: p.hp, maxHp: p.maxHp,
        wpn: p.wpn, armor: p.armor, pose: p.pose, state: p.pose, armed: p.armed,
        atk: p.atk, draw: p.draw, walk: p.walk, moving: p.moving, crouch: p.crouch,
        look: p.look, mounted: p.mounted, seat: p.seat, mountOf: p.mountOf, horse: p.horse, dog: p.dog || null
      }, ws);
      break;
    }
    case 'save': {
      if (m.profile && typeof m.profile === 'object') {
        const keep = ['gold', 'bank', 'honor', 'xp', 'level', 'perks', 'weapons', 'stash', 'wpn', 'lastBlade', 'armors', 'armor', 'bandages', 'sake', 'horse', 'day', 'tod', 'quests', 'track', 'chests', 'camps', 'blades', 'kills', 'bonusHp', 'look', 'name', 'gang'];
        for (const k of keep) if (m.profile[k] !== undefined) p[k] = m.profile[k];
        p.x = m.profile.pos ? m.profile.pos[0] : p.x;
        p.y = m.profile.pos ? m.profile.pos[1] : p.y;
        touch();
      }
      break;
    }
    case 'invite': {
      const to = player(m.to) || Object.values(db.players).find(x => x.name === m.to);
      if (!to) { send(ws, { t: 'err', msg: 'No one by that name is in this world.' }); break; }
      if (to.id === p.id) break;
      const g = gangOf(p.id); if (!g) break;
      if (g.leader !== p.id) { send(ws, { t: 'err', msg: 'Only the gang leader can invite.' }); break; }
      db.invites.push({ from: p.id, to: to.id, gang: g.id, at: now() });
      touch();
      for (const [ow, oc] of clients) if (oc.id === to.id) send(ow, { t: 'invite', from: p.id, name: p.name, gang: g.name, gangId: g.id });
      send(ws, { t: 'ok', msg: 'Invite sent to ' + to.name + '.' });
      break;
    }
    case 'accept': {
      const inv = db.invites.find(i => i.to === p.id && i.from === m.from);
      if (!inv) { send(ws, { t: 'err', msg: 'That invite is gone.' }); break; }
      const g = db.gangs[inv.gang]; if (!g) break;
      const old = gangOf(p.id);
      p.gangId = g.id;
      if (!g.members.includes(p.id)) g.members.push(p.id);
      if (old && old.id !== g.id) {
        old.members = old.members.filter(id => id !== p.id);
        if (old.leader === p.id) old.leader = old.members[0] || null;
        if (!old.members.length) delete db.gangs[old.id];
      }
      db.invites = db.invites.filter(i => i !== inv);
      const [x, y] = campPos(g); p.x = x; p.y = y;
      touch();
      send(ws, { t: 'joined', gang: publicGang(g), x, y });
      toGang(g, { t: 'gang', gang: publicGang(g), joined: publicPlayer(p, true) });
      break;
    }
    case 'campBuy':
    case 'campUp': {
      const g = gangOf(p.id); if (!g) break;
      const key = m.key, def = BUILDINGS[key]; if (!def) break;
      const cur = g.buildings[key] | 0;
      if (m.t === 'campBuy' && cur !== 0) { send(ws, { t: 'err', msg: 'Already standing.' }); break; }
      if (m.t === 'campUp' && (cur < 1 || cur >= 3)) { send(ws, { t: 'err', msg: 'Nothing to upgrade.' }); break; }
      const cost = def.costs[cur];
      const gold = (p.gold | 0) + (p.bank | 0);
      if (gold < cost) { send(ws, { t: 'err', msg: 'Not enough mon (need ' + cost + ').' }); break; }
      const fromCarry = Math.min(p.gold | 0, cost); p.gold -= fromCarry; p.bank = (p.bank | 0) - (cost - fromCarry);
      g.buildings[key] = cur + 1;
      touch();
      toGang(g, { t: 'camp', gang: publicGang(g), gold: p.gold, bank: p.bank, who: p.id, key, lvl: g.buildings[key] });
      send(ws, { t: 'paid', gold: p.gold, bank: p.bank });
      break;
    }
    case 'questStart': {
      const g = gangOf(p.id);
      const at = Array.isArray(m.at) ? m.at : campPos(g || { slot: 0 });
      const ret = [p.x, p.y];
      toGang(g, { t: 'questGo', id: m.id, at, ret, by: p.id, title: m.title || m.id }, null);
      break;
    }
    case 'questEnd': {
      const g = gangOf(p.id);
      toGang(g, { t: 'questEnd', id: m.id, ret: m.ret }, null);
      break;
    }
    case 'rename': {
      setName(p, m.name);
      broadcast({ t: 'player', p: publicPlayer(p, true) });
      const g = gangOf(p.id); if (g) toGang(g, { t: 'gang', gang: publicGang(g) });
      break;
    }
    case 'hireNpc': {
      const g = gangOf(p.id); if (!g) break;
      if (g.npc) { send(ws, { t: 'err', msg: 'Your gang already has a sworn blade.' }); break; }
      g.npc = compactNpc(m.npc); if (!g.npc) break;
      for (const id of g.members) { const q = player(id); if (q) q.gang = [g.npc]; }
      touch();
      toGang(g, { t: 'gang', gang: publicGang(g), hired: g.npc, who: p.id });
      break;
    }
    case 'dismissNpc': {
      const g = gangOf(p.id); if (!g) break;
      g.npc = null;
      for (const id of g.members) { const q = player(id); if (q) q.gang = []; }
      touch();
      toGang(g, { t: 'gang', gang: publicGang(g), dismissed: true, who: p.id });
      break;
    }
    case 'buyDog': {
      const g = gangOf(p.id); if (!g) break;
      if (g.dog) { send(ws, { t: 'err', msg: 'The camp already has a dog.' }); break; }
      const gold = (p.gold | 0) + (p.bank | 0);
      if (gold < DOG_COST) { send(ws, { t: 'err', msg: 'Not enough mon (need ' + DOG_COST + ').' }); break; }
      const fromCarry = Math.min(p.gold | 0, DOG_COST); p.gold -= fromCarry; p.bank = (p.bank | 0) - (DOG_COST - fromCarry);
      g.dog = { name: cleanName(m.name, 'Miso').slice(0, 16), coat: m.coat | 0, buyer: p.id };
      touch();
      toGang(g, { t: 'gang', gang: publicGang(g), dog: g.dog, who: p.id });
      send(ws, { t: 'paid', gold: p.gold, bank: p.bank });
      send(ws, { t: 'ok', msg: g.dog.name + ' waits by the fire.' });
      break;
    }
    case 'renameDog': {
      const g = gangOf(p.id); if (!g || !g.dog) break;
      if (p.id !== g.leader && p.id !== g.dog.buyer) { send(ws, { t: 'err', msg: 'Only the one who bought the dog, or the gang leader, can rename it.' }); break; }
      g.dog.name = cleanName(m.name, g.dog.name).slice(0, 16);
      touch();
      toGang(g, { t: 'gang', gang: publicGang(g), dog: g.dog });
      break;
    }
    case 'worldSync': {
      const g = gangOf(p.id); if (!g || g.leader !== p.id) break;
      g.world = {
        tod: m.tod, day: m.day | 0, rain: !!m.rain,
        track: m.track || null,
        quests: m.quests && typeof m.quests === 'object' ? m.quests : (g.world && g.world.quests) || {},
        npcPose: m.npcPose || null
      };
      toGang(g, {
        t: 'worldSync', tod: g.world.tod, day: g.world.day, rain: g.world.rain,
        track: g.world.track, quests: g.world.quests, npcPose: g.world.npcPose,
        dog: m.dog || null, actors: Array.isArray(m.actors) ? m.actors.slice(0, 24) : []
      }, ws);
      break;
    }
    case 'questSync': {
      const g = gangOf(p.id); if (!g) break;
      if (!g.world) g.world = {};
      if (m.track !== undefined) g.world.track = m.track;
      if (m.quests && typeof m.quests === 'object') g.world.quests = m.quests;
      else if (m.id) {
        g.world.quests = g.world.quests || {};
        g.world.quests[m.id] = { s: m.s | 0, n: m.n | 0, done: !!m.done };
      }
      toGang(g, m, ws);
      break;
    }
    case 'track': {
      const g = gangOf(p.id); if (!g) break;
      if (g.leader !== p.id) { send(ws, { t: 'err', msg: 'Only the gang leader sets the tracker.' }); break; }
      if (!g.world) g.world = {};
      g.world.track = m.id || null;
      toGang(g, { t: 'track', id: g.world.track }, ws);
      break;
    }
    case 'npcHurt': {
      const g = gangOf(p.id);
      toGang(g, { t: 'npcHurt', id: m.id, hp: m.hp, dead: !!m.dead, x: +m.x, y: +m.y, by: p.id }, ws);
      break;
    }
    case 'mount': {
      broadcast({ t: 'mount', id: p.id, owner: m.owner, seat: m.seat | 0 });
      p.mounted = true; p.seat = m.seat | 0; p.mountOf = m.owner || p.id;
      break;
    }
    case 'dismount': {
      broadcast({ t: 'dismount', id: p.id });
      p.mounted = false; p.seat = 0; p.mountOf = null;
      break;
    }
    case 'kill': {
      const g = gangOf(p.id);
      toGang(g, { t: 'kill', x: +m.x, y: +m.y, name: m.name, faction: m.faction, by: p.id }, ws);
      break;
    }
    case 'horseBuy': {
      const HORSES = [
        { id: 'nag', name: 'Nag', cost: 180, coat: 1, spdMul: 0.78 },
        { id: 'road', name: 'Road horse', cost: 420, coat: 2, spdMul: 1.0 },
        { id: 'fine', name: 'Fine mount', cost: 900, coat: 4, spdMul: 1.18 }
      ];
      const def = HORSES.find(h => h.id === m.id); if (!def) break;
      const gold = (p.gold | 0) + (p.bank | 0);
      if (gold < def.cost) { send(ws, { t: 'err', msg: 'Not enough mon (need ' + def.cost + ').' }); break; }
      const fromCarry = Math.min(p.gold | 0, def.cost); p.gold -= fromCarry; p.bank = (p.bank | 0) - (def.cost - fromCarry);
      p.horse = Object.assign(p.horse || {}, { coat: def.coat, name: def.name, spdMul: def.spdMul });
      touch();
      send(ws, { t: 'horse', horse: p.horse, gold: p.gold, bank: p.bank });
      break;
    }
  }
}

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
  const rel = decodeURIComponent(urlPath.split('?')[0]).replace(/^\/crimson-ronin\/?/, '/').replace(/^\/+/, '');
  const full = path.normalize(path.join(root, rel || 'Crimson Ronin.html'));
  if (!full.startsWith(path.normalize(root))) return null;
  return full;
}

const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/health' || u === '/crimson-ronin/health') {
    res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return;
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

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const u = req.url.split('?')[0];
  if (u !== '/ws' && u !== '/crimson-ronin/ws') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});
wss.on('connection', ws => {
  ws.on('message', data => { try { onMsg(ws, data.toString()); } catch (e) { console.error(e); } });
  ws.on('close', () => {
    const c = clients.get(ws);
    if (c) { broadcast({ t: 'leave', id: c.id }, ws); clients.delete(ws); flush(); }
  });
});

server.listen(PORT, BIND, () => {
  console.log('Crimson Ronin Gang world on http://' + BIND + ':' + PORT + '/');
  console.log('WebSocket /ws and /crimson-ronin/ws · data ' + SAVE);
});
