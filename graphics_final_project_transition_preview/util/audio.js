// Sound effects, synthesized with the Web Audio API. No audio files.
//
//   play_shotgun()      punchy blast: noise crack + filtered noise tail + low thump
//   play_world_entry()  whoosh and riser that settle into a short ambient chord
//
// Browsers keep an AudioContext suspended until the user has interacted with the page. This module
// listens for the first pointer / key / touch event and resumes the context then. A world-entry
// sound requested before that (a direct ?scene=earth load) is held and played at the unlock, as long
// as that happens within ENTRY_HOLD_SECONDS; a shotgun blast is simply skipped (the player is clicking anyway).

const ENTRY_HOLD_SECONDS = 30;

let ctx = null;
let master = null;
let noise = null;          // one shared second of white noise
let entry_pending_at = null; // performance.now() of a held world-entry sound

function ensure_context() {
  if (ctx) return ctx;
  const Ctor = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
  if (!Ctor) return null;
  ctx = new Ctor();
  const comp = ctx.createDynamicsCompressor();
  master = ctx.createGain();
  master.gain.value = 0.7;
  master.connect(comp);
  comp.connect(ctx.destination);

  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return ctx;
} // end function

/** resume the context (needs a user gesture the first time). returns true when it is running. */
function running() {
  const c = ensure_context();
  if (!c) return false;
  if (c.state !== "running") c.resume().catch(() => {});
  return c.state === "running";
} // end function

function unlock() {
  const c = ensure_context();
  if (!c) return;
  c.resume().then(() => {
    if (c.state !== "running") return;
    for (const ev of ["pointerdown", "mousedown", "click", "keydown", "touchstart"]) window.removeEventListener(ev, unlock, true);
    flush_pending_entry();
  }).catch(() => {});
} // end function

/** play a held world-entry sound now, if the context runs and the hold has not expired. */
function flush_pending_entry() {
  if (entry_pending_at === null || !ctx || ctx.state !== "running") return;
  const waited = (performance.now() - entry_pending_at) / 1000;
  entry_pending_at = null;
  if (waited <= ENTRY_HOLD_SECONDS) entry_sound();
} // end function

if (typeof window !== "undefined") {
  for (const ev of ["pointerdown", "mousedown", "click", "keydown", "touchstart"]) window.addEventListener(ev, unlock, true);
} // end if

/** a gain node with an exponential decay from `peak` to silence over `secs`, starting at t. */
function decay_gain(t, peak, secs) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + secs);
  return g;
} // end function

function noise_source(t, secs) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  src.start(t);
  src.stop(t + secs);
  return src;
} // end function

/** shotgun blast, about 0.45 s. */
export function play_shotgun() {
  if (!running()) return false;
  const t = ctx.currentTime;
  const v = 0.92 + Math.random() * 0.16; // slight pitch variation so repeats do not sound identical

  // crack: very short bright noise
  const crack = noise_source(t, 0.06);
  const crack_hp = ctx.createBiquadFilter();
  crack_hp.type = "highpass";
  crack_hp.frequency.value = 2500 * v;
  crack.connect(crack_hp).connect(decay_gain(t, 0.9, 0.05)).connect(master);

  // blast body: noise through a low-pass that closes quickly
  const blast = noise_source(t, 0.4);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(7000 * v, t);
  lp.frequency.exponentialRampToValueAtTime(350, t + 0.3);
  blast.connect(lp).connect(decay_gain(t, 1.0, 0.35)).connect(master);

  // thump: sine drop
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(170 * v, t);
  osc.frequency.exponentialRampToValueAtTime(38, t + 0.22);
  osc.connect(decay_gain(t, 1.0, 0.28)).connect(master);
  osc.start(t);
  osc.stop(t + 0.3);
  return true;
} // end function

/** whoosh + riser into a soft chord, about 3.5 s. */
function entry_sound() {
  const t = ctx.currentTime;
  const rise = 1.5;

  // whoosh: band-passed noise sweeping upward, swelling then fading
  const whoosh = noise_source(t, rise + 0.9);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(180, t);
  bp.frequency.exponentialRampToValueAtTime(2600, t + rise);
  const wg = ctx.createGain();
  wg.gain.setValueAtTime(0.0001, t);
  wg.gain.exponentialRampToValueAtTime(0.7, t + rise);
  wg.gain.exponentialRampToValueAtTime(0.0001, t + rise + 0.9);
  whoosh.connect(bp).connect(wg).connect(master);

  // riser: saw glide, low-passed
  const saw = ctx.createOscillator();
  saw.type = "sawtooth";
  saw.frequency.setValueAtTime(90, t);
  saw.frequency.exponentialRampToValueAtTime(440, t + rise);
  const saw_lp = ctx.createBiquadFilter();
  saw_lp.type = "lowpass";
  saw_lp.frequency.setValueAtTime(300, t);
  saw_lp.frequency.exponentialRampToValueAtTime(2200, t + rise);
  const sg = ctx.createGain();
  sg.gain.setValueAtTime(0.0001, t);
  sg.gain.exponentialRampToValueAtTime(0.16, t + rise);
  sg.gain.exponentialRampToValueAtTime(0.0001, t + rise + 0.4);
  saw.connect(saw_lp).connect(sg).connect(master);
  saw.start(t);
  saw.stop(t + rise + 0.5);

  // settling chord (A minor add9): slow attack, long release
  const chord_t = t + rise - 0.1;
  const chord_lp = ctx.createBiquadFilter();
  chord_lp.type = "lowpass";
  chord_lp.frequency.value = 1800;
  chord_lp.connect(master);
  for (const f of [110, 220, 261.63, 329.63, 493.88]) {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, chord_t);
    g.gain.exponentialRampToValueAtTime(0.1, chord_t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, chord_t + 2.4);
    o.connect(g).connect(chord_lp);
    o.start(chord_t);
    o.stop(chord_t + 2.5);
  } // end loop
} // end function

/**
 * world entry sound. plays now when the browser allows audio, otherwise it is held until the
 * first user gesture. returns true when it started immediately.
 */
export function play_world_entry() {
  if (running()) {
    entry_sound();
    return true;
  } // end if
  entry_pending_at = performance.now();
  if (ctx) ctx.resume().then(flush_pending_entry).catch(() => {}); // some browsers allow it without a gesture
  return false;
} // end function

