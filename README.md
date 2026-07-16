# Patina

> An open-world PSX-style driving/crime game. Bounded procedural world, built
> from primitives, 1997 hardware aesthetic on purpose.
>
> The name means the beautiful thing time does to metal. The game is about rust.

Drive between procedurally generated cities in a 128 × 128 km bounded world, in a
rusted hatchback, at 320×240, through 100 m of fog. Cause trouble. Get chased.
Die. Respawn.

The full design lives in [`docs/PATINA.md`](docs/PATINA.md) — **the only design
document.** Read §1 (the thesis) and §0 (the hard rules) first. Everything in
`src/` cites the section it implements.

## Status — Phase 5: On foot & driving ✅

The roadmap (§16) gates each phase on the previous one running.

**Phase 2 — Foundation** (pure logic; per §5 the determinism test came first):

| Piece | Section | File |
|---|---|---|
| Seed chain (`hash`/`unit`/`rng`) | §5 | `src/core/hash.js` |
| Constants — `MODULE` grid, world scale | §10, §4 | `src/core/constants.js` |
| Zoning (`zoneAt` + `rules`) | §7 | `src/core/zoning.js` |
| Floating origin (`rebaseIfNeeded`) | §8 | `src/core/origin.js` |
| Deterministic fields (habitability, culture) | §6, §9 | `src/worldgen/field.js` |
| Naming cultures + ped names | §9 | `src/worldgen/names.js` |
| Build-time world index | §4, §6 | `src/worldgen/worldIndex.js` |

**Phase 3 — One city** (streets → blocks → lots → buildings, density gradient visible):

| Piece | Section | File |
|---|---|---|
| Primitive vocabulary (`box`/`plane`/`gable`) | §10 | `src/render/meshbuilder.js` |
| Culture-bound building palette | §9 | `src/render/palette.js` |
| City generator (whole city at once) | §6, §7 | `src/worldgen/city.js` |
| PSX material + 240-line post pass | §3 | `src/render/psx.js` |
| World-map explorer (2D) | — | `web/index.html` · `web/main.js` |
| **City viewer (3D)** | — | `web/city.html` · `web/city.js` |

**Phase 4/5 — On foot & driving** (fixed timestep, collision, real fog, get in/out of cars):

| Piece | Section | File |
|---|---|---|
| Vehicle sim (simple on-rails handling) | §12 | `src/sim/vehicle.js` |
| Pedestrian sim (tank walk) | §12 | `src/sim/pedestrian.js` |
| Collision (grid broadphase, AABB) | §12 | `src/sim/collision.js` |
| Car + person meshes | §10, §14 | `src/render/car.js` · `src/render/ped.js` |
| Parked cars along the kerbs | §6 | `src/worldgen/city.js` |
| **Play app** (walk → enter car → drive) | §3, §12 | `web/play.html` · `web/play.js` |

Walk the streets, find a parked car, press **E** to get in, drive it, press **E**
to get out. Parked cars are one **InstancedMesh** (a single draw call for
thousands). Driving is deliberately simple — W/S move along the path, steering
*curves* the path, no lateral slip.

The generation core (`meshbuilder`, `city`) is **pure and worker-ready** — it
returns transferable typed arrays with no three.js, so moving it into a Web
Worker (hard rule 5) later is plumbing, not a rewrite. A whole city merges into
**one `BufferGeometry` → ~1–2 draw calls** (§10, §11).

The sim is the load-bearing part of §12: a **fixed 60 Hz timestep** via an
accumulator, stepped on **input** (`{throttle, steer, brake, handbrake}`) not
positions, with rendering interpolated on top and **zero allocation in the loop**
(hard rule 3). It is pure and deterministic — the same inputs replay to the same
trajectory (pinned in the test), which is exactly what LAN multiplayer will lean
on later. three.js is the only runtime dependency; esbuild bundles the 3D pages
into self-contained files.

## Commands

```
npm test                 # determinism + city + driving/walking suite (§5) — 24 checks
npm run worldindex       # build the offline world index blob (§4)
npm run bundle           # build the 2D world-map explorer  → dist/index.html
npm run bundle:city      # build the 3D city viewer          → dist/city.html
npm run bundle:play      # build the on-foot + driving game  → dist/play.html
npm run smoke:play       # headless WebGL check (gets in a car, asserts it moves)
```

Open `dist/index.html` (map), `dist/city.html` (city), or `dist/play.html`
(play) in a browser — all self-contained, no server needed. In `play`:
**W/S** walk·drive, **A/D** turn·steer, **Shift** run, **E** get in / out of a car, **R** new spawn.

## What the determinism test pins

Same seed → same world is load-bearing and **fails silently**. The suite freezes:

- `hash(1,2,3)` — the mixer constant (§5 check #1)
- the whole world-index **digest** for seed 8829 (§5 check #3 — the real guard
  against a stray `Math.random()` or a Set iteration drifting the world)
- the **§4 count spec**: metros in `[3,7]`, cities ~35, towns ~150 — so a
  thumbnail-tuned prototype can never re-inflate them to 21/92/290 again
- ASCII-only name tables (§9 — the `Portराvenburg` guard)
- the §7 invariant that a cul-de-sac and 6 floors can never meet
- the §8 floating-origin invariant that local coords stay small while
  `world = local + origin` reconstructs exactly

## The hard rules (§0)

Violating any of these means a rewrite later, not a patch:

1. No `Math.random()` in worldgen. Ever. Pure `(seed, coords)` through the hash chain.
2. Worldgen RNG and gameplay RNG are separate streams.
3. Zero allocation inside the frame loop. Pool everything.
4. Fixed timestep, input-driven (a multiplayer constraint from day one).
5. Worldgen runs in Web Workers; geometry returns as transferable `ArrayBuffer`s.
6. Nothing exists beyond the fog. Past ~100 m, agents are *deleted*, re-hashed on approach.
7. Never bake a navmesh. The road graph *is* the navmesh.
8. Never let a chunk decide where a road goes. Roads generate at region/city altitude.
9. Never store absolute world coordinates in anything that renders or simulates.
10. Never hard-code `2.5`. Reference `MODULE`.
