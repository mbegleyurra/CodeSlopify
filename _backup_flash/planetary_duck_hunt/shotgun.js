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

import * as SceneBuilder from "../util/scene_graph.js";
import * as MeshBuilder from "../util/mesh_generators.js";
import { matMul, translate, rotate, scale } from "../util/transitions.js";
import { camera_basis } from "./fps_player.js";

export const PUMP_DELAY = 0.8; // seconds between shots

const OFFSET = [0.17, -0.16, -0.42]; // gun origin in camera space (right, up, forward is -z)

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

    // gun space: the muzzle points down -z, +x is right, +y is up. a cylinder grows along +y, so
    // rotating it by -90 degrees about x lays it along -z (starting at its position).
    const LAY = [-Math.PI / 2, 0, 0];
    this.barrel = this.add_part(cyl(dark), [0, 0.02, -0.05], LAY, [0.022, 0.85, 0.022]);
    this.barrel.clear_depth = true; // first part drawn: wipes the depth buffer (see phong_viewmodel)
    this.add_part(cyl(dark), [0, -0.035, -0.05], LAY, [0.017, 0.7, 0.017]);        // magazine tube
    this.pump = this.add_part(cyl(wood), [0, -0.035, -0.3], LAY, [0.03, 0.26, 0.03]); // slides on fire
    this.add_part(cube(dark), [0, -0.005, 0.06], [0, 0, 0], [0.03, 0.045, 0.11]);     // receiver
    this.add_part(cube(wood), [0, -0.05, 0.33], [0.12, 0, 0], [0.025, 0.045, 0.18]);  // stock
    this.add_part(cube(wood), [0, -0.09, 0.14], [0, 0, 0], [0.02, 0.05, 0.025]);      // grip
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

  reset() {
    this.since_fire = PUMP_DELAY;
  } // end function

  can_fire() {
    return this.since_fire >= PUMP_DELAY;
  } // end function

  fire() {
    this.since_fire = 0;
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
