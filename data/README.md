# data/

Build-time artifacts (§4). Nothing here is committed — the `.json` blobs are
generated, and the determinism test (§5) guards their content by digest.

Regenerate the world index with:

```
npm run worldindex -- 8829
```

This writes `world-index.<seed>.json` (~80 KB, inside the §4 40–100 KB budget):
every settlement's id, tier, position, culture, and name. `rx`/`rz` (region) and
`palette` are omitted because the loader recomputes them from position and
culture. The rich in-memory object returned by `generateWorldIndex()` still
carries them.
