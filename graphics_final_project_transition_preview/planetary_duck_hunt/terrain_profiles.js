// ROUND 3 TERRAIN: this whole file is new.
//
// Per-planet terrain recipes for the bird scene.
//
//   build_terrain("mars") returns everything the landing scene needs to dress one planet:
//     grid              height grid; grid.sample(x, z) = the exact visible ground height at that x, z
//     terrain           mesh dict of the flat shaded heightfield (draw with the "terrain_flat" shader)
//     props             mesh dict of rocks / trees / water / cloud puffs (same shader), never null
//     colliders         [{x, z, r, top}] solid boulders and trunks the player must walk around
//     light             {dir, sun, ambient} for the terrain shader
//     swell             {amp, speed} slow vertex wave (cloud decks only), else null
//     min_height / max_height / walk_max_height   extents (walk_max_height = highest ground the player can reach)
//     deck              true on the four gas / ice giants (the player stands on a platform above the clouds)
//
// All heights are relative to the terrain node's own origin; the landing spot (0, 0) is always flat at y = 0.
// Colours greater than 1.0 in a channel are treated as self lit by the shader (lava glow).

import { gen_terrain_mesh, make_height_grid, FacetedBuilder } from "../util/mesh_generators.js";

export const TERRAIN_SIZE = 340;     // edge length: the player stays within WALK_RADIUS, fog ends well before the edge
export const TERRAIN_SEGMENTS = 104; // 104 * 104 * 6 = 64896 vertices, the most 16 bit indices allow
export const WALK_RADIUS = 75;       // keep in step with GROUND_BOUNDS in earth_scene.js
const PROP_RADIUS = 140;             // props are scattered this far out; nothing farther is ever visible

// ------------------------------------------------------------
// small math + deterministic noise (the same planet always looks the same)
// ------------------------------------------------------------

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lerp = (a, b, t) => a + (b - a) * t;
/** smoothstep; a > b gives the reversed ramp (1 at x <= b, 0 at x >= a). */
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (c0, c1, t) => [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t)];
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

function hash2(ix, iz, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed + 7, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
} // end function

/** smooth value noise, 0..1 */
function vnoise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
} // end function

/** fractal noise, 0..1 (mostly 0.25..0.75) */
function fbm(x, z, seed, octaves = 4) {
  let amp = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * vnoise(x * f, z * f, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  } // end loop
  return sum / norm;
} // end function

/** ridged noise, 0..1: thin bright crests where the base noise crosses 0.5 */
function ridged(x, z, seed, octaves = 4) {
  let amp = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(2 * vnoise(x * f, z * f, seed + i * 13) - 1);
    sum += amp * n * n;
    norm += amp;
    amp *= 0.5;
    f *= 2.1;
  } // end loop
  return sum / norm;
} // end function

function make_rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
} // end function

/** the landing spot stays flat: 0 inside 7 units, full terrain from 24 units out. */
const clear = (x, z) => smooth(7, 24, Math.hypot(x, z));

/** steepness of the ground at x, z as rise over run. */
function gradient(grid, x, z) {
  const e = 1.6;
  const dx = grid.sample(x + e, z) - grid.sample(x - e, z);
  const dz = grid.sample(x, z + e) - grid.sample(x, z - e);
  return Math.hypot(dx, dz) / (2 * e);
} // end function

/**
 * scatter points over the ring min_r..max_r around the landing spot (even by area).
 * ok(x, z, grid) can reject a spot; stops after count points or too many rejections.
 */
function scatter(rng, count, min_r, max_r, ok, grid) {
  const pts = [];
  for (let tries = 0; pts.length < count && tries < count * 30; tries++) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(lerp(min_r * min_r, max_r * max_r, rng()));
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (ok(x, z, grid)) pts.push([x, z]);
  } // end loop
  return pts;
} // end function

/** circles for craters / volcano cones: many small, few big, none over the landing spot. */
function scatter_discs(rng, count, rmin, rmax, keep_clear, area_r = 135) {
  const list = [];
  for (let tries = 0; list.length < count && tries < count * 30; tries++) {
    const r = lerp(rmin, rmax, Math.pow(rng(), 1.7));
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * area_r;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (Math.hypot(x, z) < r + keep_clear) continue;
    list.push({ x, z, r });
  } // end loop
  return list;
} // end function

/** crater profile: a bowl inside the rim radius plus a raised rim just outside it. */
function crater_h(c, x, z) {
  const dx = x - c.x, dz = z - c.z;
  const lim = c.r * 1.9;
  const d2 = dx * dx + dz * dz;
  if (d2 > lim * lim) return 0;
  const t = Math.sqrt(d2) / c.r;
  // optional c.flat (0..1): fraction of the radius that is a flat floor, with a steep wall up to the rim
  const bowl = t < 1 ? -c.depth * (c.flat ? 1 - smooth(c.flat, 1, t) : 1 - t * t) : 0;
  // optional c.rw: rim width term (default 0.07); larger = a broader rim that resolves on the coarse grid
  const rim = (c.rim || 0.45) * c.depth * Math.exp(-((t - 1) * (t - 1)) / (c.rw || 0.07));
  return bowl + rim;
} // end function

// ------------------------------------------------------------
// MARS: rust ground, craggy ridges, boulders, a few craters
// ------------------------------------------------------------

function mars_recipe() {
  const RUST = [0.66, 0.31, 0.16], DUST = [0.86, 0.55, 0.32], DARK = [0.37, 0.17, 0.10];
  const PIT = [0.30, 0.14, 0.09], BOULDER = [0.52, 0.29, 0.19];
  const rng = make_rng(1301);
  // ROUND 4: fewer tiny craters (under the grid's resolution), more big deep ones with tall rims;
  // a few hand placed ones sit in the player's forward view so the rocky character reads at once
  // wide craters with a flattened near lip, so from the spawn you look over the lip into the bowl (as on Mercury)
  const hero = [
    { x: -6, z: -34, r: 21, rim: 0.05 }, { x: -38, z: -8, r: 20, rim: 0.05 }, { x: 36, z: -6, r: 19, rim: 0.05 },
    { x: 30, z: -66, r: 20 }, { x: -40, z: -70, r: 22 }, { x: 8, z: 50, r: 15 }
  ];
  const craters = [...hero, ...scatter_discs(rng, 20, 9, 24, 26)]
    .map((d) => ({ ...d, depth: d.r * lerp(0.26, 0.36, rng()), rim: d.rim ?? 0.8, rw: 0.2, flat: 0.4 }));


  const height = (x, z) => {
    const rolling = (fbm(x * 0.018, z * 0.018, 11, 4) - 0.5) * 4.0;
    const zone = smooth(0.4, 0.66, fbm(x * 0.011 + 40, z * 0.011 - 17, 23, 2)); // where the ridges live
    const ridge = Math.pow(ridged(x * 0.04, z * 0.04, 37, 4), 2) * 9.0 * zone;
    let h = rolling + ridge;
    for (const c of craters) h += crater_h(c, x, z);
    return h * smooth(7, 16, Math.hypot(x, z)); // spawn disc (7) stays flat; terrain is full strength by 16
  };

  const color = (x, z, h, slope, r) => {
    let c = mix(RUST, DUST, smooth(-1, 5, h));
    c = mix(c, DARK, smooth(0.05, 0.24, slope) * 0.9);                         // slopes darken: crater walls, ridges
    c = mix(c, DARK, smooth(0.62, 0.85, vnoise(x * 0.07, z * 0.07, 5)) * 0.5); // darker basalt patches
    c = mix(c, PIT, smooth(-0.4, -2.4, h) * 0.9);                              // crater floors
    return shade(c, 0.80 + 0.36 * r);
  };

  const props = (b, grid, cols) => {
    const prng = make_rng(77);
    // ROUND 4: more and bigger boulders (170, radius 0.9..3.6); collider uses the same x, z, r, squash as the mesh
    scatter(prng, 190, 11, PROP_RADIUS, () => true, grid).forEach(([x, z], i) => {
      const r = lerp(1.1, 4.2, Math.pow(prng(), 1.5));
      const squash = 0.55 + 0.35 * prng();
      const y = grid.sample(x, z);
      b.add_rock([x, y + r * squash * 0.15, z], r, squash, 100 + i, shade(BOULDER, 0.85 + 0.3 * prng()), 0.14);
      if (r > 1.0) cols.push({ x, z, r: r * 0.85, top: y + r * squash });
    });
  };

  return {
    height, color, props,
    light: { dir: [0.5, 0.62, 0.35], sun: [1.0, 0.82, 0.62], ambient: [0.42, 0.32, 0.28] }
  };
} // end function

// ------------------------------------------------------------
// EARTH: green rolling hills, darker valleys, a lake, pines and leafy trees
// ------------------------------------------------------------

const LAKE = { x: -28, z: -46, r: 17 }; // ahead of the player (who looks toward -z) and to the left
const WATER_Y = -1.0;

function add_water(b, cx, y, cz, r) {
  const rings = [0, 0.4, 0.72, 1.0], sides = 20;
  const cols = [[0.16, 0.44, 0.74], [0.21, 0.52, 0.82]];
  const below = [cx, y - 10, cz];
  const p = (k, a) => [cx + Math.cos(a) * rings[k] * r, y, cz + Math.sin(a) * rings[k] * r];
  for (let k = 0; k < rings.length - 1; k++) {
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
      const col = cols[(i + k) & 1];
      if (k === 0) {
        b.add_tri(p(0, 0), p(1, a0), p(1, a1), col, below);
      } else {
        b.add_tri(p(k, a0), p(k + 1, a0), p(k + 1, a1), col, below);
        b.add_tri(p(k, a0), p(k + 1, a1), p(k, a1), col, below);
      } // end if
    } // end loop
  } // end loop
} // end function

function earth_recipe() {
  const VALLEY = [0.10, 0.32, 0.12], GRASS = [0.26, 0.56, 0.18], HILL = [0.50, 0.70, 0.26];
  const ROCK = [0.45, 0.40, 0.33], SAND = [0.80, 0.74, 0.46];
  const TRUNK = [0.36, 0.23, 0.12], PINE = [0.10, 0.36, 0.16], LEAF = [0.22, 0.52, 0.16];

  const height = (x, z) => {
    let h = (fbm(x * 0.016 + 5, z * 0.016 - 9, 3, 4) - 0.38) * 16;
    if (h < 0) h *= 0.15; // valleys stay shallow so only the lake dips below the water line
    const d = Math.hypot(x - LAKE.x, z - LAKE.z);
    h = lerp(h, -2.4, smooth(LAKE.r, LAKE.r * 0.5, d));
    return h * clear(x, z);
  };

  const color = (x, z, h, slope, r) => {
    let c = mix(VALLEY, GRASS, smooth(-0.5, 2.5, h));
    c = mix(c, HILL, smooth(3, 6.5, h));
    c = mix(c, VALLEY, smooth(0.6, 0.85, vnoise(x * 0.06, z * 0.06, 8)) * 0.45); // dark forest-floor patches
    c = mix(c, ROCK, smooth(0.12, 0.30, slope));
    c = mix(c, SAND, smooth(-0.05, -0.8, h));                                      // shore
    return shade(c, 0.88 + 0.24 * r);
  };

  const add_pine = (b, x, y, z, s, k) => {
    b.add_cone([x, y - 0.1, z], 0.28 * s, 1.4 * s, 5, TRUNK, 0.2 * s);
    b.add_cone([x, y + 1.0 * s, z], 1.5 * s, 2.2 * s, 7, shade(PINE, 0.9 + 0.05 * (k % 4)));
    b.add_cone([x, y + 2.3 * s, z], 1.15 * s, 2.0 * s, 7, shade(PINE, 1.0 + 0.05 * (k % 3)));
    b.add_cone([x, y + 3.5 * s, z], 0.75 * s, 1.7 * s, 7, shade(PINE, 1.1));
  };
  const add_leafy = (b, x, y, z, s, k) => {
    b.add_cone([x, y - 0.1, z], 0.3 * s, 1.9 * s, 5, TRUNK, 0.22 * s);
    b.add_rock([x, y + 2.5 * s, z], 1.35 * s, 0.85, 500 + k, LEAF, 0.12);
  };

  const props = (b, grid, cols) => {
    const prng = make_rng(4242);
    add_water(b, LAKE.x, WATER_Y, LAKE.z, LAKE.r * 0.92);

    const tree_ok = (x, z, g) => {
      const h = g.sample(x, z);
      return h > 0.3 && gradient(g, x, z) < 0.4 && Math.hypot(x - LAKE.x, z - LAKE.z) > LAKE.r * 1.05
        && vnoise(x * 0.03, z * 0.03, 9) > 0.45; // trees come in clumps
    };
    scatter(prng, 80, 11, PROP_RADIUS, tree_ok, grid).forEach(([x, z], i) => {
      const s = lerp(0.8, 1.6, prng());
      const y = grid.sample(x, z);
      if (prng() < 0.6) add_pine(b, x, y, z, s, i); else add_leafy(b, x, y, z, s, i);
      cols.push({ x, z, r: 0.5 * s, top: 1e9 });
    });

    scatter(prng, 26, 10, PROP_RADIUS, (x, z, g) => Math.hypot(x - LAKE.x, z - LAKE.z) > LAKE.r * 1.05, grid).forEach(([x, z], i) => {
      const r = lerp(0.5, 1.5, prng());
      const squash = 0.6 + 0.3 * prng();
      const y = grid.sample(x, z);
      b.add_rock([x, y + r * squash * 0.15, z], r, squash, 900 + i, shade(ROCK, 0.9 + 0.2 * prng()), 0.12);
      if (r > 0.9) cols.push({ x, z, r: r * 0.85, top: y + r * squash });
    });
  };

  return {
    height, color, props,
    light: { dir: [0.45, 0.7, 0.3], sun: [1.0, 0.97, 0.88], ambient: [0.36, 0.40, 0.48] }
  };
} // end function

// ------------------------------------------------------------
// MERCURY: grey, heavily cratered
// ------------------------------------------------------------

function mercury_recipe() {
  const LOW = [0.30, 0.30, 0.32], MID = [0.50, 0.49, 0.47], HIGH = [0.70, 0.68, 0.64], ROCK = [0.42, 0.41, 0.40];
  const rng = make_rng(808);
  // ROUND 4: clearly cratered. Bowls need >= ~9 units radius to resolve on the 3.3 unit grid, so the old
  // 130 craters of radius 3..16 melted into rolling ground. Now: overlapping hand placed craters in the
  // forward view, big random ones, and smaller ones, all with flat floors, steep walls and tall rims.
  const hero = [
    // wide low-rim craters whose near edge starts ~14 out: from the spawn you look over the lip into the bowl
    { x: 0, z: -36, r: 22, rim: 0.04 }, { x: -37, z: -6, r: 22, rim: 0.04 }, { x: 36, z: -4, r: 20, rim: 0.04 },
    { x: 34, z: -78, r: 22 }, { x: -42, z: -86, r: 24 },
    { x: 36, z: -30, r: 11 }, { x: -38, z: -22, r: 11 }, { x: 8, z: 50, r: 15 }, { x: -48, z: 34, r: 14 }
  ];
  const craters = [...hero, ...scatter_discs(rng, 22, 9, 26, 26, 135), ...scatter_discs(rng, 18, 6, 9, 26, 120)]
    .map((d) => ({ ...d, depth: d.r * lerp(0.3, 0.38, rng()), rim: d.rim ?? 0.95, rw: 0.2, flat: 0.5 }));

  const height = (x, z) => {
    let h = (fbm(x * 0.03, z * 0.03, 61, 3) - 0.5) * 0.8; // calm floors between the craters
    for (const c of craters) h += crater_h(c, x, z);
    return h * smooth(7, 14, Math.hypot(x, z)); // shorter spawn ramp than clear(): spawn disc (7) stays flat
  };

  const color = (x, z, h, slope, r) => {
    let c = mix(LOW, MID, smooth(-6, -0.5, h));     // dark crater floors
    c = mix(c, HIGH, smooth(0.5, 3.5, h));          // bright raised rims
    c = mix(c, LOW, smooth(0.12, 0.35, slope) * 0.5); // crater walls darken
    return shade(c, 0.78 + 0.44 * r); // wide jitter: rugged, sun baked
  };

  const props = (b, grid, cols) => {
    const prng = make_rng(31);
    scatter(prng, 40, 10, PROP_RADIUS, () => true, grid).forEach(([x, z], i) => { // ROUND 4: 60 -> 40, craters lead
      const r = lerp(0.3, 1.5, Math.pow(prng(), 2));
      const squash = 0.5 + 0.4 * prng();
      const y = grid.sample(x, z);
      b.add_rock([x, y + r * squash * 0.15, z], r, squash, 300 + i, shade(ROCK, 0.8 + 0.4 * prng()), 0.16);
      if (r > 0.9) cols.push({ x, z, r: r * 0.85, top: y + r * squash });
    });
  };

  return {
    height, color, props,
    light: { dir: [0.75, 0.35, 0.3], sun: [1.2, 1.15, 1.1], ambient: [0.10, 0.10, 0.12] } // no air: hard light, deep shadow
  };
} // end function

// ------------------------------------------------------------
// VENUS: volcanic cones with calderas, glowing lava seams and pools
// ------------------------------------------------------------

function venus_recipe() {
  const BASALT = [0.28, 0.16, 0.10], ORANGE = [0.58, 0.28, 0.10], SULFUR = [0.80, 0.64, 0.20], ASH = [0.15, 0.09, 0.07];
  const lava = (r) => [1.7 + 0.5 * r, 0.55 + 0.35 * r, 0.06]; // channel > 1: shader draws it self lit
  const rng = make_rng(2024);
  const cones = scatter_discs(rng, 7, 12, 24, 34, 120).map((d) => ({ ...d, height: lerp(4, 8, rng()) }));

  const pool_noise = (x, z) => fbm(x * 0.028 + 200, z * 0.028 - 80, 41, 3);
  const crack_noise = (x, z) => Math.abs(fbm(x * 0.05 + 80, z * 0.05 + 33, 51, 3) - 0.5);

  const height = (x, z) => {
    let h = (fbm(x * 0.02, z * 0.02, 7, 4) - 0.5) * 3.2;
    for (const c of cones) {
      const d = Math.hypot(x - c.x, z - c.z);
      if (d < c.r) {
        h += c.height * Math.pow(1 - d / c.r, 1.35);
        if (d < c.r * 0.16) h -= c.height * 0.35 * (1 - d / (c.r * 0.16)); // caldera
      } // end if
    } // end loop
    h -= smooth(0.30, 0.22, pool_noise(x, z)) * 1.4; // lava pools sit in shallow bowls
    return h * clear(x, z);
  };

  const color = (x, z, h, slope, r) => {
    const far = Math.hypot(x, z) > 16;
    if (far && (pool_noise(x, z) < 0.26 || crack_noise(x, z) < 0.02)) return lava(r);
    let c = mix(BASALT, ORANGE, smooth(0, 3, h));
    c = mix(c, SULFUR, smooth(4.5, 8, h));
    c = mix(c, ASH, smooth(0.15, 0.40, slope));
    return shade(c, 0.82 + 0.36 * r);
  };

  const props = (b, grid, cols) => {
    const prng = make_rng(555);
    scatter(prng, 45, 10, PROP_RADIUS, () => true, grid).forEach(([x, z], i) => {
      const r = lerp(0.4, 1.8, Math.pow(prng(), 2));
      const squash = 0.6 + 0.4 * prng();
      const y = grid.sample(x, z);
      b.add_rock([x, y + r * squash * 0.15, z], r, squash, 700 + i, shade(ASH, 0.8 + 0.5 * prng()), 0.2);
      if (r > 1.0) cols.push({ x, z, r: r * 0.85, top: y + r * squash });
    });
    // small vents: a dark spire with a glowing tip
    scatter(prng, 18, 12, PROP_RADIUS, () => true, grid).forEach(([x, z], i) => {
      const s = lerp(0.8, 1.8, prng());
      const y = grid.sample(x, z);
      b.add_cone([x, y - 0.1, z], 1.2 * s, 2.6 * s, 6, BASALT);
      b.add_cone([x, y + 2.5 * s, z], 0.5 * s, 0.7 * s, 6, lava(prng()));
      cols.push({ x, z, r: 1.0 * s, top: y + 2.6 * s });
    });
  };

  return {
    height, color, props,
    light: { dir: [0.3, 0.8, 0.3], sun: [0.9, 0.7, 0.42], ambient: [0.50, 0.34, 0.20] }
  };
} // end function

// ------------------------------------------------------------
// GAS / ICE GIANTS: a floating cloud deck of banded, rolling swells, with puffs and far storm towers.
// the player stands on the landing platform well above it; the deck breathes slowly (shader swell).
// ------------------------------------------------------------

function deck_recipe(o) {
  const n = o.palette.length;
  const warp = (x, z) => fbm(x * 0.012 + o.seed, z * 0.012 - o.seed, o.seed + 3, 3) - 0.5;

  const band_color = (x, z) => {
    const u0 = z * o.band_scale + warp(x, z) * o.wobble;
    const u = ((u0 % n) + n) % n;
    const i = Math.floor(u), f = u - i;
    return mix(o.palette[i], o.palette[(i + 1) % n], smooth(0.25, 0.75, f));
  };

  const height = (x, z) => {
    let h = Math.sin(z * 0.045 + warp(x, z) * 6) * 0.9 + (fbm(x * 0.02 + 90, z * 0.03, o.seed + 9, 3) - 0.5) * 3.2;
    if (o.spot) h += 1.4 * smooth(o.spot.r, o.spot.r * 0.3, Math.hypot(x - o.spot.x, z - o.spot.z));
    return h;
  };

  const color = (x, z, h, slope, r) => {
    let c = band_color(x, z);
    if (o.spot) {
      const dx = x - o.spot.x, dz = z - o.spot.z, d = Math.hypot(dx, dz);
      if (d < o.spot.r) {
        const swirl = 0.5 + 0.5 * Math.sin(Math.atan2(dz, dx) * 2 + d * 0.35);
        c = mix(c, mix(o.spot.colors[0], o.spot.colors[1], swirl), smooth(o.spot.r, o.spot.r * 0.7, d));
      } // end if
    } // end if
    c = mix(c, [1, 1, 1], smooth(1.0, 3.0, h) * 0.3); // crests catch the light
    return shade(c, 0.93 + 0.14 * r);
  };

  const props = (b, grid) => {
    const prng = make_rng(o.seed * 5 + 1);
    scatter(prng, 70, 14, PROP_RADIUS, () => true, grid).forEach(([x, z], i) => {
      const r = lerp(2.5, 7, Math.pow(prng(), 1.5));
      b.add_rock([x, grid.sample(x, z) + r * 0.1, z], r, 0.32 + 0.1 * prng(), o.seed * 100 + i,
        mix(band_color(x, z), o.puff, 0.6), 0.06);
    });
    scatter(prng, 14, 55, PROP_RADIUS, () => true, grid).forEach(([x, z], i) => { // far storm towers
      const r = lerp(5, 8, prng());
      b.add_rock([x, grid.sample(x, z) + r * 0.3, z], r, 0.8 + 0.3 * prng(), o.seed * 200 + i,
        mix(band_color(x, z), o.puff, 0.75), 0.07);
    });
  };

  return { deck: true, height, color, props, light: o.light, swell: { amp: 0.35, speed: 0.35 } };
} // end function

const JUPITER = () => deck_recipe({
  seed: 31,
  palette: [[0.92, 0.84, 0.68], [0.80, 0.62, 0.42], [0.66, 0.42, 0.28], [0.95, 0.90, 0.82], [0.55, 0.36, 0.26], [0.88, 0.76, 0.58]],
  band_scale: 0.045, wobble: 3.0, puff: [0.97, 0.93, 0.86],
  spot: { x: 45, z: -70, r: 20, colors: [[0.70, 0.25, 0.14], [0.90, 0.55, 0.36]] }, // the great red storm
  light: { dir: [0.3, 0.85, 0.2], sun: [0.72, 0.62, 0.5], ambient: [0.50, 0.42, 0.36] }
});

const SATURN = () => deck_recipe({
  seed: 47,
  palette: [[0.93, 0.84, 0.55], [0.85, 0.73, 0.45], [0.96, 0.90, 0.70], [0.78, 0.65, 0.40]],
  band_scale: 0.035, wobble: 2.2, puff: [0.98, 0.95, 0.82], spot: null,
  light: { dir: [0.3, 0.85, 0.2], sun: [0.72, 0.66, 0.5], ambient: [0.50, 0.46, 0.38] }
});

const URANUS = () => deck_recipe({
  seed: 59,
  palette: [[0.62, 0.88, 0.90], [0.50, 0.82, 0.88], [0.72, 0.93, 0.94], [0.45, 0.76, 0.85]],
  band_scale: 0.025, wobble: 1.6, puff: [0.90, 0.98, 1.0], spot: null,
  light: { dir: [0.3, 0.85, 0.2], sun: [0.62, 0.72, 0.74], ambient: [0.46, 0.56, 0.58] }
});

const NEPTUNE = () => deck_recipe({
  seed: 73,
  palette: [[0.12, 0.28, 0.75], [0.18, 0.40, 0.88], [0.08, 0.20, 0.60], [0.30, 0.50, 0.95], [0.10, 0.24, 0.68]],
  band_scale: 0.04, wobble: 2.6, puff: [0.90, 0.95, 1.0],
  spot: { x: -50, z: -62, r: 18, colors: [[0.03, 0.08, 0.32], [0.10, 0.20, 0.55]] }, // dark storm
  light: { dir: [0.3, 0.85, 0.2], sun: [0.56, 0.66, 0.90], ambient: [0.30, 0.38, 0.56] }
});

const RECIPES = {
  mars: mars_recipe, earth: earth_recipe, mercury: mercury_recipe, venus: venus_recipe,
  jupiter: JUPITER, saturn: SATURN, uranus: URANUS, neptune: NEPTUNE
};

/** which planets have a terrain recipe (lowercase names). */
export const TERRAIN_KEYS = Object.keys(RECIPES);

/**
 * build the terrain for a planet by name ("mars", any case). throws for an unknown planet.
 * building takes a few milliseconds to ~0.1 s; the scene caches the result per planet.
 */
export function build_terrain(name) {
  const key = String(name).trim().toLowerCase();
  const make = RECIPES[key];
  if (!make) throw new Error("build_terrain: no terrain recipe for " + name);
  const r = make();

  const grid = make_height_grid(TERRAIN_SIZE, TERRAIN_SEGMENTS, r.height);
  const terrain = gen_terrain_mesh(TERRAIN_SIZE, TERRAIN_SEGMENTS, grid, r.color);

  const builder = new FacetedBuilder();
  const colliders = [];
  r.props(builder, grid, colliders);
  if (builder.triangle_count === 0) builder.add_tri([0, -1000, 0], [1, -1000, 0], [0, -1000, 1], [0, 0, 0]); // keep the node drawable
  const props = builder.build();

  let min_height = Infinity, max_height = -Infinity, walk_max_height = -Infinity;
  const { half, step, stride, data } = grid;
  for (let iz = 0; iz < stride; iz++) {
    for (let ix = 0; ix < stride; ix++) {
      const h = data[iz * stride + ix];
      if (h < min_height) min_height = h;
      if (h > max_height) max_height = h;
      if (Math.hypot(-half + ix * step, -half + iz * step) <= WALK_RADIUS + 4 && h > walk_max_height) walk_max_height = h;
    } // end loop
  } // end loop

  return {
    key, grid, terrain, props, colliders, light: r.light, swell: r.swell || null,
    min_height, max_height, walk_max_height, deck: !!r.deck
  };
} // end function
