// TRANSITION PREVIEW: this whole file is new.
//
// What the bird scene looks like when you land on each planet. This is a fictional
// system, so the skies are stylized guesses at each world's atmosphere, not real science.
//
// Fields (all colors are [r, g, b] in 0..1):
//   name          matches PlanetData.name in outer_world/planet_scene_node.js
//   zenith        sky color straight up
//   horizon       sky color at the horizon; also the fog color of the ground
//   haze          sky gradient curve: > 1 keeps the horizon color high (thick atmosphere),
//                 < 1 shifts to the zenith color quickly (thin, clear air)
//   fade          screen fade color used for the landing and the return trip
//   ground_tint   multiplied with the planet texture
//   texture_path  the planet's existing texture (same file the space scene uses)
//   surface       "solid" = standing on the ground, "cloud_deck" = banded cloud sea far
//                 below (gas / ice giants have no surface)
//   ground_depth  how far below the camera the ground / deck sits (world units)
//   fog           [start, end] view depth where the ground begins to / has fully faded into the horizon
//   tile          texture repeats per world unit across the ground, [x, z]

const TEX = "./outer_world/textures/";

const SOLID_TILE = [0.04, 0.04];
const DECK_TILE = [0.002, 0.012]; // wide in x, so the planet's bands read as long stripes receding in depth

export const PLANET_PROFILES = {
  mercury: {
    name: "Mercury",
    zenith: [0.0, 0.0, 0.0], horizon: [0.03, 0.03, 0.04], haze: 1.0,
    fade: [0.03, 0.03, 0.04],
    ground_tint: [0.85, 0.82, 0.78], texture_path: TEX + "mercury.jpg",
    surface: "solid", ground_depth: 3, fog: [30, 90], tile: SOLID_TILE
  },
  venus: {
    name: "Venus",
    zenith: [0.72, 0.5, 0.18], horizon: [0.94, 0.8, 0.42], haze: 2.2,
    fade: [0.94, 0.8, 0.42],
    ground_tint: [0.95, 0.62, 0.32], texture_path: TEX + "venus.jpg",
    surface: "solid", ground_depth: 3, fog: [6, 60], tile: SOLID_TILE
  },
  earth: {
    name: "Earth",
    zenith: [0.16, 0.4, 0.85], horizon: [0.72, 0.86, 0.96], haze: 0.7,
    fade: [0.53, 0.81, 0.92],
    ground_tint: [0.95, 1.0, 0.95], texture_path: TEX + "earth.jpg",
    surface: "solid", ground_depth: 3, fog: [30, 90], tile: SOLID_TILE
  },
  mars: {
    name: "Mars",
    zenith: [0.55, 0.36, 0.26], horizon: [0.88, 0.64, 0.4], haze: 1.3,
    fade: [0.88, 0.64, 0.4],
    ground_tint: [1.0, 0.82, 0.66], texture_path: TEX + "mars.jpg",
    surface: "solid", ground_depth: 3, fog: [20, 85], tile: SOLID_TILE
  },
  jupiter: {
    name: "Jupiter",
    zenith: [0.26, 0.18, 0.14], horizon: [0.88, 0.74, 0.55], haze: 1.2,
    fade: [0.88, 0.74, 0.55],
    ground_tint: [1.0, 0.9, 0.78], texture_path: TEX + "jupiter.jpg",
    surface: "cloud_deck", ground_depth: 14, fog: [25, 90], tile: DECK_TILE
  },
  saturn: {
    name: "Saturn",
    zenith: [0.42, 0.34, 0.22], horizon: [0.93, 0.85, 0.6], haze: 1.2,
    fade: [0.93, 0.85, 0.6],
    ground_tint: [1.0, 0.95, 0.8], texture_path: TEX + "saturn.jpg",
    surface: "cloud_deck", ground_depth: 14, fog: [25, 90], tile: DECK_TILE
  },
  uranus: {
    name: "Uranus",
    zenith: [0.1, 0.33, 0.44], horizon: [0.6, 0.86, 0.9], haze: 0.9,
    fade: [0.6, 0.86, 0.9],
    ground_tint: [0.85, 1.0, 1.0], texture_path: TEX + "uranus.jpg",
    surface: "cloud_deck", ground_depth: 14, fog: [25, 90], tile: DECK_TILE
  },
  neptune: {
    name: "Neptune",
    zenith: [0.02, 0.04, 0.22], horizon: [0.14, 0.34, 0.8], haze: 0.9,
    fade: [0.14, 0.34, 0.8],
    ground_tint: [0.7, 0.85, 1.2], texture_path: TEX + "neptune.jpg",
    surface: "cloud_deck", ground_depth: 14, fog: [25, 90], tile: DECK_TILE
  }
};

/**
 * look a profile up by planet name, case-insensitive ("Mars", "mars", " MARS ").
 * returns null when the name is not one of the eight.
 */
export function get_planet_profile(name) {
  if (typeof name !== "string") return null;
  return PLANET_PROFILES[name.trim().toLowerCase()] || null;
} // end function
