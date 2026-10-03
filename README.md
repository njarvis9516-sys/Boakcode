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
- `app.js` contains:
  - the block definitions (`SPECS`)
  - DOM rendering of blocks
  - drag-and-drop with snapping
  - the canvas stage
  - the interpreter: each script runs as a cooperative async "thread" that yields once per animation frame inside loops, the way Scratch does
