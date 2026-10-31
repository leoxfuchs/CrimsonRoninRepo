'use strict';
// The clan's rules without sockets: a world in memory, players as fake connections, time pushed forward by hand.
const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../lib/store');
const { createNet } = require('../lib/net');
const C = require('../lib/catalog');

function world() {
  const db = store.fresh(), sent = [];
  const net = createNet({ db, touch() {}, log() {} });
  const sock = () => { const ws = { readyState: 1, out: [], send(s) { this.out.push(JSON.parse(s)); sent.push(JSON.parse(s)); }, close() { this.readyState = 3; } }; net.onConnect(ws); return ws; };
  const join = (name, token) => { const ws = sock(); net.onMsg(ws, JSON.stringify({ t: 'hello', v: 2, name, token })); const w = ws.out.find(m => m.t === 'welcome'); return { ws, id: w.id, token: w.token, p: db.players[w.id] }; };
  let rid = 0;
  const req = (pl, op, args = {}) => { const id = 'r' + (++rid); net.onMsg(pl.ws, JSON.stringify(Object.assign({ t: 'req', op, rid: id }, args))); return pl.ws.out.filter(m => m.t === 'res' && m.rid === id).pop(); };
  const gang = pl => db.gangs[db.players[pl.id].gangId];
  return { db, net, join, req, gang, sent };
}
const info = () => ({
  ver: 't1', seed: 20240917,
  cells: [{ k: '0,0', cx: 0, cy: 0, prov: 'Edo Plain', b: 'Kusamura Plains', land: 1, towns: 2, forest: 0.4, mtn: 0.1 }, { k: '1,0', cx: 1, cy: 0, prov: 'Edo Plain', b: 'Kusamura Plains', land: 1, towns: 1, forest: 0.6 }, { k: '2,0', cx: 2, cy: 0, prov: 'Fuji Highlands', b: 'Matsu Forest', land: 1, mtn: 0.8 }, { k: '0,1', cx: 0, cy: 1, prov: 'Edo Plain', b: 'Kusamura Plains', land: 1 }],
  places: [{ id: 'town1', name: 'Mizuhama', x: 300, y: 120, kind: 'town', cell: '1,0' }, { id: 'town2', name: 'Hatakemura', x: 520, y: 90, kind: 'town', cell: '2,0' }],
  camps: [{ id: 'camp1', name: 'Akaba Camp', x: 560, y: 100, gang: 'Red Sashes', boss: 'Akaba no Tora', crew: 4, cell: '2,0' }, { id: 'camp2', name: 'Matsu Hollow', x: 600, y: 140, gang: 'Red Sashes', boss: 'Kiku', crew: 3, cell: '2,0' }],
  sites: []
});

test('settling: a small camp first, and the rules of the ground', () => {
  const W = world(); const a = W.join('Founder');
  let r = W.req(a, 'build', { kind: 'dojo', x: 100, y: 100 }); assert.equal(r.ok, false); assert.match(r.err, /settle/);
  r = W.req(a, 'placeHQ', { site: 'kusamura' }); assert.equal(r.ok, true, r.err);
  const g = W.gang(a);
  assert.deepEqual(g.structs.map(s => s.kind).sort(), ['banner', 'hearth', 'shelter']);
  assert.equal(g.wall.stage, 1, 'a makeshift barricade, no more');
  const b = W.join('Rival founder');
  r = W.req(b, 'placeHQ', { site: 'kusamura' }); assert.equal(r.ok, false); assert.match(r.err, /holds that ground/);
  r = W.req(b, 'placeHQ', { site: 'hanamachi' }); assert.equal(r.ok, true, r.err);
  r = W.req(a, 'build', { kind: 'granddojo', x: 110, y: 115 }); assert.equal(r.ok, false); assert.match(r.err, /Regional power/);
  r = W.req(a, 'wallUp'); assert.equal(r.ok, false, 'walls cost mon the new clan does not have'); assert.match(r.err, /short/);
  W.gang(a).res.mon = 200;
  r = W.req(a, 'wallUp'); assert.equal(r.ok, true, r.err); assert.equal(W.gang(a).wall.stage, 2);
  r = W.req(a, 'placeHQ', { site: 'yukimura' }); assert.equal(r.ok, false); assert.match(r.err, /Confirm/);
});

test('buildings finish on the server’s clock, upgrades need a bigger clan, demolishing gives half back', () => {
  const W = world(); const a = W.join('Builder');
  W.req(a, 'placeHQ', { site: 'kusamura' });
  const g = W.gang(a); g.res.mon = 5000; g.res.timber = 500; g.res.stone = 500; g.res.iron = 100;
  let r = W.req(a, 'build', { kind: 'forge', x: 112, y: 118 }); assert.equal(r.ok, true, r.err);
  const s = g.structs.find(x => x.kind === 'forge');
  assert.equal(s.state, 'done'); assert.equal(W.net.G.fx(g).dmg, 8);
  s.state = 'building'; s.doneAt = Date.now() - 1; g._fx = null; g._fxv = -1;
  assert.equal(W.net.G.fx(g).dmg, 0, 'an unfinished forge sharpens nothing');
  W.net.B.tick(g);
  assert.equal(s.state, 'done'); assert.equal(W.net.G.fx(g).dmg, 8);
  r = W.req(a, 'upgrade', { id: s.id }); assert.equal(r.ok, false); assert.match(r.err, /grow/);
  g.renown = 500; r = W.req(a, 'upgrade', { id: s.id }); assert.equal(r.ok, true, r.err); assert.equal(s.tier, 2);
  s.doneAt = Date.now() - 1; W.net.B.tick(g);
  const mon0 = g.res.mon;
  r = W.req(a, 'demolish', { id: s.id }); assert.equal(r.ok, false); assert.ok(r.confirm, 'a tier-2 building asks for confirmation');
  r = W.req(a, 'demolish', { id: s.id, confirm: true }); assert.equal(r.ok, true, r.err);
  assert.equal(g.res.mon, mon0 + (120 + 320) * 0.5);
  r = W.req(a, 'demolish', { id: g.structs.find(x => x.kind === 'hearth').id, confirm: true }); assert.equal(r.ok, false, 'the last fire stays');
});

test('restyle and colours are kept at once, and the compound version moves so every client rebuilds', () => {
  const W = world(); const a = W.join('Stylist');
  W.req(a, 'placeHQ', { site: 'kusamura' });
  const g = W.gang(a);
  const s = g.structs.find(x => x.kind === 'shelter');
  const ver = g.ver;
  let r = W.req(a, 'restyle', { id: s.id, style: { preset: 'luxury', roof: 'copper' } });
  assert.equal(r.ok, true, r.err);
  assert.ok(g.ver > ver, 'restyle bumps the compound so clients redraw');
  assert.equal(s.style.preset, 'luxury');
  assert.equal(s.style.roof, 'copper');
  assert.equal(s.state, 'done');
  const ver2 = g.ver;
  r = W.req(a, 'palette', { palette: { roof: '#a8321e', wall: '#e6dcc4' } });
  assert.equal(r.ok, true, r.err);
  assert.ok(g.ver > ver2, 'colours bump the compound too');
  assert.equal(g.palette.roof, '#a8321e');
});

test('visitors come to a clan with a home, more to a renowned one; the gate decides who stays', () => {
  const W = world(); const a = W.join('Gatekeeper');
  const g = W.gang(a);
  for (let i = 0; i < 400; i++) W.net.L.hourVisitors(g);
  assert.equal(g.visitors.length, 0, 'nobody comes to a clan without a home');
  W.req(a, 'placeHQ', { site: 'kusamura' });
  const low = W.net.L.appeal(g); g.renown = 2500; g.rep.honor = 40; const high = W.net.L.appeal(g);
  assert.ok(high > low * 2, 'renown and honour bring more visitors (' + low.toFixed(3) + ' → ' + high.toFixed(3) + ')');
  const v = W.net.L.visit(g, 'warrior');
  assert.equal(v.kind, 'recruit'); assert.ok(v.recruit && v.wants.mon > 0);
  g.res.mon = 1000;
  let r = W.req(a, 'visitor', { id: v.id, choice: 'accept' }); assert.equal(r.ok, true, r.err);
  assert.equal(g.npcs.length, 1); assert.equal(g.npcs[0].origin, 'came to the gate');
  // no more beds: the gate cannot take more than the clan can house
  for (let i = 0; i < 6; i++) g.npcs.push(W.net.L.make('farmer'));
  const v2 = W.net.L.visit(g, 'veteran');
  r = W.req(a, 'visitor', { id: v2.id, choice: 'accept' }); assert.equal(r.ok, false); assert.match(r.err, /beds/);
  r = W.req(a, 'visitor', { id: v2.id, choice: 'rejectPolite' }); assert.equal(r.ok, true);
  assert.equal(g.visitors.filter(x => x.state === 'waiting').length, 0);
  // the recruitment policy turns the wrong people away before anyone has to
  g.npcs = []; W.req(a, 'recruit', { policy: { autoReject: true, roles: ['medic'], minSkill: 0.9 } });
  assert.equal(W.net.L.visit(g, 'warrior'), null);
});

test('clan NPCs: training, wages, food, and leaving when neglected', () => {
  const W = world(); const a = W.join('Sensei'); W.req(a, 'placeHQ', { site: 'kusamura' });
  const g = W.gang(a); const n = W.net.L.make('swordsman', { traits: ['quiet', 'proud'] }); g.npcs.push(n);
  let r = W.req(a, 'assignNpc', { id: n.id, job: 'train' }); assert.equal(r.ok, true, r.err);
  const lv0 = n.level; for (let i = 0; i < 200; i++) W.net.L.hour(g); assert.ok(n.level > lv0, 'training raises the level');
  g.res.food = 0; g.res.mon = 0; n.loyalty = 20; n.morale = 20;
  for (let i = 0; i < 10 && n.alive !== false; i++) W.net.L.day(g);
  assert.equal(n.alive, false, 'unpaid and unfed, they leave');
  assert.ok(g.log.some(l => /left the clan/.test(l.msg)));
});

test('the Kisaragi rumor needs an honourable member online, and meeting him is once', () => {
  const W = world(); const a = W.join('Honour');
  W.req(a, 'placeHQ', { site: 'kusamura' });
  const g = W.gang(a);
  a.p.honor = 10;
  assert.equal(W.net.L.visit(g, 'kisaragi'), null, 'low honour does not bring him');
  a.p.honor = 50;
  const v = W.net.L.visit(g, 'kisaragi');
  assert.ok(v); assert.equal(v.kind, 'rumor');
  let r = W.req(a, 'visitor', { id: v.id, choice: 'accept' });
  assert.equal(r.ok, true, r.err);
  assert.equal(W.db.world.ren.state, 'seek');
  assert.equal(W.net.L.visit(g, 'kisaragi'), null, 'the rumor does not come twice');
  r = W.req(a, 'renDone');
  assert.equal(r.ok, true, r.err);
  assert.equal(W.db.world.ren.state, 'done');
  a.p.honor = 80;
  assert.equal(W.net.L.visit(g, 'kisaragi'), null, 'once he is gone he stays gone');
});

test('a leader long gone hands the clan on; a short absence never does', () => {
  const W = world(); const a = W.join('Old leader'), b = W.join('Steady');
  W.req(a, 'invite', { to: 'Steady' }); const inv = W.db.invites.find(i => i.to === b.id); W.req(b, 'acceptInvite', { id: inv.id });
  const g = W.gang(a); W.req(a, 'setRank', { id: b.id, rank: 2 });
  assert.equal(W.net.G.checkSuccession(g), false, 'the leader is here');
  W.net.onClose(a.ws);
  W.db.players[a.id].lastSeen = Date.now() - 3 * 24 * 3600e3;
  assert.equal(W.net.G.checkSuccession(g), false, 'three days away is not abandonment');
  W.db.players[a.id].lastSeen = Date.now() - 20 * 24 * 3600e3; W.db.players[b.id].lastSeen = Date.now();
  assert.equal(W.net.G.checkSuccession(g), true);
  assert.equal(g.leader, b.id); assert.equal(g.ranks[a.id], 1);
});

test('land: claims border what you hold; rivals’ land is contested, not taken by one kill', () => {
  const W = world(); const a = W.join('Lord');
  assert.equal(W.net.R.setInfo(info(), a.id), null);
  assert.ok(W.db.world.rivals.r_red_sashes, 'the island’s outlaw gangs become rivals');
  assert.equal(W.db.world.cells['2,0'].owner, 'r_red_sashes');
  W.req(a, 'placeHQ', { site: 'kusamura' });
  const g = W.gang(a); g.res.mon = 5000; g.res.food = 500;
  let r = W.req(a, 'claim', { k: '0,1' }); assert.equal(r.ok, true, r.err);
  r = W.req(a, 'claim', { k: '1,0' }); assert.equal(r.ok, false); assert.match(r.err, /cannot hold more|three people/);
  g.renown = 400; for (let i = 0; i < 3; i++) g.npcs.push(W.net.L.make('guard'));
  r = W.req(a, 'claim', { k: '1,0' }); assert.equal(r.ok, true, r.err);
  r = W.req(a, 'claim', { k: '2,0' }); assert.equal(r.ok, false); assert.match(r.err, /Contest/);
  r = W.req(a, 'contest', { k: '2,0' }); assert.equal(r.ok, true, r.err);
  W.net.R.influence(g.id, '2,0', 4);
  assert.equal(W.db.world.cells['2,0'].owner, 'r_red_sashes', 'one kill does not move a border');
  W.net.R.campCleared('camp1', [a.id]);
  W.net.R.campCleared('camp2', [a.id]);
  W.net.R.influence(g.id, '2,0', 30);
  assert.equal(W.db.world.cells['2,0'].owner, g.id, 'taking both outposts and fighting there wins the district');
  assert.ok(g.claims.includes('2,0'));
});

test('raids: seen coming with scouts, and settled by walls and guards when nobody is home', () => {
  const W = world(); const a = W.join('Defender');
  W.net.R.setInfo(info(), a.id);
  W.req(a, 'placeHQ', { site: 'kusamura' });
  const g = W.gang(a); g.res.food = 200; g.res.timber = 200;
  const r = W.db.world.rivals.r_red_sashes;
  W.net.R.scheduleRaid(g, r, 20);
  const raid = g.raids[0];
  W.net.onClose(a.ws);
  W.db.clock.day += 2; W.net.R.raidDue(g);
  assert.equal(raid.done, true);
  assert.ok(g.log.some(l => /broke in|held/.test(l.msg)));
  const raid2 = (W.net.R.scheduleRaid(g, r, 1), g.raids[g.raids.length - 1]);
  g.wall.stage = 8; g.ver++;
  W.db.clock.day += 2; W.net.R.raidDue(g);
  assert.equal(raid2.done, true);
  assert.ok(g.log.slice(-3).some(l => /held/.test(l.msg)), 'stone walls hold against a small band');
});

test('contracts are real work: progress is counted, rewards and land follow', () => {
  const W = world(); const a = W.join('Contractor');
  W.net.R.setInfo(info(), a.id); W.req(a, 'placeHQ', { site: 'kusamura' });
  const g = W.gang(a);
  const c = W.net.L.contractFor(g, 'bandits'); g.contracts.push(c);
  let r = W.req(a, 'acceptContract', { id: c.id }); assert.equal(r.ok, true, r.err);
  const mon0 = g.res.mon;
  for (let i = 0; i < c.need; i++) W.net.L.progress(g, c.id, 1);
  assert.equal(c.state, 'done'); assert.equal(g.res.mon, mon0 + c.reward.mon);
  const d = W.net.L.contractFor(g, 'deliver'); g.contracts.push(d); W.req(a, 'acceptContract', { id: d.id });
  r = W.req(a, 'deliver', { id: d.id }); assert.equal(r.ok, false); assert.match(r.err, /there first/);
  W.db.players[a.id].x = d.place.x; W.db.players[a.id].y = d.place.y; g.res.food = 100;
  r = W.req(a, 'deliver', { id: d.id }); assert.equal(r.ok, true, r.err);
  // a duel is fought in the game of whoever took it: only they, and only there, can say it is answered
  const b = W.join('Second'); W.req(a, 'invite', { to: b.id }); const inv = W.db.invites.find(i => i.to === b.id); W.req(b, 'acceptInvite', { id: inv.id });
  const du = W.net.L.contractFor(g, 'duel'); g.contracts.push(du); r = W.req(a, 'acceptContract', { id: du.id }); assert.equal(r.ok, true, r.err);
  W.db.players[a.id].x = du.place.x + 80; W.db.players[a.id].y = du.place.y + 80;
  r = W.req(a, 'duelDone', { id: du.id }); assert.equal(r.ok, false); assert.match(r.err, /not at/);
  W.db.players[b.id].x = du.place.x; W.db.players[b.id].y = du.place.y;
  r = W.req(b, 'duelDone', { id: du.id }); assert.equal(r.ok, false); assert.match(r.err, /someone else/);
  W.db.players[a.id].x = du.place.x + 3; W.db.players[a.id].y = du.place.y;
  r = W.req(a, 'duelDone', { id: du.id }); assert.equal(r.ok, true, r.err); assert.equal(du.state, 'done');
  r = W.req(a, 'duelDone', { id: du.id }); assert.equal(r.ok, false);
});

test('an escort starts at a real pickup: the host reports the meeting, and scouting counts on arrival', () => {
  const W = world(); const a = W.join('Escort'); const b = W.join('Other');
  W.net.R.setInfo(info(), a.id); W.req(a, 'placeHQ', { site: 'kusamura' });
  const g = W.gang(a);
  const e = W.net.L.contractFor(g, 'escort'); g.contracts.push(e);
  assert.ok(e.pickup, 'an escort has somewhere to meet the merchant');
  assert.ok(e.pickup.id !== e.place.id, 'and it is not the destination');
  assert.equal(e.met, false);
  let r = W.req(a, 'acceptContract', { id: e.id }); assert.equal(r.ok, true, r.err);
  const host = [a, b].find(p => p.id === W.net.hostId) || a, other = host === a ? b : a;
  W.net.onMsg(other.ws, JSON.stringify({ t: 'contractMet', gang: g.id, id: e.id }));
  assert.equal(e.met, false, 'only the world host can say the merchant set out');
  W.net.onMsg(host.ws, JSON.stringify({ t: 'contractMet', gang: g.id, id: e.id }));
  assert.equal(e.met, true);
  const s = W.net.L.contractFor(g, 'scoutRival'); g.contracts.push(s); W.req(a, 'acceptContract', { id: s.id });
  W.db.players[a.id].x = s.place.x + 200; W.db.players[a.id].y = s.place.y;
  r = W.req(a, 'arrive', { id: s.id }); assert.equal(r.ok, false);
  W.db.players[a.id].x = s.place.x + 20; W.db.players[a.id].y = s.place.y;
  r = W.req(a, 'arrive', { id: s.id }); assert.equal(r.ok, true, r.err); assert.equal(s.state, 'done');
});

test('the board at the gate is stocked on settling, with different kinds of work, and refilled as jobs are done', () => {
  const W = world(); const a = W.join('Boarder');
  W.net.R.setInfo(info(), a.id); W.req(a, 'placeHQ', { site: 'kusamura' });
  const g = W.gang(a), open = () => g.contracts.filter(c => c.state === 'offered');
  assert.ok(open().length >= 2, 'a new clan finds work pinned to its board');
  assert.ok(new Set(open().map(c => c.kind)).size >= 2, 'and not all of one kind');
  const c = open()[0]; let r = W.req(a, 'acceptContract', { id: c.id }); assert.equal(r.ok, true, r.err);
  W.net.L.progress(g, c.id, c.need);
  assert.equal(c.state, 'done'); assert.ok(open().length >= 2, 'a finished job makes room for another');
});

test('what a client sends is cleaned: emblems, uniforms and banners stay inside the editor’s limits', () => {
  const W = world(); const a = W.join('Painter');
  let r = W.req(a, 'emblem', { emblem: { shape: 'pentagram', field: 'red', layers: Array.from({ length: 20 }, () => ({ sym: 'dragon', s: 99, x: 5, color: '#00ff00' })) } });
  assert.equal(r.ok, true, r.err);
  const e = W.gang(a).emblem;
  assert.equal(e.shape, 'mon'); assert.equal(e.field, '#7a1f1c'); assert.equal(e.layers.length, C.EMBLEM.maxLayers); assert.equal(e.layers[0].s, 2); assert.equal(e.layers[0].x, 1);
  r = W.req(a, 'uniforms', { uniforms: { presets: [{ id: 'x', name: '<b>War</b>', top: { color: '#123456', pattern: 99 }, armor: { tier: 9 } }], assign: { ranks: { 0: 'x', 6: 'nope' } } } });
  assert.equal(r.ok, true, r.err);
  const u = W.gang(a).uniforms; assert.equal(u.presets[0].top.pattern, C.UNIFORM.patterns.length - 1); assert.equal(u.presets[0].armor.tier, 2); assert.equal(u.assign.ranks[6], undefined);
  r = W.req(a, 'banners', { banners: [] }); assert.equal(r.ok, false);
  r = W.req(a, 'identity', { name: 'x' }); assert.equal(r.ok, false);
  const b = W.join('Copycat');
  W.req(a, 'identity', { name: 'Crimson Lanterns', tag: 'CRL' });
  r = W.req(b, 'identity', { name: 'crimson lanterns' }); assert.equal(r.ok, false); assert.match(r.err, /already/);
});

test('an old clan with a co-leader seat migrates: commanders keep that rank, the title is gone', () => {
  const W = world(); const a = W.join('Boss'), b = W.join('Second'), c = W.join('Third');
  W.req(a, 'invite', { to: 'Second' }); W.req(b, 'acceptInvite', { id: W.db.invites.find(i => i.to === b.id).id });
  W.req(a, 'invite', { to: 'Third' }); W.req(c, 'acceptInvite', { id: W.db.invites.find(i => i.to === c.id).id });
  const g = W.gang(a);
  g.ranksVer = 1;
  g.rankTitles = ['Leader', 'Co-leader', 'Commander', 'Officer', 'Veteran', 'Member', 'Recruit'];
  g.ranks[b.id] = 1;
  g.ranks[c.id] = 2;
  g.perms = { invite: 3, storage: 5, diplomacy: 1, kick: 2 };
  g.palette.ranks = ['#1', '#2', '#3', '#4', '#5', '#6', '#7'];
  g.uniforms.assign.ranks = { 0: 'officer', 1: 'officer', 2: 'officer', 3: 'officer', 4: 'battle', 5: 'standard', 6: 'recruit' };
  W.net.G.normalize(g);
  assert.equal(g.ranksVer, 2);
  assert.deepEqual(g.rankTitles, ['Leader', 'Commander', 'Officer', 'Veteran', 'Member', 'Recruit']);
  assert.equal(g.ranks[b.id], 1, 'the co-leader becomes commander');
  assert.equal(g.ranks[c.id], 1, 'the commander stays commander');
  assert.equal(g.perms.storage, 4);
  assert.equal(g.perms.kick, 1);
  assert.equal(g.palette.ranks.length, 6);
  assert.equal(g.uniforms.assign.ranks[5], 'recruit');
  assert.equal(g.uniforms.assign.ranks[6], undefined);
});
