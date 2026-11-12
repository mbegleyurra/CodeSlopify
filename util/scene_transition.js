// TRANSITION PREVIEW: this whole file is new.
//
// Space -> planet landing, and planet -> space return.
//
//   space --(E near a planet)--> flying --> fade_out --> [swap scene] --> fade_in --> landed
//   (SHIP PREVIEW: in "space" the player flies a Spaceship; E lands on the nearest planet in range.
//    earth.on_enter?.() runs after landing, earth.on_exit?.() when Q starts the return.)
//   landed --(Q)--------------------> fade_out --> [swap scene] --> fade_in --> space
//
// WHICH planet: TARGET_PLANET below, or ?planet=<name> in the URL (any of the 8, any case).
// The chase camera, stop distance, fade color, hint text and the landing backdrop all follow it.
//
// The fade is a plain DOM <div> laid over the canvas, so no shader or renderer changes
// are needed for it. The fly-in uses Camera.set_look_at() (see scene_graph.js).

import { get_planet_profile } from "../planetary_duck_hunt/planet_profiles.js";
import { Spaceship } from "../outer_world/spaceship.js"; // SHIP PREVIEW

const TARGET_PLANET = "Mars"; // default landing planet; ?planet=venus etc. overrides it
const FLY_SECONDS = 2.8;      // camera flight toward the planet
const FADE_SECONDS = 0.5;     // total fade; half to full color, half back out

const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const ease_in_out_cubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const css_color = (c) => `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`;

/**
 * ?planet= wins over TARGET_PLANET. an unknown name warns and falls back to TARGET_PLANET.
 */
function resolve_initial_profile() {
  const asked = new URLSearchParams(window.location.search).get("planet");
  if (asked) {
    const profile = get_planet_profile(asked);
    if (profile) return profile;
    console.warn(`SceneTransition: unknown ?planet=${asked}, using ${TARGET_PLANET}`);
  } // end if
  return get_planet_profile(TARGET_PLANET) || get_planet_profile("Earth");
} // end function

export class SceneTransition {
  /**
   * canvas   -> the gl canvas (overlay and hint are attached next to it)
   * renderer -> shared Renderer, handed to scene.init() on first use
   * aspect   -> canvas aspect, handed to scene.init() on first use
   * space    -> an OuterSpaceScene
   * earth    -> the landing scene (EarthScene; it shows whichever planet we land on)
   * start    -> "space" or "earth": which scene is already init()ed and showing
   */
  constructor({ canvas, renderer, aspect, space, earth, start = "space" }) {
    this.renderer = renderer;
    this.aspect = aspect;
    this.space = space;
    this.earth = earth;

    this.profile = resolve_initial_profile(); // the planet we are heading for
    this.earth.set_planet(this.profile);      // so ?scene=earth also shows that planet's backdrop

    this.state = start;        // "space" | "flying" | "fade_out" | "fade_in" | "earth"
    this.destination = null;   // which scene the current fade is heading to
    this.state_start = 0;      // clock (seconds) when the current state began
    this.fly_from = null;      // camera pose when the flight started
    this.base_near = null;     // space camera near plane, saved while flying (restored on return)

    this.canvas = canvas;
    this.ship = null; // SHIP PREVIEW: the player's Spaceship, created once space is initialized

    this.make_overlay(canvas);
    this.ensure_ship(); // SHIP PREVIEW: only if space is already showing; otherwise built on the first return
    this.set_hint();

    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      const key = e.key.toLowerCase();
      // SHIP PREVIEW: E lands on the nearest planet in range (only while flying the ship in space).
      // Click no longer lands; in space a click only captures the mouse (see spaceship.js).
      if (key === "e") this.request_landing_nearest();
      if (key === "q") this.request_return();
    });
  } // end constructor

  // ------------------------------------------------------------
  // triggers
  // ------------------------------------------------------------

  /**
   * pick a different planet for the next landing ("Venus", any case). only allowed while
   * in space. returns false for an unknown name or when a flight is already under way.
   */
  set_target(planet_name) {
    if (this.state !== "space" && this.state !== "earth") return false;
    const profile = get_planet_profile(planet_name);
    if (!profile) return false;
    this.profile = profile;
    this.earth.set_planet(profile);       // backdrop updates in place, no scene re-creation
    this.overlay.style.background = css_color(profile.fade);
    this.set_hint();
    return true;
  } // end function

  /** SHIP PREVIEW: E handler. lands on the planet the ship is close enough to, else does nothing. */
  request_landing_nearest() {
    if (this.state !== "space" || !this.ship || !this.ship.near || !this.ship.near.in_range) return;
    this.request_landing(this.ship.near.name);
  } // end function

  /** planet_name is optional: omit it to land on the current target (?planet= / TARGET_PLANET). */
  request_landing(planet_name = null) {
    if (this.state !== "space") return;
    if (planet_name !== null && !this.set_target(planet_name)) return;
    this.ensure_init(this.space); // only matters if we started in the bird scene
    this.ensure_ship();
    this.earth.set_planet(this.profile);
    this.base_near = this.space.camera.near;
    this.ship.deactivate();       // SHIP PREVIEW: ship stops reading input...
    this.ship.set_visible(false); // ...and is hidden so the landing camera cannot fly through it
    this.begin("flying", "earth");
    this.fly_from = { eye: [...this.space.camera.eye], target: [...this.space.camera.target] };
  } // end function

  request_return() {
    if (this.state !== "earth") return;
    if (this.earth.on_exit) this.earth.on_exit(); // SHIP PREVIEW hook: on-foot/shotgun code tears down here
    this.begin("fade_out", "space");
  } // end function

  // ------------------------------------------------------------
  // per frame -- call this instead of curr_scene.render(frontend_data)
  // ------------------------------------------------------------

  render(frontend_data) {
    const now = frontend_data.delta_time;
    if (this.pending_start) { this.state_start = now; this.pending_start = false; }
    const elapsed = now - this.state_start;
    const half_fade = FADE_SECONDS / 2;

    switch (this.state) {
      case "space":
        // SHIP PREVIEW: the ship (flight, chase camera, collision, nearest planet) runs ONLY in this state.
        this.ensure_ship();
        this.ship.update(now);
        this.update_space_hint();
        this.space.render(frontend_data);
        break;

      case "flying": {
        const t = clamp01(elapsed / FLY_SECONDS);
        this.aim_camera_at_planet(t);
        this.space.render(frontend_data);
        if (t >= 1) this.begin("fade_out", "earth", now);
        break;
      }

      case "fade_out": {
        // landing: hold the final pose (the planet keeps orbiting, so keep tracking it)
        if (this.destination === "earth") this.aim_camera_at_planet(1);
        const shown = this.destination === "earth" ? this.space : this.earth;
        shown.render(frontend_data);
        this.set_fade(clamp01(elapsed / half_fade));
        if (elapsed >= half_fade) this.swap_scene(now);
        break;
      }

      case "fade_in": {
        const shown = this.destination === "earth" ? this.earth : this.space;
        shown.render(frontend_data);
        this.set_fade(1 - clamp01(elapsed / half_fade));
        if (elapsed >= half_fade) {
          this.state = this.destination;
          this.set_fade(0);
          this.set_hint();
          // SHIP PREVIEW hooks: the ship takes input again in space; the planet scene gets on_enter.
          if (this.state === "space") this.ship.activate();
          if (this.state === "earth" && this.earth.on_enter) this.earth.on_enter({ planet: this.profile });
        }
        break;
      }

      case "earth":
        this.earth.render(frontend_data);
        break;
    } // end switch
  } // end function

  // ------------------------------------------------------------
  // internals
  // ------------------------------------------------------------

  begin(state, destination, now = null) {
    this.state = state;
    this.destination = destination;
    // clock value comes from the next render() call unless the caller already has it.
    if (now === null) { this.pending_start = true; } else { this.state_start = now; }
    this.set_hint();
  } // end function

  /**
   * the actual scene swap, done while the overlay is fully opaque.
   * init is guarded by the scenes' own `initialized` flag, so space is never
   * re-initialized on the way back.
   */
  swap_scene(now) {
    if (this.destination === "earth") {
      this.earth.set_planet(this.profile); // sky + ground for the planet we landed on
      this.ensure_init(this.earth);
    } else {
      this.ensure_init(this.space);
      // SHIP PREVIEW: instead of reset_view(), park the ship just outside the planet we left,
      // nose pointing away from it, and snap the chase camera behind it.
      this.ensure_ship();
      this.ship.place_outside(this.planet_node(), now);
      this.ship.set_visible(true);
      if (this.base_near !== null) {  // the flight may have pulled the near plane in
        this.space.camera.near = this.base_near;
        this.base_near = null;
      } // end if
    } // end if
    this.state = "fade_in";
    this.state_start = now;
  } // end function

  ensure_init(scene) {
    if (!scene.initialized) scene.init(this.renderer, this.aspect);
  } // end function

  /** SHIP PREVIEW: create the ship once the space scene exists (never earlier). */
  ensure_ship() {
    if (!this.ship && this.space.initialized) this.ship = new Spaceship(this.space, this.canvas);
  } // end function

  /** SHIP PREVIEW: the space-scene node of the planet we are heading for / landed on. */
  planet_node() {
    return this.space.solar_system.planets.find((p) => p.data.name === this.profile.name);
  } // end function

  /**
   * the target planet's live world position, read from the transformation matrix the
   * renderer computed last frame (column-major, so the translation is elements 12..14).
   */
  planet_world() {
    const node = this.planet_node();
    const m = node.transformation_matrix;
    return { position: [m[12], m[13], m[14]], radius: node.display_radius };
  } // end function

  /**
   * place the camera for flight progress t in [0, 1].
   * the end pose is recomputed every frame from the planet's CURRENT position, so
   * the camera chases the moving planet instead of flying to where it was.
   */
  aim_camera_at_planet(t) {
    const cam = this.space.camera;
    const { position, radius } = this.planet_world();
    const { eye: eye0, target: target0 } = this.fly_from;

    // stop distance: close enough that the planet covers the whole frame, corners included.
    const tan_corner = Math.tan(cam.fov / 2) * Math.hypot(1, cam.aspect);
    const sin_corner = tan_corner / Math.hypot(1, tan_corner);
    const stop = (radius / sin_corner) * 0.95;

    // small planets (Mercury) would end up with their near surface inside the near plane,
    // so pull the near plane in to half the final gap. restored in swap_scene on the way back.
    cam.near = Math.min(this.base_near, Math.max(0.005, (stop - radius) * 0.5));

    // end pose: on the line from the start eye to the planet, `stop` short of it.
    const dir = position.map((v, i) => v - eye0[i]);
    const len = Math.hypot(...dir) || 1;
    const goal = position.map((v, i) => v - (dir[i] / len) * stop);

    const eye = lerp3(eye0, goal, ease_in_out_cubic(t));
    // turn toward the planet during the first half so it is centered long before arrival.
    const target = lerp3(target0, position, ease_in_out_cubic(clamp01(t / 0.5)));
    cam.set_look_at(eye, target);
  } // end function

  // ------------------------------------------------------------
  // DOM: fade overlay + hint text
  // ------------------------------------------------------------

  make_overlay(canvas) {
    const holder = canvas.parentElement; // sized to the canvas
    holder.style.position = "relative";

    this.overlay = document.createElement("div");
    this.overlay.style.cssText =
      `position:absolute;inset:0;background:${css_color(this.profile.fade)};opacity:0;pointer-events:none;`;
    holder.appendChild(this.overlay);

    this.hint = document.createElement("div");
    this.hint.style.cssText =
      "position:absolute;left:12px;bottom:12px;padding:4px 10px;border-radius:4px;" +
      "background:rgba(0,0,0,0.55);color:#fff;font:14px sans-serif;pointer-events:none;";
    holder.appendChild(this.hint);
  } // end function

  set_fade(opacity) {
    this.overlay.style.opacity = String(opacity);
  } // end function

  set_hint() {
    const text = {
      space: this.space_hint_text(), // SHIP PREVIEW: proximity prompt or controls hint
      earth: "Press Q to return to space"
    }[this.state] || "";
    this.hint.textContent = text;
    this.hint.style.display = text ? "block" : "none";
  } // end function

  /** SHIP PREVIEW: "Press E to land on <Name>" when in range, otherwise a short controls hint. */
  space_hint_text() {
    const near = this.ship && this.ship.near;
    if (near && near.in_range) return `Press E to land on ${near.name}`;
    return "W/S thrust | A/D turn | mouse or arrows pitch/turn (click to capture mouse) | Shift boost";
  } // end function

  /** SHIP PREVIEW: refresh the hint each space frame, touching the DOM only when the text changes. */
  update_space_hint() {
    const text = this.space_hint_text();
    if (text !== this.hint.textContent) this.set_hint();
  } // end function

} // end class
