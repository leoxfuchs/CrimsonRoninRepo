'use strict';
// The clan's people and the world knocking on its gate: sworn NPCs with roles, moods and loyalties; visitors who come
// because of what the clan has become; and contracts that send the clan out into the world for real work.
const C = require('./catalog');
const U = require('./util');

const GIVEN = ['Jubei', 'Hanzo', 'Kojiro', 'Sakon', 'Gonbei', 'Isamu', 'Ryota', 'Daigo', 'Kaito', 'Shiro', 'Tetsu', 'Goro', 'Hikaru', 'Akane', 'Tomoe', 'Chiyo', 'Kaede', 'Yuki', 'Sora', 'Haru', 'Masa', 'Torao', 'Ikki', 'Botan', 'Nobu', 'Kiku', 'Rin', 'Sen', 'Taro', 'Jiro', 'Saburo', 'Kanbei', 'Mitsu', 'Oume', 'Fuyu', 'Kotaro', 'Genta', 'Hayato', 'Koga', 'Sayo'];
const FAMILY = ['Kurosawa', 'Yagyu', 'Hattori', 'Sanada', 'Mori', 'Date', 'Honda', 'Shimazu', 'Kato', 'Ishida', 'Otani', 'Tachibana', 'Ueno', 'Aso', 'Fujita', 'Nakamura', 'Ota', 'Sakai', 'Kondo', 'Hijikata', 'Okita', 'Saito', 'Inoue', 'Matsuda'];
const EPITHET = ['the Quiet', 'Red-Hand', 'of the Pass', 'Iron-Jaw', 'the Crow', 'Half-Moon', 'the Patient', 'Long-Spear', 'the Lucky', 'Ox-Back', 'the Fox', 'Thin-Blade'];
const STORY = {
  warrior: ['My lord died at Sekigahara. I have carried his sword long enough.', 'I heard your clan pays its people and keeps its word.', 'Three villages behind me. I am tired of running from bandits; I would rather run at them.'],
  veteran: ['I have fought for four lords. I would like the fifth to be worth it.', 'My knees are old. My spear is not.', 'They say your walls hold. I would like to grow old behind walls that hold.'],
  archer: ['I hunt boar in the hills. Men are slower.', 'I can put a spear through a knot at twenty paces.'],
  scout: ['I know every goat path from here to the sea.', 'I saw riders from a rival camp three nights ago. That knowledge has a price.'],
  craftsman: ['My forge burned with my village. Give me an anvil and I will earn my keep.', 'I build roofs that do not leak. In this country that is rare.'],
  farmer: ['Bandits take our rice every autumn. We would rather give it to someone who protects us.', 'We have strong backs and nowhere to go.'],
  healer: ['I go where the wounded are. I am told that is here.', 'Herbs, needles, a steady hand. And no questions about who I patched up before.'],
  ruthless: ['I do not ask whom I am cutting. I ask how much.', 'People are afraid of your clan. Good. So am I, a little. I like that.'],
  master: ['I have no more students. I would like a few more before I die.', 'Your fighters swing like farmers. I can fix that, for a price.'],
  merchant: ['Silk from the coast, iron from the hills. Your walls would make a fine market.', 'I sell to whoever keeps the roads safe.'],
  traveller: ['Only a roof for the night. I can pay in news.', 'The rain caught me on the road. Please.'],
  villager: ['Our village has a trouble only swords can fix.', 'We cannot pay much. We can pay in rice, and in gratitude.'],
  messenger: ['A sealed letter for the clan’s leader.', 'My master wants the work done quietly.'],
  wounded: ['They ambushed us on the road. Please, my brother is still out there.', 'I fought beside one of yours once. I am calling in the debt.'],
  envoy: ['My chief sends greetings, and a proposal.', 'There need not be blood between our clans. Not yet.'],
  informant: ['I saw armed men gathering by the border stones.', 'A rival camp is weaker than it looks. Interested?'],
  petitioner: ['A magistrate took my land. No one else will listen.', 'My daughter was taken. The officials say nothing can be done.'],
  noble: ['My lord requires discreet and capable people.', 'A matter of some delicacy, and considerable reward.'],
  kisaragi: ['A ronin on a grey horse, standing in the ruins of Kiyohara. People say he is Ren Kisaragi.', 'You should speak to him. Take his blade, and you take his secrets.']
};

function createLife(ctx, G) {
  const { db } = ctx;
  const L = {};
  const R0 = () => Math.random();

  L.randomLook = (R = R0, role) => {
    const look = { skin: Math.floor(R() * 5), hair: [0, 1, 2, 4, 7, 3][Math.floor(R() * 6)], hairCol: Math.floor(R() * 4), hat: [0, 0, 1, 2, 2, 3][Math.floor(R() * 6)], top: Math.floor(R() * 12), pattern: Math.floor(R() * 4), bottom: [2, 7, 0, 10, 9][Math.floor(R() * 5)], sash: Math.floor(R() * 12), face: Math.floor(R() * 6), scar: R() < 0.25 ? 1 + Math.floor(R() * 6) : 0 };
    if (role === 'shinobi') Object.assign(look, { hat: 6, top: 7, bottom: 7, sash: 2 });
    if (role === 'heavy' || role === 'bodyguard') look.hat = R() < 0.6 ? 4 : 3;
    if (role === 'medic' || role === 'farmer' || role === 'cook') look.hat = R() < 0.5 ? 2 : 0;
    return look;
  };
  L.name = (R = R0) => GIVEN[Math.floor(R() * GIVEN.length)] + ' ' + (R() < 0.18 ? EPITHET[Math.floor(R() * EPITHET.length)] : FAMILY[Math.floor(R() * FAMILY.length)]);
  L.traits = (R = R0, n = 2) => { const keys = Object.keys(C.TRAITS), out = []; while (out.length < n) { const k = keys[Math.floor(R() * keys.length)]; if (!out.includes(k)) out.push(k); } return out; };
  L.make = (role, o = {}) => {
    const R = o.R || R0, def = C.ROLES[role] || C.ROLES.swordsman, sk = U.clamp(def.skill + (o.skill || 0) + (R() - 0.5) * 0.2, 0.05, 0.95);
    return Object.assign({
      id: 'n' + (++db.seq.npc), name: o.name || L.name(R), look: o.look || L.randomLook(R, role), role, wpn: def.wpn[Math.floor(R() * def.wpn.length)], armor: def.armor,
      maxHp: Math.round(def.hp * (0.9 + sk * 0.3)), skill: Math.round(sk * 100) / 100, level: 1, xp: 0, morale: 60, loyalty: 50, traits: o.traits || L.traits(R),
      rank: 'recruit', origin: o.origin || 'hired', joinedDay: ctx.clock().day, kills: 0, downs: 0, injuredUntil: 0, alive: true,
      assign: { job: def.fight ? 'follow' : 'work', post: null, follow: null, at: null }, wage: Math.round(4 + sk * 10), history: []
    }, o.extra || {});
  };
  ctx.npcFromLegacy = (m) => {
    const n = L.make('swordsman', { name: U.cleanName(m.name, 'Ronin'), look: m.look && typeof m.look === 'object' ? m.look : undefined, origin: 'old camp' });
    n.wpn = typeof m.wpn === 'string' ? m.wpn : 'katana'; n.maxHp = U.int(m.maxHp, 40, 200, 90); n.skill = U.num(m.skill, 0.05, 0.95, 0.5); n.level = U.int(m.level, 1, 30, 1); n.loyalty = 70;
    return n;
  };
  L.beds = (g) => G.fx(g).beds;
  L.alive = (g) => g.npcs.filter(n => n.alive !== false);
  L.cap = (g) => Math.min(G.stage(g).npcs, L.beds(g));
  L.room = (g) => L.alive(g).length < L.cap(g);
  L.find = (g, id) => g.npcs.find(n => n.id === id && n.alive !== false) || null;

  // a hire from an inn (the game's own recruit list): its numbers are clamped and paid for here
  L.hire = (g, p, rec) => {
    if (!L.room(g)) return 'No beds for another sworn blade. Build quarters or barracks (and grow the clan).';
    const cost = U.int(rec && rec.cost, 0, 5000, 0);
    const have = (p.gold | 0) + (p.bank | 0); if (have < cost) return 'Not enough mon (need ' + cost + ').';
    const fromCarry = Math.min(p.gold | 0, cost); p.gold -= fromCarry; p.bank = (p.bank | 0) - (cost - fromCarry);
    const n = L.make('swordsman', { name: U.cleanName(rec && rec.name, 'Ronin'), look: rec && rec.look && typeof rec.look === 'object' ? rec.look : undefined, origin: 'hired at an inn' });
    if (rec && typeof rec.wpn === 'string' && ['katana', 'wakizashi', 'yari', 'naginata', 'nodachi', 'kanabo', 'tanto'].includes(rec.wpn)) n.wpn = rec.wpn;
    n.skill = U.num(rec && rec.skill, 0.1, 0.8, n.skill); n.maxHp = U.int(rec && rec.maxHp, 50, 160, n.maxHp); n.armor = U.int(rec && rec.armor, 0, 2, n.armor);
    // a blade hired on the road walks with the one who paid them until told otherwise
    n.assign = Object.assign(n.assign || {}, { job: 'follow', follow: p.id });
    g.npcs.push(n); G.log(g, n.name + ' swore to the clan (hired by ' + p.name + ').'); G.bump(g);
    return null;
  };
  L.dismiss = (g, pid, nid) => {
    if (!G.can(g, pid, 'assign')) return 'Your rank may not dismiss clan members.';
    const n = L.find(g, nid); if (!n) return 'They are not here.';
    n.alive = false; n.leftDay = ctx.clock().day; g.npcs = g.npcs.filter(x => x.alive !== false || x === n);
    G.log(g, n.name + ' was released from the clan.'); G.bump(g);
    return null;
  };
  L.assign = (g, pid, nid, m) => {
    if (!G.can(g, pid, 'assign')) return 'Your rank may not give clan members orders.';
    const n = L.find(g, nid); if (!n) return 'They are not here.';
    const job = U.pickOne(m.job, C.ASSIGN, n.assign.job);
    const out = { job, post: null, follow: null, at: null };
    if (job === 'follow' || job === 'escort') out.follow = g.members.includes(m.follow) ? m.follow : pid;
    if (job === 'guard' || job === 'hold' || job === 'patrol') out.post = Array.isArray(m.post) && m.post.length === 2 ? [U.num(m.post[0], -9999, 9999), U.num(m.post[1], -9999, 9999)] : null;
    if (job === 'patrol' && Array.isArray(m.route)) out.route = m.route.slice(0, 8).map(q => [U.num(q[0], -9999, 9999), U.num(q[1], -9999, 9999)]);
    if (job === 'work' || job === 'train') { const s = g.structs.find(s => s.id === m.at); out.at = s ? s.id : null; }
    n.assign = out;
    if (m.rank && ['recruit', 'member', 'veteran', 'elite', 'officer', 'captain', 'commander'].includes(m.rank)) n.rank = m.rank;
    if (m.role && C.ROLES[m.role] && (m.role === n.role || C.ROLES[m.role].fight === C.ROLES[n.role].fight)) { n.role = m.role; const d = C.ROLES[m.role]; if (!d.wpn.includes(n.wpn)) n.wpn = d.wpn[0]; }
    G.bump(g);
    return null;
  };
  L.renameNpc = (g, pid, nid, name) => { if (!G.can(g, pid, 'assign')) return 'Your rank may not do that.'; const n = L.find(g, nid); if (!n) return 'They are not here.'; n.name = U.cleanName(name, n.name); G.bump(g); return null; };

  // ---- the hour and the day for the clan's people: training, recovery, wages, food, mood, and sometimes goodbye
  L.hour = (g) => {
    const f = G.fx(g); let ch = false;
    for (const n of L.alive(g)) {
      if (n.injuredUntil && n.injuredUntil < U.now()) { n.injuredUntil = 0; ch = true; }
      if (n.assign.job === 'train' || (C.ROLES[n.role] && C.ROLES[n.role].fight && n.assign.job === 'rest')) {
        const gainXp = (n.assign.job === 'train' ? 2 + f.train : 0.5) * (n.traits.includes('disciplined') ? 1.4 : n.traits.includes('lazy') ? 0.6 : 1);
        n.xp += gainXp; ch = true;
        while (n.xp >= 40 + n.level * 30) { n.xp -= 40 + n.level * 30; n.level++; n.skill = Math.min(0.95, Math.round((n.skill + 0.025) * 1000) / 1000); n.maxHp += 4; G.log(g, n.name + ' trained hard: level ' + n.level + '.'); if (n.level === 4 && n.rank === 'recruit') n.rank = 'member'; if (n.level === 8 && n.rank === 'member') n.rank = 'veteran'; if (n.level === 12 && n.rank === 'veteran') n.rank = 'elite'; }
      }
    }
    return ch;
  };
  L.day = (g) => {
    const f = G.fx(g), people = L.alive(g);
    if (!people.length) return;
    const foodUse = people.length * (1 + Math.max(-0.4, f.foodUse)) * (1 + ((g.hq && g.hq.traits || []).reduce((a, t) => a + ((C.TRAITS_HQ[t] || {}).upkeep || 0), 0)));
    const wages = people.reduce((a, n) => a + n.wage, 0);
    const fed = g.res.food >= foodUse, paid = g.res.mon >= wages;
    g.res.food = Math.max(0, g.res.food - foodUse); g.res.mon = Math.max(0, g.res.mon - (paid ? wages : g.res.mon));
    const leaving = [];
    for (const n of people) {
      let dm = (f.morale || 0) * 0.5 + (fed ? 1 : -8) + (paid ? 1 : -6) - (n.injuredUntil ? 2 : 0);
      if (n.traits.includes('cheerful')) dm += 1; if (n.traits.includes('greedy') && !paid) dm -= 4; if (n.traits.includes('drinker') && f.morale > 6) dm += 1;
      n.morale = Math.round(U.clamp(n.morale + dm, 0, 100));
      let dl = (n.morale > 60 ? 1 : n.morale < 30 ? -3 : 0) + (n.traits.includes('loyal') ? 1 : 0) + (g.rep.honor > 20 ? 0.5 : 0) - (g.rep.honor < -20 && n.traits.includes('honest') ? 2 : 0);
      n.loyalty = Math.round(U.clamp(n.loyalty + dl, 0, 100));
      if (n.loyalty < 12 && n.morale < 25 && !n.traits.includes('loyal')) leaving.push(n);
      else if (n.loyalty < 25 && n.morale < 35 && !n.warned) { n.warned = true; G.log(g, n.name + ' is unhappy and talks about leaving (morale ' + n.morale + ', loyalty ' + n.loyalty + ').'); ctx.toGang(g, { t: 'toast', msg: n.name + ' is unhappy and may leave the clan.', kind: 'shame' }); }
      else if (n.loyalty >= 30) n.warned = false;
    }
    for (const n of leaving) { n.alive = false; n.leftDay = ctx.clock().day; G.log(g, n.name + ' left the clan in the night (unpaid, unfed or unhappy).'); ctx.toGang(g, { t: 'toast', msg: n.name + ' has left the clan.', kind: 'shame' }); }
    if (!fed) G.log(g, 'Not enough food: the clan went hungry.');
    if (!paid) G.log(g, 'Wages went unpaid.');
    g.npcs = g.npcs.filter(n => n.alive !== false || (ctx.clock().day - (n.leftDay || 0)) < 3);
    G.bump(g);
  };
  // a clan NPC went down in a fight (the host reports it): they are wounded, never killed outright
  L.down = (g, nid) => {
    const n = L.find(g, nid); if (!n) return;
    n.downs = (n.downs || 0) + 1;
    if (n.downs >= 3) { n.injuredUntil = U.now() + 25 * 60 * 1000 * (G.fx(g).npcHeal ? 0.5 : 1); n.downs = 0; n.morale = Math.max(0, n.morale - 10); G.log(g, n.name + ' is badly hurt and will rest until healed.'); }
    G.bump(g);
  };
  L.kill = (g, nid) => { const n = L.find(g, nid); if (!n) return; n.kills = (n.kills || 0) + 1; n.xp += 6; if (n.kills % 10 === 0) G.log(g, n.name + ' has ' + n.kills + ' kills.'); };

  // ---- visitors: how likely the next knock is, and who it is
  L.appeal = (g) => {
    const f = G.fx(g), st = G.stage(g).n;
    let a = 0.04 + st * 0.03 + f.appeal * 0.006 + Math.max(0, g.rep.honor) * 0.001 + Math.max(0, g.rep.fear) * 0.0006 + Math.max(0, g.rep.wealth) * 0.0008 + g.renown * 0.00002;
    if (g.hq && g.hq.traits.includes('road')) a += 0.03;
    if (g.hq && g.hq.traits.includes('town')) a += 0.04;
    return Math.min(0.6, a);
  };
  L.pickVisitor = (g, R = R0) => {
    const st = G.stage(g).n, rep = g.rep, pool = [];
    for (const [k, v] of Object.entries(C.VISITORS)) {
      if ((v.stage || 0) > st) continue;
      let w = v.weight;
      if (v.needs === 'honor') w *= rep.honor >= -10 ? 1 + Math.max(0, rep.honor) / 30 : 0.2;
      if (v.needs === 'fear') w *= rep.fear > 5 ? 1 + rep.fear / 20 : 0.1;
      if (v.needs === 'prosperity') w *= 1 + Math.max(0, rep.wealth) / 20 + G.fx(g).trade / 30;
      if (v.kind === 'recruit' && !L.room(g)) w *= 0.25;
      if (v.kind === 'diplomacy' && !Object.keys(db.world.rivals || {}).length) w = 0;
      if (k === 'kisaragi' && !L.renReady(g)) w = 0;
      if (v.rare) w *= 0.4;
      if (w > 0) pool.push([k, w]);
    }
    let r = R() * pool.reduce((a, [, w]) => a + w, 0);
    for (const [k, w] of pool) { if ((r -= w) <= 0) return k; }
    return pool.length ? pool[0][0] : 'traveller';
  };
  L.renReady = (g) => {
    const r = db.world.ren;
    if (r && (r.state === 'done' || r.state === 'seek' || r.state === 'met')) return false;
    if (!g || !g.hq) return false;
    if (g.visitors.some(v => v.tpl === 'kisaragi' && v.state === 'waiting')) return false;
    return g.members.some(id => ctx.online(id) && ((ctx.player(id) || {}).honor || 0) >= 50);
  };
  L.beginRen = (g) => {
    db.world.ren = { state: 'seek', gang: g.id, x: 649, y: 426 };
    g.world = g.world || {}; g.world.ren = db.world.ren;
    G.log(g, 'Word of a ronin in the ruins of Kiyohara. They say he is Ren Kisaragi.');
    G.bump(g); ctx.touch();
  };
  L.finishRen = (g) => {
    db.world.ren = { state: 'done', gang: g && g.id };
    if (g) { g.world = g.world || {}; g.world.ren = db.world.ren; G.log(g, 'Ren Kisaragi walked on. No one in this world will see him again.'); G.bump(g); }
    ctx.touch();
  };
  L.visit = (g, tplKey, R = R0) => {
    if (tplKey === 'kisaragi' && !L.renReady(g)) return null;
    const tpl = C.VISITORS[tplKey]; if (!tpl) return null;
    const v = { id: 'v' + (++db.seq.visitor), tpl: tplKey, kind: tpl.kind, title: tpl.name, name: L.name(R), look: null, state: 'waiting', day: ctx.clock().day, expires: ctx.clock().day + 1 + (tpl.rare ? 1 : 0), asked: false, line: (STORY[tplKey] || ['…'])[Math.floor(R() * (STORY[tplKey] || ['…']).length)] };
    if (tpl.kind === 'recruit') {
      const role = tpl.roles[Math.floor(R() * tpl.roles.length)], rec = L.make(role, { R, skill: (tpl.skill || 0) + G.stage(g).n * 0.02, origin: 'came to the gate' });
      db.seq.npc--; delete rec.id;
      // the one at the gate is the one who joins: same name, same face
      rec.name = v.name; v.recruit = rec; v.look = rec.look; v.role = role; v.wants = { mon: Math.round(20 + rec.skill * 160 + (tpl.rare ? 200 : 0)) };
      v.risk = rec.traits.includes('greedy') || rec.traits.includes('ruthless') ? 'May cause trouble' : rec.traits.includes('loyal') ? 'Seems steadfast' : 'Unknown';
      // the clan's own policy turns some away before anyone has to answer the gate
      const P = g.recruit.policy || {};
      if (P.autoReject && ((P.minSkill && rec.skill < P.minSkill) || (P.roles && P.roles.length && !P.roles.includes(role)) || (P.maxRecruits && L.alive(g).filter(n => n.rank === 'recruit').length >= P.maxRecruits))) { G.log(g, 'The gate turned away ' + v.name + ' (' + (C.ROLES[role] || {}).name + '), as clan policy says.'); return null; }
    } else {
      v.look = L.randomLook(R, tplKey === 'merchant' ? 'merchant' : null);
      if (tpl.kind === 'contract') v.contract = L.contractFor(g, tplKey === 'noble' ? 'outpost' : null, R);
      if (tpl.kind === 'trade') v.offer = L.tradeOffer(g, R);
      if (tpl.kind === 'intel') v.offer = { mon: 40 + Math.floor(R() * 60), intel: L.intelLine(g, R) };
      if (tpl.kind === 'diplomacy') { const rv = ctx.pickRival(g, R); if (!rv) return null; v.rival = rv.id; v.offer = { kind: R() < 0.5 ? 'truce' : 'trade', rival: rv.name }; }
      if (tpl.kind === 'help') v.offer = { contract: L.contractFor(g, 'escort', R) };
    }
    if (v.contract === null) return null;
    g.visitors.push(v); if (g.visitors.length > 6) g.visitors.shift();
    G.log(g, 'At the gate: ' + v.title.toLowerCase() + ' (' + v.name + ').');
    ctx.toGang(g, { t: 'visitor', v });
    G.bump(g);
    return v;
  };
  L.tradeOffer = (g, R = R0) => {
    const goods = ['timber', 'stone', 'iron', 'cloth', 'food', 'herbs'], k = goods[Math.floor(R() * goods.length)], n = 10 + Math.floor(R() * 30);
    return { give: { [k]: n }, price: { mon: Math.round(n * (k === 'iron' ? 6 : k === 'cloth' ? 4 : 2.2) * (1 - Math.min(0.3, g.rep.wealth / 200))) } };
  };
  L.intelLine = (g, R = R0) => {
    const rv = ctx.pickRival(g, R);
    return rv ? (rv.name + ' have ' + (rv.strength > 60 ? 'many' : 'few') + ' fighters and ' + (rv.cells || []).length + ' districts. Their temper: ' + (C.TEMPERS[rv.temper] || {}).name + '.') : 'The roads are quiet. For now.';
  };
  L.decide = (g, pid, vid, choice, m = {}) => {
    if (!G.can(g, pid, 'visitors')) return 'Your rank may not answer the gate.';
    const v = g.visitors.find(x => x.id === vid && x.state === 'waiting'); if (!v) return 'They have already gone.';
    choice = U.pickOne(choice, C.GATE_CHOICES, null); if (!choice) return 'That is not an answer.';
    const name = (ctx.player(pid) || {}).name, close = (msg) => { v.state = 'answered'; G.log(g, msg); g.visitors = g.visitors.filter(x => x !== v); G.bump(g); return null; };
    if (choice === 'ask') { v.asked = true; G.bump(g); return null; }
    if (choice === 'later') { v.state = 'waiting'; v.expires = ctx.clock().day + 2; v.later = true; return close(name + ' asked ' + v.name + ' to come back another day.'); }
    if (choice === 'rejectPolite') { G.addRep(g, { honor: 0.3 }); return close(name + ' politely turned ' + v.name + ' away.'); }
    if (choice === 'rejectFirm') { G.addRep(g, { fear: 0.6, honor: -0.3 }); return close(name + ' sent ' + v.name + ' away, hard.'); }
    if (choice === 'delegate' || choice === 'specialist') {
      const off = L.alive(g).find(n => ['officer', 'captain', 'commander'].includes(n.rank));
      if (!off) return 'No officer among the clan’s NPCs to hand this to. Promote one first.';
      choice = v.kind === 'recruit' ? (v.recruit.skill >= (g.recruit.policy.minSkill || 0.3) && L.room(g) ? 'accept' : 'rejectPolite') : v.kind === 'contract' ? 'contract' : v.kind === 'shelter' ? 'shelter' : 'rejectPolite';
      G.log(g, off.name + ' handled ' + v.name + ' at the gate.');
      if (choice === 'rejectPolite') { G.addRep(g, { honor: 0.2 }); return close(off.name + ' turned ' + v.name + ' away.'); }
    }
    if (v.kind === 'recruit') {
      if (choice === 'test' || choice === 'demonstrate') { v.trial = true; v.state = 'trial'; G.bump(g); return null; }
      if (choice === 'negotiate') { const cut = g.rep.influence > 10 || g.rep.might > 10 ? 0.35 : 0.15; if (!v.negotiated) { v.wants.mon = Math.round(v.wants.mon * (1 - cut)); v.negotiated = true; if (v.recruit.traits.includes('proud')) v.recruit.loyalty -= 10; } G.bump(g); return null; }
      if (choice === 'accept' || choice === 'pay') {
        if (!L.room(g)) return 'No beds for them. Build quarters or barracks first.';
        const fee = choice === 'pay' ? { mon: v.wants.mon } : { mon: Math.round(v.wants.mon * 0.25) };
        if (!G.pay(g, fee)) return 'The treasury cannot pay their price (' + fee.mon + ' mon).';
        const n = Object.assign(v.recruit, { id: 'n' + (++db.seq.npc), joinedDay: ctx.clock().day });
        if (choice === 'pay') n.loyalty += 10; if (v.trialWon) { n.loyalty += 15; n.morale += 10; }
        n.history = [(v.trialWon ? 'Proved themselves at the gate. ' : '') + 'Came to the gate on day ' + v.day + '.'];
        g.npcs.push(n); G.addRep(g, { generosity: choice === 'pay' ? 0.5 : 0 }); G.addRenown(g, 4, null);
        return close(n.name + ' (' + C.ROLES[n.role].name + ') joined the clan at the gate.');
      }
    }
    if (choice === 'shelter') { if (!G.pay(g, { food: 2 })) return 'Not even two bowls of rice to spare.'; G.addRep(g, { generosity: 1, honor: 0.5 }); G.addRenown(g, 2, null); if (Math.random() < 0.3) { G.gain(g, { mon: 30 + Math.floor(Math.random() * 60) }); G.log(g, v.name + ' left a gift of mon in the morning.'); } return close(name + ' gave ' + v.name + ' a roof for the night.'); }
    if (choice === 'contract' && (v.contract || (v.offer && v.offer.contract))) { const c = v.contract || v.offer.contract; g.contracts.push(Object.assign(c, { state: 'offered', from: v.name })); return close(v.name + '’s request was written down: ' + c.name + '.'); }
    if (v.kind === 'trade' && (choice === 'accept' || choice === 'pay')) { if (!G.can(g, pid, 'spend')) return 'Your rank may not spend clan resources.'; if (!G.pay(g, v.offer.price)) return 'Not enough mon for that.'; G.gain(g, v.offer.give); G.addRep(g, { wealth: 0.5 }); return close('Bought ' + G.costText(v.offer.give) + ' from ' + v.name + '.'); }
    if (v.kind === 'intel' && (choice === 'pay' || choice === 'accept')) { if (!G.pay(g, { mon: v.offer.mon })) return 'Not enough mon for that.'; G.log(g, 'Intelligence: ' + v.offer.intel); G.addRep(g, { influence: 0.5 }); return close(v.name + ' was paid for news.'); }
    if (v.kind === 'diplomacy' && choice === 'accept') { const err = ctx.diplomacy(g, pid, v.rival, v.offer.kind, true); if (err) return err; return close('Accepted the envoy’s proposal: ' + v.offer.kind + ' with ' + v.offer.rival + '.'); }
    if (v.kind === 'help' && choice === 'accept') { const c = v.offer.contract; if (c) g.contracts.push(Object.assign(c, { state: 'offered', from: v.name })); G.addRep(g, { honor: 1 }); return close('Agreed to help ' + v.name + '.'); }
    if (v.kind === 'rumor' && (choice === 'accept' || choice === 'contract')) {
      if (db.world.ren && db.world.ren.state === 'done') return 'That man is already gone from this world.';
      if (db.world.ren && db.world.ren.state !== 'done' && db.world.ren.gang !== g.id) return 'Someone else already rides to meet him.';
      if (!g.members.some(id => ctx.online(id) && ((ctx.player(id) || {}).honor || 0) >= 50)) return 'He will not be found unless someone of honour is here (50 honour or more).';
      L.beginRen(g);
      return close(name + ' heard the traveller out. Ren Kisaragi waits in the ruins of Kiyohara.');
    }
    return 'That answer does not fit this visitor.';
  };
  // the duel at the gate: the deciding player fought them, and the client reports who won
  L.trial = (g, pid, vid, won) => {
    const v = g.visitors.find(x => x.id === vid && x.state === 'trial'); if (!v) return 'No trial with them.';
    v.state = 'waiting'; v.trialDone = true; v.trialWon = !won;
    if (won) { v.recruit.skill = Math.max(0.05, v.recruit.skill - 0.02); v.wants.mon = Math.round(v.wants.mon * 0.6); G.addRep(g, { might: 0.5 }); G.log(g, (ctx.player(pid) || {}).name + ' beat ' + v.name + ' at the gate. They ask for less now.'); }
    else { v.recruit.skill = Math.min(0.95, v.recruit.skill + 0.05); v.recruit.loyalty += 10; G.log(g, v.name + ' beat ' + (ctx.player(pid) || {}).name + ' at the gate. A fighter worth having.'); }
    G.bump(g);
    return null;
  };
  L.hourVisitors = (g, R = R0) => {
    if (!g.hq) return;
    for (const v of g.visitors) if (v.state === 'waiting' && v.expires <= ctx.clock().day) { v.state = 'gone'; G.log(g, v.name + ' grew tired of waiting and left.'); if (v.kind === 'contract') G.addRep(g, { reliability: -0.3 }); }
    g.visitors = g.visitors.filter(v => v.state !== 'gone');
    if (g.visitors.filter(v => v.state === 'waiting').length >= 4) return;
    if (L.renReady(g) && R() < 0.28) { L.visit(g, 'kisaragi', R); return; }
    if (R() < L.appeal(g) / 4) L.visit(g, L.pickVisitor(g, R), R);
  };

  // ---- contracts: a real job at a real place (the host spawns the people it needs when a member gets near)
  L.placeFor = (g, R = R0, o = {}) => {
    const info = db.world.info; const places = info && Array.isArray(info.places) ? info.places.filter(p => p.kind === 'town' || p.kind === 'poi' || (o.coast && p.coast)) : [];
    const from = g.hq ? [g.hq.x, g.hq.y] : [100, 100];
    const near = places.map(p => [p, U.dist(p.x, p.y, from[0], from[1])]).filter(([, d]) => d > 60 && d < 900).sort((a, b) => a[1] - b[1]).slice(0, 12);
    if (!near.length) return { id: 'road', name: 'the north road', x: from[0] + 80, y: from[1] - 40 };
    const [p] = near[Math.floor(R() * near.length)];
    return { id: p.id, name: p.name, x: p.x, y: p.y, cell: p.cell || null };
  };
  L.contractFor = (g, key, R = R0) => {
    const keys = Object.keys(C.CONTRACTS).filter(k => C.CONTRACTS[k].diff <= 2 + G.stage(g).n);
    const k = key || keys[Math.floor(R() * keys.length)], T = C.CONTRACTS[k]; if (!T) return null;
    let place = L.placeFor(g, R, { coast: T.coast }), rival = null;
    if (T.camp || k === 'scoutRival') {
      const camps = Object.values(db.world.camps || {}).filter(c => !c.cleared);
      const from = g.hq ? [g.hq.x, g.hq.y] : [100, 100];
      const c = camps.map(c => [c, U.dist(c.x, c.y, from[0], from[1])]).sort((a, b) => a[1] - b[1]).slice(0, 6)[Math.floor(R() * 6)];
      if (c) { place = { id: c[0].id, name: c[0].name || 'the camp', x: c[0].x, y: c[0].y, cell: c[0].cell || null, camp: c[0].id }; rival = c[0].rival; }
    }
    const rv = rival && db.world.rivals[rival];
    // an escort starts somewhere real: the merchant waits at another town, and you walk him from there to the place
    let pickup = null;
    if (T.kind === 'escort') {
      for (let i = 0; i < 8 && !pickup; i++) { const q = L.placeFor(g, R); if (q.id !== place.id && U.dist(q.x, q.y, place.x, place.y) > 70 && U.dist(q.x, q.y, place.x, place.y) < 700) pickup = q; }
      if (!pickup) pickup = { id: 'road', name: 'the road out of ' + place.name, x: place.x - 90, y: place.y + 40 };
    }
    const n = T.n ? T.n[0] + Math.floor(R() * (T.n[1] - T.n[0] + 1)) : 1;
    const reward = Math.round(T.reward[0] + R() * (T.reward[1] - T.reward[0]) * (1 + G.stage(g).n * 0.1));
    return {
      id: 'c' + (++db.seq.contract), tpl: k, kind: T.kind, name: T.name.replace('{place}', place.name).replace('{rival}', rv ? rv.name : 'rival gang'), place, rival, pickup, met: false,
      n, need: T.kind === 'kill' ? n : T.kind === 'defend' ? T.waves : 1, got: 0, foes: T.foes || null, boss: !!T.boss, res: T.res || null,
      reward: { mon: reward }, rep: T.rep, renown: T.renown, diff: T.diff, territory: !!T.territory, state: 'offered', day: ctx.clock().day, expires: ctx.clock().day + 4, by: null, chain: k === 'raiders' ? 'outpost' : null
    };
  };
  L.accept = (g, pid, cid) => {
    const c = g.contracts.find(x => x.id === cid); if (!c) return 'That contract is gone.';
    if (c.state !== 'offered') return 'That contract is already ' + c.state + '.';
    if (c.territory && !G.can(g, pid, 'war')) return 'Taking a rival’s outpost starts a fight over land. Your rank may not start one.';
    if (g.contracts.filter(x => x.state === 'active').length >= 3 + Math.floor(G.stage(g).n / 2)) return 'The clan already has as much work under way as it can handle.';
    c.state = 'active'; c.by = pid; c.expires = ctx.clock().day + 3;
    G.log(g, (ctx.player(pid) || {}).name + ' took on: ' + c.name + '.'); G.bump(g);
    ctx.contractStarted(g, c);
    L.stockBoard(g);
    return null;
  };
  L.abandon = (g, pid, cid) => {
    const c = g.contracts.find(x => x.id === cid && x.state === 'active'); if (!c) return 'No such job under way.';
    if (c.by !== pid && !G.can(g, pid, 'war')) return 'Only whoever took it (or an officer) can give it up.';
    c.state = 'failed'; G.addRep(g, { reliability: -1 }); G.log(g, 'Gave up on: ' + c.name + '.'); G.bump(g);
    ctx.contractEnded(g, c);
    return null;
  };
  // progress is reported by the host (kills of the contract's own tagged foes, an arrival, a wave held) or checked here
  L.progress = (g, cid, n = 1, by) => {
    const c = g.contracts.find(x => x.id === cid && x.state === 'active'); if (!c) return false;
    c.got = Math.min(c.need, c.got + n);
    if (c.got >= c.need) L.complete(g, c, by);
    else G.bump(g);
    return true;
  };
  L.complete = (g, c, by) => {
    c.state = 'done'; c.doneDay = ctx.clock().day;
    G.gain(g, c.reward); G.addRep(g, c.rep); G.addRep(g, { reliability: 1 }); G.addRenown(g, c.renown, c.name);
    if (c.place && c.place.cell) ctx.influence(g.id, c.place.cell, c.territory ? 45 : 12);
    if (c.place && c.place.camp) ctx.campTaken(g, c.place.camp);
    ctx.toGang(g, { t: 'contractDone', c: { id: c.id, name: c.name, reward: c.reward } });
    G.log(g, 'Done: ' + c.name + ' (+' + c.reward.mon + ' mon).');
    if (c.chain) { const nx = L.contractFor(g, c.chain); if (nx) { g.contracts.push(nx); G.log(g, 'A new request follows: ' + nx.name + '.'); } }
    ctx.contractEnded(g, c);
    L.stockBoard(g);
    G.bump(g);
  };
  L.deliver = (g, pid, cid) => {
    const c = g.contracts.find(x => x.id === cid && x.state === 'active'); if (!c) return 'No such job under way.';
    if (c.kind !== 'deliver') return 'That job is not a delivery.';
    const p = ctx.player(pid); if (!p || U.dist(p.x, p.y, c.place.x, c.place.y) > 30) return 'Bring it there first (' + c.place.name + ').';
    if (!G.pay(g, c.res)) return 'The clan’s store does not have ' + G.costText(c.res) + '.';
    L.complete(g, c, pid); return null;
  };
  L.dayContracts = (g) => {
    const d = ctx.clock().day;
    for (const c of g.contracts) if ((c.state === 'offered' || c.state === 'active') && c.expires < d) { c.state = c.state === 'active' ? 'failed' : 'expired'; if (c.state === 'failed') { G.addRep(g, { reliability: -1.5 }); G.log(g, 'Too late: ' + c.name + '.'); ctx.contractEnded(g, c); } }
    g.contracts = g.contracts.filter(c => (c.state !== 'done' && c.state !== 'expired' && c.state !== 'failed') || d - (c.doneDay || c.day) < 3);
    L.stockBoard(g);
  };
  // the board at the gate is never bare: a couple of jobs are always pinned to it, more as the clan grows, and of different kinds
  L.stockBoard = (g, R = R0) => {
    if (!g.hq) return 0; let added = 0;
    const want = 2 + G.fx(g).contracts;
    for (let tries = 0; tries < 12 && g.contracts.filter(c => c.state === 'offered').length < want; tries++) {
      const c = L.contractFor(g, null, R); if (!c) break;
      if (g.contracts.some(x => x.state === 'offered' && x.kind === c.kind) && tries < 8) { db.seq.contract--; continue; }
      g.contracts.push(c); added++; G.log(g, 'Pinned to the board: ' + c.name + '.');
    }
    return added;
  };

  return L;
}

module.exports = { createLife };
