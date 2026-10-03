'use strict';
/*
 * Boakcode extensions.
 *
 * An extension is a new block category whose blocks run JavaScript:
 *   { id, name, color, blocks: [{ opcode, type, text, args, code }] }
 * - type: "command" (stack block), "reporter" (round, returns a value), "boolean" (hexagon)
 *   or "hat" (a "when…" block whose code returns true/false; its scripts start when that
 *   changes from false to true — checked every frame, like Scratch's "when timer > 10").
 * - text: the block label; [NAME] marks an input, e.g. "repeat [TEXT] [TIMES] times".
 * - args: one entry per input name: { name, type: number|text|boolean|menu, default, options }.
 * - mode: "js" (code is JavaScript) or "blocks" (scripts holds a stack of ordinary Boakcode
 *   blocks under a "define" hat — built with the block coder; "report" sends back a value).
 * - code: the body of an async function (args, sprite, util) — see EXT_API_HELP.
 *
 * Extensions are stored inside the project, so they travel with saved projects,
 * and can also be exported/imported on their own as .boakext.json files.
 *
 * This file is loaded before app.js; everything here is only called after app.js has booted.
 */

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const EXT_ARG_RE = /\[([A-Za-z_][A-Za-z0-9_]*)\]/g;
const EXT_BLOCK_TYPES = ['command', 'reporter', 'boolean', 'hat'];
const EXT_ARG_TYPES = ['number', 'text', 'boolean', 'menu'];
const EXT_SHAPES = { command: 'stack', reporter: 'reporter', boolean: 'boolean', hat: 'hat' };
const EXT_COLORS = ['#e05a9c', '#0fa3b1', '#7a5af8', '#f26b38', '#2f9e44', '#3b5bdb', '#c2255c', '#5c7cfa'];

const EXT_API_HELP = `Your code is the body of an async function. It can use:

args            the block's inputs, by name: args.TEXT, args.TIMES ...
                (number inputs arrive as numbers, boolean inputs as true/false)
sprite          the sprite running the block: sprite.x, sprite.y, sprite.dir,
                sprite.size, sprite.costume, sprite.name, sprite.visible ...

util.wait(secs)          pause (use with await)
util.frame()             wait one frame — call this inside long loops (await)
util.moveTo(x, y)        move the sprite (draws if the pen is down)
util.turn(degrees)       turn the sprite
util.pointIn(direction)  point in a direction
util.say(text)           show a speech bubble ('' to clear)
util.think(text)         show a thought bubble
util.setCostume(emoji)   change the sprite's costume
util.getVar(name)        read a variable
util.setVar(name, value) set a variable
util.broadcast(message)  send a broadcast
util.playNote(note, secs) play a MIDI note
util.keyPressed(key)     is a key down? e.g. 'space', 'a', 'up arrow'
util.mouse               { x, y, down }
util.random(a, b)        random whole number from a to b
util.timer()             seconds since the green flag
util.sprites             every sprite in the project
util.stage               { width: 480, height: 360 }

Reporter and boolean blocks "return" their value.

Hat ("when…") blocks return true or false. Boakcode checks them every
frame and starts the scripts underneath when the answer changes from
false to true. Keep hat code quick — don't use util.wait in it.`;

// Ready-made extensions anyone can add from the gallery.
const EXT_LIBRARY = [
  {
    id: 'texttools', name: 'Text Tools', color: '#e05a9c', icon: '🔤',
    description: 'Uppercase, reverse, replace and other things to do with words.',
    blocks: [
      { opcode: 'upper', type: 'reporter', text: 'uppercase [TEXT]',
        args: [{ name: 'TEXT', type: 'text', default: 'hello' }],
        code: 'return String(args.TEXT).toUpperCase();' },
      { opcode: 'lower', type: 'reporter', text: 'lowercase [TEXT]',
        args: [{ name: 'TEXT', type: 'text', default: 'HELLO' }],
        code: 'return String(args.TEXT).toLowerCase();' },
      { opcode: 'reverse', type: 'reporter', text: 'reverse [TEXT]',
        args: [{ name: 'TEXT', type: 'text', default: 'Boakcode' }],
        code: 'return [...String(args.TEXT)].reverse().join(\'\');' },
      { opcode: 'replace', type: 'reporter', text: 'replace [FIND] with [WITH] in [TEXT]',
        args: [{ name: 'FIND', type: 'text', default: 'cats' }, { name: 'WITH', type: 'text', default: 'dogs' },
          { name: 'TEXT', type: 'text', default: 'I like cats' }],
        code: 'return String(args.TEXT).split(String(args.FIND)).join(String(args.WITH));' },
      { opcode: 'repeat', type: 'reporter', text: 'repeat [TEXT] [TIMES] times',
        args: [{ name: 'TEXT', type: 'text', default: 'ha' }, { name: 'TIMES', type: 'number', default: 3 }],
        code: 'return String(args.TEXT).repeat(Math.max(0, Math.floor(args.TIMES)));' },
      { opcode: 'starts', type: 'boolean', text: '[TEXT] starts with [START]?',
        args: [{ name: 'TEXT', type: 'text', default: 'apple' }, { name: 'START', type: 'text', default: 'a' }],
        code: 'return String(args.TEXT).toLowerCase().startsWith(String(args.START).toLowerCase());' },
    ],
  },
  {
    id: 'mathplus', name: 'Math Plus', color: '#2f9e44', icon: '➗',
    description: 'Powers, min and max, keeping numbers in a range, and even/odd.',
    blocks: [
      { opcode: 'pow', type: 'reporter', text: '[A] to the power of [B]',
        args: [{ name: 'A', type: 'number', default: 2 }, { name: 'B', type: 'number', default: 8 }],
        code: 'return Math.pow(args.A, args.B);' },
      { opcode: 'min', type: 'reporter', text: 'smaller of [A] and [B]',
        args: [{ name: 'A', type: 'number', default: 3 }, { name: 'B', type: 'number', default: 7 }],
        code: 'return Math.min(args.A, args.B);' },
      { opcode: 'max', type: 'reporter', text: 'bigger of [A] and [B]',
        args: [{ name: 'A', type: 'number', default: 3 }, { name: 'B', type: 'number', default: 7 }],
        code: 'return Math.max(args.A, args.B);' },
      { opcode: 'clamp', type: 'reporter', text: 'keep [N] between [LO] and [HI]',
        args: [{ name: 'N', type: 'number', default: 150 }, { name: 'LO', type: 'number', default: 0 },
          { name: 'HI', type: 'number', default: 100 }],
        code: 'return Math.min(Math.max(args.N, args.LO), args.HI);' },
      { opcode: 'even', type: 'boolean', text: 'is [N] even?',
        args: [{ name: 'N', type: 'number', default: 4 }],
        code: 'return args.N % 2 === 0;' },
      { opcode: 'pi', type: 'reporter', text: 'pi', args: [], code: 'return Math.PI;' },
      // Made with the block coder instead of JavaScript.
      { opcode: 'average', type: 'reporter', text: 'average of [A] and [B]', mode: 'blocks',
        args: [{ name: 'A', type: 'number', default: 4 }, { name: 'B', type: 'number', default: 10 }],
        scripts: [{ x: 16, y: 16, blocks: [
          { type: 'ext_define', inputs: ['average of [A] and [B]'] },
          { type: 'ext_report', inputs: [{ type: 'div', inputs: [
            { type: 'add', inputs: [{ type: 'ext_arg', inputs: ['A'] }, { type: 'ext_arg', inputs: ['B'] }] }, 2] }] },
        ] }] },
    ],
  },
  {
    id: 'datetime', name: 'Date & Time', color: '#3b5bdb', icon: '🕒',
    description: 'Find out the current year, month, day and time.',
    blocks: [
      { opcode: 'current', type: 'reporter', text: 'current [UNIT]',
        args: [{ name: 'UNIT', type: 'menu', default: 'year', options: 'year, month, date, day of week, hour, minute, second' }],
        code: [
          'const d = new Date();',
          'switch (args.UNIT) {',
          '  case \'year\': return d.getFullYear();',
          '  case \'month\': return d.getMonth() + 1;',
          '  case \'date\': return d.getDate();',
          '  case \'day of week\': return d.getDay() + 1;',
          '  case \'hour\': return d.getHours();',
          '  case \'minute\': return d.getMinutes();',
          '  case \'second\': return d.getSeconds();',
          '}',
          'return \'\';',
        ].join('\n') },
      { opcode: 'days2000', type: 'reporter', text: 'days since 2000', args: [],
        code: 'return Math.floor((Date.now() - Date.UTC(2000, 0, 1)) / 86400000);' },
      { opcode: 'whentimer', type: 'hat', text: 'when timer is over [SECS] seconds',
        args: [{ name: 'SECS', type: 'number', default: 5 }],
        code: 'return util.timer() > args.SECS;' },
      { opcode: 'weekend', type: 'boolean', text: 'is it the weekend?', args: [],
        code: 'const day = new Date().getDay();\nreturn day === 0 || day === 6;' },
    ],
  },
  {
    id: 'funfx', name: 'Fun Effects', color: '#f26b38', icon: '✨',
    description: 'Make sprites shake, spin and jump.',
    blocks: [
      { opcode: 'shake', type: 'command', text: 'shake for [SECS] seconds',
        args: [{ name: 'SECS', type: 'number', default: 1 }],
        code: [
          'const x = sprite.x, y = sprite.y;',
          'const end = Date.now() + args.SECS * 1000;',
          'try {',
          '  while (Date.now() < end) {',
          '    util.moveTo(x + util.random(-6, 6), y + util.random(-6, 6));',
          '    await util.frame();',
          '  }',
          '} finally {',
          '  util.moveTo(x, y); // put the sprite back even if it is stopped',
          '}',
        ].join('\n') },
      { opcode: 'spin', type: 'command', text: 'spin around [TIMES] times',
        args: [{ name: 'TIMES', type: 'number', default: 1 }],
        code: [
          '// Remember the real style once, even if a spin restarts while another is running.',
          'if (!sprite._spins) sprite._spinStyle = sprite.rotationStyle;',
          'sprite._spins = (sprite._spins || 0) + 1;',
          'sprite.rotationStyle = \'all around\';',
          'try {',
          '  for (let i = 0; i < args.TIMES * 24; i++) {',
          '    util.turn(15);',
          '    await util.frame();',
          '  }',
          '} finally {',
          '  sprite._spins--;',
          '  if (!sprite._spins) sprite.rotationStyle = sprite._spinStyle; // even if stopped',
          '}',
        ].join('\n') },
      { opcode: 'jump', type: 'command', text: 'jump [HEIGHT] high',
        args: [{ name: 'HEIGHT', type: 'number', default: 60 }],
        code: [
          'const y = sprite.y;',
          'for (let i = 0; i <= 20; i++) {',
          '  util.moveTo(sprite.x, y + Math.sin(Math.PI * i / 20) * args.HEIGHT);',
          '  await util.frame();',
          '}',
        ].join('\n') },
      { opcode: 'whennear', type: 'hat', text: 'when mouse is closer than [DIST]',
        args: [{ name: 'DIST', type: 'number', default: 60 }],
        code: 'return Math.hypot(util.mouse.x - sprite.x, util.mouse.y - sprite.y) < args.DIST;' },
      // Made with the block coder instead of JavaScript.
      { opcode: 'wiggle', type: 'command', text: 'wiggle [TIMES] times', mode: 'blocks',
        args: [{ name: 'TIMES', type: 'number', default: 3 }],
        scripts: [{ x: 16, y: 16, blocks: [
          { type: 'ext_define', inputs: ['wiggle [TIMES] times'] },
          { type: 'repeat', inputs: [{ type: 'ext_arg', inputs: ['TIMES'] }], bodies: [[
            { type: 'change_x', inputs: [8] },
            { type: 'wait', inputs: [0.05] },
            { type: 'change_x', inputs: [-16] },
            { type: 'wait', inputs: [0.05] },
            { type: 'change_x', inputs: [8] },
          ]] },
        ] }] },
      { opcode: 'emoji', type: 'command', text: 'switch to a random animal', args: [],
        code: 'const animals = [\'🐱\', \'🐶\', \'🐸\', \'🦊\', \'🐼\', \'🐵\', \'🐢\', \'🐙\'];\nutil.setCostume(animals[util.random(0, animals.length - 1)]);' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Model helpers
// ---------------------------------------------------------------------------
const randomId = () => Math.random().toString(36).slice(2, 8);
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 16) || 'ext';
const isHexColor = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
const isPrimitive = v => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

// Input names in the order they first appear in the block text.
function argNames(text) {
  const names = [];
  for (const m of String(text).matchAll(EXT_ARG_RE)) if (!names.includes(m[1])) names.push(m[1]);
  return names;
}
function duplicateArgNames(text) {
  const seen = new Set(), dupes = new Set();
  for (const m of String(text).matchAll(EXT_ARG_RE)) (seen.has(m[1]) ? dupes : seen).add(m[1]);
  return [...dupes];
}
function guessArgType(name) {
  return /^(N|NUM|NUMBER|X|Y|A|B|SECS|SECONDS|TIMES|STEPS|COUNT|AMOUNT|SIZE|HEIGHT|WIDTH)$/i.test(name) ? 'number' : 'text';
}
// Keep a block's args list in step with the [NAME] placeholders in its text. Settings for a
// name that briefly disappears while typing are remembered and come back with it.
function syncArgs(blk) {
  if (!blk._argCache) Object.defineProperty(blk, '_argCache', { value: {}, enumerable: false });
  const cache = blk._argCache;
  for (const a of blk.args) cache[a.name] = a;
  blk.args = argNames(blk.text).map(n => cache[n] || (cache[n] = { name: n, type: guessArgType(n), default: '', options: '' }));
}

// Block-coded extension blocks keep ordinary Boakcode blocks, which can come from files,
// so rebuild them from known shapes only.
function sanitizeBlock(b, depth) {
  if (!b || typeof b !== 'object' || Array.isArray(b) || typeof b.type !== 'string' || depth > 200) return null;
  const out = {
    type: b.type,
    inputs: (Array.isArray(b.inputs) ? b.inputs : []).map(v =>
      v && typeof v === 'object' ? (sanitizeBlock(v, depth + 1) || '') : isPrimitive(v) ? v : ''),
  };
  if (Array.isArray(b.bodies)) out.bodies = b.bodies.map(body => sanitizeBlockList(body, depth + 1));
  const spec = SPECS[b.type];
  if (spec) {
    for (let i = out.inputs.length; i < spec.args.length; i++) out.inputs.push(defaultInput(spec, i));
    if (spec.shape === 'c') {
      out.bodies = out.bodies || [];
      const n = Array.isArray(spec.text) ? spec.text.length : 1;
      while (out.bodies.length < n) out.bodies.push([]);
    }
  }
  return out;
}
function sanitizeBlockList(list, depth) {
  return Array.isArray(list) ? list.map(b => sanitizeBlock(b, depth)).filter(Boolean) : [];
}
function sanitizeScripts(scripts) {
  return (Array.isArray(scripts) ? scripts : [])
    .map(sc => (sc && typeof sc === 'object' ? { x: num(sc.x), y: num(sc.y), blocks: sanitizeBlockList(sc.blocks, 0) } : null))
    .filter(sc => sc && sc.blocks.length);
}

// The script whose first block is the "define" hat holds a block-coded block's body.
function defineScript(blk) {
  return (blk.scripts || []).find(s => s.blocks[0] && s.blocks[0].type === 'ext_define');
}
function ensureDefine(blk) {
  if (!Array.isArray(blk.scripts)) blk.scripts = [];
  let s = defineScript(blk);
  if (!s) {
    s = { x: 16, y: 16, blocks: [{ type: 'ext_define', inputs: [blk.text] }] };
    blk.scripts.unshift(s);
  }
  s.blocks[0].inputs[0] = blk.text;
  return s;
}

function normalizeExtension(e) {
  e = e && typeof e === 'object' ? e : {};
  const usedOpcodes = new Set();
  return {
    id: String(e.id || slug(e.name) + '_' + randomId()).replace(/[^\w-]/g, '_'),
    name: String(e.name || 'My Extension').slice(0, 40),
    color: isHexColor(e.color) ? e.color : EXT_COLORS[0],
    blocks: (Array.isArray(e.blocks) ? e.blocks : []).filter(b => b && typeof b === 'object').map(b => {
      let opcode = String(b.opcode || randomId()).replace(/[^\w]/g, '_');
      while (usedOpcodes.has(opcode)) opcode += '_' + randomId();
      usedOpcodes.add(opcode);
      const blk = {
        opcode,
        type: EXT_BLOCK_TYPES.includes(b.type) ? b.type : 'command',
        text: String(b.text || 'new block'),
        args: (Array.isArray(b.args) ? b.args : []).filter(a => a && typeof a === 'object').map(a => ({
          name: String(a.name),
          type: EXT_ARG_TYPES.includes(a.type) ? a.type : 'text',
          default: isPrimitive(a.default) ? a.default : '',
          options: String(a.options || ''),
        })),
        mode: b.mode === 'blocks' ? 'blocks' : 'js',
        code: String(b.code || ''),
        scripts: sanitizeScripts(b.scripts),
      };
      syncArgs(blk);
      if (blk.mode === 'blocks') ensureDefine(blk);
      return blk;
    }),
  };
}

// Two extensions in one project must not share an id, or their blocks would collide.
function dedupeExtensionIds(list) {
  const seen = new Set();
  for (const ext of list) {
    while (seen.has(ext.id)) ext.id = slug(ext.name) + '_' + randomId();
    seen.add(ext.id);
  }
  return list;
}

function compileCode(code) {
  try {
    return { fn: new AsyncFunction('args', 'sprite', 'util', code || '') };
  } catch (err) {
    return { error: err.message };
  }
}

function menuOptions(a) {
  const opts = String(a.options || '').split(',').map(s => s.trim()).filter(Boolean);
  return opts.length ? opts : ['option 1'];
}
function argSpec(a) {
  switch (a.type) {
    case 'number': return N(a.default === '' ? 0 : a.default);
    case 'boolean': return Bo();
    case 'menu': {
      const opts = menuOptions(a);
      return M(opts, opts.includes(String(a.default)) ? String(a.default) : opts[0]);
    }
    default: return T(a.default);
  }
}
function darken(hex, amount = 14) {
  const [h, s, l] = rgbToHsl(...hexToRgb(hex));
  return hslToHex(h, s, Math.max(0, l - amount));
}

// Turn one extension block into a SPECS entry that app.js can render and run.
function buildExtSpec(ext, blk, type) {
  const byName = Object.fromEntries(blk.args.map(a => [a.name, a]));
  const seen = new Set();
  // "%" marks inputs in SPECS text, so show a literal percent sign as a full-width one.
  // An input name used twice gets one slot; later copies show as plain text.
  const text = String(blk.text).replace(/%/g, '％')
    .replace(EXT_ARG_RE, (m, n) => (seen.has(n) ? n : (seen.add(n), '%')));
  const argDefs = [...seen].map(n => byName[n] || { name: n, type: 'text', default: '', options: '' });
  const mode = blk.mode === 'blocks' ? 'blocks' : 'js';
  return {
    type,
    cat: 'ext-' + ext.id,
    shape: EXT_SHAPES[blk.type] || 'stack',
    text,
    args: argDefs.map(argSpec),
    color: ext.color,
    colorDark: darken(ext.color),
    ext: { ext, blk, argDefs, mode, ...(mode === 'js' ? compileCode(blk.code) : {}) },
  };
}

let extCats = [];
const allCats = () => [...CATS, ...extCats];

function registerExtensions(list) {
  for (const k of Object.keys(SPECS)) {
    if (k.startsWith('ext.')) { delete SPECS[k]; delete paletteTemplates[k]; }
  }
  extCats = list.map(ext => {
    const types = ext.blocks.map(blk => {
      const type = `ext.${ext.id}.${blk.opcode}`;
      SPECS[type] = buildExtSpec(ext, blk, type);
      return type;
    });
    return { id: 'ext-' + ext.id, name: ext.name, color: ext.color, ext, types };
  });
}

function refreshExtensions() {
  stopExtensionHats(); // edited hats start checking afresh
  registerExtensions(project.extensions);
  renderCategories();
  renderPalette();
  renderWorkspace();
  updateActiveCategory();
  save();
}

// Visit every block in the project: sprite scripts and block-coded extension blocks.
function walkAllBlocks(fn, extraExts = []) {
  const walkList = list => { if (Array.isArray(list)) for (const b of list) walkBlock(b); };
  const walkBlock = b => {
    if (!b || typeof b !== 'object' || typeof b.type !== 'string' || !Array.isArray(b.inputs)) return;
    fn(b);
    for (const v of b.inputs) walkBlock(v);
    if (Array.isArray(b.bodies)) b.bodies.forEach(walkList);
  };
  for (const s of project.sprites) for (const sc of s.scripts) walkList(sc.blocks);
  for (const ext of [...project.extensions, ...extraExts]) {
    for (const blk of ext.blocks) for (const sc of blk.scripts || []) walkList(sc.blocks);
  }
}

// Placed blocks store their input values by position. When an extension is replaced by a
// new version, move each value to its input's new position (matched by name), fill new
// inputs with their defaults, and drop values that no longer fit the input's type.
// includeNew: also remap the new version's own block-coded bodies — only right for the editor,
// whose draft was written against the old layout (an imported file already uses the new one).
function remapExtensionInputs(oldExt, newExt, { includeNew = false } = {}) {
  const changes = {};
  for (const nb of newExt.blocks) {
    const ob = oldExt.blocks.find(b => b.opcode === nb.opcode);
    if (!ob) continue;
    changes[`ext.${newExt.id}.${nb.opcode}`] = {
      oldNames: argNames(ob.text),
      newArgs: argNames(nb.text).map(n => nb.args.find(a => a.name === n) || { name: n, type: 'text', default: '' }),
    };
  }
  walkAllBlocks(b => {
    const c = changes[b.type];
    if (!c) return;
    b.inputs = c.newArgs.map(a => {
      const oi = c.oldNames.indexOf(a.name);
      const v = oi >= 0 ? b.inputs[oi] : undefined;
      if (v && typeof v === 'object') {
        // A reporter block stays where it was put, unless the input can no longer hold it.
        const fits = a.type === 'menu' ? false : a.type === 'boolean' ? specOf(v.type).shape === 'boolean' : true;
        return fits ? v : argSpec(a).d;
      }
      const stale = v === undefined || a.type === 'boolean' ||
        (a.type === 'menu' && !menuOptions(a).includes(String(v)));
      return stale ? argSpec(a).d : v;
    });
  }, includeNew ? [newExt] : []);
}

function blockUseCount(ext) {
  const prefix = `ext.${ext.id}.`;
  let count = 0;
  walkAllBlocks(b => { if (b.type.startsWith(prefix)) count++; });
  return count;
}

// ---------------------------------------------------------------------------
// Running extension blocks
// ---------------------------------------------------------------------------
// Extension values end up in variables and saved projects, so keep them to what Boakcode
// itself uses: text, numbers and true/false.
function toPrimitive(v) {
  if (v == null) return '';
  if (isPrimitive(v)) return v;
  if (typeof v === 'bigint') return Number.isSafeInteger(Number(v)) ? Number(v) : String(v);
  try { return String(v); } catch { return ''; }
}
// A hat or boolean whose code returns nothing means "false".
const extToBool = v => (v == null ? false : bool(toPrimitive(v)));

function makeUtil(t) {
  const s = t.sprite;
  // Once the block is stopped (Stop, Cancel, a new project…), anything it tries to do ends it.
  const live = fn => (...a) => { if (t.stopped) throw STOP; return fn(...a); };
  return {
    wait: secs => waitSecs(t, num(secs)),
    frame: () => frame(t),
    moveTo: live((x, y) => moveTo(s, num(x), num(y))),
    turn: live(d => setDir(s, s.dir + num(d))),
    pointIn: live(d => setDir(s, num(d))),
    say: live(text => { s._bubble = text == null || text === '' ? null : { text: fmt(toPrimitive(text)), kind: 'say' }; }),
    think: live(text => { s._bubble = text == null || text === '' ? null : { text: fmt(toPrimitive(text)), kind: 'think' }; }),
    setCostume: live(c => { if (c) { s.costume = String(c); uiDirty = true; } }),
    getVar: name => getVarObj(String(name)).value,
    setVar: live((name, value) => { getVarObj(String(name)).value = toPrimitive(value); }),
    broadcast: live(msg => { broadcast(msg); }),
    playNote: live((note, secs = 0.5) => playNote(num(note), num(secs), s.volume)),
    keyPressed: k => (k === 'any' ? keysDown.size > 0 : keysDown.has(String(k))),
    get mouse() { return { x: mouse.x, y: mouse.y, down: mouse.down }; },
    random: (a, b) => randInt(Math.round(num(a)), Math.round(num(b))),
    timer: () => (performance.now() - timerStart) / 1000,
    get sprites() { return project.sprites; },
    stage: { width: STAGE_W, height: STAGE_H },
  };
}

async function extArgs(t, b, argDefs) {
  const args = {};
  for (let i = 0; i < argDefs.length; i++) {
    const d = argDefs[i];
    const raw = b.inputs[i];
    const v = raw === undefined ? argSpec(d).d : await val(t, raw);
    args[d.name] = d.type === 'number' ? num(v) : d.type === 'boolean' ? bool(v) : v;
  }
  return args;
}

const MAX_EXT_DEPTH = 64;

// Run one extension block's body: its JavaScript, or its blocks under the "define" hat.
async function callExtension(t, x, args) {
  if (x.mode !== 'blocks') {
    if (x.error) throw new Error(x.error);
    return x.fn(args, t.sprite, makeUtil(t));
  }
  if (t.extFrames.length >= MAX_EXT_DEPTH) {
    throw new Error('too many extension blocks running inside each other (does a block use itself?)');
  }
  const def = defineScript(x.blk);
  t.extFrames.push({ args });
  try {
    if (def) await execStack(t, def.blocks.slice(1));
    return '';
  } catch (err) {
    if (err && err.extReport) return err.value; // a "report" or "stop this block" block
    throw err;
  } finally {
    t.extFrames.pop();
  }
}

async function runExtBlock(t, b) {
  const spec = SPECS[b.type];
  const x = spec.ext;
  const args = await extArgs(t, b, x.argDefs);
  try {
    const result = await callExtension(t, x, args);
    if (t.stopped) throw STOP;
    return spec.shape === 'boolean' ? extToBool(result) : toPrimitive(result);
  } catch (err) {
    if (err === STOP) throw err;
    extError(x, err, t.hatCheck);
    return spec.shape === 'boolean' ? false : '';
  }
}

// Extension hats are edge-triggered: every frame each script that starts with one is
// re-checked, and the script starts when its condition turns from false to true.
const hatLastValue = new WeakMap(); // script -> condition result the last time it was checked
const hatBusy = new WeakMap();      // script -> generation of the hat check still running for it
const hatThreads = new Set();       // threads checking hats right now, so Stop can end them
let hatGeneration = 0;              // bumped by Stop and project loads to discard old checks

function pollExtensionHats() {
  if (!project.extensions.length) return;
  for (const sprite of project.sprites) {
    for (const script of sprite.scripts) {
      const hat = script.blocks[0];
      const spec = hat && SPECS[hat.type];
      if (spec && spec.ext && spec.shape === 'hat' && hatBusy.get(script) !== hatGeneration) checkHat(sprite, script, hat, spec);
    }
  }
}

async function checkHat(sprite, script, hat, spec) {
  const gen = hatGeneration;
  const t = new Thread(sprite, null);
  t.hatCheck = true;
  hatBusy.set(script, gen);
  hatThreads.add(t);
  let now = false;
  try {
    now = extToBool(await callExtension(t, spec.ext, await extArgs(t, hat, spec.ext.argDefs)));
  } catch (err) {
    if (err !== STOP) extError(spec.ext, err, true);
  } finally {
    if (hatBusy.get(script) === gen) hatBusy.delete(script);
    hatThreads.delete(t);
  }
  // Ignore answers that arrive after Stop, a project load, or the script being changed.
  if (t.stopped || gen !== hatGeneration || script.blocks[0] !== hat ||
      !project.sprites.includes(sprite) || !sprite.scripts.includes(script)) return;
  if (now && !hatLastValue.get(script)) startThread(sprite, script.blocks.slice(1), script, false);
  hatLastValue.set(script, now);
}

function stopExtensionHats() {
  hatGeneration++;
  for (const t of hatThreads) t.stopped = true;
  hatThreads.clear();
}

// Report a broken extension block at most once every few seconds, so a block that fails
// every frame (in a loop or a hat) doesn't flood the screen.
// Errors from hat checks (which run every frame, even when nothing is running) are
// reported only once per version of the block.
function extError(x, err, once = false) {
  const message = err && err.message ? err.message : String(err);
  if (once) {
    if (x.reportedFromHat) return;
    x.reportedFromHat = true;
  }
  const now = performance.now();
  if (x.lastErrorAt && now - x.lastErrorAt < 10000) return;
  x.lastErrorAt = now;
  console.error(`[${x.ext.name}] "${x.blk.text}":`, message);
  toast(`Error in ${x.ext.name} block "${x.blk.text}": ${message}`);
}

let toastTimer = null;
function toast(message) {
  let t = document.querySelector('.toast');
  if (!t) { t = el('div', 'toast'); document.body.appendChild(t); }
  t.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 4500);
}

function confirmExtensionCode(what) {
  return confirm(`${what} with custom JavaScript code. Extension code can do anything a web page can do, ` +
    'so only load extensions from people you trust.\n\nContinue?');
}

// ---------------------------------------------------------------------------
// Modal helper
// ---------------------------------------------------------------------------
const modalOpen = () => !!document.querySelector('.modal-overlay');

// Only one modal at a time; returns null if one is already open.
function openModal(title, { wide = false, dismissable = true } = {}) {
  if (modalOpen()) return null;
  const opener = document.activeElement;
  const overlay = el('div', 'modal-overlay');
  const modal = el('div', 'modal' + (wide ? ' wide' : ''));
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', title);
  modal.tabIndex = -1;
  const head = el('div', 'modal-head');
  const close = el('button', 'modal-x', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  head.append(el('span', null, title), close);
  const body = el('div', 'modal-body');
  const foot = el('div', 'modal-foot');
  modal.append(head, body, foot);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  modal.focus();
  const api = {
    body, foot,
    onClose: null,
    close() {
      if (!overlay.isConnected) return;
      if (api.onClose && api.onClose() === false) return;
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      if (opener && opener.isConnected && opener.focus) opener.focus();
    },
    button(label, cls, fn) {
      const b = el('button', 'btn ' + (cls || ''), label);
      b.type = 'button';
      b.addEventListener('click', fn);
      foot.appendChild(b);
      return b;
    },
  };
  // Escape closes; Tab stays inside the dialog.
  const onKey = e => {
    if (e.defaultPrevented) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      api.close();
    } else if (e.key === 'Tab') {
      const items = [...modal.querySelectorAll('button, input, select, textarea, summary, [tabindex="0"]')]
        .filter(n => !n.disabled && n.offsetParent !== null);
      if (!items.length) return;
      const i = items.indexOf(document.activeElement);
      if (e.shiftKey ? i <= 0 : (i === -1 || i === items.length - 1)) {
        e.preventDefault();
        (e.shiftKey ? items[items.length - 1] : items[0]).focus();
      }
    }
  };
  document.addEventListener('keydown', onKey);
  close.addEventListener('click', () => api.close());
  if (dismissable) overlay.addEventListener('pointerdown', e => { if (e.target === overlay) api.close(); });
  return api;
}

function downloadJSON(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportExtension(ext) {
  const { id, name, color, blocks } = normalizeExtension(clone(ext));
  downloadJSON(slug(name) + '.boakext.json', { boakcodeExtension: 1, id, name, color, blocks });
}

// Add an extension to the project, or replace the one with the same id.
function installExtension(ext) {
  const i = project.extensions.findIndex(e => e.id === ext.id);
  if (i >= 0) {
    if (!confirm(`"${project.extensions[i].name}" is already in this project. Replace it?`)) return false;
    remapExtensionInputs(project.extensions[i], ext);
    project.extensions[i] = ext;
  } else {
    project.extensions.push(ext);
  }
  refreshExtensions();
  return true;
}

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------
function openExtensionGallery() {
  const m = openModal('Extensions', { wide: true });
  if (!m) return;

  const render = () => {
    m.body.innerHTML = '';

    m.body.appendChild(el('h3', 'modal-h', 'In this project'));
    if (!project.extensions.length) {
      m.body.appendChild(el('p', 'muted', 'No extensions yet. Add one from the library below, or make your own.'));
    } else {
      const grid = el('div', 'ext-grid');
      for (const ext of project.extensions) {
        grid.appendChild(extCard(ext, '🧩', `${ext.blocks.length} block${ext.blocks.length === 1 ? '' : 's'}`, [
          ['Edit', 'primary', () => { m.close(); openExtensionEditor(ext); }],
          ['Export', '', () => exportExtension(ext)],
          ['Remove', 'danger', () => {
            const used = blockUseCount(ext);
            const warn = used ? `\n\n${used} of its block${used === 1 ? ' is' : 's are'} used in your scripts and will stop working.` : '';
            if (!confirm(`Remove "${ext.name}" from this project?${warn}`)) return;
            project.extensions.splice(project.extensions.indexOf(ext), 1);
            refreshExtensions();
            render();
          }],
        ]));
      }
      m.body.appendChild(grid);
    }

    m.body.appendChild(el('h3', 'modal-h', 'Extension library'));
    const lib = el('div', 'ext-grid');
    for (const item of EXT_LIBRARY) {
      const added = project.extensions.some(e => e.id === item.id);
      lib.appendChild(extCard(item, item.icon, item.description, [
        [added ? 'Added ✓' : 'Add', added ? '' : 'primary', () => {
          if (installExtension(normalizeExtension(clone(item)))) { toast(`Added "${item.name}"`); render(); }
        }, added],
        ['Open in editor', '', () => { m.close(); openExtensionEditor(normalizeExtension(clone(item)), { isNew: true }); }],
      ]));
    }
    m.body.appendChild(lib);
  };

  m.button('Load extension file…', '', () => pickExtensionFile(render));
  m.button('＋ Make an extension', 'primary', () => { m.close(); openExtensionEditor(null); });
  render();
}

function extCard(ext, icon, subtitle, actions) {
  const card = el('div', 'ext-card');
  const sw = el('div', 'swatch', icon);
  sw.style.background = ext.color;
  const info = el('div', 'info');
  info.append(el('h4', null, ext.name), el('p', null, subtitle));
  const bar = el('div', 'actions');
  for (const [label, cls, fn, disabled] of actions) {
    const b = el('button', 'btn small ' + cls, label);
    b.type = 'button';
    b.disabled = !!disabled;
    b.addEventListener('click', fn);
    bar.appendChild(b);
  }
  card.append(sw, info, bar);
  return card;
}

function pickExtensionFile(onDone) {
  const input = el('input');
  input.type = 'file';
  input.accept = '.json,.boakext';
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.blocks)) throw new Error('This is not a Boakcode extension file.');
      const ext = normalizeExtension(data);
      if (!confirmExtensionCode(`"${ext.name}" comes`)) return;
      if (installExtension(ext)) { toast(`Added "${ext.name}"`); if (onDone) onDone(); }
    } catch (err) {
      alert('Could not load that extension: ' + err.message);
    }
  });
  input.click();
}

// ---------------------------------------------------------------------------
// Extension maker / editor
// ---------------------------------------------------------------------------
const CODE_TEMPLATES = {
  command: '// Runs when the block runs. Example:\nutil.say(\'Hello from my block!\');\nawait util.wait(1);\nutil.say(\'\');',
  reporter: '// Return the value this block reports. Example:\nreturn 42;',
  boolean: '// Return true or false. Example:\nreturn sprite.x > 0;',
  hat: '// Checked every frame. The scripts under this block start\n// when this changes from false to true. Example:\nreturn util.mouse.down;',
};
const BLOCK_TYPE_INFO = [
  ['command', 'Command', 'a stack block that does something'],
  ['reporter', 'Reporter', 'a round block that reports a value'],
  ['boolean', 'Boolean', 'a pointy block that reports true/false'],
  ['hat', 'Hat', 'a "when…" block that starts scripts'],
];
const DEFAULT_BLOCK_TEXT = {
  command: 'my block', reporter: 'my value', boolean: 'is it true?', hat: 'when something happens',
};
const CODER_HINTS = {
  command: 'Snap blocks under "define" to say what this block does. Drag its inputs from "This block" into any slot.',
  reporter: 'Snap blocks under "define", then use "report" to send back the answer. Drag its inputs from "This block" into any slot.',
  boolean: 'Snap blocks under "define", then "report" true or false (drop in a pointy block). Drag its inputs from "This block" into any slot.',
  hat: 'Checked every frame: "report" true when the scripts under this hat should start. Keep it quick — no waiting.',
};

function newExtensionBlock(type = 'command', mode = 'blocks') {
  const blk = {
    opcode: randomId(), type, text: DEFAULT_BLOCK_TEXT[type], args: [],
    mode, code: CODE_TEMPLATES[type], scripts: [],
  };
  syncArgs(blk);
  if (mode === 'blocks') ensureDefine(blk);
  return blk;
}

// The block coder's palette: this block's inputs and "report", then the normal blocks
// (minus event hats, which can't run inside a block) and other extensions' blocks.
function renderCoderPalette(pal, blk, draftId) {
  const scroll = pal.scrollTop;
  pal.innerHTML = '';
  const jump = el('select', 'coder-jump');
  jump.setAttribute('aria-label', 'Jump to a block category');
  pal.appendChild(jump);
  const section = (id, title, color) => {
    const sec = el('div', 'pal-section');
    sec.dataset.section = id;
    const h = el('h3', null, title);
    if (color) h.style.color = color;
    sec.appendChild(h);
    pal.appendChild(sec);
    jump.appendChild(new Option(title, id));
    return sec;
  };
  const add = (sec, b) => {
    const item = el('div', 'pal-item');
    item.appendChild(renderBlock(b));
    sec.appendChild(item);
  };
  const usable = type => SPECS[type] && SPECS[type].shape !== 'hat';

  const me = section('this', 'This block', '#e64d6a');
  if (blk.args.length) {
    me.appendChild(el('p', 'pal-note', 'Inputs — drag into any slot:'));
    for (const a of blk.args) add(me, newBlock('ext_arg', [a.name]));
  } else {
    me.appendChild(el('p', 'pal-note', 'Add [NAME] to the block text to give it inputs.'));
  }
  if (blk.type !== 'command') add(me, newBlock('ext_report'));
  add(me, newBlock('ext_stop'));

  for (const c of CATS) {
    const sec = section(c.id, c.name, c.color);
    if (c.id === 'variables') {
      for (const v of project.vars) add(sec, newBlock('var_get', [v.name]));
      if (project.vars.length) for (const type of ['set_var', 'change_var']) add(sec, newBlock(type));
      else sec.appendChild(el('p', 'pal-note', 'Make variables in the main palette.'));
      continue;
    }
    for (const type of PALETTE[c.id].filter(usable)) add(sec, newBlock(type));
  }
  for (const c of extCats) {
    if (c.ext.id === draftId) continue; // this extension's own blocks may be mid-edit
    const types = c.types.filter(usable);
    if (!types.length) continue;
    const sec = section(c.id, c.name, c.color);
    for (const type of types) add(sec, newBlock(type));
  }
  jump.addEventListener('change', () => {
    const sec = pal.querySelector(`[data-section="${jump.value}"]`);
    if (sec) pal.scrollTo({ top: sec.offsetTop - jump.offsetHeight - 12, behavior: 'smooth' });
  });
  pal.scrollTop = scroll;
}

function openExtensionEditor(existing, { isNew = false } = {}) {
  const editingId = existing && !isNew ? existing.id : null;
  const draft = existing ? normalizeExtension(clone(existing)) : normalizeExtension({
    name: 'My Extension',
    color: EXT_COLORS[project.extensions.length % EXT_COLORS.length],
    blocks: [newExtensionBlock('command')],
  });
  let selected = 0;
  let dirty = false;
  let coderSurface = null;
  let tryThread = null;
  const touch = () => { dirty = true; };

  const m = openModal(editingId ? `Edit extension — ${draft.name}` : 'Make an extension', { wide: true, dismissable: false });
  if (!m) return;
  // Ending a Try-it run takes effect at once, even if its code is stuck on its own wait.
  let tryKey = null, tryReset = null;
  const stopTry = () => {
    if (!tryThread) return;
    tryThread.stopped = true;
    if (threads.get(tryKey) === tryThread) threads.delete(tryKey);
    tryThread = null;
    if (tryReset) tryReset();
  };
  const dropCoder = () => { if (coderSurface) { removeSurface(coderSurface); coderSurface = null; } };
  m.onClose = () => {
    if (dirty && !confirm('Close without saving your changes?')) return false;
    stopTry();
    dropCoder();
    for (const k of Object.keys(SPECS)) if (k.startsWith('__preview')) delete SPECS[k];
    return true;
  };

  const wrap = el('div', 'ext-editor');
  const side = el('div', 'ed-side');
  const main = el('div', 'ed-main');
  wrap.append(side, main);
  m.body.appendChild(wrap);

  // --- Extension settings
  const nameInput = el('input');
  nameInput.type = 'text';
  nameInput.value = draft.name;
  nameInput.maxLength = 40;
  const colorInput = el('input');
  colorInput.type = 'color';
  colorInput.value = draft.color;
  const swatches = el('div', 'ed-swatches');
  const setColor = c => { draft.color = c; touch(); renderList(); renderPreview(); };
  for (const c of EXT_COLORS) {
    const s = el('button', 'ed-swatch');
    s.type = 'button';
    s.style.background = c;
    s.title = c;
    s.setAttribute('aria-label', 'Colour ' + c);
    s.addEventListener('click', () => { colorInput.value = c; setColor(c); });
    swatches.appendChild(s);
  }
  nameInput.addEventListener('input', () => { draft.name = nameInput.value; touch(); });
  colorInput.addEventListener('input', () => setColor(colorInput.value));

  const colorRow = el('div', 'ed-color-row');
  colorRow.append(colorInput, swatches);
  side.append(field('Extension name', nameInput), field('Colour', colorRow), el('h4', 'ed-h', 'Blocks'));
  const list = el('div', 'ed-blocklist');
  side.appendChild(list);

  // One button per block type, so adding a reporter (or any other kind) is one click.
  side.appendChild(el('h4', 'ed-h', 'Add a block'));
  const adders = el('div', 'ed-add');
  for (const [type, label] of BLOCK_TYPE_INFO) {
    const b = el('button', 'btn small', '＋ ' + label);
    b.type = 'button';
    b.addEventListener('click', () => {
      draft.blocks.push(newExtensionBlock(type));
      selected = draft.blocks.length - 1;
      touch();
      renderList();
      renderForm();
    });
    adders.appendChild(b);
  }
  side.appendChild(adders);

  function previewEl(blk, key) {
    const type = '__preview' + key;
    SPECS[type] = buildExtSpec(draft, blk, type);
    return renderBlock(newBlock(type));
  }

  let listItems = [];
  function blockHasError(blk) {
    return blk.mode !== 'blocks' && !!compileCode(blk.code).error;
  }
  function updateBadge(i) {
    const item = listItems[i];
    if (!item) return;
    const bad = blockHasError(draft.blocks[i]);
    let badge = item.querySelector('.ed-item-err');
    if (bad && !badge) { badge = el('span', 'ed-item-err', '⚠ code error'); item.appendChild(badge); }
    if (!bad && badge) badge.remove();
  }
  function renderList() {
    list.innerHTML = '';
    listItems = draft.blocks.map((blk, i) => {
      const item = el('div', 'ed-item' + (i === selected ? ' selected' : ''));
      item.tabIndex = 0;
      item.setAttribute('role', 'button');
      item.setAttribute('aria-label', `Edit block "${blk.text}"`);
      item.appendChild(previewEl(blk, '_list' + i));
      item.appendChild(el('span', 'ed-item-kind', (blk.mode === 'blocks' ? '🧩 blocks' : '{ } JavaScript')));
      const choose = () => { if (selected !== i) { selected = i; renderList(); renderForm(); } };
      item.addEventListener('click', choose);
      item.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } });
      list.appendChild(item);
      return item;
    });
    listItems.forEach((_, i) => updateBadge(i));
    if (!draft.blocks.length) list.appendChild(el('p', 'muted', 'No blocks yet — add one below!'));
  }

  // --- Block form
  let previewBox = null;
  function renderPreview() {
    if (!previewBox) return;
    previewBox.innerHTML = '';
    const blk = draft.blocks[selected];
    if (blk) previewBox.appendChild(previewEl(blk, '_main'));
  }

  function renderForm() {
    stopTry();
    dropCoder();
    main.innerHTML = '';
    previewBox = null;
    const blk = draft.blocks[selected];
    if (!blk) {
      main.appendChild(el('p', 'muted', 'Add a block to get started.'));
      return;
    }

    previewBox = el('div', 'ed-preview');
    main.append(el('h4', 'ed-h', 'Preview'), previewBox);

    // Type
    const typeRow = el('div', 'ed-types');
    for (const [type, label, hint] of BLOCK_TYPE_INFO) {
      const b = el('button', 'ed-type' + (blk.type === type ? ' selected' : ''));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(blk.type === type));
      b.append(el('strong', null, label), el('span', null, hint));
      b.addEventListener('click', () => {
        if (blk.type === type) return;
        if (blk.code.trim() === CODE_TEMPLATES[blk.type].trim()) blk.code = CODE_TEMPLATES[type];
        blk.type = type;
        touch();
        renderList();
        renderForm();
      });
      typeRow.appendChild(b);
    }
    main.append(el('h4', 'ed-h', 'Block type'), typeRow);

    // Text
    const textInput = el('input', 'ed-text');
    textInput.type = 'text';
    textInput.value = blk.text;
    textInput.spellcheck = false;
    const warn = el('p', 'ed-warn');
    const argsBox = el('div');
    const showDupes = () => {
      const d = duplicateArgNames(blk.text);
      warn.textContent = d.length ? `⚠ ${d.join(', ')} appears more than once — only the first one becomes an input.` : '';
    };
    textInput.addEventListener('input', () => {
      blk.text = textInput.value;
      syncArgs(blk);
      touch();
      showDupes();
      renderArgs();
      renderList();
      renderPreview();
      if (coderSurface) { coderSurface.refreshPalette(); coderSurface.render(); }
    });
    showDupes();
    main.append(
      el('h4', 'ed-h', 'Block text'),
      textInput,
      el('p', 'hint', 'Put input names in square brackets, like: move [STEPS] steps to [PLACE]'),
      warn,
      argsBox,
    );

    function renderArgs() {
      argsBox.innerHTML = '';
      if (!blk.args.length) return;
      const table = el('table', 'args-table');
      const head = el('tr');
      for (const h of ['Input', 'Type', 'Default value']) head.appendChild(el('th', null, h));
      table.appendChild(head);
      for (const a of blk.args) {
        const tr = el('tr');
        const type = el('select');
        type.setAttribute('aria-label', `Type of input ${a.name}`);
        for (const t of EXT_ARG_TYPES) type.appendChild(new Option(t, t));
        type.value = a.type;
        type.addEventListener('change', () => { a.type = type.value; touch(); renderArgs(); renderList(); renderPreview(); });
        const defCell = el('td');
        if (a.type !== 'boolean') {
          const def = el('input');
          def.type = 'text';
          def.value = a.default;
          def.placeholder = a.type === 'menu' ? 'first option' : '';
          def.setAttribute('aria-label', `Default value of ${a.name}`);
          def.addEventListener('input', () => { a.default = def.value; touch(); renderList(); renderPreview(); });
          defCell.appendChild(def);
        } else {
          defCell.appendChild(el('span', 'muted', '(empty slot)'));
        }
        if (a.type === 'menu') {
          const opts = el('input', 'ed-opts');
          opts.type = 'text';
          opts.value = a.options;
          opts.placeholder = 'options, separated, by commas';
          opts.setAttribute('aria-label', `Menu options for ${a.name}`);
          opts.addEventListener('input', () => { a.options = opts.value; touch(); renderList(); renderPreview(); });
          defCell.appendChild(opts);
        }
        const typeCell = el('td');
        typeCell.appendChild(type);
        tr.append(el('td', 'arg-name', a.name), typeCell, defCell);
        table.appendChild(tr);
      }
      argsBox.appendChild(table);
    }
    renderArgs();

    // How the block works: snapped-together blocks, or JavaScript.
    const modeRow = el('div', 'ed-modes');
    for (const [mode, label, hint] of [
      ['blocks', '🧩 Blocks', 'snap blocks together'],
      ['js', '{ } JavaScript', 'write code'],
    ]) {
      const b = el('button', 'ed-type' + (blk.mode === mode ? ' selected' : ''));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(blk.mode === mode));
      b.append(el('strong', null, label), el('span', null, hint));
      b.addEventListener('click', () => {
        if (blk.mode === mode) return;
        blk.mode = mode;
        if (mode === 'blocks') ensureDefine(blk);
        touch();
        renderList();
        renderForm();
      });
      modeRow.appendChild(b);
    }
    main.append(el('h4', 'ed-h', 'Code it with'), modeRow);

    if (blk.mode === 'blocks') renderCoder(blk);
    else renderJsEditor(blk);

    // Try it
    const result = el('div', 'ed-result');
    result.setAttribute('aria-live', 'polite');
    const sprite = currentSprite();
    const tryLabel = '▶ Try it on ' + sprite.name;
    const tryBtn = el('button', 'btn small', tryLabel);
    tryBtn.type = 'button';
    tryBtn.addEventListener('click', async () => {
      if (tryThread) { stopTry(); return; }
      const spec = buildExtSpec(draft, blk, '__preview_try');
      SPECS['__preview_try'] = spec;
      const b = newBlock('__preview_try');
      const previewBlock = previewBox.firstChild && previewBox.firstChild._block;
      if (previewBlock) b.inputs = previewBlock.inputs.slice(); // use the values typed into the preview
      // Run it as a real thread, so the Stop button (and closing the editor) can end it.
      const key = {};
      const t = new Thread(sprite, key);
      threads.set(key, t);
      tryThread = t;
      tryKey = key;
      tryReset = () => { tryBtn.textContent = tryLabel; result.className = 'ed-result'; result.textContent = 'Stopped'; };
      tryBtn.textContent = '■ Stop';
      result.className = 'ed-result';
      result.textContent = 'Running…';
      try {
        const value = await callExtension(t, spec.ext, await extArgs(t, b, spec.ext.argDefs));
        if (t.stopped) {
          // Stopped by the editor (already shown) or by the main Stop button (show it now).
          if (tryThread === t) { result.className = 'ed-result'; result.textContent = 'Stopped'; }
          return;
        }
        result.className = 'ed-result ok';
        result.textContent =
          blk.type === 'command' ? '✓ Ran without errors'
            : blk.type === 'hat' ? '✓ Right now the condition is ' + extToBool(value) + (extToBool(value) ? ' — scripts would start' : '')
              : '✓ Reported: ' + fmt(blk.type === 'boolean' ? extToBool(value) : toPrimitive(value));
      } catch (err) {
        if (t.stopped && tryThread !== t) return; // already reported as stopped
        result.className = 'ed-result' + (err === STOP ? '' : ' err');
        result.textContent = err === STOP ? 'Stopped' : '✗ ' + (err && err.message ? err.message : String(err));
      } finally {
        t.finished = true;
        if (threads.get(key) === t) threads.delete(key);
        if (tryThread === t) { tryThread = null; tryBtn.textContent = tryLabel; }
      }
    });

    const del = el('button', 'btn small danger', 'Delete block');
    del.type = 'button';
    del.addEventListener('click', () => {
      if (!confirm('Delete this block?')) return;
      draft.blocks.splice(selected, 1);
      selected = Math.max(0, selected - 1);
      touch();
      renderList();
      renderForm();
    });

    const actions = el('div', 'ed-actions');
    actions.append(tryBtn, result, el('span', 'spacer'), del);
    main.appendChild(actions);
    renderPreview();
  }

  function renderJsEditor(blk) {
    const code = el('textarea', 'code');
    code.value = blk.code;
    code.spellcheck = false;
    code.setAttribute('aria-label', 'JavaScript code');
    code.rows = Math.min(18, Math.max(8, blk.code.split('\n').length + 2));
    const status = el('div', 'status');
    const checkCode = () => {
      const err = compileCode(blk.code).error;
      status.className = 'status ' + (err ? 'err' : 'ok');
      status.textContent = err ? '✗ ' + err : '✓ No syntax errors';
    };
    code.addEventListener('input', () => {
      blk.code = code.value;
      touch();
      checkCode();
      updateBadge(selected);
    });
    code.addEventListener('keydown', e => {
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        code.setRangeText('  ', code.selectionStart, code.selectionEnd, 'end');
        code.dispatchEvent(new Event('input'));
      }
    });
    checkCode();
    const help = el('details', 'ed-help');
    help.append(el('summary', null, 'What can my code use?'), el('pre', null, EXT_API_HELP));
    main.append(code, status, help);
  }

  // The block coder: a palette and workspace of its own, wired into the shared drag & drop.
  function renderCoder(blk) {
    ensureDefine(blk);
    const coder = el('div', 'coder');
    const pal = el('div', 'coder-palette');
    const ws = el('div', 'coder-ws');
    const canvas = el('div', 'coder-canvas');
    ws.appendChild(canvas);
    coder.append(pal, ws);
    main.append(el('p', 'hint', CODER_HINTS[blk.type]), coder);
    const sf = {
      palette: pal,
      deleteAreas: [pal],
      ws,
      canvas,
      get scripts() { return blk.scripts; },
      render: () => { ensureDefine(blk); renderScripts(canvas, blk.scripts); },
      changed: () => touch(),
      copyToSprites: false,
      cleanUp: null,
      refreshPalette: () => renderCoderPalette(pal, blk, draft.id),
      // Clicking a reporter in the coder's palette shows its value, like the main palette.
      click: p => {
        if (!p.fromPalette) return;
        const b = clone(p.block);
        const shape = specOf(b.type).shape;
        if (shape === 'reporter' || shape === 'boolean') report(currentSprite(), b, p.el);
      },
    };
    sf.refreshPalette();
    sf.render();
    addSurface(sf);
    coderSurface = sf;
  }

  function field(label, control) {
    const f = el('label', 'ed-field');
    f.append(el('span', null, label), control);
    return f;
  }

  m.button('Export file', '', () => exportExtension(draft));
  m.button('Cancel', '', () => m.close());
  m.button(editingId ? 'Save changes' : 'Add to project', 'primary', () => {
    draft.name = draft.name.trim();
    if (!draft.name) { alert('Give your extension a name.'); nameInput.focus(); return; }
    const empty = draft.blocks.findIndex(b => !b.text.trim());
    if (empty >= 0) { selected = empty; renderList(); renderForm(); alert('Every block needs some text.'); return; }
    const ext = normalizeExtension(clone(draft));
    if (editingId) {
      const i = project.extensions.findIndex(e => e.id === editingId);
      if (i >= 0) {
        remapExtensionInputs(project.extensions[i], ext, { includeNew: true });
        project.extensions[i] = ext;
      } else {
        project.extensions.push(ext);
      }
      refreshExtensions();
    } else if (!installExtension(ext)) {
      return;
    }
    dirty = false;
    m.close();
    toast(editingId ? `Saved "${ext.name}"` : `Added "${ext.name}" — find its blocks in the palette`);
    const sec = paletteEl.querySelector(`[data-section="ext-${ext.id}"]`);
    if (sec) paletteEl.scrollTo({ top: sec.offsetTop - 4, behavior: 'smooth' });
  });

  renderList();
  renderForm();
}
