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
import { get_bird_theme } from "./bird_themes.js";

export const WAVE_SIZE = 20;
const FALL_SECONDS = 0.8;
const NEXT_WAVE_DELAY = 1.5;
const FALL_GRAVITY = 14;
const WING_FOLD = 1.2;              // wing angle (radians, down) when shot
// Per-planet look, scale, hit radius and hit centre come from bird_themes.js (set_planet below).
// Every bird stores its own base_scale / hit_radius / body_center, copied from its theme at spawn.

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
  constructor(group, gl, planet = "earth") {
    this.group = group;
    this.build_assets(gl);
    this.materials = {};   // theme key -> one material set per palette (built on first use)
    this.theme = get_bird_theme(planet);
    this.birds = [];       // every bird node still in the scene (alive or falling)
    this.wave = 0;
    this.wave_wait = 0;    // seconds the field has been empty
    this.next_id = 0;
    this.ground_y = 0;
  } // end constructor

  /** pick the bird theme for a planet name ("Mars", any case). Applies to birds spawned from now on. */
  set_planet(name) {
    this.theme = get_bird_theme(name);
  } // end function

  /** shared meshes (low-poly resolutions); the materials are per theme, see materials_for(). */
  build_assets(gl) {
    const mk = (m) => new SceneBuilder.Mesh(gl, m);
    this.meshes = {
      sphere: mk(MeshBuilder.gen_sphere_mesh(0.5, 0.6, 0.6)),   // radius 0.5
      cone: mk(MeshBuilder.gen_cone_mesh(0.5, 0.8, 0.5)),       // base at origin, tip at +y, 1 tall
      pyramid: mk(MeshBuilder.gen_pyramid_mesh()),              // base at origin, apex at +y
      cube: mk(MeshBuilder.gen_cube_mesh()),                    // [-1, 1]
    };
  } // end function

  /** material sets (body, head, beak, wing, tail, accent) for each palette of a theme, cached. */
  materials_for(theme) {
    if (!this.materials[theme.key]) {
      const mat = (c) => new SceneBuilder.Material({
        ka: c.map((v) => v * theme.ambient), kd: c, ks: Array(3).fill(theme.specular), shininess: theme.shininess, transparency: 1.0,
      });
      this.materials[theme.key] = theme.palettes.map((p) => {
        const [body, head, beak, wing, tail, accent] = p.c;
        return { body: mat(body), head: mat(head), beak: mat(beak), wing: mat(wing), tail: mat(tail), accent: mat(accent) };
      });
    } // end if
    return this.materials[theme.key];
  } // end function

  /** weighted random palette index of a theme. */
  pick_palette(theme) {
    let r = Math.random() * theme.palettes.reduce((s, p) => s + p.w, 0);
    for (let i = 0; i < theme.palettes.length; i++) {
      r -= theme.palettes[i].w;
      if (r <= 0) return i;
    } // end loop
    return theme.palettes.length - 1;
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
    const theme = this.theme;
    const pal = this.materials_for(theme)[this.pick_palette(theme)];
    const m = this.meshes;

    const bird = new BoidSceneNode(id, "phong_basic");
    bird.init(m.sphere, pal.body, null); // chest: radius 0.5 at the origin
    bird.base_scale = [theme.scale, theme.scale, theme.scale];
    bird.hit_radius = theme.hit_radius;
    bird.body_center = theme.body_center;

    const model = new PivotNode();
    model.rotation = [0, Math.PI / 2, 0]; // model +x (right) -> root -z, model +z (up) -> root +x
    bird.add_child(model);

    for (const spec of theme.parts) {
      model.add_child(this.part(m[spec.mesh], pal[spec.mat], spec.pos, spec.scl, spec.rot));
      if (spec.mirror) { // x-mirrored copy
        model.add_child(this.part(m[spec.mesh], pal[spec.mat], [-spec.pos[0], spec.pos[1], spec.pos[2]], spec.scl, [spec.rot[0], -spec.rot[1], -spec.rot[2]]));
      } // end if
    } // end loop

    bird.wings = [];
    for (const spec of theme.wings) {
      for (const side of [1, -1]) { // +1 right wing, -1 left wing
        const pivot = new PivotNode();
        pivot.position = [side * spec.shoulder[0], spec.shoulder[1], spec.shoulder[2]];
        // panel wings sit beside the shoulder; blade wings (cone / pyramid) point out along +-x from it
        const wing = spec.blade
          ? this.part(m[spec.mesh], pal[spec.mat], [0, 0, 0], spec.scl, [0, 0, -side * Math.PI / 2])
          : this.part(m[spec.mesh], pal[spec.mat], [side * spec.scl[0], 0, 0], spec.scl);
        pivot.add_child(wing);
        model.add_child(pivot);
        bird.wings.push({ pivot, side, amp: spec.amp });
      } // end loop
    } // end loop
    return bird;
  } // end function

  /** wing angle in radians, positive = down. */
  set_wings(bird, angle) {
    for (const w of bird.wings) w.pivot.rotation = [0, w.side * angle * w.amp, 0];
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
      bird.scale = [...bird.base_scale];
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
    bird.scale = bird.base_scale.map((v) => v * s);

    if (bird.fall_t >= FALL_SECONDS || bird.position[1] <= this.ground_y) {
      this.group.remove_child(bird);
      this.birds = this.birds.filter((b) => b !== bird);
    } // end if
  } // end function

  /** world position of the middle of the bird (the root pivot is the chest, the body trails behind it). */
  center_of(bird) {
    const h = bird.body_center * bird.base_scale[1];
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
      const hr2 = bird.hit_radius * bird.hit_radius;
      if (d2 > hr2) continue;
      const t = tca - Math.sqrt(hr2 - d2);
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
