// FPS PREVIEW: this whole file is new.
//
// The shootable birds of the planet scene. The real C/WASM flocking branch is not merged, so these
// are plain JS wanderers: each bird flies toward a random waypoint around the player, steers its
// velocity toward it, and the cone is turned to point along its velocity. Birds are
// BoidSceneNodes under the scene's `boids` group, sharing one cone mesh and material.
//
// A shot bird switches to "falling": it drops, spins and shrinks for FALL_SECONDS, then is removed.
// When no birds are left a new wave spawns after a short pause.

import { BoidSceneNode } from "./boid_scene_node.js";

export const WAVE_SIZE = 20;
const FALL_SECONDS = 0.8;
const NEXT_WAVE_DELAY = 1.5;
const BIRD_SCALE = [0.7, 1.8, 0.7]; // the cone is 0.5 radius and 1 tall before scaling
const HIT_RADIUS = 1.1;             // bounding sphere around the middle of the cone
const FALL_GRAVITY = 14;

const rand = (a, b) => a + Math.random() * (b - a);

export class BirdFlock {
  /**
   * group    -> the GroupSceneNode the bird nodes live under
   * mesh, material -> shared by every bird
   */
  constructor(group, mesh, material) {
    this.group = group;
    this.mesh = mesh;
    this.material = material;
    this.birds = [];       // every bird node still in the scene (alive or falling)
    this.wave = 0;
    this.wave_wait = 0;    // seconds the field has been empty
    this.next_id = 0;
    this.ground_y = 0;
  } // end constructor

  /** remove every bird and start wave 1 around `center` ([x, y, z]). */
  reset(center) {
    for (const b of this.birds) this.group.remove_child(b);
    this.birds = [];
    this.wave = 0;
    this.wave_wait = 0;
    this.spawn_wave(center);
  } // end function

  alive_count() {
    return this.birds.filter((b) => b.state === "alive").length;
  } // end function

  spawn_wave(center) {
    this.wave += 1;
    for (let i = 0; i < WAVE_SIZE; i++) {
      const bird = new BoidSceneNode(`bird${this.next_id++}`, "phong_basic");
      bird.init(this.mesh, this.material, null);
      const angle = rand(0, Math.PI * 2);
      const r = rand(12, 40);
      bird.position = [center[0] + Math.cos(angle) * r, this.ground_y + rand(3, 14), center[2] + Math.sin(angle) * r];
      bird.scale = [...BIRD_SCALE];
      bird.state = "alive";
      bird.speed = rand(3.5, 6.5);
      const heading = rand(0, Math.PI * 2);
      bird.velocity = [Math.cos(heading) * bird.speed, 0, Math.sin(heading) * bird.speed];
      bird.axis = [1, 0, 0]; // unit direction the nose points, refreshed every frame
      bird.fall_t = 0;
      this.pick_target(bird, center);
      this.point_along_velocity(bird);
      this.group.add_child(bird);
      this.birds.push(bird);
    } // end loop
  } // end function

  pick_target(bird, center) {
    const angle = rand(0, Math.PI * 2);
    const r = rand(8, 35);
    bird.target = [center[0] + Math.cos(angle) * r, this.ground_y + rand(3, 14), center[2] + Math.sin(angle) * r];
    bird.retarget_in = rand(3, 7);
  } // end function

  /**
   * turn the cone's +y axis (its tip) along the bird's velocity.
   * with rotate() = Rz * Ry * Rx and ry = 0: the +y axis ends up at
   * (-sin(rz) cos(rx), cos(rz) cos(rx), sin(rx)), so solve that for rx and rz.
   */
  point_along_velocity(bird) {
    const [vx, vy, vz] = bird.velocity;
    const len = Math.hypot(vx, vy, vz) || 1;
    const ax = vx / len, ay = vy / len, az = vz / len;
    bird.axis = [ax, ay, az];
    bird.rotation = [Math.asin(Math.max(-1, Math.min(1, az))), 0, Math.atan2(-ax, ay)];
  } // end function

  /**
   * move every bird by dt seconds. center = the player's position (birds roam around it).
   */
  update(dt, center) {
    for (const bird of [...this.birds]) {
      if (bird.state === "falling") {
        this.update_falling(bird, dt);
      } else {
        this.update_wandering(bird, dt, center);
      } // end if
    } // end loop

    if (this.birds.length === 0) {
      this.wave_wait += dt;
      if (this.wave_wait >= NEXT_WAVE_DELAY) {
        this.wave_wait = 0;
        this.spawn_wave(center);
      } // end if
    } // end if
  } // end function

  update_wandering(bird, dt, center) {
    bird.retarget_in -= dt;
    const to = bird.target.map((v, i) => v - bird.position[i]);
    const dist = Math.hypot(...to);
    if (dist < 3 || bird.retarget_in <= 0) this.pick_target(bird, center);

    // steer: ease the velocity toward "fly at the waypoint at my own speed"
    const k = Math.min(1, 1.2 * dt);
    for (let i = 0; i < 3; i++) {
      bird.velocity[i] += ((to[i] / (dist || 1)) * bird.speed - bird.velocity[i]) * k;
      bird.position[i] += bird.velocity[i] * dt;
    } // end loop
    bird.position[1] = Math.max(bird.position[1], this.ground_y + 1.5); // never into the ground
    this.point_along_velocity(bird);
  } // end function

  update_falling(bird, dt) {
    bird.fall_t += dt;
    bird.velocity[1] -= FALL_GRAVITY * dt;
    for (let i = 0; i < 3; i++) bird.position[i] += bird.velocity[i] * dt;
    bird.rotation[2] += 9 * dt; // tumble

    // shrink to nothing. (scale() treats 0 as "no scale", so stay slightly above it)
    const s = Math.max(0.02, 1 - bird.fall_t / FALL_SECONDS);
    bird.scale = BIRD_SCALE.map((v) => v * s);

    if (bird.fall_t >= FALL_SECONDS || bird.position[1] <= this.ground_y) {
      this.group.remove_child(bird);
      this.birds = this.birds.filter((b) => b !== bird);
    } // end if
  } // end function

  /** world position of the middle of the bird (the cone's pivot is its base). */
  center_of(bird) {
    const h = 0.5 * BIRD_SCALE[1];
    return bird.position.map((v, i) => v + bird.axis[i] * h);
  } // end function

  /**
   * nearest living bird hit by the ray (origin + t * dir, dir is unit length), or null.
   * ray vs bounding sphere.
   */
  raycast(origin, dir, max_t = 100) {
    let best = null;
    let best_t = max_t;
    for (const bird of this.birds) {
      if (bird.state !== "alive") continue;
      const c = this.center_of(bird);
      const oc = c.map((v, i) => v - origin[i]);
      const tca = oc[0] * dir[0] + oc[1] * dir[1] + oc[2] * dir[2];
      if (tca < 0) continue; // behind the shooter
      const d2 = oc[0] * oc[0] + oc[1] * oc[1] + oc[2] * oc[2] - tca * tca;
      if (d2 > HIT_RADIUS * HIT_RADIUS) continue;
      const t = tca - Math.sqrt(HIT_RADIUS * HIT_RADIUS - d2);
      if (t < best_t) { best_t = t; best = bird; }
    } // end loop
    return best;
  } // end function

  /** a hit bird starts to fall. it keeps a little of its sideways speed. */
  kill(bird) {
    bird.state = "falling";
    bird.fall_t = 0;
    bird.velocity = [bird.velocity[0] * 0.3, 2, bird.velocity[2] * 0.3];
  } // end function

} // end class
