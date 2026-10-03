'use strict';
/*
 * Boakcode extensions.
 *
 * An extension is a new block category whose blocks run JavaScript:
 *   { id, name, color, blocks: [{ opcode, type, text, args, code }] }
 * - type: "command" (stack block), "reporter" (round, returns a value) or "boolean" (hexagon).
 * - text: the block label; [NAME] marks an input, e.g. "repeat [TEXT] [TIMES] times".
 * - args: one entry per input name: { name, type: number|text|boolean|menu, default, options }.
 * - code: the body of an async function (args, sprite, util) — see EXT_API_HELP.
 *
 * Extensions are stored inside the project, so they travel with saved projects,
 * and can also be exported/imported on their own as .boakext.json files.
 *
 * This file is loaded before app.js; everything here is only called after app.js has booted.
 */

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const EXT_ARG_RE = /\[([A-Za-z_][A-Za-z0-9_]*)\]/g;
const EXT_BLOCK_TYPES = ['command', 'reporter', 'boolean'];
const EXT_ARG_TYPES = ['number', 'text', 'boolean', 'menu'];
const EXT_SHAPES = { command: 'stack', reporter: 'reporter', boolean: 'boolean' };
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

Reporter and boolean blocks "return" their value.`;

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
          'while (Date.now() < end) {',
          '  util.moveTo(x + util.random(-6, 6), y + util.random(-6, 6));',
          '  await util.frame();',
          '}',
          'util.moveTo(x, y);',
        ].join('\n') },
      { opcode: 'spin', type: 'command', text: 'spin around [TIMES] times',
        args: [{ name: 'TIMES', type: 'number', default: 1 }],
        code: [
          'const style = sprite.rotationStyle;',
          'sprite.rotationStyle = \'all around\';',
          'for (let i = 0; i < args.TIMES * 24; i++) {',
          '  util.turn(15);',
          '  await util.frame();',
          '}',
          'sprite.rotationStyle = style;',
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

function argNames(text) {
  const names = [];
  for (const m of String(text).matchAll(EXT_ARG_RE)) if (!names.includes(m[1])) names.push(m[1]);
  return names;
}
function guessArgType(name) {
  return /^(N|NUM|NUMBER|X|Y|A|B|SECS|SECONDS|TIMES|STEPS|COUNT|AMOUNT|SIZE|HEIGHT|WIDTH)$/i.test(name) ? 'number' : 'text';
}
// Keep a block's args list in step with the [NAME] placeholders in its text.
function syncArgs(blk) {
  blk.args = argNames(blk.text).map(n => blk.args.find(a => a.name === n) ||
    { name: n, type: guessArgType(n), default: '', options: '' });
}

function normalizeExtension(e) {
  e = e || {};
  const ext = {
    id: String(e.id || slug(e.name) + '_' + randomId()).replace(/[^\w-]/g, '_'),
    name: String(e.name || 'My Extension').slice(0, 40),
    color: isHexColor(e.color) ? e.color : EXT_COLORS[0],
    blocks: (Array.isArray(e.blocks) ? e.blocks : []).map(b => ({
      opcode: String((b && b.opcode) || randomId()).replace(/[^\w]/g, '_'),
      type: EXT_BLOCK_TYPES.includes(b && b.type) ? b.type : 'command',
      text: String((b && b.text) || 'new block'),
      args: (Array.isArray(b && b.args) ? b.args : []).map(a => ({
        name: String(a.name),
        type: EXT_ARG_TYPES.includes(a.type) ? a.type : 'text',
        default: a.default ?? '',
        options: String(a.options || ''),
      })),
      code: String((b && b.code) || ''),
    })),
  };
  ext.blocks.forEach(syncArgs);
  return ext;
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
  const order = [...String(blk.text).matchAll(EXT_ARG_RE)].map(m => m[1]);
  const argDefs = order.map(n => byName[n] || { name: n, type: 'text', default: '' });
  return {
    type,
    cat: 'ext-' + ext.id,
    shape: EXT_SHAPES[blk.type] || 'stack',
    // "%" marks inputs in SPECS text, so show a literal percent sign as a full-width one.
    text: String(blk.text).replace(/%/g, '％').replace(EXT_ARG_RE, '%'),
    args: argDefs.map(argSpec),
    color: ext.color,
    colorDark: darken(ext.color),
    ext: { ext, blk, argDefs, ...compileCode(blk.code) },
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
  registerExtensions(project.extensions);
  renderCategories();
  renderPalette();
  renderWorkspace();
  updateActiveCategory();
  save();
}

// ---------------------------------------------------------------------------
// Running extension blocks
// ---------------------------------------------------------------------------
function makeUtil(t) {
  const s = t.sprite;
  return {
    wait: secs => waitSecs(t, num(secs)),
    frame: () => frame(t),
    moveTo: (x, y) => moveTo(s, num(x), num(y)),
    turn: d => setDir(s, s.dir + num(d)),
    pointIn: d => setDir(s, num(d)),
    say: text => { s._bubble = text == null || text === '' ? null : { text: fmt(text), kind: 'say' }; },
    think: text => { s._bubble = text == null || text === '' ? null : { text: fmt(text), kind: 'think' }; },
    setCostume: c => { if (c) { s.costume = String(c); uiDirty = true; } },
    getVar: name => getVarObj(String(name)).value,
    setVar: (name, value) => { getVarObj(String(name)).value = value; },
    broadcast: msg => { broadcast(msg); },
    playNote: (note, secs = 0.5) => playNote(num(note), num(secs), s.volume),
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
    const v = await val(t, b.inputs[i]);
    args[d.name] = d.type === 'number' ? num(v) : d.type === 'boolean' ? bool(v) : v;
  }
  return args;
}

async function runExtBlock(t, b) {
  const spec = SPECS[b.type];
  const x = spec.ext;
  const args = await extArgs(t, b, x.argDefs);
  if (x.error) { extError(x, x.error); return ''; }
  try {
    const result = await x.fn(args, t.sprite, makeUtil(t));
    if (t.stopped) throw STOP;
    return spec.shape === 'boolean' ? bool(result) : (result ?? '');
  } catch (err) {
    if (err === STOP) throw err;
    extError(x, err && err.message ? err.message : String(err));
    return '';
  }
}

function extError(x, message) {
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
function openModal(title, { wide = false, dismissable = true } = {}) {
  const overlay = el('div', 'modal-overlay');
  const modal = el('div', 'modal' + (wide ? ' wide' : ''));
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-label', title);
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
  const api = {
    body, foot,
    onClose: null,
    close() {
      if (api.onClose && api.onClose() === false) return;
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    },
    button(label, cls, fn) {
      const b = el('button', 'btn ' + (cls || ''), label);
      b.type = 'button';
      b.addEventListener('click', fn);
      foot.appendChild(b);
      return b;
    },
  };
  const onKey = e => { if (e.key === 'Escape') api.close(); };
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
  const { id, name, color, blocks } = ext;
  downloadJSON(slug(name) + '.boakext.json', { boakcodeExtension: 1, id, name, color, blocks });
}

// Add (or replace) an extension in the project.
function installExtension(ext) {
  const i = project.extensions.findIndex(e => e.id === ext.id);
  if (i >= 0) {
    if (!confirm(`"${project.extensions[i].name}" is already in this project. Replace it?`)) return false;
    project.extensions[i] = ext;
  } else {
    project.extensions.push(ext);
  }
  refreshExtensions();
  return true;
}

function blockUseCount(ext) {
  const prefix = `ext.${ext.id}.`;
  let count = 0;
  const walk = blocks => {
    for (const b of blocks) {
      if (b.type.startsWith(prefix)) count++;
      for (const v of b.inputs) if (v && typeof v === 'object') walk([v]);
      if (b.bodies) b.bodies.forEach(walk);
    }
  };
  for (const s of project.sprites) for (const sc of s.scripts) walk(sc.blocks);
  return count;
}

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------
function openExtensionGallery() {
  const m = openModal('Extensions', { wide: true });

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
};

function newExtensionBlock(type = 'command') {
  return { opcode: randomId(), type, text: type === 'command' ? 'my block' : 'my value', args: [], code: CODE_TEMPLATES[type] };
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
  const touch = () => { dirty = true; };

  const m = openModal(editingId ? `Edit extension — ${draft.name}` : 'Make an extension', { wide: true, dismissable: false });
  m.onClose = () => {
    if (dirty && !confirm('Close without saving your changes?')) return false;
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
  for (const c of EXT_COLORS) {
    const s = el('button', 'ed-swatch');
    s.type = 'button';
    s.style.background = c;
    s.title = c;
    s.addEventListener('click', () => { colorInput.value = c; draft.color = c; touch(); renderList(); renderPreview(); });
    swatches.appendChild(s);
  }
  nameInput.addEventListener('input', () => { draft.name = nameInput.value; touch(); });
  colorInput.addEventListener('input', () => { draft.color = colorInput.value; touch(); renderList(); renderPreview(); });

  side.append(
    field('Extension name', nameInput),
    field('Colour', el('div', 'ed-color-row'), row => row.append(colorInput, swatches)),
    el('h4', 'ed-h', 'Blocks'),
  );
  const list = el('div', 'ed-blocklist');
  const addBtn = el('button', 'btn small', '＋ Add block');
  addBtn.type = 'button';
  addBtn.addEventListener('click', () => {
    draft.blocks.push(newExtensionBlock('command'));
    selected = draft.blocks.length - 1;
    touch();
    renderList();
    renderForm();
  });
  side.append(list, addBtn);

  function previewEl(blk, key) {
    const type = '__preview' + key;
    SPECS[type] = buildExtSpec(draft, blk, type);
    const b = newBlock(type);
    return renderBlock(b);
  }

  function renderList() {
    list.innerHTML = '';
    draft.blocks.forEach((blk, i) => {
      const item = el('div', 'ed-item' + (i === selected ? ' selected' : ''));
      item.tabIndex = 0;
      item.appendChild(previewEl(blk, '_list' + i));
      const err = compileCode(blk.code).error;
      if (err) item.appendChild(el('span', 'ed-item-err', '⚠ code error'));
      const choose = () => { selected = i; renderList(); renderForm(); };
      item.addEventListener('click', choose);
      item.addEventListener('keydown', e => { if (e.key === 'Enter') choose(); });
      list.appendChild(item);
    });
    if (!draft.blocks.length) list.appendChild(el('p', 'muted', 'No blocks yet — add one!'));
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
    for (const [type, label, hint] of [
      ['command', 'Command', 'a stack block that does something'],
      ['reporter', 'Reporter', 'a round block that reports a value'],
      ['boolean', 'Boolean', 'a pointy block that reports true/false'],
    ]) {
      const b = el('button', 'ed-type' + (blk.type === type ? ' selected' : ''));
      b.type = 'button';
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
    const argsBox = el('div');
    textInput.addEventListener('input', () => {
      blk.text = textInput.value;
      syncArgs(blk);
      touch();
      renderArgs();
      renderList();
      renderPreview();
    });
    main.append(
      el('h4', 'ed-h', 'Block text'),
      textInput,
      el('p', 'hint', 'Put input names in square brackets, like: move [STEPS] steps to [PLACE]'),
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
        for (const t of EXT_ARG_TYPES) type.appendChild(new Option(t, t));
        type.value = a.type;
        type.addEventListener('change', () => { a.type = type.value; touch(); renderArgs(); renderList(); renderPreview(); });
        const defCell = el('td');
        if (a.type !== 'boolean') {
          const def = el('input');
          def.type = 'text';
          def.value = a.default;
          def.placeholder = a.type === 'menu' ? 'first option' : '';
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

    // Code
    const code = el('textarea', 'code');
    code.value = blk.code;
    code.spellcheck = false;
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
    });
    code.addEventListener('change', renderList);
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

    // Try it
    const result = el('div', 'ed-result');
    const tryBtn = el('button', 'btn small', '▶ Try it on ' + currentSprite().name);
    tryBtn.type = 'button';
    tryBtn.addEventListener('click', async () => {
      const spec = buildExtSpec(draft, blk, '__preview_try');
      SPECS['__preview_try'] = spec;
      const b = newBlock('__preview_try');
      const previewBlock = previewBox.firstChild && previewBox.firstChild._block;
      if (previewBlock) b.inputs = previewBlock.inputs.slice(); // use the values typed into the preview
      if (spec.ext.error) { result.className = 'ed-result err'; result.textContent = '✗ ' + spec.ext.error; return; }
      const t = new Thread(currentSprite(), null);
      result.className = 'ed-result';
      result.textContent = 'Running…';
      try {
        const args = await extArgs(t, b, spec.ext.argDefs);
        const value = await spec.ext.fn(args, t.sprite, makeUtil(t));
        result.className = 'ed-result ok';
        result.textContent = blk.type === 'command' ? '✓ Ran without errors' : '✓ Reported: ' + fmt(blk.type === 'boolean' ? bool(value) : value ?? '');
      } catch (err) {
        result.className = 'ed-result err';
        result.textContent = '✗ ' + (err && err.message ? err.message : String(err));
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
    main.append(el('h4', 'ed-h', 'Code (JavaScript)'), code, status, help, actions);
    renderPreview();
  }

  function field(label, input, fill) {
    const f = el('label', 'ed-field');
    f.appendChild(el('span', null, label));
    f.appendChild(input);
    if (fill) fill(input);
    return f;
  }

  m.button('Export file', '', () => exportExtension(normalizeExtension(draft)));
  m.button('Cancel', '', () => m.close());
  m.button(editingId ? 'Save changes' : 'Add to project', 'primary', () => {
    draft.name = draft.name.trim();
    if (!draft.name) { alert('Give your extension a name.'); nameInput.focus(); return; }
    const empty = draft.blocks.findIndex(b => !b.text.trim());
    if (empty >= 0) { selected = empty; renderList(); renderForm(); alert('Every block needs some text.'); return; }
    const ext = normalizeExtension(draft);
    if (editingId) {
      const i = project.extensions.findIndex(e => e.id === editingId);
      if (i >= 0) project.extensions[i] = ext; else project.extensions.push(ext);
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
