// §10 — The primitive vocabulary, as a pure geometry builder.
//
//   box(x,y,z, w,h,d, col)         building mass, cabin, wheel, parapet, prop
//   plane(x,z, w,d, y, col)        ground, road, sidewalk, lot
//   gable(x,y,z, w,d, rise, col)   roof — TAKES WIDTH AS AN ARGUMENT (§10)
//
// Everything is quads and tris with flat per-face normals and vertex colours,
// appended into growable arrays and finalized to typed arrays. There is NO
// three.js here: the output is exactly the transferable ArrayBuffer set a Web
// Worker would post back (hard rule 5), so moving generation off the main thread
// later is a plumbing change, not a rewrite.
//
// Coordinates: +y up. (x,y,z) is the CENTRE of a box; for plane/gable it is the
// footprint centre at base height y. 1 unit = 1 metre (§10).

export class MeshBuilder {
  constructor() {
    this.pos = [];
    this.norm = [];
    this.col = [];
    this.idx = [];
    this.tris = 0;
  }

  // Append one flat quad (4 corners, CCW seen from the normal side) + colour.
  quad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, r, g, b) {
    // face normal from the first three corners
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = dx - ax, vy = dy - ay, vz = dz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;

    const base = this.pos.length / 3;
    this.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
    for (let i = 0; i < 4; i++) {
      this.norm.push(nx, ny, nz);
      this.col.push(r, g, b);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    this.tris += 2;
  }

  // Append one flat triangle + colour.
  tri(ax, ay, az, bx, by, bz, cx, cy, cz, r, g, b) {
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;

    const base = this.pos.length / 3;
    this.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    for (let i = 0; i < 3; i++) {
      this.norm.push(nx, ny, nz);
      this.col.push(r, g, b);
    }
    this.idx.push(base, base + 1, base + 2);
    this.tris += 1;
  }

  // A ground/lot/road plane: horizontal, facing +y, centred at (x,z), base y.
  plane(x, z, w, d, y, col) {
    const hw = w / 2, hd = d / 2;
    const [r, g, b] = col;
    this.quad(
      x - hw, y, z - hd,
      x - hw, y, z + hd,
      x + hw, y, z + hd,
      x + hw, y, z - hd,
      r, g, b,
    );
  }

  // A box: (x,y,z) is its CENTRE. Five visible faces by default (skip the bottom
  // to save tris — nothing looks up at a building's underside). Set floor=true
  // for the rare box that needs a bottom.
  box(x, y, z, w, h, d, col, floor = false) {
    const hw = w / 2, hh = h / 2, hd = d / 2;
    const [r, g, b] = col;
    const x0 = x - hw, x1 = x + hw;
    const y0 = y - hh, y1 = y + hh;
    const z0 = z - hd, z1 = z + hd;
    // top (+y)
    this.quad(x0, y1, z0, x0, y1, z1, x1, y1, z1, x1, y1, z0, r, g, b);
    // sides
    this.quad(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, r, g, b); // +z
    this.quad(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0, r, g, b); // -z
    this.quad(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, r, g, b); // -x
    this.quad(x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1, r, g, b); // +x
    if (floor) this.quad(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, r, g, b); // -y
  }

  // A gable roof sitting on top of a building. (x,y,z) is the footprint centre
  // at eave height y; the ridge runs along the d (z) axis and rises `rise`
  // metres. Width `w` is an argument, so the roof fits any building (§10) — the
  // fixed-8m-gable that could not stretch is exactly what this avoids.
  gable(x, y, z, w, d, rise, col) {
    const hw = w / 2, hd = d / 2;
    const [r, g, b] = col;
    const yr = y + rise;
    // two slopes meeting at the ridge (ridge along z)
    this.quad(x - hw, y, z - hd, x - hw, y, z + hd, x, yr, z + hd, x, yr, z - hd, r, g, b); // -x slope
    this.quad(x + hw, y, z + hd, x + hw, y, z - hd, x, yr, z - hd, x, yr, z + hd, r, g, b); // +x slope
    // two triangular gable ends
    this.tri(x - hw, y, z - hd, x, yr, z - hd, x + hw, y, z - hd, r, g, b); // -z end
    this.tri(x + hw, y, z + hd, x, yr, z + hd, x - hw, y, z + hd, r, g, b); // +z end
  }

  // Finalize to the transferable typed-array set (hard rule 5).
  build() {
    return {
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.norm),
      colors: new Float32Array(this.col),
      indices: (this.pos.length / 3 > 65535 ? Uint32Array : Uint16Array).from(this.idx),
      triangles: this.tris,
      vertices: this.pos.length / 3,
    };
  }
}
