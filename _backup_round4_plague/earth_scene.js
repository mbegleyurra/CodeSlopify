import * as SceneBuilder from "../util/scene_graph.js";
import * as MeshBuilder from "../util/mesh_generators.js";
import { BoidSceneNode } from "./boid_scene_node.js";
import { get_planet_profile } from "./planet_profiles.js"; // TRANSITION PREVIEW
import { FpsPlayer } from "./fps_player.js"; // FPS PREVIEW
import { Shotgun } from "./shotgun.js"; // FPS PREVIEW
import { BirdFlock, WAVE_SIZE } from "./bird_flock.js"; // FPS PREVIEW
import { play_shotgun, play_world_entry } from "../util/audio.js"; // AUDIO: synthesized sound effects
import { build_terrain, TERRAIN_KEYS, WALK_RADIUS } from "./terrain_profiles.js"; // ROUND 3 TERRAIN: per-planet heightfield + props

const PELLETS = 8;           // FPS PREVIEW: pellets per shotgun shell
const PELLET_SPREAD = 0.04;  // FPS PREVIEW: max pellet angle off the aim line (radians, about 2.3 degrees)
const SHOT_RANGE = 80;       // FPS PREVIEW: pellets do not reach farther than this
const DECK_PLATFORM_RADIUS = 6; // FPS PREVIEW: landing platform on the cloud-deck planets
const GROUND_BOUNDS = 90;    // FPS PREVIEW: how far from the landing spot you may walk on solid ground
const DECK_TERRAIN_RAISE = 9; // ROUND 3 TERRAIN: the cloud deck sits this much above the old ground_depth, so its swells read from the platform

/**
 * a basic earth scene.
 * TRANSITION PREVIEW: it is now the landing scene for ANY planet. The class keeps its name,
 * but set_planet(profile) swaps the sky and ground to the planet you landed on.
 */
export class EarthScene extends SceneBuilder.Scene {

  constructor() {
    super(); // takes care of base initialization fields.

    // do whatever y'all want here, but, like, this sorta shit. these are all the root nodes of a scene.
    // they can be a straight up scene node or group scene node, whatever makes more sense to yall.
    this.boids = null; // this will end up being a dummy root node to hold all the boids. easier access here though than going through root node list.
    // this.player = null;
    // this.ground = null;
    // this.sky = null;
    // ...

    // TRANSITION PREVIEW: landing backdrop. profile = planetary_duck_hunt/planet_profiles.js entry.
    this.profile = get_planet_profile("Earth"); // used when nobody calls set_planet()
    this.sky = null;      // full-screen gradient node (drawn first)
    this.ground = null;   // big textured plane / cloud deck node
    this.textures = {};   // texture path -> Texture, so revisiting a planet reloads nothing
    this.terrain_node = null;  // ROUND 3 TERRAIN: flat shaded heightfield (root node, drawn after the ground)
    this.terrain_props = null; // ROUND 3 TERRAIN: boulders / trees / water / cloud puffs on top of it
    this.terrain_none = null;  // ROUND 3 TERRAIN: degenerate mesh parked under the world when a planet has no terrain
    this.terrain_cache = {};   // planet key -> { data, mesh, props } (built once per planet)
    this.terrain_data = null;  // build_terrain() result for the current planet, or null

    // FPS PREVIEW: on-foot play. `active` is true between on_enter() (landed) and on_exit() (Q pressed).
    this.active = false;
    this.player = null;     // FpsPlayer: WASD / mouse look / jump
    this.shotgun = null;    // Shotgun viewmodel (root node drawn last)
    this.flock = null;      // BirdFlock: the shootable birds
    this.platform = null;   // landing platform, a child of `ground` on cloud-deck planets only
    this.kills = 0;         // birds shot since landing
    this.hud = null;        // DOM crosshair / counter / prompt
    this.last_time = null;  // previous frame_data.delta_time, for dt
    this.last_render_ms = -Infinity; // wall clock of the last render() call, to notice (re)landings. -Infinity so the very first frame always enters, however fast the page loaded // FPS PREVIEW
    if (typeof window !== "undefined") window.__earth_scene = this; // FPS PREVIEW: debug handle for console/browser tests
  }

  /**
   * init call for the scene. this allows construction of the scene
   * while deferring any heavy loading to the init call when the time
   * comes to actually use the scene. 
   * in this case, we're setting up the renderer through parent class,
   * setting camera, adding a basic point light, and initializing some shitty boids.
   */
  init(renderer=null, aspect=1) {
    super.init(renderer); // let the parent take care of basic bookeeping

    // init some shitty basics, lights, camera
    this.set_camera(new SceneBuilder.PerspectiveCamera({
      "aspect": aspect, // since my canvas is not square
      "fov": Math.PI * 0.38, // FPS PREVIEW: wider view for on-foot play (about 68 degrees; was the default 45)
    }))

    // add some light to the scene.
    this.add_light(new SceneBuilder.PointLight({"position": [0, 5, 5]}));

    // TODO: init wasm module here?
    // initialize all nodes, bookeeping, etc in the scene.
    // can give num boids -> comes from module?
    this.init_backdrop(); // TRANSITION PREVIEW: must come before the boids so the sky and ground draw first
    this.init_boids();
    this.init_fps(); // FPS PREVIEW: player, shotgun (must come last: it draws on top), HUD
  } // end function

  /**
   * TRANSITION PREVIEW: build the sky quad and the ground plane ONCE, then dress them with the
   * current profile. Both are plain root nodes, added before the boids, so the renderer draws
   * them first: sky (no depth), ground, then the boids on top.
   */
  init_backdrop() {
    const gl = this.renderer.gl;

    // full-screen quad in clip space; SkyShader ignores every matrix.
    this.sky = new SceneBuilder.SceneNode("sky", "sky_dir"); // FPS PREVIEW: direction-based sky (was "sky_gradient", screen-height only)
    this.sky.set_mesh(new SceneBuilder.Mesh(gl, {
      vertices: new Float32Array([-1, -1, 0,  1, -1, 0,  1, 1, 0,  -1, 1, 0]),
      indices: new Uint16Array([0, 1, 2,  0, 2, 3])
    }));
    this.add_node(this.sky);

    // flat plane at y = 0 in the node's own space.
    // FPS PREVIEW: now a square centered on the landing spot and big enough (400 each way) that the
    // walkable area (GROUND_BOUNDS) plus the 100-unit far plane never reaches its edge.
    const R = 400;
    this.ground = new SceneBuilder.SceneNode("ground", "ground_plane");
    this.ground.set_mesh(new SceneBuilder.Mesh(gl, {
      vertices: new Float32Array([-R, 0, R,  R, 0, R,  R, 0, -R,  -R, 0, -R]),
      indices: new Uint16Array([0, 1, 2,  0, 2, 3])
    }));
    this.add_node(this.ground);

    // ROUND 3 TERRAIN: the per-planet heightfield and its props are root nodes right after the ground,
    // so they draw before the birds. apply_profile() -> apply_terrain() fills in meshes and lighting.
    this.terrain_none = new SceneBuilder.Mesh(gl, {
      vertices: new Float32Array([0, -1e4, 0,  1, -1e4, 0,  0, -1e4, 1]),
      normals: new Float32Array([0, 1, 0,  0, 1, 0,  0, 1, 0]),
      colors: new Float32Array(9),
      indices: new Uint16Array([0, 1, 2])
    });
    this.terrain_node = new SceneBuilder.SceneNode("terrain", "terrain_flat");
    this.terrain_node.set_mesh(this.terrain_none);
    this.add_node(this.terrain_node);
    this.terrain_props = new SceneBuilder.SceneNode("terrain_props", "terrain_flat");
    this.terrain_props.set_mesh(this.terrain_none);
    this.add_node(this.terrain_props);

    // FPS PREVIEW: the cloud-deck planets have no solid ground, so those get a walkable landing
    // platform. it is a child of `ground` (so it can be added / removed per planet without touching
    // the root draw order); apply_profile() positions it. a cylinder grows up from y = 0.
    this.platform = new SceneBuilder.SceneNode("platform", "phong_basic");
    this.platform.set_mesh(new SceneBuilder.Mesh(gl, MeshBuilder.gen_cylinder_mesh(1, 0.2, 1, [0.55, 0.57, 0.62]))); // 32 sides
    this.platform.set_material(new SceneBuilder.Material({
      ka: [0.45, 0.45, 0.45], kd: [0.7, 0.7, 0.7], ks: [0.3, 0.3, 0.3], shininess: 30, transparency: 1
    }));
    this.platform.scale = [DECK_PLATFORM_RADIUS, 0.5, DECK_PLATFORM_RADIUS];

    this.apply_profile();
  } // end function

  /**
   * TRANSITION PREVIEW: pick the planet this scene should look like.
   * takes a profile object from planet_profiles.js, or a planet name ("Mars", any case).
   * safe to call before init (applied at init) and between visits (applied immediately,
   * nothing is re-created). returns false when the name is unknown.
   */
  set_planet(profile) {
    const p = typeof profile === "string" ? get_planet_profile(profile) : profile;
    if (!p) {
      console.warn("EarthScene.set_planet: unknown planet", profile);
      return false;
    } // end if
    this.profile = p;
    if (this.initialized && this.sky && this.ground) this.apply_profile();
    return true;
  } // end function

  /**
   * TRANSITION PREVIEW: push this.profile into the existing sky and ground nodes.
   */
  apply_profile() {
    const p = this.profile;

    // FPS PREVIEW: the sky shader works from the view direction now, so it needs no horizon line.
    this.sky.sky_params = { zenith: p.zenith, horizon: p.horizon, haze: p.haze };

    // FPS PREVIEW: the player's feet are at y = 0. solid planets: the ground is right there.
    // cloud-deck planets: the deck stays ground_depth below, and a platform at y = 0 gives you
    // something to stand on (its top face is at y = 0, hence the - 0.5 for its thickness).
    const deck = p.surface === "cloud_deck";
    const terrain = this.apply_terrain(p, deck); // ROUND 3 TERRAIN: heightfield + props, or null (plain flat ground)
    // the flat textured plane sinks out of sight under a solid planet's terrain (it is never below the lowest crater)
    this.ground.position = [0, deck ? -p.ground_depth : (terrain ? -12 : 0), 0];
    this.ground.remove_child(this.platform);
    if (deck) {
      this.platform.position = [0, p.ground_depth - 0.5, 0];
      this.ground.add_child(this.platform);
    } // end if
    if (this.player) { this.player.bounds = this.walk_bounds(); this.sync_terrain_player(); }
    this.ground.texture = this.get_ground_texture(p.texture_path);
    this.ground.ground_params = {
      tile: p.tile, tint: p.ground_tint, fog_color: p.horizon, fog_range: p.fog
    };
  } // end function

  /**
   * ROUND 3 TERRAIN: dress the terrain and prop nodes for planet p (built once per planet, then cached).
   * returns the build_terrain() data, or null when the planet has no recipe (the flat ground stays).
   */
  apply_terrain(p, deck) {
    const key = String(p.name).toLowerCase();
    let t = this.terrain_cache[key];
    if (t === undefined) {
      t = null;
      if (TERRAIN_KEYS.includes(key)) {
        try {
          const gl = this.renderer.gl;
          const data = build_terrain(key);
          t = { data, mesh: new SceneBuilder.Mesh(gl, data.terrain), props: new SceneBuilder.Mesh(gl, data.props) };
        } catch (err) {
          console.warn("EarthScene: terrain build failed for", key, err);
        } // end try
      } // end if
      this.terrain_cache[key] = t;
    } // end if
    this.terrain_data = t ? t.data : null;

    const unit = (v) => { const l = Math.hypot(...v) || 1; return v.map((c) => c / l); };
    const params = t ? {
      light: { dir: unit(t.data.light.dir), sun: t.data.light.sun, ambient: t.data.light.ambient },
      fog_color: p.horizon, fog_range: p.fog, swell: t.data.swell
    } : null;
    const y = deck ? -(p.ground_depth - DECK_TERRAIN_RAISE) : 0;
    this.terrain_node.set_mesh(t ? t.mesh : this.terrain_none);
    this.terrain_props.set_mesh(t ? t.props : this.terrain_none);
    for (const node of [this.terrain_node, this.terrain_props]) {
      node.position = [0, y, 0];
      node.terrain_params = params || { light: { dir: [0, 1, 0], sun: [0, 0, 0], ambient: [0, 0, 0] }, fog_color: p.horizon, fog_range: p.fog, swell: null };
    } // end loop
    return this.terrain_data;
  } // end function

  /** ROUND 3 TERRAIN: true when the player walks on the heightfield (solid planets) rather than a cloud-deck platform. */
  on_solid_terrain() {
    return !!this.terrain_data && this.profile.surface !== "cloud_deck";
  } // end function

  /** ROUND 3 TERRAIN: hand the player the ground height lookup and the solid boulders / trunks. */
  sync_terrain_player() {
    if (!this.player) return;
    const solid = this.on_solid_terrain();
    const grid = solid ? this.terrain_data.grid : null;
    this.player.ground_fn = solid ? (x, z) => grid.sample(x, z) : null;
    this.player.colliders = solid ? this.terrain_data.colliders : [];
  } // end function

  /**
   * ROUND 3 TERRAIN: ground height (world y) at world x, z: the visible terrain surface on solid planets,
   * 0 (the landing platform level) on the cloud-deck planets. the birds can use this.
   */
  ground_height(x, z) {
    return this.on_solid_terrain() ? this.terrain_data.grid.sample(x, z) : 0;
  } // end function

  /** ROUND 3 TERRAIN: the value for flock.ground_y: the terrain's highest point (so birds never enter a hill), 0 on decks. */
  bird_floor() {
    return this.on_solid_terrain() ? this.terrain_data.max_height : 0;
  } // end function

  /**
   * TRANSITION PREVIEW: one Texture per path, mirrored repeat (no visible seams when tiled).
   */
  get_ground_texture(path) {
    if (!this.textures[path]) {
      const gl = this.renderer.gl;
      const texture = new SceneBuilder.Texture(gl, path);
      gl.bindTexture(gl.TEXTURE_2D, texture.get_texture());
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
      // the 1x1 placeholder has no mipmaps, so use plain LINEAR until the image loads
      // (Texture switches to mipmapped filtering itself once it has).
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      this.textures[path] = texture;
    } // end if
    return this.textures[path];
  } // end function

  /**
   * initialize the boids scene nodes, grouped by a dummy node.
   * right now, they're just the baseline nodes, but if you need to do a like, 
   * class Boids extends SceneNode
   * and customize, go wild -- it's very possible this will be needed to 
   * do more interesting things in the update_transformation_matrix which by default just does a TRS.
   */
  init_boids(num_boids=5) {
    this.boids = new SceneBuilder.GroupSceneNode(); // grouper node to keep it a little more organized
    let boid;

    // making these here because these can be shared amongst all boids in this group,
    // avoiding buffer duplication
    const boid_mesh = new SceneBuilder.Mesh(this.renderer.gl, MeshBuilder.gen_cone_mesh()); // generate a basic cone mesh for now
    const boid_material = new SceneBuilder.Material({ // create a material (this is the constants for silver as place holder)
        "ka": [0.19225, 0.19225, 0.19225],
        "kd": [0.50754, 0.50754, 0.50754],
        "ks": [0.508273, 0.508273, 0.508273],
        "shininess": 51.2,
        "transparency": 1.0
    }); 

    // FPS PREVIEW: the placeholder cones are now a BirdFlock: WAVE_SIZE wandering, shootable birds.
    // it spawns them in on_enter() (landing), around the player. the shared mesh / material are the ones above.
    this.flock = new BirdFlock(this.boids, this.renderer.gl); // the flock builds its own low-poly bird meshes and materials

    this.add_node(this.boids); // add grouper node as a root node of the scene.
  } // end function

  // ------------------------------------------------------------
  // FPS PREVIEW: on-foot play
  // ------------------------------------------------------------

  /**
   * FPS PREVIEW: build the player, the shotgun and the HUD. the shotgun root is added to the scene
   * LAST so it draws after everything else (its shader clears depth, so it is never clipped).
   */
  init_fps() {
    const canvas = this.renderer.gl.canvas;
    this.player = new FpsPlayer(canvas);
    this.player.on_lock_change = (locked) => this.update_hud();
    this.player.bounds = this.walk_bounds();
    this.sync_terrain_player(); // ROUND 3 TERRAIN: ground height lookup + colliders for the current planet

    this.shotgun = new Shotgun(this.renderer.gl);
    this.add_node(this.shotgun.root);

    this.build_hud(canvas);
    window.setInterval(() => {
      // safety net: render() stopped being called (we left for space) without on_exit(): switch off.
      if (this.active && performance.now() - this.last_render_ms > 400) this.on_exit();
    }, 250);
  } // end function

  /** FPS PREVIEW: walkable radius around the landing spot: the platform on gas giants, else the open ground. */
  walk_bounds() {
    return this.profile.surface === "cloud_deck" ? DECK_PLATFORM_RADIUS - 0.8 : Math.min(GROUND_BOUNDS, WALK_RADIUS); // ROUND 3 TERRAIN: the heightfield is WALK_RADIUS wide on purpose
  } // end function

  /**
   * FPS PREVIEW: the player has landed. fresh position, fresh wave, counter at 0, input on.
   * SceneTransition calls this; render() also calls it when the scene starts drawing after a pause
   * (so ?scene=earth works with no hook).
   */
  on_enter() {
    if (!this.initialized) return;
    this.player.reset(this.walk_bounds());
    this.player.set_active(true);
    this.shotgun.reset();
    this.flock.ground_y = this.bird_floor(); // ROUND 3 TERRAIN: birds fly above the highest ground (0 on cloud decks)
    this.flock.set_planet(this.profile.name); // alien birds themed to this planet (bird_themes.js)
    this.flock.reset(this.player.pos);
    this.kills = 0;
    this.last_time = null;
    this.active = true;
    this.update_hud();
    play_world_entry(); // AUDIO: whoosh + chord (held until the first click / key if the browser blocks audio)
  } // end function

  /**
   * FPS PREVIEW: leaving for space (Q). input off, pointer lock released, HUD hidden.
   */
  on_exit() {
    this.active = false;
    if (this.player) this.player.set_active(false);
    this.update_hud();
  } // end function

  /**
   * FPS PREVIEW: fire the shotgun if the pump delay allows. PELLETS rays leave the eye with a random
   * spread; each is tested against the birds' bounding spheres, and every bird hit by at least
   * one pellet falls. returns the number of birds hit, or -1 when the gun was not ready.
   */
  fire() {
    if (!this.active || !this.shotgun.can_fire()) return -1;
    this.shotgun.fire();
    play_shotgun(); // AUDIO: blast on every shot that actually fires

    const origin = this.player.eye();
    const { right, up, fwd } = this.player.basis();
    let hit_birds = 0;
    for (let i = 0; i < PELLETS; i++) {
      // random point in a disc around the aim line
      const angle = Math.random() * Math.PI * 2;
      const r = PELLET_SPREAD * Math.sqrt(Math.random());
      const sx = Math.cos(angle) * r, sy = Math.sin(angle) * r;
      const d = [0, 1, 2].map((k) => fwd[k] + right[k] * sx + up[k] * sy);
      const len = Math.hypot(...d);
      const dir = d.map((v) => v / len);

      const bird = this.flock.raycast(origin, dir, SHOT_RANGE);
      if (bird) {
        this.flock.kill(bird);
        hit_birds += 1;
      } // end if
    } // end loop

    this.kills += hit_birds;
    this.update_hud(hit_birds > 0);
    return hit_birds;
  } // end function

  /**
   * FPS PREVIEW: per-frame on-foot update + camera. runs from render().
   */
  fps_tick(frontend_data) {
    const now_ms = performance.now();
    // the transition normally calls on_enter(); if render() restarts after a pause with no hook, enter here.
    if (!this.active && now_ms - this.last_render_ms > 600) this.on_enter();
    this.last_render_ms = now_ms;

    const t = frontend_data.delta_time || 0;
    const dt = this.last_time === null ? 0 : Math.min(0.05, Math.max(0, t - this.last_time));
    this.last_time = t;

    if (this.active) {
      this.player.update(dt);
      if (this.player.locked && this.player.mouse_down) this.fire(); // hold to keep firing, the pump delay paces it
      this.flock.update(dt, this.player.pos);
    } // end if

    // camera + gun follow the player (also while inactive, e.g. during the fade, so nothing jumps)
    const eye = this.player.eye();
    const { fwd } = this.player.basis();
    this.camera.set_look_at(eye, [eye[0] + fwd[0], eye[1] + fwd[1], eye[2] + fwd[2]]);
    this.shotgun.update(dt, eye, this.player.yaw, this.player.pitch, this.player.bob);
  } // end function

  /**
   * FPS PREVIEW: DOM crosshair, kill counter and "click to capture" prompt, laid over the canvas.
   */
  build_hud(canvas) {
    const holder = canvas.parentElement;
    if (getComputedStyle(holder).position === "static") holder.style.position = "relative";
    const base = "position:absolute;pointer-events:none;display:none;";

    this.hud = {};
    this.hud.crosshair = document.createElement("div");
    this.hud.crosshair.style.cssText = base +
      "left:50%;top:50%;width:14px;height:14px;margin:-9px 0 0 -9px;border:2px solid rgba(255,255,255,0.85);" +
      "border-radius:50%;box-shadow:0 0 3px #000;";
    const dot = document.createElement("div");
    dot.style.cssText = "position:absolute;left:50%;top:50%;width:2px;height:2px;margin:-1px 0 0 -1px;background:#fff;";
    this.hud.crosshair.appendChild(dot);

    this.hud.counter = document.createElement("div");
    this.hud.counter.style.cssText = base +
      "left:12px;top:12px;padding:4px 10px;border-radius:4px;background:rgba(0,0,0,0.55);color:#fff;font:14px sans-serif;";

    this.hud.prompt = document.createElement("div");
    this.hud.prompt.style.cssText = base +
      "left:50%;bottom:48px;transform:translateX(-50%);padding:6px 14px;border-radius:4px;" +
      "background:rgba(0,0,0,0.6);color:#fff;font:15px sans-serif;white-space:nowrap;";
    this.hud.prompt.textContent = "Click to capture the mouse - WASD move, mouse look, click shoot, Q return to space";

    holder.appendChild(this.hud.crosshair);
    holder.appendChild(this.hud.counter);
    holder.appendChild(this.hud.prompt);
  } // end function

  /**
   * FPS PREVIEW: refresh the HUD. hit = true flashes the crosshair red (a bird was hit).
   */
  update_hud(hit = false) {
    if (!this.hud) return;
    const show = this.active ? "block" : "none";
    this.hud.crosshair.style.display = show;
    this.hud.counter.style.display = show;
    this.hud.prompt.style.display = this.active && !this.player.locked ? "block" : "none";
    this.hud.counter.textContent = `Birds shot: ${this.kills}   Wave ${this.flock.wave}`;
    this.hud.crosshair.style.borderColor = hit ? "rgba(255,60,60,1)" : "rgba(255,255,255,0.85)";
    if (hit) setTimeout(() => { if (this.hud) this.hud.crosshair.style.borderColor = "rgba(255,255,255,0.85)"; }, 150);
  } // end function

  /**
   * called once every rendering call from index.html.
   * this is where any global game logic, scene component updates
   * should be occurring that need per-render-call updates.
   */
  render(frontend_data={}) {
    // yada yada, do whatever the scene needs to do at a global scale,
    // such as run collision detection with player, did i hit a boid, etc.
    this.fps_tick(frontend_data); // FPS PREVIEW: walk, birds, camera, gun
    super.render(this.profile.horizon);  // TRANSITION PREVIEW: clear color = the planet's horizon color (the sky quad paints over it; was a flat sky blue)
  } // end function

} // end class
