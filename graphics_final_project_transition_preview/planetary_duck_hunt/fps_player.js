// FPS PREVIEW: this whole file is new.
//
// First-person on-foot controller for the planet (bird) scene.
//   WASD   move on the ground, relative to where you look
//   mouse  look (pointer lock: click the canvas); pitch is clamped
//   Space  jump
//   mouse button held while locked: fire (the scene decides if the pump delay allows it)
//   Q      releases the pointer lock (the scene transition itself handles leaving)
//
// All input is gated on `active`, which EarthScene.on_enter()/on_exit() flip, so in space
// these listeners do nothing and WASD belongs to the ship alone.
//
// Conventions match util/transitions.js rotate(): yaw turns about +y, forward at yaw 0 is -z,
// and a positive pitch looks up.

const EYE_HEIGHT = 1.7;   // eye above the feet
const WALK_SPEED = 6;     // world units per second
const JUMP_SPEED = 5.5;
const GRAVITY = 16;
const MOUSE_SENS = 0.0022; // radians per pixel of mouse movement
const PITCH_LIMIT = 1.45;  // just under 90 degrees

/**
 * orthonormal camera axes for a yaw/pitch pair (plain [x, y, z] arrays).
 */
export function camera_basis(yaw, pitch) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  return {
    right: [cy, 0, -sy],
    up: [sy * sp, cp, cy * sp],
    fwd: [-sy * cp, sp, -cy * cp]
  };
} // end function

export class FpsPlayer {
  /**
   * canvas -> the gl canvas: pointer lock is requested on it and mouse presses on it count.
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.active = false;       // set by EarthScene.on_enter / on_exit
    this.locked = false;       // pointer currently locked to the canvas
    this.keys = new Set();     // KeyboardEvent.code values currently held
    this.mouse_down = false;   // left button held while locked (auto-fire)
    this.on_lock_change = null; // callback(locked) so the HUD can show its prompt

    this.pos = [0, 0, 0];      // FEET position, y = ground level under the player
    this.yaw = 0;
    this.pitch = 0;
    this.vy = 0;
    this.bounds = 90;          // max horizontal distance from the origin
    this.bob = 0;              // walking phase, drives a small gun bob
    this.ground_fn = null;     // TERRAIN: (x, z) -> ground height; null = flat ground at y = 0
    this.colliders = [];       // TERRAIN: solid boulders / trunks [{x, z, r, top}] the player walks around

    this.reset(90);
    this.bind_events();
  } // end constructor

  /**
   * put the player back at the landing spot, looking toward -z (where the birds start).
   * bounds is the walkable radius around the origin.
   */
  reset(bounds) {
    this.pos = [0, this.ground_at(0, 0), 0];
    this.yaw = 0;
    this.pitch = 0.1;
    this.vy = 0;
    this.bob = 0;
    this.bounds = bounds;
    this.keys.clear();
    this.mouse_down = false;
  } // end function

  /** TERRAIN: ground height under (x, z): the terrain lookup when one is set, else the flat ground at 0. */
  ground_at(x, z) {
    return this.ground_fn ? this.ground_fn(x, z) : 0;
  } // end function

  /** eye position in world space. */
  eye() {
    return [this.pos[0], this.pos[1] + EYE_HEIGHT, this.pos[2]];
  } // end function

  basis() {
    return camera_basis(this.yaw, this.pitch);
  } // end function

  /**
   * switch the controller on or off. off also drops held keys and the pointer lock.
   */
  set_active(on) {
    this.active = on;
    if (!on) {
      this.keys.clear();
      this.mouse_down = false;
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    } // end if
  } // end function

  /**
   * advance the walk / jump by dt seconds. does nothing while inactive.
   */
  update(dt) {
    if (!this.active) return;

    // ground movement: W/S along the flat forward, A/D along the flat right.
    const f = (this.keys.has("KeyW") ? 1 : 0) - (this.keys.has("KeyS") ? 1 : 0);
    const s = (this.keys.has("KeyD") ? 1 : 0) - (this.keys.has("KeyA") ? 1 : 0);
    if (f || s) {
      const len = Math.hypot(f, s); // so diagonals are not faster
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      const dx = (-sy * f + cy * s) / len;
      const dz = (-cy * f - sy * s) / len;
      this.pos[0] += dx * WALK_SPEED * dt;
      this.pos[2] += dz * WALK_SPEED * dt;
      if (this.pos[1] <= this.ground_at(this.pos[0], this.pos[2]) + 0.05) this.bob += dt * 9;
    } // end if

    // keep the player on the ground area (a landing platform on the gas giants).
    const r = Math.hypot(this.pos[0], this.pos[2]);
    if (r > this.bounds) {
      this.pos[0] *= this.bounds / r;
      this.pos[2] *= this.bounds / r;
    } // end if

    // TERRAIN: walk around boulders and tree trunks taller than the feet (a short rock can be stepped on)
    for (const c of this.colliders) {
      if (this.pos[1] >= c.top - 0.35) continue;
      const dx = this.pos[0] - c.x, dz = this.pos[2] - c.z;
      const min_d = c.r + 0.45;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min_d * min_d) continue;
      const d = Math.sqrt(d2);
      if (d < 1e-4) { this.pos[0] = c.x + min_d; continue; }
      this.pos[0] = c.x + (dx / d) * min_d;
      this.pos[2] = c.z + (dz / d) * min_d;
    } // end loop
    const rr = Math.hypot(this.pos[0], this.pos[2]); // the push-out may have left the walkable area
    if (rr > this.bounds) {
      this.pos[0] *= this.bounds / rr;
      this.pos[2] *= this.bounds / rr;
    } // end if

    // jump + gravity over the terrain: the ground is wherever the height lookup says (y = 0 when flat)
    const ground = this.ground_at(this.pos[0], this.pos[2]);
    let on_ground = this.pos[1] <= ground + 0.05;
    if (!on_ground && this.vy <= 0 && this.pos[1] - ground < 0.35) { // walking downhill: stay glued to the slope
      this.pos[1] = ground;
      this.vy = 0;
      on_ground = true;
    } // end if
    if (on_ground && this.keys.has("Space")) this.vy = JUMP_SPEED;
    this.vy -= GRAVITY * dt;
    this.pos[1] += this.vy * dt;
    if (this.pos[1] < ground) { this.pos[1] = ground; this.vy = 0; }
  } // end function

  // ------------------------------------------------------------
  // events
  // ------------------------------------------------------------

  bind_events() {
    window.addEventListener("keydown", (e) => {
      if (!this.active) return;
      this.keys.add(e.code);
      if (e.code === "Space") e.preventDefault(); // do not scroll the page
      if (e.code === "KeyQ" && document.pointerLockElement === this.canvas) document.exitPointerLock();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => { this.keys.clear(); this.mouse_down = false; });

    document.addEventListener("mousemove", (e) => {
      if (!this.active || !this.locked) return;
      this.yaw -= e.movementX * MOUSE_SENS;   // mouse right -> turn right
      this.pitch -= e.movementY * MOUSE_SENS; // mouse up -> look up
      this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
    });

    this.canvas.addEventListener("mousedown", (e) => {
      if (!this.active || e.button !== 0) return;
      if (!this.locked) {
        // first click only captures the mouse, it does not fire.
        const p = this.canvas.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
      } else {
        this.mouse_down = true;
      } // end if
    });
    window.addEventListener("mouseup", (e) => { if (e.button === 0) this.mouse_down = false; });

    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.mouse_down = false;
      if (this.on_lock_change) this.on_lock_change(this.locked);
    });
  } // end function

} // end class
