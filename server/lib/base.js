'use strict';
// Headquarters: where a clan settles, the ground it may build on, and every structure on it. The client draws the
// preview and checks the terrain (it holds the world); the server checks everything that two players could disagree
// about: who may build, what it costs, what is already standing there, and how far the clan's ground reaches.
const C = require('./catalog');
const U = require('./util');

// the five hand-cleared camp slots of the first Gang world stay as sites (old camps keep their ground)
const LEGACY_SITES = [
  { id: 'kusamura', name: 'Kusamura Ridge', x: 108, y: 128, traits: ['plains', 'road', 'town'], legacy: true },
  { id: 'hanaori', name: 'Hanaori Fold', x: 56, y: 162, traits: ['forest', 'sacred'], legacy: true },
  { id: 'isonami', name: 'Isonami Backshore', x: 126, y: 162, traits: ['coast', 'road'], legacy: true },
  { id: 'yukimura', name: 'Yukimura Gatefield', x: 78, y: 78, traits: ['mountain', 'snow'], legacy: true },
  { id: 'hanamachi', name: 'Hanamachi South Pasture', x: 154, y: 70, traits: ['plains', 'town', 'road'], legacy: true }
];
const HQ_SPACING = 110;
const ROOF_MATS = ['kawara', 'kawaraD', 'kawaraR', 'thatch', 'thatchO', 'bark', 'copper', 'board'];
const ROOF_TYPES = ['irimoya', 'gable', 'hip'];
const LOWERS = ['board', 'lattice', 'namako', 'bengara'];
const WINS = ['renji', 'shoji', 'mushiko', 'castle', 'none'];
const RIDGES = ['oni', 'gold', 'thatch', 'chigi', 'plain'];

function createBase(ctx, G) {
  const { db } = ctx;
  const B = {};

  B.sites = () => {
    const info = db.world.info, list = LEGACY_SITES.slice();
    if (info && Array.isArray(info.sites)) for (const s of info.sites) if (!list.some(x => x.id === s.id)) list.push(s);
    return list;
  };
  B.site = (id) => B.sites().find(s => s.id === id) || null;
  B.takenBy = (siteId) => Object.values(db.gangs).find(g => g.hq && g.hq.site === siteId) || null;

  // the clan's ground: a rectangle round its centre that grows with the clan
  B.bounds = (g) => {
    if (!g.hq) return null;
    const st = G.stage(g), t = g.hq.traits || [];
    let [w, h] = st.bound;
    if (t.includes('plains')) { w += 6; h += 4; }
    if (g.hq.minBound) { w = Math.max(w, g.hq.minBound[0]); h = Math.max(h, g.hq.minBound[1]); }
    w += Math.min(16, (g.claims || []).length * 2); h += Math.min(12, (g.claims || []).length * 2);
    const r = { x0: Math.round(g.hq.x - w / 2), y0: Math.round(g.hq.y - h / 2), x1: Math.round(g.hq.x + w / 2), y1: Math.round(g.hq.y + h / 2) };
    // a neighbour close by (the old camp slots sit near each other): the ground stops at the line halfway between
    for (const o of Object.values(db.gangs)) {
      if (o === g || !o.hq) continue;
      const dx = o.hq.x - g.hq.x, dy = o.hq.y - g.hq.y;
      if (Math.abs(dx) > w + 20 && Math.abs(dy) > h + 20) continue;
      if (Math.abs(dx) >= Math.abs(dy)) { if (dx > 0) r.x1 = Math.min(r.x1, Math.round(g.hq.x + dx / 2 - 1)); else r.x0 = Math.max(r.x0, Math.round(g.hq.x + dx / 2 + 1)); }
      else { if (dy > 0) r.y1 = Math.min(r.y1, Math.round(g.hq.y + dy / 2 - 1)); else r.y0 = Math.max(r.y0, Math.round(g.hq.y + dy / 2 + 1)); }
    }
    return Object.assign(r, { w: r.x1 - r.x0, h: r.y1 - r.y0, gate: [Math.round(g.hq.x), r.y1] });
  };
  B.footprint = (def, rot) => (rot % 2 && def.rot !== false) ? [def.h, def.w] : [def.w, def.h];
  // where a footprint may not go: off the clan's ground, onto the wall line, into the gate's way, onto another structure
  B.fits = (g, def, x, y, w, h, skip) => {
    const b = B.bounds(g); if (!b) return 'Choose where the clan settles first.';
    if (x < b.x0 + 1 || y < b.y0 + 1 || x + w > b.x1 - 1 || y + h > b.y1 - 1) return 'Outside the clan’s ground. Grow the clan or claim land to build further out.';
    const [gx, gy] = b.gate;
    if (x < gx + 2 && x + w > gx - 2 && y + h > gy - 5) return 'Keep the way in from the gate clear.';
    const gap = def.vis && def.vis.b ? 1 : 0;
    for (const s of g.structs) {
      if (s === skip) continue;
      const sd = C.BUILD[s.kind] || {}, sg = Math.max(gap, sd.vis && sd.vis.b ? 1 : 0);
      if (x < s.x + s.w + sg && x + w + sg > s.x && y < s.y + s.h + sg && y + h + sg > s.y) return 'Something already stands there (' + (sd.name || s.kind) + ').';
    }
    return null;
  };

  // ---- choosing a home. The first is free; moving later takes the whole compound down
  B.placeHQ = (g, pid, siteId, m = {}) => {
    if (G.rankOf(g, pid) !== C.RANK_LEADER && !G.can(g, pid, 'territory')) return 'Only the leader (or those trusted with land) chooses where the clan settles.';
    const s = B.site(siteId); if (!s) return 'That place is not one the clan can settle.';
    const other = B.takenBy(siteId); if (other && other !== g) return other.name + ' already holds that ground.';
    // (the five old camp slots were laid out together and may all be held at once; anywhere else keeps its distance)
    for (const o of Object.values(db.gangs)) if (o !== g && o.hq && !(s.legacy && B.site(o.hq.site) && B.site(o.hq.site).legacy) && U.dist(o.hq.x, o.hq.y, s.x, s.y) < HQ_SPACING) return 'Too close to ' + o.name + '’s compound.';
    if (g.hq) {
      if (g.hq.site === siteId) return 'The clan already lives here.';
      if (!m.confirm) return 'Moving the clan takes down everything it built here. Confirm to move.';
      const fee = { mon: 300 };
      if (!G.pay(g, fee)) return 'Moving costs ' + G.costText(fee) + '.';
      for (const st of g.structs) { const def = C.BUILD[st.kind]; if (def) G.gain(g, B.refundOf(def, st.tier), 0.5); }
      g.structs = [];
      G.log(g, 'The clan packed up and left ' + g.hq.name + '.');
    }
    g.hq = { site: s.id, name: s.name, x: s.x, y: s.y, traits: (s.traits || []).filter(t => C.TRAITS_HQ[t]).slice(0, 4), cell: s.cell || null, prov: s.prov || '', placedAt: U.now() };
    const ruins = g.hq.traits.includes('ruins');
    g.wall = { stage: ruins ? 4 : 1, gate: 1 };
    B.starter(g);
    G.addRenown(g, 10, 'settled at ' + s.name);
    G.log(g, 'The clan settled at ' + s.name + '.');
    G.bump(g);
    return null;
  };
  // the first camp: a fire, one shelter, a barricade and a gate. Everything else is earned
  B.starter = (g) => {
    const cx = Math.round(g.hq.x), cy = Math.round(g.hq.y);
    B.put(g, 'hearth', cx - 4, cy - 4, 0, 1, true);
    B.put(g, 'shelter', cx - 12, cy - 8, 0, 1, true);
    B.put(g, 'banner', cx + 5, cy + 4, 0, 1, true);
  };
  B.put = (g, kind, x, y, rot, tier, done) => {
    const def = C.BUILD[kind]; const [w, h] = B.footprint(def, rot);
    const s = { id: 's' + (++db.seq.struct), kind, x: Math.round(x), y: Math.round(y), w, h, rot: rot | 0, tier: tier || 1, state: done ? 'done' : 'building', startAt: U.now(), doneAt: done ? U.now() : U.now() + 1000, style: null, by: null, spent: [] };
    if (kind === 'banner') s.banner = (g.banners[0] || {}).id || 'b1';
    g.structs.push(s);
    return s;
  };
  B.refundOf = (def, tier) => { const out = {}; for (let i = 0; i < Math.min(tier, def.tiers.length); i++) for (const [k, v] of Object.entries(def.tiers[i].cost)) out[k] = (out[k] || 0) + v; return out; };
  B.buildTime = (g, def, tier) => Math.round(def.tiers[tier - 1].time * 1000 * Math.max(0.35, 1 - G.fx(g).buildSpeed));

  B.build = (g, pid, m) => {
    if (!G.can(g, pid, 'build')) return 'Your rank may not build.';
    const def = C.BUILD[m.kind]; if (!def) return 'Nothing by that name can be built.';
    if (!g.hq) return 'Choose where the clan settles first.';
    const st = G.stage(g);
    if ((def.stage || 0) > st.n) return def.name + ' needs a ' + C.STAGES[def.stage].name + '.';
    if (g.structs.filter(s => s.kind === def.key).length >= def.max) return 'The clan already has as many of these as it can keep (' + def.max + ').';
    const rot = U.int(m.rot, 0, 3, 0), [w, h] = B.footprint(def, rot), x = U.int(m.x, -9999, 9999, 0), y = U.int(m.y, -9999, 9999, 0);
    const bad = B.fits(g, def, x, y, w, h); if (bad) return bad;
    if (m.terrainOk === false) return 'The ground there will not take it (' + (m.terrainWhy || 'water or rock') + ').';
    const cost = def.tiers[0].cost;
    if (!G.can(g, pid, 'spend') && cost.mon > 0) return 'Building spends clan resources, and your rank may not spend them.';
    if (!G.pay(g, cost)) return 'Not enough: ' + G.short(g, cost) + ' short.';
    const s = B.put(g, def.key, x, y, rot, 1, true);
    s.by = pid; s.style = B.cleanStyle(m.style);
    G.addRenown(g, 2 + (def.stage || 0) * 2, null);
    G.log(g, (ctx.player(pid) || {}).name + ' built ' + def.name + '.');
    G.bump(g);
    return null;
  };
  B.find = (g, sid) => g.structs.find(s => s.id === sid) || null;
  B.upgrade = (g, pid, sid) => {
    if (!G.can(g, pid, 'build')) return 'Your rank may not build.';
    const s = B.find(g, sid); if (!s) return 'That is no longer standing.';
    const def = C.BUILD[s.kind];
    if (s.state !== 'done') return 'Finish building it first.';
    if (s.tier >= def.tiers.length) return def.name + ' cannot be improved further.';
    if (s.tier + 1 > G.stage(g).tier + (def.tiers.length > 3 ? 1 : 0)) return 'The clan must grow before it can build this well (' + C.STAGES.find(x => x.tier >= s.tier + 1).name + ').';
    const cost = def.tiers[s.tier].cost;
    if (!G.can(g, pid, 'spend')) return 'Upgrading spends clan resources, and your rank may not spend them.';
    if (!G.pay(g, cost)) return 'Not enough: ' + G.short(g, cost) + ' short.';
    s.tier++; s.state = 'done'; s.by = pid;
    G.addRenown(g, 3 * s.tier, null);
    G.log(g, (ctx.player(pid) || {}).name + ' improved ' + def.name + ' (tier ' + s.tier + ').');
    G.bump(g);
    return null;
  };
  B.demolish = (g, pid, sid, confirm) => {
    if (!G.can(g, pid, 'demolish')) return 'Your rank may not tear things down.';
    const s = B.find(g, sid); if (!s) return 'That is no longer standing.';
    const def = C.BUILD[s.kind], spent = B.refundOf(def, s.tier);
    if (!confirm && (s.tier >= 2 || (spent.mon || 0) >= 300)) return 'confirm:Tear down ' + def.name + '? Half of what it cost comes back.';
    if (s.kind === 'hearth' && g.structs.filter(x => x.kind === 'hearth').length <= 1) return 'The camp needs its fire.';
    g.structs = g.structs.filter(x => x !== s);
    G.gain(g, spent, s.state === 'done' ? 0.5 : 0.8);
    G.log(g, (ctx.player(pid) || {}).name + ' tore down ' + def.name + '.');
    G.bump(g);
    return null;
  };
  B.move = (g, pid, sid, m) => {
    if (!G.can(g, pid, 'build')) return 'Your rank may not move buildings.';
    const s = B.find(g, sid); if (!s) return 'That is no longer standing.';
    const def = C.BUILD[s.kind], rot = U.int(m.rot, 0, 3, s.rot), [w, h] = B.footprint(def, rot), x = U.int(m.x, -9999, 9999, s.x), y = U.int(m.y, -9999, 9999, s.y);
    const bad = B.fits(g, def, x, y, w, h, s); if (bad) return bad;
    if (m.terrainOk === false) return 'The ground there will not take it.';
    const fee = { mon: def.vis.b ? Math.round((def.tiers[0].cost.mon || 0) * 0.15) : 0 };
    if (fee.mon && !G.pay(g, fee)) return 'Moving it costs ' + fee.mon + ' mon.';
    Object.assign(s, { x, y, w, h, rot });
    G.bump(g);
    return null;
  };
  B.cleanStyle = (st) => {
    if (!st || typeof st !== 'object') return null;
    const o = {};
    if (ROOF_MATS.includes(st.roof)) o.roof = st.roof;
    if (ROOF_TYPES.includes(st.roofType)) o.roofType = st.roofType;
    if (LOWERS.includes(st.lower)) o.lower = st.lower;
    if (WINS.includes(st.win)) o.win = st.win;
    if (RIDGES.includes(st.ridge)) o.ridge = st.ridge;
    for (const k of ['plaster', 'posts', 'wood', 'noren', 'trim']) if (U.HEX.test(String(st[k] || ''))) o[k] = st[k].toLowerCase();
    if (st.veranda !== undefined) o.veranda = U.bool(st.veranda);
    if (st.preset) o.preset = U.pickOne(st.preset, ['minimal', 'traditional', 'military', 'stealth', 'luxury', 'natural', 'intimidating', 'ceremonial', 'fortified'], undefined);
    return Object.keys(o).length ? o : null;
  };
  B.restyle = (g, pid, sid, style, banner) => {
    if (!G.can(g, pid, 'build')) return 'Your rank may not change the buildings.';
    const s = B.find(g, sid); if (!s) return 'That is no longer standing.';
    if (banner !== undefined) { if (!g.banners.some(b => b.id === banner)) return 'No banner by that name.'; s.banner = banner; }
    if (style !== undefined) s.style = B.cleanStyle(style);
    G.bump(g);
    return null;
  };
  // the same style for every building at once (a whole compound in one look)
  B.restyleAll = (g, pid, style) => {
    if (!G.can(g, pid, 'build')) return 'Your rank may not change the buildings.';
    const st = B.cleanStyle(style);
    for (const s of g.structs) if (C.BUILD[s.kind] && C.BUILD[s.kind].vis.b) s.style = st;
    G.bump(g);
    return null;
  };
  B.wallUp = (g, pid) => {
    if (!G.can(g, pid, 'build')) return 'Your rank may not build.';
    if (!g.hq) return 'Choose where the clan settles first.';
    const next = C.WALLS[g.wall.stage + 1]; if (!next) return 'The walls are as strong as walls get.';
    if ((next.stage || 0) > G.stage(g).n) return next.name + ' needs a ' + C.STAGES[next.stage].name + '.';
    if (!G.can(g, pid, 'spend')) return 'Your rank may not spend clan resources.';
    if (!G.pay(g, next.cost)) return 'Not enough: ' + G.short(g, next.cost) + ' short.';
    g.wall.stage++; g.wall.builtAt = U.now();
    G.addRenown(g, 4 + g.wall.stage * 2, null);
    G.log(g, (ctx.player(pid) || {}).name + ' raised the walls: ' + next.name + '.');
    G.bump(g);
    return null;
  };
  B.gateUp = (g, pid) => {
    if (!G.can(g, pid, 'build')) return 'Your rank may not build.';
    const next = C.GATES[g.wall.gate + 1]; if (!next) return 'The gate is as strong as it gets.';
    const cost = g.wall.gate === 0 ? { mon: 60, timber: 20 } : { mon: 400, timber: 60, stone: 60, iron: 10 };
    if (!G.can(g, pid, 'spend')) return 'Your rank may not spend clan resources.';
    if (!G.pay(g, cost)) return 'Not enough: ' + G.short(g, cost) + ' short.';
    g.wall.gate++;
    G.log(g, (ctx.player(pid) || {}).name + ' built a ' + next.name.toLowerCase() + '.');
    G.bump(g);
    return null;
  };
  // building timers run on the server's clock: done is done for everybody at the same moment
  B.tick = (g, at = U.now()) => {
    let ch = false;
    for (const s of g.structs) if (s.state === 'building' && s.doneAt <= at) { s.state = 'done'; ch = true; const def = C.BUILD[s.kind]; G.log(g, def.name + (s.tier > 1 ? ' (tier ' + s.tier + ')' : '') + ' is finished.'); ctx.toGang(g, { t: 'toast', msg: def.name + ' is finished.', kind: 'good' }); }
    if (ch) G.bump(g);
    return ch;
  };

  // ---- an old (version 1) camp becomes a headquarters on the same ground, with the same buildings where they stood
  B.migrateV1 = (g) => {
    if (!g.v1) return;
    const s = LEGACY_SITES[g.v1.slot] || LEGACY_SITES[0], cx = s.x, cy = s.y, lv = g.v1.buildings || {};
    g.hq = { site: s.id, name: s.name, x: cx, y: cy, traits: s.traits.slice(), placedAt: U.now(), minBound: [46, 38] };
    const at = { quarters: ['quarters', cx - 19, cy - 16], forge: ['forge', cx - 4, cy - 14], shrine: ['shrine', cx + 7, cy - 12], garden: ['garden', cx + 13, cy - 13], dojo: ['dojo', cx - 17, cy - 3], hearth: ['hearth', cx - 4, cy - 4], kura: ['storehouse', cx + 15, cy - 4], barracks: ['barracks', cx - 16, cy + 9], stables: ['stables', cx - 3, cy + 9] };
    for (const [k, [kind, x, y]] of Object.entries(at)) { const n = lv[k] | 0; if (n > 0 || kind === 'hearth') B.put(g, kind, x, y, 0, Math.max(1, Math.min(3, n)), true); }
    const w = lv.walls | 0; g.wall = { stage: w >= 3 ? 6 : w >= 2 ? 3 : w >= 1 ? 2 : 1, gate: 1 };
    if (g.v1.npc) g.npcs.push(ctx.npcFromLegacy(g.v1.npc));
    delete g.v1;
  };

  return B;
}

module.exports = { createBase, LEGACY_SITES, HQ_SPACING, ROOF_MATS, ROOF_TYPES, LOWERS, WINS, RIDGES };
