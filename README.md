# Crimson Ronin

**白日の影 · Shadows of the White Sun**

A single-file open-world samurai RPG in the browser. You play **Ren Kisaragi**, a boy from a mountain village whose world is burned by Emperor Kahn’s Crusade of the White Sun — and, fifteen years later, the ronin who is still running.

<p align="center">
  <img src="docs/screenshots/01-title.jpg" alt="Title screen: 白日の影, Shadows of the White Sun" width="720">
</p>

There is no build step, no package manager, and no server required. Open `Crimson Ronin.html` in a modern browser and the island of **Kurenai-jima** raises itself.

---

## Overview

Crimson Ronin is a complete action-adventure in one HTML file: an isometric pixel-art world, a hundred-mission story, and a sandbox around it.

Emperor Kahn, a foreign-born conqueror, has crowned himself ruler of a unified Japan. His army marches under enormous white banners marked with a golden sun. None of that has reached **Kiyohara** yet — a village between a cedar forest and a river that turns gold every autumn. Ren is eight. His greatest treasure is a grey horse named **Kumo**.

The first missions play that last beautiful morning, then the fire. The rest of the game is the man Ren becomes: a wandering blade on an island of occupied towns, hidden shrines, bandit camps, and people who still remember his name.

Between story missions the island is yours. Gold markers on the map show where the next chapter begins. Walk into one to start it. Your journal keeps the story so far.

### The five acts

| Act | Title | Missions |
| --- | --- | --- |
| I | **The Boy Who Survived** · 生き残った少年 | 1–20 |
| II | **The People Left Behind** · 置き去りの人々 | 21–40 |
| III | **The Cannonier’s Sin** · 砲手の罪 | 41–60 |
| IV | **The Last Lanterns** · 最後の灯 | 61–80 |
| V | **The Fall of the White Sun** · 白日の落日 | 81–100 |

---

## Screenshots

<p align="center">
  <img src="docs/screenshots/05-village.jpg" alt="Mission 1 in Kiyohara village: take a rice ball to the Kisaragi Saddlery" width="720">
</p>

<p align="center"><em>Kiyohara, Hour of the Dragon. Hana tags along whether you like it or not.</em></p>

<p align="center">
  <img src="docs/screenshots/03-character-create.jpg" alt="Character creator for adult Ren Kisaragi" width="720">
</p>

<p align="center"><em>Shape Ren’s look as a man of twenty-three. In the first missions he is still eight.</em></p>

<p align="center">
  <img src="docs/screenshots/04-intro.jpg" alt="Story intro: The Last Beautiful Morning" width="720">
</p>

<p align="center"><em>The childhood prologue can be played or skipped from this screen.</em></p>

<p align="center">
  <img src="docs/screenshots/06-map.jpg" alt="World map of Kurenai-jima" width="720">
</p>

<p align="center"><em>The island of Kurenai-jima. Climb watchtowers to reveal the map; fast-travel to towns you have visited.</em></p>

<p align="center">
  <img src="docs/screenshots/02-how-to-fight.jpg" alt="How to Fight control list on the title screen" width="720">
</p>

<p align="center"><em>How to Fight, from the title screen. One clean cut ends a life. Two careless ones end yours.</em></p>

---

## How to run

The game is the file **`Crimson Ronin.html`**. That is the whole project.

### Fastest: open the file

1. Clone or download this repository.
2. Double-click `Crimson Ronin.html`, or drag it onto Chrome, Firefox, Safari, or Edge.
3. Wait for the title screen to finish *Drawing the map…* / *Raising the realm…*, then choose **Quick Start** or **New Game**.

A recent desktop or mobile browser is enough. There is nothing to install.

### From a local server (recommended)

Some browsers are stricter with `file://` URLs (fonts, audio, or saves). Serving the folder over HTTP avoids that:

```bash
cd CrimsonRoninRepo
python3 -m http.server 8000
```

Then open [http://localhost:8000/Crimson%20Ronin.html](http://localhost:8000/Crimson%20Ronin.html).

Any static file server works (`npx serve`, Caddy, nginx, GitHub Pages, and so on).

### Starting a run

| Button | What it does |
| --- | --- |
| **Quick Start · begin the story** | Jump straight into the campaign with the default look. |
| **New Game · shape Ren’s look** | Customize hair, kimono, scars, and coat, then begin. |
| **Gang / Multiplayer** | Shared persistent world for up to five players. No story campaign. Clans, compounds, sworn retainers, land and rival gangs on one island. |
| **How to Fight** | Show the control list on the title screen. |
| **Controls** | Toggle **Turn and walk** (W walks the way Ren faces) vs **Classic** (WASD strafes, mouse aims). |

On the intro card you can **Begin the story** (childhood in Kiyohara) or **Skip the childhood prologue**.

Progress is written to the browser’s `localStorage`. **Continue the Journey** appears on the title screen once a save exists. Pause with `Esc` to save and return to title.

### Gang / Multiplayer (shared world)

Story mode still runs from the HTML file alone. **Gang / Multiplayer** needs the Node world server so every browser shares one persistent Kurenai.

```bash
docker compose up
```

Then open [http://127.0.0.1:8091/](http://127.0.0.1:8091/) (or `http://127.0.0.1:8091/crimson-ronin/`). WebSocket is `/ws` and `/crimson-ronin/ws`. The compose file binds **127.0.0.1:8091** only, so a later Caddy reverse-proxy on the leo VM can front `/crimson-ronin/` without nginx.

Without Docker:

```bash
cd server && npm install && PORT=8091 BIND=127.0.0.1 node index.js
```

Up to **five players** share one island. A sixth is told the world is full. Closing the tab does not wipe anything: the world is saved to `server/data/world.json` every few seconds and on shutdown (written atomically; a corrupt file is set aside, not loaded).

#### Who decides what

- **The world server** owns everything that must be the same for everyone: the clock (one day is ten minutes, the same for every player), every clan (members, ranks, permissions, resources, buildings, retainers, visitors, contracts), land, rival gangs, raids and saves. A browser *asks*; the server checks rank, cost, ground and limits, then answers. Requests carry an id, so a click sent twice is done once.
- **One player's game is the world host.** The island's people (townsfolk, guards, outlaws, clan retainers, visitors at the gates) think and fight there, and the server passes each player only the people near them. The earliest player still playing hosts. If the host leaves, hides the tab or stops responding for three seconds, the next player's game takes over with every person where they stood: no one is made twice and no one disappears.
- **Your own body is yours.** Movement, blocking and rolling are never lagged. Your cut at someone else's person goes to the host, which applies it. A cut from one of the host's people at you is resolved in your game, against your own guard. Deaths look the same everywhere: same place, same wound, same fall.
- Menus do not pause the shared world. It carries on, and you stand still.

#### Clans

Every player is in a clan. You start as a lone founder; invite friends, accept applications, or join another clan (**B** opens the clan book).

- **Identity:** name, short tag, motto, description, founding story and history, and titles for the leader and each of the six ranks below.
- **Emblem editor:** a field shape, two colours, a pattern, a border and a finish under up to six layers of about forty symbols (animals, weapons, flowers, crests, kanji), each one moved, scaled, turned, mirrored and faded. Undo, redo, presets, and a random start. The emblem appears on banners, uniforms, the compound gate and the map.
- **Colours and uniforms:** a clan palette (primary, secondary, accents, metal, cloth, roofs, walls, gate, garden, rank colours, colours per occasion), and uniform presets (kimono colour and pattern, hakama, sash, coat, cloak, armour and its lacquer, hat, mask, and the mon front and back). Presets are assigned by rank, by role or to one person. Players may wear their own clothes, or the clan can recommend or require its uniform.
- **Banners:** shape, size, cloth, pole, layout, border, tassels, fringe, weathering and battle damage. Banners move in the wind at the gate and wherever you plant one.
- **Members and ranks:** invitations, applications (with a few words, the role you want and how you play), promotion, demotion, removal, hand-over (confirmed by typing the name), and a permission table for what each rank may do. A leader gone for fourteen days hands the clan on to the next in rank.

#### The compound

Choose where the clan settles from about a hundred candidate sites. Each has traits (river, forest, road, mountain, coast, ruins and so on) that give something and cost something. A clan starts with a fire, a shelter and a barricade. Everything else is built.

- **81 structures in ten groups** (living, social, training, food, crafting, military, intel, economy, culture, legendary), some with up to three tiers. Bigger ones unlock as the clan grows through seven stages. They are placed with a footprint that shows green, or red with the reason (water, rock, a house, outside your ground, the gate's way). They are built on the server's clock, then improved, moved, restyled or torn down (half the cost comes back).
- **Walls** in eleven stages, from a barricade to a double ring with towers and lamps, and a gate that can be improved. Outsiders are slowed by the walls; the clan's own people pass.
- **Architecture styles** for one building or the whole compound (traditional, military, stealth, luxury, natural, intimidating, ceremonial, fortified), or roof, ridge, walls, windows and colours chosen one by one.
- Buildings give real effects: health, stamina and damage for members, healing while asleep, beds for retainers, training, storage, daily production, defence, visitor appeal, trade income and more.

#### Retainers, visitors and orders

- **Sworn retainers** (17 roles, each with traits) follow a player, guard the gate, patrol the walls, train, work at the buildings, or rest. They eat, draw wages, keep up morale and loyalty, and leave if neglected. In a fight they go down wounded rather than die; three times down in a day and they rest until healed.
- **Visitors come to the gate** as the clan grows known: recruits, merchants, informants, envoys from rival gangs, people asking for shelter, and people bringing work. Accept, pay, haggle, duel a recruit first, ask more, send them off, or let an officer decide. A recruitment policy can turn away anyone below a skill or outside the roles you want.
- **Orders (G):** follow, hold, attack, defend the gate, regroup, fall back, guard this spot, go home, patrol, stand down, and six formations (loose, line, column, wedge, circle, shield).

#### Land, rivals and work

- The island is divided into districts. Claim empty land next to what you hold. Rival land is contested, not taken: fight there, clear outposts and do work in the district until your influence is greater. Land pays timber, stone, iron, food and taxes while you keep a grip on it.
- Outlaw gangs hold camps and land of their own. They grow, spread, raid compounds they hate (scouts may warn you first), and talk to clans they respect: truces, tribute, trade, alliances, war.
- Contracts come to the gate: hunting outlaws and wanted men, duels, escorts, defending a place, deliveries and scouting. They are real work in the world, and completing one pays the clan and wins influence in that district.

Two riders can share one horse (saddle and mount behind). Hired blades at inns swear to the clan. Fast travel takes you home to the compound, and you wake there after a fall.

#### Limits

- The island's people run in the host's browser, so a slow computer slows them for everyone. Hosting moves to another player when the host leaves, hides the game or stops responding.
- A player's own adventure (purse, gear, quests) is kept in their browser and on the server. The clan's things live only on the server.
- Uniform hats change shape; hat colour and the uniform's dirt and wear settings are kept but not drawn yet.

---

## Controls

Two movement schemes. Switch them on the title screen or from the pause menu.

**Turn and walk (default)** — W walks the way Ren faces, S steps back, A and D turn him. On Kumo, W rides, A and D steer, S reins in. The mouse aims the blade.

**Classic** — WASD moves Ren across the screen; he faces the mouse.

| Input | Action |
| --- | --- |
| Left click | Cut. Hold and release for a heavy cut. |
| Right click / Shift | Guard. Tap just before a hit to parry. |
| Space | Roll out of danger. |
| C / F | Crouch to sneak / assassinate an unaware enemy. |
| H / E | Whistle for your horse / mount, talk, open, climb. |
| 1–9 · 0 · X | Switch weapons · bare hands (folk stay calm) · quick sheathe/draw. |
| Q / R | Bandage bleeding wounds / drink sake. |
| J / M | Journal of quests / map and fast travel. |
| Tab · G · Esc | Character · gang orders (in the shared world, the orders wheel for your clan's retainers) · pause. |
| B | The clan book (shared world only): identity, emblem, colours, uniforms, banners, members, retainers, gate, building, compound, land, rivals, contracts, ranks. |

On a phone or tablet, a virtual stick and face buttons appear. Palaces, Edo Castle, and Hanamachi Keep are restricted: a guard who sees you inside will try to kill you, unless the lord expects you.

---

## What you can do on the island

- **Fight** with timed cuts, heavy blows, parries, and rolls. Wounds bleed. Bandage them or they will finish you.
- **Sneak** through camps and palaces, or walk in with a sheathed blade so townsfolk stay calm.
- **Ride Kumo**, whistle him back, and cross the island instead of walking it.
- **Keep honor** on a scale from Oni to Kensei. Mercy, duels, and how you treat the helpless all count. Shame closes some doors.
- **Challenge the Ten Blades** in formal iaijutsu standoffs — wait for 斬, then click.
- **Rebuild Kuroba-dera**, hire a gang at inns, and give them orders with G.
- **Explore** plains, bamboo, snow passes, castle towns, maple woods, and the coast. Climb watchtowers to unfog the map.
- **Learn techniques** as you level: Iron Body, Iaijutsu, Willow Guard, Shadow Walker, and more.
- **Play side work** — parcels, warrants, bandit camps, rumors at the inn, chō-han in the back room — between the hundred story missions.

The world is the island of Kurenai-jima, thousands of tiles on a side, with a hand-built heartland around Ashigawa and generated provinces beyond it.

---

## Roads and bridges

Every road on the island is laid first and its bridges after, so a bridge is always part of its road:

- The road and the bridge are **one straight line**. The road leaves its course on dry ground and runs straight along the bridge's line for three and a half tiles. It crosses a deck whose ends are exactly the road's own points, then runs straight out the far side before it turns back to its course.
- A crossing keeps to the road's own heading where it can, and turns toward the narrowest way over only as far as the road can turn onto it on dry ground.
- **No bridge touches another.** Decks never overlap, no deck lies on another bridge's approach, and a bridge's ramp stops short of a road running along the bank. A second road crossing at the same place uses the bridge that is already there.
- Bridges a story builds (a crossing rebuilt, one put up overnight) are laid straight across the narrowest real crossing near the spot, both feet on dry banks.

`Bridges.audit({ stream: true, nav: true })` in the browser console checks every bridge against all of this: dry footing at both ends, water under it, across the water rather than along it, no overlaps, open approaches, a road on its line at both ends, and a way across that walkers actually take.

---

## Testing

- **World server:** `cd server && npm test` starts real servers on free ports and plays them over WebSocket: the five-player cap, host hand-over (when the host leaves, hides the game or stops responding), one clock, duplicate requests, ranks and permissions, building rules, NPC replication and hit routing, restarts and saves, version-1 migration, visitors, retainers, succession, land, raids, contracts and input cleaning.
- **The campaign:** `Missions.walkPlay(1, 100)` in the browser console drives all hundred missions and reports any step that would not make sense to a player. That covers speakers without a body or too far away, objectives with no place or no walkable way there, steps that would not complete, people standing inside rock, trees or water, and promised objects (the medicine, the orders, the lantern) that are not there to see.
- **Static checks:** `python3 tools/qa_audit.py` cross-checks missions against layouts, cast and props.

---

## Project layout

```
CrimsonRoninRepo/
├── Crimson Ronin.html    # the entire game: world, story, renderer, audio, UI, clans and the shared-world client
├── compose.yaml          # static HTML + the world server on 127.0.0.1:8091
├── server/
│   ├── index.js          # HTTP (static files, /health) and WebSocket entry point, saving
│   ├── lib/              # catalog, clans, compounds, clan life, realm (land, rivals, raids, clock), net, store
│   └── test/             # node:test suites
├── tools/qa_audit.py     # static mission QA
├── README.md
├── .gitignore
└── docs/screenshots/     # images used in this README
```

Everything playable lives in `Crimson Ronin.html`: isometric renderer, procedural island, mission scripts, dialogue, combat, audio, HUD, and saves. Google Fonts (`DotGothic16`, `Shippori Mincho B1`) load from the network when available; the game still runs if they do not.

---

## Tips

- One clean cut ends a life. Two careless ones end yours.
- Sheathe with `0` (fists) in town if you do not want a panic.
- Gold map markers are story. The rest of the island does not wait for you.
- Press `J` when you lose the plot. The Story tab is a recap, not a spoiler dump you have not earned yet.
- If the title screen sits on *Raising the realm…*, give it a few seconds — the island is large.

---

Play well. Give them something worth knowing.
