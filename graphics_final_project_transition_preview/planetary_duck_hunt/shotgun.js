// FPS PREVIEW: this whole file is new.
//
// The first-person shotgun viewmodel, built from the existing mesh generators only
// (cylinders for barrel / magazine tube / pump, cubes for receiver / stock / grip).
//
// How it stays on the camera: the parts hang under one root node that EarthScene.render() re-places
// every frame at the camera's eye + a lower-right offset, rotated with the view. How it draws on
// top without depth fights: the parts use the "phong_viewmodel" shader, which clears the depth
// buffer before the first part, so the gun never sinks into the ground or a bird.
// The shotgun root must be added to the scene LAST (after every world node).
//
// Firing: fire() starts a recoil kick, then a pump slide, and blocks the next shot for PUMP_DELAY.
// It also pops a muzzle flash: a small star of unlit cones at the barrel tip (see FLASH_TIME).

import * as SceneBuilder from "../util/scene_graph.js";
import * as MeshBuilder from "../util/mesh_generators.js";
import { matMul, translate, rotate, scale } from "../util/transitions.js";
import { camera_basis } from "./fps_player.js";

export const PUMP_DELAY = 0.8; // seconds between shots

const OFFSET = [0.17, -0.16, -0.42]; // gun origin in camera space (right, up, forward is -z)

const FLASH_TIME = 0.075;            // seconds the muzzle flash stays on screen
const FLASH_SPIKES = 5;              // side spikes around the central jet
const MUZZLE = [0, 0.02, -0.92];     // gun space: just past the barrel tip (barrel: z = -0.05 to -0.90)

/**
 * a group node that DOES apply its own position / rotation (GroupSceneNode ignores them),
 * so the whole gun can be moved as one. group nodes are never drawn.
 */
class ViewModelRoot extends SceneBuilder.GroupSceneNode {
  update_transformation_matrix(M_parent) {
    const M_local = matMul(translate(this.position), rotate(this.rotation));
    this.transformation_matrix = matMul(M_parent, M_local);
  } // end function
} // end class

export class Shotgun {
  constructor(gl) {
    this.since_fire = PUMP_DELAY; // seconds since the last shot (starts ready)
    this.root = new ViewModelRoot();

    const dark = [0.14, 0.14, 0.16];
    const wood = [0.5, 0.3, 0.15];
    const cyl = (color) => new SceneBuilder.Mesh(gl, MeshBuilder.gen_cylinder_mesh(1, 0.4, 1, color)); // 16 sides: low poly on purpose
    const cube = (color) => new SceneBuilder.Mesh(gl, MeshBuilder.gen_cube_mesh(color));
    this.material = new SceneBuilder.Material({
      ka: [0.35, 0.35, 0.35], kd: [0.8, 0.8, 0.8], ks: [0.35, 0.35, 0.35], shininess: 24, transparency: 1
    });
    this.base_ka = this.material.ka; // restored when the flash ends

    // gun space: the muzzle points down -z, +x is right, +y is up. a cylinder grows along +y, so
    // rotating it by -90 degrees about x lays it along -z (starting at its position).
    const LAY = [-Math.PI / 2, 0, 0];
    this.LAY = LAY;
    this.barrel = this.add_part(cyl(dark), [0, 0.02, -0.05], LAY, [0.022, 0.85, 0.022]);
    this.barrel.clear_depth = true; // first part drawn: wipes the depth buffer (see phong_viewmodel)
    this.add_part(cyl(dark), [0, -0.035, -0.05], LAY, [0.017, 0.7, 0.017]);        // magazine tube
    this.pump = this.add_part(cyl(wood), [0, -0.035, -0.3], LAY, [0.03, 0.26, 0.03]); // slides on fire
    this.add_part(cube(dark), [0, -0.005, 0.06], [0, 0, 0], [0.03, 0.045, 0.11]);     // receiver
    this.add_part(cube(wood), [0, -0.05, 0.33], [0.12, 0, 0], [0.025, 0.045, 0.18]);  // stock
    this.add_part(cube(wood), [0, -0.09, 0.14], [0, 0, 0], [0.02, 0.05, 0.025]);      // grip

    // muzzle flash: unlit cones (5 sides, low poly) at the barrel tip. they are added AFTER the barrel,
    // so the barrel's depth clear still runs first. a cone grows along +y with its base at the node
    // position: the core is laid along -z (a jet out of the barrel), the spikes turn about z (a star
    // around the barrel). every shot re-rolls roll / size / lengths (see roll_flash).
    const cone = (color) => new SceneBuilder.Mesh(gl, MeshBuilder.gen_cone_mesh(1, 1.2, 1, color));
    this.flash_core = this.add_flash_part(cone([1.0, 0.95, 0.65])); // hot yellow-white
    this.flash_spikes = [];
    for (let i = 0; i < FLASH_SPIKES; i++) {
      this.flash_spikes.push(this.add_flash_part(cone([1.0, 0.5, 0.1]))); // orange
    } // end loop
    this.roll_flash();
    this.update_flash(); // starts hidden: since_fire is already past FLASH_TIME
  } // end constructor

  add_part(mesh, position, rotation, size) {
    const node = new SceneBuilder.SceneNode("shotgun_part", "phong_viewmodel");
    node.set_mesh(mesh).set_material(this.material);
    node.position = position;
    node.rotation = rotation;
    node.scale = size;
    this.root.add_child(node);
    return node;
  } // end function

  /** a muzzle flash piece: drawn by the unlit "shotgun_flash" shader, and only while flash_visible is true. */
  add_flash_part(mesh) {
    const node = new SceneBuilder.SceneNode("shotgun_flash", "shotgun_flash");
    node.set_mesh(mesh);
    node.position = MUZZLE;
    node.flash_visible = false;
    this.root.add_child(node);
    return node;
  } // end function

  reset() {
    this.since_fire = PUMP_DELAY;
  } // end function

  can_fire() {
    return this.since_fire >= PUMP_DELAY;
  } // end function

  fire() {
    this.since_fire = 0;
    this.roll_flash();
  } // end function

  /** pick a fresh look for this shot's flash so no two shots are identical. */
  roll_flash() {
    this.flash_roll = Math.random() * Math.PI * 2;          // spin of the star around the barrel
    this.flash_size = 0.75 + Math.random() * 0.6;           // overall scale
    this.flash_core_len = 0.12 + Math.random() * 0.1;       // length of the central jet
    this.flash_lengths = this.flash_spikes.map(() => 0.07 + Math.random() * 0.08); // each spike
  } // end function

  /**
   * show the flash for FLASH_TIME after a shot, shrinking as it fades, and warm the gun's ambient
   * light while it is up (the scene's lights only have a position, so there is no light to brighten).
   */
  update_flash() {
    const f = Math.max(0, 1 - this.since_fire / FLASH_TIME); // 1 right at the shot, 0 when over
    const on = f > 0;
    const k = this.flash_size * (0.5 + 0.5 * f);

    this.flash_core.flash_visible = on;
    this.flash_core.rotation = this.LAY;
    this.flash_core.scale = [0.03 * k, this.flash_core_len * k, 0.03 * k];

    this.flash_spikes.forEach((spike, i) => {
      spike.flash_visible = on;
      spike.rotation = [0, 0, this.flash_roll + (i * Math.PI * 2) / FLASH_SPIKES];
      spike.scale = [0.022 * k, this.flash_lengths[i] * k, 0.022 * k];
    });

    const [r, g, b] = this.base_ka;
    this.material.ka = on ? [r + 0.55 * f, g + 0.4 * f, b + 0.15 * f] : this.base_ka;
  } // end function

  /**
   * advance the animation and re-attach the gun to the camera.
   * eye -> camera position, yaw / pitch -> its angles, bob -> walking phase (radians)
   */
  update(dt, eye, yaw, pitch, bob = 0) {
    this.since_fire += dt;
    const t = this.since_fire;

    // recoil: fast kick back and up that decays; pump: slides toward the player and returns.
    const kick = t < 0.6 ? Math.exp(-t * 12) : 0;
    const u = Math.min(1, Math.max(0, (t - 0.25) / 0.45));
    this.pump.position = [0, -0.035, -0.3 + 0.12 * Math.sin(Math.PI * u)];
    this.update_flash();

    const ox = OFFSET[0] + Math.sin(bob * 0.5) * 0.004;
    const oy = OFFSET[1] + Math.abs(Math.sin(bob)) * 0.006;
    const oz = OFFSET[2] + kick * 0.07;

    // camera space (ox, oy, oz) -> world: right * ox + up * oy + (-fwd) * oz
    const { right, up, fwd } = camera_basis(yaw, pitch);
    this.root.position = [
      eye[0] + right[0] * ox + up[0] * oy - fwd[0] * oz,
      eye[1] + right[1] * ox + up[1] * oy - fwd[1] * oz,
      eye[2] + right[2] * ox + up[2] * oy - fwd[2] * oz
    ];
    // same angles as the camera, plus the kick, and a small turn so the muzzle points at the crosshair
    this.root.rotation = [pitch + kick * 0.1, yaw + 0.05, 0];
  } // end function

} // end class
