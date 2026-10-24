#!/usr/bin/env python3
"""Static QA extractor for Crimson Ronin.html — missions vs layouts/cast/props."""
import re, json, collections
from pathlib import Path

src = Path("/Users/leofuchs/Developer/crimsonronin/Crimson Ronin.html").read_text(encoding="utf-8")

# ---- LAYOUTS keys and declared spots
layout_keys = re.findall(r"\n  ([a-z][a-z0-9]+): \{\n    r:", src)
spot_blocks = re.findall(r"\n  ([a-z][a-z0-9]+): \{[\s\S]*?spots: \{([^}]*)\}", src)
layout_spots = {}
for k, body in spot_blocks:
    names = re.findall(r"([A-Za-z][A-Za-z0-9]*)\s*:", body)
    layout_spots.setdefault(k, set()).update(names)

# spots assigned in build via P.spot('name'
for k, body in re.findall(r"\n  ([a-z][a-z0-9]+): \{([\s\S]*?)\n  \},?\n  //", src):
    for n in re.findall(r"P\.spot\('([^']+)'", body):
        layout_spots.setdefault(k, set()).add(n)

# leftover last layout (capital-ish builders after LAYOUTS)
# StoryMap.put ids
puts = re.findall(r"this\.put\('([^']+)'", src)
adopts = re.findall(r"this\.adopt\('([^']+)'", src)
sites = sorted(set(puts + adopts + ["capital", "kiyo"]))

# CAST keys
cast_keys = set(re.findall(r"\n  ([a-z][A-Za-z0-9]+): \{ name:", src))

# Prop draw keys
prop_draws = set(re.findall(r"Props\.draw\.([A-Za-z0-9_]+)\s*=", src))

# Mission blocks: split on M({
parts = re.split(r"\nM\(\{", src)
missions = []
for p in parts[1:]:
    head = p[:800]
    n_m = re.search(r"n:\s*(\d+)", head)
    title_m = re.search(r"title:\s*'((?:\\'|[^'])*)'", head)
    at_m = re.search(r"at:\s*('[^']+'|\[[^\]]+\])", head)
    sites_m = re.search(r"sites:\s*\[([^\]]*)\]", head)
    giver_m = re.search(r"giver:\s*'([^']+)'", head)
    if not n_m:
        continue
    n = int(n_m.group(1))
    # steps region until closing of this M({ — next n: after steps
    # take until we hit `\n});` after steps
    end = p.find("\n});")
    body = p[:end] if end > 0 else p[:12000]
    steps = re.findall(r"t:\s*'([a-z]+)'", body)
    # story spots site.spot
    refs = re.findall(r"'([a-z][a-z0-9]+)\.([A-Za-z][A-Za-z0-9]*)'", body)
    # talk who
    whos = re.findall(r"who:\s*'([^']+)'", body)
    # parts speakers [['id',
    speakers = re.findall(r"\['([^']+)'", body)
    # prop types
    props = re.findall(r"\.prop\('([^']+)'", body)
    # spawn types
    spawns = re.findall(r"\.spawn\('([^']+)'", body)
    # cast ids
    casts = re.findall(r"\.cast\('([^']+)'", body)
    # use things
    things = re.findall(r"thing:\s*'([^']+)'", body)
    missions.append({
        "n": n,
        "title": title_m.group(1) if title_m else "?",
        "at": at_m.group(1) if at_m else None,
        "sites": re.findall(r"'([^']+)'", sites_m.group(1)) if sites_m else [],
        "giver": giver_m.group(1) if giver_m else None,
        "steps": steps,
        "refs": refs,
        "whos": whos,
        "speakers": speakers,
        "props": props,
        "spawns": spawns,
        "casts": casts,
        "things": things,
        "body": body,
    })

print(f"missions parsed: {len(missions)}")
print(f"mission numbers: {sorted(m['n'] for m in missions)}")
missing_n = [i for i in range(1, 101) if not any(m['n']==i for m in missions)]
print(f"missing mission numbers: {missing_n}")

# step types
all_steps = set()
for m in missions:
    all_steps.update(m["steps"])
print(f"step types used: {sorted(all_steps)}")
handlers = set(re.findall(r"\n  ([a-z]+): \{", src[src.find("const STEPS"):src.find("const Missions")]))
print(f"STEPS handlers: {sorted(handlers)}")
print(f"unknown step types: {sorted(all_steps - handlers)}")

# site coverage
print(f"StoryMap sites planned: {sorted(set(puts+adopts))}")
print(f"LAYOUTS keys: {layout_keys}")

# refs vs layouts
missing_spots = collections.defaultdict(set)
missing_sites = collections.defaultdict(set)
for m in missions:
    for site, spot in m["refs"]:
        if site not in layout_spots and site not in sites:
            missing_sites[m["n"]].add(site)
        spots = layout_spots.get(site, set())
        # adopted towns may not have layout spots
        if site in layout_spots and spot not in spots and spot not in {"c"}:
            missing_spots[m["n"]].add(f"{site}.{spot}")

print("\n=== MISSING LAYOUT SPOTS (hand-built sites only) ===")
for n in sorted(missing_spots):
    print(f"  M{n}: {sorted(missing_spots[n])}")

print("\n=== SITE REFS NOT IN LAYOUTS OR PLAN ===")
for n in sorted(missing_sites):
    print(f"  M{n}: {sorted(missing_sites[n])}")

# adopted town refs
adopted = set(adopts) | {"capital"}
print("\n=== ADOPTED-TOWN SPOT REFS ===")
adopt_refs = collections.defaultdict(set)
for m in missions:
    for site, spot in m["refs"]:
        if site in adopted:
            adopt_refs[site].add(spot)
for site in sorted(adopt_refs):
    print(f"  {site}: {sorted(adopt_refs[site])}")

# CAST vs speakers
print("\n=== CAST KEYS ===")
print(sorted(cast_keys))

generic = {
    "ren","narr","Farmer","Soldier","Townswoman","Shopkeeper","Driver","Sota","Smuggler",
    "Messenger","Boatman","Horse Dealer","Mercenary","Officer","Guard","Child","Kid",
    "Villager","oldfarmer","headman","Merchant","conscript","elder","oldprisoner",
    "sister","cabbage","bathowner","boy","genda","Supervisor","Soldier",
}
unknown_speakers = collections.defaultdict(set)
for m in missions:
    for sp in m["speakers"] + m["whos"] + m["casts"]:
        if sp in ("ren","narr"): continue
        if sp in cast_keys: continue
        if re.match(r"^[A-Z]", sp) or sp in generic: continue
        unknown_speakers[m["n"]].add(sp)

print("\n=== UNKNOWN CAST SPEAKERS / CAST IDS ===")
for n in sorted(unknown_speakers):
    print(f"  M{n}: {sorted(unknown_speakers[n])}")

# props used vs drawn
used_props = set()
for m in missions:
    used_props.update(m["props"])
    used_props.update(m["things"])
print("\n=== PROP TYPES USED IN MISSIONS ===")
print(sorted(used_props))
print("drawn:", sorted(prop_draws))
print("undrawn props:", sorted(used_props - prop_draws - {"mpt"}))

# missions whose `at` site is not in sites list
print("\n=== MISSION START `at` SITES ===")
for m in missions:
    at = m["at"] or ""
    sm = re.search(r"([a-z][a-z0-9]+)\.", at)
    if sm and sm.group(1) not in sites:
        print(f"  M{m['n']} at={at} UNKNOWN SITE")

# steps without text
print("\n=== GO/TALK/USE/KILL STEPS MISSING text ===")
for m in missions:
    # crude: look at step objects
    for block in re.finditer(r"\{ t: '([^']+)'([^}]*)\}", m["body"]):
        t, rest = block.group(1), block.group(2)
        if t in ("go","talk","use","kill","sneak","hide","ride","escape","follow","escort","chase","defeat","survive","hold","horse","mount","dismount") and "text:" not in rest and "text :" not in rest:
            # multiline steps often have text on next lines — skip if too short
            if len(rest) < 80:
                print(f"  M{m['n']} {t} maybe no text: {rest[:70]!r}")

print("\n=== DONE ===")
