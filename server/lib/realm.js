'use strict';
// The island as the world host sees it: one clock for everyone, districts of land that clans and rival gangs hold,
// rival gangs that grow, expand, raid and bargain, and the daily and hourly turn of every clan's economy.
// The game computes the island (from the shared seed) and sends its geography once; the server keeps who owns what.
const C = require('./catalog');
const U = require('./util');

const DAY_LEN = 600;              // real seconds in a game day (the game's own DAY_LEN)
const HOUR_LEN = DAY_LEN / 24;
const CELL = 256;                 // a district is CELL tiles on a side

function createRealm(ctx, G, B, L) {
  const { db } = ctx;
  const R = {};

  // ---- the clock: the server's, nobody else's. It only runs while someone is in the world
  R.clock = () => db.clock;
  R.advance = (dtSec) => {
    const c = db.clock, before = c.tod, hBefore = Math.floor(before * 24);
    c.tod = (c.tod + dtSec / DAY_LEN) % 1;
    c.rainT -= dtSec; if (c.rainT <= 0) { c.rain = Math.random() < 0.15; c.rainT = 60 + Math.random() * 100; ctx.broadcastClock(); }
    const crossedDawn = before < 0.25 && c.tod >= 0.25 || (before > c.tod && c.tod >= 0.25);
    if (crossedDawn) { c.day++; R.dayTurn(); ctx.broadcastClock(); }
    if (Math.floor(c.tod * 24) !== hBefore) R.hourTurn();
  };

  // ---- the island's geography, sent once by a client (deterministic from the seed): districts, places, camps, sites
  R.setInfo = (info, pid) => {
    if (!info || typeof info !== 'object') return 'No island sent.';
    const cur = db.world.info;
    if (cur && cur.ver === info.ver && cur.seed === info.seed) return null;
    const cells = Array.isArray(info.cells) ? info.cells.slice(0, 1200) : [], places = Array.isArray(info.places) ? info.places.slice(0, 900) : [], camps = Array.isArray(info.camps) ? info.camps.slice(0, 200) : [], sites = Array.isArray(info.sites) ? info.sites.slice(0, 200) : [];
    const n = v => U.num(v, -99999, 99999, 0);
    const out = {
      ver: U.cleanText(info.ver, 20, '1'), seed: U.int(info.seed, 0, 2 ** 31, 0), cell: CELL, by: pid, at: U.now(),
      cells: cells.map(c => ({ k: U.cleanText(c.k, 16), cx: U.int(c.cx, -99, 99), cy: U.int(c.cy, -99, 99), prov: U.cleanText(c.prov, 40), b: U.cleanText(c.b, 24), land: U.num(c.land, 0, 1, 0), towns: U.int(c.towns, 0, 40, 0), coast: U.bool(c.coast), mtn: U.num(c.mtn, 0, 1, 0), forest: U.num(c.forest, 0, 1, 0), water: U.num(c.water, 0, 1, 0) })).filter(c => c.k && c.land > 0.15),
      places: places.map(p => ({ id: U.cleanText(p.id, 32), name: U.cleanText(p.name, 40), x: n(p.x), y: n(p.y), kind: U.cleanText(p.kind, 12), cell: U.cleanText(p.cell, 16), coast: U.bool(p.coast) })).filter(p => p.id),
      sites: sites.map(s => ({ id: U.cleanText(s.id, 32), name: U.cleanText(s.name, 40), x: n(s.x), y: n(s.y), cell: U.cleanText(s.cell, 16), prov: U.cleanText(s.prov, 40), traits: (Array.isArray(s.traits) ? s.traits : []).filter(t => C.TRAITS_HQ[t]).slice(0, 4) })).filter(s => s.id)
    };
    db.world.info = out;
    // the outlaw gangs of the island's camps become the rival factions
    for (const c of camps) {
      const id = U.cleanText(c.id, 32); if (!id) continue;
      const rival = 'r_' + U.cleanText(c.gang, 32, 'Outlaws').toLowerCase().replace(/[^a-z]+/g, '_');
      const prev = db.world.camps[id] || {};
      db.world.camps[id] = Object.assign({ id, name: U.cleanText(c.name, 40, 'Outlaw camp'), x: n(c.x), y: n(c.y), cell: U.cleanText(c.cell, 16), rival, rivalName: U.cleanText(c.gang, 32, 'Outlaws'), boss: U.cleanText(c.boss, 32, ''), crew: U.int(c.crew, 1, 12, 4), cleared: false, owner: null }, prev, { x: n(c.x), y: n(c.y), cell: U.cleanText(c.cell, 16) });
    }
    R.initRivals();
    return null;
  };
  R.cellKey = (x, y) => Math.floor(x / CELL) + ',' + Math.floor(y / CELL);
  R.cellInfo = (k) => (db.world.info && db.world.info.cells.find(c => c.k === k)) || null;
  R.cellState = (k) => db.world.cells[k] || (db.world.cells[k] = { owner: null, inf: {}, hold: 0, visit: {}, contest: null });
  R.neighbours = (k) => { const [x, y] = k.split(',').map(Number); return [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => (x + dx) + ',' + (y + dy)); };
  R.owned = (id) => Object.entries(db.world.cells).filter(([, c]) => c.owner === id).map(([k]) => k);

  // ---- rivals
  R.initRivals = () => {
    const by = {};
    for (const c of Object.values(db.world.camps)) (by[c.rival] = by[c.rival] || []).push(c);
    const tempers = Object.keys(C.TEMPERS);
    for (const [id, camps] of Object.entries(by)) {
      const r = db.world.rivals[id] || (db.world.rivals[id] = { id, name: camps[0].rivalName, temper: tempers[U.hashStr(id) % tempers.length], emblem: G.blankEmblem(U.hashStr(id) * 7 + 3), strength: 0, rel: {}, cells: [], res: 200, fragments: 0 });
      const live = camps.filter(c => !c.cleared);
      r.camps = camps.map(c => c.id); r.liveCamps = live.length;
      r.strength = Math.max(r.strength || 0, live.reduce((a, c) => a + c.crew + 2, 0) * 2);
      const big = live.slice().sort((a, b) => b.crew - a.crew)[0] || camps[0]; r.leader = r.leader || big.boss; r.home = big.cell;
      for (const c of live) { const cs = R.cellState(c.cell); if (!cs.owner) { cs.owner = id; cs.hold = 60; } }
      r.cells = R.owned(id);
    }
  };
  R.rel = (r, gid) => r.rel[gid] || (r.rel[gid] = { hostility: 20, respect: 0, fear: 0, stance: 'wary', truceUntil: 0 });
  R.stanceOf = (rel, day) => rel.truceUntil > day ? 'truce' : rel.hostility >= 75 ? 'war' : rel.hostility >= 50 ? 'hostile' : rel.hostility >= 25 ? 'wary' : rel.respect >= 40 ? 'respect' : 'neutral';
  ctx.pickRival = (g, rnd = Math.random) => { const list = Object.values(db.world.rivals).filter(r => r.liveCamps > 0); if (!list.length) return null; if (!g.hq) return list[Math.floor(rnd() * list.length)]; return list.map(r => [r, Math.min(...r.camps.map(id => db.world.camps[id]).filter(Boolean).map(c => U.dist(c.x, c.y, g.hq.x, g.hq.y)))]).sort((a, b) => a[1] - b[1]).slice(0, 4)[Math.floor(rnd() * Math.min(4, list.length))][0]; };

  // a rival's camp falls: its crew was cut down by players (the host saw it). Outposts change hands, rivals react
  R.campCleared = (campId, playerIds) => {
    const c = db.world.camps[campId]; if (!c || c.cleared) return null;
    c.cleared = true; c.clearedDay = db.clock.day;
    const gangs = [...new Set((playerIds || []).map(id => (ctx.player(id) || {}).gangId).filter(Boolean))];
    const r = db.world.rivals[c.rival];
    if (r) { r.liveCamps = Math.max(0, r.liveCamps - 1); r.strength = Math.max(0, r.strength - (c.crew + 2) * 3); }
    for (const gid of gangs) {
      const g = db.gangs[gid]; if (!g) continue;
      G.addRenown(g, 30, 'took ' + c.name + ' from ' + c.rivalName); G.addRep(g, { might: 2, fear: 1, honor: 1 });
      if (r) { const rel = R.rel(r, gid); rel.hostility = Math.min(100, rel.hostility + 18); rel.fear += 6; rel.respect += 3; }
      R.influence(gid, c.cell, 40);
      if (!c.owner) { c.owner = gid; G.log(g, 'The clan holds ' + c.name + ' as an outpost.'); }
      for (const ct of g.contracts) if (ct.state === 'active' && ct.place && ct.place.camp === campId) L.complete(g, ct);
    }
    // the gang's leader camp is gone: the rest surrender, split or swear revenge
    if (r && r.liveCamps === 0) {
      const outcome = ['surrender', 'fragment', 'revenge'][U.hashStr(r.id + db.clock.day) % 3];
      r.fallen = outcome;
      for (const gid of gangs) { const g = db.gangs[gid]; if (!g) continue; G.log(g, r.name + ' are broken: ' + (outcome === 'surrender' ? 'their last men surrendered their land.' : outcome === 'fragment' ? 'the survivors scattered into smaller bands.' : 'the survivors swore revenge on the clan.')); if (outcome === 'surrender') for (const k of R.owned(r.id)) R.transfer(k, gid); }
    } else if (r && r.leader && c.boss === r.leader) {
      r.leader = null; r.strength *= 0.8;
      for (const gid of gangs) { const g = db.gangs[gid]; if (g) G.log(g, 'The leader of ' + r.name + ' fell at ' + c.name + '. A successor will be chosen.'); }
    }
    ctx.broadcast({ t: 'campState', id: campId, cleared: true, owner: c.owner });
    ctx.touch();
    return c;
  };
  ctx.campTaken = (g, campId) => { const c = db.world.camps[campId]; if (c && !c.cleared) R.campCleared(campId, g.members.filter(id => ctx.online(id)).slice(0, 1).concat(g.leader)); };

  // ---- land
  R.influence = (id, k, n) => {
    if (!k) return;
    const cs = R.cellState(k); cs.inf[id] = Math.min(400, (cs.inf[id] || 0) + n);
    if (cs.owner === id) { cs.hold = Math.min(100, cs.hold + n * 0.5); return; }
    const own = cs.owner ? (cs.inf[cs.owner] || 0) + cs.hold : 0;
    if (cs.inf[id] >= 100 && cs.inf[id] > own) R.transfer(k, id);
  };
  R.transfer = (k, id) => {
    const cs = R.cellState(k), was = cs.owner, info = R.cellInfo(k);
    cs.owner = id; cs.hold = 50; cs.contest = null; cs.since = db.clock.day;
    const name = (info && info.prov) ? info.prov + ' (' + k + ')' : k;
    const gNew = db.gangs[id], gOld = db.gangs[was];
    if (gNew) { if (!gNew.claims.includes(k)) gNew.claims.push(k); G.log(gNew, 'The clan now holds the district ' + name + '.'); G.addRenown(gNew, 25, 'won ' + name); G.bump(gNew); }
    if (gOld) { gOld.claims = gOld.claims.filter(x => x !== k); G.log(gOld, 'The clan lost the district ' + name + '.'); G.bump(gOld); }
    const rOld = db.world.rivals[was]; if (rOld) rOld.cells = R.owned(rOld.id);
    const rNew = db.world.rivals[id]; if (rNew) rNew.cells = R.owned(rNew.id);
    ctx.broadcast({ t: 'territory', k, owner: id, was });
    ctx.touch();
  };
  R.adjacent = (g, k) => {
    const mine = new Set(g.claims || []); if (g.hq) mine.add(R.cellKey(g.hq.x, g.hq.y));
    return mine.has(k) || R.neighbours(k).some(n => mine.has(n));
  };
  R.claimLimit = (g) => G.stage(g).claims + G.fx(g).claims;
  R.claim = (g, pid, k) => {
    if (!G.can(g, pid, 'territory')) return 'Your rank may not claim land.';
    if (!g.hq) return 'Settle somewhere first.';
    const info = R.cellInfo(k); if (!info) return 'There is no land there to claim.';
    const cs = R.cellState(k);
    if (cs.owner === g.id) return 'The clan already holds it.';
    if (cs.owner) return 'It is held by ' + R.ownerName(cs.owner) + '. Contest it instead.';
    if (!R.adjacent(g, k)) return 'Land must border what the clan already holds.';
    if ((g.claims || []).length >= R.claimLimit(g)) return 'The clan cannot hold more land yet (' + R.claimLimit(g) + ' districts at this stage).';
    if ((g.claims || []).length >= 1 && g.members.length + L.alive(g).length < 3) return 'Holding more land needs at least three people in the clan (players or NPCs).';
    const cost = { mon: 100 * ((g.claims || []).length + 1), food: 20 };
    if (!G.can(g, pid, 'spend')) return 'Claiming spends clan resources, and your rank may not spend them.';
    if (!G.pay(g, cost)) return 'Claiming costs ' + G.costText(cost) + ' (' + G.short(g, cost) + ' short).';
    cs.inf[g.id] = (cs.inf[g.id] || 0) + 60; R.transfer(k, g.id); G.addRep(g, { influence: 1 });
    return null;
  };
  R.contest = (g, pid, k) => {
    if (!G.can(g, pid, 'war')) return 'Your rank may not start a fight over land.';
    const cs = R.cellState(k); if (!cs.owner || cs.owner === g.id) return 'Nobody to contest it from.';
    if (!R.adjacent(g, k)) return 'You can only contest land that borders your own.';
    if (cs.contest && cs.contest.by === g.id) return 'The clan is already fighting for it.';
    cs.contest = { by: g.id, since: db.clock.day };
    const r = db.world.rivals[cs.owner]; if (r) { const rel = R.rel(r, g.id); rel.hostility = Math.min(100, rel.hostility + 15); }
    const o = db.gangs[cs.owner]; if (o) { G.log(o, g.name + ' is contesting the district ' + k + '.'); ctx.toGang(o, { t: 'toast', msg: g.name + ' is contesting your land (' + k + ').', kind: 'shame' }); }
    G.log(g, 'The clan is contesting ' + k + ' (held by ' + R.ownerName(cs.owner) + '). Win influence there: fight their people, take their outposts, do work in the district.');
    G.bump(g); ctx.touch();
    return null;
  };
  R.abandon = (g, pid, k) => {
    if (!G.can(g, pid, 'territory')) return 'Your rank may not give up land.';
    const cs = R.cellState(k); if (cs.owner !== g.id) return 'The clan does not hold it.';
    cs.owner = null; cs.hold = 0; g.claims = g.claims.filter(x => x !== k); G.log(g, 'The clan gave up ' + k + '.'); G.bump(g);
    ctx.broadcast({ t: 'territory', k, owner: null, was: g.id });
    return null;
  };
  R.ownerName = (id) => (db.gangs[id] && db.gangs[id].name) || (db.world.rivals[id] && db.world.rivals[id].name) || 'nobody';
  R.publicTerritory = () => {
    const out = {}; for (const [k, c] of Object.entries(db.world.cells)) if (c.owner || c.contest) out[k] = { owner: c.owner, hold: Math.round(c.hold), contest: c.contest ? c.contest.by : null, inf: Object.fromEntries(Object.entries(c.inf).filter(([, v]) => v >= 5).map(([id, v]) => [id, Math.round(v)])) };
    return out;
  };
  R.publicRivals = () => Object.values(db.world.rivals).map(r => ({ id: r.id, name: r.name, temper: r.temper, emblem: r.emblem, strength: Math.round(r.strength), liveCamps: r.liveCamps, cells: (r.cells || []).length, leader: r.leader, fallen: r.fallen || null, rel: r.rel }));

  // ---- diplomacy with a rival
  R.diplomacy = (g, pid, rid, action, fromEnvoy) => {
    if (!fromEnvoy && !G.can(g, pid, 'diplomacy')) return 'Your rank may not treat with other clans.';
    const r = db.world.rivals[rid]; if (!r) return 'No such gang.';
    const rel = R.rel(r, g.id), T = C.TEMPERS[r.temper] || C.TEMPERS.greedy, day = db.clock.day;
    const sway = (G.stage(g).n * 8 + g.rep.might * 0.6 + g.rep.fear * 0.8 + g.rep.influence * 0.8 + rel.respect * 0.5 - rel.hostility * 0.4) * T.talk + (fromEnvoy ? 30 : 0);
    if (action === 'truce') { if (sway < 10) { rel.hostility += 5; return r.name + ' laugh at the offer.'; } rel.truceUntil = day + 5; rel.hostility = Math.max(0, rel.hostility - 20); G.log(g, 'Truce with ' + r.name + ' for five days.'); }
    else if (action === 'tribute') { const fee = { mon: 150 + G.stage(g).n * 60 }; if (!G.pay(g, fee)) return 'Tribute costs ' + fee.mon + ' mon.'; rel.truceUntil = day + 7; rel.hostility = Math.max(0, rel.hostility - 30); G.addRep(g, { fear: -1, generosity: 0.5 }); G.log(g, 'Paid ' + r.name + ' to keep away for a week.'); }
    else if (action === 'trade') { if (sway < 25 || rel.hostility > 50) return r.name + ' will not trade with you.'; rel.trade = true; rel.respect += 5; G.log(g, 'Trade agreed with ' + r.name + ' (mon every day while it lasts).'); }
    else if (action === 'ally') { if (sway < 60 || rel.hostility > 25) return r.name + ' are not ready to stand with you.'; rel.allied = true; rel.respect += 10; rel.truceUntil = day + 30; G.log(g, 'Alliance with ' + r.name + '.'); }
    else if (action === 'war') { rel.hostility = Math.max(rel.hostility, 80); rel.truceUntil = 0; rel.trade = false; rel.allied = false; G.addRep(g, { fear: 1 }); G.log(g, 'The clan declared war on ' + r.name + '.'); }
    else if (action === 'insult') { rel.hostility = Math.min(100, rel.hostility + 20); rel.respect -= 5; G.addRep(g, { fear: 0.5, honor: -0.5 }); G.log(g, 'The clan insulted ' + r.name + '.'); }
    else return 'Unknown proposal.';
    rel.stance = R.stanceOf(rel, day);
    G.bump(g); ctx.touch();
    return null;
  };
  ctx.diplomacy = R.diplomacy;

  // ---- raids
  R.scheduleRaid = (g, r, size) => {
    const at = db.clock.day + db.clock.tod + 0.15 + Math.random() * 0.4;
    const raid = { id: 'raid' + U.nid(3), rival: r.id, rivalName: r.name, size: Math.round(size), at, seen: G.fx(g).intel >= 4, done: false, live: false };
    g.raids.push(raid); if (g.raids.length > 10) g.raids.splice(0, g.raids.length - 10);
    if (raid.seen) { G.log(g, 'Scouts warn: ' + r.name + ' are gathering to raid the compound (' + raid.size + ' fighters).'); ctx.toGang(g, { t: 'raidWarn', raid }); }
    G.bump(g);
  };
  R.raidDue = (g) => {
    const now = db.clock.day + db.clock.tod;
    for (const raid of g.raids) {
      if (raid.done || raid.live || raid.at > now) continue;
      const near = g.members.filter(id => ctx.online(id) && g.hq && U.dist((ctx.player(id) || {}).x || 0, (ctx.player(id) || {}).y || 0, g.hq.x, g.hq.y) < 120);
      if (near.length && ctx.hostOnline()) { raid.live = true; raid.liveAt = U.now(); ctx.startRaid(g, raid); G.log(g, raid.rivalName + ' are attacking the compound!'); }
      else R.resolveRaid(g, raid, null);
    }
    for (const raid of g.raids) if (raid.live && !raid.done && U.now() - raid.liveAt > 6 * 60 * 1000) R.resolveRaid(g, raid, null);
  };
  // a raid nobody was home for (or one the fight never finished): defence against numbers
  R.resolveRaid = (g, raid, outcome, kills = 0) => {
    if (raid.done) return;
    raid.done = true; raid.live = false;
    const f = G.fx(g), W = C.WALLS[g.wall.stage] || C.WALLS[0];
    const guards = L.alive(g).filter(n => C.ROLES[n.role] && C.ROLES[n.role].fight && !n.injuredUntil && n.assign.job !== 'follow');
    const def = f.def + W.hold + guards.reduce((a, n) => a + 3 + n.skill * 8 + n.level, 0);
    const att = raid.size * 6 * (1 + Math.random() * 0.5);
    const won = outcome ? outcome === 'repelled' : def >= att;
    const r = db.world.rivals[raid.rival];
    if (won) {
      G.addRenown(g, 12 + raid.size * 2, 'repelled a raid by ' + raid.rivalName); G.addRep(g, { might: 1.5, fear: 0.5 });
      if (r) { r.strength = Math.max(0, r.strength - raid.size * 2 - kills); const rel = R.rel(r, g.id); rel.respect += 4; rel.fear += 3; }
      G.log(g, 'The compound held against ' + raid.rivalName + (outcome ? '.' : ' (nobody was home; the walls and guards held).'));
    } else {
      const lost = {}; for (const k of ['food', 'timber', 'stone', 'iron', 'cloth', 'herbs']) { const n = Math.floor((g.res[k] || 0) * (0.1 + Math.random() * 0.15)); if (n) { lost[k] = n; g.res[k] -= n; } }
      const m = Math.floor(g.res.mon * 0.08); if (m) { lost.mon = m; g.res.mon -= m; }
      for (const n of L.alive(g)) n.morale = Math.max(0, n.morale - 8);
      const hit = g.structs.filter(s => s.state === 'done' && s.kind !== 'hearth');
      if (hit.length) { const s = hit[Math.floor(Math.random() * hit.length)]; s.damaged = true; G.log(g, (C.BUILD[s.kind] || {}).name + ' was damaged in the raid. Repair it to use it again.'); }
      if (r) r.res += (lost.mon || 0);
      G.log(g, raid.rivalName + ' broke in and carried off ' + (G.costText(lost) || 'nothing much') + '.');
    }
    ctx.toGang(g, { t: 'raidEnd', id: raid.id, won, rival: raid.rivalName });
    G.bump(g);
  };
  R.repair = (g, pid, sid) => {
    if (!G.can(g, pid, 'build')) return 'Your rank may not build.';
    const s = g.structs.find(x => x.id === sid); if (!s || !s.damaged) return 'Nothing to repair.';
    const def = C.BUILD[s.kind], cost = {}; for (const [k, v] of Object.entries(def.tiers[s.tier - 1].cost)) cost[k] = Math.ceil(v * 0.25 * (G.fx(g).repair ? 0.6 : 1));
    if (!G.pay(g, cost)) return 'Repairs cost ' + G.costText(cost) + '.';
    s.damaged = false; G.log(g, def.name + ' was repaired.'); G.bump(g);
    return null;
  };

  // ---- the hour: buildings finish, people train, visitors knock, members out on the land strengthen the clan's hold
  R.hourTurn = () => {
    for (const g of Object.values(db.gangs)) {
      if (!g || !g.members.length) continue;
      B.tick(g); L.hour(g); L.hourVisitors(g); R.raidDue(g);
      for (const id of g.members) {
        if (!ctx.online(id)) continue;
        const p = ctx.player(id), k = R.cellKey(p.x || 0, p.y || 0), cs = db.world.cells[k];
        if (cs && cs.owner === g.id) cs.hold = Math.min(100, cs.hold + 4);
        else if (cs && cs.contest && cs.contest.by === g.id) R.influence(g.id, k, 3);
      }
    }
    ctx.hourly();
  };
  // ---- the day: production, trade, upkeep, land income and decay, rivals' decisions, who leads whom
  R.dayTurn = () => {
    for (const g of Object.values(db.gangs)) {
      if (!g || !g.members.length) continue;
      const f = G.fx(g), prod = Object.assign({}, f.prod);
      // clan NPCs at work: farmers farm, smiths smelt; their skill decides how much
      for (const n of L.alive(g)) { const role = C.ROLES[n.role]; if (role && role.work && n.assign.job === 'work' && !n.injuredUntil) { const k = role.work, amt = 2 + n.skill * 4 + n.level * 0.3; prod[k] = (prod[k] || 0) + amt * (n.traits.includes('lazy') ? 0.6 : 1); } }
      // land: every district the clan holds gives what its ground gives, if the clan's grip on it is firm
      let landMon = 0;
      for (const k of g.claims || []) {
        const info = R.cellInfo(k), cs = R.cellState(k); if (!info) continue;
        const grip = cs.hold / 100;
        prod.timber = (prod.timber || 0) + info.forest * 8 * grip; prod.stone = (prod.stone || 0) + info.mtn * 7 * grip; prod.iron = (prod.iron || 0) + info.mtn * 2 * grip;
        prod.food = (prod.food || 0) + (1 - info.mtn) * info.land * 6 * grip + (info.coast ? 3 : 0) * grip;
        landMon += (info.towns * 12 + (info.coast ? 4 : 0)) * grip;
        cs.hold = Math.max(0, cs.hold - (G.fx(g).post > 0 ? 3 : 6));
      }
      const outposts = Object.values(db.world.camps).filter(c => c.owner === g.id).length;
      const upkeep = (g.claims || []).length * 6 + Math.max(0, g.structs.length - 12) * 0.5;
      const interest = Math.min(400, g.res.mon * f.interest);
      let trade = f.trade + landMon + outposts * 10 + interest;
      for (const r of Object.values(db.world.rivals)) if (r.rel[g.id] && r.rel[g.id].trade) trade += 12;
      G.gain(g, prod); G.gain(g, { mon: trade - upkeep });
      if (f.bandage) { /* bandages are taken from the garden by members who sleep in the compound (client) */ }
      L.day(g); L.dayContracts(g);
      G.addRep(g, { honor: (f.honor || 0) * 0.2, wealth: g.res.mon > 2000 ? 0.3 : 0 });
      G.checkSuccession(g);
      G.bump(g);
    }
    R.rivalTurn();
    ctx.daily();
  };
  R.rivalTurn = () => {
    const day = db.clock.day;
    for (const r of Object.values(db.world.rivals)) {
      if (!r.liveCamps) continue;
      const T = C.TEMPERS[r.temper] || C.TEMPERS.greedy;
      r.strength = Math.min(r.liveCamps * 30, r.strength + r.liveCamps * 1.5);
      // spread into empty land next to theirs
      if (Math.random() < 0.12 * T.expand) {
        const free = [...new Set((r.cells || []).flatMap(k => R.neighbours(k)))].filter(k => R.cellInfo(k) && !R.cellState(k).owner);
        if (free.length) { const k = free[Math.floor(Math.random() * free.length)]; R.cellState(k).inf[r.id] = 100; R.transfer(k, r.id); }
      }
      for (const g of Object.values(db.gangs)) {
        if (!g || !g.hq || !g.members.length) continue;
        const rel = R.rel(r, g.id);
        rel.hostility = U.clamp(rel.hostility + (g.rep.fear > 20 ? -0.5 : 0) + (rel.trade ? -1 : 0.3) - (rel.allied ? 2 : 0), 0, 100);
        rel.stance = R.stanceOf(rel, day);
        const near = (r.camps || []).map(id => db.world.camps[id]).filter(c => c && !c.cleared).some(c => U.dist(c.x, c.y, g.hq.x, g.hq.y) < 700);
        const st = G.stage(g).n;
        // new clans are left alone; small ones only see small raids
        if (near && st >= 1 && (rel.stance === 'war' || rel.stance === 'hostile') && !g.raids.some(x => !x.done)) {
          const trait = (g.hq.traits || []).reduce((a, t) => a * ((C.TRAITS_HQ[t] || {}).raid || 1), 1);
          if (Math.random() < 0.06 * T.raid * (rel.hostility / 50) * trait) R.scheduleRaid(g, r, Math.min(3 + st * 2, 3 + r.strength / 12));
        }
        // neglected land on their border: they push in
        for (const k of g.claims || []) { const cs = R.cellState(k); if (cs.hold < 35 && (r.cells || []).some(c => R.neighbours(c).includes(k)) && rel.stance !== 'truce' && !rel.allied && Math.random() < 0.3 * T.expand) { R.influence(r.id, k, 20); if (cs.owner === g.id) G.log(g, r.name + ' are pushing into the neglected district ' + k + '. Patrol it or lose it.'); } }
        // an offer to talk, if they are inclined to
        if (rel.hostility < 40 && Math.random() < 0.04 * T.talk && !g.visitors.some(v => v.kind === 'diplomacy')) L.visit(g, 'envoy');
      }
      // contested land they hold slips if nobody defends it
      for (const k of r.cells || []) { const cs = R.cellState(k); cs.hold = Math.min(100, cs.hold + 2 * (T.def || 1)); }
    }
    ctx.touch();
  };

  return R;
}

module.exports = { createRealm, DAY_LEN, HOUR_LEN, CELL };
