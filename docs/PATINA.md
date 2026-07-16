# Patina

> An open-world PSX-style driving/crime game. Bounded procedural world, built from
> primitives, 1997 hardware aesthetic on purpose.
>
> The name means the beautiful thing time does to metal. The game is about rust.
> The dictionary sets you up; the game knocks you down.

**This is the only design document. It supersedes everything before it.**
If something here contradicts an older file, an older chat, or a comment in the code,
this wins. Read it start to finish once; §1 is the load-bearing part.

---

# 0. Hard rules

Violating any of these means a rewrite later, not a patch. They are here at the top
because they constrain every line of code in the project.

1. **No `Math.random()` in worldgen. Ever.** All generation is a pure function of
   `(seed, coordinates)` through a hash chain. No global RNG state.
2. **Worldgen RNG and gameplay RNG are separate streams.** A bullet-spread roll must
   never advance the stream that places buildings.
3. **Zero allocation inside the frame loop.** Pool everything. Preallocate typed arrays.
   GC pauses are the #1 killer of JS games and retrofitting pooling is a rewrite.
4. **Fixed timestep, input-driven.** The sim steps at a fixed `DT` via an accumulator;
   rendering interpolates on top. Never step on `deltaTime`. See §12 — this is a
   multiplayer constraint that must be honoured from day one.
5. **Worldgen runs in Web Workers.** Geometry returns as transferable `ArrayBuffer`s.
6. **Nothing exists beyond the fog.** Past ~100 m, peds and traffic are *deleted*, not
   culled. Re-hashed from the tile seed on approach.
7. **Never bake a navmesh.** The road graph *is* the navmesh.
8. **Never let a chunk decide where a road goes.** Roads generate at region/city
   altitude. See §6.
9. **Never store absolute world coordinates in anything that renders or simulates.**
   See §8 — floating origin.
10. **Never hard-code `2.5`.** Reference `MODULE`.

---

# 1. The thesis

## The tension

No Man's Sky is infinite *because it's mostly empty*. Wilderness with sparse points of
interest is cheap to generate and forgiving when it repeats. GTA is the opposite: dense,
authored, legible. **You cannot author 18 quintillion city blocks.**

## The resolution

- The infinite-feeling part is **low-density connective tissue** — terrain, highways,
  roadside junk.
- Cities are **assembled from rules**, not invented from noise.
- The world is **bounded**, not infinite. This is a feature. See §4.
- **PSX fog is the entire performance budget.** See §3.

## What the game is

Drive between procedurally generated cities in a 128 × 128 km bounded world, in a rusted
hatchback, at 320×240, through 100 m of fog. Cause trouble. Get chased. Die. Respawn.

---

# 2. Decisions log

Everything settled, and why. **Reopen these only with a reason, not a mood.**

| Decision | Rationale |
|---|---|
| **Bounded 128×128 km, not infinite** | Enables a build-time index, hand-tuning, a real map. Infinite is a flex nobody plays. |
| **PSX style** | Aesthetic *and* performance architecture. Fog is the whole budget. |
| **Primitives, not scavenged assets** | See §10. The asset packs cost three unit systems, three pivot conventions, a 295-texture bake pipeline, and a roof that couldn't stretch. They bought "buildings that look like buildings." Not worth it. |
| **three.js / web** | Chosen. GC and workers are the tax. |
| **Plain JavaScript, not TypeScript** | TS was enforcing an asset contract that no longer exists. With primitives there are no import scales to get wrong. The friction stopped buying anything. Revisit if the codebase passes ~10k lines. |
| **Custom arcade vehicle physics, not Rapier** | GTA's handling was never rigid-body sim. Custom is simpler, deterministic by construction (§12), and one less dependency. Add Rapier only when ragdolls become mandatory. |
| **Merged geometry, not instancing (for now)** | A whole city in one buffer is ~3 draw calls. Instancing matters when geometry repeats *and* moves. Buildings don't move. |
| **Fixed timestep from day one** | §12. Non-negotiable. |
| **Peds before guns** | §14. Guns first is the trap. |
| **No hunger, no sleep** | §17. |
| **Exteriors only** | §17. |

---

# 3. PSX is a performance architecture

This is the load-bearing insight. The style and the scale are *synergistic*.

| Technique | Was (1997) | Is (for us) |
|---|---|---|
| **Fog at ~100 m** | hardware necessity | free excuse to never render far — kills draw distance, agent LOD, and culling at once |
| Affine texture mapping | no perspective correction | the warping is a feature, and cheaper |
| Vertex snapping | fixed-point vertex precision | jitter hides LOD popping we'd otherwise fight |
| 320×240 internal target | CRT output | fill rate is free; upscale to viewport |
| Palettized colour | 2 MB VRAM | quantization + dithering *is* the signature |
| Flat/low-poly | no geometry budget | primitives are period-correct, not a compromise |

**Fog is the most important number in the game.** Everything downstream — streaming
radius, agent LOD, draw budget — derives from it.

### Vertex snapping

Inject into the vertex shader. Do not fake it in JS.

```glsl
gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
gl_Position.xyz /= gl_Position.w;
gl_Position.xy = floor(uSnap * gl_Position.xy) / uSnap;   // uSnap ≈ (160, 120)
gl_Position.xyz *= gl_Position.w;
```

### Render target

Internal height **240 lines**, width = `240 × aspect`, upscaled with
`image-rendering: pixelated`. `NearestFilter` everywhere. This matters more than any
texture resolution decision.

> **Texel density is not what sells PSX.** The palette, `NearestFilter`, dithering,
> and the low-res target do that work. Learned the expensive way.

---

# 4. World scale

**128 × 128 km.** ~16,384 km². Roughly 200× GTA V.

Why bounded:
- At 60 km/h, crossing a 256 km world is a four-hour drive. That's not awe, it's a commute.
- "Lose every game of hide and seek" is about **number of distinct places**, not km².
- Fog at 100 m means you never see more than a postage stamp of it — which paradoxically
  makes it feel *bigger*.

### Targets

| Tier | Count | City radius | Spacing | Notes |
|---|---|---|---|---|
| Metro | **~5** | ~2,000 m | ~57 km | labelled, dense core |
| City | **~35** | ~800 m | ~20 km | labelled |
| Town | **~150** | ~300 m | ~9 km | labelled at close zoom |
| POI / hamlet | ~1,000 | — | ~4 km | unlabelled |

> ⚠️ **These numbers are the spec.** An early prototype produced 21 metros / 92 cities /
> 290 towns because it was tuned to look good in a thumbnail. One metro every 28 km means
> you'd see the next city's fog glow from the last one's edge. Real metros sit 100–300 km
> apart. **Pin these counts in the determinism test (§5) so they can't drift.**

### The build-time world index

Because the world is bounded, the region grid is a **table**, not a search problem.
128 km / 8 km regions = **16 × 16 = 256 regions**.

**Run the settlement generator once, offline.** Ship the result as a ~40–100 KB blob:
every settlement's position, tier, name, culture, road-anchor list.

What this buys that infinite worlds can never have:
- A real world map and fast-travel list
- Global name deduplication, guaranteed
- **Hand-tuning.** Nudge a city that generated somewhere stupid. Ban a cursed name.
- Runtime never hunts for cities. It looks them up.

Everything *below* city level stays runtime-hashed and stateless.

---

# 5. The seed chain

Nothing is stored. Everything is a pure function of position + seed.

```
worldSeed (u32)
  └─ regionSeed = hash(worldSeed, rx, rz)
       └─ citySeed  = hash(regionSeed, cityIndex)
            └─ blockSeed = hash(citySeed, bx, bz)
                 └─ lotSeed = hash(blockSeed, lotIndex)
                      └─ propSeed = hash(lotSeed, propIndex)
```

```js
export function hash(...a){
  let h = 2166136261 >>> 0;
  for (let i = 0; i < a.length; i++){
    h ^= a[i] | 0;
    h = Math.imul(h, 16777619) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 2246822519) >>> 0;
    h ^= h >>> 15;
  }
  return h >>> 0;
}
export const unit = h => (h >>> 8) / 16777216;    // 0..1
export const rng  = (...a) => unit(hash(...a));
```

**Invariant: any node must be computable without computing its siblings.** This is what
makes streaming, kilobyte saves, and multiplayer possible.

## The determinism test — write this first

The entire premise is *same seed → same world*. It is load-bearing, and **it fails
silently**: someone adds a `Math.random()` for a "temporary" jitter, or iterates a `Set`,
and the world quietly changes. No error. Old saves just point at a world that no longer
exists.

```js
// 1. the mixer itself is frozen
assert(hash(1,2,3) === KNOWN_CONSTANT);

// 2. same process, twice
assertDeepEqual(generateWorldIndex(8829), generateWorldIndex(8829));

// 3. across processes and refactors — the real guard
assert(digest(generateWorldIndex(8829)) === CHECKED_IN_DIGEST);

// 4. the spec, pinned
assert(counts(8829).metros >= 3 && counts(8829).metros <= 7);
```

Rule 1 is aspirational without #3. Write it while the surface is three modules, not thirty.

---

# 6. Generation altitude

Procedural cities die at chunk boundaries. **The fix is to never let a 64 m chunk decide
where a road goes.** Generate each layer at the right altitude.

| Layer | Generated at | Method | Cost |
|---|---|---|---|
| Landmass, climate | continuous field | domain-warped fBm + radial falloff | free, stateless |
| Settlement anchors | region (8 km) | jittered grid, habitability-weighted | build-time |
| Highways | region | deterministic MST over anchors | build-time |
| **Street grid** | **whole city, at once** | zone-driven template (§7) | graph only — KB |
| Blocks → lots | city | subdivision by zone rules | cheap |
| Buildings | lot | primitive assembly (§10) | streamed |
| Props, junk | lot | `hash(lotSeed, propIndex)` | streamed |
| Peds, traffic | tile + time | never persisted | streamed |

A city's *graph* generates whole when the player is within ~5 km. It's nodes and edges —
kilobytes. Only geometry streams.

### The road graph IS the navmesh

Traffic = agents on graph edges with lane offsets. Peds = sidewalk splines offset from the
same graph. **Never bake a navmesh.** Do not lose this.

---

# 7. Zoning

**This section is the one that was missing, and its absence produced 5-storey buildings
in cul-de-sacs.** Read it carefully.

## Two axes, not one

Settlement **tier** is half the picture. The other half is **distance from centre**.

A big city is not uniformly tall. It's a **core** of towers, wrapped in a **ring**, wrapped
in an **edge** of houses and cul-de-sacs — which is *most of its area*. And a town isn't
"no core"; it's a two-storey main street.

Give a generator only tier, and it has nowhere to put houses in a big city, so it either
towers the whole thing or houses the whole thing. Both look like "the opposite."

## The rule

```js
const CORE_R = { metro:0.26, city:0.16, town:0.09 };  // fraction of city radius
const RING_R = { metro:0.62, city:0.46, town:0.30 };
const CITY_R = { metro:2000, city:800,  town:300  };  // metres

function zoneAt(tier, dist){
  const t = dist / CITY_R[tier];
  if (t < CORE_R[tier]) return 'core';
  if (t < RING_R[tier]) return 'ring';
  return 'edge';
}
```

## The table

`rules(tier, zone)` returns **streets and buildings together, from one function.**

|  | **Core** | **Ring** | **Edge** |
|---|---|---|---|
| **Metro** | 6–12 floors, offices, 0 setback, shared walls, parapet, tight grid | 3–5, apartments, 1.25 m setback, flat roof, grid | 1–2, houses, 7.5 m setback, detached, gable, **cul-de-sacs** |
| **City** | 3–5, stores, 0 setback, shared walls, parapet, grid | 2–3, 1.25 m setback, flat, grid | 1–2, houses, 7.5 m setback, detached, gable, cul-de-sacs |
| **Town** | 2, main street, 0 setback, flat, grid | 1–2, houses, 5 m setback, gable | 1, houses, 7.5 m setback, detached, gable, cul-de-sacs |

```js
function rules(tier, zone){ /* → { floors:[min,max], lot, setback, roof, detached, streets } */ }
```

**Because street template and building rule come from the same function, a cul-de-sac and
6 floors can never meet.** A single function would have to contradict itself to emit them.

> If zones look inverted — towers on the rim, bungalows downtown — check the sign on the
> distance term and the tier percentile. That's a two-character bug that produces a
> correct-looking implementation.

## Why it matters

The **density gradient** is what makes a city read as a city rather than wallpaper. Metro →
core, ring, sprawl. City → small core, mostly suburban. Town → main street and houses.

Radial layouts are **medieval-European plaza geometry**, not the default. Real cities are
grids. Make radial rare — one culture, one tier, never the general case. (And a radial
layout is *spokes + rings*, not rings alone. Rings alone give you a donut.)

---

# 8. Floating origin

**This section is the other one that was missing, and its absence is why the full map
glitched while the beta city was fine.**

`float32` has 24 bits of mantissa. At 128 km:

```
128000 / 2²³ ≈ 1.5 cm
```

Vertices jitter. The depth buffer fights itself. Physics integration accumulates error
every step. It works beautifully near the origin and falls apart the moment you drive away.

## The fix

Keep the player within ~250–1000 m of `(0,0,0)` and **move the world instead**.

```js
const origin = { x:0, z:0, count:0 };

function rebaseIfNeeded(){
  if (Math.hypot(car.x, car.z) < REBASE_AT) return;
  origin.x += car.x;  origin.z += car.z;
  world.position.x -= car.x;  world.position.z -= car.z;
  car.x = 0;  car.z = 0;
  origin.count++;
}
```

**Corollary — hard rule 9:** nothing that renders or simulates may store an absolute world
coordinate. Everything is local. Absolute coords exist only in:
- the build-time world index (§4), which is data, not simulation
- the save delta map (§13), which is hashed, not positional
- `origin`, which is the one place allowed to know

Convert at the boundary: `world = local + origin`.

---

# 9. Naming

A flat dictionary plus random picks gives Grand Falls, New Falls, Falls City. Mush.

**What sells a map is regional coherence.** Assign each region a naming culture via
**low-frequency noise** — this produces contiguous blobs, not salt-and-pepper. Contiguity
is the entire trick. Then run a per-culture grammar.

| Culture | Grammar | Feel |
|---|---|---|
| Anglic | `[New/Port/Fort/Mount/East] + root + [-ton/-burg/-ford/-haven]` | rust belt, New England |
| Iberic | `[Santa/San/Rio/Los/Puerto] + root + [-a/-os/-ada/-ero]` | southwest |
| Rustbelt | `[Old/North/Lower] + root + [Works/Yard/Junction/Flats]` | industrial |
| Conlang | CV syllable generator — no dictionary at all | old-country |

The conlang culture: strict CV, 2–3 syllables. Swap the onset/vowel subset per region for
phonotactic drift — different regions sound like different peoples, from no word list.

**Bind the building palette variant to the same noise field.** Red brick northeast, orange
plaster southwest. One line, and cities look like they come from somewhere.

Dedupe globally at build time (§4).

> **ASCII only in name tables.** A previous version shipped `"राven".replace("Раven","Raven")` —
> Devanagari source, Cyrillic search target, Latin replacement, a `.replace()` that could
> never fire. It rendered `Portराvenburg`. Lint for non-ASCII in the culture arrays.

## Ped names

Same generator, different grammar. Base names are corporate mashups and Bob-variants:

- **Bob family:** Bob, Bobert, Bobson, Bobandy, Bobrick, Bobbi, Jimbob, Bobette, Bobothy,
  Bobbins, Bobitha, Bobra, Boblas
- **Mashups:** Jimothy, Billiam, Philbert, Gary, Marv, Cletus, Poindexter, Fredrick, Albert
- **Modifiers:** prefix `Ol'`, suffix `Jr.`

`hash(pedSeed, 'name')`. Never `Math.random()`.

---

# 10. Primitives

**Decision: build the world from boxes, planes, and prisms. No scavenged assets.**

## Why

The asset packs cost: three unrelated unit systems (×1.25, ×0.80, ×0.00383), three pivot
conventions, 295 textures needing a bake pipeline that produced zero gameplay, FBX parsing,
a texel-density mismatch, and **a fixed 8 m gable that could not stretch** — which broke
every building wider than 10 m.

They bought: buildings that look like buildings.

With primitives **you define the pivot. You define 1 unit = 1 metre.** And a roof is a
function of width, so it fits anything, forever.

**A grey box world with 100 m fog and a 320×240 target is not a downgrade. It's the
aesthetic.** Silent Hill is fog and boxes.

## The grid

```js
const MODULE   = 2.5;              // m — the master unit
const HALF     = 1.25;
const FLOOR    = MODULE;           // floor height == module
const LANE     = MODULE * 1.5;     // 3.75 m  ✓ real lanes are 3.5–3.7
const SIDEWALK = MODULE;           // 2.5 m
const CORRIDOR = LANE*2 + SIDEWALK*2;  // 12.5 m = 5 modules ✓ real: 12–15
const BLOCK    = MODULE * 24;      // 60 m
const PED_H    = 1.8;
const FOG_FAR  = 100;
```

2.5 m is now a **choice**, not a measurement. It survives because the derived street
cross-section lands on real-world numbers and everything is already built around it.

## The vocabulary

| Primitive | Use |
|---|---|
| `box(x,y,z, w,h,d, col)` | building mass, cabin, wheel, parapet, prop |
| `plane(x,z, w,d, y, col)` | ground, road, sidewalk, lot |
| `gable(x,y,z, w,d, rise, col)` | **roof — takes width as an argument** |
| `quad` / `tri` | the two things everything is made of |

Vertex colours, `MeshLambertMaterial`, fog on. **A whole city merges into one
`BufferGeometry` — roughly 3 draw calls.** Geometry is free; draw calls are not.

## Micro-props

Nobody notices a repeated tower — they're 400 m apart. **Everybody notices a bare
sidewalk.** Props are the last link in the chain: `hash(lotSeed, propIndex)`, ~10 tris.
At 320×240 through 100 m of fog, a cigarette butt is four pixels.

**You don't need detail. You need presence.** Ten thousand cost nothing.

---

# 11. Stack, and the four things that will kill you

**three.js / web / plain JS / Vite.** Rendering is the easy part — fog means the near-field
is tiny. These are the real risks:

### 1. Garbage collection ⚠️ HIGHEST
The #1 killer of JS games, and nobody talks about it. A GC pause mid-corner at 60 mph is a
stutter you will never debug, because it isn't in your code.

Pool everything. Preallocate typed arrays. **Zero allocation in the frame loop.** Design
for it from day one; retrofitting is a rewrite.

### 2. Worldgen on the main thread
Gen runs in **Web Workers**, geometry returns as transferable `ArrayBuffer`s (zero-copy).
The hash chain makes this trivial — workers need nothing but a seed and coordinates. That's
*why* it's stateless.

### 3. Draw calls
Budget **200–300**. Merge static geometry per city at bake time. Instance only what repeats
*and* moves.

### 4. Agent AI at scale
**LOD the AI, not just the mesh.**

| Distance | Peds | Traffic |
|---|---|---|
| < 30 m | full state machine, reactions | full physics, collision |
| 30–100 m | walk cycle on sidewalk spline | kinematic, follows road graph |
| > 100 m (fog) | **deleted** | **deleted** |

Nothing beyond the fog exists. Re-approach re-hashes from the tile seed — same ped, same
shirt, same car, because it's the same hash. Players read that as persistence. It isn't.

---

# 12. Fixed timestep, and the multiplayer shape

**LAN multiplayer is not a phase. It's a constraint on every phase before it.**

Bolt it on last and you retrofit a fixed loop, input/state separation, and an authority
model into a codebase that grew up assuming none of them. That's not a feature. That's a
rewrite of everything.

You are already most of the way there, and didn't do it for netcode reasons:

- The hash chain means clients **never sync world data**. Both peers compute the same city
  from the same seed. That's the expensive part of netcode, already solved.
- The delta map (§13) is your replication format.
- Two RNG streams is exactly what stops gameplay randomness desyncing the world.

What must be true from the day you write the driving:

```js
const DT = 1/60;           // FIXED. Not deltaTime.
let acc = 0;
function frame(now){
  acc += Math.min(0.1, (now - last)/1000);  last = now;
  while (acc >= DT){ step(); acc -= DT; }   // sim
  render();                                  // interpolate on top
}
```

- **Fixed accumulator.** Variable steps diverge two machines within minutes.
- **Send input, not positions.** `{ throttle, steer, brake }`, not `{ x, y, z }`. This
  dictates the shape of the vehicle controller, so decide before you write it.
- **Determinism in the sim.** Custom arcade physics is deterministic by construction. This
  is a real argument against Rapier: float drift from variable stepping is exactly the
  failure mode, and you don't need rigid-body sim for GTA handling anyway.

Costs a day of care now. Costs a month later.

---

# 13. Save format

The world is a pure function ⇒ the save is `worldSeed + sparse delta map`.

```
"car at hash 0x8A3F is destroyed"
"door at hash 0x11C2 is open"
"mission 7 state = complete"
```

Kilobytes. Forever. Hashes, never coordinates (§8).

---

# 14. Peds

**Peds are the root of the dependency graph. Almost everything needs them.**

- Guns need something to shoot → peds
- Dying needs something to kill you → cops → peds
- Wanted level → cops → peds
- Shops → shopkeepers, or at least a street with people on it

### Build order

**peds → death/respawn → wanted → guns.**

Guns first is the trap. A gun with nothing to shoot is a particle effect.

### Rendering

Real PSX characters mostly **weren't skinned** — Resident Evil, Silent Hill, MediEvil were
rigid segmented meshes. The shoulder gaps were the hardware, not a bug.

Two viable paths:

| Path | When |
|---|---|
| **Rigid segmented** — ~12 boxes, transform hierarchy, no skinning cost at all | Default with primitives. Simpler, cheaper, period-correct, and modular variation is free: swap parts by `hash(pedSeed, slot)`. |
| **VAT** (vertex animation textures) — bake positions per frame, sample in the vertex shader | If you want smooth animation. Order-independent, instanced, no bone matrices. |

**Never use three.js `SkinnedMesh` for crowds.** One draw call each. 200 peds = the entire
budget.

### Spawn

The ped origin is between the feet. A capsule collider's origin is its **centre**. Spawn
the capsule at ground level and half of it is underground, taking the mesh with it. Offset
by `+halfHeight`. This is the "feet in the ground" bug.

---

# 15. Missions — the honest part

Templated mission grammars ("take X from A to B, waste Y") bind fine to procedural
landmarks, but **they go stale fast.** This is exactly the No Man's Sky complaint, and
pretending otherwise is how this project fails.

The fix that works: **one authored home city with hand-built story missions; procedural rim
beyond it.** You get the flex *and* the density, and the procedural stuff reads as frontier
rather than filler.

---

# 16. Roadmap

Each phase is only allowed to start when the previous one runs.

| # | Phase | Contains |
|---|---|---|
| **1** | ✅ Design | This document |
| **2** | Foundation | Hash chain · **determinism test (§5) first** · zoning (§7) · floating origin (§8) · primitives vocabulary (§10) |
| **3** | One city | Grid streets, blocks, lots, buildings, density gradient visible |
| **4** | Driving | **Fixed timestep, input-driven (§12)** · arcade handling · collision · fog |
| **5** | The world | Build-time index · world map · pick a city · drive between them |
| **6** | Peds | Segmented or VAT · sidewalk splines off the road graph |
| **7** | Loop | Death · respawn · wanted · cops |
| **8** | Guns | Only now |
| **9** | Traffic | Agents on graph edges |
| **10** | UI | Menus, map, HUD — **after** the bugs, not before |
| **11** | LAN | The constraint has been honoured since phase 4, so this is now a feature |

**Day/night can land anywhere from phase 5 on.** Fog colour + light direction + palette
shift. About a day of work, and it doubles the perceived content of every city already
generated. Period-correct too — fog colour shifts were exactly how PSX did time of day.
Best effort-to-payoff ratio on the whole list.

---

# 17. Cut, and why

**Hunger. Sleep.** Not GTA — survival. GTA has no hunger. San Andreas tried it and it's the
most-complained-about mechanic in the series. A timer that nags you isn't play.
*(The cigarette gag stays. That's a prop joke, not a system: an idle animation, a health
pickup that damages you, a wanted-cooldown you must stand still for.)*

**Indoors.** Not a feature — a re-decision, and the biggest item on any wish list by 10×
while disguised as one word. New geometry, room layout generation, transitions, occlusion.
If it ever happens, do it GTA III style: separate loaded cells behind a door, not rooms in
the world.

**Fishing.** The tell. Most fun to build, least connected to anything. When a fishing
minigame appears on a list where peds don't exist yet, that's the brain asking for a treat.
Not never. Just notice.

### The rule for anything new

**Delete it and ask whether the loop breaks.** If not, it's garnish. Garnish is the reward
for having a meal.

---

# 18. Open

- [ ] Authored hub city — which region? hand-placed or a tuned generation? (§15)
- [ ] Cul-de-sac generation primitive — edge zones need it and grid doesn't have it (§7)
- [ ] Wanted mechanics — cop spawn just outside fog is the classic GTA trick
- [ ] Audio — PSX-era ADPCM crunch, radio stations
- [ ] Highway generation between cities — MST over anchors, but what does the road *look* like?

---

# 19. Lessons

Kept because they were expensive.

**Guessing is more costly than measuring.** Every poly budget guessed in the first draft was
wrong — a building module was guessed at 200 tris and measured at 2.

**A prototype is a sketch, not a spec.** A demo tuned to look good in a thumbnail produced
21 metros instead of 5, and the number was ported as though it were designed. Sketches lie
in the direction of prettiness.

**A section that describes a conclusion is not a ruleset.** "Urban vs suburban is purely a
generation ruleset" was written as though it were done. It was a to-do that read like a
decision. That's what §7 is now for.

**Spec the thing your spec requires.** A 128 km world was specced without floating origin.
The requirement was implied by the number and never written down. That's §8.

**Feature collecting feels exactly like progress and isn't.** It's infinitely scrollable,
always rewarding, and produces no game. This was originally written about asset packs. It
applies identically to the wish list.

**The loop is the game.** Beautiful procedural cities you can drive between is a tech demo.
Do a thing, get a consequence, want to do it again — that's a game. Everything in §16 after
phase 5 exists to build that and nothing else.
