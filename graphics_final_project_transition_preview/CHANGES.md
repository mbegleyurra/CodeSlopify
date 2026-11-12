# Space -> planet transition preview

Everything here is in the preview copy only. The original repo is untouched. Every edit is
tagged `// TRANSITION PREVIEW` (search for that string to find all of them).

## Behavior

- Opens in the outer-space scene. `?scene=earth` jumps straight to the bird scene, `?scene=space` still works.
- The **target planet** defaults to **Mars**. `?planet=<name>` picks any of the eight (case-insensitive):
  `index.html?planet=venus`, `?planet=Neptune`, ... An unknown name logs a warning and falls back to the default.
  `?scene=earth&planet=jupiter` shows Jupiter's backdrop directly.
- **E** or a **click on the canvas**: the camera flies about 2.8 s (eased) toward the target planet, chasing its live
  orbiting position, until it fills the frame. Then a 0.5 s fade through that planet's fade color
  (0.25 s out, 0.25 s in) lands in the bird scene.
- The bird scene now draws that planet's own backdrop: a sky gradient, a textured ground (or a banded cloud deck
  for the gas/ice giants), fog into the horizon. The boid cones draw on top.
- **Q** in the bird scene: fades back to space with the camera reset to the default view.
- The bird scene (`EarthScene`) is `init()`ed once, only when first needed. Space is never re-initialized (both
  checks use the scenes' own `initialized` flag). If you start with `?scene=earth`, space is initialized on the first Q.
  Changing the target between visits updates the backdrop in place (`set_planet`), nothing is re-created.
- On-screen hints: "Press E / click to land on Mars" (name follows the target), "Press Q to return to space".

## Planet profiles (`planetary_duck_hunt/planet_profiles.js`)

Fictional system, so these are stylized guesses at each atmosphere, not science. Colors are RGB 0..1; the full
numbers are in the file.

| Planet  | Surface    | Sky (horizon -> zenith)            | Ground / deck tint     | Notes                              |
|---------|------------|------------------------------------|------------------------|------------------------------------|
| Mercury | solid      | near black -> black                | grey                   | no atmosphere                      |
| Venus   | solid      | thick yellow haze -> amber         | orange-brown           | haze 2.2, fog starts at 6          |
| Earth   | solid      | pale blue -> deep blue             | slightly green         | clear air                          |
| Mars    | solid      | butterscotch -> dusty brown        | dusty orange           | default target                     |
| Jupiter | cloud deck | tan -> dark brown                  | warm cream bands       | deck 14 units below, no solid ground |
| Saturn  | cloud deck | pale gold -> olive brown           | pale gold bands        | same                               |
| Uranus  | cloud deck | pale cyan -> teal                  | cyan bands             | same                               |
| Neptune | cloud deck | bright blue -> near-black navy     | blue bands (tint > 1)  | same                               |

Each profile also has `fade` (screen fade color), `haze` (gradient curve), `ground_depth`, `fog [start, end]`,
`tile` (texture repeats per world unit) and `texture_path` (the planet's existing `outer_world/textures/` file,
the same one the space scene uses; no new assets).

## How the backdrop is drawn

Roots of `EarthScene`, in draw order: `sky`, `ground`, `boids`.

1. **sky**: a clip-space quad, shader `sky_gradient`. Depth test and depth writes are off while it draws. Color
   depends only on screen height: flat horizon color below `horizon_y`, blended up to the zenith color above it.
   `horizon_y` is computed from `ground_depth`, `fog[1]` and the camera fov, so it lines up with where the ground
   fades out.
2. **ground**: a 300 x 160 unit plane, shader `ground_plane`. Texture coordinates come from world x/z (tiled,
   mirrored repeat so there are no seams), multiplied by the tint, then fogged to the horizon color by view depth.
   Gas giants use the same node placed lower, with a stretched tile so their bands read as long stripes in depth.
3. **boids**: unchanged (phong cones).

## Files

### NEW `planetary_duck_hunt/planet_profiles.js`
The table above plus `get_planet_profile(name)` (case-insensitive, `null` if unknown). **Port:** copy as is. Edit
colors freely; to add a planet, add one entry and one `PlanetData` row.

### NEW `util/scene_transition.js`
The whole state machine (`space -> flying -> fade_out -> swap -> fade_in -> landed`, and back), the chase camera,
and the DOM fade overlay and hint. It needs no renderer changes; the fade is a `<div>` over the canvas.
`TARGET_PLANET` is the constant at the top. Methods: `request_landing(planet_name?)`, `request_return()`,
`set_target(name)`. **Port:** copy the file. It depends on `planet_profiles.js`, `scene.init`, `scene.initialized`,
`scene.render`, `space.camera`, `space.solar_system.planets` (finds the node whose `data.name` equals the profile
name) and `earth.set_planet`.
Small planets: during the flight the space camera's `near` plane is pulled in (Mercury's front surface would
otherwise sit inside the default 0.1) and restored when you return to space.

### `util/shader_sources.js` (appended at the bottom)
Two new source dicts: `sky_gradient` and `ground_plane`. **Port:** paste the block at the end of the file.

### `util/shaders.js`
- Imports `transform_point` (see the sun-light item below).
- New `SkyShader` and `GroundShader` classes, declared just above `SHADER_MAP`.
- `SHADER_MAP` gets `"sky_gradient"` and `"ground_plane"`.
- `PlanetShader.load` passes the sun light position through the camera view matrix
  (`transform_point(camera.get_view_matrix(), sun_light.position)`). Reason: the planet shader lights in view
  space and the sun position is a world-space point; with the old identity view they were the same, but once the
  camera moves the lighting would stay glued to the screen. Identity view = unchanged result. Needed only if you
  keep a moving camera in space.

**Port:** the classes, the two map entries, the import, and the one lighting line.

### `planetary_duck_hunt/earth_scene.js`
Class name kept. New: `profile`, `sky`, `ground`, `textures` fields; `init_backdrop()` (called in `init()` before
`init_boids()` so the backdrop draws first); `set_planet(profile or name)`; `apply_profile()`;
`get_ground_texture(path)` (one cached `Texture` per path). `render()` clears with the profile's horizon color instead
of the old flat sky blue. With no `set_planet` call it defaults to the Earth profile.
**Port:** the whole file diff, or just the added methods plus the `init_backdrop()` call.

### `util/transitions.js` (appended at the bottom)
Added `lookAt(eye, target, up)` and `transform_point(matrix, p)`. `lookAt([0,0,0], [0,0,-1])` is exactly the
identity matrix, so default framing is unchanged. **Port:** paste the two functions at the end of the file.

### `util/scene_graph.js`
- Imports `lookAt`.
- `Camera` gets `eye`, `target`, `view_matrix` (null by default), plus `set_look_at(eye, target, up)` and
  `reset_view()`. `get_view_matrix()` now returns `this.view_matrix || mat4Identity()`, so any scene that never
  calls `set_look_at` renders as before.
- Removed the stray `console.log("askjdnas")` in `Mesh`.

**Port:** the import line, the three fields in the `Camera` constructor, and the three methods. The console.log removal is independent.

### `index.html` (inline module)
- Imports `SceneTransition`.
- Default scene is space (`curr_scene = space; next_scene = earth;`); `?scene=earth` flips it.
- Creates `const transition = new SceneTransition({...})` right after the first `curr_scene.init(...)`.
- The render loop calls `transition.render(frontend_data)` instead of `curr_scene.render(frontend_data)`.

No change in this pass. **Port:** these four small edits; the commented-out `is_over` block in the loop is left alone.

## Porting order (suggested)

1. `util/transitions.js` + `util/scene_graph.js` camera pieces (needed by the fly-in).
2. `util/shader_sources.js` + `util/shaders.js` backdrop shaders (only if you want the landing backdrop).
3. `planetary_duck_hunt/planet_profiles.js` + `earth_scene.js` changes.
4. `util/scene_transition.js` + the four `index.html` edits.

## Tunables

- `util/scene_transition.js`: `TARGET_PLANET` (default "Mars"), `FLY_SECONDS` (2.8), `FADE_SECONDS` (0.5).
- `planet_profiles.js`: every color, `haze`, `ground_depth`, `fog`, `tile`.

## Known limits

- The flight is a straight line from the start eye toward the planet. It does not avoid other planets or the sun.
- The overlay is a DOM element, so it covers only the canvas area, not the whole window.
- The planet's world position is read from the node's `transformation_matrix` as computed on the previous frame, so
  the chase lags by one frame (not visible at this speed).
- The sky is screen-space, so it does not rotate with the camera. The bird scene camera is fixed, so this is fine
  today; if you add camera look-around there, the sky needs a direction-based version.
- No stars, sun disc, or other planets in the landing sky yet (Mercury's black sky is the most obvious place for them).
- The bird scene still has the original placeholder gameplay (a few cones); this only adds the arrival and backdrop.
- The ground shader samples only the middle 20%..80% of the planet texture's height (triangle-wave fold in `ground_plane`'s fragment shader), because equirectangular textures have bright polar caps that showed up as a cream stripe at the horizon when tiles mirrored.
- Verified: `node --check` on every touched JS file and the inline module; profile data check; headless browser load of `?scene=earth&planet=mars` with no console errors, and a screenshot showing the Mars sky gradient, textured ground, horizon fog and cones (after the polar-cap fix). NOT browser-verified: Mercury, Venus, Earth and the four cloud-deck giants (Jupiter, Saturn, Uranus, Neptune), and the fly-in itself. The test browser refused further local URLs mid-run.


## Spaceship (SHIP PREVIEW)

Every edit is tagged `// SHIP PREVIEW`. The player now flies a low-poly ship in the space scene and lands with E.

### Behavior
- **W/S** thrust forward/back (inertia, max speed), **A/D** yaw, **mouse** (click canvas for pointer lock) or **arrow keys** pitch/yaw, **Shift** boost.
- Third-person smoothed chase camera via `Camera.set_look_at`.
- Within range of a planet the hint reads "Press E to land on <Name>"; **E** lands on that planet (all 8 work). Elsewhere a controls hint shows.
- Click-to-land and the fixed target are gone. `?planet=` still sets the backdrop for `?scene=earth` jumps.
- Push-out sphere collision with the sun and all planets, plus a soft world limit.
- **Q** in the planet scene returns the ship just outside that planet, nose pointing away, instead of resetting the camera.

### Files
- NEW `outer_world/spaceship.js`: model (cone fuselage, cube wings/fin/canopy/engine), controller, collision, nearest-planet probe, `place_outside`. All tunables are in `SHIP_TUNABLES` at the top.
- `util/scene_transition.js`: creates the ship, E handler (`request_landing_nearest`), proximity hint, return placement, hooks.
- `util/shaders.js`: new `ShipPhongShader` (`phong_ship`): phong with positional lights moved into view space (the stock phong shader cannot take the FillLight and ignores the camera view).
- `index.html`: one line exposing `window.SHIP_PREVIEW = { transition, space, earth }` for console checks.

### Tunables (`SHIP_TUNABLES`)
`MAX_SPEED` (8), `ACCEL`, `DRAG`, `BOOST`, `YAW_RATE`, `MOUSE_SENS`, chase camera (`CHASE_BACK/UP/LOOK`, `CAM_FOLLOW`), `LAND_MARGIN` (4) and `LAND_SPEED_BONUS`, `RETURN_GAP`, `WORLD_LIMIT`, `FAR_PLANE` (the ship raises the space camera far plane to 400).

### Hooks for the on-foot FPS / shotgun
- The transition calls `earth.on_enter?.({ planet })` after landing and `earth.on_exit?.()` when Q starts the return.
- The ship reads input only in the `space` state (`activate()` / `deactivate()`), clears held keys on landing, and registers no WASD/E/Q/mouse handling that fires in the planet scene. Pointer lock is requested only while the ship is active.
- The ship's key listeners stay attached to `window` but are inert while inactive. The E and Q handlers in `SceneTransition` are gated by state.

### Porting
Copy `outer_world/spaceship.js`, the `ShipPhongShader` class and its `SHADER_MAP` entry, and the `scene_transition.js` changes. Needs `lookAt`/`set_look_at` from the earlier transition work.

### Verified
Headless browser on `http://127.0.0.1:8441`: no console messages; real E/Q key events landed on and returned from all 8 planets (Mercury through Neptune), ship hidden while landed and active again on return; W thrust moved the ship 9.1 units in 1.7 s. NOT verified: `node --check` (node is not installed on this machine's PATH; module loading in the browser was the syntax check), mouse pointer-lock flight, Shift boost, and sun collision by hand.


## On-foot + shotgun

Every edit is tagged `// FPS PREVIEW` (search for that string). The original repo is untouched.
This supersedes two of the "Known limits" above: the sky is now direction-based (`sky_dir`), and the bird scene has
real gameplay (shootable birds) instead of placeholder cones.

### What you get on landing (any of the eight planets)

- First person on foot. WASD walks relative to where you look; mouse look needs a click on the canvas first
  (pointer lock; that first click only captures the mouse); pitch is clamped; Space jumps; eye height 1.7.
  On solid planets you can walk 90 units from the landing spot. On the gas / ice giants (cloud deck, no ground) a
  grey landing platform (radius 12) sits at your feet and you cannot leave it.
- The sky is direction-based (new `sky_dir` shader): it rebuilds each pixel's world view direction from the camera
  axes, so the horizon stays put when you look up, down or around. The ground is a 400-unit square around the landing
  spot, so its edge is never reachable.
- A low-poly shotgun (cylinders for barrel / magazine tube / pump, cubes for receiver / stock / grip) sits lower
  right, attached to the camera. It draws on top of everything through the `phong_viewmodel` shader, which clears
  the depth buffer before the first gun part. Firing gives a recoil kick and a pump slide.
- Left click while the mouse is captured fires 8 pellets in a ~2.3 degree spread. Each pellet is a ray tested
  against every bird's bounding sphere (range 80). A hit bird tumbles, shrinks and is removed after 0.8 s. Holding
  the button keeps firing, paced by the 0.8 s pump delay. No ammo limit, no aim-down-sights.
- 20 birds wander around you in plain JS (steer toward a random waypoint, cone turned to point along its velocity).
  When all are shot, a new wave spawns after 1.5 s. The C/WASM flocking is not merged and is not used.
- HUD: center crosshair (flashes red on a hit), a "Birds shot / Wave" counter, and a prompt ("Click to capture the
  mouse - WASD move, mouse look, click shoot, Q return to space") shown until the mouse is captured.

### Hooks

- `EarthScene.on_enter()` (called by `SceneTransition` after landing): resets the player, wave and counter, input on.
  `EarthScene.on_exit()` (called when Q starts the return): input off, held keys cleared, pointer lock released, HUD hidden.
- `EarthScene` owns its input listeners and ignores them while inactive, so in space WASD belongs to the ship only.
- Fallbacks so `?scene=earth` works with no hook: the first rendered frame enters on-foot mode, and if `render()`
  stops being called without `on_exit()` (scene swapped away) a 250 ms watchdog switches it off.
- `scene_transition.js` and `index.html` were NOT edited for this feature.
- Debug handle: `window.__earth_scene` (used by the browser checks; remove if you do not want it).

### Files

New: `planetary_duck_hunt/fps_player.js`, `planetary_duck_hunt/shotgun.js`, `planetary_duck_hunt/bird_flock.js`.
Edited: `planetary_duck_hunt/earth_scene.js` (fov, ground size, platform, flock instead of placeholder cones, fps / HUD
methods, `render()` hook), `util/shaders.js` (`SkyDirShader`, `ViewmodelShader`, two `SHADER_MAP` entries),
`util/shader_sources.js` (`sky_dir`, appended).

### Tuning

`fps_player.js`: `WALK_SPEED`, `JUMP_SPEED`, `MOUSE_SENS`. `shotgun.js`: `OFFSET` (gun position on screen; the gun is
bulky at the default), `PUMP_DELAY`. `earth_scene.js`: `PELLETS`, `PELLET_SPREAD`, `SHOT_RANGE`, `DECK_PLATFORM_RADIUS`,
`GROUND_BOUNDS`. `bird_flock.js`: `WAVE_SIZE`, `HIT_RADIUS`, bird speeds.

### Known limits

- If frames stop for more than 600 ms (for example a backgrounded tab) and then resume, the scene re-enters on-foot
  mode and resets the player, wave and counter.
- Birds only wander; no real flocking, and they do not react to shots.

### Verified

`node --check` on earth_scene.js, fps_player.js, shotgun.js, bird_flock.js, shaders.js, shader_sources.js (all OK).
Headless browser on `http://127.0.0.1:8442`, no console messages on `?scene=earth&planet=mars` and
`?scene=earth&planet=jupiter`. On Mars: 20 birds spawned; an aimed shot hit 1 bird, a second shot during the pump delay
was refused, the counter went to 1, the fallen bird was removed; W moved the player along the view heading. On Jupiter:
walk radius clamped to the 11.2 platform, jump peaked at about 0.9 and landed, screenshot showed the direction-based sky,
platform, shotgun on top and crosshair. `on_exit()` turned input and HUD off (held W moved nothing); `on_enter()` gave a
fresh wave of 20 and a zero counter. A first-frame bug (on-foot mode not starting on fast loads) was found and fixed.
NOT verified: the real E landing and Q return path end to end with my hooks (the hook calls were read in
`scene_transition.js` and exercised by calling `on_enter` / `on_exit` directly), actual pointer-lock mouse look and
click firing (the test browser emulates pointer lock), new-wave respawn after clearing all 20, and the other six planets.
