# Bundle format

A bundle is a plain JSON file describing one book. It is deliberately simple so
it can be produced by any tool.

| Field | Required | Notes |
| --- | --- | --- |
| `title` | yes | shown on the cover, the title page and the file names |
| `subtitle` | no | cover and title page |
| `author` | no | PDF metadata, defaults to MyPuzzles |
| `volumeVersion` | no | printed in the front matter, defaults to 1 |
| `trimSize` | no | `A4` (default), `US_LETTER`, `SIX_BY_NINE` |
| `answersInBack` | no | defaults to true; set false for a puzzle-only book |
| `generatedAt` | no | ISO date; also keeps rendering deterministic |
| `shopUrl` | no | printed in the back matter |
| `puzzles` | yes | array, one entry per puzzle, in book order |

Each puzzle:

| Field | Notes |
| --- | --- |
| `puzzleNumber` | optional; the array order is used when it is missing |
| `puzzleType` | one of the ten printable families |
| `difficulty` | `very-easy`, `easy`, `normal`, `hard`, `very-hard`, `elite` |
| `board` | grid as an array of rows; `#` is a blocked crossword cell, `.` an empty sudoku cell |
| `prompt` | one line printed above the grid |
| `instructions` | array of lines, used when a family has no clue list |
| `metadata` | family-specific: `entries` (clue numbers), `across`/`down` (clues), `targets` (wordsearch/pathfinder words), `wordBank` (kriss kross), `colors` (colour sudoku), `numbers`/`revealed` (codeword) |
| `solution` | what the answer key prints; crossword uses `cell:row:col:LETTER` entries, sudoku a comma-separated list of solved rows |

## Exporting a bundle from the web app

Admin → **Printable books** → a volume → **Export bundle**. The file contains the
exact puzzles stored in that volume, so the studio reproduces the same book
offline. Import the finished PDF back with **Import a PDF book** (also available
to moderators) and it becomes a new version of that edition, ready for review.