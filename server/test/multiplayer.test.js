'use strict';
// The shared world over real sockets: five players and no more, one world host handed on when it leaves, one clock,
// requests answered once, clan permissions, building conflicts, NPCs passed by distance, cuts routed to the host,
// and a world that comes back the same after the server restarts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, Player, sleep } = require('./helpers');

test('five players share the world; a sixth is turned away', async () => {
  const S = await startServer();
  try {
    const ps = [];
    for (let i = 0; i < 5; i++) { const p = new Player(S.url, 'P' + i); const w = await p.join(); assert.equal(w.t, 'welcome', 'player ' + i + ' welcomed'); ps.push(p); }
    const sixth = new Player(S.url, 'Six'); const w = await sixth.join();
    assert.equal(w.t, 'full');
    // a player already in the world may come back on a new tab (it replaces the old one), even when the world is full
    const again = new Player(S.url, 'P0', ps[0].token); const w2 = await again.join();
    assert.equal(w2.t, 'welcome'); assert.equal(w2.id, ps[0].id);
    await ps[0].wait(m => m.t === 'replaced');
    for (const p of ps.slice(1)) await p.close(); await again.close(); await sixth.close();
  } finally { await S.stop(); }
});

test('the first player hosts the world; when the host leaves the next takes over with the NPC table', async () => {
  const S = await startServer();
  try {
    const a = new Player(S.url, 'Aiko'), b = new Player(S.url, 'Ben');
    const wa = await a.join(); assert.equal(wa.isHost, true);
    const wb = await b.join(); assert.equal(wb.isHost, false); assert.equal(wb.host, a.id);
    a.send({ t: 'npcs', full: [{ id: 'w1', name: 'Bandit', faction: 'bandit' }], list: [['w1', 108, 130, 0, 50, 'idle']] });
    await sleep(100);
    await a.close();
    const h = await b.wait(m => m.t === 'host' && m.you === true);
    assert.equal(h.id, b.id);
    assert.ok(h.npcs.some(e => e.full.id === 'w1'), 'the new host receives the NPCs it must take over');
    await b.close();
  } finally { await S.stop(); }
});

test('a host that puts the game away hands the island to someone still playing; it moves back only when that one goes away', async () => {
  const S = await startServer();
  try {
    const a = new Player(S.url, 'Aiko'), b = new Player(S.url, 'Ben');
    await a.join(); await b.join();
    a.send({ t: 'npcs', full: [{ id: 'w2', name: 'Ronin', faction: 'ronin' }], list: [['w2', 108, 130, 0, 60, 'idle']] });
    await sleep(80);
    a.send({ t: 'away', away: true });
    const hb = await b.wait(m => m.t === 'host' && m.you === true);
    assert.ok(hb.npcs.some(e => e.full.id === 'w2'), 'the new host takes over the people the old one ran');
    await b.wait(m => m.t === 'clans');
    const ha = await a.wait(m => m.t === 'host' && m.you === false); assert.equal(ha.id, b.id);
    // coming back does not take the island back while the new host is playing
    a.send({ t: 'away', away: false }); await sleep(150);
    assert.ok(!a.msgs.some(m => m.t === 'host' && m.you === true));
    // the old host is a guest now and is told about the new host's people afresh
    b.send({ t: 'npcs', full: [{ id: 'w3', name: 'Guard', faction: 'guard' }], list: [['w3', 108, 131, 0, 80, 'idle']] });
    const n = await a.wait(m => m.t === 'npcs' && (m.full || []).some(f => f.id === 'w3'));
    assert.ok(n.list.some(q => q[0] === 'w3'));
    // when the new host is away too, and nobody is playing, nothing changes hands
    b.send({ t: 'away', away: true }); await sleep(150);
    const back = await a.wait(m => m.t === 'host' && m.you === true);
    assert.equal(back.id, a.id, 'a player who is still playing takes the island back from one who has gone away');
    await a.close(); await b.close();
  } finally { await S.stop(); }
});

test('a host whose game stops running is replaced by a player whose game still runs', async () => {
  const S = await startServer();
  try {
    const a = new Player(S.url, 'Aiko'), b = new Player(S.url, 'Ben');
    await a.join(); await b.join();
    const st = (p, x) => p.send({ t: 'state', x, y: 130, face: 0, hp: 100, maxHp: 100, wpn: 'katana', pose: 'idle' });
    st(a, 108); st(b, 110);
    // Ben keeps playing; Aiko's game goes quiet
    const keep = setInterval(() => st(b, 110), 300);
    try {
      const h = await b.wait(m => m.t === 'host' && m.you === true, 7000);
      assert.equal(h.id, b.id);
    } finally { clearInterval(keep); }
    await a.close(); await b.close();
  } finally { await S.stop(); }
});

test('a horse standing beside you is sent to the other player', async () => {
  const S = await startServer();
  try {
    const a = new Player(S.url, 'Aiko'), b = new Player(S.url, 'Ben');
    await a.join(); await b.join();
    a.send({ t: 'state', x: 108, y: 130, face: 0, hp: 100, maxHp: 100, wpn: 'katana', pose: 'idle', mounted: false, horse: { x: 110.5, y: 132.25, face: 0.4, spd: 0, coat: 2, name: 'Kumo' } });
    const st = await b.wait(m => m.t === 'state' && m.id === a.id && m.horse && m.horse.x === 110.5);
    assert.equal(st.horse.y, 132.25);
    assert.equal(st.horse.coat, 2);
    assert.equal(st.horse.name, 'Kumo');
    assert.equal(st.mounted, false);
    await a.close(); await b.close();
  } finally { await S.stop(); }
});

test('state packets carry gold, ping, clan and rank for the player list', async () => {
  const S = await startServer();
  try {
    const a = new Player(S.url, 'Aiko'), b = new Player(S.url, 'Ben');
    const wa = await a.join(); await b.join();
    a.send({ t: 'state', x: 108, y: 130, face: 0, hp: 100, maxHp: 100, wpn: 'katana', pose: 'idle', gold: 777, ping: 42 });
    const st = await b.wait(m => m.t === 'state' && m.id === wa.id && m.gold === 777);
    assert.equal(st.ping, 42);
    assert.ok(st.clan, 'clan name is on the wire');
    assert.ok(st.rankName, 'rank name is on the wire');
    await a.close(); await b.close();
  } finally { await S.stop(); }
});

test('one clock for everybody, and it moves', async () => {
  const S = await startServer();
  try {
    const a = new Player(S.url, 'A'), b = new Player(S.url, 'B');
    const wa = await a.join(); const wb = await b.join();
    assert.ok(Math.abs(wa.clock.tod - wb.clock.tod) < 0.01);
    const ca = await a.wait(m => m.t === 'clock', 7000), cb = await b.wait(m => m.t === 'clock', 7000);
    assert.equal(ca.clock.day, cb.clock.day);
    assert.ok(Math.abs(ca.clock.tod - cb.clock.tod) < 0.002, 'both players hear the same time');
    assert.ok(ca.clock.tod > wa.clock.tod, 'time moves on');
    await a.close(); await b.close();
  } finally { await S.stop(); }
});

test('a request sent twice is done once', async () => {
  const S = await startServer();
  try {
    const a = new Player(S.url, 'Rich'); const w = await a.join();
    const gold0 = w.you.gold;
    a.send({ t: 'req', op: 'contribute', res: 'mon', n: 100, rid: 'same-1' });
    a.send({ t: 'req', op: 'contribute', res: 'mon', n: 100, rid: 'same-1' });
    const r = await a.wait(m => m.t === 'res' && m.rid === 'same-1');
    assert.equal(r.ok, true);
    await sleep(200);
    assert.equal(a.msgs.filter(m => m.t === 'res' && m.rid === 'same-1').length, 0, 'no second answer');
    assert.equal(r.gold + r.bank, gold0 - 100);
    const g = await a.wait(m => m.t === 'gang');
    assert.equal(g.gang.res.mon, 100);
    await a.close();
  } finally { await S.stop(); }
});

test('invitations, ranks and what each rank may do', async () => {
  const S = await startServer();
  try {
    const a = new Player(S.url, 'Leader'), b = new Player(S.url, 'Recruit');
    await a.join(); await b.join();
    let r = await a.req('invite', { to: 'recruit' }); assert.equal(r.ok, true, r.err);
    const inv = await b.wait(m => m.t === 'invite');
    r = await b.req('acceptInvite', { id: inv.inv.id }); assert.equal(r.ok, true, r.err);
    const ga = await a.wait(m => m.t === 'gang' && m.gang.members.length === 2);
    assert.equal(ga.gang.ranks[b.id], 5, 'new members start as recruits');
    r = await a.req('placeHQ', { site: 'kusamura' }); assert.equal(r.ok, true, r.err);
    r = await b.req('build', { kind: 'yard', x: 114, y: 117, rot: 0 }); assert.equal(r.ok, false); assert.match(r.err, /rank/);
    r = await b.req('kick', { id: a.id }); assert.equal(r.ok, false);
    r = await a.req('setRank', { id: b.id, rank: 3 }); assert.equal(r.ok, true, r.err);
    r = await a.req('contribute', { res: 'mon', n: 200 }); assert.equal(r.ok, true, r.err);
    r = await b.req('build', { kind: 'yard', x: 114, y: 117, rot: 0 }); assert.equal(r.ok, false); assert.match(r.err, /spend/, 'a veteran may build but not spend, by default');
    r = await a.req('ranks', { perms: { spend: 3 } }); assert.equal(r.ok, true, r.err);
    r = await b.req('build', { kind: 'yard', x: 114, y: 117, rot: 0 }); assert.equal(r.ok, true, r.err);
    r = await a.req('transfer', { id: b.id, confirm: 'wrong name' }); assert.equal(r.ok, false);
    r = await a.req('transfer', { id: b.id, confirm: 'Recruit' }); assert.equal(r.ok, true, r.err);
    const gb = await b.wait(m => m.t === 'gang' && m.gang.leader === b.id);
    assert.equal(gb.gang.ranks[a.id], 1, 'the old leader becomes commander');
    await a.close(); await b.close();
  } finally { await S.stop(); }
});

test('building: cost, footprint, the gate’s way, and two players building on the same spot', async () => {
  const S = await startServer();
  try {
    const a = new Player(S.url, 'Ama'), b = new Player(S.url, 'Bo');
    await a.join(); await b.join();
    let r = await a.req('invite', { to: 'Bo' }); const inv = await b.wait(m => m.t === 'invite'); await b.req('acceptInvite', { id: inv.inv.id });
    await a.req('setRank', { id: b.id, rank: 2 });
    r = await a.req('placeHQ', { site: 'kusamura' }); assert.equal(r.ok, true, r.err);
    await a.req('contribute', { res: 'mon', n: 220 });
    r = await a.req('build', { kind: 'dojo', x: 400, y: 400 }); assert.equal(r.ok, false); assert.match(r.err, /Outside/);
    r = await a.req('build', { kind: 'dojo', x: 105, y: 133 }); assert.equal(r.ok, false); assert.match(r.err, /gate/);
    // both ask for the same ground at once: exactly one gets it
    a.send({ t: 'req', op: 'build', kind: 'yard', x: 112, y: 121, rid: 'ra' });
    b.send({ t: 'req', op: 'build', kind: 'yard', x: 113, y: 122, rid: 'rb' });
    const [x, y] = [await a.wait(m => m.rid === 'ra'), await b.wait(m => m.rid === 'rb')];
    assert.equal([x.ok, y.ok].filter(Boolean).length, 1, 'one succeeds, one is told the ground is taken');
    assert.match((x.ok ? y : x).err, /already stands/);
    const g = await a.wait(m => m.t === 'gang' && m.gang.structs.some(s => s.kind === 'yard'));
    assert.equal(g.gang.structs.filter(s => s.kind === 'yard').length, 1);
    assert.ok(g.gang.res.mon <= 220 - 60, 'the yard was paid for once');
    await a.close(); await b.close();
  } finally { await S.stop(); }
});

test('NPCs reach each player by distance; cuts at them go to the host; the host’s cuts reach their target', async () => {
  const S = await startServer();
  try {
    const host = new Player(S.url, 'Host'), b = new Player(S.url, 'Near');
    await host.join(); await b.join();
    b.send({ t: 'state', x: 200, y: 200, face: 0, hp: 100, maxHp: 100, wpn: 'katana', pose: 'idle' });
    await sleep(80);
    host.send({ t: 'npcs', full: [{ id: 'near1', name: 'Bandit', faction: 'bandit' }, { id: 'far1', name: 'Guard', faction: 'guard' }], list: [['near1', 205, 201, 0, 50, 'idle'], ['far1', 900, 900, 0, 80, 'idle']] });
    const n1 = await b.wait(m => m.t === 'npcs');
    assert.deepEqual(n1.full.map(f => f.id), ['near1']);
    assert.ok(!n1.list.some(q => q[0] === 'far1'));
    b.send({ t: 'hit', id: 'near1', heavy: true, ang: 1, dmgMult: 1, wpn: 'katana' });
    const h = await host.wait(m => m.t === 'hit');
    assert.equal(h.from, b.id); assert.equal(h.id, 'near1'); assert.equal(h.heavy, true);
    host.send({ t: 'swingAt', to: b.id, from: 'near1', heavy: false, ang: 2 });
    const s = await b.wait(m => m.t === 'swingAt'); assert.equal(s.from, 'near1');
    // walking away: the NPC is let go
    b.send({ t: 'state', x: 2000, y: 2000, face: 0, hp: 100, maxHp: 100, wpn: 'katana', pose: 'idle' });
    await sleep(80);
    host.send({ t: 'npcs', list: [['near1', 205, 201, 0, 50, 'idle']] });
    const n2 = await b.wait(m => m.t === 'npcs' && m.gone.includes('near1'));
    assert.ok(n2);
    await host.close(); await b.close();
  } finally { await S.stop(); }
});

test('the world comes back the same after a restart, without duplicates', async () => {
  let S = await startServer();
  const dir = S.dir, port = S.port;
  let token, id;
  try {
    const a = new Player(S.url, 'Keeper'); const w = await a.join(); token = w.token; id = w.id;
    await a.req('placeHQ', { site: 'hanaori' });
    await a.req('contribute', { res: 'mon', n: 100 });
    const r = await a.req('build', { kind: 'yard', x: 61, y: 154 }); assert.equal(r.ok, true, r.err);
    await a.close();
  } finally { await S.stop(); }
  S = await startServer({ dir, port });
  try {
    const a = new Player(S.url, 'Keeper', token); const w = await a.join();
    assert.equal(w.id, id);
    assert.equal(w.gang.hq.site, 'hanaori');
    assert.equal(w.gang.structs.filter(s => s.kind === 'yard').length, 1);
    assert.equal(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'world.json'), 'utf8')).players).length, 1);
    await a.close();
  } finally { await S.stop(); }
});

test('a version 1 world is carried forward: camp, buildings and sworn blade', async () => {
  const { tmpDir } = require('./helpers');
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'world.json'), JSON.stringify({
    players: { p_old: { id: 'p_old', token: 'tok-old', name: 'Old Hand', gold: 50, bank: 0, gangId: 'g_old', x: 78, y: 80 } },
    gangs: { g_old: { id: 'g_old', name: 'Old Hand’s gang', leader: 'p_old', members: ['p_old'], slot: 3, buildings: { quarters: 2, forge: 1, walls: 3, dojo: 0 }, npc: { id: 'n1', name: 'Jubei', wpn: 'yari', maxHp: 110, skill: 0.6, level: 3 } } },
    invites: []
  }));
  const S = await startServer({ dir });
  try {
    const a = new Player(S.url, 'Old Hand', 'tok-old'); const w = await a.join();
    assert.equal(w.gang.hq.site, 'yukimura');
    assert.ok(w.gang.structs.some(s => s.kind === 'quarters' && s.tier === 2));
    assert.ok(w.gang.structs.some(s => s.kind === 'forge'));
    assert.equal(w.gang.wall.stage, 6, 'stone walls stay stone');
    assert.equal(w.gang.npcs[0].name, 'Jubei'); assert.equal(w.gang.npcs[0].wpn, 'yari');
    await a.close();
  } finally { await S.stop(); }
});

test('stables sell better horses, gated by how far the stalls have grown', async () => {
  const S = await startServer();
  try {
    const a = new Player(S.url, 'Ama'), b = new Player(S.url, 'Bo');
    const wa = await a.join(); await b.join();
    assert.equal(wa.catalog.HORSES.nag.cost, 180);
    let r = await a.req('placeHQ', { site: 'kusamura' }); assert.equal(r.ok, true, r.err);
    r = await a.req('contribute', { res: 'mon', n: 200 }); assert.equal(r.ok, true, r.err);
    let placed = null;
    for (const [x, y] of [[108, 117], [94, 117], [94, 125], [109, 125]]) {
      r = await a.req('build', { kind: 'stables', x, y, rot: 0 });
      if (r.ok) { placed = { x, y }; break; }
    }
    assert.ok(placed, r.err);
    r = await b.req('buyHorse', { id: 'nag' });
    assert.equal(r.ok, false); assert.match(r.err, /stables/);
    b.send({ t: 'state', x: placed.x + 7, y: placed.y + 2, face: 0, hp: 100, maxHp: 100, wpn: 'katana', pose: 'idle' });
    await sleep(80);
    r = await b.req('buyHorse', { id: 'fine' });
    assert.equal(r.ok, false); assert.match(r.err, /Improve/);
    r = await b.req('buyHorse', { id: 'road' });
    assert.equal(r.ok, false); assert.match(r.err, /Improve/);
    r = await b.req('buyHorse', { id: 'nag' });
    assert.equal(r.ok, true, r.err);
    assert.equal(r.data.horse.name, 'Nag');
    assert.equal(r.data.horse.spdMul, 0.78);
    assert.equal(r.data.gold, 60);
    r = await b.req('buyHorse', { id: 'nag' });
    assert.equal(r.ok, false); assert.match(r.err, /already/);
    await a.close(); await b.close();
  } finally { await S.stop(); }
});

test('stone yards and lumber mills stand on open ground; the right ground doubles what they give', async () => {
  const S = await startServer();
  try {
    const a = new Player(S.url, 'Ama');
    const w = await a.join();
    assert.equal(w.catalog.BUILD.quarry.boost, 'rock');
    assert.equal(w.catalog.BUILD.lumberyard.boost, 'trees');
    assert.ok(!w.catalog.BUILD.quarry.near);
    assert.ok(!w.catalog.BUILD.lumberyard.near);
    let r = await a.req('placeHQ', { site: 'kusamura' }); assert.equal(r.ok, true, r.err);
    r = await a.req('contribute', { res: 'mon', n: 200 }); assert.equal(r.ok, true, r.err);
    let quarry = null, mill = null;
    for (const [x, y] of [[108, 117], [94, 117], [94, 125], [109, 125]]) {
      if (!quarry) {
        r = await a.req('build', { kind: 'quarry', x, y, rot: 0 });
        if (r.ok) quarry = { x, y };
      } else if (!mill) {
        r = await a.req('build', { kind: 'lumberyard', x, y, rot: 0 });
        if (r.ok) mill = { x, y };
      }
    }
    assert.ok(quarry, 'stone yard should stand on open ground');
    assert.ok(mill, 'lumber mill should stand on open ground');
    let g = await a.wait(m => m.t === 'gang' && m.gang.structs.some(s => s.kind === 'lumberyard'));
    assert.equal(g.gang.fx.prod.stone, 5);
    assert.equal(g.gang.fx.prod.timber, 6);
    const qid = g.gang.structs.find(s => s.kind === 'quarry').id;
    const lid = g.gang.structs.find(s => s.kind === 'lumberyard').id;
    r = await a.req('move', { id: qid, x: quarry.x, y: quarry.y, rot: 0, terrainOk: true, boost: true });
    assert.equal(r.ok, true, r.err);
    r = await a.req('move', { id: lid, x: mill.x, y: mill.y, rot: 0, terrainOk: true, boost: true });
    assert.equal(r.ok, true, r.err);
    g = await a.wait(m => m.t === 'gang' && m.gang.structs.some(s => s.kind === 'quarry' && s.boost) && m.gang.structs.some(s => s.kind === 'lumberyard' && s.boost));
    assert.equal(g.gang.fx.prod.stone, 10);
    assert.equal(g.gang.fx.prod.timber, 12);
    await a.close();
  } finally { await S.stop(); }
});

test('a forest settlement doubles the lumber mill without rocky or wooded tiles', async () => {
  const S = await startServer();
  try {
    const a = new Player(S.url, 'Ama');
    await a.join();
    let r = await a.req('placeHQ', { site: 'hanaori' }); assert.equal(r.ok, true, r.err);
    r = await a.req('contribute', { res: 'mon', n: 80 }); assert.equal(r.ok, true, r.err);
    let mill = null;
    for (const [x, y] of [[56, 153], [45, 153], [60, 164], [48, 164]]) {
      r = await a.req('build', { kind: 'lumberyard', x, y, rot: 0 });
      if (r.ok) { mill = { x, y }; break; }
    }
    assert.ok(mill, r.err);
    const g = await a.wait(m => m.t === 'gang' && m.gang.structs.some(s => s.kind === 'lumberyard'));
    const s = g.gang.structs.find(x => x.kind === 'lumberyard');
    assert.equal(s.boost, true);
    assert.equal(g.gang.fx.prod.timber, 16);
    await a.close();
  } finally { await S.stop(); }
});
