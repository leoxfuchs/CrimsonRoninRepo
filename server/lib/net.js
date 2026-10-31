'use strict';
// Sessions, the five-player cap, the world-host role, and every message between the browsers and the world.
//
// Who decides what:
//   - this server: who is connected, the clock, every clan (membership, ranks, resources, buildings, NPC roster,
//     visitors, contracts), land, rival gangs, raids, persistence. Clients ask; the server answers.
//   - the world host (one connected browser, chosen here, handed over when it leaves): the island's people (townsfolk,
//     guards, outlaws, clan NPCs) move, think and fight on the host, the same for everyone; the host reports them
//     here and the server passes each player only the people near them.
//   - each player's browser: their own body (movement, blocking, rolling), so their own defence is never lagged.
//     A cut at someone else's NPC is a request to the host; a cut from an NPC at a player is resolved by that player.
const C = require('./catalog');
const U = require('./util');
const { createGangs } = require('./gangs');
const { createBase } = require('./base');
const { createLife } = require('./clanlife');
const { createRealm, DAY_LEN } = require('./realm');

const MAX_PLAYERS = 5;
const NPC_RANGE = 84;            // tiles: a player is told about people this close
const PROTOCOL = 2;

function createNet(opt) {
  const { db, touch, log = () => {} } = opt;
  const clients = new Map();     // ws -> client
  const byId = new Map();        // player id -> client
  const npcTable = new Map();    // npc id -> { full, pose, x, y, at }
  let hostId = null;

  const ctx = {
    db, touch,
    player: id => db.players[id],
    online: id => byId.has(id),
    hostOnline: () => !!(hostId && byId.has(hostId)),
    clock: () => db.clock,
    send: (id, msg) => { const c = byId.get(id); if (c) send(c.ws, msg); },
    toGang: (g, msg, except) => { if (!g) return; const s = JSON.stringify(msg); for (const id of g.members) { const c = byId.get(id); if (c && c.ws !== except && c.ws.readyState === 1) c.ws.send(s); } },
    toGangPerm: (g, perm, msg) => { for (const id of g.members) if (G.can(g, id, perm)) ctx.send(id, msg); },
    broadcast: (msg, except) => broadcast(msg, except),
    broadcastClock: () => broadcast({ t: 'clock', clock: clockMsg() }),
    dissolve: (g) => { delete db.gangs[g.id]; db.apps = db.apps.filter(a => a.gang !== g.id); db.invites = db.invites.filter(i => i.gang !== g.id); for (const [k, cs] of Object.entries(db.world.cells)) if (cs.owner === g.id) { cs.owner = null; cs.hold = 0; } broadcast({ t: 'gangGone', id: g.id }); touch(); },
    hourly: () => {}, daily: () => {},
    startRaid: (g, raid) => { toHost({ t: 'raidStart', gang: g.id, raid, hq: g.hq, bounds: B.bounds(g), wall: g.wall.stage }); ctx.toGang(g, { t: 'raidAlert', raid }); },
    contractStarted: (g, c) => toHost({ t: 'contractOn', gang: g.id, c }),
    contractEnded: (g, c) => toHost({ t: 'contractOff', gang: g.id, id: c.id })
  };
  const G = createGangs(ctx);
  const B = createBase(ctx, G);
  const L = createLife(ctx, G);
  const R = createRealm(ctx, G, B, L);
  ctx.influence = (id, k, n) => R.influence(id, k, n);
  ctx.bounds = g => B.bounds(g);

  // gangs saved by the first version become clans with a headquarters on their old camp ground
  for (const g of Object.values(db.gangs)) { if (!g) continue; G.normalize(g); if (g.v1) B.migrateV1(g); if (g.leader && db.players[g.leader]) db.players[g.leader].gangId = g.id; }
  for (const p of Object.values(db.players)) { if (p.gangId && !db.gangs[p.gangId]) p.gangId = null; }

  function send(ws, msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }
  function broadcast(msg, except) { const s = JSON.stringify(msg); for (const [ws] of clients) if (ws !== except && ws.readyState === 1) ws.send(s); }
  function toHost(msg) { const c = hostId && byId.get(hostId); if (c) send(c.ws, msg); return !!c; }
  function clockMsg() { return { tod: db.clock.tod, day: db.clock.day, rain: !!db.clock.rain, dayLen: DAY_LEN, at: U.now() }; }

  function rankNameOf(g, pid) {
    if (!g) return '';
    const r = G.rankOf(g, pid);
    if (r === 99) return '';
    if (r === 0) return g.leaderTitle || C.RANKS[0];
    return (g.rankTitles && g.rankTitles[r]) || C.RANKS[r] || '';
  }
  function publicPlayer(p, online) {
    const g = p.gangId && db.gangs[p.gangId];
    return { id: p.id, name: p.name, look: p.look, x: p.x, y: p.y, face: p.face || 0, hp: p.hp, maxHp: p.maxHp || 100, wpn: p.wpn, armor: p.armor || 0, pose: p.pose || 'idle', state: p.pose || 'idle', sleeping: !!p.sleeping, armed: !!(p.wpn && p.wpn !== 'fists'), atk: p.atk || null, draw: p.draw || null, walk: p.walk || 0, moving: !!p.moving, crouch: !!p.crouch, mounted: !!p.mounted, seat: p.seat || 0, mountOf: p.mountOf || null, horse: p.horse, dog: p.dog || null, gangId: p.gangId, online: !!online, uniform: p.uniform || null, gold: p.gold | 0, ping: p.ping | 0, clan: g ? g.name : '', tag: g ? (g.tag || '') : '', rank: g ? G.rankOf(g, p.id) : 99, rankName: rankNameOf(g, p.id) };
  }
  function newPlayer(m) {
    const id = 'p_' + U.nid(4);
    return { id, token: U.nid(12), name: U.cleanName(m.name, 'Ronin'), look: m.look && typeof m.look === 'object' ? m.look : {}, gold: 240, bank: 0, honor: 0, xp: 0, level: 1, perks: {}, weapons: ['katana'], stash: [], wpn: 'katana', lastBlade: 'katana', armors: [0], armor: 0, bandages: 3, sake: 0, horse: { coat: 0, name: 'Scrag', spdMul: 0.55 }, x: 108, y: 130, face: 0, hp: 100, maxHp: 100, pose: 'idle', mounted: false, seat: 0, mountOf: null, gangId: null, joinedAt: U.now(), lastSeen: U.now() };
  }
  // every player has a clan; one who has none (new, left, removed) founds their own band
  function ensureGang(p) {
    let g = p.gangId && db.gangs[p.gangId];
    if (!g || !g.members.includes(p.id)) { g = G.make(p.id, p.name + '’s band'); p.gangId = g.id; }
    return g;
  }
  function worldSnapshot() {
    return {
      gangs: Object.values(db.gangs).filter(g => g && g.hq).map(G.worldView),
      territory: R.publicTerritory(), rivals: R.publicRivals(),
      camps: Object.values(db.world.camps).map(c => ({ id: c.id, cleared: !!c.cleared, owner: c.owner || null, rival: c.rival })),
      info: db.world.info ? { ver: db.world.info.ver, seed: db.world.info.seed } : null,
      sites: B.sites().map(s => ({ id: s.id, name: s.name, x: s.x, y: s.y, traits: s.traits, prov: s.prov || '', taken: (B.takenBy(s.id) || {}).id || null })),
      parked: Object.values(db.players).filter(p => !byId.has(p.id) && p.horse && p.horse.parked && p.horse.x != null).map(p => ({ owner: p.id, name: p.name, horse: p.horse }))
    };
  }
  function catalog() { return { RES: C.RES, RANKS: C.RANKS, PERMS: C.PERMS, STAGES: C.STAGES, BUILD: C.BUILD, BUILD_CATS: C.BUILD_CATS, HORSES: C.HORSES, WALLS: C.WALLS, GATES: C.GATES, EMBLEM: C.EMBLEM, BANNER: C.BANNER, UNIFORM: C.UNIFORM, PALETTE_KEYS: C.PALETTE_KEYS, ROLES: C.ROLES, TRAITS: C.TRAITS, ASSIGN: C.ASSIGN, ORDERS: C.ORDERS, FORMATIONS: C.FORMATIONS, VISITORS: C.VISITORS, GATE_CHOICES: C.GATE_CHOICES, TEMPERS: C.TEMPERS, TRAITS_HQ: C.TRAITS_HQ, MAX_PLAYERS }; }
  // a finished, undamaged stables whose footprint you are standing on (or just beside). any clan’s stalls will sell.
  function stablesAt(p) {
    let at = null;
    for (const gang of Object.values(db.gangs)) {
      if (!gang || !Array.isArray(gang.structs)) continue;
      for (const s of gang.structs) {
        if (s.kind !== 'stables' || s.state !== 'done' || s.damaged) continue;
        if (p.x < s.x - 2 || p.y < s.y - 2 || p.x > s.x + s.w + 2 || p.y > s.y + s.h + 2) continue;
        if (!at || (s.tier | 0) > (at.tier | 0)) at = s;
      }
    }
    return at;
  }

  // ---- the world host: the earliest arrival still here whose game is in front of them. It changes only when the host
  // leaves, or puts the game away (a hidden browser tab stops running, and the island's people would stand still for
  // everyone) while someone else is playing
  function electHost() {
    const cur = hostId && byId.get(hostId);
    const off = c => c.away || c.stalled;
    let best = null; for (const c of clients.values()) if (c.id && !off(c) && (!best || c.joinedAt < best.joinedAt)) best = c;
    if (cur && (!off(cur) || !best)) return;
    if (!best) for (const c of clients.values()) if (c.id && (!best || c.joinedAt < best.joinedAt)) best = c;
    const was = hostId; hostId = best ? best.id : null;
    if (hostId === was) return;
    // the old host is a guest now: it learns about every person afresh, from the new host
    const old = was && byId.get(was); if (old) old.known.clear();
    log('world host: ' + (hostId || 'none'));
    // (a host chosen as it joins learns it from its welcome instead)
    if (best && best.welcomed) { send(best.ws, { t: 'host', id: hostId, you: true, npcs: [...npcTable.values()].map(e => ({ full: e.full, pose: e.pose })), contracts: activeContracts() }); send(best.ws, hostClans()); }
    broadcast({ t: 'host', id: hostId, you: false }, best && best.ws);
  }
  // what the world host needs to run a clan's people: its ground, roster, visitors, raids and how they dress
  function hostView(g) { return { id: g.id, name: g.name, tag: g.tag, hq: g.hq, bounds: g.hq ? B.bounds(g) : null, members: g.members.slice(), npcs: g.npcs, visitors: g.visitors, raids: g.raids.filter(r => !r.done), palette: g.palette, uniforms: g.uniforms, policyOrders: g.policyOrders }; }
  function hostClans() { return { t: 'clans', list: Object.values(db.gangs).filter(g => g && (g.hq || g.npcs.length)).map(hostView) }; }
  function activeContracts() { const out = []; for (const g of Object.values(db.gangs)) for (const c of (g && g.contracts) || []) if (c.state === 'active') out.push({ gang: g.id, c }); return out; }

  // ---- NPC replication: the host's people, filtered per player by distance
  function onNpcs(c, m) {
    if (c.id !== hostId) return;
    const at = U.now();
    for (const f of Array.isArray(m.full) ? m.full.slice(0, 400) : []) { if (!f || !f.id) continue; const e = npcTable.get(f.id) || { at }; e.full = f; npcTable.set(f.id, e); }
    for (const q of Array.isArray(m.list) ? m.list.slice(0, 600) : []) { if (!Array.isArray(q) || !q[0]) continue; const e = npcTable.get(q[0]); if (!e) continue; e.pose = q; e.x = +q[1]; e.y = +q[2]; e.at = at; }
    for (const id of Array.isArray(m.gone) ? m.gone : []) npcTable.delete(id);
    // someone the host has not reported for a while (left behind when the island changed hands) is gone
    for (const [id, e] of npcTable) if (at - (e.at || 0) > 15000) npcTable.delete(id);
    for (const [, cl] of clients) {
      if (!cl.id || cl.id === hostId) continue;
      const p = db.players[cl.id]; if (!p) continue;
      const list = [], full = [], gone = [];
      for (const [id, e] of npcTable) {
        if (!e.pose) continue;
        const near = Math.abs(e.x - p.x) + Math.abs(e.y - p.y) < NPC_RANGE * 1.3;
        if (near) { if (!cl.known.has(id)) { cl.known.add(id); full.push(e.full); } list.push(e.pose); }
        else if (cl.known.has(id)) { cl.known.delete(id); gone.push(id); }
      }
      for (const id of cl.known) if (!npcTable.has(id)) { cl.known.delete(id); gone.push(id); }
      if (list.length || gone.length) send(cl.ws, { t: 'npcs', list, full, gone });
    }
  }
  function npcSnapshotFor(p) { const out = []; for (const e of npcTable.values()) if (e.pose && Math.abs(e.x - p.x) + Math.abs(e.y - p.y) < NPC_RANGE * 1.3) out.push({ full: e.full, pose: e.pose }); return out; }

  // ---- hello: who you are, and everything you need to see the same world as everyone else
  function hello(ws, m) {
    if (m.v && +m.v < PROTOCOL) { send(ws, { t: 'err', msg: 'This game is older than the world host. Reload the page.' }); ws.close(); return; }
    let p = m.token && Object.values(db.players).find(x => x.token === m.token);
    const others = [...byId.keys()].filter(id => !p || id !== p.id);
    if (others.length >= MAX_PLAYERS) { send(ws, { t: 'full', msg: 'The world is full (' + MAX_PLAYERS + ' players). Try again when someone leaves.' }); setTimeout(() => ws.close(), 50); return; }
    if (!p) { p = newPlayer(m); db.players[p.id] = p; }
    else { if (m.look && typeof m.look === 'object') p.look = m.look; if (m.name) p.name = U.cleanName(m.name, p.name); }
    // the same player on a second tab: the old tab is let go
    const old = byId.get(p.id); if (old && old.ws !== ws) { send(old.ws, { t: 'replaced', msg: 'You joined from another window.' }); clients.delete(old.ws); try { old.ws.close(); } catch (e) {} }
    const c = clients.get(ws); c.id = p.id; c.joinedAt = U.now(); byId.set(p.id, c);
    p.lastSeen = U.now(); if (p.horse) p.horse.parked = false;
    const g = ensureGang(p); G.normalize(g);
    touch();
    electHost();
    send(ws, {
      t: 'welcome', id: p.id, token: p.token, you: p, protocol: PROTOCOL, clock: clockMsg(), host: hostId, isHost: hostId === p.id, maxPlayers: MAX_PLAYERS,
      gang: G.fullView(g), catalog: catalog(), world: worldSnapshot(), npcs: hostId === p.id ? [...npcTable.values()].map(e => ({ full: e.full, pose: e.pose })) : npcSnapshotFor(p),
      players: [...byId.values()].filter(o => o.id !== p.id).map(o => publicPlayer(db.players[o.id], true)),
      invites: db.invites.filter(i => i.to === p.id).map(G.inviteView), apps: G.can(g, p.id, 'approve') ? db.apps.filter(a => a.gang === g.id).map(G.appView) : [],
      contracts: hostId === p.id ? activeContracts() : []
    });
    c.welcomed = true;
    if (hostId === p.id) send(ws, hostClans());
    if (hostId === p.id) for (const e of npcTable.values()) c.known.add(e.full && e.full.id);
    else for (const e of npcSnapshotFor(p)) c.known.add(e.full.id);
    broadcast({ t: 'player', p: publicPlayer(p, true) }, ws);
    log('join ' + p.name + ' (' + p.id + ') · ' + byId.size + '/' + MAX_PLAYERS);
  }

  // ---- a request: answered once (by rid), with ok or the reason it was refused. Clan views go out after a change
  function request(c, m) {
    const p = db.players[c.id]; if (!p) return;
    if (!c.seen.first(m.rid)) return;
    if (!c.reqRate.ok()) { send(c.ws, { t: 'res', rid: m.rid, ok: false, err: 'Slow down.' }); return; }
    let g = db.gangs[p.gangId]; if (g) G.normalize(g);
    const before = g ? g.ver : 0, worldBefore = g ? JSON.stringify(G.worldView(g)) : '';
    let err = null, data = null, other = null;
    const target = () => db.players[m.to] || Object.values(db.players).find(x => x.name && x.name.toLowerCase() === String(m.to || '').trim().toLowerCase());
    switch (m.op) {
      case 'identity': err = G.editIdentity(g, p.id, m); break;
      case 'emblem': err = G.setEmblem(g, p.id, m.emblem); break;
      case 'palette': err = G.setPalette(g, p.id, m.palette); break;
      case 'uniforms': err = G.setUniforms(g, p.id, m.uniforms); break;
      case 'banners': err = G.setBanners(g, p.id, m.banners); break;
      case 'ranks': err = G.setRanks(g, p.id, m); break;
      case 'recruit': err = G.setRecruit(g, p.id, m); break;
      case 'invite': err = G.invite(g, p.id, target()); break;
      case 'acceptInvite': { const inv = db.invites.find(i => i.id === m.id && i.to === p.id); other = inv && db.gangs[inv.gang]; err = G.acceptInvite(p, m.id); break; }
      case 'declineInvite': err = G.declineInvite(p, m.id); break;
      case 'apply': { other = db.gangs[m.gang]; err = other ? G.apply(other, p, m) : 'No such clan.'; break; }
      case 'decideApp': err = G.decideApp(g, p.id, m.id, !!m.yes); break;
      case 'kick': err = G.kick(g, p.id, m.id); if (!err) { const k = db.players[m.id]; if (k) { const ng = ensureGang(k); ctx.send(k.id, { t: 'clanKicked', from: g.name }); sendGang(ng); } } break;
      case 'setRank': err = G.setRank(g, p.id, m.id, m.rank); break;
      case 'transfer': err = G.transfer(g, p.id, m.id, m.confirm); break;
      case 'leave': {
        if (g.leader === p.id && g.members.length > 1 && !m.confirm) { err = 'You lead the clan. Hand it over first, or confirm to let it pass to the next in rank.'; break; }
        other = g; G.removeMember(g, p.id, 'left'); g = ensureGang(p); break;
      }
      case 'found': {
        if (g.leader === p.id && g.members.length > 1) { err = 'Hand your clan to someone first.'; break; }
        if (g.members.length === 1 && g.leader === p.id && !g.hq) { err = G.editIdentity(g, p.id, { name: m.name }); break; }
        other = g; G.removeMember(g, p.id, 'left to found a new clan'); g = G.make(p.id, m.name); p.gangId = g.id; break;
      }
      case 'browse': data = Object.values(db.gangs).filter(x => x && x.members.length).map(G.publicCard).sort((a, b) => b.renown - a.renown).slice(0, 60); break;
      case 'card': { const x = db.gangs[m.id]; data = x ? G.publicCard(x) : null; break; }
      case 'contribute': err = G.contribute(g, p, m.res, m.n); if (!err) data = { gold: p.gold, bank: p.bank }; break;
      case 'withdraw': err = G.withdraw(g, p.id, m.n); if (!err) data = { gold: p.gold, bank: p.bank }; break;
      case 'placeHQ': err = B.placeHQ(g, p.id, m.site, m); if (!err) L.stockBoard(g); break;
      case 'build': err = B.build(g, p.id, m); break;
      case 'upgrade': err = B.upgrade(g, p.id, m.id); break;
      case 'demolish': err = B.demolish(g, p.id, m.id, !!m.confirm); break;
      case 'move': err = B.move(g, p.id, m.id, m); break;
      case 'restyle': err = B.restyle(g, p.id, m.id, m.style, m.banner); break;
      case 'restyleAll': err = B.restyleAll(g, p.id, m.style); break;
      case 'wallUp': err = B.wallUp(g, p.id); break;
      case 'gateUp': err = B.gateUp(g, p.id); break;
      case 'repair': err = R.repair(g, p.id, m.id); break;
      case 'hireNpc': err = L.hire(g, p, m.npc); if (!err) data = { gold: p.gold, bank: p.bank }; break;
      case 'dismissNpc': err = L.dismiss(g, p.id, m.id); break;
      case 'assignNpc': err = L.assign(g, p.id, m.id, m); break;
      case 'renameNpc': err = L.renameNpc(g, p.id, m.id, m.name); break;
      case 'order': {
        if (!G.can(g, p.id, 'assign')) { err = 'Your rank may not command the clan’s fighters.'; break; }
        const ids = (Array.isArray(m.npcs) ? m.npcs : []).filter(id => L.find(g, id)).slice(0, 30);
        const order = U.pickOne(m.order, C.ORDERS, null); if (!order) { err = 'Unknown order.'; break; }
        if (order === 'base' || order === 'follow' || order === 'standDown') for (const id of ids) { const n = L.find(g, id); n.assign = { job: order === 'follow' ? 'follow' : 'rest', follow: order === 'follow' ? p.id : null, post: null, at: null }; }
        if (m.formation) g.policyOrders.formation = U.pickOne(m.formation, C.FORMATIONS, 'loose');
        toHost({ t: 'order', gang: g.id, by: p.id, npcs: ids, order, target: U.cleanText(m.target, 32), at: Array.isArray(m.at) ? [U.num(m.at[0], -9999, 9999), U.num(m.at[1], -9999, 9999)] : null, formation: g.policyOrders.formation });
        G.bump(g); break;
      }
      case 'visitor': err = L.decide(g, p.id, m.id, m.choice, m); break;
      case 'renDone': {
        if (!g || !db.world.ren || db.world.ren.gang !== g.id) { err = 'He is not yours to dismiss.'; break; }
        if (db.world.ren.state === 'done') break;
        L.finishRen(g);
        break;
      }
      case 'trial': err = L.trial(g, p.id, m.id, !!m.won); break;
      case 'acceptContract': err = L.accept(g, p.id, m.id); break;
      case 'abandonContract': err = L.abandon(g, p.id, m.id); break;
      case 'deliver': err = L.deliver(g, p.id, m.id); break;
      case 'arrive': err = arrive(g, p, m.id); break;
      case 'duelDone': {
        // a contract's duel is fought in the game of whoever took it: they must be the one, and be there
        const c = g.contracts.find(x => x.id === m.id && x.state === 'active');
        if (!c || c.kind !== 'duel') err = 'No such duel under way.';
        else if (c.by !== p.id) err = 'That challenge was answered by someone else.';
        else if (U.dist(p.x, p.y, c.place.x, c.place.y) > 45) err = 'You are not at ' + c.place.name + '.';
        else L.progress(g, c.id, 1, p.id);
        break;
      }
      case 'claim': err = R.claim(g, p.id, m.k); break;
      case 'contest': err = R.contest(g, p.id, m.k); break;
      case 'abandonLand': err = R.abandon(g, p.id, m.k); break;
      case 'diplomacy': err = R.diplomacy(g, p.id, m.rival, m.action); break;
      case 'buyDog': {
        if (g.dog) { err = 'The camp already has a dog.'; break; }
        const have = (p.gold | 0) + (p.bank | 0); if (have < 120) { err = 'Not enough mon (need 120).'; break; }
        const fromCarry = Math.min(p.gold | 0, 120); p.gold -= fromCarry; p.bank = (p.bank | 0) - (120 - fromCarry);
        g.dog = { name: U.cleanName(m.name, 'Miso').slice(0, 16), coat: ((m.coat | 0) % 7 + 7) % 7, buyer: p.id }; G.bump(g); data = { gold: p.gold, bank: p.bank }; break;
      }
      case 'renameDog': if (!g.dog) err = 'No dog.'; else if (p.id !== g.leader && p.id !== g.dog.buyer) err = 'Only the one who bought the dog, or the leader, can rename it.'; else { g.dog.name = U.cleanName(m.name, g.dog.name).slice(0, 16); G.bump(g); } break;
      case 'buyHorse': {
        const H = C.HORSES[m.id];
        if (!H) { err = 'No such horse.'; break; }
        const at = stablesAt(p);
        if (!at) { err = 'The stables sell horses. Stand at one.'; break; }
        if ((at.tier | 0) < H.need) { err = 'Improve the stables first.'; break; }
        if (((p.horse && p.horse.spdMul) || 0) >= H.spdMul) { err = 'You already ride as well as this.'; break; }
        const have = (p.gold | 0) + (p.bank | 0); if (have < H.cost) { err = 'Not enough mon (need ' + H.cost + ').'; break; }
        const fromCarry = Math.min(p.gold | 0, H.cost); p.gold -= fromCarry; p.bank = (p.bank | 0) - (H.cost - fromCarry);
        p.horse = Object.assign(p.horse || {}, { coat: H.coat, name: H.name, spdMul: H.spdMul }); data = { gold: p.gold, bank: p.bank, horse: p.horse }; break;
      }
      case 'rename': { p.name = U.cleanName(m.name, p.name); broadcast({ t: 'player', p: publicPlayer(p, true) }); break; }
      default: err = 'Unknown request.';
    }
    touch();
    send(c.ws, { t: 'res', rid: m.rid, op: m.op, ok: !err || String(err).startsWith('confirm:') ? !err : false, err: err || null, confirm: err && String(err).startsWith('confirm:') ? String(err).slice(8) : null, data, gold: p.gold, bank: p.bank });
    // the clan (and whoever left it, or was joined) sees the new state; everyone sees a changed compound
    const changed = new Set([g, other, db.gangs[p.gangId]].filter(Boolean));
    for (const x of changed) if (db.gangs[x.id]) { sendGang(x); const wv = G.worldView(x); if (x !== g || JSON.stringify(wv) !== worldBefore) broadcast({ t: 'gangWorld', g: wv }); }
    if (other && !db.gangs[other.id]) broadcast({ t: 'gangGone', id: other.id });
    if (m.op === 'claim' || m.op === 'contest' || m.op === 'abandonLand') broadcast({ t: 'territoryAll', territory: R.publicTerritory() });
    if (m.op === 'diplomacy') broadcast({ t: 'rivals', rivals: R.publicRivals() });
    if (m.op === 'placeHQ' && !err) broadcast({ t: 'sites', sites: worldSnapshot().sites });
    void before;
  }
  function sendGang(g) { ctx.toGang(g, { t: 'gang', gang: G.fullView(g) }); toHost({ t: 'clan', g: hostView(g) }); for (const id of g.members) if (G.can(g, id, 'approve')) ctx.send(id, { t: 'apps', apps: db.apps.filter(a => a.gang === g.id).map(G.appView) }); }
  // arriving where a job needs you (escort, scout, a duel's ground): the server checks where you actually are
  function arrive(g, p, cid) {
    const c = g.contracts.find(x => x.id === cid && x.state === 'active'); if (!c) return 'No such job under way.';
    if (!['escort', 'scout'].includes(c.kind)) return 'That job is not done by arriving.';
    if (U.dist(p.x, p.y, c.place.x, c.place.y) > (c.kind === 'scout' ? 40 : 18)) return 'You are not there yet (' + c.place.name + ').';
    L.progress(g, c.id, 1, p.id); return null;
  }

  // ---- everything else a client may send
  function onMsg(ws, raw) {
    if (raw.length > 262144) return;
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    const c = clients.get(ws); if (!c) return;
    if (!c.id) { if (m.t === 'hello' || m.t === 'join') hello(ws, m); return; }
    const p = db.players[c.id]; if (!p) return;
    switch (m.t) {
      case 'state': {
        // a game that has stopped running (its tab hidden, its window shut away) stops sending where its player is
        c.lastState = U.now(); if (c.stalled) c.stalled = false;
        if (!c.stateRate.ok()) return;
        p.x = U.num(m.x, -99999, 99999, p.x); p.y = U.num(m.y, -99999, 99999, p.y); p.face = U.num(m.face, -100, 100, 0);
        p.hp = U.num(m.hp, -100, 1000, p.hp); p.maxHp = U.num(m.maxHp, 1, 1000, p.maxHp); p.wpn = typeof m.wpn === 'string' ? m.wpn.slice(0, 16) : p.wpn; p.armor = U.int(m.armor, 0, 2, 0);
        p.pose = typeof m.pose === 'string' ? m.pose.slice(0, 12) : 'idle'; p.atk = m.atk || null; p.draw = m.draw || null; p.sleeping = !!m.sleeping;
        p.walk = U.num(m.walk, 0, 1e6, 0); p.moving = !!m.moving; p.crouch = !!m.crouch; p.mounted = !!m.mounted; p.seat = U.int(m.seat, 0, 1, 0); p.mountOf = typeof m.mountOf === 'string' ? m.mountOf : null;
        if (m.look && typeof m.look === 'object') p.look = m.look;
        if (m.horse && typeof m.horse === 'object') p.horse = Object.assign(p.horse || {}, { x: U.num(m.horse.x, -99999, 99999, 0), y: U.num(m.horse.y, -99999, 99999, 0), face: U.num(m.horse.face, -100, 100, 0), spd: U.num(m.horse.spd, 0, 20, 0), coat: U.int(m.horse.coat, 0, 9, 0), name: U.cleanText(m.horse.name, 16, 'Horse'), seats: Array.isArray(m.horse.seats) ? m.horse.seats.slice(0, 2) : [null, null] });
        if (m.dog !== undefined) p.dog = m.dog && typeof m.dog === 'object' ? m.dog : null;
        p.uniform = typeof m.uniform === 'string' ? m.uniform.slice(0, 24) : null;
        if (m.honor !== undefined) p.honor = U.int(m.honor, -100, 100, p.honor || 0);
        if (m.gold !== undefined) p.gold = U.int(m.gold, 0, 99999999, p.gold || 0);
        if (m.ping !== undefined) p.ping = U.int(m.ping, 0, 9999, p.ping || 0);
        if (U.now() - (p.lastSeen || 0) > 30000) { p.lastSeen = U.now(); touch(); }
        broadcast(Object.assign({ t: 'state', id: p.id }, publicPlayer(p, true)), ws);
        break;
      }
      case 'save': {
        if (!m.profile || typeof m.profile !== 'object') return;
        // the player's own adventure (purse, gear, quests) is theirs to keep; the clan's things are never taken from here
        const keep = ['gold', 'bank', 'honor', 'xp', 'level', 'perks', 'weapons', 'stash', 'wpn', 'lastBlade', 'armors', 'armor', 'bandages', 'sake', 'quests', 'track', 'chests', 'camps', 'towers', 'blades', 'kills', 'bonusHp', 'look', 'pendingPerks', 'discovered', 'travelVer', 'bounties', 'bountyDay', 'flags'];
        for (const k of keep) if (m.profile[k] !== undefined) p[k] = m.profile[k];
        if (Array.isArray(m.profile.pos)) { p.x = U.num(m.profile.pos[0], -99999, 99999, p.x); p.y = U.num(m.profile.pos[1], -99999, 99999, p.y); }
        if (m.profile.horse && typeof m.profile.horse === 'object') p.horse = Object.assign(p.horse || {}, { coat: U.int(m.profile.horse.coat, 0, 9, 0), name: U.cleanText(m.profile.horse.name, 16, 'Horse'), spdMul: U.num(m.profile.horse.spdMul, 0.3, 1.4, 0.55), pack: Array.isArray(m.profile.horse.pack) ? m.profile.horse.pack.slice(0, 8) : [] });
        touch(); break;
      }
      case 'req': request(c, m); break;
      case 'worldInfo': { const err = R.setInfo(m.info, p.id); if (!err) broadcast({ t: 'worldInfo', world: worldSnapshot() }); break; }
      case 'npcs': onNpcs(c, m); break;
      case 'npcEvent': {
        // the host tells everyone something visible happened to an NPC (a death, a stagger, a shout)
        if (c.id !== hostId) return;
        const e = m.e || {}; if (e.kind === 'die' && e.id) { const x = npcTable.get(e.id); if (x) { x.dead = true; } }
        broadcast({ t: 'npcEvent', e }, ws); break;
      }
      case 'hit': if (!c.hitRate.ok()) return; toHost({ t: 'hit', from: p.id, id: m.id, heavy: !!m.heavy, ang: U.num(m.ang, -10, 10, 0), dmgMult: U.num(m.dmgMult, 0.2, 4, 1), riposte: !!m.riposte, wpn: typeof m.wpn === 'string' ? m.wpn.slice(0, 16) : 'katana', unaware: !!m.unaware, assassin: !!m.assassin, fists: !!m.fists }); break;
      case 'swingAt': if (c.id !== hostId) return; ctx.send(m.to, Object.assign({}, m, { t: 'swingAt' })); break;
      case 'parried': toHost({ t: 'parried', from: p.id, npc: m.npc }); break;
      case 'spawnReq': if (!c.spawnRate.ok()) return; toHost({ t: 'spawnReq', from: p.id, kind: U.cleanText(m.kind, 24), data: m.data && typeof m.data === 'object' ? m.data : {} }); break;
      case 'campClear': if (c.id !== hostId) return; R.campCleared(U.cleanText(m.id, 32), Array.isArray(m.by) ? m.by.filter(id => db.players[id]) : []); break;
      case 'clanNpc': {
        // the host reports what happened to a clan NPC in the world
        if (c.id !== hostId) return;
        const g = db.gangs[m.gang]; if (!g) return;
        if (m.what === 'down') L.down(g, m.id); else if (m.what === 'kill') L.kill(g, m.id);
        break;
      }
      // the host saw the escort's merchant meet whoever took the job: from here the tracker points at the destination
      case 'contractMet': { if (c.id !== hostId) return; const g = db.gangs[m.gang]; const ct = g && g.contracts.find(x => x.id === m.id && x.state === 'active'); if (ct && !ct.met) { ct.met = true; G.log(g, 'The merchant set out for ' + ct.place.name + '.'); G.bump(g); sendGang(g); } break; }
      case 'contractHit': { if (c.id !== hostId) return; const g = db.gangs[m.gang]; if (g) { L.progress(g, m.id, U.int(m.n, 1, 10, 1), m.by); sendGang(g); } break; }
      case 'contractFail': { if (c.id !== hostId) return; const g = db.gangs[m.gang]; const ct = g && g.contracts.find(x => x.id === m.id && x.state === 'active'); if (ct) { ct.state = 'failed'; G.addRep(g, { reliability: -1 }); G.log(g, 'Failed: ' + ct.name + (m.why ? ' (' + U.cleanText(m.why, 80) + ')' : '') + '.'); G.bump(g); sendGang(g); } break; }
      case 'raidEnd': { if (c.id !== hostId) return; const g = db.gangs[m.gang]; const raid = g && g.raids.find(r => r.id === m.id); if (raid) { R.resolveRaid(g, raid, m.outcome === 'repelled' ? 'repelled' : 'breached', U.int(m.kills, 0, 99, 0)); sendGang(g); } break; }
      case 'kill': {
        // a rival gang member (from a camp, or a raider) fell to a clan member: the clan gains ground where it happened
        if (c.id !== hostId) return;
        const killer = db.players[m.by]; const g = killer && db.gangs[killer.gangId]; if (!g) return;
        const rid = m.rival && db.world.rivals[m.rival] ? m.rival : null;
        if (rid) { const r = db.world.rivals[rid], rel = R.rel(r, g.id); rel.hostility = Math.min(100, rel.hostility + 1.5); r.strength = Math.max(0, r.strength - 1); }
        if (typeof m.x === 'number') { const k = R.cellKey(m.x, m.y), cs = db.world.cells[k]; if (cs && cs.owner && cs.owner !== g.id && (cs.owner === rid || (cs.contest && cs.contest.by === g.id))) R.influence(g.id, k, 4); }
        break;
      }
      case 'mount': broadcast({ t: 'mount', id: p.id, owner: typeof m.owner === 'string' ? m.owner : p.id, seat: U.int(m.seat, 0, 1, 0) }); p.mounted = true; p.seat = U.int(m.seat, 0, 1, 0); p.mountOf = m.owner || p.id; break;
      case 'dismount': broadcast({ t: 'dismount', id: p.id }); p.mounted = false; p.seat = 0; p.mountOf = null; break;
      case 'questSync': { const g = db.gangs[p.gangId]; if (!g) return; g.world = g.world || {}; if (m.track !== undefined) g.world.track = m.track; if (m.quests && typeof m.quests === 'object') g.world.quests = m.quests; ctx.toGang(g, m, ws); break; }
      case 'questStart': { const g = db.gangs[p.gangId]; ctx.toGang(g, { t: 'questGo', id: m.id, at: Array.isArray(m.at) ? m.at : [p.x, p.y], ret: [p.x, p.y], by: p.id, title: U.cleanText(m.title, 60) }); break; }
      case 'questEnd': { const g = db.gangs[p.gangId]; ctx.toGang(g, { t: 'questEnd', id: m.id, ret: m.ret }); break; }
      case 'track': { const g = db.gangs[p.gangId]; if (!g) return; g.world = g.world || {}; g.world.track = m.id || null; ctx.toGang(g, { t: 'track', id: g.world.track }, ws); break; }
      case 'ping': send(ws, { t: 'pong', at: m.at, server: U.now() }); break;
      case 'away': { c.away = !!m.away; electHost(); break; }
    }
  }

  function onConnect(ws) {
    clients.set(ws, { ws, id: null, joinedAt: 0, known: new Set(), seen: new U.Seen(400), reqRate: new U.Rate(24, 2000), stateRate: new U.Rate(40, 1000), hitRate: new U.Rate(30, 1000), spawnRate: new U.Rate(10, 5000) });
  }
  function onClose(ws) {
    const c = clients.get(ws); if (!c) return;
    clients.delete(ws);
    if (c.id && byId.get(c.id) === c) {
      byId.delete(c.id);
      const p = db.players[c.id];
      if (p) { p.lastSeen = U.now(); if (p.horse && !p.mounted) p.horse.parked = true; p.mounted = false; p.mountOf = null; }
      broadcast({ t: 'leave', id: c.id, parked: p && p.horse && p.horse.parked ? { owner: p.id, name: p.name, horse: p.horse } : null });
      if (c.id === hostId) { hostId = null; electHost(); }
      if (!byId.size) npcTable.clear();
      touch();
      log('leave ' + ((p && p.name) || c.id) + ' · ' + byId.size + '/' + MAX_PLAYERS);
    }
  }
  // one second of the world: time passes only while someone is in it
  function tick(dt = 1) {
    if (!byId.size) return;
    // a host whose game has gone quiet for three seconds, while another player's is running, hands the island over
    const h = hostId && byId.get(hostId);
    if (h && h.lastState && U.now() - h.lastState > 3000 && [...byId.values()].some(o => o !== h && o.lastState && U.now() - o.lastState < 2000)) { h.stalled = true; electHost(); }
    R.advance(dt);
    if ((tick.n = (tick.n || 0) + 1) % 5 === 0) broadcast({ t: 'clock', clock: clockMsg() });
    // finished buildings show up for everyone right away, not only on the hour
    for (const g of Object.values(db.gangs)) if (g && g.structs && g.structs.some(s => s.state === 'building' && s.doneAt <= U.now())) { if (B.tick(g)) { sendGang(g); broadcast({ t: 'gangWorld', g: G.worldView(g) }); } }
  }
  ctx.hourly = () => { for (const g of Object.values(db.gangs)) if (g && g.members.some(id => byId.has(id))) sendGang(g); };
  ctx.daily = () => { broadcast({ t: 'territoryAll', territory: R.publicTerritory() }); broadcast({ t: 'rivals', rivals: R.publicRivals() }); };

  return { onConnect, onClose, onMsg, tick, ctx, G, B, L, R, get hostId() { return hostId; }, clients, byId, npcTable, MAX_PLAYERS };
}

module.exports = { createNet, MAX_PLAYERS, PROTOCOL };
