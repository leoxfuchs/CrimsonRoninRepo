'use strict';
// Everything a clan can be, build, wear and meet, as data. The world host owns this list and sends it to every client in
// the welcome, so the game and the server never disagree about a cost, a footprint or a permission.
// Visuals name only what the game can already draw: a building kind (Buildings.create), a prop (Props.draw) or a ground
// tile. Nothing here refers to an asset that does not exist.

const RES = {
  mon: { name: 'Mon', jp: '文' }, timber: { name: 'Timber', jp: '木' }, stone: { name: 'Stone', jp: '石' }, iron: { name: 'Iron', jp: '鉄' },
  food: { name: 'Food', jp: '米' }, cloth: { name: 'Cloth', jp: '布' }, herbs: { name: 'Herbs', jp: '薬' }
};
const RES_KEYS = Object.keys(RES);

// ranks, highest first. The founder is an honour held for good by whoever raised the clan, not a rank of its own
const RANKS = ['Leader', 'Commander', 'Officer', 'Veteran', 'Member', 'Recruit'];
const RANK_LEADER = 0, RANK_COMMANDER = 1, RANK_RECRUIT = RANKS.length - 1, RANK_MEMBER = RANKS.length - 2;
const PERMS = {
  invite: 'Invite players', approve: 'Approve applications', kick: 'Remove members', promote: 'Promote and demote',
  identity: 'Change name, motto and texts', emblem: 'Change emblem and banners', colors: 'Change clan colours', uniform: 'Change uniforms',
  build: 'Place and upgrade structures', demolish: 'Demolish structures', spend: 'Spend shared resources', storage: 'Use shared storage',
  assign: 'Give orders to clan NPCs', visitors: 'Answer visitors at the gate', recruit: 'Change recruitment policy',
  territory: 'Claim land', war: 'Start territorial conflicts', diplomacy: 'Make treaties'
};
// the lowest rank (largest index) allowed to do each thing, until the leader changes it
const DEFAULT_PERMS = {
  invite: 2, approve: 2, kick: 1, promote: 1, identity: 1, emblem: 1, colors: 1, uniform: 1, build: 3, demolish: 1, spend: 2,
  storage: 4, assign: 3, visitors: 3, recruit: 1, territory: 1, war: 1, diplomacy: 1
};
// a leader who stays away this long (in real days) hands the clan to the highest-ranked member who still comes
const SUCCESSION_DAYS = 14;

// from a lone founder to a legend; renown is earned (contracts, battles, building, visitors), never bought
const STAGES = [
  { n: 0, name: 'Lone founder', jp: '独', renown: 0, members: 3, npcs: 2, bound: [24, 20], claims: 1, tier: 1 },
  { n: 1, name: 'Small crew', jp: '組', renown: 120, members: 5, npcs: 4, bound: [30, 24], claims: 2, tier: 1 },
  { n: 2, name: 'Established gang', jp: '党', renown: 400, members: 8, npcs: 7, bound: [36, 30], claims: 4, tier: 2 },
  { n: 3, name: 'Recognized clan', jp: '家', renown: 1000, members: 12, npcs: 10, bound: [44, 36], claims: 7, tier: 2 },
  { n: 4, name: 'Regional power', jp: '藩', renown: 2200, members: 16, npcs: 14, bound: [52, 42], claims: 11, tier: 3 },
  { n: 5, name: 'Dominant faction', jp: '覇', renown: 4200, members: 20, npcs: 18, bound: [60, 48], claims: 16, tier: 3 },
  { n: 6, name: 'Legendary clan', jp: '伝', renown: 7500, members: 24, npcs: 24, bound: [68, 54], claims: 24, tier: 3 }
];
const REP_KEYS = ['honor', 'might', 'generosity', 'reliability', 'wealth', 'influence', 'fear'];

// ---- structures. vis: b = a building kind (with its door side), p = a prop, t = a ground tile filled over the footprint
// fx per tier: beds (clan NPCs housed), heal (sleep), hp, st, dmg, train (NPC xp an hour), prod (a day), store, def,
// appeal (visitors), trade (mon a day), intel, morale, horse, bandage. legacy keeps the old camp bonuses working.
const T = (mon, extra = {}, time = 1) => ({ cost: Object.assign({ mon }, extra), time });
const BUILD = {};
const add = (key, o) => { BUILD[key] = Object.assign({ key, max: 1, stage: 0, rot: true }, o); };
// living
add('shelter', { name: 'Basic shelter', cat: 'living', w: 6, h: 4, vis: { b: 'hut' }, max: 4, legacy: 'quarters', tiers: [T(40, { timber: 10 }, 15), T(90, { timber: 20 }), T(160, { timber: 30, cloth: 6 })], fx: [{ beds: 2, heal: 1 }, { beds: 3, heal: 1 }, { beds: 4, heal: 2 }], desc: 'A roof and a dry floor. Where it all starts.' });
add('quarters', { name: 'Shared sleeping quarters', cat: 'living', w: 8, h: 5, vis: { b: 'quarters' }, max: 4, legacy: 'quarters', tiers: [T(80, { timber: 20 }), T(220, { timber: 40, stone: 10 }), T(520, { timber: 60, stone: 30, cloth: 12 })], fx: [{ beds: 4, heal: 1 }, { beds: 6, heal: 2 }, { beds: 8, heal: 4 }], desc: 'A long row house of bedrolls. Sleep here to heal.' });
add('rooms', { name: 'Private rooms', cat: 'living', w: 8, h: 6, vis: { b: 'minka' }, max: 3, stage: 1, tiers: [T(160, { timber: 40 }), T(320, { timber: 50, stone: 20 }), T(600, { timber: 70, stone: 40, cloth: 20 })], fx: [{ beds: 3, morale: 2 }, { beds: 4, morale: 3 }, { beds: 5, morale: 5 }], desc: 'Rooms of their own. Members stay longer and grumble less.' });
add('officers', { name: 'Officer quarters', cat: 'living', w: 6, h: 8, vis: { b: 'machiya', door: 'S' }, stage: 2, tiers: [T(260, { timber: 50, stone: 20 }), T(520, { timber: 70, stone: 40, cloth: 20 })], fx: [{ beds: 2, morale: 3, train: 1 }, { beds: 3, morale: 4, train: 2 }], desc: 'Where the clan’s officers sleep and plan.' });
add('residence', { name: 'Leader’s residence', cat: 'living', w: 10, h: 7, vis: { b: 'headman' }, stage: 2, tiers: [T(400, { timber: 80, stone: 40 }), T(900, { timber: 120, stone: 80, cloth: 30 }), T(1800, { timber: 160, stone: 140, cloth: 60, iron: 20 })], fx: [{ appeal: 5, influence: 1 }, { appeal: 8, influence: 2 }, { appeal: 12, influence: 3 }], desc: 'The house at the heart of the compound. Visitors notice it.' });
add('guesthouse', { name: 'Guest rooms', cat: 'living', w: 10, h: 8, vis: { b: 'inn' }, stage: 1, tiers: [T(240, { timber: 50, stone: 10 }), T(520, { timber: 80, stone: 30, cloth: 20 })], fx: [{ appeal: 10, trade: 6 }, { appeal: 16, trade: 12 }], desc: 'Beds for travellers. More of them knock at the gate.' });
add('dining', { name: 'Dining hall', cat: 'living', w: 10, h: 7, vis: { b: 'h_hall', arch: { lvl: 2 } }, stage: 1, tiers: [T(220, { timber: 50, stone: 20 }), T(480, { timber: 70, stone: 40 })], fx: [{ morale: 4, foodUse: -0.1 }, { morale: 6, foodUse: -0.2 }], desc: 'Everyone eats together. Morale rises; less food is wasted.' });
add('kitchen', { name: 'Kitchen', cat: 'food', w: 6, h: 5, vis: { b: 'h_forge' }, tiers: [T(120, { timber: 25, stone: 10 }), T(280, { timber: 40, stone: 20, iron: 6 })], fx: [{ morale: 2, prod: { food: 2 } }, { morale: 3, prod: { food: 4 } }], desc: 'A hearth and pots. Cooks turn rice into meals.' });
add('bathhouse', { name: 'Bathhouse', cat: 'living', w: 7, h: 5, vis: { b: 'bath' }, stage: 1, tiers: [T(200, { timber: 40, stone: 20 }), T(420, { timber: 60, stone: 40 })], fx: [{ morale: 4, heal: 1 }, { morale: 6, heal: 2 }], desc: 'Hot water after a hard road.' });
add('teahouse', { name: 'Tea house', cat: 'social', w: 8, h: 7, vis: { b: 'teahouse' }, stage: 2, tiers: [T(320, { timber: 60, cloth: 20 }), T(640, { timber: 80, cloth: 40 })], fx: [{ morale: 5, appeal: 6, trade: 8 }, { morale: 8, appeal: 10, trade: 16 }], desc: 'Tea, gossip and visitors with money.' });
add('tavern', { name: 'Gathering hall', cat: 'social', w: 10, h: 8, vis: { b: 'inn', arch: { lower: 'bengara' } }, stage: 2, tiers: [T(380, { timber: 70, stone: 20 }), T(760, { timber: 100, stone: 40, cloth: 20 })], fx: [{ morale: 6, appeal: 8 }, { morale: 9, appeal: 12 }], desc: 'Sake, music and loud promises.' });
add('meeting', { name: 'Meeting hall', cat: 'social', w: 10, h: 7, vis: { b: 'h_hall' }, stage: 1, tiers: [T(260, { timber: 60, stone: 30 }), T(560, { timber: 90, stone: 60 })], fx: [{ influence: 1, reliability: 1 }, { influence: 2, reliability: 2 }], desc: 'Where the clan decides together.' });
add('memorial', { name: 'Memorial hall', cat: 'social', w: 6, h: 5, vis: { b: 'honden' }, stage: 2, tiers: [T(300, { timber: 40, stone: 40 })], fx: [{ honor: 1, morale: 3 }], desc: 'The fallen are named here.' });
add('shrine', { name: 'Ancestor shrine', cat: 'social', w: 1, h: 1, vis: { p: 'h_shrine' }, legacy: 'shrine', tiers: [T(80, { timber: 10, stone: 10 }), T(240, { timber: 20, stone: 30 }), T(600, { timber: 30, stone: 60 })], fx: [{ hp: 10 }, { hp: 25 }, { hp: 40 }], desc: 'Prayers before battle. More health for everyone in the clan.' });
add('gallery', { name: 'Clan history gallery', cat: 'social', w: 6, h: 8, vis: { b: 'machiya' }, stage: 3, tiers: [T(500, { timber: 60, stone: 30, cloth: 30 })], fx: [{ appeal: 10, influence: 2 }], desc: 'Captured banners and the clan’s story on the walls.' });
add('trophy', { name: 'Trophy room', cat: 'social', w: 5, h: 5, vis: { b: 'kura' }, stage: 2, tiers: [T(280, { stone: 40, timber: 20 })], fx: [{ fear: 2, appeal: 4 }], desc: 'Rival standards, broken blades, a helmet or two.' });
add('hearth', { name: 'Campfire yard', cat: 'social', w: 8, h: 8, vis: { t: 'gravel', p: 'campfire' }, legacy: 'hearth', rot: false, tiers: [T(60, { timber: 6 }, 10), T(180, { timber: 20, stone: 10 }), T(420, { timber: 30, stone: 20, cloth: 6 })], fx: [{ morale: 1 }, { morale: 2 }, { morale: 3 }], desc: 'A fire to sit around. Lanterns and bedrolls as it grows.' });
// training
add('dojo', { name: 'Training dojo', cat: 'training', w: 8, h: 6, vis: { b: 'h_dojo', door: 'E' }, legacy: 'dojo', tiers: [T(100, { timber: 25 }), T(280, { timber: 50, stone: 20 }), T(700, { timber: 80, stone: 50, iron: 10 })], fx: [{ st: 10, train: 2 }, { st: 25, train: 4 }, { st: 40, train: 6 }], desc: 'Swords crossing at dawn. NPCs who train here grow stronger; your stamina too.' });
add('granddojo', { name: 'Grand dojo', cat: 'training', w: 11, h: 8, vis: { b: 'dojo' }, stage: 4, tiers: [T(1200, { timber: 160, stone: 100, iron: 30 })], fx: [{ st: 20, train: 10, appeal: 10 }], desc: 'Students travel from far provinces to train here.' });
add('range', { name: 'Archery and spear range', cat: 'training', w: 10, h: 4, vis: { p: 'dummy', n: 3, t: 'path' }, stage: 1, tiers: [T(150, { timber: 30 }), T(330, { timber: 50, iron: 8 })], fx: [{ train: 3 }, { train: 5 }], desc: 'Targets and straw men in a line.' });
add('yard', { name: 'Training dummy yard', cat: 'training', w: 6, h: 6, vis: { p: 'dummy', n: 4, t: 'gravel' }, max: 3, tiers: [T(60, { timber: 12 }, 15), T(160, { timber: 25 })], fx: [{ train: 2 }, { train: 3 }], desc: 'Straw dummies for daily practice.' });
add('arena', { name: 'Sparring arena', cat: 'training', w: 10, h: 10, vis: { p: 'stakes', n: 4, t: 'gravel', ring: true }, stage: 2, tiers: [T(300, { timber: 40, stone: 40 }), T(700, { timber: 60, stone: 90 })], fx: [{ train: 4, might: 1 }, { train: 7, might: 2 }], desc: 'A ring for duels. Tournaments draw crowds and recruits.' });
add('meditation', { name: 'Meditation garden', cat: 'training', w: 6, h: 6, vis: { p: 'stonelantern', n: 2, t: 'gravel' }, stage: 1, tiers: [T(140, { stone: 30 })], fx: [{ morale: 3, train: 1 }], desc: 'Raked gravel and silence.' });
add('stealthcourse', { name: 'Stealth course', cat: 'training', w: 8, h: 6, vis: { p: 'screen', n: 3, t: 'path' }, stage: 2, tiers: [T(260, { timber: 40, cloth: 20 })], fx: [{ train: 3, intel: 2 }], desc: 'Paper screens and creaking boards. Scouts learn to move unseen.' });
add('instructor', { name: 'Instructor quarters', cat: 'training', w: 8, h: 5, vis: { b: 'quarters' }, stage: 2, tiers: [T(240, { timber: 50, stone: 20 })], fx: [{ train: 3, beds: 2 }], desc: 'A sword master lives with you. Training goes faster.' });
// food and self-sufficiency
add('garden', { name: 'Herb garden', cat: 'food', w: 4, h: 4, vis: { p: 'h_garden' }, legacy: 'garden', rot: false, tiers: [T(80, { timber: 8 }, 15), T(220, { timber: 16 }), T(550, { timber: 24, stone: 10 })], fx: [{ bandage: 1, prod: { herbs: 2 } }, { bandage: 2, prod: { herbs: 4 } }, { bandage: 3, prod: { herbs: 6 } }], desc: 'Bandages and medicine grow here.' });
add('vegetables', { name: 'Vegetable garden', cat: 'food', w: 6, h: 5, vis: { p: 'scarecrow', t: 'paddy', crops: true }, max: 4, rot: false, tiers: [T(60, { timber: 10 }, 15), T(140, { timber: 20 })], fx: [{ prod: { food: 4 } }, { prod: { food: 7 } }], desc: 'Daikon, beans and greens. Farmers double what it gives.' });
add('paddy', { name: 'Rice paddy', cat: 'food', w: 8, h: 6, vis: { t: 'paddy', p: 'scarecrow' }, max: 6, rot: false, near: 'water', tiers: [T(90, { timber: 10 }), T(200, { timber: 20, stone: 10 })], fx: [{ prod: { food: 7 } }, { prod: { food: 11 } }], desc: 'Flooded fields. Best near a river or a lake.' });
add('orchard', { name: 'Orchard', cat: 'food', w: 7, h: 7, vis: { p: 'sakura', n: 4, spread: true }, max: 3, stage: 1, rot: false, tiers: [T(160, { timber: 20 })], fx: [{ prod: { food: 5 }, morale: 1 }], desc: 'Plum and persimmon. Slow to grow, generous after.' });
add('well', { name: 'Well', cat: 'food', w: 1, h: 1, vis: { p: 'well' }, max: 3, rot: false, tiers: [T(50, { stone: 15 }, 15)], fx: [{ morale: 1, prod: { food: 1 } }], desc: 'Clean water close to hand.' });
add('granary', { name: 'Granary', cat: 'food', w: 5, h: 5, vis: { b: 'kura' }, stage: 1, max: 2, tiers: [T(180, { timber: 30, stone: 30 }), T(380, { timber: 40, stone: 60 })], fx: [{ store: 300, foodUse: -0.05 }, { store: 700, foodUse: -0.1 }], desc: 'Rice kept dry and safe from rats.' });
add('fishery', { name: 'Fishing racks', cat: 'food', w: 4, h: 2, vis: { p: 'fishrack', n: 2 }, max: 3, near: 'water', tiers: [T(70, { timber: 12 })], fx: [{ prod: { food: 5 } }], desc: 'Drying racks by the water.' });
add('pen', { name: 'Livestock pen', cat: 'food', w: 6, h: 5, vis: { p: 'ox', fence: true }, stage: 1, max: 2, tiers: [T(140, { timber: 30 })], fx: [{ prod: { food: 4, cloth: 1 } }], desc: 'Oxen and chickens behind a fence.' });
add('storehouse', { name: 'Storehouse', cat: 'crafting', w: 5, h: 4, vis: { b: 'h_kura' }, legacy: 'kura', max: 3, tiers: [T(100, { timber: 20, stone: 20 }), T(300, { timber: 30, stone: 50 }), T(700, { timber: 40, stone: 90, iron: 10 })], fx: [{ store: 400 }, { store: 900 }, { store: 1600, trade: 4 }], desc: 'Shared storage. Bigger stores, and mon that earns.' });
// crafting and production
add('forge', { name: 'Blacksmith', cat: 'crafting', w: 6, h: 5, vis: { b: 'h_forge', door: 'E' }, legacy: 'forge', tiers: [T(120, { timber: 20, stone: 20 }), T(320, { timber: 30, stone: 40, iron: 10 }), T(800, { timber: 50, stone: 60, iron: 30 })], fx: [{ dmg: 8 }, { dmg: 16 }, { dmg: 24 }], desc: 'Sharper edges for everyone in the clan.' });
add('armorer', { name: 'Armorer', cat: 'crafting', w: 8, h: 6, vis: { b: 'smith' }, stage: 2, tiers: [T(400, { timber: 40, stone: 40, iron: 30 }), T(900, { timber: 60, stone: 60, iron: 60 })], fx: [{ npcArmor: 1 }, { npcArmor: 2 }], desc: 'Clan NPCs go out in lacquered armour.' });
add('carpenter', { name: 'Carpenter', cat: 'crafting', w: 6, h: 4, vis: { b: 'hut', p: 'lumber' }, tiers: [T(90, { timber: 20 }), T(220, { timber: 40, iron: 4 })], fx: [{ prod: { timber: 5 }, buildSpeed: 0.15 }, { prod: { timber: 9 }, buildSpeed: 0.3 }], desc: 'Planks, beams and quicker building.' });
add('quarry', { name: 'Stone yard', cat: 'crafting', w: 6, h: 5, vis: { p: 'rubble', n: 3, t: 'stone' }, max: 2, near: 'rock', tiers: [T(120, { timber: 20 }), T(280, { timber: 30, iron: 6 })], fx: [{ prod: { stone: 5 } }, { prod: { stone: 9 } }], desc: 'Cut stone from the hills. Better on rocky ground.' });
add('lumberyard', { name: 'Lumber yard', cat: 'crafting', w: 6, h: 5, vis: { p: 'lumber', n: 3, t: 'path' }, max: 2, near: 'trees', tiers: [T(80, { stone: 6 }), T(200, { stone: 12, iron: 4 })], fx: [{ prod: { timber: 6 } }, { prod: { timber: 10 } }], desc: 'Felled cedar stacked to season. Better in the woods.' });
add('smelter', { name: 'Smelter', cat: 'crafting', w: 4, h: 4, vis: { p: 'furnace' }, stage: 2, near: 'rock', tiers: [T(300, { stone: 60, timber: 30 })], fx: [{ prod: { iron: 3 } }], desc: 'Iron sand into iron. Hot, loud, worth it.' });
add('tailor', { name: 'Tailor and dye works', cat: 'crafting', w: 6, h: 8, vis: { b: 'machiya', arch: { plaster: '#2e2a2a' } }, stage: 1, tiers: [T(180, { timber: 30, cloth: 10 }), T(420, { timber: 40, cloth: 30 })], fx: [{ prod: { cloth: 3 }, unlock: 'uniforms' }, { prod: { cloth: 6 }, unlock: 'patterns' }], desc: 'Dyed cloth for uniforms and banners.' });
add('workshop', { name: 'General workshop', cat: 'crafting', w: 6, h: 4, vis: { b: 'hut', p: 'anvil' }, tiers: [T(100, { timber: 20 }), T(240, { timber: 30, iron: 6 })], fx: [{ repair: 1, buildSpeed: 0.1 }, { repair: 2, buildSpeed: 0.2 }], desc: 'Tools, repairs, odd jobs.' });
// military and command
add('barracks', { name: 'Barracks', cat: 'military', w: 8, h: 5, vis: { b: 'h_barracks' }, legacy: 'barracks', max: 3, tiers: [T(150, { timber: 30, stone: 10 }), T(400, { timber: 50, stone: 30 }), T(900, { timber: 70, stone: 60, iron: 20 })], fx: [{ beds: 4, def: 2 }, { beds: 6, def: 3 }, { beds: 8, def: 5 }], desc: 'Bunks for fighters. More sworn blades.' });
add('command', { name: 'Command hall', cat: 'military', w: 10, h: 7, vis: { b: 'h_hall' }, stage: 2, tiers: [T(500, { timber: 80, stone: 60 }), T(1100, { timber: 120, stone: 100, iron: 20 })], fx: [{ claims: 1, def: 3, intel: 2 }, { claims: 2, def: 5, intel: 4 }], desc: 'Maps, messengers, the clan’s war table.' });
add('armory', { name: 'Armory', cat: 'military', w: 5, h: 5, vis: { b: 'kura', arch: { plaster: '#3a3436' } }, stage: 1, tiers: [T(240, { stone: 40, iron: 10 }), T(560, { stone: 60, iron: 30 })], fx: [{ npcWpn: 1, def: 2 }, { npcWpn: 2, def: 3 }], desc: 'Racks of spears and swords for the clan’s fighters.' });
add('watchtower', { name: 'Watchtower', cat: 'military', w: 2, h: 2, vis: { p: 'watchtower' }, max: 6, tiers: [T(120, { timber: 30 }), T(260, { timber: 40, stone: 20 })], fx: [{ def: 3, intel: 2 }, { def: 5, intel: 3 }], desc: 'Eyes over the walls. Raids are seen sooner.' });
add('guardpost', { name: 'Guard post', cat: 'military', w: 2, h: 2, vis: { p: 'lanternpost', n: 1 }, max: 6, tiers: [T(70, { timber: 15 }, 15)], fx: [{ def: 2, post: 1 }], desc: 'A lamp and a stool where a guard keeps watch.' });
add('gatehouse', { name: 'Gatehouse', cat: 'military', w: 4, h: 3, vis: { p: 'gatehouse' }, stage: 1, max: 2, tiers: [T(300, { timber: 50, stone: 40 }), T(700, { timber: 70, stone: 90, iron: 20 })], fx: [{ def: 6, appeal: 4 }, { def: 10, appeal: 6 }], desc: 'A proper gate. Visitors wait here; raiders break on it.' });
add('medic', { name: 'Field hospital', cat: 'military', w: 5, h: 4, vis: { p: 'tent', n: 2, t: 'gravel' }, stage: 1, tiers: [T(160, { cloth: 20, herbs: 10 })], fx: [{ heal: 1, npcHeal: 2 }], desc: 'Wounded members recover twice as fast.' });
add('stables', { name: 'Stables', cat: 'military', w: 14, h: 5, vis: { b: 'h_barracks', p: 'fence' }, legacy: 'stables', tiers: [T(200, { timber: 40 }), T(600, { timber: 80, stone: 20 }), T(1500, { timber: 120, stone: 60, iron: 20 })], fx: [{ horse: 0 }, { horse: 12 }, { horse: 28 }], desc: 'Horses fed and shod. Faster rides for everyone.' });
add('siegestore', { name: 'Siege store', cat: 'military', w: 6, h: 5, vis: { p: 'cannon' }, stage: 4, tiers: [T(900, { timber: 100, iron: 60 })], fx: [{ might: 3, def: 4 }], desc: 'Rams, ladders and one old cannon.' });
// intelligence
add('scoutlodge', { name: 'Scout lodge', cat: 'intel', w: 6, h: 4, vis: { b: 'hut' }, stage: 1, tiers: [T(160, { timber: 30 }), T(360, { timber: 40, cloth: 10 })], fx: [{ intel: 3 }, { intel: 5 }], desc: 'Scouts come back with news of rivals and raids.' });
add('archive', { name: 'Intelligence archive', cat: 'intel', w: 5, h: 5, vis: { b: 'kura' }, stage: 3, tiers: [T(500, { stone: 60, cloth: 20 })], fx: [{ intel: 6, influence: 1 }], desc: 'Letters, maps and other people’s secrets.' });
add('messenger', { name: 'Messenger station', cat: 'intel', w: 4, h: 3, vis: { p: 'stall' }, stage: 1, tiers: [T(120, { timber: 20 })], fx: [{ intel: 2, contracts: 1 }], desc: 'Runners carry word to the villages. More contracts arrive.' });
// economy
add('tradingpost', { name: 'Trading post', cat: 'economy', w: 7, h: 5, vis: { b: 'shop' }, stage: 1, tiers: [T(220, { timber: 40 }), T(500, { timber: 60, stone: 20 })], fx: [{ trade: 10, appeal: 4 }, { trade: 20, appeal: 6 }], desc: 'Merchants stop here, and pay for the privilege.' });
add('market', { name: 'Market stalls', cat: 'economy', w: 8, h: 6, vis: { p: 'stall', n: 3, t: 'stone' }, stage: 2, tiers: [T(300, { timber: 40, stone: 30 }), T(640, { timber: 60, stone: 60 })], fx: [{ trade: 14, appeal: 6 }, { trade: 26, appeal: 8 }], desc: 'A market square in your own walls.' });
add('treasury', { name: 'Treasury', cat: 'economy', w: 5, h: 4, vis: { b: 'h_kura' }, stage: 1, tiers: [T(300, { stone: 60, iron: 10 }), T(700, { stone: 100, iron: 30 })], fx: [{ interest: 0.04, wealth: 1 }, { interest: 0.08, wealth: 2 }], desc: 'Mon kept here earns a little every day.' });
add('caravan', { name: 'Caravan station', cat: 'economy', w: 7, h: 5, vis: { p: 'wagon', n: 1, t: 'path' }, stage: 2, tiers: [T(360, { timber: 60 })], fx: [{ trade: 12, contracts: 1 }], desc: 'Wagons leave for the towns and come back with coin.' });
add('contracts', { name: 'Contract office', cat: 'economy', w: 7, h: 5, vis: { b: 'shop', arch: { lower: 'lattice' } }, stage: 2, tiers: [T(320, { timber: 50, stone: 20 })], fx: [{ contracts: 2, reliability: 1 }], desc: 'Requests are written down and better paid.' });
// culture and decoration
add('zen', { name: 'Zen garden', cat: 'culture', w: 6, h: 5, vis: { t: 'gravel', p: 'rock', n: 3 }, max: 4, rot: false, tiers: [T(80, { stone: 20 })], fx: [{ morale: 1, appeal: 2 }], desc: 'Raked gravel and three stones.' });
add('pond', { name: 'Koi pond', cat: 'culture', w: 5, h: 4, vis: { t: 'water', edge: 'stone' }, max: 4, rot: false, tiers: [T(120, { stone: 25 })], fx: [{ morale: 2, appeal: 3 }], desc: 'Still water, slow fish.' });
add('sakura', { name: 'Cherry tree', cat: 'culture', w: 1, h: 1, vis: { p: 'sakura' }, max: 24, rot: false, tiers: [T(30, {}, 5)], fx: [{ appeal: 1 }], desc: 'Petals every spring.' });
add('bamboo', { name: 'Bamboo stand', cat: 'culture', w: 1, h: 1, vis: { p: 'bamboo' }, max: 24, rot: false, tiers: [T(20, {}, 5)], fx: [{}], desc: 'A green screen that sings in the wind.' });
add('pine', { name: 'Garden pine', cat: 'culture', w: 1, h: 1, vis: { p: 'pine' }, max: 24, rot: false, tiers: [T(25, {}, 5)], fx: [{}], desc: 'Shaped by patient hands.' });
add('lantern', { name: 'Stone lantern', cat: 'culture', w: 1, h: 1, vis: { p: 'stonelantern', light: true }, max: 30, rot: false, tiers: [T(30, { stone: 6 }, 5)], fx: [{ appeal: 1 }], desc: 'Light along the paths.' });
add('lanternpost', { name: 'Hanging lantern', cat: 'culture', w: 1, h: 1, vis: { p: 'lanternpost', light: true }, max: 30, rot: false, tiers: [T(25, { timber: 4 }, 5)], fx: [{}], desc: 'Paper lanterns on a post.' });
add('torii', { name: 'Torii gate', cat: 'culture', w: 3, h: 1, vis: { p: 'torii' }, stage: 1, max: 4, tiers: [T(120, { timber: 30 })], fx: [{ honor: 1, appeal: 2 }], desc: 'The way into sacred ground.' });
add('jizo', { name: 'Jizō statue', cat: 'culture', w: 1, h: 1, vis: { p: 'jizo' }, max: 8, rot: false, tiers: [T(60, { stone: 10 }, 10)], fx: [{ honor: 0.5 }], desc: 'Guardian of travellers and children.' });
add('monument', { name: 'Clan monument', cat: 'culture', w: 2, h: 2, vis: { p: 'memorial' }, stage: 3, tiers: [T(600, { stone: 120 })], fx: [{ appeal: 12, influence: 2 }], desc: 'Carved with the clan’s name and the battles it won.' });
add('stage', { name: 'Festival stage', cat: 'culture', w: 6, h: 4, vis: { p: 'dais', n: 1, drum: true }, stage: 2, tiers: [T(260, { timber: 50, cloth: 20 })], fx: [{ morale: 5, appeal: 6 }], desc: 'Drums, dances and long nights.' });
add('path', { name: 'Stone path', cat: 'culture', w: 1, h: 4, vis: { t: 'pave' }, max: 120, tiers: [T(6, { stone: 2 }, 3)], fx: [{}], desc: 'Paved stones between the buildings.' });
add('gravelpath', { name: 'Gravel path', cat: 'culture', w: 1, h: 4, vis: { t: 'gravel' }, max: 120, tiers: [T(4, {}, 3)], fx: [{}], desc: 'A raked gravel walk.' });
add('fence', { name: 'Garden fence', cat: 'culture', w: 4, h: 1, vis: { p: 'fence', line: true }, max: 60, tiers: [T(12, { timber: 4 }, 5)], fx: [{}], desc: 'Bamboo fencing to shape the yard.' });
add('weaponrack', { name: 'Weapon rack', cat: 'culture', w: 1, h: 1, vis: { p: 'rack' }, max: 12, rot: false, tiers: [T(40, { timber: 6, iron: 2 }, 5)], fx: [{ might: 0.5 }], desc: 'Spears and swords on display.' });
add('armorstand', { name: 'Armour display', cat: 'culture', w: 1, h: 1, vis: { p: 'armor' }, max: 8, rot: false, tiers: [T(80, { iron: 6 }, 5)], fx: [{ might: 0.5, appeal: 1 }], desc: 'A suit of the clan’s armour.' });
add('banner', { name: 'Clan banner', cat: 'culture', w: 1, h: 1, vis: { p: 'clanbanner' }, max: 30, rot: false, tiers: [T(20, { cloth: 3 }, 5)], fx: [{ appeal: 0.5 }], desc: 'Your colours and emblem, flying where everyone can see.' });
add('footbridge', { name: 'Garden bridge', cat: 'culture', w: 6, h: 2, vis: { p: 'footbridge' }, stage: 1, max: 4, tiers: [T(80, { timber: 20 })], fx: [{ appeal: 2 }], desc: 'Over a stream or a pond.' });
// legendary
add('clanhall', { name: 'Clan hall', cat: 'legendary', w: 10, h: 7, vis: { b: 'h_hall', levels: true }, stage: 3, tiers: [T(900, { timber: 140, stone: 100 }), T(1800, { timber: 200, stone: 160, iron: 30 }), T(3200, { timber: 260, stone: 240, iron: 60, cloth: 40 })], fx: [{ appeal: 12, influence: 3, claims: 1 }, { appeal: 18, influence: 4, claims: 2 }, { appeal: 26, influence: 6, claims: 3 }], desc: 'Two storeys, gold on the ridge. The clan’s seat.' });
add('templehall', { name: 'Temple hall', cat: 'legendary', w: 10, h: 8, vis: { b: 'temple' }, stage: 4, tiers: [T(2200, { timber: 200, stone: 200, iron: 20 })], fx: [{ honor: 3, appeal: 14, morale: 6 }], desc: 'A hall of the Buddha inside your walls.' });
add('pagoda', { name: 'Pagoda', cat: 'legendary', w: 4, h: 4, vis: { p: 'pagoda' }, stage: 5, tiers: [T(3000, { timber: 260, stone: 200, iron: 40 })], fx: [{ appeal: 20, influence: 4 }], desc: 'Five roofs high. Seen from the next valley.' });
add('keep', { name: 'Keep', cat: 'legendary', w: 8, h: 8, vis: { p: 'castle' }, stage: 5, tiers: [T(4500, { timber: 300, stone: 400, iron: 80 })], fx: [{ def: 20, might: 4, fear: 3, appeal: 16 }], desc: 'A castle keep on stone walls. A legend’s house.' });

const BUILD_CATS = { living: 'Living', social: 'Social', training: 'Training', food: 'Food and farming', crafting: 'Crafting and production', military: 'Military and command', intel: 'Intelligence', economy: 'Economy', culture: 'Culture and decoration', legendary: 'Legendary' };

// the wall round the compound, stage by stage: what it looks like and how long it holds
const WALLS = [
  { n: 0, name: 'Open ground', prop: null, def: 0, hold: 0, cost: null },
  { n: 1, name: 'Makeshift barricade', prop: 'barrier', def: 2, hold: 1.5, cost: { mon: 40, timber: 15 } },
  { n: 2, name: 'Bamboo fence', prop: 'h_wall', lv: 1, def: 4, hold: 3, cost: { mon: 80, timber: 30 } },
  { n: 3, name: 'Reinforced wooden wall', prop: 'fence', def: 6, hold: 5, cost: { mon: 160, timber: 60 } },
  { n: 4, name: 'Palisade', prop: 'palisade', def: 9, hold: 8, cost: { mon: 260, timber: 100 }, stage: 1 },
  { n: 5, name: 'Wood on stone footing', prop: 'h_wall', lv: 2, def: 12, hold: 12, cost: { mon: 400, timber: 80, stone: 80 }, stage: 2 },
  { n: 6, name: 'Stone wall', prop: 'h_wall', lv: 3, def: 16, hold: 16, cost: { mon: 650, stone: 180 }, stage: 2 },
  { n: 7, name: 'Stone wall with towers', prop: 'cwall', def: 20, hold: 22, cost: { mon: 900, stone: 260, timber: 60 }, stage: 3, towers: true },
  { n: 8, name: 'Fortified stone wall', prop: 'cwall', def: 25, hold: 30, cost: { mon: 1400, stone: 380, iron: 40 }, stage: 4, towers: true, lamps: true },
  { n: 9, name: 'Double perimeter', prop: 'cwall', def: 31, hold: 40, cost: { mon: 2200, stone: 520, iron: 80 }, stage: 5, towers: true, lamps: true, double: true },
  { n: 10, name: 'Castle walls', prop: 'cwall', def: 38, hold: 60, cost: { mon: 3400, stone: 760, iron: 140 }, stage: 6, towers: true, lamps: true, double: true }
];
const GATES = [{ n: 0, name: 'Gap in the fence' }, { n: 1, name: 'Wooden gate', prop: 'gatewood' }, { n: 2, name: 'Gatehouse', prop: 'gatehouse' }];

// ---- the emblem editor's parts (drawn by the game's Emblem renderer)
const EMBLEM = {
  shapes: ['mon', 'circle', 'diamond', 'shield', 'square', 'banner', 'hexagon', 'octagon', 'fan', 'none'],
  symbols: ['none', 'dragon', 'tiger', 'wolf', 'fox', 'crane', 'snake', 'koi', 'hawk', 'oni', 'kitsune', 'skull', 'katana', 'crossedswords', 'spear', 'bow', 'arrow', 'mask', 'helmet', 'fan', 'sakura', 'chrysanthemum', 'wisteria', 'paulownia', 'pine', 'bamboo', 'maple', 'wave', 'mountain', 'moon', 'sun', 'star', 'flame', 'cloud', 'lightning', 'tomoe', 'tripletomoe', 'diamonds', 'hashes', 'ring', 'cross', 'kanji'],
  patterns: ['none', 'stripes', 'waves', 'checker', 'scales', 'hemp', 'dots', 'clouds', 'flames', 'rays', 'hex', 'lattice', 'bamboo', 'quarters', 'halves', 'gradient'],
  borders: ['none', 'thin', 'double', 'rope', 'beads', 'teeth', 'petals', 'thick'],
  finishes: ['painted', 'lacquer', 'gold', 'silver', 'embroidered', 'weathered', 'glow'],
  kanji: ['龍', '虎', '狼', '狐', '鶴', '蛇', '鬼', '火', '水', '風', '雷', '月', '日', '山', '刀', '誠', '義', '忍', '武', '花', '影', '黒', '紅', '白', '金', '道', '心', '天', '剣', '桜'],
  maxLayers: 6
};
const BANNER = {
  shapes: ['nobori', 'hata', 'sashimono', 'standard', 'pennant', 'swallowtail', 'horizontal', 'umajirushi'],
  fabrics: ['silk', 'hemp', 'cotton', 'brocade'],
  poles: ['bamboo', 'lacquer', 'iron', 'gilded'],
  sizes: ['small', 'medium', 'large', 'great'],
  maxBanners: 12
};
// a uniform is the game's own look (kimono, hakama, sash, hat, coat...) with clan colours and a mon on it
const UNIFORM = {
  slots: ['top', 'bottom', 'sash', 'coat', 'cloak', 'armor', 'hat', 'mask', 'crest'],
  patterns: ['Plain', 'Stripes', 'Hemp-leaf', 'Waves', 'Checker', 'Scales', 'Dots', 'Clouds', 'Diamonds', 'Split'],
  contexts: ['everyday', 'war', 'ceremony', 'stealth', 'festival'],
  roles: ['recruit', 'member', 'veteran', 'elite', 'scout', 'archer', 'spearman', 'swordsman', 'shinobi', 'bodyguard', 'officer', 'captain', 'commander', 'leader'],
  maxPresets: 40
};
const PALETTE_KEYS = ['primary', 'secondary', 'accent', 'accent2', 'metal', 'cloth', 'armor', 'trim', 'banner', 'roof', 'wall', 'gate', 'garden'];

// ---- clan NPCs: what they can be, and what they are like
const ROLES = {
  swordsman: { name: 'Swordsman', fight: true, wpn: ['katana', 'wakizashi'], armor: 1, hp: 90, skill: 0.45 },
  spearman: { name: 'Spearman', fight: true, wpn: ['yari'], armor: 1, hp: 95, skill: 0.4 },
  glaive: { name: 'Naginata fighter', fight: true, wpn: ['naginata'], armor: 1, hp: 95, skill: 0.45 },
  heavy: { name: 'Heavy infantry', fight: true, wpn: ['kanabo', 'nodachi'], armor: 2, hp: 130, skill: 0.4, poise: 1 },
  scout: { name: 'Scout', fight: true, wpn: ['wakizashi', 'tanto'], armor: 0, hp: 70, skill: 0.5, speed: 3.7 },
  shinobi: { name: 'Shinobi', fight: true, wpn: ['tanto', 'wakizashi'], armor: 0, hp: 65, skill: 0.6, speed: 3.9 },
  bodyguard: { name: 'Bodyguard', fight: true, wpn: ['katana'], armor: 2, hp: 120, skill: 0.55, poise: 1 },
  guard: { name: 'Gate guard', fight: true, wpn: ['yari', 'katana'], armor: 1, hp: 100, skill: 0.45 },
  medic: { name: 'Healer', fight: false, wpn: ['tanto'], armor: 0, hp: 70, skill: 0.25, heals: true },
  farmer: { name: 'Farmer', fight: false, wpn: ['hoe'], armor: 0, hp: 60, skill: 0.2, work: 'food' },
  smith: { name: 'Smith', fight: false, wpn: ['kanabo'], armor: 0, hp: 80, skill: 0.3, work: 'iron' },
  carpenter: { name: 'Carpenter', fight: false, wpn: ['fists'], armor: 0, hp: 70, skill: 0.25, work: 'timber' },
  mason: { name: 'Mason', fight: false, wpn: ['fists'], armor: 0, hp: 75, skill: 0.25, work: 'stone' },
  weaver: { name: 'Weaver', fight: false, wpn: ['fists'], armor: 0, hp: 55, skill: 0.15, work: 'cloth' },
  cook: { name: 'Cook', fight: false, wpn: ['tanto'], armor: 0, hp: 60, skill: 0.2, work: 'food' },
  merchant: { name: 'Merchant', fight: false, wpn: ['fists'], armor: 0, hp: 55, skill: 0.15, work: 'mon' },
  trainer: { name: 'Sword master', fight: true, wpn: ['katana'], armor: 1, hp: 110, skill: 0.75, train: true }
};
const TRAITS = {
  brave: 'Brave · holds the line when others break', cautious: 'Cautious · falls back early, lives long', loyal: 'Loyal · never thinks of leaving',
  greedy: 'Greedy · wants a share of every purse', proud: 'Proud · hates retreat and rejection', quiet: 'Quiet · a good scout',
  cheerful: 'Cheerful · lifts everyone’s morale', hothead: 'Hot-headed · charges first, asks later', disciplined: 'Disciplined · trains hard, learns fast',
  lazy: 'Lazy · works slowly unless watched', honest: 'Honest · bad at lies, good with villagers', ruthless: 'Ruthless · frightening, and frightened of nothing',
  nightowl: 'Night owl · sharper after dark', drinker: 'Drinker · loves the tavern a little too much', pious: 'Pious · prays at every shrine', schemer: 'Schemer · knows things he should not'
};
const ASSIGN = ['follow', 'guard', 'patrol', 'train', 'work', 'rest', 'escort', 'scout', 'hold'];
const ORDERS = ['follow', 'hold', 'guardHere', 'attack', 'defendGate', 'patrol', 'escort', 'scout', 'retreat', 'regroup', 'train', 'rest', 'gather', 'base', 'prepare', 'standDown'];
const FORMATIONS = ['loose', 'line', 'column', 'wedge', 'circle', 'shield'];

// ---- visitors at the gate: who comes, why, and when (stage, reputation) they start coming
const VISITORS = {
  warrior: { name: 'A warrior asking to join', kind: 'recruit', stage: 0, weight: 5, roles: ['swordsman', 'spearman', 'glaive'] },
  veteran: { name: 'A grey veteran offering his sword', kind: 'recruit', stage: 1, weight: 3, roles: ['bodyguard', 'heavy', 'swordsman'], skill: 0.2 },
  archer: { name: 'A hunter good with a spear', kind: 'recruit', stage: 1, weight: 2, roles: ['spearman', 'scout'] },
  scout: { name: 'A scout with news to sell', kind: 'recruit', stage: 1, weight: 2, roles: ['scout', 'shinobi'], intel: true },
  craftsman: { name: 'A craftsman looking for work', kind: 'recruit', stage: 0, weight: 3, roles: ['smith', 'carpenter', 'mason', 'weaver'], needs: 'prosperity' },
  farmer: { name: 'Farmers asking for protection', kind: 'recruit', stage: 0, weight: 3, roles: ['farmer', 'cook'], needs: 'honor' },
  healer: { name: 'A wandering healer', kind: 'recruit', stage: 1, weight: 1, roles: ['medic'], needs: 'honor' },
  ruthless: { name: 'A ruthless blade for hire', kind: 'recruit', stage: 1, weight: 2, roles: ['heavy', 'shinobi'], needs: 'fear' },
  master: { name: 'A sword master', kind: 'recruit', stage: 3, weight: 1, roles: ['trainer'], skill: 0.3, rare: true },
  merchant: { name: 'A merchant proposing trade', kind: 'trade', stage: 0, weight: 3 },
  traveller: { name: 'A traveller asking for shelter', kind: 'shelter', stage: 0, weight: 3 },
  villager: { name: 'A village headman with a request', kind: 'contract', stage: 0, weight: 5, needs: 'honor' },
  messenger: { name: 'A messenger with a contract', kind: 'contract', stage: 1, weight: 4 },
  wounded: { name: 'A wounded ally asking for help', kind: 'help', stage: 1, weight: 1 },
  envoy: { name: 'An envoy from a rival', kind: 'diplomacy', stage: 1, weight: 2 },
  informant: { name: 'An informant who saw something', kind: 'intel', stage: 2, weight: 2 },
  petitioner: { name: 'Someone seeking justice', kind: 'contract', stage: 2, weight: 2, needs: 'honor' },
  noble: { name: 'A noble’s retainer with a rare offer', kind: 'contract', stage: 4, weight: 1, rare: true }
};
// the choices you can give someone at the gate
const GATE_CHOICES = ['accept', 'rejectPolite', 'rejectFirm', 'pay', 'demonstrate', 'test', 'later', 'shelter', 'contract', 'negotiate', 'ask', 'specialist', 'delegate'];

// ---- contracts: real work in the world. kind drives what the game spawns and what counts as done
const CONTRACTS = {
  bandits: { name: 'Clear the bandits near {place}', kind: 'kill', foes: 'bandit', n: [3, 6], reward: [140, 320], rep: { honor: 2, reliability: 1 }, renown: 25, diff: 2 },
  raiders: { name: 'Drive off raiders troubling {place}', kind: 'kill', foes: 'bandit', n: [4, 7], reward: [180, 380], rep: { honor: 2, might: 1 }, renown: 30, diff: 3 },
  pirates: { name: 'Pirates on the shore near {place}', kind: 'kill', foes: 'pirate', n: [3, 5], reward: [180, 360], rep: { honor: 1, might: 1 }, renown: 30, diff: 3, coast: true },
  escort: { name: 'Escort a merchant to {place}', kind: 'escort', reward: [160, 300], rep: { reliability: 2, wealth: 1 }, renown: 25, diff: 2 },
  deliver: { name: 'Deliver supplies to {place}', kind: 'deliver', res: { food: 20 }, reward: [120, 240], rep: { generosity: 2, reliability: 1 }, renown: 20, diff: 1 },
  defend: { name: 'Defend {place} for a night', kind: 'defend', waves: 3, reward: [240, 480], rep: { honor: 3, might: 1 }, renown: 40, diff: 3 },
  scoutRival: { name: 'Scout the {rival} near {place}', kind: 'scout', reward: [120, 220], rep: { influence: 1 }, renown: 20, diff: 2, intel: true },
  duel: { name: 'Answer a duel at {place}', kind: 'duel', reward: [100, 260], rep: { might: 2, honor: 1 }, renown: 30, diff: 3 },
  hunt: { name: 'Hunt a wanted man near {place}', kind: 'kill', foes: 'ronin', n: [1, 1], boss: true, reward: [200, 420], rep: { honor: 2, fear: 1 }, renown: 35, diff: 3 },
  rebuild: { name: 'Help {place} rebuild', kind: 'deliver', res: { timber: 30, stone: 10 }, reward: [100, 200], rep: { generosity: 3, honor: 1 }, renown: 25, diff: 1 },
  outpost: { name: 'Take the {rival} outpost near {place}', kind: 'kill', foes: 'bandit', n: [5, 8], camp: true, reward: [300, 600], rep: { might: 3, fear: 1 }, renown: 60, diff: 4, territory: true }
};

// ---- rivals: the outlaw gangs already holding camps on the island become factions with a will of their own
const TEMPERS = {
  aggressive: { name: 'Aggressive', raid: 1.6, expand: 1.3, trade: 0.3, talk: 0.4 },
  trader: { name: 'Mercantile', raid: 0.5, expand: 0.8, trade: 1.6, talk: 1.4 },
  stealthy: { name: 'Secretive', raid: 1.0, expand: 0.7, trade: 0.8, talk: 0.8, sneak: true },
  defensive: { name: 'Entrenched', raid: 0.4, expand: 0.5, trade: 1.0, talk: 1.0, def: 1.5 },
  zealous: { name: 'Zealous', raid: 1.2, expand: 1.0, trade: 0.4, talk: 0.6 },
  greedy: { name: 'Greedy', raid: 1.1, expand: 1.4, trade: 1.2, talk: 0.9 }
};
const STANCES = ['war', 'hostile', 'wary', 'neutral', 'respect', 'trade', 'truce', 'allied', 'tribute'];

// ---- where a clan may settle: what each kind of ground gives and takes
const TRAITS_HQ = {
  forest: { name: 'Forest', good: 'Timber close by, and the trees hide you (fewer raids)', bad: 'Little room for fields', prod: { timber: 4 }, raid: 0.8, food: -1 },
  mountain: { name: 'Mountain', good: 'Easy to defend, stone and iron in the hills', bad: 'Supplies come up slowly (food upkeep higher)', prod: { stone: 4, iron: 1 }, def: 6, upkeep: 0.25 },
  river: { name: 'River', good: 'Water for rice paddies and fishing', bad: 'Floods in the rains', prod: { food: 4 }, paddy: true },
  lake: { name: 'Lakeside', good: 'Fish and calm water', bad: 'Open approaches', prod: { food: 3 }, paddy: true },
  coast: { name: 'Coast', good: 'Fishing and trade by boat', bad: 'Pirates find you', prod: { food: 3 }, trade: 6, raid: 1.2, pirates: true },
  road: { name: 'Road', good: 'Merchants pass the gate', bad: 'So do raiders', trade: 8, raid: 1.3, appeal: 6 },
  town: { name: 'Near a town', good: 'Recruits, trade and contracts', bad: 'The town watches what you do', appeal: 10, trade: 4, contracts: 1 },
  ruins: { name: 'Ruined fort', good: 'Old walls to build on (start with a palisade)', bad: 'Rubble to clear (first buildings cost more stone)', wall: 4, def: 3 },
  plains: { name: 'Open plain', good: 'Room to grow, good farmland', bad: 'Nowhere to hide', prod: { food: 3 }, bound: 6, raid: 1.1 },
  snow: { name: 'Snow country', good: 'Rivals rarely come', bad: 'Cold costs food', raid: 0.7, upkeep: 0.3 },
  bamboo: { name: 'Bamboo', good: 'Bamboo for fences and scaffolds', bad: 'Shinobi love it', prod: { timber: 3 }, raid: 0.9 },
  sacred: { name: 'Near a shrine', good: 'Pilgrims and honour', bad: 'Violence here is remembered', appeal: 4, honor: 1 }
};

module.exports = {
  RES, RES_KEYS, RANKS, RANK_LEADER, RANK_COMMANDER, RANK_RECRUIT, RANK_MEMBER, PERMS, DEFAULT_PERMS, SUCCESSION_DAYS, STAGES, REP_KEYS,
  BUILD, BUILD_CATS, WALLS, GATES, EMBLEM, BANNER, UNIFORM, PALETTE_KEYS, ROLES, TRAITS, ASSIGN, ORDERS, FORMATIONS,
  VISITORS, GATE_CHOICES, CONTRACTS, TEMPERS, STANCES, TRAITS_HQ
};
