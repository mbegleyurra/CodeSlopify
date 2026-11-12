import { perspective, mat4Identity, ortho, matMul, translate, rotate, scale, mat4FromRows, lookAt } from './transitions.js'; // TRANSITION PREVIEW: added lookAt
import { SHADER_MAP } from './shaders.js';

/**
 * ==============================================
 * SCENE SETUP
 * ==============================================
 */

/**
 * complete rework of api given the additions of 
 * materials, lighting, etc. 
 */

export class Scene {

  /**
   * --------------------------------------
   * constructor
   * --------------------------------------
   */
  constructor() {
    this.roots = []; // root objects in the scene.
    this.lights = []; // generally: lights in the scene. can be any kind of light.
    this.camera = null; // camera, meaning more specifically the perspective used.
    this.renderer = null; // scene will have a reference to the renderer made.
    this.initialized = false; // in case a flag is useful in transitioning.
  }

  /**
   * --------------------------------------
   * functions
   * --------------------------------------
   */

  /**
   * empty at parent level, but to be customized on
   * child inheriting classes. provided as a base signature.
   * this is not called in cosntructor on PURPOSE in case you want to create
   * a scene for use without loading up a bunch of stuff 
   * until it will actually be used (boids in mind :) )
   */
  init(renderer=null) {
    this.renderer = renderer;
    this.initialized = true; // control if you want to not call this again in render.
    // to implement further in children.
  } // end function

  render(clear_color=[0.2, 0.2, 0.2]) {
    // yada yada, do whatever the scene needs at a child level to do at a global scale,
    // such as run collision detection with player, did i hit a boid, etc.
    // then, let dummy take over:
    if (this.renderer) {
      this.renderer.draw(this, clear_color);
    } // end if
  } // end function

  /**
   * add an object to the scene.
   */
  add_node(node) {
    if (!node) return;

    node.parent = null; // ensure a null parent

    this.roots.push(node); // poosh to the roots
    return node; // return ref if needed.
  } // end function

  /**
   * remove an object from the scene.
   */
  remove_node(node) {
    this.roots = this.roots.filter(n => n !== node);
  } // end function

  /**
   * add a light to the scene that will 
   * affect all objects in the scene.
   */
  add_light(light) {
    this.lights.push(light);
    return light;
  } // end function

  /**
   * remove the light from the scene.
   */
  remove_light(light) {
    this.lights = this.lights.filter(l => l !== light);
  } // end function

  /**
   * set a specific camera to the scene.
   * this is meaning PERSPECTIVE.
   */
  set_camera(camera) {
    this.camera = camera;
  } // end function

} // end class

/**
 * a node on the scene. this 
 */
export class SceneNode {

  /**
   * --------------------------------------
   * constructor
   * --------------------------------------
   */
  constructor(id=null, shader_id="phong_basic") {
    this.id = id; // specifying id

    this.parent = null; // parent of this node, null to start
    this.children = []; // all children of this node

    this.mesh = null; // mesh of the node, encompassing vertices, index mapping, norms, etc...
    this.material = null; // material of this node (ka, kd, ...)
    this.texture = null; // texture specific to the node; then mesh's can be reused.

    this.shader_id = shader_id; // id corresponding to the shader i want to use for this node.

    // pretty much everything can be described as a translation (position)
    // rotation, and scale. may include reflect/skew later. (TODO)
    this.position = [0, 0, 0];
    this.rotation = [0, 0, 0];
    this.scale = [1, 1, 1];
    // the final transformation matrix (single matrix) to return.
    // it's more calculation on the cpu, but easier to manage.
    // @Theo may be a place for C if things are chuggy.
    this.transformation_matrix = mat4Identity();

  } // end constructor

  /**
   * --------------------------------------
   * functions
   * --------------------------------------
   */

  /**
   * update my transformation dumbly, simply calculate:
   * M_world_child = M_world_parent * M_local_child.
   * if want to change, extend the SceneNode and override, but you MUST
   * set the transformation_matrix, otherwise nothing will happen/
   * incorrect renderiing.
   */
  update_transformation_matrix(M_parent) {
    // TODO: NEEDS TESTING!! there could be problems with column vects.
    const translation = translate(this.position);
    const rotation = rotate(this.rotation);
    const scale_mtx = scale(this.scale);

    // my local transformations
    const M_local = matMul(translation, rotation, scale_mtx);

    // add my transformations to the world's
    this.transformation_matrix = matMul(M_parent, M_local);
  } // end function

  /**
   * add a child to this node, creating a hierarchical relationship
   */
  add_child(child) {
    if (!child || child === this) {
      throw new Error("Invalid child node");
    } // end if

    child.parent = this; // set this node to the child's parent
    this.children.push(child); // track this child

    return child;
  } // end function

  /**
   * remove a specific child as a part of this hierarchy
   */
  remove_child(child) {
    this.children = this.children.filter(c => c !== child); // remove from my list

    if (child.parent === this) {
      child.parent = null; // null out the parent
    } // end if
  } // end function

  /**
   * set the mesh of this node
   */
  set_mesh(mesh) {
    this.mesh = mesh;
    return this;
  } // end function

  /**
   * set the mesh of this node
   */
  set_material(material) {
    this.material = material;
    return this;
  } // end function

  /**
   * given a path to a texture, create the texture 
   */
  set_texture(texture) {
    this.texture = texture;
    return this;
  } // end function

} // end class

/**
 * dummy scene node to help group together many root nodes as
 * a cohesive unit. instead of heaving 500000 boid root nodes in scene list, 
 * can group together as a group of boids under single cohesive root node
 * to enable some flexibility in removing nodes quicker than 
 * traversing things that aren't pertinent (did i shoot a boid? i don't need
 * to deal with everything on scene to remove, just the boids.)
 */
export class GroupSceneNode extends SceneNode {
  constructor() {
    super("grouper", ""); // construct with nothing. renderer will generally skip these.
  }

  /**
   * this here adds technically one extra bad computation, BUT
   * only for this node. a dummy identity is the transformation here.
   */
  update_transformation_matrix(M_parent) {
    // my local transformations
    const M_local = mat4Identity();

    // add my transformations to the world's
    this.transformation_matrix = matMul(M_parent, M_local);
  } // end function
} // end class

/**
 * ==============================================
 * MESH
 * 
 * how to draw the object
 * ==============================================
 */

/**
 * build a basic mesh, wrapping the bad dict roxanne
 * used before.
 * 
 * feel free to extend/override, but be sure to set
 * up the buffers here! that way this only happens once and
 * can be reused by many nodes if needed.
 */
export class Mesh {
  constructor(gl, {
    vertices,
    indices,
    colors=null,
    normals=null,
    tangents=null,
    texels=null,
    mapping=null
  }={}) {
    this.vertices = vertices;
    this.indices = indices;
    this.colors = colors;
    this.normals = normals;
    this.tangents = tangents;
    this.texels = texels;
    this.mapping = mapping;


    // initialize whatever we have into a grabable buffer
    if (vertices) {this.vert_buff = this.init_buffer(vertices, gl);} // TRANSITION PREVIEW: removed stray console.log
    if (indices) {this.ind_buff = this.init_buffer(indices, gl, gl.ELEMENT_ARRAY_BUFFER);}
    if (normals) {this.norm_buff = this.init_buffer(normals, gl);}
    if (colors) {this.color_buff = this.init_buffer(colors, gl);}
    if (tangents) {this.tangent_buff = this.init_buffer(tangents, gl);}
    if (texels) {this.tex_buff = this.init_buffer(texels, gl);}
  }

  /**
   * wrapper around the creation and binding of a buffer so no steps missed!
   */
  init_buffer(data, gl, type=gl.ARRAY_BUFFER, gl_hint=gl.STATIC_DRAW) {
      const buff = gl.createBuffer();
      gl.bindBuffer(type, buff);
      gl.bufferData(type, data, gl_hint);
      return buff
  } // end function

} // end class

/**
 * ==============================================
 * TEXTURE
 * 
 * Texture -> image textures
 * VideoTexture -> video textures
 * ==============================================
 */

/**
 * simple wrap around a texture so multiple nodes can
 * use the same mesh with different textures. 
 * avoids a lot of memory duplication.
 */
export class Texture {
  constructor(gl, path) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D, 
      0, 
      gl.RGBA, 
      1, 1, 0, 
      gl.RGBA, 
      gl.UNSIGNED_BYTE, 
      new Uint8Array([128, 128, 255, 255])
    );

    const image = new Image();
    image.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);  // images start at the top row, texture coordinates at the bottom
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    };
    image.src = path;
    this.texture_buff = texture;
  }

  /**
   * use this or texture.texture_buff, just added as a convenience func.
   */
  get_texture() {
    return this.texture_buff;
  } // end function

} // end class

/**
 * video texture that takes a path to a video and automatically
 * updates the texture every time the video changes frame 
 * via the callback requestVideoFrameCallback.
 * https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback
 */
export class VideoTexture {
  constructor(gl, path) {
    this.gl = gl; // need to cache gl for this texture since updates occur within the texture class.
    // note that if the gl context changes, anything using a video texture must update gl!

    // make a new video :)
    this.video = document.createElement("video");

    // set a couple parameters up to play
    this.video.playsInline = true; // for mobile at most, not needed for desktop browers. not tested on mobile atm.
    this.video.muted = true;
    this.video.loop = true;
    this.video.autoplay = true;
    this.video.src = path;

    // bind callback to this instance
    // js won't recognize "this" as being the texture once handed off.
    // have to bind so this == this texture instance.
    this.on_video_frame = this.on_video_frame.bind(this);

    
    // playyyy the video
    this.video.play().catch(err => {
        console.warn("Video playback failed:", err);
    });

    // wait for video to be ready before starting to load frames to buffers.
    this.video.addEventListener("loadeddata", () => {
      // create texture
        this.texture_buff = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.texture_buff);

        // init with placeholder
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          this.video.videoWidth,
          this.video.videoHeight,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          null
        );

        // param setting
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);  // images start at the top row, texture coordinates at the bottom
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); // clamp the wrap to edges of shape
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); // switching to linear for video to 
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); // avoid generating mipmap each frame change.

        this.video.requestVideoFrameCallback(
            this.on_video_frame
        );
      }, { once: true }
    ); // only call once, looping below takes over once playing.
  }

  /**
   * when video changes frame, this will get called automatically
   * and update the texture to this current frame.
   */
  on_video_frame(time, metadata) {
    // ensure to bind texture
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture_buff);
    
    // use the current frame of video as the image.
    // redefine the buffer, but don't reallocate to save on time.
    this.gl.texSubImage2D(
      this.gl.TEXTURE_2D,
      0,
      0,
      0,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      this.video
    );
  // } // end if
   

    // repeat this setting. if this is not reset on every call,
    // only the first frame wraps. resetting this enables the recall 
    // of this callback function on every frame change, completing the loop
    this.video.requestVideoFrameCallback(this.on_video_frame);
  } // end function

  /**
   * if gl context changes, this MUST be changed if using this
   * texture.
   * here's a simple access, or set via texture.gl, but be aware of this limitation if used!
   */
  update_gl(gl) {
    this.gl = gl;
  } // end function

  /**
   * use this or texture.texture_buff, just added as a convenience func.
   */
  get_texture() {
    return this.texture_buff;
  } // end function

} // end class

/**
 * ==============================================
 * MATERIAL
 * 
 * what material a node should look like.
 * ==============================================
 */

/**
 * wrap up a specific material in the most
 * general way possible.
 */
export class Material {
  constructor({
    color=[1, 1, 1], // usually comes from mesh, but can use this if for whatever reason needs it in the Shader
    ka=[0.2, 0.2, 0.2],
    kd=[0.8, 0.8, 0.8],
    ks=[0.5, 0.5, 0.5],
    shininess=32,
    transparency=1
  }={}) {
    this.color = new Float32Array(color);
    this.ka = new Float32Array(ka);
    this.kd = new Float32Array(kd);
    this.ks = new Float32Array(ks);
    this.shininess = shininess;
    this.transparency = transparency;
  } 
} // end class

/**
 * wrapper around's liz's specific wording
 * and things she needs for planet material stuff as
 * it currently stands.
 */
export class PlanetMaterial extends Material {
  constructor ({
    color=[1, 1, 1], // usually comes from mesh, but can use this if for whatever reason needs it in the Shader
    ka=0, 
    kd=0, 
    ks=0, 
    shininess=1, 
    metallic=0,
    emissive=0.45,
    flat=false,
    transparency=1
  }={}) {
    super({color, ka, kd, ks, shininess, transparency}); // init via super

    // custom things for planet materials
    this.metallic = metallic;
    this.emissive = emissive;
    this.flat = flat;
  }
} // end class

/**
 * ==============================================
 * LIGHT
 * ==============================================
 */

/**
 * a general light that can be extended out to other 
 * kinds. here is where you could extend and add things
 * like light attenuation, etc...
 */
export class Light {
  constructor ({
    color=[1, 1, 1]
  }={}) {
    this.color = color;
  }
} // end class

/**
 * a point light -- has a position and color at baseline
 */
export class PointLight extends Light {
  constructor ({
    position=[3, 4, 5],
    color=[1, 1, 1]
  }={}) {
    super({"color": color}); // pass on the color init
    this.position = position;
  }
} // end class

/**
 * placeholder really for clarity.
 * i have not personally done this, but putting in 
 * for liz's lighting specifications.
 * can be added to for generalization!
 */
export class DirectionalLight extends Light { 
  constructor ({
    color=[1, 1, 1]
  }={}) {
    super({"color": color}); // pass on the color init
  }
} // end class


// Light 1 — the Sun: a POINT light (w = 1) at the Sun's center.
// It's attached to the scene, so push its center through the Sun's
// TODO: override the position of this--see if that works
export class SunLight extends PointLight {
   constructor({
    position=[0, 0, 0],
    color=[1.0, 0.94, 0.82],
    intensity=1.2,
    falloff=0.008,
    on=true
  }={}) {
    super({"position": position, "color": color}); 
    this.intensity = intensity;
    this.falloff = falloff;
    this.on = on;
  }
} // end class

// Light 2 — fill: a DIRECTIONAL light (w = 0) given straight in eye
// space, so it's attached to the camera. Azimuth/elevation -> unit vector.
export class FillLight extends DirectionalLight {
  constructor({
    color=[0.55, 0.68, 1.0],
    azimuth=-40,
    elevation=30,
    intensity=0.2,
    on=true
  }={}) {
    super({"color": color});
    this.intensity = intensity;
    this.on = on;
    this.azimuth = azimuth;
    this.elevation = elevation;
    this.fill_dir = this.calc_fill_dir(); // if you don't change those values, can just use this
  }

  /**
   * convenience wrap of this math.
   */
  calc_fill_dir() {
    const az = this.azimuth * Math.PI / 180;
    const el = this.elevation * Math.PI / 180;
    return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
  } // end function
} // end class


/**
 * ==============================================
 * CAMERA
 * ==============================================
 */

export class Camera {
  constructor({
    fov=Math.PI / 4,
    near=0.1,
    far=100,
    aspect=1,
    ortho_size=2.5
  } = {}) {
    this.fov = fov;
    this.near = near;
    this.far = far;
    this.aspect = aspect;
    this.ortho_size = ortho_size

    // TRANSITION PREVIEW: optional look-at pose. null view_matrix = the old identity framing,
    // so scenes that never call set_look_at() render exactly as before.
    this.eye = [0, 0, 0];
    this.target = [0, 0, -1];
    this.view_matrix = null;
  }

  /**
   * TRANSITION PREVIEW: identity (the old placeholder) unless set_look_at() was called.
   */
  get_view_matrix() {
    return this.view_matrix || mat4Identity();
  }

  /**
   * TRANSITION PREVIEW: aim the camera from eye at target ([x, y, z] arrays).
   */
  set_look_at(eye, target, up=[0, 1, 0]) {
    this.eye = eye;
    this.target = target;
    this.view_matrix = lookAt(eye, target, up);
  }

  /**
   * TRANSITION PREVIEW: back to the default identity framing.
   */
  reset_view() {
    this.eye = [0, 0, 0];
    this.target = [0, 0, -1];
    this.view_matrix = null;
  }
} // end class

/**
 * split up the cameras this way. perspective camera.
 */
export class PerspectiveCamera extends Camera {
  get_projection_matrix() {
      return perspective(
        this.fov,
        this.aspect,
        this.near,
        this.far
      );
  }
} // end class


/**
 * split up the cameras this way. perspective camera.
 */
export class OrthographicCamera extends Camera {
  get_projection_matrix() {
    return ortho(this.ortho_size, this.aspect, this.near, this.far);
  }
} // end class

/**
 * ==============================================
 * RENDERING WORKHORSE
 * ==============================================
 */

export class Renderer {
  constructor(gl) {
    this.gl = gl;
    this.clear(); // first thing, clear
    this.init_shader_map(); // initialize our shader map only once.
  }

  /**
   * main draw function
   */
  draw(scene, clear_color=[0.2, 0.2, 0.2]) {
    this.clear(clear_color); // clear out (?)

    scene.roots.forEach((r) => {
      // setup any new transformation matrices first in the hierarchy
      // TODO: dirty bit optimization to avoid needless calculation (thanks for that idea gemini)
      this.update_transformations(r, mat4Identity());

      // for each node in hierarchy tree (maybe combine with prior step to 
      // optimize this a bit, but for clarity, this is two separate steps)
      // grab their shader, load the shader, and draw with shader.
      this.draw_nodes(r, scene.camera, scene.lights);
    });

  } // end function

  /**
   * update all transformations in the tree, working your way down.
   */
  update_transformations(parent, M_parent) {
    parent.update_transformation_matrix(M_parent);

    if (parent.children) {
      parent.children.forEach((c) => { // drill down the tree
        this.update_transformations(c, parent.transformation_matrix);
      });
    } // end if
  } // end function

  /**
   * traverse all nodes a tree and draw them with their shader
   */
  draw_nodes(node, camera, lights) {
    if (!(node instanceof GroupSceneNode)) { // skip over dummy groupers
      // console.log()
      const shader = this.shader_map[node.shader_id]; // grab this nodes shader
      shader.load(node, camera, lights, this.gl); // load up the buffer locations
      shader.draw(node, this.gl); // draw this node
    } // end if
    
    if (node.children) {
      node.children.forEach((c) => { // drill down the tree
        this.draw_nodes(c, camera, lights);
      });
    } // end if
    
  } // end function

  /**
   * go through all shader keys in the shader map and
   * initialize the shaders.
   */
  init_shader_map() {
    this.shader_map = {};
    for (const [shader_id, ShaderClass] of Object.entries(SHADER_MAP)) {
      this.shader_map[shader_id] = new ShaderClass(this.gl);
    } // end loop
  } // end function

  /**
   * clear out gl, should be used on every render call.
   */
  clear(clear_color=[0.2, 0.2, 0.2]) {
    // clear things.
    this.gl.enable(this.gl.DEPTH_TEST);
    this.gl.clearColor(...clear_color, 1);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
  } // end function

} // end class
