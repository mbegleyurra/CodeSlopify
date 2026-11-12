import * as SceneBuilder from "../util/scene_graph.js";
import { mat4Identity, matMul, translate, rotate, scale, mat4FromRows } from '../util/transitions.js';

/**
 * just a small wrapper
 */
export class PlanetData {
  constructor({
    name="Mercury", 
    radius_km=2439.7,  
    distance_km=57909227,   
    color=[0.651, 0.557, 0.380], 
    orbit_period=88, 
    texture_path="./outer_world/textures/mercury.jpg"
    }={}
  ) {
    this.name = name;
    this.radius_km = radius_km;
    this.distance_km = distance_km;
    this.color = color;
    this.orbit_period = orbit_period;
    this.texture_path = texture_path;
  }
} // end class

/**
 * a little planet scene node at a baseline
 */
export class PlanetSceneNode extends SceneBuilder.SceneNode {
  constructor(id="planet", shader_id="planet_basic", data=null) {
    super(id, shader_id); // takes care of some baseline stuff for now.

    // default super call sets up: this.position = [0, 0, 0]
    this.orbit_rotation = [0, 0, 0]; // special for rotation around sun.

    this.data = data; // grab the general data pack.
    // this.delta_time = 0; // time since last frame
    this.display_distance = 0; // distance from the sun, normalized for viewing.
    this.radius_distance = 0; // the radius of this planet, normalized for viewing.
  } // end constructor

  /**
   * access point to give the day and therefore update the orbit_rotation
   * amount.
   */
  update_orbit(day=0) {
    const angle = (day / this.data.orbit_period) * 2 * Math.PI;
    this.orbit_rotation = [0, angle, 0]; // y rotation around the sun
  } // end function 

  /**
   * update my transformation dumbly, simply calculate:
   * M_world_child = M_world_parent * M_local_child.
   * if want to change, extend the SceneNode and override, but you MUST
   * set the transformation_matrix, otherwise nothing will happen/
   * incorrect rendering.
   */
  update_transformation_matrix(M_parent) {
    // change any trajectory via this.
    this.position = [this.display_distance, 0, this.display_distance]; // be sure to update this by scene init
    // NOTE: this is done because the initial planet mesh has a radius 1.
    // so, scaling all points down by display radius is equivalent to shrinking the radius
    // to that number.
    this.scale = [this.display_radius, this.display_radius, this.display_radius]; // scale by norm radius for now

    const rotation_orbit = rotate(this.orbit_rotation); // the rotation around the sun
    const translation = translate(this.position); // my position relative to the sun as origin
    const rotation_axis = rotate(this.rotation); // my rotation on my axis
    const scale_mtx = scale(this.scale); // any scaling (TODO: size based on radius)

    // my local transformations
    const M_local = matMul(rotation_orbit, translation, rotation_axis, scale_mtx);

    // add my transformations to the world's
    this.transformation_matrix = matMul(M_parent, M_local);
  } // end function
  
} // end class

export class SunSceneNode extends SceneBuilder.SceneNode {
  constructor(id="sun", shader_id="planet_basic", data=null) {
    super(id, shader_id); // takes care of some baseline stuff for now.
    this.data = data; // can hand off a data pack as well
    this.position = [0, 0, -30]; // shove her back
  } // end constructor
} // end class

/**
 * just placing these constants here.
 */
export const SUN_DATA = {
  sun: new PlanetData({name: "Sun", radius_km: 695700, distance_km: null, color: [0.949, 0.686, 0.169], orbit_period: null, texture_path: "./outer_world/textures/sun.mp4"})
};

export const PLANET_DATA = {
  mercury: new PlanetData({name: "Mercury", radius_km: 2439.7, distance_km: 57909227, color: [0.651, 0.557, 0.380], orbit_period: 88, texture_path: "./outer_world/textures/mercury.jpg"}),
  venus: new PlanetData({name: "Venus", radius_km: 6051.8, distance_km: 108209475, color: [0.922, 0.651, 0.545], orbit_period: 224.7, texture_path: "./outer_world/textures/venus.jpg"}),
  earth: new PlanetData({name: "Earth",   radius_km: 6371.0,  distance_km: 149598262,  color: [0.404, 0.804, 0.890], orbit_period: 365.2, texture_path: "./outer_world/textures/earth.jpg"}),
  mars: new PlanetData({name: "Mars",    radius_km: 3389.5,  distance_km: 227943824,  color: [0.812, 0.176, 0.114], orbit_period: 687, texture_path: "./outer_world/textures/mars.jpg"}),
  jupiter: new PlanetData({name: "Jupiter", radius_km: 69911,   distance_km: 778340821,  color: [0.878, 0.875, 0.761], orbit_period: 4331, texture_path: "./outer_world/textures/jupiter.jpg"}),
  saturn: new PlanetData({name: "Saturn",  radius_km: 58232,   distance_km: 1426666422, color: [0.902, 0.882, 0.604], orbit_period: 10747, texture_path: "./outer_world/textures/saturn.jpg"}),
  uranus: new PlanetData({name: "Uranus",  radius_km: 25362,   distance_km: 2870658186, color: [0.443, 0.694, 0.780], orbit_period: 30589, texture_path: "./outer_world/textures/uranus.jpg"}),
  neptune: new PlanetData({name: "Neptune", radius_km: 24622,   distance_km: 4498396441, color: [0.196, 0.376, 0.439], orbit_period: 59800, texture_path: "./outer_world/textures/neptune.jpg"})
};