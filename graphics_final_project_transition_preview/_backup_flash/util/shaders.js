import * as SourceDicts from './shader_sources.js';
import { normalMat, multiplyMat4, transform_point } from './transitions.js'; // TRANSITION PREVIEW: added transform_point

/**
 * this file is to contain a mapping of id -> shader (BOTTOM OF FILE). 
 *  + note: has to be at the bottom to accomplish dynamic class
 *    creation, otherwise JS throws a fit :)
 * as long as the mesh of a node contains all the necessary information
 * for this shader to function (all in's, uniforms, vertices, etc),
 * any node should be able to use it by specififying node.shader_id = "this_shader".
 * 
 * all implemented child shaders should have the constructor signature:
 * constructor(gl)
 * (if for some reason you need something else, there could likely be a special
 * case created in the Renderer.init_shader_map(), but try to avoid this for simplicity.)
 * 
 * process: 
 * + have a vertex_shader and fragment_shader string defined in shader_sources.js
 * + implement an extending shader -- implement load() and draw()
 * + add shader class name to the shader map at the bottom
 * + if want to use in node: node.shader_id = the id in shader map.
 */

/**
 * ==============================================
 * SHADER SKELETON
 * ==============================================
 */

/**
 * shader is here to (1) hold the compiled shader program.
 * and (2) bind and load up the buffers that it is aware of.
 * this is intended highly customizable to whatever shader you want to build.
 * just implement a new shader with load() and draw() and set the id in the node.
 */
export class Shader {
  constructor(vert_shader, frag_shader, gl) {
    // create the shaders
    this.vert_shader = this.create_shader(gl.VERTEX_SHADER, vert_shader, gl);
    this.frag_shader = this.create_shader(gl.FRAGMENT_SHADER, frag_shader, gl);
    // create the program for this object and children
    this.program = gl.createProgram();
    // attach shaders
    gl.attachShader(this.program, this.vert_shader);
    gl.attachShader(this.program, this.frag_shader);
    // link the program
    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(this.program));
    } // end if
  }

  /**
   * to be implemented by child shader.
   * load should specify how to load all buffers and uniforms
   * with data in the shader. buffers are kept in the node mesh 
   * (node.mesh).
   */
  load(node, camera, lights, gl) {
    throw new Error("Load function not implemented in inheriting shader!");
  } // end function

  /**
   * define how to draw with this shader.
   * this is just to provide flexibility on the gl.draw call
   * in case you want to do something more specific and weird there.
   */
  draw(node, gl) {
    throw new Error("Draw function not implemented in inheriting shader!");
  } // end function

  /**
   * function to generate a shader for this object.
   */
  create_shader(type, source, gl) {
    const shader = gl.createShader(type)
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader));
    } // end if
    return shader;
  } // end function

  /**
   * utility function to flatten a 2d array
   * to a 1d. if this is helpful outside of this,
   * we can move this to a more util exported function.
   * important for webgl to flatten.
   */
  flatten(to_flatten) {
    const flat = [];
    to_flatten.forEach((i) => {
      flat.push(...i);
    });
    return new Float32Array(flat);
  } // end function

  /**
   * right now, just a simple light position extraction.
   * not beautiful, but it works.
   */
  flatten_lights(lights) {
    const lights_flat = [];
    lights.forEach((l) => {
      lights_flat.push(...l.position);
    });
    return new Float32Array(lights_flat);
  } // end function
  
} // end class

/**
 * ==============================================
 * SHADERS
 * ==============================================
 */

/**
 * just call with a basic phong shader.
 * an example of how to implement a custom shader.
 */
export class PhongShader extends Shader {
  constructor(gl) {
    super(SourceDicts.phong_basic.vertex_shader, SourceDicts.phong_basic.fragment_shader, gl);
    // camera and light items (may be able to pull out into the renderer if consistent.)
    this.model_view_loc = gl.getUniformLocation(this.program, "uModelViewMatrix"); 
    this.projection_loc = gl.getUniformLocation(this.program, "uProjectionMatrix"); 
    this.lights_loc = gl.getUniformLocation(this.program, "uPointLights");
    this.num_lights_loc =  gl.getUniformLocation(this.program, "uNumPointLights"); 

    // some lighting specific locations
    this.material_params_loc = {};
    this.material_params_loc["ka"] = gl.getUniformLocation(this.program, 'uMaterialParams.ka');
    this.material_params_loc["kd"] = gl.getUniformLocation(this.program, 'uMaterialParams.kd');
    this.material_params_loc["ks"] = gl.getUniformLocation(this.program, 'uMaterialParams.ks');
    this.material_params_loc["shininess"] = gl.getUniformLocation(this.program, 'uMaterialParams.shininess');
    this.material_params_loc["transparency"] = gl.getUniformLocation(this.program, 'uMaterialParams.transparency');

    // more meshy information here.
    this.pos_loc = gl.getAttribLocation(this.program, "aPosition");
    this.norm_loc = gl.getAttribLocation(this.program, "aNormal");
    this.color_loc = gl.getAttribLocation(this.program, "aColor");
    this.node_transforms_loc = gl.getUniformLocation(this.program, "uModelTransformationMatrix"); 
  }

  /**
   * shader is here to (1) hold the compiled shader program.
   * and (2) bind and load up the buffers that it is aware of.
   * this is intended highly customizable to whatever shader you want to build.
   * just implement a new shader with load() and draw() and set the id in the node.
   */
  load(node, camera, lights, gl) {
    // from object
    gl.useProgram(this.program);

    // TODO: pull this out if its general enough to the renderer so don't have to keep setting on load
    // set gl attributes for the camera_matrices
    gl.uniformMatrix4fv(this.projection_loc, false, camera.get_projection_matrix());
    gl.uniformMatrix4fv(this.model_view_loc, false, camera.get_view_matrix());
    // set gl for the global lights of the scene
    gl.uniform3fv(this.lights_loc, this.flatten_lights(lights)); 
    gl.uniform1i(this.num_lights_loc, lights.length);

    // set this nodes transformation matrix
    gl.uniformMatrix4fv(this.node_transforms_loc, false, node.transformation_matrix);

    // set up material information for the phong shader
    gl.uniform3fv(this.material_params_loc["ka"], node.material.ka);
    gl.uniform3fv(this.material_params_loc["kd"], node.material.kd);
    gl.uniform3fv(this.material_params_loc["ks"], node.material.ks);
    gl.uniform1f(this.material_params_loc["shininess"], node.material.shininess);
    gl.uniform1f(this.material_params_loc["transparency"], node.material.transparency);

    // vertex/positions buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, node.mesh.vert_buff);
    gl.enableVertexAttribArray(this.pos_loc);
    gl.vertexAttribPointer(this.pos_loc, 3, gl.FLOAT, false, 0, 0);

    // norm buffer setup
    gl.bindBuffer(gl.ARRAY_BUFFER, node.mesh.norm_buff);
    gl.enableVertexAttribArray(this.norm_loc);
    gl.vertexAttribPointer(this.norm_loc, 3, gl.FLOAT, false, 0, 0);

    // color buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, node.mesh.color_buff);
    gl.enableVertexAttribArray(this.color_loc);
    gl.vertexAttribPointer(this.color_loc, 3, gl.FLOAT, false, 0, 0);

    // index buffer for drawing as triangles
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, node.mesh.ind_buff);
    
  } // end function

  /**
   * define how to draw with this shader.
   */
  draw(node, gl) {
    // draw the node.
    gl.drawElements(gl.TRIANGLES, node.mesh.indices.length, gl.UNSIGNED_SHORT, 0);
  } // end function

} // end class

/**
 * just call with a basic phong shader.
 * an example of how to implement a custom shader.
 */
export class TextureBumpMappingShader extends Shader {

  constructor(gl) {
    super(SourceDicts.texture_basic.vertex_shader, SourceDicts.texture_basic.fragment_shader, gl);
    // camera and light items (may be able to pull out into the renderer if consistent.)
    this.model_view_loc = gl.getUniformLocation(this.program, "uModelViewMatrix"); 
    this.projection_loc = gl.getUniformLocation(this.program, "uProjectionMatrix"); 
    this.lights_loc = gl.getUniformLocation(this.program, "uPointLights");
    this.num_lights_loc =  gl.getUniformLocation(this.program, "uNumPointLights"); 

    // some lighting specific locations
    this.material_params_loc = {};
    this.material_params_loc["ka"] = gl.getUniformLocation(this.program, 'uMaterialParams.ka');
    this.material_params_loc["kd"] = gl.getUniformLocation(this.program, 'uMaterialParams.kd');
    this.material_params_loc["ks"] = gl.getUniformLocation(this.program, 'uMaterialParams.ks');
    this.material_params_loc["shininess"] = gl.getUniformLocation(this.program, 'uMaterialParams.shininess');
    this.material_params_loc["transparency"] = gl.getUniformLocation(this.program, 'uMaterialParams.transparency');

    // more meshy information here.
    this.pos_loc = gl.getAttribLocation(this.program, "aPosition");
    this.norm_loc = gl.getAttribLocation(this.program, "aNormal");
    this.color_loc = gl.getAttribLocation(this.program, "aColor");
    this.node_transforms_loc = gl.getUniformLocation(this.program, "uModelTransformationMatrix"); 

    // additionally: tangent and texel coords, texture pieces
    this.tangent_loc = gl.getAttribLocation(this.program, "aTangent");
    this.texel_loc = gl.getAttribLocation(this.program, "aTexCoord");
    this.texture_loc = gl.getUniformLocation(this.program, "uTexture");
    this.mapping_loc = gl.getUniformLocation(this.program, "uMapping");
  }

  /**
   * shader is here to (1) hold the compiled shader program.
   * and (2) bind and load up the buffers that it is aware of.
   * this is intended highly customizable to whatever shader you want to build.
   * just implement a new shader with load() and draw() and set the id in the node.
   */
  load(node, camera, lights, gl) {
    // from object
    gl.useProgram(this.program);

    // TODO: pull this out if its general enough to the renderer so don't have to keep setting on load
    // set gl attributes for the camera_matrices
    gl.uniformMatrix4fv(this.projection_loc, false, camera.get_projection_matrix());
    gl.uniformMatrix4fv(this.model_view_loc, false, camera.get_view_matrix());
    // set gl for the global lights of the scene
    gl.uniform3fv(this.lights_loc, this.flatten_lights(lights)); 
    gl.uniform1i(this.num_lights_loc, lights.length);

    // set this nodes transformation matrix
    gl.uniformMatrix4fv(this.node_transforms_loc, false, node.transformation_matrix);

    // set up material information for the phong shader
    gl.uniform3fv(this.material_params_loc["ka"], node.material.ka);
    gl.uniform3fv(this.material_params_loc["kd"], node.material.kd);
    gl.uniform3fv(this.material_params_loc["ks"], node.material.ks);
    gl.uniform1f(this.material_params_loc["shininess"], node.material.shininess);
    gl.uniform1f(this.material_params_loc["transparency"], node.material.transparency);

    // set the texture type
    gl.uniform1i(this.mapping_loc, 0);

    // set up the texture
    gl.activeTexture(gl.TEXTURE0); 
    gl.bindTexture(gl.TEXTURE_2D, node.texture.get_texture());

    // vertex/positions buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, node.mesh.vert_buff);
    gl.enableVertexAttribArray(this.pos_loc);
    gl.vertexAttribPointer(this.pos_loc, 3, gl.FLOAT, false, 0, 0);

    // norm buffer setup
    gl.bindBuffer(gl.ARRAY_BUFFER, node.mesh.norm_buff);
    gl.enableVertexAttribArray(this.norm_loc);
    gl.vertexAttribPointer(this.norm_loc, 3, gl.FLOAT, false, 0, 0);

    // color buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, node.mesh.color_buff);
    gl.enableVertexAttribArray(this.color_loc);
    gl.vertexAttribPointer(this.color_loc, 3, gl.FLOAT, false, 0, 0);

    // additionally: add the tnagent and tex information from mesh
    gl.bindBuffer(gl.ARRAY_BUFFER, node.mesh.tangent_buff);
    gl.enableVertexAttribArray(this.tangent_loc);
    gl.vertexAttribPointer(this.tangent_loc, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, node.mesh.tex_buff);
    gl.enableVertexAttribArray(this.texel_loc);
    gl.vertexAttribPointer(this.texel_loc, 2, gl.FLOAT, false, 0, 0);

    // index buffer for drawing as triangles
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, node.mesh.ind_buff);

  } // end function

  /**
   * define how to draw with this shader.
   */
  draw(node, gl) {
    // draw the node.
    gl.drawElements(gl.TRIANGLES, node.mesh.indices.length, gl.UNSIGNED_SHORT, 0);
  } // end function

} // end class

/**
 * just call with a basic phong shader.
 * an example of how to implement a custom shader.
 */
export class TextureNormalMappingShader extends TextureBumpMappingShader {

  /**
   * shader is here to (1) hold the compiled shader program.
   * and (2) bind and load up the buffers that it is aware of.
   * this is intended highly customizable to whatever shader you want to build.
   * just implement a new shader with load() and draw() and set the id in the node.
   */
  load(node, camera, lights, gl) {
    super.load(node, camera, lights, gl); // just load normally
    // EXCEPT:
    // set the texture type
    gl.uniform1i(this.mapping_loc, 1);
  } // end function

} // end class

/**
 * adapting liz's shaders to a shader wrapper to be used
 * in the current render pipeline for the planets
 */
export class PlanetShader extends Shader {
  constructor(gl) {
    super(SourceDicts.planet_basic.vertex_shader, SourceDicts.planet_basic.fragment_shader, gl);

    // grabbing all locations
    this.posLoc = gl.getAttribLocation(this.program, "aPosition");
    this.colorLoc = gl.getAttribLocation(this.program, "aColor");
    this.timeLoc = gl.getUniformLocation(this.program, "uTime");
    this.uMVM = gl.getUniformLocation(this.program, "uModelViewMatrix");
    this.uPM = gl.getUniformLocation(this.program, "uProjectionMatrix");
    this.uMTM = gl.getUniformLocation(this.program, "uModelTransformationMatrix");
    this.normalLoc = gl.getAttribLocation(this.program, "aNormal");
    this.uNM = gl.getUniformLocation(this.program, "uNormalMatrix");
    this.uFlat = gl.getUniformLocation(this.program, "uFlatShading");
    this.uLightPosLoc = gl.getUniformLocation(this.program, "uLightPos");
    this.uLightColorLoc = gl.getUniformLocation(this.program, "uLightColor");
    this.uLightAttLoc = gl.getUniformLocation(this.program, "uLightAtt");
    this.uAmbientLoc = gl.getUniformLocation(this.program, "uAmbient");
    this.uMat = {};
    for (const field of ["ka", "kd", "ks", "shininess", "metallic", "emissive"]) {
        this.uMat[field] = gl.getUniformLocation(this.program, "uMaterial." + field);
    }
    this.tangentLoc = gl.getAttribLocation(this.program, "aTangent");
    this.texCoordLoc = gl.getAttribLocation(this.program, "aTextureCoor");
    this.uMappingLoc = gl.getUniformLocation(this.program, "uMapping");
    this.uTextureLoc = gl.getUniformLocation(this.program, "uTexture");
  }

  /**
   * defining how to load up buffer locations with this shader.
   * TODO
   * the lights information needs to be set!
   */
  load(node, camera, lights, gl) {
    // from object
    gl.useProgram(this.program);

    // set gl attributes for the camera_matrices
    gl.uniformMatrix4fv(this.uPM, false, camera.get_projection_matrix());
    gl.uniformMatrix4fv(this.uMVM, false, camera.get_view_matrix());

    gl.uniformMatrix4fv(this.uMTM, false, node.transformation_matrix);

    const mv = multiplyMat4(camera.get_view_matrix(), node.transformation_matrix);
    gl.uniformMatrix3fv(this.uNM, false, normalMat(mv));

    this.setMaterial(node.material, gl); // set up the material parameters

    // lighting setup

    // TODO real bad, but for TESTING currently positional:
    const sun_light = lights[0];
    const fill_light = lights[1];

    // console.log(sun_light);
    // console.log(fill_light);

    const s = sun_light.on ? sun_light.intensity : 0;    // "off" = zero brightness
    const f = fill_light.on ? fill_light.intensity : 0;

    gl.uniform4fv(this.uLightPosLoc, [
        ...transform_point(camera.get_view_matrix(), sun_light.position), 1, // TRANSITION PREVIEW: shader lights are in VIEW space, so move the world-space sun with the camera (identity view = unchanged)
        ...fill_light.fill_dir, 0,
    ]);

    gl.uniform3fv(this.uLightColorLoc, [
        ...(sun_light.color.map(num => num * s)),
        ...(fill_light.color.map(num => num * f))
    ]);

    // f_att = 1 / (a + b d + c d^2): sun uses a = 1, b = 0, c = falloff slider; fill light: none
    gl.uniform3fv(this.uLightAttLoc, [1, 0, sun_light.falloff, 1, 0, 0]);
    gl.uniform3f(this.uAmbientLoc, 0.25, 0.25,  0.25); // TODO shouldn't hard set this here, but again, testing.


    /// =================================================================

    // vertex/positions buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, node.mesh.vert_buff);
    gl.enableVertexAttribArray(this.posLoc);
    gl.vertexAttribPointer(this.posLoc, 3, gl.FLOAT, false, 0, 0);

    // norm buffer setup
    gl.bindBuffer(gl.ARRAY_BUFFER, node.mesh.norm_buff);
    gl.enableVertexAttribArray(this.normalLoc);
    gl.vertexAttribPointer(this.normalLoc, 3, gl.FLOAT, false, 0, 0);

    // color buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, node.mesh.color_buff);
    gl.enableVertexAttribArray(this.colorLoc);
    gl.vertexAttribPointer(this.colorLoc, 3, gl.FLOAT, false, 0, 0);
    
    // tangent and textures 
    if (node.mesh.tangent_buff) {
        gl.bindBuffer(gl.ARRAY_BUFFER, node.mesh.tangent_buff);
        gl.enableVertexAttribArray(this.tangentLoc);
        gl.vertexAttribPointer(this.tangentLoc, 3, gl.FLOAT, false, 0, 0);
    } else {
        gl.disableVertexAttribArray(this.tangentLoc);
    } // end if
    if (node.mesh.tex_buff) {
        gl.bindBuffer(gl.ARRAY_BUFFER, node.mesh.tex_buff);
        gl.enableVertexAttribArray(this.texCoordLoc);
        gl.vertexAttribPointer(this.texCoordLoc, 2, gl.FLOAT, false, 0, 0);
    } else {
        gl.disableVertexAttribArray(this.texCoordLoc);
    } // end if

    // select mapping
    try {
      gl.uniform1i(this.uMappingLoc, node.mesh.mapping); // TODO hold in texture?
    } catch (err) {
      console.log(err); // just log it, mostly to see if the mapping set in mesh.
    } // end try 
    
    if (node.texture) {
        gl.activeTexture(gl.TEXTURE0);
        // console.log(node.texture)
        gl.bindTexture(gl.TEXTURE_2D, node.texture.get_texture());
    } // end if

        // index buffer for drawing as triangles
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, node.mesh.ind_buff);
  } // end function

  /**
   * defining how to draw with this shader.
   */
  draw(node, gl) {
    // draw the node.
    gl.drawElements(gl.TRIANGLES, node.mesh.indices.length, gl.UNSIGNED_SHORT, 0);
  } // end function

  /**
   * encapsulating function to set the material uniforms.
   */
  setMaterial(m, gl) {
    gl.uniform3fv(this.uMat.ka, m.ka);
    gl.uniform3fv(this.uMat.kd, m.kd);
    gl.uniform3fv(this.uMat.ks, m.ks);
    gl.uniform1f(this.uMat.shininess, m.shininess);
    gl.uniform1f(this.uMat.metallic, m.metallic);
    gl.uniform1f(this.uMat.emissive, m.emissive);
    gl.uniform1i(this.uFlat, m.flat ? 1 : 0);
  } // end function
} // end class


// ==============================================
// SHADER MAP
//
// the Renderer looks to this to pluck out a shader
// for a node on render.
// if want to add a custom Shader, simply specify
// an id->Shader mapping and it should *just work*.
// please choose a unique id.
// ==============================================

// ----------------------------------------------
// TRANSITION PREVIEW: backdrop shaders for the planet landing scene.
// (declared here, before SHADER_MAP, because classes are not hoisted)
// ----------------------------------------------

/**
 * TRANSITION PREVIEW: draws node.sky_params as a full-screen gradient, behind everything.
 * Depth test and depth writes are off while it draws, so it can never hide or be hidden.
 */
class SkyShader extends Shader {
  constructor(gl) {
    super(SourceDicts.sky_gradient.vertex_shader, SourceDicts.sky_gradient.fragment_shader, gl);
    this.pos_loc = gl.getAttribLocation(this.program, "aPosition");
    this.zenith_loc = gl.getUniformLocation(this.program, "uZenith");
    this.horizon_loc = gl.getUniformLocation(this.program, "uHorizon");
    this.horizon_y_loc = gl.getUniformLocation(this.program, "uHorizonY");
    this.haze_loc = gl.getUniformLocation(this.program, "uHaze");
  }

  load(node, camera, lights, gl) {
    gl.useProgram(this.program);
    const p = node.sky_params;
    gl.uniform3fv(this.zenith_loc, p.zenith);
    gl.uniform3fv(this.horizon_loc, p.horizon);
    gl.uniform1f(this.horizon_y_loc, p.horizon_y);
    gl.uniform1f(this.haze_loc, p.haze);

    gl.bindBuffer(gl.ARRAY_BUFFER, node.mesh.vert_buff);
    gl.enableVertexAttribArray(this.pos_loc);
    gl.vertexAttribPointer(this.pos_loc, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, node.mesh.ind_buff);
  } // end function

  draw(node, gl) {
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.drawElements(gl.TRIANGLES, node.mesh.indices.length, gl.UNSIGNED_SHORT, 0);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
  } // end function
} // end class

/**
 * TRANSITION PREVIEW: draws node.texture tiled over node.mesh, tinted and fogged by node.ground_params.
 */
class GroundShader extends Shader {
  constructor(gl) {
    super(SourceDicts.ground_plane.vertex_shader, SourceDicts.ground_plane.fragment_shader, gl);
    this.pos_loc = gl.getAttribLocation(this.program, "aPosition");
    this.model_view_loc = gl.getUniformLocation(this.program, "uModelViewMatrix");
    this.projection_loc = gl.getUniformLocation(this.program, "uProjectionMatrix");
    this.node_transforms_loc = gl.getUniformLocation(this.program, "uModelTransformationMatrix");
    this.tile_loc = gl.getUniformLocation(this.program, "uTile");
    this.texture_loc = gl.getUniformLocation(this.program, "uTexture");
    this.tint_loc = gl.getUniformLocation(this.program, "uTint");
    this.fog_color_loc = gl.getUniformLocation(this.program, "uFogColor");
    this.fog_range_loc = gl.getUniformLocation(this.program, "uFogRange");
  }

  load(node, camera, lights, gl) {
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.projection_loc, false, camera.get_projection_matrix());
    gl.uniformMatrix4fv(this.model_view_loc, false, camera.get_view_matrix());
    gl.uniformMatrix4fv(this.node_transforms_loc, false, node.transformation_matrix);

    const g = node.ground_params;
    gl.uniform2fv(this.tile_loc, g.tile);
    gl.uniform3fv(this.tint_loc, g.tint);
    gl.uniform3fv(this.fog_color_loc, g.fog_color);
    gl.uniform2fv(this.fog_range_loc, g.fog_range);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, node.texture.get_texture());
    gl.uniform1i(this.texture_loc, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, node.mesh.vert_buff);
    gl.enableVertexAttribArray(this.pos_loc);
    gl.vertexAttribPointer(this.pos_loc, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, node.mesh.ind_buff);
  } // end function

  draw(node, gl) {
    gl.drawElements(gl.TRIANGLES, node.mesh.indices.length, gl.UNSIGNED_SHORT, 0);
  } // end function
} // end class

// SHIP PREVIEW: phong for nodes drawn in the space scene. The stock PhongShader hands light positions
// to the GPU untouched (fine with the identity view) and would throw on the FillLight, which has
// no position. This one keeps only positional lights and moves them into view space first, so
// the ship is lit by the sun wherever the chase camera is. Stock phong_basic is unchanged.
class ShipPhongShader extends PhongShader {
  load(node, camera, lights, gl) {
    const view = camera.get_view_matrix();
    const view_lights = lights
      .filter((l) => l.position)
      .map((l) => ({ position: transform_point(view, l.position) }));
    super.load(node, camera, view_lights, gl);
  } // end function
} // end class

/**
 * FPS PREVIEW: sky from the camera's world-space axes (see sky_dir in shader_sources.js).
 * The axes are read straight out of the view matrix rows (column-major array, so row r is m[r], m[r+4], m[r+8]).
 * node.sky_params = { zenith, horizon, haze }
 */
class SkyDirShader extends Shader {
  constructor(gl) {
    super(SourceDicts.sky_dir.vertex_shader, SourceDicts.sky_dir.fragment_shader, gl);
    this.pos_loc = gl.getAttribLocation(this.program, "aPosition");
    this.right_loc = gl.getUniformLocation(this.program, "uRight");
    this.up_loc = gl.getUniformLocation(this.program, "uUp");
    this.forward_loc = gl.getUniformLocation(this.program, "uForward");
    this.tan_loc = gl.getUniformLocation(this.program, "uTan");
    this.zenith_loc = gl.getUniformLocation(this.program, "uZenith");
    this.horizon_loc = gl.getUniformLocation(this.program, "uHorizon");
    this.haze_loc = gl.getUniformLocation(this.program, "uHaze");
  }

  load(node, camera, lights, gl) {
    gl.useProgram(this.program);
    const m = camera.get_view_matrix();
    const tan_half = Math.tan(camera.fov / 2);
    gl.uniform3f(this.right_loc, m[0], m[4], m[8]);
    gl.uniform3f(this.up_loc, m[1], m[5], m[9]);
    gl.uniform3f(this.forward_loc, -m[2], -m[6], -m[10]); // the camera looks down its own -z
    gl.uniform2f(this.tan_loc, tan_half * camera.aspect, tan_half);

    const p = node.sky_params;
    gl.uniform3fv(this.zenith_loc, p.zenith);
    gl.uniform3fv(this.horizon_loc, p.horizon);
    gl.uniform1f(this.haze_loc, p.haze);

    gl.bindBuffer(gl.ARRAY_BUFFER, node.mesh.vert_buff);
    gl.enableVertexAttribArray(this.pos_loc);
    gl.vertexAttribPointer(this.pos_loc, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, node.mesh.ind_buff);
  } // end function

  draw(node, gl) {
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.drawElements(gl.TRIANGLES, node.mesh.indices.length, gl.UNSIGNED_SHORT, 0);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
  } // end function
} // end class

/**
 * FPS PREVIEW: phong for the first-person gun. A node with clear_depth = true wipes the depth
 * buffer right before it draws, so the gun (drawn last) is never cut by, or fighting with,
 * the world. only the FIRST gun part sets clear_depth, so the parts still occlude each other.
 */
class ViewmodelShader extends PhongShader {
  load(node, camera, lights, gl) {
    super.load(node, camera, lights, gl);
    if (node.clear_depth) gl.clear(gl.DEPTH_BUFFER_BIT);
  } // end function
} // end class

export const SHADER_MAP = {
  "phong_ship": ShipPhongShader, // SHIP PREVIEW: phong lit by positional lights in view space
  "phong_basic": PhongShader,
  "texture_bump_mapping_basic": TextureBumpMappingShader, // TODO: collapse these and use the mesh setter
  "texture_normal_mapping_basic": TextureNormalMappingShader, 
  "planet_basic": PlanetShader, // for ya planets
  "sky_gradient": SkyShader, // TRANSITION PREVIEW: landing backdrop sky
  "ground_plane": GroundShader, // TRANSITION PREVIEW: landing backdrop ground / cloud deck
  "sky_dir": SkyDirShader, // FPS PREVIEW: direction-based sky (stays right when looking around)
  "phong_viewmodel": ViewmodelShader // FPS PREVIEW: first-person gun, clears depth before drawing
} // end shader map