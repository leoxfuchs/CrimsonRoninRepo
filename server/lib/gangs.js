'use strict';
// Clans: who belongs, who may do what, and what the clan looks like. Every change is checked here, on the world host:
// a client asks, the server decides, and the answer (or the reason it was refused) goes back to whoever asked.
const C = require('./catalog');
const U = require('./util');

const DAY_MS = 24 * 3600 * 1000;

function createGangs(ctx) {
  const { db } = ctx;
  const G = {};

  // ---- shape of a clan (filled in for clans saved by older versions)
  G.blankEmblem = (seed = 1) => {
    const R = U.RNG(seed), syms = ['tomoe', 'crane', 'wave', 'sakura', 'katana', 'moon', 'flame', 'tiger', 'mountain', 'paulownia', 'hawk', 'tripletomoe'];
    const pal = [['#7a1f1c', '#e8dcc0'], ['#16161c', '#d9c08a'], ['#2a3b5e', '#efe3c8'], ['#3d5a3a', '#e8e0c8'], ['#5a3a6a', '#f0e6d0'], ['#e8dcc0', '#7a1f1c']][Math.floor(R() * 6)];
    return { shape: 'mon', field: pal[0], field2: pal[1], pattern: 'none', patColor: pal[1], patScale: 1, patAngle: 0, patOpacity: 0.35, border: 'thin', borderColor: pal[1], finish: 'painted', layers: [{ sym: syms[Math.floor(R() * syms.length)], color: pal[1], color2: pal[0], x: 0, y: 0, s: 1, r: 0, flip: false, mirror: false, op: 1, kanji: '' }] };
  };
  G.blankPalette = (em) => {
    const p = { primary: em.field, secondary: em.field2, accent: '#c8a040', accent2: '#2c2a30', metal: '#8a8890', cloth: em.field, armor: '#24222a', trim: '#c8a040', banner: em.field, roof: '#3e4757', wall: '#e6dcc4', gate: '#5a3a24', garden: '#3d5a3a' };
    p.ranks = ['#c8a040', '#7a1f1c', '#2a3b5e', '#3d5a3a', '#6e6a60', '#8a8478'];
    p.contexts = {}; for (const c of C.UNIFORM.contexts) p.contexts[c] = { primary: p.primary, secondary: p.secondary, accent: p.accent };
    p.contexts.stealth = { primary: '#16161c', secondary: '#2c2a30', accent: '#4a4a52' };
    p.contexts.war = { primary: p.primary, secondary: '#24222a', accent: '#c8372d' };
    p.contexts.ceremony = { primary: p.secondary, secondary: p.primary, accent: '#e4b54a' };
    p.saved = [];
    return p;
  };
  G.blankUniforms = (pal) => {
    const preset = (id, name, context, o = {}) => Object.assign({ id, name, context, top: { color: pal.primary, pattern: 0 }, bottom: { color: pal.armor }, sash: { color: pal.secondary }, coat: { color: null }, cloak: { color: null }, armor: { tier: 0, color: pal.armor }, hat: { kind: 0, color: null }, mask: false, crest: { on: true, color: pal.secondary, place: 'both' }, wear: 0, dirt: 0 }, o);
    return {
      presets: [
        preset('standard', 'Standard clan uniform', 'everyday'),
        preset('battle', 'Battle armour', 'war', { armor: { tier: 1, color: pal.armor }, hat: { kind: 3, color: null } }),
        preset('scout', 'Scout outfit', 'stealth', { top: { color: '#3d5a3a', pattern: 0 }, bottom: { color: '#2c2a30' }, hat: { kind: 1, color: null }, crest: { on: false, color: pal.secondary, place: 'back' } }),
        preset('ceremony', 'Ceremonial dress', 'ceremony', { coat: { color: pal.secondary }, top: { color: pal.primary, pattern: 2 }, crest: { on: true, color: '#e4b54a', place: 'both' } }),
        preset('officer', 'Officer uniform', 'war', { armor: { tier: 1, color: pal.armor }, coat: { color: pal.primary }, hat: { kind: 4, color: null } }),
        preset('recruit', 'Recruit kit', 'everyday', { top: { color: '#d9ccb0', pattern: 0 }, crest: { on: true, color: pal.primary, place: 'back' } })
      ],
      assign: { ranks: { 0: 'officer', 1: 'officer', 2: 'officer', 3: 'battle', 4: 'standard', 5: 'recruit' }, roles: { scout: 'scout', shinobi: 'scout' }, npcs: {} },
      players: 'free'
    };
  };
  G.blankBanners = (em) => [{ id: 'b1', name: 'Clan standard', shape: 'nobori', size: 'large', fabric: 'silk', pole: 'lacquer', field: em.field, field2: em.field2, layout: 'center', emblem: true, border: 'edge', borderColor: em.field2, tassels: true, fringe: false, wear: 0, damage: 0, wind: 0.6 }];

  G.normalize = (g) => {
    if (!g) return g;
    const seed = U.hashStr(g.id);
    if (!g.name) g.name = 'Nameless band';
    if (g.tag === undefined) g.tag = '';
    for (const k of ['motto', 'desc', 'history', 'founding', 'intro', 'announce']) if (typeof g[k] !== 'string') g[k] = '';
    if (!g.announceAt) g.announceAt = 0;
    if (!Array.isArray(g.members)) g.members = [];
    if (!g.founder) g.founder = g.leader || g.members[0] || null;
    if (!g.leader) g.leader = g.members[0] || null;
    if (!g.ranks || typeof g.ranks !== 'object') g.ranks = {};
    G.migrateRanks(g);
    for (const id of g.members) if (g.ranks[id] === undefined) g.ranks[id] = id === g.leader ? C.RANK_LEADER : C.RANK_MEMBER;
    if (g.leader) g.ranks[g.leader] = C.RANK_LEADER;
    if (!Array.isArray(g.rankTitles) || g.rankTitles.length !== C.RANKS.length) g.rankTitles = C.RANKS.slice();
    if (!g.leaderTitle) g.leaderTitle = 'Oyabun';
    g.perms = Object.assign({}, C.DEFAULT_PERMS, g.perms || {});
    g.recruit = Object.assign({ mode: 'invite', limit: 0, policy: { minSkill: 0, roles: [], maxRecruits: 0, autoReject: false } }, g.recruit || {});
    if (!g.emblem) g.emblem = G.blankEmblem(seed);
    if (!g.palette) g.palette = G.blankPalette(g.emblem);
    if (!g.uniforms) g.uniforms = G.blankUniforms(g.palette);
    if (!Array.isArray(g.banners)) g.banners = G.blankBanners(g.emblem);
    g.res = Object.assign({ mon: 0, timber: 40, stone: 20, iron: 0, food: 30, cloth: 0, herbs: 0 }, g.res || {});
    if (!Array.isArray(g.structs)) g.structs = [];
    if (!Array.isArray(g.npcs)) g.npcs = [];
    if (!Array.isArray(g.visitors)) g.visitors = [];
    if (!Array.isArray(g.contracts)) g.contracts = [];
    if (!Array.isArray(g.log)) g.log = [];
    g.rep = Object.assign({ honor: 0, might: 0, generosity: 0, reliability: 0, wealth: 0, influence: 0, fear: 0 }, g.rep || {});
    if (typeof g.renown !== 'number') g.renown = 0;
    if (!g.rel || typeof g.rel !== 'object') g.rel = {};
    if (g.hq === undefined) g.hq = null;
    if (!g.wall) g.wall = { stage: 0, gate: 0 };
    if (!g.raids) g.raids = [];
    if (!g.claims) g.claims = [];
    if (!g.created) g.created = U.now();
    if (!g.ver) g.ver = 1;
    if (!g.policyOrders) g.policyOrders = { formation: 'loose', defend: 'officer' };
    if (g.dog === undefined) g.dog = null;
    return g;
  };

  G.make = (leaderId, name) => {
    const id = 'g_' + U.nid(4);
    const g = G.normalize({ id, name: G.uniqueName(name || 'Nameless band', null), leader: leaderId, founder: leaderId, members: [leaderId], ranks: { [leaderId]: C.RANK_LEADER } });
    db.gangs[id] = g; ctx.touch();
    G.log(g, 'The clan was founded.');
    return g;
  };
  G.uniqueName = (raw, self) => {
    let base = U.cleanText(raw, 32, 'Nameless band'), n = base, k = 2;
    const taken = nm => Object.values(db.gangs).some(x => x !== self && x && x.name && x.name.toLowerCase() === nm.toLowerCase());
    while (taken(n)) n = base.slice(0, 28) + ' ' + (k++);
    return n;
  };
  G.log = (g, msg) => { g.log.push({ at: U.now(), day: ctx.clock().day, msg: String(msg).slice(0, 200) }); if (g.log.length > 80) g.log.splice(0, g.log.length - 80); };
  G.bump = (g) => { g.ver = (g.ver || 0) + 1; ctx.touch(); };

  // ---- ranks and permissions
  // saved clans used to have Co-leader between Leader and Commander. Drop that seat: co-leaders and commanders both
  // become Commander (rank 1), everyone below shifts up one. Runs once per clan.
  G.migrateRanks = (g) => {
    if (g.ranksVer === 2) return;
    const titles = Array.isArray(g.rankTitles) ? g.rankTitles : [];
    const pal = g.palette && Array.isArray(g.palette.ranks) ? g.palette.ranks : [];
    const assign = g.uniforms && g.uniforms.assign && g.uniforms.assign.ranks;
    const high = Object.values(g.ranks || {}).some(r => (r | 0) > 5);
    const old = titles.length === 7 || pal.length === 7 || high || (assign && assign[6] !== undefined);
    if (old) {
      const down = n => { n = n | 0; return n <= 1 ? n : n - 1; };
      for (const id of Object.keys(g.ranks || {})) g.ranks[id] = down(g.ranks[id]);
      if (g.perms) for (const k of Object.keys(g.perms)) g.perms[k] = down(g.perms[k]);
      if (titles.length === 7) titles.splice(1, 1);
      if (pal.length === 7) pal.splice(1, 1);
      if (assign) {
        const N = {};
        for (const k of Object.keys(assign)) {
          const i = +k; if (i === 1) continue;
          N[i < 2 ? i : i - 1] = assign[k];
        }
        g.uniforms.assign.ranks = N;
      }
    }
    g.ranksVer = 2;
  };
  G.rankOf = (g, pid) => (!g || !g.members.includes(pid)) ? 99 : (g.leader === pid ? C.RANK_LEADER : (g.ranks[pid] ?? C.RANK_MEMBER));
  G.can = (g, pid, perm) => { const r = G.rankOf(g, pid); if (r === 99) return false; if (r === C.RANK_LEADER) return true; const need = g.perms[perm]; return need !== undefined && r <= need; };
  G.stage = (g) => { let s = C.STAGES[0]; for (const st of C.STAGES) if (g.renown >= st.renown) s = st; return s; };
  G.memberCap = (g) => G.stage(g).members;

  // ---- what the clan's buildings add up to (cached on its version)
  G.fx = (g) => {
    if (g._fx && g._fxv === g.ver) return g._fx;
    const f = { beds: 2, heal: 0, hp: 0, st: 0, dmg: 0, train: 0, prod: {}, store: 0, def: 0, appeal: 0, trade: 0, intel: 0, morale: 0, horse: 0, bandage: 0, claims: 0, contracts: 0, interest: 0, npcArmor: 0, npcWpn: 0, buildSpeed: 0, foodUse: 0, repair: 0, npcHeal: 0, honor: 0, might: 0, fear: 0, influence: 0, reliability: 0, wealth: 0, unlock: {}, post: 0 };
    const legacy = {};
    for (const s of g.structs) {
      // a building still going up, or one wrecked in a raid, gives nothing until it is finished or repaired
      if (s.state !== 'done' || s.damaged) continue;
      const def = C.BUILD[s.kind]; if (!def) continue;
      const t = def.fx[Math.min(def.fx.length, s.tier) - 1] || {};
      for (const [k, v] of Object.entries(t)) {
        if (k === 'prod') { for (const [r, n] of Object.entries(v)) f.prod[r] = (f.prod[r] || 0) + n; }
        else if (k === 'unlock') f.unlock[v] = true;
        else if (typeof v === 'number') f[k] = (f[k] || 0) + v;
      }
      if (def.legacy) legacy[def.legacy] = Math.max(legacy[def.legacy] || 0, s.tier);
    }
    const W = C.WALLS[g.wall.stage] || C.WALLS[0];
    f.def += W.def; legacy.walls = g.wall.stage >= 6 ? 3 : g.wall.stage >= 3 ? 2 : g.wall.stage >= 1 ? 1 : 0;
    if (g.hq && g.hq.traits) for (const t of g.hq.traits) { const T = C.TRAITS_HQ[t]; if (!T) continue; if (T.prod) for (const [r, n] of Object.entries(T.prod)) f.prod[r] = (f.prod[r] || 0) + n; if (T.def) f.def += T.def; if (T.trade) f.trade += T.trade; if (T.appeal) f.appeal += T.appeal; if (T.contracts) f.contracts += T.contracts; }
    f.legacy = legacy;
    g._fx = f; g._fxv = g.ver;
    return f;
  };
  G.storeCap = (g) => 500 + G.fx(g).store;
  G.has = (g, cost) => Object.entries(cost || {}).every(([k, v]) => (g.res[k] || 0) >= v);
  G.pay = (g, cost) => { if (!G.has(g, cost)) return false; for (const [k, v] of Object.entries(cost || {})) g.res[k] -= v; return true; };
  G.gain = (g, res, mult = 1) => { const cap = G.storeCap(g); for (const [k, v] of Object.entries(res || {})) { if (!C.RES[k]) continue; g.res[k] = Math.max(0, (g.res[k] || 0) + v * mult); if (k !== 'mon') g.res[k] = Math.min(cap, g.res[k]); g.res[k] = Math.round(g.res[k] * 10) / 10; } };
  G.costText = (cost) => Object.entries(cost || {}).filter(([, v]) => v).map(([k, v]) => v + ' ' + (C.RES[k] ? C.RES[k].name.toLowerCase() : k)).join(', ');
  G.short = (g, cost) => Object.entries(cost || {}).filter(([k, v]) => (g.res[k] || 0) < v).map(([k, v]) => (v - Math.floor(g.res[k] || 0)) + ' ' + C.RES[k].name.toLowerCase()).join(', ');

  G.addRenown = (g, n, why) => {
    const before = G.stage(g).n;
    g.renown = Math.max(0, Math.round((g.renown + n) * 10) / 10);
    const after = G.stage(g);
    if (after.n > before) { G.log(g, 'The clan is now known as a ' + after.name + '.'); ctx.toGang(g, { t: 'clanStage', stage: after.n, name: after.name }); }
    if (why) G.log(g, '+' + Math.round(n) + ' renown · ' + why);
  };
  G.addRep = (g, d) => { for (const [k, v] of Object.entries(d || {})) if (k in g.rep) g.rep[k] = Math.round(U.clamp(g.rep[k] + v, -100, 100) * 10) / 10; };

  // ---- what other players see of a clan (browse, banners, the walls of its compound)
  G.worldView = (g) => ({
    id: g.id, name: g.name, tag: g.tag, motto: g.motto, emblem: g.emblem, palette: { primary: g.palette.primary, secondary: g.palette.secondary, accent: g.palette.accent, banner: g.palette.banner, roof: g.palette.roof, wall: g.palette.wall, gate: g.palette.gate, garden: g.palette.garden },
    banners: g.banners, hq: g.hq, wall: g.wall, stage: G.stage(g).n, leader: g.leader, members: g.members.length,
    // the ground the compound stands on (every client builds the same walls) and what its people wear
    bounds: g.hq && ctx.bounds ? ctx.bounds(g) : null, uniforms: g.uniforms,
    structs: g.structs.map(s => ({ id: s.id, kind: s.kind, x: s.x, y: s.y, w: s.w, h: s.h, rot: s.rot, tier: s.tier, style: s.style || null, state: s.state, doneAt: s.doneAt || 0, startAt: s.startAt || 0, banner: s.banner || null, damaged: !!s.damaged })),
    ver: g.ver
  });
  G.publicCard = (g) => ({
    id: g.id, name: g.name, tag: g.tag, motto: g.motto, desc: g.desc.slice(0, 400), intro: g.intro.slice(0, 300), emblem: g.emblem, palette: { primary: g.palette.primary, secondary: g.palette.secondary },
    members: g.members.length, cap: G.memberCap(g), stage: G.stage(g).n, stageName: G.stage(g).name, recruit: g.recruit.mode, renown: Math.round(g.renown),
    rep: g.rep, leaderName: (ctx.player(g.leader) || {}).name || '—', hasHq: !!g.hq, npcs: g.npcs.filter(n => n.alive !== false).length
  });
  G.fullView = (g) => {
    const f = G.fx(g);
    return Object.assign(G.worldView(g), {
      members: g.members.slice(), memberCap: G.memberCap(g), desc: g.desc, history: g.history, founding: g.founding, intro: g.intro, announce: g.announce, announceAt: g.announceAt, founder: g.founder,
      ranks: g.ranks, rankTitles: g.rankTitles, leaderTitle: g.leaderTitle, perms: g.perms, recruit: g.recruit,
      palette: g.palette, uniforms: g.uniforms, res: g.res, storeCap: G.storeCap(g), npcs: g.npcs, visitors: g.visitors, contracts: g.contracts,
      rep: g.rep, renown: g.renown, stageInfo: G.stage(g), rel: g.rel, claims: g.claims, raids: g.raids.filter(r => !r.done).map(r => ({ id: r.id, rival: r.rival, at: r.at, size: r.size, seen: r.seen })),
      log: g.log.slice(-40), fx: f, buildings: f.legacy, dog: g.dog, memberNames: Object.fromEntries(g.members.map(id => [id, (ctx.player(id) || {}).name || id])),
      lastSeen: Object.fromEntries(g.members.map(id => [id, (ctx.player(id) || {}).lastSeen || 0])), policyOrders: g.policyOrders,
      ren: (db.world && db.world.ren && (db.world.ren.state === 'done' || db.world.ren.gang === g.id)) ? { state: db.world.ren.state, x: db.world.ren.x, y: db.world.ren.y } : null
    });
  };

  // ---- identity: names, words, the face the clan shows
  G.editIdentity = (g, pid, m) => {
    if (!G.can(g, pid, 'identity')) return 'You may not change the clan’s name or words.';
    if (m.name !== undefined) { const n = U.cleanText(m.name, 32); if (n.length < 2) return 'A clan name needs at least two letters.'; if (Object.values(db.gangs).some(x => x !== g && x.name.toLowerCase() === n.toLowerCase())) return 'Another clan already goes by that name.'; g.name = n; }
    if (m.tag !== undefined) { const t = U.cleanText(m.tag, 5).replace(/\s/g, ''); if (t && Object.values(db.gangs).some(x => x !== g && x.tag && x.tag.toLowerCase() === t.toLowerCase())) return 'That short name is taken.'; g.tag = t; }
    for (const [k, max] of [['motto', 80], ['intro', 300]]) if (m[k] !== undefined) g[k] = U.cleanText(m[k], max);
    for (const [k, max] of [['desc', 600], ['history', 1200], ['founding', 800]]) if (m[k] !== undefined) g[k] = U.cleanBlock(m[k], max);
    if (m.leaderTitle !== undefined) g.leaderTitle = U.cleanText(m.leaderTitle, 20, 'Oyabun');
    if (Array.isArray(m.rankTitles)) { if (G.rankOf(g, pid) !== C.RANK_LEADER) return 'Only the leader names the ranks.'; g.rankTitles = C.RANKS.map((r, i) => U.cleanText(m.rankTitles[i], 20, r)); }
    if (m.announce !== undefined) { g.announce = U.cleanText(m.announce, 240); g.announceAt = U.now(); ctx.toGang(g, { t: 'clanAnnounce', text: g.announce, by: pid }); }
    G.log(g, (ctx.player(pid) || {}).name + ' changed the clan’s words.');
    G.bump(g);
    return null;
  };
  // an emblem is a stack of layers on a field; everything is clamped to what the editor can draw
  G.cleanEmblem = (e) => {
    const E = C.EMBLEM;
    if (!e || typeof e !== 'object') return null;
    const out = {
      shape: U.pickOne(e.shape, E.shapes, 'mon'), field: U.cleanHex(e.field, '#7a1f1c'), field2: U.cleanHex(e.field2, '#e8dcc0'),
      pattern: U.pickOne(e.pattern, E.patterns, 'none'), patColor: U.cleanHex(e.patColor, '#e8dcc0'), patScale: U.num(e.patScale, 0.4, 3, 1), patAngle: U.num(e.patAngle, -180, 180, 0), patOpacity: U.num(e.patOpacity, 0, 1, 0.35),
      border: U.pickOne(e.border, E.borders, 'thin'), borderColor: U.cleanHex(e.borderColor, '#e8dcc0'), finish: U.pickOne(e.finish, E.finishes, 'painted'),
      layers: []
    };
    for (const L of (Array.isArray(e.layers) ? e.layers : []).slice(0, E.maxLayers)) {
      if (!L || typeof L !== 'object') continue;
      out.layers.push({ sym: U.pickOne(L.sym, E.symbols, 'none'), color: U.cleanHex(L.color, out.field2), color2: U.cleanHex(L.color2, out.field), x: U.num(L.x, -1, 1, 0), y: U.num(L.y, -1, 1, 0), s: U.num(L.s, 0.15, 2, 1), r: U.num(L.r, -180, 180, 0), flip: U.bool(L.flip), mirror: U.bool(L.mirror), op: U.num(L.op, 0.1, 1, 1), kanji: E.kanji.includes(L.kanji) ? L.kanji : '' });
    }
    return out;
  };
  G.setEmblem = (g, pid, e) => {
    if (!G.can(g, pid, 'emblem')) return 'You may not change the clan’s emblem.';
    const em = G.cleanEmblem(e); if (!em) return 'That emblem could not be read.';
    g.emblem = em; G.log(g, (ctx.player(pid) || {}).name + ' redrew the clan’s emblem.');
    G.bump(g);
    return null;
  };
  G.setPalette = (g, pid, p) => {
    if (!G.can(g, pid, 'colors')) return 'You may not change the clan’s colours.';
    if (!p || typeof p !== 'object') return 'No colours sent.';
    for (const k of C.PALETTE_KEYS) if (p[k] !== undefined) g.palette[k] = U.cleanHex(p[k], g.palette[k]);
    if (Array.isArray(p.ranks)) g.palette.ranks = C.RANKS.map((_, i) => U.cleanHex(p.ranks[i], g.palette.ranks[i] || '#888888'));
    if (p.contexts && typeof p.contexts === 'object') for (const c of C.UNIFORM.contexts) if (p.contexts[c]) g.palette.contexts[c] = { primary: U.cleanHex(p.contexts[c].primary, g.palette.primary), secondary: U.cleanHex(p.contexts[c].secondary, g.palette.secondary), accent: U.cleanHex(p.contexts[c].accent, g.palette.accent) };
    if (Array.isArray(p.saved)) g.palette.saved = p.saved.slice(0, 12).map(s => ({ name: U.cleanText(s && s.name, 24, 'Palette'), colors: (Array.isArray(s && s.colors) ? s.colors : []).slice(0, 8).map(c => U.cleanHex(c)) }));
    G.bump(g);
    return null;
  };
  G.cleanPreset = (p, pal) => {
    if (!p || typeof p !== 'object') return null;
    const col = (o, f) => o && o.color === null ? null : U.cleanHex(o && o.color, f);
    return {
      id: U.cleanText(p.id, 24, 'u' + U.nid(2)).replace(/[^\w-]/g, ''), name: U.cleanText(p.name, 32, 'Uniform'), context: U.pickOne(p.context, C.UNIFORM.contexts, 'everyday'),
      top: { color: col(p.top, pal.primary), pattern: U.int(p.top && p.top.pattern, 0, C.UNIFORM.patterns.length - 1, 0), color2: p.top && p.top.color2 ? U.cleanHex(p.top.color2) : null },
      bottom: { color: col(p.bottom, pal.armor) }, sash: { color: col(p.sash, pal.secondary) },
      coat: { color: p.coat && p.coat.color ? U.cleanHex(p.coat.color) : null }, cloak: { color: p.cloak && p.cloak.color ? U.cleanHex(p.cloak.color) : null },
      armor: { tier: U.int(p.armor && p.armor.tier, 0, 2, 0), color: U.cleanHex(p.armor && p.armor.color, '#24222a'), split: p.armor && p.armor.split ? U.cleanHex(p.armor.split) : null },
      hat: { kind: U.int(p.hat && p.hat.kind, 0, 7, 0), color: p.hat && p.hat.color ? U.cleanHex(p.hat.color) : null }, mask: U.bool(p.mask),
      crest: { on: !!(p.crest && p.crest.on), color: U.cleanHex(p.crest && p.crest.color, pal.secondary), place: U.pickOne(p.crest && p.crest.place, ['chest', 'back', 'both'], 'both') },
      wear: U.num(p.wear, 0, 1, 0), dirt: U.num(p.dirt, 0, 1, 0)
    };
  };
  G.setUniforms = (g, pid, u) => {
    if (!G.can(g, pid, 'uniform')) return 'You may not change the clan’s uniforms.';
    if (!u || typeof u !== 'object') return 'No uniforms sent.';
    if (Array.isArray(u.presets)) {
      const seen = new Set(), list = [];
      for (const p of u.presets.slice(0, C.UNIFORM.maxPresets)) { const c = G.cleanPreset(p, g.palette); if (!c || seen.has(c.id)) continue; seen.add(c.id); list.push(c); }
      if (!list.length) return 'Keep at least one uniform.';
      g.uniforms.presets = list;
    }
    const ids = new Set(g.uniforms.presets.map(p => p.id));
    if (u.assign && typeof u.assign === 'object') {
      const A = { ranks: {}, roles: {}, npcs: {} };
      for (let i = 0; i < C.RANKS.length; i++) { const v = u.assign.ranks && u.assign.ranks[i]; if (ids.has(v)) A.ranks[i] = v; }
      for (const r of Object.keys(C.ROLES)) { const v = u.assign.roles && u.assign.roles[r]; if (ids.has(v)) A.roles[r] = v; }
      for (const n of g.npcs) { const v = u.assign.npcs && u.assign.npcs[n.id]; if (ids.has(v)) A.npcs[n.id] = v; }
      g.uniforms.assign = A;
    }
    if (u.players !== undefined) g.uniforms.players = U.pickOne(u.players, ['free', 'recommend', 'require'], 'free');
    G.log(g, (ctx.player(pid) || {}).name + ' changed the clan’s uniforms.');
    G.bump(g);
    return null;
  };
  G.setBanners = (g, pid, list) => {
    if (!G.can(g, pid, 'emblem')) return 'You may not change the clan’s banners.';
    if (!Array.isArray(list) || !list.length) return 'Keep at least one banner.';
    const B = C.BANNER;
    g.banners = list.slice(0, B.maxBanners).map((b, i) => ({
      id: U.cleanText(b && b.id, 12, 'b' + (i + 1)).replace(/[^\w-]/g, '') || ('b' + (i + 1)), name: U.cleanText(b && b.name, 32, 'Banner'),
      shape: U.pickOne(b && b.shape, B.shapes, 'nobori'), size: U.pickOne(b && b.size, B.sizes, 'medium'), fabric: U.pickOne(b && b.fabric, B.fabrics, 'silk'), pole: U.pickOne(b && b.pole, B.poles, 'bamboo'),
      field: U.cleanHex(b && b.field, g.emblem.field), field2: U.cleanHex(b && b.field2, g.emblem.field2), layout: U.pickOne(b && b.layout, ['center', 'top', 'stripe', 'split', 'border'], 'center'),
      emblem: !!(b && b.emblem), border: U.pickOne(b && b.border, ['none', 'edge', 'double', 'teeth'], 'edge'), borderColor: U.cleanHex(b && b.borderColor, g.emblem.field2),
      tassels: !!(b && b.tassels), fringe: !!(b && b.fringe), wear: U.num(b && b.wear, 0, 1, 0), damage: U.num(b && b.damage, 0, 1, 0), wind: U.num(b && b.wind, 0, 1, 0.6)
    }));
    G.bump(g);
    return null;
  };
  G.setRanks = (g, pid, m) => {
    if (G.rankOf(g, pid) !== C.RANK_LEADER) return 'Only the leader changes what each rank may do.';
    if (m.perms && typeof m.perms === 'object') for (const k of Object.keys(C.PERMS)) if (m.perms[k] !== undefined) g.perms[k] = U.int(m.perms[k], 0, C.RANK_RECRUIT, g.perms[k]);
    if (Array.isArray(m.rankTitles)) g.rankTitles = C.RANKS.map((r, i) => U.cleanText(m.rankTitles[i], 20, r));
    if (m.leaderTitle !== undefined) g.leaderTitle = U.cleanText(m.leaderTitle, 20, 'Oyabun');
    G.log(g, 'The leader changed what each rank may do.');
    G.bump(g);
    return null;
  };
  G.setRecruit = (g, pid, m) => {
    if (!G.can(g, pid, 'recruit')) return 'You may not change how the clan recruits.';
    if (m.mode !== undefined) g.recruit.mode = U.pickOne(m.mode, ['open', 'apply', 'invite', 'closed'], 'invite');
    if (m.limit !== undefined) g.recruit.limit = U.int(m.limit, 0, 99, 0);
    if (m.policy && typeof m.policy === 'object') {
      const P = m.policy;
      g.recruit.policy = { minSkill: U.num(P.minSkill, 0, 1, 0), roles: (Array.isArray(P.roles) ? P.roles : []).filter(r => C.ROLES[r]).slice(0, 8), maxRecruits: U.int(P.maxRecruits, 0, 99, 0), autoReject: U.bool(P.autoReject), references: U.bool(P.references) };
    }
    G.bump(g);
    return null;
  };

  // ---- membership
  G.join = (g, p) => {
    const old = p.gangId && db.gangs[p.gangId];
    if (old && old !== g) G.removeMember(old, p.id, 'left to join ' + g.name);
    if (!g.members.includes(p.id)) g.members.push(p.id);
    g.ranks[p.id] = C.RANK_RECRUIT;
    p.gangId = g.id;
    db.invites = db.invites.filter(i => i.to !== p.id || i.gang !== g.id);
    db.apps = db.apps.filter(a => a.from !== p.id);
    G.log(g, p.name + ' joined the clan.');
    G.bump(g);
  };
  // someone leaves (or is removed): the clan goes on, the leader's seat passes on, an empty clan is dissolved
  G.removeMember = (g, pid, why) => {
    g.members = g.members.filter(x => x !== pid); delete g.ranks[pid];
    const p = ctx.player(pid); if (p && p.gangId === g.id) p.gangId = null;
    if (g.leader === pid) G.succeed(g, 'the leader ' + why);
    if (!g.members.length) { ctx.dissolve(g); return; }
    G.log(g, ((p && p.name) || 'Someone') + ' ' + why + '.');
    G.bump(g);
  };
  // the next leader: highest rank, then whoever has been seen most recently, then whoever joined first
  G.succeed = (g, why) => {
    const cand = g.members.filter(id => id !== g.leader).map(id => ({ id, r: g.ranks[id] ?? C.RANK_MEMBER, seen: (ctx.player(id) || {}).lastSeen || 0 })).sort((a, b) => a.r - b.r || b.seen - a.seen);
    const next = cand[0];
    if (!next) { g.leader = null; return null; }
    const old = g.leader; g.leader = next.id; g.ranks[next.id] = C.RANK_LEADER;
    if (old && g.members.includes(old)) g.ranks[old] = C.RANK_COMMANDER;
    G.log(g, (ctx.player(next.id) || {}).name + ' now leads the clan (' + why + ').');
    ctx.toGang(g, { t: 'clanLeader', leader: next.id, why });
    return next.id;
  };
  // a leader gone too long hands over; a short disconnect never does
  G.checkSuccession = (g, at = U.now()) => {
    const L = ctx.player(g.leader);
    if (!L || g.members.length < 2) return false;
    if (at - (L.lastSeen || at) < C.SUCCESSION_DAYS * DAY_MS || ctx.online(g.leader)) return false;
    const active = g.members.some(id => id !== g.leader && at - ((ctx.player(id) || {}).lastSeen || 0) < C.SUCCESSION_DAYS * DAY_MS);
    if (!active) return false;
    return !!G.succeed(g, 'away for ' + C.SUCCESSION_DAYS + ' days');
  };
  G.invite = (g, pid, target) => {
    if (!G.can(g, pid, 'invite')) return 'Your rank may not invite.';
    if (!target) return 'No one by that name is in this world.';
    if (target.id === pid || g.members.includes(target.id)) return target.name + ' is already in the clan.';
    if (g.members.length >= G.memberCap(g)) return 'The clan is full (' + G.memberCap(g) + ' at this stage).';
    if (db.invites.some(i => i.to === target.id && i.gang === g.id)) return 'You already invited ' + target.name + '.';
    const inv = { id: 'i' + (++db.seq.inv), from: pid, to: target.id, gang: g.id, at: U.now() };
    db.invites.push(inv); if (db.invites.length > 400) db.invites.splice(0, db.invites.length - 400);
    ctx.send(target.id, { t: 'invite', inv: G.inviteView(inv) });
    return null;
  };
  G.inviteView = (i) => { const g = db.gangs[i.gang]; return { id: i.id, from: i.from, name: (ctx.player(i.from) || {}).name || '?', gang: g ? g.name : '?', gangId: i.gang, emblem: g ? g.emblem : null, at: i.at }; };
  G.acceptInvite = (p, invId) => {
    const inv = db.invites.find(i => i.id === invId && i.to === p.id); if (!inv) return 'That invitation is gone.';
    const g = db.gangs[inv.gang]; if (!g) { db.invites = db.invites.filter(i => i !== inv); return 'That clan no longer exists.'; }
    if (g.members.length >= G.memberCap(g)) return g.name + ' is full.';
    if (p.gangId && db.gangs[p.gangId] && db.gangs[p.gangId].leader === p.id && db.gangs[p.gangId].members.length > 1 && !inv.force) return 'Hand your own clan to someone first (you lead it).';
    G.join(g, p); return null;
  };
  G.declineInvite = (p, invId) => { db.invites = db.invites.filter(i => !(i.id === invId && i.to === p.id)); return null; };
  G.apply = (g, p, m) => {
    if (g.members.includes(p.id)) return 'You are already in ' + g.name + '.';
    if (g.recruit.mode === 'closed' || g.recruit.mode === 'invite') return g.name + ' only takes members by invitation.';
    if (g.members.length >= G.memberCap(g)) return g.name + ' is full.';
    if (p.gangId && db.gangs[p.gangId] && db.gangs[p.gangId].leader === p.id && db.gangs[p.gangId].members.length > 1) return 'Hand your own clan to someone first (you lead it).';
    if (g.recruit.mode === 'open') { G.join(g, p); return null; }
    if (db.apps.some(a => a.from === p.id && a.gang === g.id)) return 'You have already applied.';
    const app = { id: 'a' + (++db.seq.app), from: p.id, gang: g.id, at: U.now(), intro: U.cleanText(m.intro, 200), role: U.cleanText(m.role, 30), style: U.cleanText(m.style, 60), avail: U.cleanText(m.avail, 60) };
    db.apps.push(app);
    ctx.toGangPerm(g, 'approve', { t: 'clanApp', app: G.appView(app) });
    return null;
  };
  G.appView = (a) => ({ id: a.id, from: a.from, name: (ctx.player(a.from) || {}).name || '?', level: (ctx.player(a.from) || {}).level || 1, honor: (ctx.player(a.from) || {}).honor || 0, intro: a.intro, role: a.role, style: a.style, avail: a.avail, at: a.at });
  G.decideApp = (g, pid, appId, yes) => {
    if (!G.can(g, pid, 'approve')) return 'Your rank may not answer applications.';
    const a = db.apps.find(x => x.id === appId && x.gang === g.id); if (!a) return 'That application is gone.';
    db.apps = db.apps.filter(x => x !== a);
    const p = ctx.player(a.from); if (!p) return null;
    if (yes) { if (g.members.length >= G.memberCap(g)) return g.name + ' is full.'; G.join(g, p); ctx.send(p.id, { t: 'clanJoined', gang: g.id }); }
    else ctx.send(p.id, { t: 'toast', msg: g.name + ' turned down your application.', kind: 'shame' });
    return null;
  };
  G.kick = (g, pid, target) => {
    if (!G.can(g, pid, 'kick')) return 'Your rank may not remove members.';
    if (!g.members.includes(target)) return 'They are not in the clan.';
    if (target === pid) return 'Use “leave” to leave.';
    if (G.rankOf(g, target) <= G.rankOf(g, pid)) return 'You can only remove members below your own rank.';
    if (target === g.founder && G.rankOf(g, pid) !== C.RANK_LEADER) return 'Only the leader can remove the founder.';
    G.removeMember(g, target, 'was removed');
    return null;
  };
  G.setRank = (g, pid, target, rank) => {
    if (!G.can(g, pid, 'promote')) return 'Your rank may not promote or demote.';
    if (!g.members.includes(target) || target === g.leader) return 'Not someone you can promote or demote.';
    rank = U.int(rank, 1, C.RANK_RECRUIT, C.RANK_MEMBER);
    const me = G.rankOf(g, pid);
    if (G.rankOf(g, target) <= me || rank <= me) return 'You can only move members below your own rank, to below your own rank.';
    g.ranks[target] = rank;
    G.log(g, (ctx.player(target) || {}).name + ' is now ' + g.rankTitles[rank] + '.');
    return null;
  };
  G.transfer = (g, pid, target, confirm) => {
    if (g.leader !== pid) return 'Only the leader can hand over the clan.';
    const t = ctx.player(target); if (!t || !g.members.includes(target)) return 'They are not in the clan.';
    if (String(confirm || '').trim().toLowerCase() !== t.name.toLowerCase()) return 'Type their name exactly to confirm.';
    g.leader = target; g.ranks[target] = C.RANK_LEADER; g.ranks[pid] = C.RANK_COMMANDER;
    G.log(g, (ctx.player(pid) || {}).name + ' handed the clan to ' + t.name + '.');
    ctx.toGang(g, { t: 'clanLeader', leader: target, why: 'handed over' });
    return null;
  };

  // ---- treasury: a player puts their own mon (or carried goods) into the clan's store
  G.contribute = (g, p, res, n) => {
    n = U.int(n, 1, 1e6, 0); if (!n) return 'Give at least 1.';
    if (res !== 'mon') return 'Only mon can be given from your purse. Goods come from work and land.';
    const have = (p.gold | 0) + (p.bank | 0); if (have < n) return 'You only have ' + have + ' mon.';
    const fromCarry = Math.min(p.gold | 0, n); p.gold -= fromCarry; p.bank = (p.bank | 0) - (n - fromCarry);
    g.res.mon += n; G.addRep(g, { wealth: n / 500 });
    G.log(g, p.name + ' gave ' + n + ' mon to the clan.');
    return null;
  };
  G.withdraw = (g, pid, n) => {
    if (!G.can(g, pid, 'spend')) return 'Your rank may not take from the treasury.';
    const p = ctx.player(pid); n = U.int(n, 1, 1e6, 0);
    if (!n || g.res.mon < n) return 'The treasury holds ' + Math.floor(g.res.mon) + ' mon.';
    g.res.mon -= n; p.gold = (p.gold | 0) + n;
    G.log(g, p.name + ' took ' + n + ' mon from the treasury.');
    return null;
  };

  return G;
}

module.exports = { createGangs, DAY_MS };
