// §6 / §18 — Highways. "Highways — region — deterministic MST over anchors."
//
// A minimum spanning tree over the labelled settlements gives a road network that
// connects every city and town with no loops and minimal total tarmac — an
// interstate skeleton you can follow between cities. Pure and deterministic:
// same world index → same roads. Built once (cheap: Prim's O(n²) over ~200 nodes).

// Returns edges as { ax, az, bx, bz } in world metres.
export function buildRoads(index) {
  const nodes = index.settlements.filter((s) => s.tier !== 'hamlet');
  const n = nodes.length;
  if (n < 2) return [];
  const inTree = new Array(n).fill(false);
  const best = new Array(n).fill(Infinity);
  const parent = new Array(n).fill(-1);
  best[0] = 0;
  const edges = [];
  for (let it = 0; it < n; it++) {
    // pick the closest node not yet in the tree
    let u = -1;
    let bd = Infinity;
    for (let i = 0; i < n; i++) if (!inTree[i] && best[i] < bd) { bd = best[i]; u = i; }
    if (u < 0) break;
    inTree[u] = true;
    if (parent[u] >= 0) {
      const a = nodes[parent[u]];
      const b = nodes[u];
      edges.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
    }
    for (let v = 0; v < n; v++) {
      if (inTree[v]) continue;
      const dx = nodes[u].x - nodes[v].x;
      const dz = nodes[u].z - nodes[v].z;
      const d = dx * dx + dz * dz;
      if (d < best[v]) { best[v] = d; parent[v] = u; }
    }
  }
  return edges;
}

// Squared distance from point (px,pz) to segment (ax,az)-(bx,bz). For deciding
// which road segments are near enough to the player to render.
export function segDist2(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz || 1;
  let t = ((px - ax) * dx + (pz - az) * dz) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + dx * t;
  const cz = az + dz * t;
  const ex = px - cx;
  const ez = pz - cz;
  return ex * ex + ez * ez;
}
