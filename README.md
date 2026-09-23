# MyPuzzles Book Studio

A local-first app for printable puzzle books. It renders puzzle books from a bundle, imports and inspects existing PDFs, packs a book for a printer, and exports print-ready files. **Everything runs on your own machine**; no account, no upload, no server.

This repository is the local companion to the MyPuzzles web app's book engine. The web app generates puzzles and reviews books; this studio is where you compose, inspect, fix and export the files you send to a printer.

## Quick start (Windows)

1. Install [Node.js 18+](https://nodejs.org) once.
2. Double-click **`Start Book Studio.cmd`**.
3. The studio opens at <http://localhost:4173>.

## Quick start (any platform)

```bash
npm install
npm start            # opens the studio on http://localhost:4173
```

## Command line

```bash
node src/cli.js serve                          # local studio in the browser
node src/cli.js render <bundle.json> [outDir]  # screen, print, cover and print-pack PDFs
node src/cli.js inspect <file.pdf>             # page count, page size, hash
node src/cli.js verify <file.pdf>              # print-readiness checks
node src/cli.js pack <interior.pdf> [cover.pdf] [out.pdf]
node src/cli.js watermark <file.pdf> "Sold to ..." [out.pdf]
node src/cli.js selftest                        # renders examples/sample-bundle.json
```

## The bundle format

A bundle is JSON. Export one from the web app (Admin → Printable books → *Export bundle*) or write one by hand; see [`examples/sample-bundle.json`](examples/sample-bundle.json).

```json
{
  "title": "Sudoku — 100 Puzzles",
  "subtitle": "Very Easy to Elite · Answers in the second half",
  "trimSize": "A4",
  "answersInBack": true,
  "puzzles": [
    {
      "puzzleNumber": 1,
      "puzzleType": "sudoku",
      "difficulty": "easy",
      "board": [["3", "8", "."]],
      "prompt": "Complete the 9x9 Sudoku grid.",
      "metadata": { "colors": [] },
      "solution": ["384675219,562891347,..."]
    }
  ]
}
```

`puzzleType` may be any of: wordsearch, crossword, cryptic-crossword, kriss-kross, backwords, pieceword, sudoku, colour-sudoku, codeword, pathfinder.

## What it guarantees

- **Every puzzle gets an answer page.** The renderer groups answers by grid legibility (6 per page for small grids, 1 for very large ones) and refuses to write a book whose answers do not all fit.
- **An even page count**, which print-on-demand requires.
- **Embedded fonts** (DejaVu Sans, bundled with its licence) so a printer can reproduce the pages exactly.
- **Deterministic output**: the same bundle always renders the same pages.

## Printing yourself

`render` writes four files:

| File | Use |
| --- | --- |
| `*-digital.pdf` | the reading copy customers get (screen colours, smaller) |
| `*-print.pdf` | the interior for the printer: A4, grayscale-friendly, even page count |
| `*-cover.pdf` | the cover wrap, with the spine width computed from the real page count |
| `*-print-pack.pdf` | interior + cover in one file, which most print shops prefer |

`verify` reports page count, page size, whether the page count is even, and file size before you send anything out.

## Repository layout

```
src/recipe.js   book recipes (100-puzzle Standard, 50-puzzle Gauntlet) and page layout
src/render.js   the PDF renderer for all ten printable puzzle families
src/pdf.js      inspect, verify, merge, pack, watermark
src/cli.js      command line and the local studio server
public/         the studio web interface
assets/fonts/   DejaVu Sans, embedded in every PDF
examples/       a ready-to-render sample bundle
docs/           notes on the bundle format and printing
```

## Licence

Bundled DejaVu fonts are covered by their own licence in `assets/fonts/LICENSE-DejaVu.txt`. The rest of this repository is © SETTIS LLC / MyPuzzles.