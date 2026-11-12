// SHIP PREVIEW: this whole file is new.
//
// The player's spaceship for the outer-space scene: a low-poly model built only from the existing
// mesh generators (cone fuselage, cube wings/fin/cockpit/engine) plus a flight controller with a
// smoothed third-person chase camera, sun/planet push-out collision, and a "nearest planet" probe
// that the SceneTransition uses to offer "Press E to land on <Name>".
//
// Ownership: SceneTransition (util/scene_transition.js) creates one Spaceship, calls update(now)
// ONLY while its state is "space", and calls deactivate()/activate() around landings and returns.
// While inactive the ship ignores all input, so the planet scene can use WASD/E/Q/mouse freely.
//
// Controls: W/S thrust forward/back, A/D turn (yaw), mouse (click canvas for pointer lock) or the
// arrow keys for pitch + yaw, Shift boost.

import * as SceneBuilder from "../util/scene_graph.js";
import * as MeshBuilder from "../util/mesh_generators.js";
import { mat4FromRows, matMul } from "../util/transitions.js";

// ---------------------------------------------------------------- tunables
// World units: the whole compressed system is ~100 units across (planets sit 4..50 units from the
// sun), so MAX_SPEED 8 crosses it in ~12 s, boosted in ~6 s.
export const SHIP_TUNABLES = {
  SHIP_SCALE: 0.5,        // model is 1 unit long before this scale
  SHIP_RADIUS: 0.18,      // collision sphere of the ship
  SUN_RADIUS: 2.5,        // the sun mesh radius (outer_space_scene.js init_sun)
  START_POS: [0, 6, 28],  // where the ship begins (the old default camera looked from the origin)
  START_YAW: 0,           // 0 faces -z, i.e. toward the sun
  START_PITCH: -0.2,
  ACCEL: 10,              // units/s^2 while thrusting
  REVERSE_FACTOR: 0.6,    // S is weaker than W
  DRAG: 0.9,              // 1/s velocity damping (inertia: coasts to a stop over a few seconds)
  MAX_SPEED: 8,           // units/s
  BOOST: 2,               // Shift multiplies accel and max speed
  YAW_RATE: 1.6,          // rad/s from A/D or Left/Right
  PITCH_RATE: 1.2,        // rad/s from Up/Down
  MOUSE_SENS: 0.0022,     // rad per pixel of pointer-locked mouse movement
  MAX_PITCH: 1.35,        // rad, keeps the camera "up" well defined
  CHASE_BACK: 1.3,        // camera distance behind the ship
  CHASE_UP: 0.4,          // camera height above the ship
  CHASE_LOOK: 3.0,        // camera looks this far ahead of the ship
  CAM_FOLLOW: 10,         // 1/s camera smoothing rate (higher = stiffer)
  LAND_MARGIN: 4.0,       // "Press E" shows within radius + this (surface gap), in world units...
  LAND_SPEED_BONUS: 0.35, // ...plus this * planet orbital speed (Mercury moves ~12 units/s)
  RETURN_GAP: 2.0,        // on Q return the ship is placed this far above the planet surface
  WORLD_LIMIT: 110,       // soft boundary: max distance from the sun
  FAR_PLANE: 400          // the default far plane (100) would clip the system once you fly around
};
const T = SHIP_TUNABLES;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * where a planet is at time `now` (seconds), computed from the same formula the scene uses
 * (PlanetSceneNode.update_transformation_matrix: rotate_y(orbit) * translate([d, 0, d]) about the sun).
 * used for the one-off placement on return, when the live matrices are stale.
 */
export function planet_position_at(space, node, now) {
  const sun = space.solar_system.sun.position;
  const theta = ((now * space.days_per_second) / node.data.orbit_period) * 2 * Math.PI;
  const d = node.display_distance;
  return [
    sun[0] + d * Math.cos(theta) + d * Math.sin(theta),
    sun[1],
    sun[2] - d * Math.sin(theta) + d * Math.cos(theta)
  ];
} // end function

/**
 * the ship root. A GroupSceneNode (never drawn itself) whose transform is built from the
 * ship's orientation basis, so the parts below simply inherit it.
 */
class SpaceshipNode extends SceneBuilder.GroupSceneNode {
  constructor() {
    super();
    this.basis = { right: [1, 0, 0], up: [0, 1, 0], back: [0, 0, 1] };
    this.position = [0, 0, 0];
  } // end constructor

  update_transformation_matrix(M_parent) {
    const { right: r, up: u, back: b } = this.basis;
    const s = T.SHIP_SCALE;
    const p = this.position;
    // columns are the basis vectors (model +x -> right, +y -> up, +z -> back; the nose is -z)
    const M_local = mat4FromRows(
      r[0] * s, u[0] * s, b[0] * s, p[0],
      r[1] * s, u[1] * s, b[1] * s, p[1],
      r[2] * s, u[2] * s, b[2] * s, p[2],
      0, 0, 0, 1
    );
    this.transformation_matrix = matMul(M_parent, M_local);
  } // end function
} // end class

/**
 * build the model. nose points down -z. all parts share the "phong_ship" shader
 * (util/shaders.js), which lights them with the sun in view space.
 */
function build_ship_model(gl) {
  const mat = (ka, kd, ks, shininess) => new SceneBuilder.Material({ ka, kd, ks, shininess, transparency: 1 });
  const hull_mat = mat([0.30, 0.30, 0.30], [0.85, 0.85, 0.85], [0.6, 0.6, 0.6], 40);
  const glow_mat = mat([1.0, 1.0, 1.0], [0.2, 0.2, 0.2], [0.0, 0.0, 0.0], 1); // bright regardless of lighting

  const mesh = (data) => new SceneBuilder.Mesh(gl, data);
  const hull = [0.78, 0.80, 0.86];
  const wing = [0.80, 0.25, 0.20];
  const canopy = [0.20, 0.60, 0.90];
  const flame = [1.0, 0.55, 0.15];

  const fuselage_mesh = mesh(MeshBuilder.gen_cone_mesh(0.5, 0.4, 0.5, hull)); // few segments = low-poly
  const wing_mesh = mesh(MeshBuilder.gen_cube_mesh(wing));
  const canopy_mesh = mesh(MeshBuilder.gen_cube_mesh(canopy));
  const flame_mesh = mesh(MeshBuilder.gen_cube_mesh(flame));

  const part = (m, material, position, rotation, scale_) => {
    const n = new SceneBuilder.SceneNode("ship_part", "phong_ship");
    n.set_mesh(m).set_material(material);
    n.position = position;
    n.rotation = rotation;
    n.scale = scale_;
    return n;
  };

  const root = new SpaceshipNode();
  // fuselage: the cone points up (+y); rotate -90 deg about x so the apex points to -z (the nose).
  root.add_child(part(fuselage_mesh, hull_mat, [0, 0, 0.5], [-Math.PI / 2, 0, 0], [0.4, 1.0, 0.4]));
  // swept wings (cube half-extents = scale)
  root.add_child(part(wing_mesh, hull_mat, [-0.32, -0.02, 0.28], [0, 0.45, 0], [0.30, 0.012, 0.17]));
  root.add_child(part(wing_mesh, hull_mat, [0.32, -0.02, 0.28], [0, -0.45, 0], [0.30, 0.012, 0.17]));
  // tail fin
  root.add_child(part(wing_mesh, hull_mat, [0, 0.14, 0.38], [0, 0, 0], [0.012, 0.13, 0.13]));
  // cockpit canopy
  root.add_child(part(canopy_mesh, hull_mat, [0, 0.1, 0.08], [0, 0, 0], [0.06, 0.04, 0.12]));
  // engine glow
  root.add_child(part(flame_mesh, glow_mat, [0, 0, 0.52], [0, 0, 0], [0.09, 0.09, 0.04]));
  return root;
} // end function

export class Spaceship {
  /**
   * space  -> an initialized OuterSpaceScene (needs renderer, camera, solar_system)
   * canvas -> the gl canvas (click it to capture the mouse for pitch/yaw)
   */
  constructor(space, canvas) {
    this.space = space;
    this.canvas = canvas;
    this.node = build_ship_model(space.renderer.gl);

    this.position = [...T.START_POS];
    this.yaw = T.START_YAW;     // 0 faces -z; increasing turns left
    this.pitch = T.START_PITCH; // positive = nose up
    this.roll = 0;              // cosmetic bank only
    this.velocity = [0, 0, 0];

    this.keys = new Set();      // KeyboardEvent.code values currently held
    this.mouse_dx = 0;
    this.mouse_dy = 0;
    this.active = false;        // false = ignore all input (not in the space state)
    this.last_now = null;
    this.visible = false;

    this.near = null;           // { name, node, gap, in_range } for the closest planet, refreshed every update
    this.speed = 0;
    this.prev_planet_pos = {};  // for estimating each planet's orbital speed

    // the far plane must reach across the whole system from wherever the ship is
    space.camera.far = Math.max(space.camera.far, T.FAR_PLANE);

    this.cam_eye = [0, 0, 0];
    this.cam_target = [0, 0, 0];
    this.apply_pose();
    this.snap_camera();
    this.set_visible(true);
    this.attach_input();
  } // end constructor

  // ------------------------------------------------------------ lifecycle

  /** the transition calls this when we are (back) in the space state. */
  activate() {
    this.active = true;
    this.last_now = null;
    this.mouse_dx = this.mouse_dy = 0;
  } // end function

  /** the transition calls this when leaving the space state (landing). Drops held keys. */
  deactivate() {
    this.active = false;
    this.keys.clear();
    this.mouse_dx = this.mouse_dy = 0;
  } // end function

  /** show/hide the ship in the scene (hidden while the landing camera flies, so it can't fly through it). */
  set_visible(visible) {
    if (visible === this.visible) return;
    this.visible = visible;
    if (visible) { this.space.add_node(this.node); } else { this.space.remove_node(this.node); }
  } // end function

  // ------------------------------------------------------------ input

  attach_input() {
    window.addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      // stop arrows scrolling the page while we are flying (never touches WASD/E/Q)
      if (this.active && e.code.startsWith("Arrow")) e.preventDefault();
    });
    window.addEventListener("keyup", (e) => { this.keys.delete(e.code); });
    window.addEventListener("blur", () => { this.keys.clear(); });

    // pointer lock for mouse flight: only requested while flying the ship.
    this.canvas.addEventListener("click", () => {
      if (!this.active || document.pointerLockElement === this.canvas) return;
      try {
        const p = this.canvas.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
      } catch (err) { /* pointer lock unavailable; arrow keys still work */ }
    });
    document.addEventListener("mousemove", (e) => {
      if (!this.active || document.pointerLockElement !== this.canvas) return;
      this.mouse_dx += e.movementX;
      this.mouse_dy += e.movementY;
    });
  } // end function

  held(...codes) { return codes.some((c) => this.keys.has(c)); }

  // ------------------------------------------------------------ orientation

  forward() {
    const cp = Math.cos(this.pitch);
    return [-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp];
  } // end function

  /** write position/orientation into the node (roll banks right/up about the forward axis). */
  apply_pose() {
    const f = this.forward();
    const r0 = norm(cross(f, [0, 1, 0]));
    const u0 = cross(r0, f);
    const c = Math.cos(this.roll);
    const s = Math.sin(this.roll);
    const right = add(mul(r0, c), mul(u0, s));
    const up = sub(mul(u0, c), mul(r0, s));
    this.node.basis = { right, up, back: mul(f, -1) };
    this.node.position = this.position;
  } // end function

  // ------------------------------------------------------------ camera

  desired_camera() {
    const f = this.forward();
    return {
      eye: add(sub(this.position, mul(f, T.CHASE_BACK)), [0, T.CHASE_UP, 0]),
      target: add(this.position, mul(f, T.CHASE_LOOK))
    };
  } // end function

  snap_camera() {
    const d = this.desired_camera();
    this.cam_eye = d.eye;
    this.cam_target = d.target;
    this.space.camera.set_look_at(this.cam_eye, this.cam_target);
  } // end function

  // ------------------------------------------------------------ per frame

  /** call once per frame while in the space state. now = frontend_data.delta_time (seconds). */
  update(now) {
    let dt = this.last_now === null ? 1 / 60 : now - this.last_now;
    this.last_now = now;
    dt = clamp(dt, 0, 0.05);
    this.active = true;

    // --- turning: A/D (or arrows) yaw, mouse / Up-Down arrows pitch
    const yaw_in = clamp((this.held("KeyA", "ArrowLeft") ? 1 : 0) - (this.held("KeyD", "ArrowRight") ? 1 : 0), -1, 1);
    const pitch_in = (this.held("ArrowUp") ? 1 : 0) - (this.held("ArrowDown") ? 1 : 0);
    const dyaw = yaw_in * T.YAW_RATE * dt - this.mouse_dx * T.MOUSE_SENS;
    const dpitch = pitch_in * T.PITCH_RATE * dt - this.mouse_dy * T.MOUSE_SENS;
    this.mouse_dx = this.mouse_dy = 0;
    this.yaw += dyaw;
    this.pitch = clamp(this.pitch + dpitch, -T.MAX_PITCH, T.MAX_PITCH);

    // bank into turns, purely visual
    const roll_target = dt > 0 ? clamp((dyaw / dt) * 0.3, -0.6, 0.6) : 0;
    this.roll += (roll_target - this.roll) * Math.min(1, 6 * dt);

    // --- thrust with inertia: accelerate along the nose, damp, cap the speed
    const boost = this.held("ShiftLeft", "ShiftRight") ? T.BOOST : 1;
    const thrust = (this.held("KeyW") ? 1 : 0) - (this.held("KeyS") ? T.REVERSE_FACTOR : 0);
    const f = this.forward();
    this.velocity = add(this.velocity, mul(f, thrust * T.ACCEL * boost * dt));
    this.velocity = mul(this.velocity, Math.exp(-T.DRAG * dt));
    let speed = len(this.velocity);
    const max_speed = T.MAX_SPEED * boost;
    if (speed > max_speed) { // ease down (also when boost is released) instead of snapping
      speed -= (speed - max_speed) * Math.min(1, 3 * dt);
      this.velocity = mul(norm(this.velocity), speed);
    } // end if
    this.position = add(this.position, mul(this.velocity, dt));

    // --- bodies: collision push-out, soft world limit, nearest planet
    this.resolve_bodies(dt);
    this.speed = len(this.velocity);

    // --- pose + chase camera
    this.apply_pose();
    const want = this.desired_camera();
    const k = 1 - Math.exp(-T.CAM_FOLLOW * dt);
    this.cam_eye = lerp3(this.cam_eye, want.eye, k);
    this.cam_target = lerp3(this.cam_target, want.target, k);
    this.space.camera.set_look_at(this.cam_eye, this.cam_target);
  } // end function

  /** live world centre of a node, from the matrix the renderer computed last frame (column-major). */
  static world_position(node) {
    const m = node.transformation_matrix;
    return [m[12], m[13], m[14]];
  } // end function

  /**
   * push the ship out of the sun and every planet, and find the nearest planet.
   * velocity into a body is removed so you slide off instead of sticking.
   */
  resolve_bodies(dt) {
    const bodies = [{ name: "Sun", node: this.space.solar_system.sun, radius: T.SUN_RADIUS, planet: false }];
    this.space.solar_system.planets.forEach((p) => {
      bodies.push({ name: p.data.name, node: p, radius: p.display_radius, planet: true });
    });

    let nearest = null;
    for (const b of bodies) {
      const center = Spaceship.world_position(b.node);
      let offset = sub(this.position, center);
      let dist = len(offset);
      const min_dist = b.radius + T.SHIP_RADIUS;
      if (dist < min_dist) {
        const n = dist > 1e-6 ? mul(offset, 1 / dist) : [0, 1, 0];
        this.position = add(center, mul(n, min_dist));
        const inward = dot(this.velocity, n);
        if (inward < 0) this.velocity = sub(this.velocity, mul(n, inward));
        offset = sub(this.position, center);
        dist = len(offset);
      } // end if

      if (b.planet) {
        const prev = this.prev_planet_pos[b.name];
        const planet_speed = prev && dt > 0 ? len(sub(center, prev)) / dt : 0;
        this.prev_planet_pos[b.name] = center;
        const gap = dist - b.radius;
        const reach = T.LAND_MARGIN + T.LAND_SPEED_BONUS * planet_speed;
        if (!nearest || gap < nearest.gap) {
          nearest = { name: b.name, node: b.node, gap, in_range: gap <= reach };
        } // end if
      } // end if
    } // end loop
    this.near = nearest;

    // soft limit: don't let the ship drift off into the void
    const sun = this.space.solar_system.sun.position;
    const from_sun = sub(this.position, sun);
    const d = len(from_sun);
    if (d > T.WORLD_LIMIT) {
      const n = mul(from_sun, 1 / d);
      this.position = add(sun, mul(n, T.WORLD_LIMIT));
      const outward = dot(this.velocity, n);
      if (outward > 0) this.velocity = sub(this.velocity, mul(n, outward));
    } // end if
  } // end function

  // ------------------------------------------------------------ placement

  /**
   * put the ship just outside a planet (default RETURN_GAP above its surface), on the side facing
   * away from the sun and nose pointing away from the planet, moving along with the planet.
   * `now` is the clock (seconds): the planet position is computed for that instant because the
   * live matrices are stale after time spent in the planet scene.
   */
  place_outside(planet_node, now, gap = T.RETURN_GAP) {
    const center = planet_position_at(this.space, planet_node, now);
    const sun = this.space.solar_system.sun.position;
    const out = norm(add(norm(sub(center, sun)), [0, 0.25, 0])); // away from the sun, a little above the plane
    this.position = add(center, mul(out, planet_node.display_radius + gap));
    this.pitch = Math.asin(clamp(out[1], -1, 1));
    this.yaw = Math.atan2(-out[0], -out[2]);
    this.roll = 0;

    // match the planet's orbital velocity (capped) so it does not fly off the instant we arrive
    const later = planet_position_at(this.space, planet_node, now + 0.05);
    const v = mul(sub(later, center), 1 / 0.05);
    const speed = len(v);
    this.velocity = speed > T.MAX_SPEED ? mul(v, T.MAX_SPEED / speed) : v;

    this.prev_planet_pos = {};
    this.apply_pose();
    this.snap_camera();
  } // end function

} // end class
