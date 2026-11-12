// ROUND 3 SPACE: a deep-space starfield, drawn as point sprites with its own tiny GL program.
//
// How it stays out of the way:
//  - every star is a unit direction pushed out to a fixed radius and viewed with the camera's
//    ROTATION only (translation zeroed), so stars follow where you look but never get closer.
//  - gl_Position.z is forced to just behind the far plane and the depth test is LEQUAL, so the stars
//    only show where nothing else was drawn. Call draw() AFTER the scene; the sun, planets and ship
//    always win. Depth writes are off, so nothing else is affected.
//  - it uses its own VAO and restores blend/depth state, so the other shaders see unchanged GL state.
//
// Content: ~5000 scattered stars (white, blue-white, warm yellow, a few orange) with varied
// brightness/size and a gentle twinkle, a denser faint Milky-Way band along a tilted great circle,
// and a few dozen big, very faint "haze" sprites along the band for a nebula-ish glow.

const VERT = `#version 300 es
uniform mat4 uProj;
uniform mat4 uView;
uniform float uRadius;
uniform float uScale;
uniform float uTime;
in vec3 aDir;
in vec2 aParams;   // x = size in px (at 1080p), y = per-star seed
in vec4 aColor;    // rgb tint, a = brightness
out vec4 vColor;
out float vHaze;
void main() {
  mat4 v = uView;
  v[3] = vec4(0.0, 0.0, 0.0, 1.0);          // rotation only: the stars sit at infinity
  vec4 p = uProj * v * vec4(aDir * uRadius, 1.0);
  p.z = p.w * 0.999999;                      // just behind everything else
  gl_Position = p;
  gl_PointSize = max(1.0, aParams.x * uScale);
  float twinkle = 1.0;
  if (aParams.x < 20.0) {
    twinkle = 0.82 + 0.18 * sin(uTime * (0.8 + fract(aParams.y * 7.13) * 2.4) + aParams.y * 40.0);
  }
  vColor = vec4(aColor.rgb, aColor.a * twinkle);
  vHaze = aParams.x >= 20.0 ? 1.0 : 0.0;
}`;

const FRAG = `#version 300 es
precision mediump float;
in vec4 vColor;
in float vHaze;
out vec4 outColor;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float d = dot(q, q);
  if (d > 1.0) discard;
  float falloff = vHaze > 0.5 ? exp(-d * 3.0) : exp(-d * 2.2);
  outColor = vec4(vColor.rgb * vColor.a * falloff, 1.0);
}`;

function mulberry32(seed) { // small seeded RNG so the sky looks the same every load
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
} // end function

const TINTS = [
  [1.00, 1.00, 1.00],   // white
  [0.72, 0.82, 1.00],   // blue-white
  [1.00, 0.90, 0.66],   // warm yellow
  [1.00, 0.70, 0.55]    // orange (rare)
];

function pick_tint(rand) {
  const r = rand();
  if (r < 0.45) return TINTS[0];
  if (r < 0.75) return TINTS[1];
  if (r < 0.94) return TINTS[2];
  return TINTS[3];
} // end function

export class Starfield {
  constructor(gl, { stars = 5000, band_stars = 5500, haze = 36, seed = 20261111 } = {}) {
    this.gl = gl;
    const rand = mulberry32(seed);

    const dirs = [];
    const params = [];
    const colors = [];
    const push = (dir, size, star_seed, tint, brightness) => {
      dirs.push(dir[0], dir[1], dir[2]);
      params.push(size, star_seed);
      colors.push(tint[0], tint[1], tint[2], brightness);
    };

    const random_dir = () => {
      const z = rand() * 2 - 1;
      const t = rand() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      return [r * Math.cos(t), z, r * Math.sin(t)];
    };

    // scattered stars: many dim and small, a few bright and larger
    for (let i = 0; i < stars; i++) {
      const k = Math.pow(rand(), 3.2);                 // brightness skewed toward dim
      push(random_dir(), 1.2 + k * 3.4, rand(), pick_tint(rand), 0.30 + k * 0.85);
    } // end loop

    // Milky-Way band: a great circle with a gaussian spread across it, dim and fine
    const normal = (() => { // tilted band normal
      const n = [0.35, 0.82, 0.45];
      const l = Math.hypot(...n);
      return [n[0] / l, n[1] / l, n[2] / l];
    })();
    const ax = (() => { // two axes spanning the band plane
      let a = [normal[1], -normal[0], 0];
      const l = Math.hypot(...a);
      a = [a[0] / l, a[1] / l, a[2] / l];
      return a;
    })();
    const ay = [
      normal[1] * ax[2] - normal[2] * ax[1],
      normal[2] * ax[0] - normal[0] * ax[2],
      normal[0] * ax[1] - normal[1] * ax[0]
    ];
    const gauss = () => (rand() + rand() + rand() + rand() - 2) / 0.58; // ~N(0,1)
    const band_dir = (spread) => {
      const t = rand() * Math.PI * 2;
      const off = gauss() * spread;
      const c = Math.cos(t), s = Math.sin(t);
      const d = [
        ax[0] * c + ay[0] * s + normal[0] * off,
        ax[1] * c + ay[1] * s + normal[1] * off,
        ax[2] * c + ay[2] * s + normal[2] * off
      ];
      const l = Math.hypot(...d);
      return [d[0] / l, d[1] / l, d[2] / l];
    };
    for (let i = 0; i < band_stars; i++) {
      const warm = rand() < 0.35;
      const tint = warm ? [1.0, 0.88, 0.72] : [0.78, 0.86, 1.0];
      push(band_dir(0.12), 1.0 + rand() * 1.6, rand(), tint, 0.18 + rand() * 0.4);
    } // end loop

    // a few big faint haze sprites along the band (size >= 20 marks them as haze in the shader)
    const max_point = (gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) || [1, 64])[1];
    for (let i = 0; i < haze; i++) {
      const size = Math.min(max_point, 36 + rand() * 40);
      const cool = rand() < 0.6;
      const tint = cool ? [0.45, 0.55, 0.95] : [0.85, 0.50, 0.75];
      push(band_dir(0.10), Math.max(20, size), rand(), tint, 0.05 + rand() * 0.05);
    } // end loop

    this.count = dirs.length / 3;

    // program
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("starfield shader: " + gl.getShaderInfoLog(s));
      return s;
    };
    this.program = gl.createProgram();
    gl.attachShader(this.program, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(this.program, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error("starfield link: " + gl.getProgramInfoLog(this.program));

    this.u = {
      proj: gl.getUniformLocation(this.program, "uProj"),
      view: gl.getUniformLocation(this.program, "uView"),
      radius: gl.getUniformLocation(this.program, "uRadius"),
      scale: gl.getUniformLocation(this.program, "uScale"),
      time: gl.getUniformLocation(this.program, "uTime")
    };

    // buffers live in a VAO of their own so the shared attribute state used by the other shaders is untouched
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const attr = (name, data, size) => {
      const loc = gl.getAttribLocation(this.program, name);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    attr("aDir", dirs, 3);
    attr("aParams", params, 2);
    attr("aColor", colors, 4);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  } // end constructor

  /** draw after the scene. camera = the scene camera; time in seconds drives the twinkle. */
  draw(camera, time = 0) {
    const gl = this.gl;
    const radius = Math.max(camera.near * 10, camera.far * 0.45);

    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.u.proj, false, camera.get_projection_matrix());
    gl.uniformMatrix4fv(this.u.view, false, camera.get_view_matrix());
    gl.uniform1f(this.u.radius, radius);
    gl.uniform1f(this.u.scale, gl.drawingBufferHeight / 1080);
    gl.uniform1f(this.u.time, time);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);   // only where the scene left the depth buffer at 1.0
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.POINTS, 0, this.count);
    gl.bindVertexArray(null);

    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.depthFunc(gl.LESS);     // the WebGL default the other shaders rely on
  } // end function
} // end class
