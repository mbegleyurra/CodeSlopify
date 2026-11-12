// Planet-themed alien birds. One entry per planet, keyed by lower-case planet name.
// bird_flock.js reads a theme and builds each bird from it; nothing here touches GL.
//
// MODEL FRAME (same as bird_flock.js): +x = bird's right, +y = nose, +z = up. The root node is a
// radius-0.5 chest sphere at the origin; every "part" below is a child of the model pivot.
//
// theme fields
//   scale        uniform scale of the whole bird (root node)
//   hit_radius   world-space radius of the hit sphere (already includes scale)
//   body_center  local y of the middle of the bird (multiplied by scale for the hit sphere centre)
//   ambient      ka = colour * ambient. High values make a bird look self-lit (glowing)
//   specular, shininess   material shine (metal = high)
//   palettes     [{ w: weight, c: [body, head, beak, wing, tail, accent] }]
//   parts        non-wing parts: P(mesh, colour slot, pos, scl, rot, mirror)
//   wings        flapping pairs: W(mesh, colour slot, shoulder, scl, amp, blade)
//
// mesh is "sphere" | "cone" | "pyramid" | "cube". Sizes: sphere radius 0.5, cone tip at +y 1 tall,
// pyramid apex at +y 1 tall and base [-1, 1] (so its scl x / z are HALF widths), cube [-1, 1].
// mirror:true also adds the x-mirrored copy. A wing with blade:true points along the wing axis
// (cone / pyramid wings); otherwise it is a flat panel. amp scales the flap angle of that pair.

const PI = Math.PI;

const P = (mesh, mat, pos, scl, rot = [0, 0, 0], mirror = false) => ({ mesh, mat, pos, scl, rot, mirror });
const W = (mesh, mat, shoulder, scl, amp = 1, blade = false) => ({ mesh, mat, shoulder, scl, amp, blade });

/** n small parts around a circle in the model's xy (horizontal) plane, rolled by `tilt` about the nose axis. */
function ring(n, radius, center, size, tilt, mat) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * PI * 2;
    const x = Math.cos(a) * radius, y = Math.sin(a) * radius;
    out.push(P("sphere", mat, [center[0] + x * Math.cos(tilt), center[1] + y, center[2] - x * Math.sin(tilt)], size));
  } // end loop
  return out;
} // end function

export const BIRD_THEMES = {
  // ordinary ducks, unchanged from the earlier round
  earth: {
    scale: 0.9, hit_radius: 1.0, body_center: -0.2, ambient: 0.45, specular: 0.1, shininess: 8,
    palettes: [
      { w: 0.55, c: [[0.45, 0.32, 0.18], [0.10, 0.45, 0.20], [0.95, 0.60, 0.10], [0.30, 0.22, 0.12], [0.20, 0.15, 0.10], [0.95, 0.60, 0.10]] },
      { w: 0.25, c: [[0.80, 0.80, 0.78], [0.25, 0.30, 0.40], [0.95, 0.50, 0.10], [0.55, 0.55, 0.55], [0.35, 0.35, 0.35], [0.95, 0.50, 0.10]] },
      { w: 0.20, c: [[0.20, 0.20, 0.25], [0.15, 0.20, 0.40], [0.90, 0.80, 0.15], [0.12, 0.12, 0.16], [0.10, 0.10, 0.12], [0.90, 0.80, 0.15]] },
    ],
    parts: [
      P("sphere", "body", [0, -0.5, 0.02], [0.85, 1.0, 0.8]),
      P("sphere", "head", [0, 0.55, 0.18], [0.5, 0.5, 0.5]),
      P("cone", "beak", [0, 0.72, 0.16], [0.2, 0.4, 0.12]),
      P("pyramid", "tail", [0, -0.85, 0.05], [0.28, 0.5, 0.08], [PI, 0, 0]),
    ],
    wings: [W("cube", "wing", [0.3, 0.05, 0.12], [0.5, 0.22, 0.03])],
  },

  // scorched, metallic, angular: boxes and blades, glowing orange beak
  mercury: {
    scale: 0.9, hit_radius: 0.95, body_center: -0.25, ambient: 0.4, specular: 0.9, shininess: 64,
    palettes: [
      { w: 0.6, c: [[0.5, 0.5, 0.55], [0.3, 0.28, 0.3], [1.0, 0.5, 0.1], [0.38, 0.38, 0.42], [0.2, 0.17, 0.15], [0.9, 0.4, 0.1]] },
      { w: 0.4, c: [[0.35, 0.3, 0.28], [0.2, 0.18, 0.18], [0.8, 0.7, 0.5], [0.28, 0.25, 0.25], [0.12, 0.1, 0.1], [1.0, 0.3, 0.05]] },
    ],
    parts: [
      P("cube", "body", [0, -0.45, 0.02], [0.3, 0.55, 0.26], [0.0, 0, 0]),
      P("cube", "head", [0, 0.55, 0.2], [0.2, 0.22, 0.18], [0.5, 0, 0]),
      P("pyramid", "beak", [0, 0.72, 0.2], [0.14, 0.55, 0.1]),
      P("pyramid", "tail", [0.1, -0.95, 0.05], [0.12, 0.65, 0.04], [PI, 0, 0.25], true),
      P("pyramid", "accent", [0, -0.1, 0.4], [0.05, 0.4, 0.3], [PI / 2, 0, 0]),   // scorched dorsal ridge
    ],
    wings: [W("pyramid", "wing", [0.28, 0.05, 0.14], [0.22, 1.1, 0.03], 1, true)],
  },

  // sulphur-yellow, self-lit, long streaming tails
  venus: {
    scale: 0.9, hit_radius: 1.1, body_center: -0.35, ambient: 0.95, specular: 0.3, shininess: 20,
    palettes: [
      { w: 0.6, c: [[0.95, 0.85, 0.2], [1.0, 0.75, 0.15], [1.0, 0.45, 0.1], [1.0, 0.95, 0.45], [1.0, 0.65, 0.1], [1.0, 1.0, 0.7]] },
      { w: 0.4, c: [[0.9, 0.7, 0.15], [0.95, 0.9, 0.4], [0.9, 0.3, 0.1], [0.95, 0.8, 0.3], [0.95, 0.5, 0.1], [1.0, 0.95, 0.6]] },
    ],
    parts: [
      P("sphere", "body", [0, -0.55, 0.02], [0.7, 1.3, 0.7]),
      P("sphere", "head", [0, 0.55, 0.18], [0.46, 0.5, 0.46]),
      P("cone", "beak", [0, 0.7, 0.16], [0.14, 0.45, 0.1]),
      P("pyramid", "tail", [0, -1.1, 0.05], [0.11, 1.3, 0.025], [PI, 0, 0]),
      P("pyramid", "tail", [0.1, -1.0, 0.05], [0.07, 1.5, 0.02], [PI, 0, 0.12], true),   // two side streamers
      P("cone", "accent", [0, 0.48, 0.4], [0.1, 0.5, 0.1], [PI / 2 + 0.7, 0, 0]),         // swept head plume
    ],
    wings: [W("cube", "wing", [0.28, 0.0, 0.1], [0.55, 0.3, 0.025])],
  },

  // rust-red, spiky, bone crest and horns, hooked bone beak, blade wings
  mars: {
    scale: 0.95, hit_radius: 1.05, body_center: -0.2, ambient: 0.45, specular: 0.15, shininess: 10,
    palettes: [
      { w: 0.6, c: [[0.6, 0.24, 0.12], [0.72, 0.3, 0.14], [0.9, 0.85, 0.7], [0.42, 0.15, 0.08], [0.5, 0.2, 0.1], [0.9, 0.85, 0.7]] },
      { w: 0.4, c: [[0.75, 0.4, 0.2], [0.55, 0.2, 0.1], [0.85, 0.8, 0.65], [0.5, 0.22, 0.1], [0.4, 0.15, 0.08], [0.85, 0.8, 0.65]] },
    ],
    parts: [
      P("sphere", "body", [0, -0.5, 0.02], [0.8, 1.05, 0.75]),
      P("sphere", "head", [0, 0.55, 0.18], [0.46, 0.55, 0.46]),
      P("cone", "accent", [0, 0.76, 0.14], [0.16, 0.5, 0.12], [-0.25, 0, 0]),              // hooked bone beak
      P("cone", "accent", [0, 0.5, 0.38], [0.12, 0.45, 0.12], [PI / 2 + 0.5, 0, 0]),       // head crest
      P("cone", "accent", [0, 0.1, 0.44], [0.14, 0.5, 0.14], [PI / 2 + 0.4, 0, 0]),        // back spines
      P("cone", "accent", [0, -0.3, 0.45], [0.14, 0.5, 0.14], [PI / 2 + 0.55, 0, 0]),
      P("cone", "accent", [0, -0.7, 0.4], [0.12, 0.45, 0.12], [PI / 2 + 0.7, 0, 0]),
      P("cone", "accent", [0.18, 0.5, 0.2], [0.07, 0.35, 0.07], [0, 0, -PI / 2], true),    // cheek horns
      P("cone", "tail", [0, -0.9, 0.05], [0.12, 0.8, 0.06], [PI, 0, 0]),                   // spiked tail fan
      P("cone", "tail", [0.08, -0.88, 0.05], [0.1, 0.7, 0.05], [PI, 0, 0.4], true),
    ],
    wings: [W("cone", "wing", [0.3, 0.05, 0.14], [0.5, 1.05, 0.06], 1, true)],
  },

  // huge, banded, puffy gas-sac bodies, stubby wings
  jupiter: {
    scale: 1.25, hit_radius: 1.4, body_center: -0.35, ambient: 0.5, specular: 0.1, shininess: 8,
    palettes: [
      { w: 0.6, c: [[0.92, 0.8, 0.58], [0.8, 0.55, 0.35], [0.35, 0.22, 0.12], [0.7, 0.45, 0.28], [0.6, 0.35, 0.2], [0.7, 0.3, 0.15]] },
      { w: 0.4, c: [[0.85, 0.65, 0.45], [0.9, 0.85, 0.7], [0.4, 0.2, 0.1], [0.55, 0.3, 0.2], [0.5, 0.3, 0.2], [0.95, 0.9, 0.8]] },
    ],
    parts: [
      P("sphere", "body", [0, -0.5, 0.0], [1.5, 1.5, 1.3]),
      P("sphere", "accent", [0, -0.2, 0.0], [1.56, 0.3, 1.36]),      // cloud bands
      P("sphere", "wing", [0, -0.5, 0.0], [1.58, 0.3, 1.38]),
      P("sphere", "accent", [0, -0.8, 0.0], [1.56, 0.3, 1.36]),
      P("sphere", "body", [0.45, -0.45, -0.35], [0.7, 0.7, 0.7], [0, 0, 0], true),   // gas sacs under the belly
      P("sphere", "accent", [0, -0.5, 0.6], [0.6, 0.7, 0.5]),                         // top bladder
      P("sphere", "head", [0, 0.6, 0.22], [0.55, 0.55, 0.55]),
      P("cone", "beak", [0, 0.8, 0.2], [0.22, 0.35, 0.14]),
      P("pyramid", "tail", [0, -1.2, 0.05], [0.4, 0.45, 0.1], [PI, 0, 0]),
    ],
    wings: [W("cube", "wing", [0.55, 0.1, 0.15], [0.5, 0.25, 0.04])],
  },

  // ring halo around the body, a small halo above the head, dorsal fin
  saturn: {
    scale: 0.9, hit_radius: 1.1, body_center: -0.2, ambient: 0.5, specular: 0.2, shininess: 16,
    palettes: [
      { w: 0.6, c: [[0.9, 0.78, 0.45], [0.95, 0.88, 0.6], [0.5, 0.35, 0.2], [0.75, 0.65, 0.4], [0.6, 0.5, 0.3], [0.95, 0.9, 0.7]] },
      { w: 0.4, c: [[0.8, 0.72, 0.55], [0.65, 0.55, 0.4], [0.9, 0.7, 0.2], [0.6, 0.5, 0.35], [0.45, 0.38, 0.28], [0.75, 0.6, 0.4]] },
    ],
    parts: [
      P("sphere", "body", [0, -0.5, 0.02], [0.85, 1.0, 0.8]),
      P("sphere", "head", [0, 0.55, 0.18], [0.5, 0.5, 0.5]),
      P("cone", "beak", [0, 0.72, 0.16], [0.2, 0.4, 0.12]),
      P("pyramid", "tail", [0, -0.85, 0.05], [0.28, 0.5, 0.08], [PI, 0, 0]),
      P("pyramid", "accent", [0, -0.3, 0.35], [0.04, 0.4, 0.3], [PI / 2, 0, 0]),       // dorsal fin
      ...ring(14, 0.9, [0, -0.2, 0.1], [0.42, 0.42, 0.12], 0.35, "accent"),             // tilted body ring
      ...ring(8, 0.22, [0, 0.55, 0.52], [0.13, 0.13, 0.05], 0, "accent"),               // head halo
    ],
    wings: [W("cube", "wing", [0.3, 0.05, 0.12], [0.5, 0.22, 0.03])],
  },

  // pale icy cyan, second wing pair
  uranus: {
    scale: 0.9, hit_radius: 1.15, body_center: -0.1, ambient: 0.65, specular: 0.4, shininess: 30,
    palettes: [
      { w: 0.6, c: [[0.65, 0.92, 0.95], [0.5, 0.85, 0.9], [0.95, 0.95, 0.7], [0.55, 0.85, 0.92], [0.4, 0.72, 0.85], [0.85, 1.0, 1.0]] },
      { w: 0.4, c: [[0.75, 0.97, 0.98], [0.35, 0.7, 0.8], [0.8, 0.95, 0.5], [0.7, 0.95, 0.97], [0.5, 0.8, 0.9], [0.95, 1.0, 1.0]] },
    ],
    parts: [
      P("sphere", "body", [0, -0.5, 0.02], [0.8, 1.0, 0.75]),
      P("sphere", "head", [0, 0.55, 0.18], [0.5, 0.5, 0.5]),
      P("cone", "beak", [0, 0.72, 0.16], [0.18, 0.35, 0.1]),
      P("pyramid", "tail", [0, -0.85, 0.05], [0.15, 0.55, 0.03], [PI, 0, 0]),
      P("pyramid", "tail", [0.1, -0.9, 0.05], [0.1, 0.7, 0.03], [PI, 0, 0.25], true),
    ],
    wings: [
      W("cube", "wing", [0.3, 0.3, 0.12], [0.5, 0.2, 0.03], 1),
      W("cube", "wing", [0.28, -0.35, 0.1], [0.45, 0.2, 0.03], 0.85),   // the extra pair
    ],
  },

  // deep blue, big fins, dorsal fin, glowing cyan tendrils under the head
  neptune: {
    scale: 0.9, hit_radius: 1.05, body_center: -0.25, ambient: 0.55, specular: 0.4, shininess: 30,
    palettes: [
      { w: 0.6, c: [[0.08, 0.18, 0.6], [0.05, 0.3, 0.78], [0.3, 0.95, 0.95], [0.1, 0.25, 0.7], [0.05, 0.15, 0.5], [0.3, 0.85, 0.95]] },
      { w: 0.4, c: [[0.04, 0.08, 0.3], [0.1, 0.25, 0.5], [0.5, 0.9, 1.0], [0.06, 0.14, 0.45], [0.03, 0.1, 0.35], [0.45, 0.7, 1.0]] },
    ],
    parts: [
      P("sphere", "body", [0, -0.5, 0.02], [0.8, 1.1, 0.7]),
      P("sphere", "head", [0, 0.55, 0.15], [0.5, 0.55, 0.45]),
      P("cone", "beak", [0, 0.74, 0.14], [0.16, 0.35, 0.1]),
      P("pyramid", "tail", [0, -0.9, 0.05], [0.45, 0.6, 0.04], [PI, 0, 0]),             // wide tail fin
      P("pyramid", "accent", [0, -0.2, 0.3], [0.04, 0.55, 0.3], [PI / 2, 0, 0]),        // dorsal fin
      P("cone", "accent", [0.1, 0.45, -0.1], [0.06, 0.9, 0.06], [PI + 0.45, 0, 0.3], true),   // tendrils
      P("cone", "accent", [0.05, 0.3, -0.2], [0.05, 0.7, 0.05], [PI + 0.6, 0, 0.1], true),
    ],
    wings: [W("cube", "wing", [0.3, 0.0, 0.05], [0.55, 0.28, 0.02])],
  },
};

const cache = {};

/** the theme for a planet name (any case); unknown names get Earth's ducks. */
export function get_bird_theme(name) {
  const key = typeof name === "string" ? name.trim().toLowerCase() : "earth";
  const theme_key = BIRD_THEMES[key] ? key : "earth";
  if (!cache[theme_key]) cache[theme_key] = { key: theme_key, ...BIRD_THEMES[theme_key] };
  return cache[theme_key];
} // end function
