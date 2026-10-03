'use strict';
/*
 * Boakcode — a Scratch-style block coding environment.
 * No dependencies: blocks are DOM elements, the stage is a canvas,
 * and scripts run as cooperative async "threads" that yield every frame.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const $ = sel => document.querySelector(sel);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const clone = o => JSON.parse(JSON.stringify(o));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const rad = d => d * Math.PI / 180;
const deg = r => r * 180 / Math.PI;
const STOP = Symbol('stop');
const STAGE_W = 480, STAGE_H = 360, SCALE = 2;
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

function num(v) {
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}
function bool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v).toLowerCase();
  return s !== '' && s !== '0' && s !== 'false';
}
function isNumeric(v) {
  return typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)));
}
function compare(a, b) {
  if (isNumeric(a) && isNumeric(b)) return Number(a) - Number(b);
  const sa = String(a).toLowerCase(), sb = String(b).toLowerCase();
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}
function fmt(v) {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return String(v);
    return String(parseFloat(v.toFixed(6)));
  }
  return String(v);
}
function randInt(lo, hi) {
  if (lo > hi) [lo, hi] = [hi, lo];
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

function hexToRgb(h) {
  h = String(h).replace('#', '');
  if (h.length === 3) h = [...h].map(c => c + c).join('');
  const n = parseInt(h, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [h, s * 100, l * 100];
}
function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return '#' + [f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}
function toColor(v) {
  if (typeof v === 'string' && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v)) return v;
  return hslToHex(num(v) * 3.6, 100, 50); // Scratch-style 0–100 colour wheel
}

// ---------------------------------------------------------------------------
// Block definitions
// ---------------------------------------------------------------------------
const CATS = [
  { id: 'motion', name: 'Motion', color: '#4c97ff' },
  { id: 'looks', name: 'Looks', color: '#9966ff' },
  { id: 'sound', name: 'Sound', color: '#cf63cf' },
  { id: 'events', name: 'Events', color: '#ffbf00' },
  { id: 'control', name: 'Control', color: '#ffab19' },
  { id: 'sensing', name: 'Sensing', color: '#5cb1d6' },
  { id: 'operators', name: 'Operators', color: '#59c059' },
  { id: 'variables', name: 'Variables', color: '#ff8c1a' },
  { id: 'pen', name: 'Pen', color: '#0fbd8c' },
];

const KEYS = ['space', 'up arrow', 'down arrow', 'left arrow', 'right arrow', 'any',
  ...'abcdefghijklmnopqrstuvwxyz', ...'0123456789'];
const EFFECTS = ['color', 'ghost', 'brightness'];

const N = d => ({ k: 'num', d });
const T = d => ({ k: 'text', d });
const Bo = () => ({ k: 'bool', d: '' });
const M = (opts, d = opts[0]) => ({ k: 'menu', opts, d });
const V = () => ({ k: 'var' });
const C = d => ({ k: 'color', d });
const CO = () => ({ k: 'costume' }); // drop-down of the sprite's costumes (also takes reporters)
const SN = () => ({ k: 'sound' });   // drop-down of the sprite's sounds (also takes reporters)

// shape: hat | stack | c | reporter | boolean.  "%" marks an input.
const SPECS = {};
function def(type, cat, shape, text, args = [], extra = {}) {
  SPECS[type] = { type, cat, shape, text, args, ...extra };
}

// Motion
def('move', 'motion', 'stack', 'move % steps', [N(10)]);
def('turn_right', 'motion', 'stack', 'turn ↻ % degrees', [N(15)]);
def('turn_left', 'motion', 'stack', 'turn ↺ % degrees', [N(15)]);
def('goto_random', 'motion', 'stack', 'go to random position');
def('goto_mouse', 'motion', 'stack', 'go to mouse-pointer');
def('goto_xy', 'motion', 'stack', 'go to x: % y: %', [N(0), N(0)]);
def('glide', 'motion', 'stack', 'glide % secs to x: % y: %', [N(1), N(0), N(0)]);
def('point_dir', 'motion', 'stack', 'point in direction %', [N(90)]);
def('point_mouse', 'motion', 'stack', 'point towards mouse-pointer');
def('change_x', 'motion', 'stack', 'change x by %', [N(10)]);
def('set_x', 'motion', 'stack', 'set x to %', [N(0)]);
def('change_y', 'motion', 'stack', 'change y by %', [N(10)]);
def('set_y', 'motion', 'stack', 'set y to %', [N(0)]);
def('bounce', 'motion', 'stack', 'if on edge, bounce');
def('rot_style', 'motion', 'stack', 'set rotation style %', [M(['left-right', "don't rotate", 'all around'])]);
def('x_pos', 'motion', 'reporter', 'x position');
def('y_pos', 'motion', 'reporter', 'y position');
def('direction', 'motion', 'reporter', 'direction');

// Looks
def('say_for', 'looks', 'stack', 'say % for % seconds', [T('Hello!'), N(2)]);
def('say', 'looks', 'stack', 'say %', [T('Hello!')]);
def('think_for', 'looks', 'stack', 'think % for % seconds', [T('Hmm...'), N(2)]);
def('think', 'looks', 'stack', 'think %', [T('Hmm...')]);
def('costume', 'looks', 'stack', 'switch costume to %', [CO()]);
def('next_costume', 'looks', 'stack', 'next costume');
def('change_size', 'looks', 'stack', 'change size by %', [N(10)]);
def('set_size', 'looks', 'stack', 'set size to % %', [N(100)]);
def('change_effect', 'looks', 'stack', 'change % effect by %', [M(EFFECTS), N(25)]);
def('set_effect', 'looks', 'stack', 'set % effect to %', [M(EFFECTS), N(0)]);
def('clear_effects', 'looks', 'stack', 'clear graphic effects');
def('show', 'looks', 'stack', 'show');
def('hide', 'looks', 'stack', 'hide');
def('front', 'looks', 'stack', 'go to front layer');
def('costume_name', 'looks', 'reporter', 'costume name');
def('costume_number', 'looks', 'reporter', 'costume number');
def('size', 'looks', 'reporter', 'size');

// Sound
def('play_sound_wait', 'sound', 'stack', 'play sound % until done', [SN()]);
def('start_sound', 'sound', 'stack', 'start sound %', [SN()]);
def('play_note', 'sound', 'stack', 'play note % for % seconds', [N(60), N(0.5)]);
def('play_drum', 'sound', 'stack', 'play drum %', [M(['kick', 'snare', 'hi-hat', 'clap'])]);
def('set_volume', 'sound', 'stack', 'set volume to % %', [N(100)]);
def('stop_sounds', 'sound', 'stack', 'stop all sounds');
def('volume', 'sound', 'reporter', 'volume');

// Events
def('when_flag', 'events', 'hat', 'when ⚑ clicked');
def('when_key', 'events', 'hat', 'when % key pressed', [M(KEYS)]);
def('when_clicked', 'events', 'hat', 'when this sprite clicked');
def('when_receive', 'events', 'hat', 'when I receive %', [T('message1')]);
def('broadcast', 'events', 'stack', 'broadcast %', [T('message1')]);
def('broadcast_wait', 'events', 'stack', 'broadcast % and wait', [T('message1')]);

// Control
def('wait', 'control', 'stack', 'wait % seconds', [N(1)]);
def('repeat', 'control', 'c', 'repeat %', [N(10)]);
def('forever', 'control', 'c', 'forever', [], { cap: true });
def('if', 'control', 'c', 'if % then', [Bo()]);
def('if_else', 'control', 'c', ['if % then', 'else'], [Bo()]);
def('wait_until', 'control', 'stack', 'wait until %', [Bo()]);
def('repeat_until', 'control', 'c', 'repeat until %', [Bo()]);
def('stop_all', 'control', 'stack', 'stop all', [], { cap: true });

// Sensing
def('touching_edge', 'sensing', 'boolean', 'touching edge?');
def('touching_mouse', 'sensing', 'boolean', 'touching mouse-pointer?');
def('key_pressed', 'sensing', 'boolean', 'key % pressed?', [M(KEYS)]);
def('mouse_down', 'sensing', 'boolean', 'mouse down?');
def('mouse_x', 'sensing', 'reporter', 'mouse x');
def('mouse_y', 'sensing', 'reporter', 'mouse y');
def('distance_mouse', 'sensing', 'reporter', 'distance to mouse-pointer');
def('ask', 'sensing', 'stack', 'ask % and wait', [T("What's your name?")]);
def('answer', 'sensing', 'reporter', 'answer');
def('timer', 'sensing', 'reporter', 'timer');
def('reset_timer', 'sensing', 'stack', 'reset timer');

// Operators
def('add', 'operators', 'reporter', '% + %', [N(''), N('')]);
def('sub', 'operators', 'reporter', '% − %', [N(''), N('')]);
def('mul', 'operators', 'reporter', '% × %', [N(''), N('')]);
def('div', 'operators', 'reporter', '% ÷ %', [N(''), N('')]);
def('random', 'operators', 'reporter', 'pick random % to %', [N(1), N(10)]);
def('gt', 'operators', 'boolean', '% > %', [T(''), T(50)]);
def('lt', 'operators', 'boolean', '% < %', [T(''), T(50)]);
def('eq', 'operators', 'boolean', '% = %', [T(''), T(50)]);
def('and', 'operators', 'boolean', '% and %', [Bo(), Bo()]);
def('or', 'operators', 'boolean', '% or %', [Bo(), Bo()]);
def('not', 'operators', 'boolean', 'not %', [Bo()]);
def('join', 'operators', 'reporter', 'join % %', [T('apple '), T('banana')]);
def('letter_of', 'operators', 'reporter', 'letter % of %', [N(1), T('apple')]);
def('length', 'operators', 'reporter', 'length of %', [T('apple')]);
def('contains', 'operators', 'boolean', '% contains %?', [T('apple'), T('a')]);
def('mod', 'operators', 'reporter', '% mod %', [N(''), N('')]);
def('round', 'operators', 'reporter', 'round %', [N('')]);
def('mathop', 'operators', 'reporter', '% of %',
  [M(['abs', 'floor', 'ceiling', 'sqrt', 'sin', 'cos', 'tan', 'ln', 'log', 'e ^', '10 ^']), N('')]);

// Variables
def('var_get', 'variables', 'reporter', '%', [V()]);
def('set_var', 'variables', 'stack', 'set % to %', [V(), T(0)]);
def('change_var', 'variables', 'stack', 'change % by %', [V(), N(1)]);
def('show_var', 'variables', 'stack', 'show variable %', [V()]);
def('hide_var', 'variables', 'stack', 'hide variable %', [V()]);

// Pen
def('pen_clear', 'pen', 'stack', 'erase all');
def('stamp', 'pen', 'stack', 'stamp');
def('pen_down', 'pen', 'stack', 'pen down');
def('pen_up', 'pen', 'stack', 'pen up');
def('pen_color', 'pen', 'stack', 'set pen color to %', [C('#4c97ff')]);
def('change_pen_hue', 'pen', 'stack', 'change pen color by %', [N(10)]);
def('pen_size', 'pen', 'stack', 'set pen size to %', [N(1)]);
def('change_pen_size', 'pen', 'stack', 'change pen size by %', [N(1)]);

// Used by the extension maker's block coder (not shown in the main palette).
def('ext_define', 'myblocks', 'hat', 'define %', [T('')]);
def('ext_arg', 'myblocks', 'reporter', '%', [T('')]);
def('ext_report', 'myblocks', 'stack', 'report %', [T('')], { cap: true });
def('ext_stop', 'myblocks', 'stack', 'stop this block', [], { cap: true });

const PALETTE = {
  motion: ['move', 'turn_right', 'turn_left', 'goto_random', 'goto_mouse', 'goto_xy', 'glide', 'point_dir',
    'point_mouse', 'change_x', 'set_x', 'change_y', 'set_y', 'bounce', 'rot_style', 'x_pos', 'y_pos', 'direction'],
  looks: ['say_for', 'say', 'think_for', 'think', 'costume', 'next_costume', 'change_size', 'set_size',
    'change_effect', 'set_effect', 'clear_effects', 'show', 'hide', 'front', 'costume_number', 'costume_name', 'size'],
  sound: ['play_sound_wait', 'start_sound', 'stop_sounds', 'play_note', 'play_drum', 'set_volume', 'volume'],
  events: ['when_flag', 'when_key', 'when_clicked', 'when_receive', 'broadcast', 'broadcast_wait'],
  control: ['wait', 'repeat', 'forever', 'if', 'if_else', 'wait_until', 'repeat_until', 'stop_all'],
  sensing: ['touching_edge', 'touching_mouse', 'key_pressed', 'mouse_down', 'mouse_x', 'mouse_y',
    'distance_mouse', 'ask', 'answer', 'timer', 'reset_timer'],
  operators: ['add', 'sub', 'mul', 'div', 'random', 'gt', 'lt', 'eq', 'and', 'or', 'not', 'join',
    'letter_of', 'length', 'contains', 'mod', 'round', 'mathop'],
  pen: ['pen_clear', 'stamp', 'pen_down', 'pen_up', 'pen_color', 'change_pen_hue', 'pen_size', 'change_pen_size'],
};

// Blocks whose type is unknown (for example from a removed extension) still render,
// drag and run (as a do-nothing stack block) instead of breaking the editor.
const UNKNOWN_SPEC = { type: 'unknown', cat: 'unknown', shape: 'stack', text: 'unknown block', args: [] };
const specOf = type => SPECS[type] || UNKNOWN_SPEC;

function defaultInput(spec, i) {
  const a = spec.args[i];
  if (a.k === 'var') return project && project.vars[0] ? project.vars[0].name : 'my variable';
  if (a.k === 'costume') return project ? currentCostume(currentSprite()).name : 'costume1';
  if (a.k === 'sound') {
    const sp = project && currentSprite();
    return sp && sp.sounds[0] ? sp.sounds[0].name : '';
  }
  return a.d ?? '';
}
function newBlock(type, inputs, bodies) {
  const spec = SPECS[type];
  const b = { type, inputs: spec.args.map((_, i) => defaultInput(spec, i)) };
  if (spec.shape === 'c') b.bodies = (Array.isArray(spec.text) ? spec.text : [spec.text]).map(() => []);
  if (inputs) inputs.forEach((v, i) => { if (v !== undefined) b.inputs[i] = v; });
  if (bodies) b.bodies = bodies;
  return b;
}
const B = newBlock;

// ---------------------------------------------------------------------------
// Project model
// ---------------------------------------------------------------------------
const STORAGE_KEY = 'boakcode-project';
const SPRITE_EMOJI = ['🐶', '🐸', '🦊', '🐼', '🐵', '🚀', '⚽', '🍎', '🐢', '🦄', '🐙', '🐝', '⭐', '🚗', '👾', '🐧', '🦖', '🍩'];

let project = null;

function makeSprite(name, emoji, x = 0, y = 0) {
  return attachCostumeAccessor({
    id: 'sp' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    name, x, y,
    costumes: [{ name: 'costume1', kind: 'emoji', emoji }],
    costumeIndex: 0,
    sounds: [],
    dir: 90, size: 100, visible: true, rotationStyle: 'left-right',
    effects: { color: 0, ghost: 0, brightness: 0 },
    volume: 100, penDown: false, penColor: '#4c97ff', penSize: 1,
    scripts: [],
  });
}

// Projects from before costumes and sounds had a single emoji in sprite.costume.
function normalizeSprite(raw) {
  const { costume: legacyEmoji, costumes, costumeIndex, sounds, effects, scripts, ...rest } =
    raw && typeof raw === 'object' ? raw : {};
  const s = Object.assign(makeSprite('Sprite', '🐱'), rest);
  s.costumes = sanitizeCostumes(costumes, typeof legacyEmoji === 'string' ? legacyEmoji : '');
  s.costumeIndex = clamp(Math.round(num(costumeIndex)), 0, s.costumes.length - 1);
  s.sounds = sanitizeSounds(sounds);
  s.effects = Object.assign({ color: 0, ghost: 0, brightness: 0 }, effects);
  s.scripts = Array.isArray(scripts) ? scripts.filter(sc => sc && Array.isArray(sc.blocks) && sc.blocks.length) : [];
  return s;
}

function defaultProject() {
  const boak = makeSprite('Boak', '🐱');
  boak.sounds = [{
    name: 'Boak tune', kind: 'made', instrument: 'piano', tempo: 160, length: 8,
    notes: [[0, 14], [1, 12], [2, 10], [3, 7], [5, 10], [6, 7]],
  }];
  boak.scripts = [
    { x: 24, y: 24, blocks: [
      B('when_flag'),
      B('say_for', ["Hi, I'm Boak!", 2]),
      B('forever', null, [[B('move', [5]), B('bounce')]]),
    ] },
    { x: 300, y: 24, blocks: [
      B('when_clicked'),
      B('start_sound', ['Boak tune']),
      B('repeat', [6], [[B('change_effect', ['color', 25]), B('change_size', [8])]]),
      B('set_size', [100]),
      B('clear_effects'),
    ] },
    { x: 24, y: 300, blocks: [
      B('when_key', ['space']),
      B('glide', [0.5, B('random', [-200, 200]), B('random', [-140, 140])]),
    ] },
  ];
  return {
    title: 'Untitled', sprites: [boak], selected: boak.id,
    vars: [{ name: 'my variable', value: 0, shown: false }], extensions: [],
  };
}

function normalizeProject(p) {
  if (!p || !Array.isArray(p.sprites) || p.sprites.length === 0) throw new Error('Not a Boakcode project');
  p.title = String(p.title || 'Untitled');
  p.vars = Array.isArray(p.vars) ? p.vars : [];
  p.extensions = dedupeExtensionIds(Array.isArray(p.extensions) ? p.extensions.map(normalizeExtension) : []);
  p.sprites = p.sprites.map(normalizeSprite);
  if (!p.sprites.some(s => s.id === p.selected)) p.selected = p.sprites[0].id;
  return p;
}

function serialize() {
  return JSON.stringify(project, (k, v) => (k.startsWith('_') ? undefined : typeof v === 'bigint' ? String(v) : v), 1);
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, serialize());
    } catch (err) {
      warnStorageFull(err);
    }
  }, 250);
}
// Pictures and sounds can make a project bigger than the browser will store; say so once.
let storageWarned = false;
function warnStorageFull(err) {
  if (storageWarned || !err || (err.name !== 'QuotaExceededError' && err.code !== 22)) return;
  storageWarned = true;
  toast("This project is too big to keep in the browser. Use Save to download it so you don't lose your work.");
}
function loadInitial() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeProject(JSON.parse(raw));
  } catch { /* fall through to default */ }
  return defaultProject();
}

const currentSprite = () => project.sprites.find(s => s.id === project.selected) || project.sprites[0];

function getVarObj(name) {
  let v = project.vars.find(x => x.name === name);
  if (!v) {
    v = { name: String(name), value: 0, shown: false };
    project.vars.push(v);
    paletteDirty = true;
  }
  return v;
}

// Find where a block lives inside a list of blocks (recursively).
function locate(target, blocks) {
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i] === target) return { arr: blocks, index: i };
    const r = locateIn(target, blocks[i]);
    if (r) return r;
  }
  return null;
}
function locateIn(target, b) {
  for (let j = 0; j < b.inputs.length; j++) {
    const v = b.inputs[j];
    if (v && typeof v === 'object') {
      if (v === target) return { owner: b, input: j };
      const r = locateIn(target, v);
      if (r) return r;
    }
  }
  if (b.bodies) for (const body of b.bodies) {
    const r = locate(target, body);
    if (r) return r;
  }
  return null;
}
function locateInSprite(sprite, target) {
  return locateInScripts(sprite.scripts, target);
}
function locateInScripts(scripts, target) {
  for (const script of scripts) {
    const r = locate(target, script.blocks);
    if (r) return { ...r, script };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Block rendering
// ---------------------------------------------------------------------------
function renderStack(arr, isTop) {
  const st = el('div', 'stack');
  st._arr = arr;
  st._top = isTop;
  for (const b of arr) st.appendChild(renderBlock(b));
  return st;
}

function renderLabel(text) {
  const span = el('span', 'label');
  const parts = text.split('⚑');
  parts.forEach((p, i) => {
    span.append(p);
    if (i < parts.length - 1) span.appendChild(el('span', 'flag-icon', '⚑'));
  });
  return span;
}

function renderBlock(b) {
  const spec = SPECS[b.type];
  if (!spec) {
    const unknown = el('div', 'block shape-stack');
    unknown.style.setProperty('--c', '#999');
    unknown.style.setProperty('--cd', '#777');
    unknown._block = b;
    unknown.appendChild(el('div', 'row', 'unknown block'));
    return unknown;
  }
  if (!Array.isArray(b.inputs)) b.inputs = [];
  for (let i = b.inputs.length; i < spec.args.length; i++) b.inputs.push(defaultInput(spec, i));
  if (spec.shape === 'c') {
    if (!Array.isArray(b.bodies)) b.bodies = [];
    const n = Array.isArray(spec.text) ? spec.text.length : 1;
    while (b.bodies.length < n) b.bodies.push([]);
  }
  const e = el('div', `block shape-${spec.shape} cat-${spec.cat}`);
  e._block = b;
  if (spec.color) {
    e.style.setProperty('--c', spec.color);
    e.style.setProperty('--cd', spec.colorDark);
  }
  if (b.type === 'ext_define') {
    // "define" + the extension block's text, with its inputs shown as pills.
    const row = el('div', 'row');
    row.appendChild(renderLabel('define'));
    for (const part of String(b.inputs[0]).split(/(\[[A-Za-z_][A-Za-z0-9_]*\])/)) {
      const m = /^\[(.+)\]$/.exec(part);
      if (m) row.appendChild(el('span', 'arg-pill', m[1]));
      else if (part.trim()) row.appendChild(renderLabel(part.trim()));
    }
    e.appendChild(row);
    return e;
  }
  if (b.type === 'var_get' || b.type === 'ext_arg') {
    const row = el('div', 'row');
    row.appendChild(renderLabel(String(b.inputs[0])));
    e.appendChild(row);
    return e;
  }
  const rows = Array.isArray(spec.text) ? spec.text : [spec.text];
  let ai = 0;
  rows.forEach((text, ri) => {
    const row = el('div', 'row');
    const parts = text.split('%');
    parts.forEach((p, pi) => {
      if (p.trim()) row.appendChild(renderLabel(p.trim()));
      if (pi === parts.length - 1) return;
      // A "%" beyond the declared inputs is a literal percent sign.
      if (ai < spec.args.length) { row.appendChild(renderInput(b, ai, spec.args[ai])); ai++; }
      else row.appendChild(renderLabel('%'));
    });
    e.appendChild(row);
    if (spec.shape === 'c') {
      const body = renderStack(b.bodies[ri], false);
      body.classList.add('c-body');
      e.appendChild(body);
    }
  });
  if (spec.shape === 'c') e.appendChild(el('div', 'c-foot'));
  return e;
}

function sizeField(inp) {
  inp.style.width = `calc(${Math.max(1, inp.value.length)}ch + 16px)`;
}

function renderInput(b, i, a) {
  const v = b.inputs[i];
  if (a.k === 'num' || a.k === 'text' || a.k === 'bool') {
    const slot = el('span', `slot drop-slot slot-${a.k}`);
    slot._owner = b;
    slot._index = i;
    slot._kind = a.k;
    if (v && typeof v === 'object') {
      slot.classList.add('filled');
      slot.appendChild(renderBlock(v));
    } else if (a.k !== 'bool') {
      const inp = el('input', 'field');
      inp.value = v;
      inp.spellcheck = false;
      if (a.k === 'num') inp.inputMode = 'decimal';
      sizeField(inp);
      inp.addEventListener('input', () => { b.inputs[i] = inp.value; sizeField(inp); save(); });
      slot.appendChild(inp);
    }
    return slot;
  }
  if (a.k === 'costume' || a.k === 'sound') {
    const slot = el('span', 'slot drop-slot slot-menu');
    slot._owner = b;
    slot._index = i;
    slot._kind = 'text';
    if (v && typeof v === 'object') {
      slot.classList.add('filled');
      slot.appendChild(renderBlock(v));
      return slot;
    }
    const sel = el('select', 'menu');
    const sp = currentSprite();
    const opts = a.k === 'costume' ? costumeNames(sp) : soundNames(sp);
    if (!opts.includes(String(v))) opts.unshift(String(v));
    for (const o of opts) sel.appendChild(new Option(o === '' ? (a.k === 'sound' ? '(no sounds)' : '(none)') : o, o));
    sel.value = String(v);
    sel.addEventListener('change', () => { b.inputs[i] = sel.value; save(); });
    slot.appendChild(sel);
    return slot;
  }
  if (a.k === 'menu' || a.k === 'var') {
    const sel = el('select', 'menu');
    const opts = a.k === 'var' ? project.vars.map(x => x.name) : [...a.opts];
    if (!opts.includes(v)) opts.unshift(v);
    for (const o of opts) sel.appendChild(new Option(o, o));
    sel.value = v;
    sel.addEventListener('change', () => { b.inputs[i] = sel.value; save(); });
    return sel;
  }
  if (a.k === 'color') {
    const inp = el('input', 'color-field');
    inp.type = 'color';
    inp.value = typeof v === 'string' && v.startsWith('#') ? v : '#4c97ff';
    inp.addEventListener('input', () => { b.inputs[i] = inp.value; save(); });
    return inp;
  }
  return el('span', 'label', String(v));
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
const paletteEl = $('#palette');
const categoriesEl = $('#categories');
const paletteTemplates = {};
let paletteDirty = false;

function renderCategories() {
  categoriesEl.innerHTML = '';
  for (const c of allCats()) {
    const btn = el('button', 'cat-btn');
    btn.type = 'button';
    btn.dataset.cat = c.id;
    const dot = el('span', 'cat-dot');
    dot.style.background = c.color;
    btn.append(dot, c.name);
    btn.addEventListener('click', () => {
      const sec = paletteEl.querySelector(`[data-section="${c.id}"]`);
      if (sec) paletteEl.scrollTo({ top: sec.offsetTop - 4, behavior: 'smooth' });
    });
    categoriesEl.appendChild(btn);
  }
  const add = el('button', 'cat-btn ext-add');
  add.type = 'button';
  add.title = 'Add, make or edit extensions';
  add.append(el('span', 'ext-add-icon', '🧩'), 'Extensions');
  add.addEventListener('click', openExtensionGallery);
  categoriesEl.appendChild(add);
}

function renderPalette() {
  const scroll = paletteEl.scrollTop;
  paletteEl.innerHTML = '';
  for (const c of allCats()) {
    const sec = el('div', 'pal-section');
    sec.dataset.section = c.id;
    const h = el('h3', null, c.name);
    sec.appendChild(h);
    if (c.ext) {
      const edit = el('button', 'pal-edit', 'Edit');
      edit.type = 'button';
      edit.title = 'Edit this extension';
      edit.addEventListener('click', () => openExtensionEditor(c.ext));
      h.appendChild(edit);
      if (!c.types.length) sec.appendChild(el('p', 'pal-empty', 'No blocks yet.'));
    }
    if (c.id === 'variables') {
      renderVariableSection(sec);
    } else {
      for (const type of c.types || PALETTE[c.id]) {
        // Costume and sound drop-downs depend on the current sprite, so build those fresh.
        const perSprite = SPECS[type].args.some(a => a.k === 'costume' || a.k === 'sound');
        if (!paletteTemplates[type] || perSprite) paletteTemplates[type] = newBlock(type);
        const item = el('div', 'pal-item');
        item.appendChild(renderBlock(paletteTemplates[type]));
        sec.appendChild(item);
      }
    }
    paletteEl.appendChild(sec);
  }
  paletteEl.scrollTop = scroll;
  paletteDirty = false;
}

function renderVariableSection(sec) {
  const make = el('button', 'pal-button', 'Make a Variable');
  make.type = 'button';
  make.addEventListener('click', () => {
    const name = (prompt('New variable name:') || '').trim();
    if (!name) return;
    if (project.vars.some(v => v.name === name)) { alert('A variable named "' + name + '" already exists.'); return; }
    project.vars.push({ name, value: 0, shown: true });
    renderPalette();
    save();
  });
  sec.appendChild(make);
  for (const v of project.vars) {
    const row = el('div', 'pal-var-row');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = v.shown;
    cb.title = 'Show on stage';
    cb.addEventListener('change', () => { v.shown = cb.checked; save(); });
    const del = el('button', 'del', '×');
    del.type = 'button';
    del.title = 'Delete variable';
    del.addEventListener('click', () => {
      project.vars.splice(project.vars.indexOf(v), 1);
      renderPalette();
      save();
    });
    row.append(cb, renderBlock(newBlock('var_get', [v.name])), del);
    sec.appendChild(row);
  }
  if (project.vars.length) {
    for (const type of ['set_var', 'change_var', 'show_var', 'hide_var']) {
      const item = el('div', 'pal-item');
      item.appendChild(renderBlock(newBlock(type)));
      sec.appendChild(item);
    }
  }
}

function updateActiveCategory() {
  const top = paletteEl.scrollTop + 10;
  let active = CATS[0].id;
  for (const sec of paletteEl.querySelectorAll('.pal-section')) {
    if (sec.offsetTop <= top) active = sec.dataset.section;
  }
  for (const btn of categoriesEl.children) btn.classList.toggle('active', btn.dataset.cat === active);
}
paletteEl.addEventListener('scroll', updateActiveCategory);

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------
const wsEl = $('#workspace');
const wsCanvas = $('#ws-canvas');
const wsHint = $('#ws-hint');

function renderScripts(canvasEl, scripts) {
  canvasEl.innerHTML = '';
  for (const script of scripts) {
    const d = el('div', 'script');
    d.style.left = script.x + 'px';
    d.style.top = script.y + 'px';
    d._script = script;
    d.appendChild(renderStack(script.blocks, true));
    canvasEl.appendChild(d);
  }
}

function renderWorkspace() {
  const sp = currentSprite();
  renderScripts(wsCanvas, sp.scripts);
  wsHint.hidden = sp.scripts.length > 0;
}

function cleanUp() {
  const sp = currentSprite();
  const divs = [...wsCanvas.children].sort((a, b) => a._script.y - b._script.y || a._script.x - b._script.x);
  let y = 24;
  for (const d of divs) {
    d._script.x = 24;
    d._script.y = y;
    y += d.offsetHeight + 28;
  }
  sp.scripts = divs.map(d => d._script);
  renderWorkspace();
  save();
}
$('#btn-cleanup').addEventListener('click', cleanUp);

// A surface is a palette + workspace pair that blocks can be dragged between.
// The main editor is one; the extension maker's block coder registers its own.
const mainSurface = {
  palette: paletteEl,
  deleteAreas: [paletteEl, categoriesEl],
  ws: wsEl,
  canvas: wsCanvas,
  get scripts() { return currentSprite().scripts; },
  render: () => renderWorkspace(),
  changed: () => save(),
  copyToSprites: true,
  cleanUp: () => cleanUp(),
};
const surfaces = [mainSurface];
function addSurface(sf) {
  surfaces.push(sf);
  attachWorkspaceMenu(sf);
}
function removeSurface(sf) {
  const i = surfaces.indexOf(sf);
  if (i > 0) surfaces.splice(i, 1);
}
function surfaceOf(node) {
  for (let i = surfaces.length - 1; i >= 0; i--) {
    const sf = surfaces[i];
    if (sf.palette.contains(node)) return { surface: sf, fromPalette: true };
    if (sf.ws.contains(node)) return { surface: sf, fromPalette: false };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Drag & drop
// ---------------------------------------------------------------------------
const dragLayer = $('#drag-layer');
const dropLine = $('#drop-line');
let press = null;
let drag = null;
let hoverEl = null;

function inRect(x, y, r) { return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; }

document.addEventListener('pointerdown', e => {
  hideContextMenu();
  clearReport();
  audioUnlock();
  if (e.button !== 0) return;
  if (e.target.closest('input, select, button, textarea, label')) return;
  const be = e.target.closest('.block');
  if (!be) return;
  const hit = surfaceOf(be);
  if (!hit) return;
  e.preventDefault();
  press = {
    el: be, block: be._block, x: e.clientX, y: e.clientY, rect: be.getBoundingClientRect(),
    fromPalette: hit.fromPalette, surface: hit.surface,
  };
});

window.addEventListener('pointermove', e => {
  if (!press) return;
  if (!drag) {
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < 5) return;
    startDrag();
    if (!drag) return;
  }
  moveDrag(e);
});

window.addEventListener('pointerup', e => {
  try {
    if (drag) endDrag(e);
    else if (press) clickBlock(press);
  } finally {
    press = null;
  }
});

window.addEventListener('pointercancel', () => {
  if (drag) { restoreOrigin(); finishDrag(); }
  press = null;
});

function startDrag() {
  const p = press;
  const sf = p.surface;
  const scripts = sf.scripts;
  let blocks, origin = null;
  if (p.fromPalette) {
    blocks = [clone(p.block)];
  } else {
    const loc = locateInScripts(scripts, p.block);
    if (!loc) { press = null; return; }
    if (loc.owner) {
      loc.owner.inputs[loc.input] = defaultInput(SPECS[loc.owner.type], loc.input);
      blocks = [p.block];
      origin = { kind: 'slot', owner: loc.owner, input: loc.input };
    } else if (loc.arr === loc.script.blocks && loc.index === 0) {
      const pos = scripts.indexOf(loc.script);
      scripts.splice(pos, 1);
      blocks = loc.script.blocks;
      origin = { kind: 'script', script: loc.script, pos };
    } else {
      blocks = loc.arr.splice(loc.index);
      origin = { kind: 'arr', arr: loc.arr, index: loc.index };
    }
    sf.render();
  }
  drag = {
    blocks, origin, scripts,
    surface: sf,
    sprite: currentSprite(),
    shape: specOf(blocks[0].type).shape,
    cap: !!specOf(blocks[blocks.length - 1].type).cap,
    offX: p.x - p.rect.left,
    offY: p.y - p.rect.top,
    target: null,
  };
  dragLayer.innerHTML = '';
  dragLayer.appendChild(renderStack(blocks, true));
  dragLayer.style.display = 'block';
  document.body.classList.add('dragging');
}

function moveDrag(e) {
  dragLayer.style.transform = `translate(${e.clientX - drag.offX}px, ${e.clientY - drag.offY}px)`;
  drag.target = findTarget(e.clientX, e.clientY);
  showIndicator(drag.target);
}

function findTarget(px, py) {
  const sf = drag.surface;
  if (sf.deleteAreas.some(a => inRect(px, py, a.getBoundingClientRect()))) {
    // The block coder's "define" hat can be moved but never thrown away.
    return drag.blocks[0].type === 'ext_define' ? { type: 'none' } : { type: 'delete' };
  }
  if (sf.copyToSprites) {
    const under = document.elementFromPoint(px, py);
    const tile = under && under.closest('.sprite-tile');
    if (tile && tile._sprite && tile._sprite !== drag.sprite) return { type: 'copy', sprite: tile._sprite, el: tile };
  }
  if (!inRect(px, py, sf.ws.getBoundingClientRect())) return { type: 'none' };
  const canvasEl = sf.canvas;

  const stackEl = dragLayer.firstChild;
  const sr = stackEl.getBoundingClientRect();
  const dr = stackEl.firstChild.getBoundingClientRect();

  if (drag.shape === 'reporter' || drag.shape === 'boolean') {
    let best = null, bd = 40;
    for (const slot of canvasEl.querySelectorAll('.drop-slot')) {
      if (drag.shape === 'reporter' && slot._kind === 'bool') continue;
      const r = slot.getBoundingClientRect();
      const d = Math.hypot(r.left - dr.left, (r.top + r.height / 2) - (dr.top + dr.height / 2));
      if (d < bd) { bd = d; best = slot; }
    }
    return best ? { type: 'slot', slot: best, el: best } : { type: 'top' };
  }

  if (drag.shape !== 'hat') {
    let best = null, bd = 36;
    const consider = (x, y, arr, index, lineY) => {
      const d = Math.hypot(x - dr.left, y - dr.top);
      if (d < bd) { bd = d; best = { type: 'insert', arr, index, x, lineY: lineY ?? y }; }
    };
    for (const st of canvasEl.querySelectorAll('.stack')) {
      const arr = st._arr;
      const firstShape = arr[0] && SPECS[arr[0].type] ? SPECS[arr[0].type].shape : null;
      if (st._top && (firstShape === 'reporter' || firstShape === 'boolean')) continue;
      const r = st.getBoundingClientRect();
      if (st._top) {
        if (firstShape !== 'hat' && !drag.cap) consider(r.left, r.top - sr.height, arr, 0, r.top);
      } else if (!drag.cap || arr.length === 0) {
        consider(r.left, r.top, arr, 0);
      }
      [...st.children].forEach((child, i) => {
        const spec = SPECS[arr[i].type];
        if (spec && spec.cap) return;
        if (drag.cap && i !== arr.length - 1) return;
        const cr = child.getBoundingClientRect();
        consider(cr.left, cr.bottom, arr, i + 1);
      });
    }
    if (best) return best;
  }
  return { type: 'top' };
}

function showIndicator(t) {
  if (hoverEl) { hoverEl.classList.remove('slot-hover', 'drop-hover'); hoverEl = null; }
  dropLine.style.display = 'none';
  if (!t) return;
  if (t.type === 'insert') {
    dropLine.style.display = 'block';
    dropLine.style.left = t.x + 'px';
    dropLine.style.top = (t.lineY - 2) + 'px';
  } else if (t.type === 'slot') {
    hoverEl = t.el;
    hoverEl.classList.add('slot-hover');
  } else if (t.type === 'copy') {
    hoverEl = t.el;
    hoverEl.classList.add('drop-hover');
  }
}

function restoreOrigin() {
  const o = drag.origin;
  if (!o) return;
  if (o.kind === 'slot') o.owner.inputs[o.input] = drag.blocks[0];
  else if (o.kind === 'script') drag.scripts.splice(o.pos, 0, o.script);
  else if (o.kind === 'arr') o.arr.splice(o.index, 0, ...drag.blocks);
}

function endDrag(e) {
  const t = drag.target || { type: 'none' };
  switch (t.type) {
    case 'delete':
      break;
    case 'slot':
      t.slot._owner.inputs[t.slot._index] = drag.blocks[0];
      break;
    case 'insert':
      t.arr.splice(t.index, 0, ...drag.blocks);
      break;
    case 'top': {
      const ws = drag.surface.ws;
      const wr = ws.getBoundingClientRect();
      const x = e.clientX - drag.offX - wr.left + ws.scrollLeft;
      const y = e.clientY - drag.offY - wr.top + ws.scrollTop;
      // Moving a whole script keeps the same script object, so a running script (and a
      // hat's last state) stays attached to it instead of starting a second copy.
      const o = drag.origin;
      const script = o && o.kind === 'script' && o.script.blocks === drag.blocks ? o.script : { blocks: drag.blocks };
      script.x = Math.max(0, Math.round(x));
      script.y = Math.max(0, Math.round(y));
      drag.scripts.push(script);
      break;
    }
    case 'copy': {
      const n = t.sprite.scripts.length;
      t.sprite.scripts.push({ x: 24 + n * 16, y: 24 + n * 16, blocks: clone(drag.blocks) });
      restoreOrigin();
      break;
    }
    default:
      restoreOrigin();
  }
  const sf = drag.surface;
  finishDrag();
  sf.render();
  sf.changed();
}

function finishDrag() {
  showIndicator(null);
  dragLayer.style.display = 'none';
  dragLayer.innerHTML = '';
  document.body.classList.remove('dragging');
  drag = null;
}

// Clicking (without dragging) runs a script, or reports a reporter's value.
function clickBlock(p) {
  if (p.surface.click) { p.surface.click(p); return; }
  const sprite = currentSprite();
  if (p.fromPalette) {
    const b = clone(p.block);
    const shape = specOf(b.type).shape;
    if (shape === 'reporter' || shape === 'boolean') report(sprite, b, p.el);
    else startThread(sprite, [b], null);
    return;
  }
  const loc = locateInSprite(sprite, p.block);
  if (!loc) return;
  const top = loc.script.blocks[0];
  const shape = specOf(top.type).shape;
  if (shape === 'reporter' || shape === 'boolean') {
    report(sprite, top, p.el.closest('.script').querySelector('.block'));
    return;
  }
  const running = threads.get(loc.script);
  if (running && !running.stopped) {
    running.stopped = true;
    threads.delete(loc.script);
  } else {
    startThread(sprite, loc.script.blocks, loc.script);
  }
}

let reportEl = null;
function clearReport() {
  if (reportEl) { reportEl.remove(); reportEl = null; }
}
async function report(sprite, b, anchor) {
  const t = new Thread(sprite, null);
  let value;
  try { value = await evalReporter(t, b); } catch { value = ''; }
  clearReport();
  const r = anchor.getBoundingClientRect();
  reportEl = el('div', 'report-bubble', fmt(value));
  reportEl.style.left = r.left + 'px';
  reportEl.style.top = (r.bottom + 6) + 'px';
  document.body.appendChild(reportEl);
  const mine = reportEl;
  setTimeout(() => { if (reportEl === mine) clearReport(); }, 3000);
}

// Context menu
const ctxMenu = $('#ctx-menu');
function hideContextMenu() { ctxMenu.hidden = true; }
function showContextMenu(x, y, items) {
  ctxMenu.innerHTML = '';
  for (const [label, fn] of items) {
    const b = el('button', null, label);
    b.type = 'button';
    b.addEventListener('pointerdown', ev => ev.stopPropagation());
    b.addEventListener('click', () => { hideContextMenu(); fn(); });
    ctxMenu.appendChild(b);
  }
  ctxMenu.hidden = false;
  const mr = ctxMenu.getBoundingClientRect();
  ctxMenu.style.left = Math.min(x, innerWidth - mr.width - 4) + 'px';
  ctxMenu.style.top = Math.min(y, innerHeight - mr.height - 4) + 'px';
}

function attachWorkspaceMenu(sf) {
  sf.ws.addEventListener('contextmenu', e => {
    e.preventDefault();
    const be = e.target.closest('.block');
    if (!be) {
      if (sf.cleanUp) showContextMenu(e.clientX, e.clientY, [['Clean up blocks', sf.cleanUp]]);
      return;
    }
    const b = be._block;
    if (b.type === 'ext_define') return;
    showContextMenu(e.clientX, e.clientY, [
      ['Duplicate', () => duplicateBlock(sf, b, be)],
      ['Delete Block', () => deleteBlock(sf, b)],
    ]);
  });
}
attachWorkspaceMenu(mainSurface);

function duplicateBlock(sf, b, be) {
  const loc = locateInScripts(sf.scripts, b);
  if (!loc) return;
  const blocks = loc.owner ? [clone(b)] : clone(loc.arr.slice(loc.index));
  const wr = sf.ws.getBoundingClientRect();
  const r = be.getBoundingClientRect();
  sf.scripts.push({
    x: Math.round(r.left - wr.left + sf.ws.scrollLeft + 24),
    y: Math.round(r.top - wr.top + sf.ws.scrollTop + 24),
    blocks,
  });
  sf.render();
  sf.changed();
}

function deleteBlock(sf, b) {
  const scripts = sf.scripts;
  const loc = locateInScripts(scripts, b);
  if (!loc) return;
  if (loc.owner) {
    loc.owner.inputs[loc.input] = defaultInput(SPECS[loc.owner.type], loc.input);
  } else {
    loc.arr.splice(loc.index, 1);
    if (loc.script.blocks.length === 0) scripts.splice(scripts.indexOf(loc.script), 1);
  }
  sf.render();
  sf.changed();
}

// ---------------------------------------------------------------------------
// Stage & runtime state
// ---------------------------------------------------------------------------
const canvas = $('#stage');
const ctx = canvas.getContext('2d');
const penCanvas = document.createElement('canvas');
penCanvas.width = STAGE_W * SCALE;
penCanvas.height = STAGE_H * SCALE;
const penCtx = penCanvas.getContext('2d');
penCtx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
penCtx.lineCap = 'round';
penCtx.lineJoin = 'round';

const mouse = { x: 0, y: 0, down: false };
const keysDown = new Set();
let timerStart = performance.now();
let answer = '';
let uiDirty = true;

function spriteRadius(s) {
  const c = currentCostume(s);
  if (c && c.kind === 'image') return Math.max(4, Math.max(c.w, c.h) / 2 * s.size / 100);
  return s.size * 0.24;
}
const toCanvasX = x => STAGE_W / 2 + x;
const toCanvasY = y => STAGE_H / 2 - y;

function moveTo(s, x, y) {
  x = clamp(x, -STAGE_W / 2, STAGE_W / 2);
  y = clamp(y, -STAGE_H / 2, STAGE_H / 2);
  if (s.penDown) {
    penCtx.strokeStyle = s.penColor;
    penCtx.lineWidth = s.penSize;
    penCtx.beginPath();
    penCtx.moveTo(toCanvasX(s.x), toCanvasY(s.y));
    penCtx.lineTo(toCanvasX(x), toCanvasY(y));
    penCtx.stroke();
  }
  s.x = x;
  s.y = y;
}
function setDir(s, d) {
  d = ((d + 180) % 360 + 360) % 360 - 180;
  s.dir = d === -180 ? 180 : d;
}
function bounce(s) {
  const r = spriteRadius(s);
  const dx = Math.sin(rad(s.dir)), dy = Math.cos(rad(s.dir));
  let dir = s.dir;
  if ((s.x + r > STAGE_W / 2 && dx > 0) || (s.x - r < -STAGE_W / 2 && dx < 0)) dir = -dir;
  if ((s.y + r > STAGE_H / 2 && dy > 0) || (s.y - r < -STAGE_H / 2 && dy < 0)) dir = 180 - dir;
  setDir(s, dir);
  const mx = Math.max(0, STAGE_W / 2 - r), my = Math.max(0, STAGE_H / 2 - r);
  moveTo(s, clamp(s.x, -mx, mx), clamp(s.y, -my, my));
}
function touchingEdge(s) {
  const r = spriteRadius(s);
  return s.x - r <= -STAGE_W / 2 || s.x + r >= STAGE_W / 2 || s.y - r <= -STAGE_H / 2 || s.y + r >= STAGE_H / 2;
}
function hitSprite(x, y) {
  for (let i = project.sprites.length - 1; i >= 0; i--) {
    const s = project.sprites[i];
    if (s.visible && Math.hypot(x - s.x, y - s.y) <= spriteRadius(s)) return s;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sound
// ---------------------------------------------------------------------------
let actx = null, master = null;
const playing = new Set();
function audio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    actx = new AC();
    master = actx.createGain();
    master.gain.value = 0.3;
    master.connect(actx.destination);
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
function audioUnlock() { if (actx && actx.state === 'suspended') actx.resume(); }
function track(node) {
  playing.add(node);
  node.onended = () => playing.delete(node);
}
function stopSounds() {
  for (const n of playing) { try { n.stop(); } catch { /* already stopped */ } }
  playing.clear();
}
function playNote(note, secs, vol) {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime, d = Math.max(0.05, secs), v = Math.max(0.0001, vol / 100);
  const o = a.createOscillator(), g = a.createGain();
  o.type = 'triangle';
  o.frequency.value = 440 * Math.pow(2, (note - 69) / 12);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(v, t0 + 0.01);
  g.gain.setValueAtTime(v, t0 + d * 0.8);
  g.gain.linearRampToValueAtTime(0, t0 + d);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + d + 0.02);
  track(o);
}
function playDrum(kind, vol) {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime, v = Math.max(0.0001, vol / 100);
  const g = a.createGain();
  g.connect(master);
  if (kind === 'kick') {
    const o = a.createOscillator();
    o.frequency.setValueAtTime(150, t0);
    o.frequency.exponentialRampToValueAtTime(40, t0 + 0.25);
    g.gain.setValueAtTime(v, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
    o.connect(g);
    o.start(t0);
    o.stop(t0 + 0.3);
    track(o);
    return;
  }
  const len = kind === 'hi-hat' ? 0.06 : kind === 'clap' ? 0.15 : 0.2;
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * len), a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = kind === 'hi-hat' ? 'highpass' : 'bandpass';
  f.frequency.value = kind === 'hi-hat' ? 7000 : kind === 'clap' ? 1500 : 1800;
  g.gain.setValueAtTime(v, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + len);
  src.connect(f).connect(g);
  src.start(t0);
  track(src);
}

// ---------------------------------------------------------------------------
// Interpreter
// ---------------------------------------------------------------------------
class Thread {
  constructor(sprite, key) {
    this.sprite = sprite;
    this.key = key;
    this.stopped = false;
    this.finished = false;
    this.extFrames = []; // inputs of block-coded extension blocks being run, innermost last
  }
}
const threads = new Map(); // key (script object or a fresh token) -> Thread

function startThread(sprite, blocks, key, restart = true) {
  const k = key || {};
  const existing = threads.get(k);
  if (existing && !existing.stopped) {
    if (!restart) return existing;
    existing.stopped = true;
  }
  const t = new Thread(sprite, k);
  threads.set(k, t);
  t.done = execStack(t, blocks)
    .catch(err => { if (err !== STOP) console.error(err); })
    .finally(() => {
      t.finished = true;
      if (threads.get(k) === t) threads.delete(k);
    });
  return t;
}

function stopAll() {
  for (const t of threads.values()) t.stopped = true;
  threads.clear();
  stopSounds();
  for (const s of project.sprites) s._bubble = null;
  if (askState) { askState.cancelled = true; }
  stopExtensionHats();
}

function fireHats(match, restart = true) {
  const started = [];
  for (const s of project.sprites) {
    for (const script of s.scripts) {
      const hat = script.blocks[0];
      if (hat && match(hat, s)) started.push(startThread(s, script.blocks.slice(1), script, restart));
    }
  }
  return started;
}

function greenFlag() {
  audio();
  stopAll();
  timerStart = performance.now();
  fireHats(h => h.type === 'when_flag');
}

function broadcast(msg) {
  const m = String(msg).toLowerCase();
  return fireHats(h => h.type === 'when_receive' && typeof h.inputs[0] !== 'object' && String(h.inputs[0]).toLowerCase() === m);
}

const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
async function frame(t) {
  await nextFrame();
  if (t.stopped) throw STOP;
}
async function waitSecs(t, secs) {
  const end = performance.now() + secs * 1000;
  do { await frame(t); } while (performance.now() < end);
}

async function val(t, v) {
  return v && typeof v === 'object' ? evalReporter(t, v) : v;
}

async function execStack(t, blocks) {
  for (const b of blocks) {
    if (t.stopped) throw STOP;
    await exec(t, b);
  }
}

let askState = null;
const askBox = $('#ask-box');
const askInput = $('#ask-input');
askBox.addEventListener('submit', e => {
  e.preventDefault();
  if (askState) { askState.value = askInput.value; askState.done = true; }
});
async function ask(t, question) {
  while (askState) await frame(t); // one question at a time
  const s = t.sprite;
  const state = askState = { done: false, value: '', cancelled: false };
  s._bubble = question !== '' ? { text: question, kind: 'say' } : null;
  askInput.value = '';
  askBox.hidden = false;
  askInput.focus();
  try {
    while (!state.done) {
      if (state.cancelled) throw STOP;
      await frame(t);
    }
    answer = state.value;
  } finally {
    askBox.hidden = true;
    if (askState === state) askState = null;
    s._bubble = null;
  }
}

async function exec(t, b) {
  const s = t.sprite;
  const I = i => val(t, b.inputs[i]);
  switch (b.type) {
    // Motion
    case 'move': {
      const n = num(await I(0)), r = rad(90 - s.dir);
      moveTo(s, s.x + n * Math.cos(r), s.y + n * Math.sin(r));
      break;
    }
    case 'turn_right': setDir(s, s.dir + num(await I(0))); break;
    case 'turn_left': setDir(s, s.dir - num(await I(0))); break;
    case 'goto_random': moveTo(s, randInt(-240, 240), randInt(-180, 180)); break;
    case 'goto_mouse': moveTo(s, mouse.x, mouse.y); break;
    case 'goto_xy': moveTo(s, num(await I(0)), num(await I(1))); break;
    case 'glide': {
      const secs = num(await I(0)), tx = num(await I(1)), ty = num(await I(2));
      const x0 = s.x, y0 = s.y, start = performance.now(), dur = secs * 1000;
      for (;;) {
        const p = dur <= 0 ? 1 : Math.min(1, (performance.now() - start) / dur);
        moveTo(s, x0 + (tx - x0) * p, y0 + (ty - y0) * p);
        if (p >= 1) break;
        await frame(t);
      }
      break;
    }
    case 'point_dir': setDir(s, num(await I(0))); break;
    case 'point_mouse': {
      const dx = mouse.x - s.x, dy = mouse.y - s.y;
      if (dx || dy) setDir(s, 90 - deg(Math.atan2(dy, dx)));
      break;
    }
    case 'change_x': moveTo(s, s.x + num(await I(0)), s.y); break;
    case 'set_x': moveTo(s, num(await I(0)), s.y); break;
    case 'change_y': moveTo(s, s.x, s.y + num(await I(0))); break;
    case 'set_y': moveTo(s, s.x, num(await I(0))); break;
    case 'bounce': bounce(s); break;
    case 'rot_style': s.rotationStyle = String(await I(0)); break;

    // Looks
    case 'say_for':
    case 'think_for': {
      const bubble = { text: fmt(await I(0)), kind: b.type === 'say_for' ? 'say' : 'think' };
      const secs = num(await I(1));
      s._bubble = bubble;
      try { await waitSecs(t, secs); } finally { if (s._bubble === bubble) s._bubble = null; }
      break;
    }
    case 'say':
    case 'think': {
      const text = fmt(await I(0));
      s._bubble = text === '' ? null : { text, kind: b.type };
      break;
    }
    case 'costume': switchCostume(s, await I(0)); break;
    case 'next_costume': nextCostume(s); break;
    case 'change_size': s.size = clamp(s.size + num(await I(0)), 5, 500); break;
    case 'set_size': s.size = clamp(num(await I(0)), 5, 500); break;
    case 'change_effect': {
      const fx = String(await I(0));
      s.effects[fx] = (s.effects[fx] || 0) + num(await I(1));
      break;
    }
    case 'set_effect': s.effects[String(await I(0))] = num(await I(1)); break;
    case 'clear_effects': s.effects = { color: 0, ghost: 0, brightness: 0 }; break;
    case 'show': s.visible = true; break;
    case 'hide': s.visible = false; break;
    case 'front': {
      const i = project.sprites.indexOf(s);
      if (i >= 0) { project.sprites.splice(i, 1); project.sprites.push(s); uiDirty = true; }
      break;
    }

    // Sound
    case 'play_note': {
      const n = num(await I(0)), secs = num(await I(1));
      playNote(n, secs, s.volume);
      await waitSecs(t, secs);
      break;
    }
    case 'play_drum':
      playDrum(String(await I(0)), s.volume);
      await waitSecs(t, 0.2);
      break;
    case 'set_volume': s.volume = clamp(num(await I(0)), 0, 100); break;
    case 'stop_sounds': stopSounds(); break;
    case 'start_sound':
    case 'play_sound_wait': {
      const snd = findSound(s, await I(0));
      if (!snd) break;
      try {
        await prepareSound(snd);
      } catch {
        break; // a sound this browser can't decode is skipped
      }
      if (t.stopped) throw STOP;
      const secs = playSoundNow(snd, s.volume);
      if (b.type === 'play_sound_wait') await waitSecs(t, secs);
      break;
    }

    // Events
    case 'broadcast': broadcast(await I(0)); break;
    case 'broadcast_wait': {
      const started = broadcast(await I(0));
      while (started.some(x => !x.finished)) await frame(t);
      break;
    }

    // Control
    case 'wait': await waitSecs(t, num(await I(0))); break;
    case 'repeat': {
      const n = Math.round(num(await I(0)));
      for (let i = 0; i < n; i++) { await execStack(t, b.bodies[0]); await frame(t); }
      break;
    }
    case 'forever':
      for (;;) { await execStack(t, b.bodies[0]); await frame(t); }
    case 'if':
      if (bool(await I(0))) await execStack(t, b.bodies[0]);
      break;
    case 'if_else':
      await execStack(t, bool(await I(0)) ? b.bodies[0] : b.bodies[1]);
      break;
    case 'wait_until':
      while (!bool(await I(0))) await frame(t);
      break;
    case 'repeat_until':
      while (!bool(await I(0))) { await execStack(t, b.bodies[0]); await frame(t); }
      break;
    case 'stop_all':
      stopAll();
      throw STOP;

    // Sensing
    case 'ask': await ask(t, fmt(await I(0))); break;
    case 'reset_timer': timerStart = performance.now(); break;

    // Variables
    case 'set_var': getVarObj(b.inputs[0]).value = await I(1); break;
    case 'change_var': {
      const v = getVarObj(b.inputs[0]);
      v.value = num(v.value) + num(await I(1));
      break;
    }
    case 'show_var': getVarObj(b.inputs[0]).shown = true; paletteDirty = true; break;
    case 'hide_var': getVarObj(b.inputs[0]).shown = false; paletteDirty = true; break;

    // Pen
    case 'pen_clear':
      penCtx.save();
      penCtx.setTransform(1, 0, 0, 1, 0, 0);
      penCtx.clearRect(0, 0, penCanvas.width, penCanvas.height);
      penCtx.restore();
      break;
    case 'stamp': drawSprite(penCtx, s); break;
    case 'pen_down':
      s.penDown = true;
      penCtx.fillStyle = s.penColor;
      penCtx.beginPath();
      penCtx.arc(toCanvasX(s.x), toCanvasY(s.y), s.penSize / 2, 0, Math.PI * 2);
      penCtx.fill();
      break;
    case 'pen_up': s.penDown = false; break;
    case 'pen_color': s.penColor = toColor(await I(0)); break;
    case 'change_pen_hue': {
      const [h, sat, l] = rgbToHsl(...hexToRgb(s.penColor));
      s.penColor = hslToHex(h + num(await I(0)) * 3.6, sat || 100, l || 50);
      break;
    }
    // Extension block coder
    case 'ext_report':
    case 'ext_stop':
      if (!t.extFrames.length) break; // only meaningful inside a block-coded extension block
      throw { extReport: true, value: b.type === 'ext_report' ? await I(0) : '' };

    case 'pen_size': s.penSize = clamp(num(await I(0)), 1, 200); break;
    case 'change_pen_size': s.penSize = clamp(s.penSize + num(await I(0)), 1, 200); break;

    default:
      // Extension blocks run their own code; hats are markers and loose reporters do nothing.
      if (SPECS[b.type] && SPECS[b.type].ext && SPECS[b.type].shape !== 'hat') await runExtBlock(t, b);
      break;
  }
}

async function evalReporter(t, b) {
  const s = t.sprite;
  const I = i => val(t, b.inputs[i]);
  switch (b.type) {
    case 'x_pos': return Math.round(s.x * 1e6) / 1e6;
    case 'y_pos': return Math.round(s.y * 1e6) / 1e6;
    case 'direction': return s.dir;
    case 'costume_name': return currentCostume(s).name;
    case 'costume_number': return s.costumeIndex + 1;
    case 'size': return Math.round(s.size);
    case 'volume': return s.volume;

    case 'touching_edge': return touchingEdge(s);
    case 'touching_mouse': return s.visible && Math.hypot(mouse.x - s.x, mouse.y - s.y) <= spriteRadius(s);
    case 'key_pressed': {
      const k = String(await I(0));
      return k === 'any' ? keysDown.size > 0 : keysDown.has(k);
    }
    case 'mouse_down': return mouse.down;
    case 'mouse_x': return Math.round(mouse.x);
    case 'mouse_y': return Math.round(mouse.y);
    case 'distance_mouse': return Math.round(Math.hypot(mouse.x - s.x, mouse.y - s.y) * 100) / 100;
    case 'answer': return answer;
    case 'timer': return Math.round((performance.now() - timerStart) / 10) / 100;

    case 'add': return num(await I(0)) + num(await I(1));
    case 'sub': return num(await I(0)) - num(await I(1));
    case 'mul': return num(await I(0)) * num(await I(1));
    case 'div': return num(await I(0)) / num(await I(1));
    case 'random': {
      const a = await I(0), c = await I(1);
      const lo = num(a), hi = num(c);
      if (Number.isInteger(lo) && Number.isInteger(hi) && !String(a).includes('.') && !String(c).includes('.')) {
        return randInt(lo, hi);
      }
      return Math.min(lo, hi) + Math.random() * Math.abs(hi - lo);
    }
    case 'gt': return compare(await I(0), await I(1)) > 0;
    case 'lt': return compare(await I(0), await I(1)) < 0;
    case 'eq': return compare(await I(0), await I(1)) === 0;
    case 'and': return bool(await I(0)) && bool(await I(1));
    case 'or': return bool(await I(0)) || bool(await I(1));
    case 'not': return !bool(await I(0));
    case 'join': return fmt(await I(0)) + fmt(await I(1));
    case 'letter_of': return fmt(await I(1))[Math.floor(num(await I(0))) - 1] ?? '';
    case 'length': return fmt(await I(0)).length;
    case 'contains': return fmt(await I(0)).toLowerCase().includes(fmt(await I(1)).toLowerCase());
    case 'mod': {
      const a = num(await I(0)), n = num(await I(1));
      return ((a % n) + n) % n;
    }
    case 'round': return Math.round(num(await I(0)));
    case 'mathop': {
      const op = String(await I(0)), x = num(await I(1));
      switch (op) {
        case 'abs': return Math.abs(x);
        case 'floor': return Math.floor(x);
        case 'ceiling': return Math.ceil(x);
        case 'sqrt': return Math.sqrt(x);
        case 'sin': return Math.round(Math.sin(rad(x)) * 1e10) / 1e10;
        case 'cos': return Math.round(Math.cos(rad(x)) * 1e10) / 1e10;
        case 'tan': return Math.tan(rad(x));
        case 'ln': return Math.log(x);
        case 'log': return Math.log10(x);
        case 'e ^': return Math.exp(x);
        case '10 ^': return Math.pow(10, x);
      }
      return 0;
    }
    case 'var_get': return getVarObj(b.inputs[0]).value;
    case 'ext_arg': {
      const f = t.extFrames[t.extFrames.length - 1];
      return f && Object.prototype.hasOwnProperty.call(f.args, b.inputs[0]) ? f.args[b.inputs[0]] : '';
    }
  }
  if (SPECS[b.type] && SPECS[b.type].ext) return runExtBlock(t, b);
  return '';
}

// ---------------------------------------------------------------------------
// Stage drawing
// ---------------------------------------------------------------------------
function drawSprite(c, s) {
  if (!s.visible) return;
  const fx = s.effects || {};
  const px = 48 * s.size / 100;
  c.save();
  c.translate(toCanvasX(s.x), toCanvasY(s.y));
  if (s.rotationStyle === 'all around') c.rotate(rad(s.dir - 90));
  else if (s.rotationStyle === 'left-right' && s.dir < 0) c.scale(-1, 1);
  const filters = [];
  if (fx.color) filters.push(`hue-rotate(${fx.color * 1.8}deg)`);
  if (fx.brightness) filters.push(`brightness(${clamp(100 + fx.brightness, 0, 200)}%)`);
  c.filter = filters.length ? filters.join(' ') : 'none';
  c.globalAlpha = 1 - clamp(fx.ghost || 0, 0, 100) / 100;
  const cos = currentCostume(s);
  if (cos.kind === 'image') {
    const img = costumeImage(cos);
    const k = s.size / 100;
    if (img) c.drawImage(img, -cos.cx * k, -cos.cy * k, cos.w * k, cos.h * k);
  } else {
    c.font = `${px}px ${EMOJI_FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#333';
    c.fillText(cos.emoji, 0, px * 0.06);
  }
  c.restore();
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function wrapText(c, text, maxW) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const test = line ? line + ' ' + word : word;
      if (c.measureText(test).width > maxW && line) { lines.push(line); line = word; }
      else line = test;
    }
    lines.push(line);
  }
  return lines.slice(0, 8);
}

function drawBubble(s) {
  const b = s._bubble;
  if (!b || !s.visible) return;
  ctx.save();
  ctx.font = '600 13px "Helvetica Neue", Helvetica, Arial, sans-serif';
  const lines = wrapText(ctx, b.text, 150);
  const w = Math.max(40, ...lines.map(l => ctx.measureText(l).width)) + 20;
  const h = lines.length * 16 + 14;
  const r = spriteRadius(s);
  const sx = toCanvasX(s.x), sy = toCanvasY(s.y);
  let onLeft = sx + r * 0.6 + w > STAGE_W;
  let bx = onLeft ? sx - r * 0.6 - w : sx + r * 0.6;
  bx = clamp(bx, 2, STAGE_W - w - 2);
  const by = clamp(sy - r - h - 12, 2, STAGE_H - h - 2);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#c3c8d4';
  ctx.lineWidth = 1.5;
  roundRect(ctx, bx, by, w, h, 12);
  ctx.fill();
  ctx.stroke();
  const tailX = onLeft ? bx + w - 22 : bx + 22;
  if (b.kind === 'think') {
    for (const [dx, dy, rr] of [[0, 8, 5], [onLeft ? 6 : -6, 17, 3]]) {
      ctx.beginPath();
      ctx.arc(tailX + dx, by + h + dy, rr, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  } else {
    ctx.beginPath();
    ctx.moveTo(tailX - 8, by + h - 1);
    ctx.lineTo(tailX + (onLeft ? 6 : -6), by + h + 10);
    ctx.lineTo(tailX + 4, by + h - 1);
    ctx.fill();
    ctx.stroke();
    ctx.fillRect(tailX - 7, by + h - 3, 10, 3);
  }
  ctx.fillStyle = '#575e75';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, bx + 10, by + 8 + i * 16));
  ctx.restore();
}

function drawMonitors() {
  let y = 6;
  ctx.save();
  ctx.font = '600 11px "Helvetica Neue", Helvetica, Arial, sans-serif';
  ctx.textBaseline = 'middle';
  for (const v of project.vars) {
    if (!v.shown) continue;
    const value = fmt(v.value);
    const nw = ctx.measureText(v.name).width;
    const vw = Math.max(28, ctx.measureText(value).width + 12);
    const w = nw + vw + 22;
    ctx.fillStyle = '#e6f0ff';
    ctx.strokeStyle = '#c3cbe0';
    roundRect(ctx, 6, y, w, 22, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#575e75';
    ctx.fillText(v.name, 13, y + 11);
    ctx.fillStyle = '#ff8c1a';
    roundRect(ctx, 13 + nw + 6, y + 3, vw, 16, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(value, 13 + nw + 6 + vw / 2, y + 11);
    ctx.textAlign = 'left';
    y += 28;
  }
  ctx.restore();
}

let frameCount = 0;
function render() {
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  ctx.drawImage(penCanvas, 0, 0, STAGE_W, STAGE_H);
  for (const s of project.sprites) drawSprite(ctx, s);
  for (const s of project.sprites) drawBubble(s);
  drawMonitors();

  // Editor UI that tracks runtime state
  for (const d of wsCanvas.children) {
    const t = threads.get(d._script);
    d.classList.toggle('running', !!t && !t.stopped);
  }
  $('#btn-flag').classList.toggle('active', threads.size > 0);
  if (paletteDirty && !drag) renderPalette();
  if (uiDirty) { renderSprites(); mediaUiTick(); uiDirty = false; }
  if (++frameCount % 6 === 0) refreshSpriteInfo();
  pollExtensionHats();
  requestAnimationFrame(render);
}

// ---------------------------------------------------------------------------
// Stage input
// ---------------------------------------------------------------------------
let stageDrag = null;

function stagePoint(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: clamp(((e.clientX - r.left) / r.width) * STAGE_W - STAGE_W / 2, -STAGE_W / 2, STAGE_W / 2),
    y: clamp(STAGE_H / 2 - ((e.clientY - r.top) / r.height) * STAGE_H, -STAGE_H / 2, STAGE_H / 2),
  };
}

window.addEventListener('pointermove', e => {
  const p = stagePoint(e);
  mouse.x = p.x;
  mouse.y = p.y;
  $('#mouse-coords').innerHTML = `x: ${Math.round(p.x)} &nbsp;y: ${Math.round(p.y)}`;
  if (stageDrag) {
    if (!stageDrag.moved && Math.hypot(e.clientX - stageDrag.cx, e.clientY - stageDrag.cy) > 4) {
      stageDrag.moved = true;
      if (project.selected !== stageDrag.sprite.id) selectSprite(stageDrag.sprite);
    }
    if (stageDrag.moved) {
      stageDrag.sprite.x = clamp(p.x - stageDrag.ox, -STAGE_W / 2, STAGE_W / 2);
      stageDrag.sprite.y = clamp(p.y - stageDrag.oy, -STAGE_H / 2, STAGE_H / 2);
    }
  }
});

canvas.addEventListener('pointerdown', e => {
  audio();
  mouse.down = true;
  const p = stagePoint(e);
  const s = hitSprite(p.x, p.y);
  if (s) {
    e.preventDefault();
    stageDrag = { sprite: s, ox: p.x - s.x, oy: p.y - s.y, cx: e.clientX, cy: e.clientY, moved: false };
  }
});

window.addEventListener('pointerup', () => {
  mouse.down = false;
  if (stageDrag) {
    const { sprite, moved } = stageDrag;
    stageDrag = null;
    if (moved) save();
    else fireHats((h, s) => h.type === 'when_clicked' && s === sprite);
  }
});

function keyName(e) {
  switch (e.key) {
    case ' ': return 'space';
    case 'ArrowUp': return 'up arrow';
    case 'ArrowDown': return 'down arrow';
    case 'ArrowLeft': return 'left arrow';
    case 'ArrowRight': return 'right arrow';
  }
  return e.key.length === 1 ? e.key.toLowerCase() : null;
}
function isTyping(e) {
  return e.target.closest && e.target.closest('input, textarea, select, [contenteditable]');
}
window.addEventListener('keydown', e => {
  // Keys pressed while a dialog is open belong to the dialog, not the stage.
  if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey || modalOpen()) return;
  const k = keyName(e);
  if (!k) return;
  if (k === 'space' || k.endsWith('arrow')) e.preventDefault();
  keysDown.add(k);
  fireHats(h => h.type === 'when_key' && (h.inputs[0] === 'any' || h.inputs[0] === k), false);
});
window.addEventListener('keyup', e => {
  const k = keyName(e);
  if (k) keysDown.delete(k);
});
window.addEventListener('blur', () => keysDown.clear());

$('#btn-flag').addEventListener('click', greenFlag);
$('#btn-stop').addEventListener('click', stopAll);

// ---------------------------------------------------------------------------
// Sprites pane
// ---------------------------------------------------------------------------
const spriteListEl = $('#sprite-list');
const si = {
  name: $('#si-name'), x: $('#si-x'), y: $('#si-y'),
  size: $('#si-size'), dir: $('#si-dir'), show: $('#si-show'),
};

function selectSprite(s) {
  project.selected = s.id;
  paletteDirty = true; // costume and sound drop-downs belong to the selected sprite
  renderWorkspace();
  renderSprites();
  refreshSpriteInfo(true);
  renderActiveMediaPanel();
  save();
}

function renderSprites() {
  spriteListEl.innerHTML = '';
  for (const s of project.sprites) {
    const tile = el('div', 'sprite-tile' + (s.id === project.selected ? ' selected' : ''));
    tile._sprite = s;
    tile.title = s.name;
    tile.append(costumeThumb(currentCostume(s), 'emoji'), el('span', 'name', s.name));
    tile.addEventListener('click', () => selectSprite(s));
    if (s.id === project.selected && project.sprites.length > 1) {
      const del = el('button', 'del', '×');
      del.type = 'button';
      del.title = 'Delete sprite';
      del.addEventListener('click', ev => {
        ev.stopPropagation();
        if (!confirm(`Delete sprite "${s.name}"?`)) return;
        for (const [k, t] of threads) if (t.sprite === s) { t.stopped = true; threads.delete(k); }
        project.sprites.splice(project.sprites.indexOf(s), 1);
        selectSprite(project.sprites[0]);
      });
      tile.appendChild(del);
    }
    spriteListEl.appendChild(tile);
  }
  for (const [icon, label, title, fn] of [
    ['+', 'New sprite', 'Add a sprite', addSprite],
    ['🖌', 'Paint', 'Paint a new sprite', paintSprite],
    ['📁', 'Upload', 'Upload a picture as a new sprite', uploadSprite],
  ]) {
    const add = el('div', 'sprite-tile add');
    add.title = title;
    add.tabIndex = 0;
    add.setAttribute('role', 'button');
    add.append(el('span', 'emoji', icon), el('span', 'name', label));
    add.addEventListener('click', fn);
    add.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } });
    spriteListEl.appendChild(add);
  }
}

function nextSpriteName() {
  let n = project.sprites.length + 1;
  while (project.sprites.some(s => s.name === 'Sprite' + n)) n++;
  return 'Sprite' + n;
}

function paintSprite() {
  const s = makeSprite(nextSpriteName(), '🐱');
  s.costumes = [{ name: 'costume1', kind: 'image', dataURL: '', w: 0, h: 0, cx: 0, cy: 0 }];
  project.sprites.push(s);
  selectSprite(s);
  setTab('costumes');
}

function uploadSprite() {
  pickFiles('image/*', async files => {
    for (const f of files) {
      try {
        const c = await imageFileToCostume(f, []);
        const s = makeSprite(c.name || nextSpriteName(), '🐱', randInt(-150, 150), randInt(-100, 100));
        c.name = 'costume1';
        s.costumes = [c];
        project.sprites.push(s);
        selectSprite(s);
        warnIfBig(c.dataURL, `"${s.name}"`);
      } catch (err) {
        alert(err.message);
      }
    }
  });
}

function addSprite() {
  const emoji = SPRITE_EMOJI[Math.floor(Math.random() * SPRITE_EMOJI.length)];
  const s = makeSprite(nextSpriteName(), emoji, randInt(-150, 150), randInt(-100, 100));
  project.sprites.push(s);
  selectSprite(s);
}

function refreshSpriteInfo(force) {
  const s = currentSprite();
  const set = (inp, v) => { if (force || document.activeElement !== inp) inp.value = v; };
  set(si.name, s.name);
  set(si.x, Math.round(s.x));
  set(si.y, Math.round(s.y));
  set(si.size, Math.round(s.size));
  set(si.dir, Math.round(s.dir));
  si.show.checked = s.visible;
}

si.name.addEventListener('input', () => {
  const v = si.name.value.trim();
  if (v) { currentSprite().name = v; uiDirty = true; save(); }
});
for (const [key, fn] of [
  ['x', (s, v) => moveTo(s, v, s.y)],
  ['y', (s, v) => moveTo(s, s.x, v)],
  ['size', (s, v) => { s.size = clamp(v, 5, 500); }],
  ['dir', (s, v) => setDir(s, v)],
]) {
  si[key].addEventListener('change', () => { fn(currentSprite(), num(si[key].value)); refreshSpriteInfo(true); save(); });
}
si.show.addEventListener('change', () => { currentSprite().visible = si.show.checked; save(); });

// ---------------------------------------------------------------------------
// File menu
// ---------------------------------------------------------------------------
const titleInput = $('#project-title');
titleInput.addEventListener('input', () => { project.title = titleInput.value; save(); });

function loadProject(p) {
  if (project) stopAll();
  project = p;
  penCtx.save();
  penCtx.setTransform(1, 0, 0, 1, 0, 0);
  penCtx.clearRect(0, 0, penCanvas.width, penCanvas.height);
  penCtx.restore();
  for (const k of Object.keys(paletteTemplates)) delete paletteTemplates[k];
  titleInput.value = project.title;
  registerExtensions(project.extensions);
  renderCategories();
  renderPalette();
  renderWorkspace();
  renderSprites();
  refreshSpriteInfo(true);
  updateActiveCategory();
  renderActiveMediaPanel();
  save();
}

$('#btn-new').addEventListener('click', () => {
  if (confirm('Start a new project? Unsaved changes to this one will be lost.')) loadProject(defaultProject());
});
$('#btn-save').addEventListener('click', () => {
  const blob = new Blob([serialize()], { type: 'application/json' });
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = (project.title.trim() || 'project').replace(/[^\w\- ]+/g, '_') + '.boak.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
const fileInput = $('#file-input');
$('#btn-open').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  fileInput.value = '';
  if (!file) return;
  try {
    const p = normalizeProject(JSON.parse(await file.text()));
    if (p.extensions.length && !confirmExtensionCode(`This project includes ${p.extensions.length} extension(s)`)) return;
    loadProject(p);
  } catch (err) {
    alert('Could not load that file: ' + err.message);
  }
});

window.addEventListener('beforeunload', () => {
  try { localStorage.setItem(STORAGE_KEY, serialize()); } catch { /* too big or unavailable: already warned */ }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
loadProject(loadInitial());
updateActiveCategory();
requestAnimationFrame(render);

// Exposed for debugging and tests.
window.boakcode = { get project() { return project; }, greenFlag, stopAll, threads, SPECS };
