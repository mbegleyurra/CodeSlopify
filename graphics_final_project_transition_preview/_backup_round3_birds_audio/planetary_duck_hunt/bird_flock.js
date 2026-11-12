// FPS PREVIEW: this whole file is new.
//
// The shootable birds of the planet scene. The real C/WASM flocking branch is not merged, so these
// are plain JS wanderers: each bird flies toward a random waypoint around the player, steers its
// velocity toward it, and is turned to face along its velocity. Birds are BoidSceneNodes under the
// scene's `boids` group.
//
// BIRD MODEL (low poly, built from util/mesh_generators.js, meshes shared by every bird):
//   bird (BoidSceneNode, chest sphere)
//     model (PivotNode, fixed 90 deg turn so the model frame below matches the Euler math)
//       rear sphere, head sphere, beak cone, tail pyramid
//       wing pivot R / wing pivot L (PivotNodes at the shoulders), each with a flat cube wing
// model frame: +x = bird's right, +y = nose, +z = up. wings flap by rotating the pivots about y.
//
// A shot bird switches to "falling": wings fold, it drops, spins and shrinks for FALL_SECONDS,
// then is removed. When no birds are left a new wave spawns after a short pause.

import * as SceneBuilder from "../util/scene_graph.js";
import * as MeshBuilder from "../util/mesh_generators.js";
import { translate, rotate, scale, matMul } from "../util/transitions.js";
import { BoidSceneNode } from "./boid_scene_node.js";

export const WAVE_SIZE = 20;
const FALL_SECONDS = 0.8;
const NEXT_WAVE_DELAY = 1.5;
const BIRD_SCALE = [0.9, 0.9, 0.9]; // uniform: the model is ~2.3 long, 2 wide (wings out) before this
const BODY_CENTER = -0.2;           // local y of the middle of the whole bird (chest at 0, tail at -1.3)
const HIT_RADIUS = 1.0;             // bounding sphere around the middle of the bird
const FALL_GRAVITY = 14;
const WING_FOLD = 1.2;              // wing angle (radians, down) when shot

// colour variants: [body, head, beak, wing, tail]
const PALETTES = [
  [[0.45, 0.32, 0.18], [0.10, 0.45, 0.20], [0.95, 0.60, 0.10], [0.30, 0.22, 0.12], [0.20, 0.15, 0.10]], // mallard
  [[0.80, 0.80, 0.78], [0.25, 0.30, 0.40], [0.95, 0.50, 0.10], [0.55, 0.55, 0.55], [0.35, 0.35, 0.35]], // grey/white
  [[0.20, 0.20, 0.25], [0.15, 0.20, 0.40], [0.90, 0.80, 0.15], [0.12, 0.12, 0.16], [0.10, 0.10, 0.12]], // dark
];

const rand = (a, b) => a + Math.random() * (b - a);

/**
 * mesh-less transform node (a pivot / grouping node that is not drawn but, unlike
 * GroupSceneNode, keeps its position / rotation / scale).
 */
class PivotNode extends SceneBuilder.GroupSceneNode {
  update_transformation_matrix(M_parent) {
    this.transformation_matrix = matMul(M_parent, matMul(translate(this.position), rotate(this.rotation), scale(this.scale)));
  } // end function
} // end class

export class BirdFlock {
  /**
   * group -> the GroupSceneNode the bird nodes live under
   * gl    -> the GL context; the shared bird meshes and materials are built here, once
   */
  constructor(group, gl) {
    this.group = group;
    this.build_assets(gl);
    this.birds = [];       // every bird node still in the scene (alive or falling)
    this.wave = 0;
    this.wave_wait = 0;    // seconds the field has been empty
    this.next_id = 0;
    this.ground_y = 0;
  } // end constructor

  /** shared meshes (low-poly resolutions) and one material set per colour variant. */
  build_assets(gl) {
    const mk = (m) => new SceneBuilder.Mesh(gl, m);
    this.meshes = {
      sphere: mk(MeshBuilder.gen_sphere_mesh(0.5, 0.6, 0.6)),   // radius 0.5
      cone: mk(MeshBuilder.gen_cone_mesh(0.5, 0.8, 0.5)),       // base at origin, tip at +y, 1 tall
      pyramid: mk(MeshBuilder.gen_pyramid_mesh()),              // base at origin, apex at +y
      cube: mk(MeshBuilder.gen_cube_mesh()),                    // [-1, 1]
    };
    const mat = (c) => new SceneBuilder.Material({
      ka: c.map((v) => v * 0.45), kd: c, ks: [0.1, 0.1, 0.1], shininess: 8, transparency: 1.0,
    });
    this.palettes = PALETTES.map((p) => ({ body: mat(p[0]), head: mat(p[1]), beak: mat(p[2]), wing: mat(p[3]), tail: mat(p[4]) }));
  } // end function

  /** a plain drawn child node. */
  part(mesh, material, position, scl, rot = [0, 0, 0]) {
    const n = new SceneBuilder.SceneNode(null, "phong_basic");
    n.set_mesh(mesh).set_material(material);
    n.position = position;
    n.scale = scl;
    n.rotation = rot;
    return n;
  } // end function

  /** build one bird: chest on the BoidSceneNode, everything else as children. */
  build_bird(id) {
    const r = Math.random();
    const pal = this.palettes[r < 0.55 ? 0 : r < 0.8 ? 1 : 2];
    const m = this.meshes;

    const bird = new BoidSceneNode(id, "phong_basic");
    bird.init(m.sphere, pal.body, null); // chest: radius 0.5 at the origin

    const model = new PivotNode();
    model.rotation = [0, Math.PI / 2, 0]; // model +x (right) -> root -z, model +z (up) -> root +x
    bird.add_child(model);

    model.add_child(this.part(m.sphere, pal.body, [0, -0.5, 0.02], [0.85, 1.0, 0.8]));            // rear body
    model.add_child(this.part(m.sphere, pal.head, [0, 0.55, 0.18], [0.5, 0.5, 0.5]));             // head (radius 0.25)
    model.add_child(this.part(m.cone, pal.beak, [0, 0.72, 0.16], [0.2, 0.4, 0.12]));              // beak, tip forward
    model.add_child(this.part(m.pyramid, pal.tail, [0, -0.85, 0.05], [0.28, 0.5, 0.08], [Math.PI, 0, 0])); // tail, apex backward

    bird.wings = [];
    for (const side of [1, -1]) { // +1 right wing, -1 left wing
      const pivot = new PivotNode();
      pivot.position = [side * 0.3, 0.05, 0.12]; // shoulder
      pivot.add_child(this.part(m.cube, pal.wing, [side * 0.5, 0, 0], [0.5, 0.22, 0.03])); // 1.0 long, 0.44 chord
      model.add_child(pivot);
      bird.wings.push({ pivot, side });
    } // end loop
    return bird;
  } // end function

  /** wing angle in radians, positive = down. */
  set_wings(bird, angle) {
    for (const w of bird.wings) w.pivot.rotation = [0, w.side * angle, 0];
  } // end function

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
      const bird = this.build_bird(`bird${this.next_id++}`);
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
      bird.flap_t = rand(0, Math.PI * 2);
      bird.flap_rate = rand(9, 13); // radians per second
      this.pick_target(bird, center);
      this.point_along_velocity(bird);
      this.set_wings(bird, 0);
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
   * orient the bird: nose (+y) along the velocity, belly down. The root frame is
   * x = up, y = nose f, z = up x f (left). With rotate() = Rz * Ry * Rx those are the columns of
   * the rotation matrix, so: ry = asin(-R20), rx = atan2(R21, R22), rz = atan2(R10, R00).
   * (x = up keeps the gimbal lock to straight-up / straight-down flight only.)
   */
  point_along_velocity(bird) {
    const [vx, vy, vz] = bird.velocity;
    const len = Math.hypot(vx, vy, vz) || 1;
    const f = [vx / len, vy / len, vz / len];
    bird.axis = f;
    let right = [-f[2], 0, f[0]];                    // f x worldUp
    const n = Math.hypot(right[0], right[2]);
    right = n < 1e-4 ? [1, 0, 0] : [right[0] / n, 0, right[2] / n];
    const up = [                                      // right x f
      right[1] * f[2] - right[2] * f[1],
      right[2] * f[0] - right[0] * f[2],
      right[0] * f[1] - right[1] * f[0],
    ];
    const left2 = -right[2];                          // z column, row 2
    bird.rotation = [
      Math.atan2(f[2], left2),
      Math.asin(Math.max(-1, Math.min(1, -up[2]))),
      Math.atan2(up[1], up[0]),
    ];
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

    // flap: angle swings between about 0.55 up and 0.85 down
    bird.flap_t += bird.flap_rate * dt;
    this.set_wings(bird, 0.15 + 0.7 * Math.sin(bird.flap_t));
  } // end function

  update_falling(bird, dt) {
    bird.fall_t += dt;
    bird.velocity[1] -= FALL_GRAVITY * dt;
    for (let i = 0; i < 3; i++) bird.position[i] += bird.velocity[i] * dt;
    bird.rotation[2] += 9 * dt; // tumble
    this.set_wings(bird, WING_FOLD); // wings fold, no more flapping

    // shrink to nothing. (scale() treats 0 as "no scale", so stay slightly above it)
    const s = Math.max(0.02, 1 - bird.fall_t / FALL_SECONDS);
    bird.scale = BIRD_SCALE.map((v) => v * s);

    if (bird.fall_t >= FALL_SECONDS || bird.position[1] <= this.ground_y) {
      this.group.remove_child(bird);
      this.birds = this.birds.filter((b) => b !== bird);
    } // end if
  } // end function

  /** world position of the middle of the bird (the root pivot is the chest, the body trails behind it). */
  center_of(bird) {
    const h = BODY_CENTER * BIRD_SCALE[1];
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
