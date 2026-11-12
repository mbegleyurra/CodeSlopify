import * as SceneBuilder from "../util/scene_graph.js";
import { perspective, mat4Identity, ortho, matMul, translate, rotate, scale, mat4FromRows } from '../util/transitions.js';


/**
 * this is basically the body of the boid. you could add wings as children
 * or something (BoidWingSceneNode, for example), but this would be the base. 
 * this is what should get the flocking information from the C code:
 * idx, position, velocity, acceleration, etc. 
 */
export class BoidSceneNode extends SceneBuilder.SceneNode {
  constructor(id=null, shader_id="phong_basic") {
    super(id, shader_id); // takes care of some baseline stuff for now.
    // these are the hooks specific to the boid.
    // default super call sets up: this.position = [0, 0, 0]
    this.idx = null; // or this.idx = atoi(id), know what i mean?
    this.velocity = [0, 0, 0];
    this.acceleration = [0, 0, 0];
  } // end constructor
  
  /**
   * --------------------------------------
   * functions
   * --------------------------------------
   */

  /**
   * change however you deem fit. can also set up a hierarchy here for wings or
   * WHATEVER. this is an arbitrary function, main point is to init the node
   * with a mesh, material, texture at SOME point.
   */
  init(mesh, material, texture) {
    // set my mesh and material.
    this.set_mesh(mesh).set_material(material).set_texture(texture);
  } // end function

  /**
   * update my transformation dumbly, simply calculate:
   * M_world_child = M_world_parent * M_local_child.
   * if want to change, extend the SceneNode and override, but you MUST
   * set the transformation_matrix, otherwise nothing will happen/
   * incorrect renderiing.
   */
  update_transformation_matrix(M_parent) {
    // change any trajectory via this.
    // this is where you could have conditional
    // "if velocity is -x do this kind of rotation"
    // sort of things. 
    const translation = translate(this.position);
    const rotation = rotate(this.rotation);
    const scale_mtx = scale(this.scale);

    // my local transformations
    const M_local = matMul(translation, rotation, scale_mtx);

    // add my transformations to the world's
    this.transformation_matrix = matMul(M_parent, M_local);
  } // end function

} // end class