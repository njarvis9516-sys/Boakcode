# Boakcode

Boakcode is a clone of [Scratch](https://scratch.mit.edu): a block-based coding editor that runs entirely in the browser with no dependencies and no build step. It was built with Claude.

## Running it

Open `index.html` in a browser. To serve it locally instead:

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```

## What you can do

- **Build scripts**: drag blocks from the palette into the workspace. Stack blocks snap together, and reporters (round) and booleans (hexagon) drop into input slots.
- **Run scripts**: click the green flag, press keys, click sprites, or click any script in the workspace to run it. A running script glows yellow. Click a reporter to see its value.
- **Edit**:
  - Drag a block back to the palette to delete it.
  - Right-click a block to duplicate or delete it.
  - Use **Clean up** to tidy the workspace.
- **Sprites**:
  - Add sprites with any emoji as a costume.
  - Drag sprites around the stage.
  - Drop a script onto another sprite's tile to copy it to that sprite.
- **Save**: your work is saved in the browser automatically. **Save** downloads a `.boak.json` file, and **Load** opens one.

## Costumes and sounds

Use the **🧩 Code**, **🖌 Costumes** and **🔊 Sounds** tabs above the blocks.

**Costumes**: each sprite has a list of costumes:
- **🖌 Paint**: draw your own with the brush, eraser, line, rectangle, ellipse, fill bucket and colour picker. You can change the size, choose filled or outlined shapes, and use undo/redo (Ctrl+Z / Ctrl+Y) and clear. The **+** in the middle of the canvas is the costume's centre, which is where the sprite's position is on the stage.
- **😀 Emoji**: use any emoji. **Paint on it** turns an emoji costume into a painting you can draw on.
- **📁 Upload**: import a picture (PNG, JPG, GIF, SVG or WebP). Big pictures are shrunk to fit the stage, and you can paint on uploaded pictures too.
- The sprite list also has **Paint** and **Upload** tiles for making a new sprite straight from a drawing or a picture.
- Blocks: `switch costume to [▾]` (by name, number or emoji), `next costume`, `costume number` and `costume name`. Renaming a costume updates the blocks that use it.

**Sounds**: each sprite has a list of sounds:
- **🎹 Make a sound**: the sound maker is a grid where each column is a step and each row is a note from C4 to C6. Click or drag to add notes, then pick an instrument (piano, organ, 8-bit, bass, bell), a speed and a length. Sounds you make can be edited at any time.
- **📁 Upload**: import an audio file (MP3, WAV, OGG…). **Imported sounds can't be edited**: you can play, rename or delete them, but not change them.
- Blocks: `play sound [▾] until done` and `start sound [▾]`, alongside `stop all sounds`, notes, drums and volume.

Pictures and sounds are saved inside the project. Very big ones may not fit in the browser's own storage; if that happens, Boakcode tells you, and you can use **Save** to download the project instead.

## Extensions

Click **🧩 Extensions** at the bottom of the category list to:

- **Add from the library**: Text Tools, Math Plus, Date & Time and Fun Effects. They include two hats ("when timer is over" and "when mouse is closer than") and two blocks built with the block coder ("average of" and "wiggle").
- **Make your own** with the extension maker:
  1. Pick a name and colour.
  2. Add blocks with the **＋ Command**, **＋ Reporter**, **＋ Boolean** and **＋ Hat** buttons:
     - a *command* is a stack block
     - a *reporter* is round and reports a value
     - a *boolean* is pointy and reports true or false
     - a *hat* is a "when…" block whose scripts start when its answer changes from false to true (it's checked every frame)
  3. Write each block's text, using `[NAME]` for inputs, e.g. `greet [NAME] [TIMES] times`. Inputs can be numbers, text, booleans or drop-down menus.
  4. Choose how to code it:
     - **🧩 Blocks**: snap ordinary Boakcode blocks together under the pink `define` block, just like Scratch's "Make a Block". The **This block** section has a reporter for each input to drag into slots, plus `report` (send back a value) and `stop this block`.
     - **{ } JavaScript**: write code. The editor checks for syntax errors as you type, and **What can my code use?** lists helpers such as `util.wait`, `util.say`, `util.moveTo` and `util.getVar`.
  5. **Try it** runs the block on the current sprite. While it's running, the same button stops it.
- **Edit** any extension with the **Edit** button next to its name in the palette, or from the Extensions window.
- **Share**: **Export** downloads a `.boakext.json` file, and **Load extension file…** imports one.

Extensions are saved inside the project, so they travel with saved project files. If you change a block's inputs later, values already typed into that block in your scripts move to the right inputs. Extension code is ordinary JavaScript running in the page, so Boakcode asks you to confirm before loading extensions from files. Only load extensions from people you trust.

### Block categories

| Category  | Highlights |
|-----------|------------|
| Motion    | move, turn, go to, glide, point towards, bounce, rotation style |
| Looks     | say/think (timed or not), costume, size, colour/ghost/brightness effects, show/hide |
| Sound     | play note (synth), drums, volume |
| Events    | when flag clicked, when key pressed, when sprite clicked, broadcasts |
| Control   | wait, repeat, forever, if/else, wait until, repeat until, stop all |
| Sensing   | touching edge/mouse, key pressed, mouse x/y, ask & answer, timer |
| Operators | arithmetic, random, comparisons, and/or/not, join, letter of, length, contains, mod, round, math functions |
| Variables | make variables, set/change, show on stage |
| Pen       | pen down/up, colour, size, stamp, erase all |

## How it's built

- `index.html` is the page layout.
- `style.css` holds the Scratch-style look, including block shapes per category.
- `extensions.js` has the extension system: the library, the gallery, the maker/editor (with the block coder), and how extension blocks are registered and run.
- `media.js` has costumes and sounds: the tabs, the paint editor, the sound maker, imports, and sound playback.
- `app.js` contains:
  - the block definitions (`SPECS`)
  - DOM rendering of blocks
  - drag-and-drop with snapping
  - the canvas stage
  - the interpreter: each script runs as a cooperative async "thread" that yields once per animation frame inside loops, the way Scratch does
