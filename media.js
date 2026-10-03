'use strict';
/*
 * Boakcode costumes and sounds.
 *
 * Costumes (sprite.costumes, current one at sprite.costumeIndex):
 *   { name, kind: 'emoji', emoji }
 *   { name, kind: 'image', dataURL, w, h, cx, cy }  — painted or imported. Stored cropped to the
 *     painted pixels; (cx, cy) is where the costume's centre (the sprite's position) falls in it.
 * Sounds (sprite.sounds):
 *   { name, kind: 'made', instrument, tempo, length, notes: [[step, row], ...] }  — made in the
 *     sound maker, always editable.
 *   { name, kind: 'imported', dataURL, duration }  — imported from a file; can be played,
 *     renamed or deleted, but not edited.
 *
 * Loaded before app.js; everything here is only called after app.js has booted.
 */

const PAINT_W = 480, PAINT_H = 360;
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const BIG_MEDIA_CHARS = 2500000; // about 1.8 MB once decoded; browser storage may not fit it
const SOUND_INSTRUMENTS = ['piano', 'organ', '8-bit', 'bass', 'bell'];
const SOUND_LENGTHS = [8, 16, 32];
const MAX_SOUND_STEPS = 32;
const SOUND_SCALE = [84, 83, 81, 79, 77, 76, 74, 72, 71, 69, 67, 65, 64, 62, 60]; // C6 down to C4, C major
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const noteLabel = midi => NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
const IMAGE_DATA_RE = /^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/;
const AUDIO_DATA_RE = /^data:(audio|video)\/[\w.+-]+(;[\w.+-]+=[\w.+-]+)*;base64,[A-Za-z0-9+/=]+$/;
const PICTOGRAPHIC_RE = /\p{Extended_Pictographic}/u;
const validBase64 = dataURL => (dataURL.length - dataURL.indexOf(',') - 1) % 4 === 0;

// Values cached on costumes/sounds (decoded images and audio) must never be saved.
function setHidden(obj, key, value) {
  Object.defineProperty(obj, key, { value, configurable: true, writable: true, enumerable: false });
}

const MAX_MEDIA_NAME = 40;
function uniqueMediaName(names, base) {
  base = String(base).trim().slice(0, MAX_MEDIA_NAME) || 'item';
  if (!names.includes(base)) return base;
  const m = /^(.*?)(\d+)$/.exec(base);
  const stem = m ? m[1] : base;
  let n = m ? Number(m[2]) + 1 : 2;
  const make = k => stem.slice(0, MAX_MEDIA_NAME - String(k).length) + k;
  while (names.includes(make(n))) n++;
  return make(n);
}
const fileBaseName = name => String(name || '').replace(/\.[^.]+$/, '').slice(0, 40).trim();

// ---------------------------------------------------------------------------
// Costume model
// ---------------------------------------------------------------------------
const currentCostume = s => s.costumes[s.costumeIndex] || s.costumes[0];
// What the sprite shows right now: its costume, or an emoji a script switched to that isn't
// one of its costumes (kept only while the page is open, so scripts never change the saved
// costume list — e.g. the library's "switch to a random animal").
const displayCostume = s => (s._emoji ? { name: s._emoji, kind: 'emoji', emoji: s._emoji } : currentCostume(s));
function setCostumeIndex(s, i) {
  if (s.costumeIndex !== i || s._emoji) uiDirty = true;
  s.costumeIndex = i;
  if (s._emoji) s._emoji = null;
}
const costumeNames = s => s.costumes.map(c => c.name);
const soundNames = s => s.sounds.map(x => x.name);

// sprite.costume (used by extensions) reads the current emoji or costume name, and
// setting it switches costume.
function attachCostumeAccessor(s) {
  Object.defineProperty(s, 'costume', {
    configurable: true,
    enumerable: false,
    get() { const c = displayCostume(this); return c ? (c.kind === 'emoji' ? c.emoji : c.name) : ''; },
    set(v) { switchCostume(this, v); },
  });
  return s;
}

// legacyTexts: for projects from before costume lists, the sprite's old emoji (or text)
// costume and every text its "switch costume to" blocks used. Each becomes a costume named
// after itself, so old scripts and comparisons like costume = 🐶 keep working.
function sanitizeCostumes(list, legacyTexts) {
  const out = [];
  for (const c of Array.isArray(list) ? list : []) {
    if (!c || typeof c !== 'object') continue;
    const name = uniqueMediaName(out.map(x => x.name), String(c.name || 'costume1'));
    if (c.kind === 'image') {
      const ok = typeof c.dataURL === 'string' && IMAGE_DATA_RE.test(c.dataURL);
      out.push({
        name, kind: 'image',
        dataURL: ok ? c.dataURL : '',
        w: ok ? clamp(Math.round(num(c.w)), 0, 4096) : 0,
        h: ok ? clamp(Math.round(num(c.h)), 0, 4096) : 0,
        cx: ok ? num(c.cx) : 0,
        cy: ok ? num(c.cy) : 0,
      });
    } else {
      out.push({ name, kind: 'emoji', emoji: String(c.emoji || '🐱').slice(0, 32) });
    }
  }
  if (!out.length) {
    const texts = (legacyTexts || []).map(t => String(t).trim().slice(0, 32)).filter(Boolean);
    for (const t of texts.length ? texts : []) {
      if (!out.some(c => c.emoji === t)) out.push({ name: uniqueMediaName(out.map(x => x.name), t), kind: 'emoji', emoji: t });
    }
    if (!out.length) out.push({ name: 'costume1', kind: 'emoji', emoji: '🐱' });
  }
  return out;
}

// Literal texts used by "switch costume to" blocks in a sprite's scripts (for migrating old projects).
function legacyCostumeTexts(scripts) {
  const found = [];
  const walkList = list => { if (Array.isArray(list)) list.forEach(walkB); };
  const walkB = b => {
    if (!b || typeof b !== 'object' || !Array.isArray(b.inputs)) return;
    if (b.type === 'costume' && isPrimitive(b.inputs[0])) {
      const t = String(b.inputs[0]).trim();
      if (t && !isNumeric(t) && [...t].length <= 12 && !found.includes(t)) found.push(t);
    }
    b.inputs.forEach(walkB);
    if (Array.isArray(b.bodies)) b.bodies.forEach(walkList);
  };
  for (const sc of Array.isArray(scripts) ? scripts : []) if (sc) walkList(sc.blocks);
  return found;
}

// Start decoding every image costume straight away, so the first frame (and a stamp) of a
// costume never draws nothing while the picture is still loading.
function preloadCostumes(s) {
  for (const c of s.costumes) if (c.kind === 'image') costumeImage(c);
}
function costumeReady(c) {
  const img = c.kind === 'image' ? costumeImage(c) || c._img : null;
  if (!img || (img.complete && img.naturalWidth)) return Promise.resolve();
  return img.decode().catch(() => {});
}

function sanitizeSounds(list) {
  const out = [];
  for (const x of Array.isArray(list) ? list : []) {
    if (!x || typeof x !== 'object') continue;
    const name = uniqueMediaName(out.map(y => y.name), String(x.name || 'sound1'));
    if (x.kind === 'imported') {
      if (typeof x.dataURL !== 'string' || !AUDIO_DATA_RE.test(x.dataURL) || !validBase64(x.dataURL)) continue;
      out.push({ name, kind: 'imported', dataURL: x.dataURL, duration: Math.max(0, num(x.duration)) });
    } else {
      const length = SOUND_LENGTHS.includes(x.length) ? x.length : 16;
      const seen = new Set();
      const notes = [];
      for (const n of Array.isArray(x.notes) ? x.notes : []) {
        if (!Array.isArray(n)) continue;
        const st = Math.round(num(n[0])), row = Math.round(num(n[1]));
        const key = st + ':' + row;
        // Notes past the current length are kept, so making a sound shorter and then longer
        // again doesn't lose them; they just don't play while they're past the end.
        if (st < 0 || st >= MAX_SOUND_STEPS || row < 0 || row >= SOUND_SCALE.length || seen.has(key)) continue;
        seen.add(key);
        notes.push([st, row]);
      }
      out.push({
        name, kind: 'made',
        instrument: SOUND_INSTRUMENTS.includes(x.instrument) ? x.instrument : 'piano',
        tempo: clamp(Math.round(num(x.tempo) || 120), 40, 300),
        length,
        notes,
      });
    }
  }
  return out;
}

// Switch to a costume by name, by number (1 = first, wrapping like Scratch), or by emoji —
// an emoji with no costume yet is added as a new costume.
// Switch to a costume by name, by number (1 = first, wrapping like Scratch), or by emoji.
// An emoji that isn't one of the sprite's costumes is shown without adding it to the list.
function switchCostume(s, v) {
  if (v && typeof v === 'object') return;
  const key = String(v ?? '').trim();
  if (!key) return;
  const list = s.costumes;
  let i = list.findIndex(c => c.name === key);
  if (i < 0) i = list.findIndex(c => c.kind === 'emoji' && c.emoji === key);
  if (i < 0 && isNumeric(key)) {
    const n = Math.round(Number(key));
    if (!Number.isFinite(n)) return;
    i = (((n - 1) % list.length) + list.length) % list.length;
  }
  if (i >= 0) { setCostumeIndex(s, i); return; }
  if (PICTOGRAPHIC_RE.test(key) && [...key].length <= 12 && s._emoji !== key) {
    setHidden(s, '_emoji', key);
    uiDirty = true;
  }
}
function nextCostume(s) {
  setCostumeIndex(s, (s.costumeIndex + 1) % s.costumes.length);
}

// Costume or sound lists changed: dropdowns in blocks and the open panel need refreshing.
function mediaListChanged(s) {
  paletteDirty = true;
  uiDirty = true;
  if (s === currentSprite()) mediaPanelDirty = true;
  save();
}
// A rename only changes names: refresh drop-downs, but leave the open editor alone.
function mediaRenamed() {
  paletteDirty = true;
  uiDirty = true;
  save();
}

// Rename every block in a sprite's scripts that refers to a costume or sound by name.
function renameMediaRefs(sprite, kind, oldName, newName) {
  const walkList = list => { if (Array.isArray(list)) list.forEach(walkB); };
  const walkB = b => {
    if (!b || typeof b !== 'object' || !Array.isArray(b.inputs)) return;
    const spec = SPECS[b.type];
    if (spec) spec.args.forEach((a, i) => { if (a.k === kind && b.inputs[i] === oldName) b.inputs[i] = newName; });
    b.inputs.forEach(walkB);
    if (Array.isArray(b.bodies)) b.bodies.forEach(walkList);
  };
  for (const sc of sprite.scripts) walkList(sc.blocks);
}

function costumeImage(c) {
  if (c.kind !== 'image' || !c.dataURL) return null;
  if (!c._img || c._img._src !== c.dataURL) {
    const img = new Image();
    img._src = c.dataURL;
    img.onload = () => { uiDirty = true; };
    img.src = c.dataURL;
    setHidden(c, '_img', img);
  }
  return c._img.complete && c._img.naturalWidth ? c._img : null;
}

// Alpha values of an image costume (for clicking exactly on the painted pixels).
function costumeAlpha(c) {
  const img = costumeImage(c);
  if (!img) return null;
  if (c._alphaSrc !== c.dataURL) {
    const cv = document.createElement('canvas');
    cv.width = c.w;
    cv.height = c.h;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, c.w, c.h);
    const d = g.getImageData(0, 0, c.w, c.h).data;
    const a = new Uint8Array(c.w * c.h);
    for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
    setHidden(c, '_alpha', a);
    setHidden(c, '_alphaSrc', c.dataURL);
  }
  return c._alpha;
}

function costumeThumb(c, cls) {
  if (c.kind === 'image') {
    if (!c.dataURL) return el('span', cls + ' thumb-empty', '');
    const img = el('img', cls);
    img.src = c.dataURL;
    img.alt = '';
    img.draggable = false;
    return img;
  }
  return el('span', cls + ' thumb-emoji', c.emoji);
}

function loadImageSrc(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That image could not be opened.'));
    img.src = src;
  });
}

function newPaintCanvas() {
  const cv = document.createElement('canvas');
  cv.width = PAINT_W;
  cv.height = PAINT_H;
  return cv;
}

// Store what is on a 480×360 paint canvas into an image costume, cropped to the painted pixels.
function canvasToCostume(cv, c) {
  const { data } = cv.getContext('2d').getImageData(0, 0, PAINT_W, PAINT_H);
  let x0 = PAINT_W, y0 = PAINT_H, x1 = -1, y1 = -1;
  for (let y = 0; y < PAINT_H; y++) {
    for (let x = 0; x < PAINT_W; x++) {
      if (data[(y * PAINT_W + x) * 4 + 3]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) {
    Object.assign(c, { dataURL: '', w: 0, h: 0, cx: 0, cy: 0 });
  } else {
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    out.getContext('2d').drawImage(cv, x0, y0, w, h, 0, 0, w, h);
    Object.assign(c, { dataURL: out.toDataURL('image/png'), w, h, cx: PAINT_W / 2 - x0, cy: PAINT_H / 2 - y0 });
  }
  if (c._img) c._img = null;
  costumeImage(c); // start decoding the new picture now
}

async function costumeToCanvas(c, cv) {
  const g = cv.getContext('2d');
  g.clearRect(0, 0, PAINT_W, PAINT_H);
  if (c.kind === 'image' && c.dataURL) {
    const img = await loadImageSrc(c.dataURL);
    g.drawImage(img, PAINT_W / 2 - c.cx, PAINT_H / 2 - c.cy);
  } else if (c.kind === 'emoji') {
    g.font = `48px ${EMOJI_FONT}`;
    // Long emoji text is shrunk so none of it is cut off at the canvas edges.
    const px = Math.max(4, Math.floor(48 * Math.min(1, (PAINT_W - 8) / Math.max(1, g.measureText(c.emoji).width))));
    g.font = `${px}px ${EMOJI_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(c.emoji, PAINT_W / 2, PAINT_H / 2 + px * 0.06);
  }
}

async function imageFileToCostume(file, names) {
  if (file.size > MAX_IMPORT_BYTES) throw new Error(`"${file.name}" is too big — the limit is 10 MB.`);
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImageSrc(url);
    let w = img.naturalWidth || 240, h = img.naturalHeight || 240;
    const k = Math.min(1, PAINT_W / w, PAINT_H / h); // shrink big pictures to fit the stage
    w = Math.max(1, Math.round(w * k));
    h = Math.max(1, Math.round(h * k));
    const cv = newPaintCanvas();
    cv.getContext('2d').drawImage(img, Math.round((PAINT_W - w) / 2), Math.round((PAINT_H - h) / 2), w, h);
    const c = { name: uniqueMediaName(names, fileBaseName(file.name) || 'costume1'), kind: 'image' };
    canvasToCostume(cv, c);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------------------------------------------------------------------------
// Sound playback
// ---------------------------------------------------------------------------
const stepSeconds = snd => 30 / snd.tempo; // each step is an eighth note
const soundDuration = snd => (snd.kind === 'made' ? snd.length * stepSeconds(snd) : num(snd.duration));
const fmtSecs = secs => (Math.round(secs * 100) / 100).toFixed(2) + 's';

function findSound(s, v) {
  if (v && typeof v === 'object') return null;
  const key = String(v ?? '').trim();
  if (!key || !s.sounds.length) return null;
  const byName = s.sounds.find(x => x.name === key);
  if (byName) return byName;
  if (isNumeric(key)) {
    const n = Math.round(Number(key)), len = s.sounds.length;
    return s.sounds[(((n - 1) % len) + len) % len];
  }
  return null;
}

function scheduleInstrumentNote(a, instrument, midi, when, dur, vol) {
  const freq = 440 * Math.pow(2, (midi - 69) / 12);
  const v = Math.max(0.0001, vol);
  const g = a.createGain();
  g.connect(master);
  const oscs = [];
  const osc = (type, f) => {
    const o = a.createOscillator();
    o.type = type;
    o.frequency.value = f;
    oscs.push(o);
    return o;
  };
  let end = when + dur;
  switch (instrument) {
    case 'organ': {
      const g2 = a.createGain();
      g2.gain.value = 0.4;
      osc('sine', freq).connect(g);
      osc('sine', freq * 2).connect(g2).connect(g);
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(v * 0.7, when + 0.02);
      g.gain.setValueAtTime(v * 0.7, when + dur * 0.9);
      g.gain.linearRampToValueAtTime(0, end);
      break;
    }
    case '8-bit':
      osc('square', freq).connect(g);
      g.gain.setValueAtTime(v * 0.3, when);
      g.gain.setValueAtTime(v * 0.3, when + dur * 0.85);
      g.gain.linearRampToValueAtTime(0, end);
      break;
    case 'bass': {
      const f = a.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 700;
      osc('sawtooth', freq / 2).connect(f).connect(g);
      end = when + Math.max(dur, 0.25);
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(v * 0.8, when + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, end);
      break;
    }
    case 'bell': {
      const g2 = a.createGain();
      g2.gain.value = 0.3;
      osc('sine', freq).connect(g);
      osc('sine', freq * 2.76).connect(g2).connect(g);
      end = when + 1.2;
      g.gain.setValueAtTime(v * 0.8, when);
      g.gain.exponentialRampToValueAtTime(0.001, end);
      break;
    }
    default: // piano
      osc('triangle', freq).connect(g);
      end = when + Math.max(0.3, dur * 1.5);
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(v, when + 0.005);
      g.gain.exponentialRampToValueAtTime(0.001, end);
  }
  for (const o of oscs) {
    o.start(when);
    o.stop(end + 0.05);
    track(o);
  }
}

function base64ToArrayBuffer(dataURL) {
  const bin = atob(dataURL.slice(dataURL.indexOf(',') + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

// Decode an imported sound once and keep the result (never saved).
function decodeSound(snd) {
  if (!snd._decoding || snd._decodedSrc !== snd.dataURL) {
    const a = audio();
    // Built inside .then so a broken file (e.g. bad base64) rejects instead of throwing here.
    const p = Promise.resolve().then(() => {
      if (!a) throw new Error('This browser cannot play sounds.');
      return a.decodeAudioData(base64ToArrayBuffer(snd.dataURL));
    });
    setHidden(snd, '_decodedSrc', snd.dataURL);
    setHidden(snd, '_decoding', p.then(buf => { setHidden(snd, '_buffer', buf); return buf; }));
    snd._decoding.catch(() => {});
  }
  return snd._decoding;
}

// Get a sound ready to play straight away (imported sounds need decoding first).
async function prepareSound(snd) {
  if (snd.kind === 'imported') await decodeSound(snd);
}

// Start a prepared sound now; returns how long it lasts in seconds.
function playSoundNow(snd, volume) {
  const a = audio();
  if (!a) return soundDuration(snd);
  if (snd.kind === 'made') {
    const step = stepSeconds(snd), t0 = a.currentTime + 0.03;
    for (const [st, row] of snd.notes) {
      if (st < snd.length) scheduleInstrumentNote(a, snd.instrument, SOUND_SCALE[row], t0 + st * step, step, volume / 100);
    }
    return soundDuration(snd);
  }
  if (!snd._buffer) return 0;
  const src = a.createBufferSource();
  src.buffer = snd._buffer;
  const g = a.createGain();
  g.gain.value = volume / 100;
  src.connect(g).connect(master);
  src.start();
  track(src);
  return snd._buffer.duration;
}

async function previewSound(snd) {
  const stops = soundStopCount;
  try {
    await prepareSound(snd);
    if (stops !== soundStopCount) return 0; // Stop was pressed while it was loading
    return playSoundNow(snd, 100);
  } catch (err) {
    toast(`Couldn't play "${snd.name}": ${err.message || err}`);
    return 0;
  }
}

async function audioFileToSound(file, names) {
  if (file.size > MAX_IMPORT_BYTES) throw new Error(`"${file.name}" is too big — the limit is 10 MB.`);
  const dataURL = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error(`Couldn't read "${file.name}".`));
    r.readAsDataURL(file);
  });
  if (!AUDIO_DATA_RE.test(dataURL) || !validBase64(dataURL)) throw new Error(`"${file.name}" doesn't look like a sound file.`);
  const snd = { name: uniqueMediaName(names, fileBaseName(file.name) || 'sound1'), kind: 'imported', dataURL, duration: 0 };
  let buf;
  try {
    buf = await decodeSound(snd);
  } catch {
    throw new Error(`"${file.name}" couldn't be played — try an MP3, WAV or OGG file.`);
  }
  snd.duration = Math.round(buf.duration * 1000) / 1000;
  return snd;
}

function warnIfBig(dataURL, what) {
  if (dataURL.length > BIG_MEDIA_CHARS) {
    toast(`${what} is large, so this project might not fit in the browser's storage. Use Save to download it so you don't lose it.`);
  }
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
// (app.js, which defines $, loads after this file, so use the DOM directly here.)
const appEl = document.getElementById('app');
const costumesPanel = document.getElementById('costumes-panel');
const soundsPanel = document.getElementById('sounds-panel');
let currentTab = 'code';
let mediaPanelDirty = false;

function setTab(tab) {
  currentTab = tab;
  appEl.dataset.tab = tab;
  for (const b of document.querySelectorAll('#tabs [data-tab]')) {
    const on = b.dataset.tab === tab;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  }
  costumesPanel.hidden = tab !== 'costumes';
  soundsPanel.hidden = tab !== 'sounds';
  closePaintEditor();
  stopSoundMakerPreview();
  soundMaker = null;
  // A hidden panel keeps nothing around (canvases, listeners, undo history).
  if (tab !== 'costumes') costumesPanel.innerHTML = '';
  if (tab !== 'sounds') soundsPanel.innerHTML = '';
  if (tab === 'costumes') renderCostumesPanel();
  else if (tab === 'sounds') renderSoundsPanel();
  else { renderPalette(); renderWorkspace(); }
}

for (const b of document.querySelectorAll('#tabs [data-tab]')) {
  b.addEventListener('click', () => setTab(b.dataset.tab));
  b.addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const tabs = [...document.querySelectorAll('#tabs [data-tab]')];
    const next = tabs[(tabs.indexOf(b) + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    next.focus();
    setTab(next.dataset.tab);
  });
}

function renderActiveMediaPanel() {
  mediaPanelDirty = false;
  if (currentTab === 'costumes') renderCostumesPanel();
  else if (currentTab === 'sounds') renderSoundsPanel();
}

// Called from the stage render loop when sprites changed (e.g. a script switched costume).
function mediaUiTick() {
  if (currentTab === 'costumes' && !paintBusy()) {
    const s = currentSprite();
    if (mediaPanelDirty || currentCostume(s) !== shownCostume) renderActiveMediaPanel();
  } else if (mediaPanelDirty && currentTab === 'sounds' && !soundMakerBusy()) {
    renderActiveMediaPanel();
  }
}

function mediaButton(label, cls, fn) {
  const b = el('button', 'btn small ' + (cls || ''), label);
  b.type = 'button';
  b.addEventListener('click', fn);
  return b;
}

function pickFiles(accept, onFiles) {
  const input = el('input');
  input.type = 'file';
  input.accept = accept;
  input.multiple = true;
  input.addEventListener('change', () => { if (input.files.length) onFiles([...input.files]); });
  input.click();
}

function mediaItem(index, selected, thumb, title, subtitle, onSelect, onDelete) {
  const item = el('div', 'media-item' + (selected ? ' selected' : ''));
  item.tabIndex = 0;
  item.setAttribute('role', 'option');
  item.setAttribute('aria-selected', String(selected));
  item.append(el('span', 'num', String(index + 1)), thumb, el('span', 'name', title));
  if (subtitle) item.appendChild(el('span', 'sub', subtitle));
  item.addEventListener('click', () => onSelect(false));
  item.addEventListener('keydown', e => {
    if (e.target !== item) return; // Enter/Space on the ▶ or × button does that button's job
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(true); }
  });
  if (onDelete) {
    const del = el('button', 'del', '×');
    del.type = 'button';
    del.title = 'Delete';
    del.setAttribute('aria-label', `Delete ${title}`);
    del.addEventListener('click', e => { e.stopPropagation(); onDelete(); });
    item.appendChild(del);
  }
  return item;
}

// After a keyboard selection rebuilds a panel, put focus back on the selected item.
function refocusSelected(panel) {
  const sel = panel.querySelector('.media-item.selected');
  if (sel) sel.focus();
}

function nameField(label, value, onRename) {
  const wrap = el('label', 'media-name');
  const input = el('input');
  input.type = 'text';
  input.value = value;
  input.maxLength = 40;
  input.spellcheck = false;
  input.addEventListener('change', () => {
    const v = input.value.trim();
    if (!v) { input.value = value; return; }
    input.value = onRename(v);
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
  wrap.append(el('span', null, label), input);
  return wrap;
}

// ---------------------------------------------------------------------------
// Costumes panel
// ---------------------------------------------------------------------------
let shownCostume = null;

function renderCostumesPanel() {
  closePaintEditor();
  mediaPanelDirty = false;
  const s = currentSprite();
  const cur = currentCostume(s);
  shownCostume = cur;
  costumesPanel.innerHTML = '';

  const side = el('div', 'media-side');
  const list = el('div', 'media-list');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', `Costumes of ${s.name}`);
  s.costumes.forEach((c, i) => {
    list.appendChild(mediaItem(i, c === cur, costumeThumb(c, 'thumb'), c.name, c.kind === 'emoji' ? 'emoji' : `${c.w}×${c.h}`,
      byKeyboard => {
        if (c === cur && !s._emoji) return; // already showing: keep the editor (and its undo history)
        setCostumeIndex(s, i);
        save();
        renderCostumesPanel();
        if (byKeyboard) refocusSelected(costumesPanel);
      },
      s.costumes.length > 1 ? () => {
        if (!confirm(`Delete costume "${c.name}"?`)) return;
        s.costumes.splice(i, 1);
        setCostumeIndex(s, s.costumeIndex > i || s.costumeIndex === s.costumes.length ? s.costumeIndex - 1 : s.costumeIndex);
        mediaListChanged(s);
        renderCostumesPanel();
      } : null));
  });
  const adders = el('div', 'media-add');
  const addCostume = c => {
    s.costumes.push(c);
    setCostumeIndex(s, s.costumes.length - 1);
    mediaListChanged(s);
    renderCostumesPanel();
  };
  adders.append(
    mediaButton('🖌 Paint', 'primary', () => addCostume({
      name: uniqueMediaName(costumeNames(s), 'costume1'), kind: 'image', dataURL: '', w: 0, h: 0, cx: 0, cy: 0,
    })),
    mediaButton('😀 Emoji', '', () => addCostume({
      name: uniqueMediaName(costumeNames(s), 'costume1'), kind: 'emoji',
      emoji: SPRITE_EMOJI[Math.floor(Math.random() * SPRITE_EMOJI.length)],
    })),
    mediaButton('📁 Upload', '', () => pickFiles('image/*', async files => {
      for (const f of files) {
        try {
          const c = await imageFileToCostume(f, costumeNames(s));
          s.costumes.push(c);
          setCostumeIndex(s, s.costumes.length - 1);
          warnIfBig(c.dataURL, `"${c.name}"`);
        } catch (err) {
          alert(err.message);
        }
      }
      mediaListChanged(s);
      if (s === currentSprite() && currentTab === 'costumes') renderCostumesPanel();
    })),
  );
  side.append(list, adders);

  const editor = el('div', 'media-editor');
  const head = el('div', 'media-head');
  head.appendChild(nameField('Costume', cur.name, v => {
    if (v === cur.name) return v;
    const name = uniqueMediaName(costumeNames(s).filter(n => n !== cur.name), v);
    renameMediaRefs(s, 'costume', cur.name, name);
    cur.name = name;
    mediaRenamed();
    const label = list.querySelector('.media-item.selected .name');
    if (label) label.textContent = name;
    return name;
  }));
  head.appendChild(mediaButton('Duplicate', '', () => {
    const copy = clone(cur);
    copy.name = uniqueMediaName(costumeNames(s), cur.name);
    s.costumes.splice(s.costumeIndex + 1, 0, copy);
    setCostumeIndex(s, s.costumeIndex + 1);
    mediaListChanged(s);
    renderCostumesPanel();
  }));
  editor.appendChild(head);

  if (cur.kind === 'emoji') renderEmojiEditor(editor, s, cur);
  else openPaintEditor(editor, s, cur);

  costumesPanel.append(side, editor);
  const sel = list.querySelector('.selected');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

function renderEmojiEditor(editor, s, c) {
  const preview = el('div', 'emoji-preview', c.emoji);
  const input = el('input', 'emoji-input');
  input.type = 'text';
  input.value = c.emoji;
  input.setAttribute('aria-label', 'Emoji for this costume');
  const setEmoji = v => {
    v = String(v).trim().slice(0, 32);
    if (!v) return;
    c.emoji = v;
    preview.textContent = v;
    uiDirty = true;
    save();
    const thumb = costumesPanel.querySelector('.media-item.selected .thumb');
    if (thumb) thumb.textContent = v;
  };
  input.addEventListener('input', () => setEmoji(input.value));
  const picks = el('div', 'emoji-picks');
  for (const e of ['🐱', ...SPRITE_EMOJI]) {
    const b = el('button', 'emoji-pick', e);
    b.type = 'button';
    b.setAttribute('aria-label', 'Use ' + e);
    b.addEventListener('click', () => { input.value = e; setEmoji(e); });
    picks.appendChild(b);
  }
  const convert = mediaButton('🖌 Paint on it', 'primary', async () => {
    const cv = newPaintCanvas();
    await costumeToCanvas(c, cv);
    const name = c.name;
    for (const k of Object.keys(c)) delete c[k];
    Object.assign(c, { name, kind: 'image' });
    canvasToCostume(cv, c);
    uiDirty = true;
    save();
    renderCostumesPanel();
  });
  editor.append(
    el('p', 'hint', 'Type or paste any emoji, or pick one:'),
    input, picks, preview,
    el('p', 'hint', 'Want to draw on it? Turn it into a painting:'), convert,
  );
}

// ---------------------------------------------------------------------------
// Paint editor
// ---------------------------------------------------------------------------
const PAINT_TOOLS = [
  ['brush', '🖌', 'Brush'], ['eraser', '🧽', 'Eraser'], ['line', '╱', 'Line'],
  ['rect', '▭', 'Rectangle'], ['ellipse', '◯', 'Ellipse'], ['fill', '🪣', 'Fill'], ['picker', '💧', 'Pick colour'],
];
const paintPrefs = { tool: 'brush', color: '#4c97ff', size: 8, filled: false };
let paintSession = null;

const paintBusy = () => !!(paintSession && paintSession.drawing);

function closePaintEditor() {
  if (paintSession) paintSession.closed = true;
  paintSession = null;
}

function openPaintEditor(editor, sprite, costume) {
  const session = { closed: false, drawing: false, ready: false, undo: [], redo: [] };
  paintSession = session;

  const bar = el('div', 'paint-toolbar');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Paint tools');
  const toolButtons = {};
  for (const [id, icon, label] of PAINT_TOOLS) {
    const b = el('button', 'paint-tool', icon);
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', () => { paintPrefs.tool = id; syncTools(); });
    toolButtons[id] = b;
    bar.appendChild(b);
  }
  const color = el('input', 'paint-color');
  color.type = 'color';
  color.value = paintPrefs.color;
  color.title = 'Colour';
  color.setAttribute('aria-label', 'Colour');
  color.addEventListener('input', () => { paintPrefs.color = color.value; });
  const sizeWrap = el('label', 'paint-size');
  const size = el('input');
  size.type = 'range';
  size.min = '1';
  size.max = '60';
  size.value = String(paintPrefs.size);
  const sizeLabel = el('span', null, String(paintPrefs.size));
  size.addEventListener('input', () => { paintPrefs.size = Number(size.value); sizeLabel.textContent = size.value; });
  sizeWrap.append('Size', size, sizeLabel);
  const fillWrap = el('label', 'paint-fill');
  const fill = el('input');
  fill.type = 'checkbox';
  fill.checked = paintPrefs.filled;
  fill.addEventListener('change', () => { paintPrefs.filled = fill.checked; });
  fillWrap.append(fill, 'Filled shapes');
  const undoBtn = mediaButton('↶ Undo', '', () => undo());
  const redoBtn = mediaButton('↷ Redo', '', () => redo());
  const clearBtn = mediaButton('Clear', 'danger', () => {
    if (!session.ready || session.drawing) return;
    const before = g.getImageData(0, 0, PAINT_W, PAINT_H);
    g.clearRect(0, 0, PAINT_W, PAINT_H);
    commit(before);
  });
  bar.append(el('span', 'paint-sep'), color, sizeWrap, fillWrap, el('span', 'paint-sep'), undoBtn, redoBtn, clearBtn);

  const stage = el('div', 'paint-stage');
  const bitmap = newPaintCanvas();
  bitmap.className = 'paint-canvas';
  const overlay = newPaintCanvas();
  overlay.className = 'paint-overlay';
  overlay.setAttribute('aria-label', 'Paint area');
  stage.append(bitmap, overlay);
  const g = bitmap.getContext('2d', { willReadFrequently: true });
  const og = overlay.getContext('2d');

  editor.append(bar, stage, el('p', 'hint', 'The + in the middle is the costume\'s centre — the sprite\'s position on the stage.'));

  function syncTools() {
    for (const [id, b] of Object.entries(toolButtons)) {
      b.classList.toggle('selected', id === paintPrefs.tool);
      b.setAttribute('aria-pressed', String(id === paintPrefs.tool));
    }
    overlay.style.cursor = paintPrefs.tool === 'picker' ? 'copy' : paintPrefs.tool === 'fill' ? 'cell' : 'crosshair';
  }
  function syncHistory() {
    undoBtn.disabled = !session.undo.length;
    redoBtn.disabled = !session.redo.length;
  }
  syncTools();
  syncHistory();

  function drawGuides() {
    og.clearRect(0, 0, PAINT_W, PAINT_H);
    og.strokeStyle = 'rgba(133, 92, 214, 0.55)';
    og.lineWidth = 1;
    og.beginPath();
    og.moveTo(PAINT_W / 2 - 8, PAINT_H / 2 + 0.5);
    og.lineTo(PAINT_W / 2 + 8, PAINT_H / 2 + 0.5);
    og.moveTo(PAINT_W / 2 + 0.5, PAINT_H / 2 - 8);
    og.lineTo(PAINT_W / 2 + 0.5, PAINT_H / 2 + 8);
    og.stroke();
  }
  drawGuides();

  costumeToCanvas(costume, bitmap).then(() => { if (!session.closed) session.ready = true; })
    .catch(err => { if (!session.closed) { session.ready = true; toast(err.message); } });

  function commit(before) {
    session.undo.push(before);
    if (session.undo.length > 30) session.undo.shift();
    session.redo.length = 0;
    saveCanvas();
  }
  function saveCanvas() {
    canvasToCostume(bitmap, costume);
    syncHistory();
    uiDirty = true;
    save();
    const item = costumesPanel.querySelector('.media-item.selected');
    if (item) {
      const old = item.querySelector('.thumb');
      if (old) old.replaceWith(costumeThumb(costume, 'thumb'));
      const sub = item.querySelector('.sub');
      if (sub) sub.textContent = `${costume.w}×${costume.h}`;
    }
  }
  function undo() {
    if (!session.ready || session.drawing || !session.undo.length) return;
    session.redo.push(g.getImageData(0, 0, PAINT_W, PAINT_H));
    g.putImageData(session.undo.pop(), 0, 0);
    saveCanvas();
  }
  function redo() {
    if (!session.ready || session.drawing || !session.redo.length) return;
    session.undo.push(g.getImageData(0, 0, PAINT_W, PAINT_H));
    g.putImageData(session.redo.pop(), 0, 0);
    saveCanvas();
  }
  session.undoFn = undo;
  session.redoFn = redo;

  const toPaint = e => {
    const r = overlay.getBoundingClientRect();
    return { x: (e.clientX - r.left) * PAINT_W / r.width, y: (e.clientY - r.top) * PAINT_H / r.height };
  };
  const strokeStyle = c => {
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.lineWidth = paintPrefs.size;
    c.strokeStyle = paintPrefs.color;
    c.fillStyle = paintPrefs.color;
  };
  function drawShape(c, a, b) {
    strokeStyle(c);
    c.beginPath();
    if (paintPrefs.tool === 'line') {
      c.moveTo(a.x, a.y);
      c.lineTo(b.x, b.y);
      c.stroke();
      return;
    }
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    if (paintPrefs.tool === 'rect') c.rect(x, y, w, h);
    else c.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    if (paintPrefs.filled) c.fill(); else c.stroke();
  }
  function dab(p, q) {
    g.save();
    g.globalCompositeOperation = paintPrefs.tool === 'eraser' ? 'destination-out' : 'source-over';
    strokeStyle(g);
    g.beginPath();
    g.moveTo(p.x, p.y);
    g.lineTo(q.x + 0.01, q.y);
    g.stroke();
    g.restore();
  }

  overlay.addEventListener('pointerdown', e => {
    // One pointer at a time: a second finger or a palm mustn't join the stroke.
    if (e.button !== 0 || !session.ready || session.drawing) return;
    e.preventDefault();
    // Clicking the canvas takes focus off the toolbar, so Ctrl+Z works straight after.
    if (document.activeElement && editor.contains(document.activeElement)) document.activeElement.blur();
    const p = toPaint(e);
    const tool = paintPrefs.tool;
    if (tool === 'picker') {
      const [r, gg, b, a] = g.getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data;
      if (a) {
        paintPrefs.color = '#' + [r, gg, b].map(n => n.toString(16).padStart(2, '0')).join('');
        color.value = paintPrefs.color;
        paintPrefs.tool = 'brush';
        syncTools();
      }
      return;
    }
    const before = g.getImageData(0, 0, PAINT_W, PAINT_H);
    if (tool === 'fill') {
      if (floodFill(g, p.x, p.y, paintPrefs.color)) commit(before);
      return;
    }
    overlay.setPointerCapture(e.pointerId);
    session.drawing = { tool, before, start: p, last: p, pointerId: e.pointerId };
    if (tool === 'brush' || tool === 'eraser') dab(p, p);
  });
  overlay.addEventListener('pointermove', e => {
    const d = session.drawing;
    if (!d || e.pointerId !== d.pointerId) return;
    const p = toPaint(e);
    if (d.tool === 'brush' || d.tool === 'eraser') {
      dab(d.last, p);
      d.last = p;
    } else {
      drawGuides();
      drawShape(og, d.start, p);
    }
  });
  const finish = e => {
    const d = session.drawing;
    if (!d || e.pointerId !== d.pointerId) return;
    session.drawing = false;
    if (d.tool !== 'brush' && d.tool !== 'eraser') {
      drawGuides();
      if (e.type === 'pointerup') drawShape(g, d.start, toPaint(e));
    }
    commit(d.before);
  };
  overlay.addEventListener('pointerup', finish);
  overlay.addEventListener('pointercancel', finish);
}

// Fill the area of similar colour around (x, y). Returns false if nothing changed.
function floodFill(g, fx, fy, hex) {
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  if (x0 < 0 || y0 < 0 || x0 >= PAINT_W || y0 >= PAINT_H) return false;
  const img = g.getImageData(0, 0, PAINT_W, PAINT_H);
  const d = img.data;
  const [fr, fg, fb] = hexToRgb(hex);
  const i0 = (y0 * PAINT_W + x0) * 4;
  const tr = d[i0], tg = d[i0 + 1], tb = d[i0 + 2], ta = d[i0 + 3];
  if (ta === 255 && tr === fr && tg === fg && tb === fb) return false;
  const tol = 40;
  const matches = i => (ta < tol
    ? d[i + 3] < tol // transparent area: any nearly-transparent pixel
    : Math.abs(d[i] - tr) <= tol && Math.abs(d[i + 1] - tg) <= tol && Math.abs(d[i + 2] - tb) <= tol && Math.abs(d[i + 3] - ta) <= tol);
  const seen = new Uint8Array(PAINT_W * PAINT_H);
  const stack = [y0 * PAINT_W + x0];
  while (stack.length) {
    const p = stack.pop();
    if (seen[p]) continue;
    seen[p] = 1;
    const i = p * 4;
    if (!matches(i)) continue;
    d[i] = fr; d[i + 1] = fg; d[i + 2] = fb; d[i + 3] = 255;
    const x = p % PAINT_W;
    if (x > 0) stack.push(p - 1);
    if (x < PAINT_W - 1) stack.push(p + 1);
    if (p >= PAINT_W) stack.push(p - PAINT_W);
    if (p < PAINT_W * (PAINT_H - 1)) stack.push(p + PAINT_W);
  }
  g.putImageData(img, 0, 0);
  return true;
}

const isTextEntry = t => !!(t && t.closest && (t.closest('textarea, [contenteditable]') ||
  (t.matches && t.matches('input') && !['range', 'color', 'checkbox', 'radio', 'button', 'file'].includes(t.type))));
document.addEventListener('keydown', e => {
  if (currentTab !== 'costumes' || !paintSession || !(e.ctrlKey || e.metaKey) || isTextEntry(e.target) || modalOpen()) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); paintSession.undoFn(); }
  else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); paintSession.redoFn(); }
});

// ---------------------------------------------------------------------------
// Sounds panel
// ---------------------------------------------------------------------------
let selectedSound = null;
let soundMaker = null; // { snd, playing: { start, until, raf } } for the open sound maker

const soundMakerBusy = () => !!(soundMaker && soundMaker.painting);
for (const type of ['pointerup', 'pointercancel']) {
  window.addEventListener(type, () => { if (soundMaker && soundMaker.endPaint) soundMaker.endPaint(); });
}

function stopSoundMakerPreview() {
  if (soundMaker && soundMaker.playing) {
    cancelAnimationFrame(soundMaker.playing.raf);
    soundMaker.playing = null;
    stopSounds();
  }
}

function newMadeSound(names) {
  return {
    name: uniqueMediaName(names, 'sound1'), kind: 'made', instrument: 'piano', tempo: 120, length: 16,
    notes: [[0, 14], [2, 12], [4, 10], [6, 7]], // C E G C, so it makes a sound straight away
  };
}

function renderSoundsPanel() {
  stopSoundMakerPreview();
  soundMaker = null;
  mediaPanelDirty = false;
  const s = currentSprite();
  if (!s.sounds.includes(selectedSound)) selectedSound = s.sounds[0] || null;
  const cur = selectedSound;
  soundsPanel.innerHTML = '';

  const side = el('div', 'media-side');
  const list = el('div', 'media-list');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', `Sounds of ${s.name}`);
  s.sounds.forEach((x, i) => {
    const icon = el('span', 'thumb thumb-sound', x.kind === 'made' ? '🎹' : '🔒');
    icon.title = x.kind === 'made' ? 'Made in the sound maker' : "Imported — can't be edited";
    const item = mediaItem(i, x === cur, icon, x.name, fmtSecs(soundDuration(x)),
      byKeyboard => {
        if (selectedSound === x) return;
        selectedSound = x;
        renderSoundsPanel();
        if (byKeyboard) refocusSelected(soundsPanel);
      },
      () => {
        if (!confirm(`Delete sound "${x.name}"?`)) return;
        s.sounds.splice(i, 1);
        if (selectedSound === x) selectedSound = null;
        mediaListChanged(s);
        renderSoundsPanel();
      });
    const play = el('button', 'media-play', '▶');
    play.type = 'button';
    play.title = 'Play';
    play.setAttribute('aria-label', `Play ${x.name}`);
    play.addEventListener('click', e => { e.stopPropagation(); previewSound(x); });
    item.appendChild(play);
    list.appendChild(item);
  });
  if (!s.sounds.length) list.appendChild(el('p', 'muted', 'No sounds yet.'));
  const adders = el('div', 'media-add');
  adders.append(
    mediaButton('🎹 Make a sound', 'primary', () => {
      const snd = newMadeSound(soundNames(s));
      s.sounds.push(snd);
      selectedSound = snd;
      mediaListChanged(s);
      renderSoundsPanel();
    }),
    mediaButton('📁 Upload', '', () => pickFiles('audio/*', async files => {
      for (const f of files) {
        try {
          const snd = await audioFileToSound(f, soundNames(s));
          s.sounds.push(snd);
          selectedSound = snd;
          warnIfBig(snd.dataURL, `"${snd.name}"`);
        } catch (err) {
          alert(err.message);
        }
      }
      mediaListChanged(s);
      if (s === currentSprite() && currentTab === 'sounds') renderSoundsPanel();
    })),
  );
  side.append(list, adders);

  const editor = el('div', 'media-editor');
  if (!cur) {
    editor.append(
      el('h3', 'modal-h', 'Sounds'),
      el('p', 'muted', 'Make a sound with the sound maker, or upload a sound file (MP3, WAV, OGG…). Uploaded sounds can be played but not edited.'),
    );
  } else {
    const head = el('div', 'media-head');
    head.appendChild(nameField('Sound', cur.name, v => {
      if (v === cur.name) return v;
      const name = uniqueMediaName(soundNames(s).filter(n => n !== cur.name), v);
      renameMediaRefs(s, 'sound', cur.name, name);
      cur.name = name;
      mediaRenamed();
      const label = list.querySelector('.media-item.selected .name');
      if (label) label.textContent = name;
      return name;
    }));
    if (cur.kind === 'made') {
      head.appendChild(mediaButton('Duplicate', '', () => {
        const copy = clone(cur);
        copy.name = uniqueMediaName(soundNames(s), cur.name);
        s.sounds.splice(s.sounds.indexOf(cur) + 1, 0, copy);
        selectedSound = copy;
        mediaListChanged(s);
        renderSoundsPanel();
      }));
    }
    editor.appendChild(head);
    if (cur.kind === 'made') renderSoundMaker(editor, s, cur);
    else renderImportedSound(editor, cur);
  }
  soundsPanel.append(side, editor);
}

function renderImportedSound(editor, snd) {
  const lock = el('div', 'sound-lock');
  lock.append(
    el('strong', null, '🔒 Imported sounds can\'t be edited'),
    el('span', null, 'You can play, rename or delete it. To make a sound you can change, use 🎹 Make a sound.'),
  );
  const wave = el('canvas', 'sound-wave');
  wave.width = 720;
  wave.height = 140;
  wave.setAttribute('aria-label', 'Waveform of ' + snd.name);
  const info = el('p', 'hint', `Length: ${fmtSecs(snd.duration)}`);
  const play = mediaButton('▶ Play', 'primary', () => previewSound(snd));
  const stop = mediaButton('■ Stop', '', () => stopSounds());
  const row = el('div', 'sound-row');
  row.append(play, stop, info);
  editor.append(lock, row, wave);
  decodeSound(snd).then(buf => drawWaveform(wave, buf)).catch(() => {
    const g = wave.getContext('2d');
    g.fillStyle = '#8a91a5';
    g.font = '14px sans-serif';
    g.fillText("This sound couldn't be decoded by this browser.", 16, 70);
  });
}

function drawWaveform(cv, buf) {
  const g = cv.getContext('2d');
  const { width: w, height: h } = cv;
  const data = buf.getChannelData(0);
  const per = Math.max(1, Math.floor(data.length / w));
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#cf63cf';
  for (let x = 0; x < w; x++) {
    let lo = 1, hi = -1;
    for (let i = x * per, end = Math.min(data.length, i + per); i < end; i++) {
      if (data[i] < lo) lo = data[i];
      if (data[i] > hi) hi = data[i];
    }
    if (hi < lo) continue;
    g.fillRect(x, (1 - hi) * h / 2, 1, Math.max(1, (hi - lo) * h / 2));
  }
}

function renderSoundMaker(editor, s, snd) {
  const state = { snd, playing: null, painting: false };
  soundMaker = state;
  const touched = () => {
    save();
    paletteDirty = true;
    const sub = soundsPanel.querySelector('.media-item.selected .sub');
    if (sub) sub.textContent = fmtSecs(soundDuration(snd));
    lengthInfo.textContent = 'Length: ' + fmtSecs(soundDuration(snd));
  };

  const controls = el('div', 'sm-controls');
  const inst = el('select');
  inst.setAttribute('aria-label', 'Instrument');
  for (const i of SOUND_INSTRUMENTS) inst.appendChild(new Option(i, i));
  inst.value = snd.instrument;
  inst.addEventListener('change', () => {
    snd.instrument = inst.value;
    touched();
    const a = audio();
    if (a) scheduleInstrumentNote(a, snd.instrument, 72, a.currentTime + 0.02, stepSeconds(snd), 0.8);
  });
  const tempo = el('input');
  tempo.type = 'range';
  tempo.min = '40';
  tempo.max = '300';
  tempo.value = String(snd.tempo);
  tempo.setAttribute('aria-label', 'Speed in beats per minute');
  const tempoLabel = el('span', null, snd.tempo + ' bpm');
  tempo.addEventListener('input', () => { snd.tempo = Number(tempo.value); tempoLabel.textContent = snd.tempo + ' bpm'; touched(); });
  const len = el('select');
  len.setAttribute('aria-label', 'Number of steps');
  for (const n of SOUND_LENGTHS) len.appendChild(new Option(n + ' steps', String(n)));
  len.value = String(snd.length);
  len.addEventListener('change', () => {
    snd.length = Number(len.value); // notes past the end are kept, just not played
    touched();
    renderGrid();
  });
  const playBtn = mediaButton('▶ Play', 'primary', () => {
    if (state.playing) { stopSoundMakerPreview(); playBtn.textContent = '▶ Play'; return; }
    stopSounds();
    const stops = soundStopCount;
    const a = audio();
    const secs = playSoundNow(snd, 100);
    const start = a ? a.currentTime + 0.03 : 0;
    playBtn.textContent = '■ Stop';
    const tick = () => {
      if (soundMaker !== state || !state.playing) return;
      const t = a ? a.currentTime - start : 0;
      const step = Math.floor(t / stepSeconds(snd));
      for (const c of grid.querySelectorAll('.sm-now')) c.classList.remove('sm-now');
      // Finished, or stopped from anywhere (the Stop button, the green flag…).
      if (t >= secs || stops !== soundStopCount) { state.playing = null; playBtn.textContent = '▶ Play'; return; }
      if (step >= 0) for (const c of grid.querySelectorAll(`[data-step="${step}"]`)) c.classList.add('sm-now');
      state.playing.raf = requestAnimationFrame(tick);
    };
    state.playing = { raf: requestAnimationFrame(tick) };
  });
  const clear = mediaButton('Clear', 'danger', () => {
    if (!snd.notes.length || !confirm('Clear all the notes?')) return;
    snd.notes = [];
    touched();
    renderGrid();
  });
  const lengthInfo = el('span', 'hint', 'Length: ' + fmtSecs(soundDuration(snd)));
  const tempoWrap = el('label', 'sm-tempo');
  tempoWrap.append('Speed', tempo, tempoLabel);
  const instWrap = el('label', null);
  instWrap.append('Instrument ', inst);
  controls.append(playBtn, instWrap, tempoWrap, len, clear, lengthInfo);

  const grid = el('div', 'sm-grid');
  grid.setAttribute('role', 'grid');
  grid.setAttribute('aria-label', 'Notes: click squares to turn notes on or off');
  const has = (st, row) => snd.notes.some(([a, b]) => a === st && b === row);
  const setNote = (st, row, on) => {
    const i = snd.notes.findIndex(([a, b]) => a === st && b === row);
    if (on && i < 0) snd.notes.push([st, row]);
    if (!on && i >= 0) snd.notes.splice(i, 1);
  };
  function renderGrid() {
    grid.innerHTML = '';
    grid.style.gridTemplateColumns = `44px repeat(${snd.length}, minmax(16px, 1fr))`;
    SOUND_SCALE.forEach((midi, row) => {
      grid.appendChild(el('span', 'sm-label' + (midi % 12 === 0 ? ' sm-c' : ''), noteLabel(midi)));
      for (let st = 0; st < snd.length; st++) {
        const cell = el('button', 'sm-cell' + (has(st, row) ? ' on' : '') + (st % 4 === 0 ? ' beat' : ''));
        cell.type = 'button';
        cell.dataset.step = String(st);
        cell.dataset.row = String(row);
        cell.setAttribute('aria-label', `${noteLabel(midi)}, step ${st + 1}`);
        cell.setAttribute('aria-pressed', String(has(st, row)));
        grid.appendChild(cell);
      }
    });
  }
  renderGrid();

  // Click a square to toggle a note; drag to paint (or rub out) several.
  const applyCell = cell => {
    const st = Number(cell.dataset.step), row = Number(cell.dataset.row);
    if (has(st, row) === state.painting.on) return;
    setNote(st, row, state.painting.on);
    cell.classList.toggle('on', state.painting.on);
    cell.setAttribute('aria-pressed', String(state.painting.on));
    if (state.painting.on) {
      const a = audio();
      if (a) scheduleInstrumentNote(a, snd.instrument, SOUND_SCALE[row], a.currentTime + 0.01, stepSeconds(snd), 0.7);
    }
  };
  grid.addEventListener('pointerdown', e => {
    const cell = e.target.closest('.sm-cell');
    if (!cell || e.button !== 0) return;
    e.preventDefault();
    state.painting = { on: !has(Number(cell.dataset.step), Number(cell.dataset.row)) };
    applyCell(cell);
  });
  grid.addEventListener('pointermove', e => {
    if (!state.painting) return;
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const cell = under && under.closest('.sm-cell');
    if (cell && grid.contains(cell)) applyCell(cell);
  });
  const endPaint = () => { if (state.painting) { state.painting = false; touched(); } };
  state.endPaint = endPaint;
  // Keyboard: Enter/Space on a focused square toggles it.
  grid.addEventListener('click', e => {
    const cell = e.target.closest('.sm-cell');
    if (!cell || e.detail !== 0) return; // mouse clicks were handled on pointerdown
    state.painting = { on: !has(Number(cell.dataset.step), Number(cell.dataset.row)) };
    applyCell(cell);
    endPaint();
  });

  const gridScroll = el('div', 'sm-scroll');
  gridScroll.appendChild(grid);
  editor.append(controls, gridScroll, el('p', 'hint', 'Each column is a step and each row is a note. Click squares to add notes, then press Play.'));
}
