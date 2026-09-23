/**
 * Book renderer (mirrors lib/puzzle-books/render/index.ts in the MyPuzzles web app).
 *
 * Generated from the web app renderer so an offline render and a web render
 * produce the same book: two puzzles per page where legible, two answers per
 * page, pieceword clue rows and cut-out blocks, colour-only colour sudoku, and
 * the brand, book reference and copyright on every page.
 */
// Rendered only on the server (pdfkit is a Node library). The server-only guard
// lives on lib/puzzle-books/index.ts so this module stays directly testable.
import { existsSync } from "node:fs";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import { bookTrimSizes } from "./recipe.js";
const FONT_DIR = join(process.cwd(), "assets", "fonts");
const BODY_FONT = join(FONT_DIR, "DejaVuSans.ttf");
const BOLD_FONT = join(FONT_DIR, "DejaVuSans-Bold.ttf");
const bodyFontName = existsSync(BODY_FONT) ? "BookBody" : "Helvetica";
const boldFontName = existsSync(BOLD_FONT) ? "BookBody-Bold" : "Helvetica-Bold";
const brandLine = "MyPuzzles";
function registerFonts(doc) {
    if (existsSync(BODY_FONT))
        doc.registerFont("BookBody", BODY_FONT);
    if (existsSync(BOLD_FONT))
        doc.registerFont("BookBody-Bold", BOLD_FONT);
}
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const asRows = (value) => Array.isArray(value) ? value.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : [String(row ?? "")])) : [];
const asStringArray = (value) => (Array.isArray(value) ? value.map((entry) => String(entry ?? "")) : []);
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const records = (value) => (Array.isArray(value) ? value.filter(isRecord) : []);
const meta = (puzzle) => puzzle.metadata ?? {};
const gridSpan = (puzzle) => {
    const rows = puzzle.board.length;
    const columns = Math.max(1, ...puzzle.board.map((row) => row.length));
    return Math.max(rows, columns);
};
/** Families whose answer key is a picture of the solved grid. */
const gridAnswerFamilies = new Set(["crossword", "cryptic-crossword", "backwords", "kriss-kross", "pieceword", "sudoku", "colour-sudoku"]);
/**
 * How many answers fit legibly on one answer page.
 *
 * A solved grid needs real room: four per page only for 9x9-sized answers, two
 * per page up to 20 cells, and the whole page beyond that. Answers that print as
 * a text list stay dense.
 */
export function answerDensityForPuzzle(puzzle) {
    if (!gridAnswerFamilies.has(puzzle.puzzleType))
        return 6;
    const span = gridSpan(puzzle);
    if (!span)
        return 6;
    if (span > 20)
        return 1;
    if (span > 9)
        return 2;
    return 4;
}
/** A4 content box, used when a caller does not pass the real page area. */
const defaultContentArea = { width: bookTrimSizes.A4.widthPt - bookTrimSizes.A4.marginPt * 2, height: bookTrimSizes.A4.heightPt - bookTrimSizes.A4.marginPt * 2 };
/** Minimum sizes that keep a half-page puzzle readable in print. */
const minimumCellSize = 8.5;
const minimumClueFont = 7;
/**
 * Can this puzzle share a page with another one?
 *
 * Two puzzles per page is the default, because it halves the page count and the
 * print cost. It is refused only when the grid would drop below a readable cell
 * size or when the clues could not fit beside it, in which case that puzzle
 * keeps a full page instead of being printed illegibly.
 */
export function canSharePage(puzzle, area = defaultContentArea) {
    const half = (area.height - 16) / 2;
    const body = half - 34;
    if (body < 120)
        return false;
    const span = gridSpan(puzzle);
    const gridWidth = puzzle.puzzleType === "codeword" ? area.width : Math.min(area.width * 0.58, body);
    if (span && gridWidth / span < minimumCellSize)
        return false;
    const extras = puzzleExtrasFor(puzzle);
    if (extras.length) {
        // Two clue columns share the space beside the grid in a half-page cell.
        const columnWidth = Math.max(50, (area.width - gridWidth - 14) / 2 - 8);
        const charactersPerLine = Math.max(10, Math.floor(columnWidth / (minimumClueFont * 0.58)));
        const lines = extras
            .flatMap((block) => [block.heading, ...block.lines])
            .reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0);
        const linesPerColumn = Math.ceil(lines / 2);
        if (linesPerColumn * (minimumClueFont * 1.2) > body)
            return false;
    }
    if (puzzle.puzzleType === "pieceword") {
        // The cut-out sheet needs room for three rows of blocks under the grid.
        const sheetHeight = body - Math.min(gridWidth, body) - 16;
        if (sheetHeight < 60)
            return false;
    }
    return true;
}
/** Pairs consecutive puzzles whenever both stay legible on half a page. */
export function buildPages(puzzles, area = defaultContentArea) {
    const pages = [];
    for (let index = 0; index < puzzles.length; index += 1) {
        const current = puzzles[index];
        const next = puzzles[index + 1];
        if (next && canSharePage(current, area) && canSharePage(next, area)) {
            pages.push([current, next]);
            index += 1;
        }
        else {
            pages.push([current]);
        }
    }
    return pages;
}
export function drawGrid(doc, options) {
    const grid = options.grid ?? [];
    const rows = Math.max(1, grid.length);
    const columns = Math.max(1, ...grid.map((row) => row.length));
    const cellSize = Math.max(options.minCell ?? 8, Math.min(options.width / columns, options.height / rows));
    const gridWidth = cellSize * columns;
    const gridHeight = cellSize * rows;
    const baseFont = options.fontSize ?? clamp(cellSize * 0.52, 6, 18);
    doc.save();
    doc.lineWidth(0.4).strokeColor("#111111");
    for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < columns; col += 1) {
            const cell = grid[row]?.[col] ?? "";
            const x = options.x + col * cellSize;
            const y = options.y + row * cellSize;
            if (options.isBlocked?.(cell, row, col)) {
                doc.rect(x, y, cellSize, cellSize).fill("#111111");
                continue;
            }
            const fill = options.cellFill?.(cell, row, col) ?? null;
            if (fill) {
                doc.save();
                doc.rect(x, y, cellSize, cellSize).fill(fill);
                doc.restore();
            }
            doc.rect(x, y, cellSize, cellSize).stroke();
            const label = options.hideLabels ? "" : options.cellLabel ? options.cellLabel(cell, row, col) : cell;
            if (label) {
                doc.fillColor("#111111").font(boldFontName).fontSize(baseFont);
                doc.text(label, x, y, { width: cellSize, height: cellSize, align: "center", valign: "center", lineBreak: false });
                doc.font(bodyFontName);
            }
            const corner = options.cornerLabel?.(cell, row, col) ?? null;
            if (corner) {
                doc.fillColor("#333333").font(bodyFontName).fontSize(Math.max(4, baseFont * 0.42));
                doc.text(corner, x + cellSize * 0.06, y + cellSize * 0.04, { lineBreak: false });
            }
        }
    }
    if (options.heavyEvery && options.heavyEvery > 1) {
        doc.lineWidth(1.4).strokeColor("#111111");
        for (let col = 0; col <= columns; col += 1) {
            if (col % options.heavyEvery)
                continue;
            const x = options.x + col * cellSize;
            doc.moveTo(x, options.y).lineTo(x, options.y + gridHeight).stroke();
        }
        for (let row = 0; row <= rows; row += 1) {
            if (row % options.heavyEvery)
                continue;
            const y = options.y + row * cellSize;
            doc.moveTo(options.x, y).lineTo(options.x + gridWidth, y).stroke();
        }
    }
    doc.rect(options.x, options.y, gridWidth, gridHeight).lineWidth(1.2).stroke();
    doc.restore();
    return { cellSize, width: gridWidth, height: gridHeight };
}
/** Split labels into balanced columns. */
export function balanceColumns(items, columnCount) {
    if (columnCount <= 1)
        return [items];
    const perColumn = Math.ceil(items.length / columnCount);
    const columns = [];
    for (let index = 0; index < items.length; index += perColumn)
        columns.push(items.slice(index, index + perColumn));
    return columns;
}
// --- family views -----------------------------------------------------------------
function clueBlocks(puzzle) {
    const data = meta(puzzle);
    const blocks = [];
    for (const [key, heading] of [["across", "Across"], ["down", "Down"]]) {
        const entries = records(data[key]);
        if (!entries.length)
            continue;
        blocks.push({
            heading,
            lines: entries.map((entry) => {
                const number = entry.number ?? entry.id ?? "";
                const clue = String(entry.clue ?? entry.clueText ?? entry.text ?? "").trim();
                const length = entry.length ?? 0;
                return `${number}. ${clue}${length ? ` (${length})` : ""}`;
            })
        });
    }
    return blocks;
}
function crosswordAnswerGrid(puzzle) {
    const grid = puzzle.board.map((row) => row.map((cell) => (cell === "#" ? "#" : "")));
    for (const entry of puzzle.solution ?? []) {
        const match = /^cell:(\d+):(\d+):(.*)$/.exec(entry);
        if (!match)
            continue;
        const [, row, col, letter] = match;
        const r = Number(row);
        const c = Number(col);
        if (grid[r]?.[c] !== undefined && grid[r][c] !== "#")
            grid[r][c] = letter;
    }
    return grid;
}
function backwordsAnswerGrid(puzzle) {
    const rows = puzzle.board.length;
    const columns = puzzle.board[0]?.length ?? 0;
    const raw = puzzle.solution?.[0] ?? "";
    const mask = raw.includes("|") ? raw.slice(raw.indexOf("|") + 1) : raw;
    if (mask.length < rows * columns)
        return puzzle.board;
    return puzzle.board.map((row, r) => row.map((cell, c) => (mask[r * columns + c] === "1" ? cell : "#")));
}
function krissKrossGrid(puzzle, filled) {
    const data = meta(puzzle);
    const rows = Number(data.rows ?? 0);
    const columns = Number(data.columns ?? 0);
    const entries = records(data.entries);
    if (!rows || !columns || !entries.length)
        return null;
    const grid = Array.from({ length: rows }, () => Array.from({ length: columns }, () => (filled ? "" : "#")));
    entries.forEach((entry, index) => {
        const length = Number(entry.length ?? 0);
        const vertical = String(entry.direction ?? "across").toLowerCase().startsWith("d");
        const row = Number(entry.row ?? 0);
        const col = Number(entry.col ?? 0);
        const word = filled ? puzzle.solution?.[index] ?? "" : "";
        for (let offset = 0; offset < length; offset += 1) {
            const r = vertical ? row + offset : row;
            const c = vertical ? col : col + offset;
            if (grid[r]?.[c] === undefined)
                continue;
            grid[r][c] = word[offset] ?? "";
        }
    });
    return grid;
}
function colourLookup(puzzle) {
    const byValue = new Map();
    const byName = new Map();
    const legend = [];
    for (const color of records(meta(puzzle).colors)) {
        const value = String(color.value ?? "");
        const name = String(color.name ?? "");
        const hex = String(color.hex ?? "#cccccc");
        if (value)
            byValue.set(value, hex);
        if (name)
            byName.set(name.toUpperCase(), hex);
        legend.push({ value, name, hex });
    }
    return { byValue, byName, legend };
}
function sudokuAnswerRows(puzzle) {
    const raw = puzzle.solution?.[0] ?? "";
    if (!raw.includes(","))
        return null;
    // A colour sudoku answer stores colour names joined by "-", a number sudoku
    // stores one character per cell.
    const colourful = puzzle.puzzleType === "colour-sudoku";
    return raw.split(",").map((row) => (colourful ? row.split("-") : row.split("")));
}
/**
 * Assembles the solved pieceword grid from the stored piece order.
 * solution[0] is `pw2|piece-a,piece-b,...` in board order, and each piece is a
 * 3x3 block, so the answer can be shown as the finished crossword instead of a
 * repeated clue list.
 */
function piecewordAnswerGrid(puzzle) {
    const data = meta(puzzle);
    const blockRows = Number(data.blockRows ?? 0);
    const blockColumns = Number(data.blockColumns ?? 0);
    const blockSize = Number(data.blockSize ?? 3);
    const pieces = records(data.pieces);
    const raw = puzzle.solution?.[0] ?? "";
    if (!blockRows || !blockColumns || !pieces.length || !raw)
        return null;
    const order = (raw.includes("|") ? raw.slice(raw.indexOf("|") + 1) : raw).split(",").map((id) => id.trim()).filter(Boolean);
    if (order.length !== blockRows * blockColumns)
        return null;
    const grid = Array.from({ length: blockRows * blockSize }, () => Array.from({ length: blockColumns * blockSize }, () => "#"));
    const byId = new Map(pieces.map((piece) => [String(piece.id ?? ""), piece]));
    order.forEach((pieceId, index) => {
        const piece = byId.get(pieceId);
        if (!piece)
            return;
        const cells = asRows(piece.cells);
        const originRow = Math.floor(index / blockColumns) * blockSize;
        const originCol = (index % blockColumns) * blockSize;
        for (let r = 0; r < cells.length; r += 1) {
            for (let c = 0; c < (cells[r]?.length ?? 0); c += 1) {
                const value = String(cells[r][c] ?? "#");
                if (grid[originRow + r]?.[originCol + c] === undefined)
                    continue;
                grid[originRow + r][originCol + c] = value === "" ? "#" : value;
            }
        }
    });
    return grid;
}
/** Pieceword clues grouped by the row they belong to. */
function piecewordClueBlocks(puzzle) {
    const rows = records(meta(puzzle).acrossRows);
    if (rows.length) {
        return [
            {
                heading: "Across clues by row",
                lines: rows
                    .slice()
                    .sort((a, b) => Number(a.row ?? 0) - Number(b.row ?? 0))
                    .map((entry) => {
                    const clues = records(entry.clues)
                        .map((clue) => `${clue.number ?? ""}. ${String(clue.clue ?? "").trim()}${clue.length ? ` (${clue.length})` : ""}`)
                        .join("   ");
                    return `Row ${entry.row ?? "?"}: ${clues}`;
                })
            }
        ];
    }
    const instructions = puzzle.instructions ?? [];
    return instructions.length ? [{ heading: "How to solve", lines: instructions }] : [];
}
/**
 * Codeword grid: every square holds one code number and is sized from the widest
 * row, so a code can never run outside its box or off the page.
 */
function drawCodewordPuzzle(doc, puzzle, x, y, width, height) {
    const rows = asRows(puzzle.board).map((row) => row.map((cell) => String(cell).split("-").filter(Boolean)));
    if (!rows.length)
        return y;
    const wordGap = 9;
    const squaresPerRow = Math.max(...rows.map((words) => words.reduce((total, word) => total + word.length, 0)));
    const wordsPerRow = Math.max(...rows.map((words) => words.length));
    const cellSize = Math.max(9, Math.min(16, (width - wordGap * wordsPerRow) / Math.max(1, squaresPerRow)));
    const numberFont = Math.max(5, Math.min(7.5, cellSize * 0.52));
    const rowHeight = Math.min(cellSize + 9, height / rows.length);
    let cursorY = y;
    rows.forEach((words) => {
        let cursorX = x;
        words.forEach((word) => {
            word.forEach((number) => {
                doc.lineWidth(0.4).strokeColor("#111111");
                doc.rect(cursorX, cursorY, cellSize, cellSize).stroke();
                doc.font(boldFontName).fontSize(numberFont).fillColor("#111111");
                doc.text(number, cursorX, cursorY, { width: cellSize, height: cellSize, align: "center", valign: "center", lineBreak: false });
                cursorX += cellSize;
            });
            cursorX += wordGap;
        });
        cursorY += rowHeight;
    });
    doc.font(bodyFontName).fontSize(7.5).fillColor("#666666");
    doc.text("Every square holds one code number: write the letter it decodes to in the same square.", x, cursorY + 3, { width, lineBreak: false });
    return cursorY + 16;
}
/** The shuffled 3x3 blocks a pieceword solver cuts out and places. */
function drawPiecewordPieces(doc, puzzle, x, y, width, height) {
    const pieces = records(meta(puzzle).pieces);
    if (!pieces.length || height < 40)
        return y;
    const gap = 10;
    // Choose the block count per row that fits both the width and the height, so
    // the cut-out sheet can never run off the page.
    const caption = 9;
    let perRow = 6;
    let rowsCount = Math.ceil(pieces.length / perRow);
    let pieceSize = Math.min((width - gap * (perRow - 1)) / perRow, (height - 16 - gap * (rowsCount - 1)) / rowsCount - caption);
    for (const candidate of [5, 4, 3]) {
        if (pieceSize >= 26)
            break;
        const rows = Math.ceil(pieces.length / candidate);
        const size = Math.min((width - gap * (candidate - 1)) / candidate, (height - 16 - gap * (rows - 1)) / rows - caption);
        if (size > pieceSize) {
            perRow = candidate;
            rowsCount = rows;
            pieceSize = size;
        }
    }
    if (pieceSize < 14)
        return y;
    const cell = pieceSize / 3;
    let cursorY = y;
    doc.font(boldFontName).fontSize(9).fillColor("#111111").text("Cut out these 3x3 blocks and place them in the empty grid", x, cursorY, { width, lineBreak: false });
    cursorY += 14;
    pieces.forEach((piece, index) => {
        const rowIndex = Math.floor(index / perRow);
        const colIndex = index % perRow;
        const originX = x + colIndex * (pieceSize + gap);
        const originY = cursorY + rowIndex * (pieceSize + gap);
        const cells = asRows(piece.cells);
        for (let r = 0; r < 3; r += 1) {
            for (let c = 0; c < 3; c += 1) {
                const value = String(cells[r]?.[c] ?? "");
                const cx = originX + c * cell;
                const cy = originY + r * cell;
                if (!value || value === "#") {
                    doc.rect(cx, cy, cell, cell).fill("#111111");
                    continue;
                }
                doc.rect(cx, cy, cell, cell).lineWidth(0.4).stroke("#111111");
                const size = Math.max(5, Math.min(cell * 0.55, 12));
                doc.font(boldFontName).fontSize(size).fillColor("#111111");
                doc.text(value, cx, cy, { width: cell, height: cell, align: "center", valign: "center", lineBreak: false });
            }
        }
        if (originY + pieceSize + caption <= y + height) {
            doc.font(bodyFontName).fontSize(6).fillColor("#555555").text(`Block ${index + 1}`, originX, originY + pieceSize + 1, { width: pieceSize, align: "center", lineBreak: false });
        }
    });
    return cursorY + rowsCount * (pieceSize + gap) + 6;
}
/** A legend of real colour swatches, used instead of numbers. */
function drawColourLegend(doc, puzzle, x, y, width) {
    const { legend } = colourLookup(puzzle);
    if (!legend.length)
        return y;
    const columns = 3;
    const rows = Math.ceil(legend.length / columns);
    const rowHeight = 13;
    const columnWidth = width / columns;
    const swatch = 9;
    legend.forEach((color, index) => {
        const column = Math.floor(index / rows);
        const row = index % rows;
        const cx = x + column * columnWidth;
        const cy = y + row * rowHeight;
        doc.rect(cx, cy, swatch, swatch).fill(color.hex);
        doc.rect(cx, cy, swatch, swatch).lineWidth(0.4).stroke("#333333");
        doc.font(bodyFontName).fontSize(7.5).fillColor("#333333");
        doc.text(color.name, cx + swatch + 4, cy + 1, { width: columnWidth - swatch - 6, lineBreak: false });
    });
    return y + rows * rowHeight + 4;
}
export function gridSpecFor(puzzle) {
    const board = asRows(puzzle.board);
    const numbers = new Map();
    for (const entry of records(meta(puzzle).entries)) {
        const row = Number(entry.row ?? -1);
        const col = Number(entry.col ?? -1);
        if (row < 0 || col < 0 || entry.number === undefined || entry.number === null)
            continue;
        if (!numbers.has(`${row}:${col}`))
            numbers.set(`${row}:${col}`, String(entry.number));
    }
    switch (puzzle.puzzleType) {
        case "crossword":
        case "cryptic-crossword":
            return {
                grid: board,
                options: {
                    isBlocked: (cell) => cell === "#",
                    cornerLabel: (cell, row, col) => (cell === "#" ? null : numbers.get(`${row}:${col}`) ?? null)
                },
                clueColumns: 3
            };
        case "backwords":
            return { grid: board, options: {}, clueColumns: 3 };
        case "kriss-kross":
            return { grid: krissKrossGrid(puzzle, false) ?? board, options: { isBlocked: (cell) => cell === "#" }, clueColumns: 2 };
        case "sudoku":
            return { grid: board.map((row) => row.map((cell) => (cell === "." ? "" : cell))), options: { heavyEvery: 3 }, clueColumns: 2 };
        case "colour-sudoku": {
            const { byValue } = colourLookup(puzzle);
            return {
                grid: board.map((row) => row.map((cell) => (cell === "." ? "" : cell))),
                options: { heavyEvery: 3, hideLabels: true, cellFill: (cell) => (cell ? byValue.get(cell) ?? null : null) },
                clueColumns: 2
            };
        }
        case "wordsearch":
            return { grid: board, options: { fontSize: 9 }, clueColumns: 3 };
        case "pathfinder":
            return { grid: board, options: { fontSize: 9 }, clueColumns: 2 };
        case "pieceword":
            return { grid: board, options: { isBlocked: (cell) => cell === "#" }, clueColumns: 2 };
        default:
            return { grid: board, options: {}, clueColumns: 2 };
    }
}
export function puzzleExtrasFor(puzzle) {
    const data = meta(puzzle);
    switch (puzzle.puzzleType) {
        case "crossword":
        case "cryptic-crossword":
        case "backwords":
            return clueBlocks(puzzle);
        case "wordsearch": {
            const words = records(data.targets).map((target) => String(target.word ?? "")).filter(Boolean);
            return words.length ? [{ heading: "Hidden words", lines: words.map((word) => `${word} (${word.length})`) }] : [];
        }
        case "kriss-kross": {
            const bank = asStringArray(data.wordBank);
            if (!bank.length)
                return [];
            const grouped = new Map();
            for (const word of bank)
                grouped.set(word.length, [...(grouped.get(word.length) ?? []), word]);
            return [{ heading: "Word bank", lines: [...grouped.entries()].sort((a, b) => a[0] - b[0]).map(([length, words]) => `${length} letters: ${words.join(", ")}`) }];
        }
        case "pieceword":
            return piecewordClueBlocks(puzzle);
        case "pathfinder": {
            const targets = records(data.targets);
            if (!targets.length)
                return [];
            return [{ heading: `Hidden paths (${targets.length})`, lines: targets.map((target, index) => `Path ${index + 1} - ${String(target.length ?? 0)} cells`) }];
        }
        case "codeword": {
            const numbers = asStringArray(data.numbers);
            const revealed = records(data.revealed);
            const blocks = [];
            if (numbers.length)
                blocks.push({ heading: "Code numbers", lines: [numbers.join(" - ")] });
            if (revealed.length)
                blocks.push({ heading: "Given letters", lines: [revealed.map((entry) => `${entry.number} = ${entry.letter}`).join("   ")] });
            return blocks;
        }
        case "colour-sudoku":
            // The colour key is drawn as real swatches next to the grid.
            return [];
        default:
            return [];
    }
}
function answerView(puzzle) {
    const data = meta(puzzle);
    switch (puzzle.puzzleType) {
        case "crossword":
        case "cryptic-crossword":
            return { grid: crosswordAnswerGrid(puzzle), options: { isBlocked: (cell) => cell === "#", fontSize: 8 }, lines: [] };
        case "backwords":
            return { grid: backwordsAnswerGrid(puzzle), options: { isBlocked: (cell) => cell === "#", fontSize: 8 }, lines: [] };
        case "kriss-kross": {
            const grid = krissKrossGrid(puzzle, true);
            return { grid, options: { isBlocked: (cell) => cell === "#", fontSize: 8 }, lines: grid ? [] : (puzzle.solution ?? []).map((word, index) => `${index + 1}. ${word}`) };
        }
        case "pieceword": {
            const grid = piecewordAnswerGrid(puzzle);
            return grid
                ? { grid, options: { isBlocked: (cell) => cell === "#", fontSize: 8 }, lines: [] }
                : { grid: null, options: {}, lines: piecewordClueBlocks(puzzle).flatMap((block) => [block.heading, ...block.lines]) };
        }
        case "sudoku":
            return { grid: sudokuAnswerRows(puzzle), options: { heavyEvery: 3, fontSize: 9 }, lines: [] };
        case "colour-sudoku": {
            const { byName } = colourLookup(puzzle);
            return {
                grid: sudokuAnswerRows(puzzle),
                options: { heavyEvery: 3, hideLabels: true, cellFill: (cell) => (cell ? byName.get(String(cell).toUpperCase()) ?? null : null) },
                lines: []
            };
        }
        case "wordsearch": {
            const words = records(data.targets).map((target) => String(target.word ?? ""));
            const coordinates = (puzzle.solution ?? []).map((entry) => {
                const parts = entry.split("|");
                return parts.length >= 4 ? parts[3].replace(/;/g, " - ") : "";
            });
            return { grid: null, options: {}, lines: words.map((word, index) => `${word}${coordinates[index] ? `  (${coordinates[index]})` : ""}`) };
        }
        case "pathfinder":
            return {
                grid: null,
                options: {},
                lines: (puzzle.solution ?? []).map((entry, index) => {
                    const word = entry.split(":")[2] ?? "";
                    const cells = entry.split(":").slice(3).join(":");
                    return `Path ${index + 1}: ${word} (${cells ? cells.split("|").length : 0} cells)`;
                })
            };
        case "codeword":
            return { grid: null, options: {}, lines: (puzzle.solution ?? []).map((word, index) => `${index + 1}. ${word}`) };
        default:
            return { grid: null, options: {}, lines: puzzle.solution ?? [] };
    }
}
// --- answer packing ----------------------------------------------------------------
/**
 * Estimated height an answer block needs on the page.
 *
 * Answers are packed by this measurement rather than by a fixed count, because a
 * block that overflows its slot makes pdfkit paginate on its own, which both
 * overlaps the text and shifts every following page reference.
 */
export function estimateAnswerHeight(puzzle, area) {
    const title = 13;
    const view = answerView(puzzle);
    let height = title;
    if (view.grid)
        height += Math.min(area.width * 0.46, area.height * 0.4, 300) + 5;
    if (view.lines.length) {
        const columns = view.lines.length > 14 ? 3 : view.lines.length > 6 ? 2 : 1;
        const columnWidth = area.width / columns - 8;
        const charactersPerLine = Math.max(12, Math.floor(columnWidth / 4.6));
        const lines = view.lines.reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0);
        const linesPerColumn = Math.ceil(lines / columns);
        height += linesPerColumn * 9.6 + 4;
    }
    return height + 6;
}
/**
 * Packs answers two to a page, which is the owner's chosen density. The packing
 * still measures every block, so a page is never overfilled and a block can
 * never overlap the next one.
 */
export function buildAnswerGroups(puzzles, area, options = {}) {
    const maxPerPage = Math.max(1, options.maxPerPage ?? 2);
    const budget = area.height - 22;
    const perBlock = budget / maxPerPage;
    const groups = [];
    let group = [];
    let used = 0;
    for (const puzzle of puzzles) {
        const needed = Math.min(Math.max(estimateAnswerHeight(puzzle, area), perBlock * 0.6), perBlock);
        if (group.length >= maxPerPage || (group.length && used + needed > budget)) {
            groups.push(group);
            group = [];
            used = 0;
        }
        group.push(puzzle);
        used += needed;
    }
    if (group.length)
        groups.push(group);
    return groups;
}
// --- page drawing ------------------------------------------------------------------
function drawExtras(doc, blocks, x, y, width, height, maxColumns, compact = false) {
    if (!blocks.length || height < 16)
        return;
    const flat = [];
    for (const block of blocks)
        [block.heading, ...block.lines].forEach((text, index) => flat.push({ heading: index === 0, text }));
    const bodySize = compact ? 7 : 8;
    doc.font(bodyFontName).fontSize(bodySize);
    const estimate = flat.reduce((total, item) => total + doc.heightOfString(item.text, { width: width / 2 }) + 2, 0);
    const columns = clamp(Math.ceil(estimate / Math.max(1, height)), 1, Math.max(1, Math.min(maxColumns, 3)));
    const columnWidth = width / columns - 8;
    balanceColumns(flat, columns).forEach((bucket, columnIndex) => {
        let cursorY = y;
        const columnX = x + columnIndex * (columnWidth + 8);
        for (const item of bucket) {
            const font = item.heading ? boldFontName : bodyFontName;
            const size = item.heading ? bodySize + 1 : bodySize;
            doc.font(font).fontSize(size);
            const textHeight = doc.heightOfString(item.text, { width: columnWidth });
            if (cursorY + textHeight > y + height)
                return;
            doc.fillColor(item.heading ? "#111111" : "#222222");
            doc.text(item.text, columnX, cursorY, { width: columnWidth, lineBreak: true });
            cursorY += textHeight + (item.heading ? 3 : 1.5);
        }
    });
}
function puzzleHeader(doc, puzzle, x, y, width, large) {
    doc.font(boldFontName).fontSize(large ? 12 : 10.5).fillColor("#111111");
    doc.text(`${puzzle.title} - ${puzzle.difficultyLabel}`, x, y, { width: width * 0.66, lineBreak: false });
    doc.font(bodyFontName).fontSize(large ? 10 : 9).fillColor("#444444");
    doc.text(`Puzzle ${puzzle.puzzleNumber}`, x, y + 1, { width, align: "right", lineBreak: false });
    let cursorY = y + (large ? 18 : 15);
    if (puzzle.prompt) {
        doc.font(bodyFontName).fontSize(8).fillColor("#555555");
        doc.text(puzzle.prompt, x, cursorY, { width, lineBreak: true });
        cursorY = doc.y + 3;
    }
    return cursorY;
}
function drawPuzzleCell(doc, puzzle, area, large) {
    const startY = puzzleHeader(doc, puzzle, area.x, area.y, area.width, large);
    const spec = gridSpecFor(puzzle);
    const bodyHeight = area.y + area.height - startY;
    const extras = puzzleExtrasFor(puzzle);
    if (puzzle.puzzleType === "codeword") {
        const gridHeight = Math.min(bodyHeight * 0.62, 230);
        const endY = drawCodewordPuzzle(doc, puzzle, area.x, startY, area.width, gridHeight);
        drawExtras(doc, extras, area.x, endY + 8, area.width, Math.max(area.y + area.height - endY - 8, 0), spec.clueColumns, !large);
        return;
    }
    if (puzzle.puzzleType === "codeword") {
        const gridHeight = Math.min(bodyHeight * 0.62, 230);
        const endY = drawCodewordPuzzle(doc, puzzle, area.x, startY, area.width, gridHeight);
        drawExtras(doc, extras, area.x, endY + 8, area.width, Math.max(area.y + area.height - endY - 8, 0), spec.clueColumns, !large);
        return;
    }
    if (puzzle.puzzleType === "pieceword") {
        // Reserve the block sheet's room first, then give the clues only the space
        // above it. Without this the clue column runs down over the cut-out blocks.
        const pieces = records(meta(puzzle).pieces);
        const perRow = pieces.length > 12 ? 6 : 4;
        const sheetRows = Math.ceil(Math.max(1, pieces.length) / perRow);
        const wantedSheet = 16 + sheetRows * 50;
        const sheetHeight = Math.min(bodyHeight * 0.5, wantedSheet);
        const topHeight = Math.max(bodyHeight * 0.34, bodyHeight - sheetHeight - 12);
        const gridSize = Math.min(topHeight, area.width * 0.45);
        const drawn = drawGrid(doc, { grid: spec.grid, x: area.x, y: startY, width: gridSize, height: gridSize, ...spec.options });
        drawExtras(doc, extras, area.x + drawn.width + 14, startY, Math.max(area.width - drawn.width - 14, 90), topHeight, 3, true);
        const piecesY = startY + topHeight + 10;
        const remaining = area.y + area.height - piecesY - 2;
        if (remaining > 40)
            drawPiecewordPieces(doc, puzzle, area.x, piecesY, area.width, remaining);
        return;
    }
    const sideBySide = area.width > 320;
    const gridWidth = sideBySide ? area.width * 0.58 : area.width;
    const gridHeight = Math.max(56, Math.min(sideBySide ? bodyHeight : bodyHeight - 84, gridWidth));
    const drawn = drawGrid(doc, { grid: spec.grid, x: area.x, y: startY, width: gridWidth, height: gridHeight, ...spec.options });
    if (sideBySide) {
        drawExtras(doc, extras, area.x + drawn.width + 14, startY, Math.max(area.width - drawn.width - 14, 90), bodyHeight, large ? 1 : 2, !large);
    }
    else {
        const extrasY = startY + drawn.height + 8;
        drawExtras(doc, extras, area.x, extrasY, area.width, Math.max(area.y + area.height - extrasY, 0), spec.clueColumns);
    }
    if (puzzle.puzzleType === "colour-sudoku") {
        const legendY = Math.min(startY + drawn.height + 6, area.y + area.height - 30);
        drawColourLegend(doc, puzzle, area.x, legendY, area.width);
    }
}
/** Answers are measured, so blocks can never overlap and none is dropped. */
function drawAnswerPage(doc, puzzles, area, heading, pageLabel) {
    // pdfkit inserts a page whenever text is drawn past the bottom margin. Answer
    // content is already packed to fit, and this removes any chance of a stray
    // pagination shifting the page references.
    const restoreMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font(boldFontName).fontSize(13).fillColor("#111111").text(heading, area.x, area.y, { width: area.width * 0.55, lineBreak: false });
    doc.font(bodyFontName).fontSize(7.5).fillColor("#555555").text(pageLabel, area.x, area.y + 3, { width: area.width, align: "right", lineBreak: false });
    const headerSpace = 22;
    const perPuzzle = (area.height - headerSpace) / Math.max(1, puzzles.length);
    let cursorY = area.y + headerSpace;
    for (const puzzle of puzzles) {
        const view = answerView(puzzle);
        const blockTop = cursorY;
        doc.font(boldFontName).fontSize(9.5).fillColor("#111111");
        doc.text(`Puzzle ${puzzle.puzzleNumber} - ${puzzle.title} - ${puzzle.difficultyLabel}`, area.x, cursorY, { width: area.width, lineBreak: false });
        let innerY = cursorY + 13;
        const gridMaxWidth = view.lines.length ? area.width * 0.46 : area.width;
        const gridBudget = Math.max(36, Math.min(perPuzzle - 26, area.height * (puzzles.length === 1 ? 0.86 : 0.4), gridMaxWidth));
        if (view.grid) {
            const drawn = drawGrid(doc, { grid: view.grid, x: area.x, y: innerY, width: Math.min(area.width, gridBudget), height: gridBudget, ...view.options });
            innerY += drawn.height + 5;
        }
        if (view.lines.length) {
            doc.font(bodyFontName).fontSize(8);
            const columns = view.lines.length > 14 ? 3 : view.lines.length > 6 ? 2 : 1;
            const columnWidth = area.width / columns - 8;
            const buckets = balanceColumns(view.lines, columns);
            let tallest = 0;
            buckets.forEach((bucket, index) => {
                const text = bucket.join("\n");
                const height = doc.heightOfString(text, { width: columnWidth });
                tallest = Math.max(tallest, height);
                doc.fillColor("#222222");
                doc.text(text, area.x + index * (columnWidth + 8), innerY, { width: columnWidth, lineBreak: true });
            });
            innerY += tallest + 4;
        }
        cursorY = Math.max(innerY + 6, blockTop + perPuzzle);
    }
    doc.page.margins.bottom = restoreMargin;
}
async function renderInterior(input, pass) {
    const trim = bookTrimSizes[input.trimSize] ?? bookTrimSizes.A4;
    const margin = trim.marginPt;
    const doc = new PDFDocument({
        size: [trim.widthPt, trim.heightPt],
        margin,
        autoFirstPage: false,
        bufferPages: true,
        compress: true,
        info: {
            Title: input.title,
            Author: input.copyrightHolder ?? brandLine,
            Subject: input.subtitle ?? "Printable puzzle book",
            Creator: `${brandLine} book engine (${pass})`,
            Producer: `${brandLine} book engine`,
            Keywords: input.bookReference ? `${brandLine}, ${input.bookReference}` : brandLine,
            CreationDate: input.generatedAt,
            ModDate: input.generatedAt
        }
    });
    registerFonts(doc);
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    const finished = new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
    const area = { x: margin, y: margin, width: trim.widthPt - margin * 2, height: trim.heightPt - margin * 2 };
    const reference = input.bookReference ?? `${brandLine.toUpperCase()}-BOOK`;
    const copyright = input.copyrightHolder ?? "SETTIS LLC";
    const year = input.generatedAt.getUTCFullYear();
    const puzzles = input.puzzles.map((puzzle, index) => ({ ...puzzle, puzzleNumber: puzzle.puzzleNumber ?? index + 1 }));
    doc.addPage();
    doc.font(boldFontName).fontSize(27).fillColor("#111111").text(input.title, area.x, area.y + 100, { width: area.width, align: "center" });
    if (input.subtitle)
        doc.font(bodyFontName).fontSize(12.5).fillColor("#444444").text(input.subtitle, area.x, doc.y + 10, { width: area.width, align: "center" });
    doc.font(bodyFontName).fontSize(10.5).fillColor("#555555").text(`${puzzles.length} puzzles - answers in the second half`, area.x, doc.y + 18, { width: area.width, align: "center" });
    doc.font(boldFontName).fontSize(12).fillColor("#1f3d33").text(brandLine, area.x, area.y + area.height - 156, { width: area.width, align: "center" });
    doc.font(bodyFontName).fontSize(8.5).fillColor("#666666").text([
        `Book reference: ${reference}`,
        `Edition: version ${input.volumeVersion} - printed edition`,
        `(c) ${year} ${copyright}. All rights reserved.`,
        "No part of this book may be reproduced, redistributed or resold in any form without written permission.",
        input.shopUrl ? `Published by ${brandLine} - ${input.shopUrl}` : `Published by ${brandLine}`
    ].join("\n"), area.x, area.y + area.height - 126, { width: area.width, align: "center", height: 118, lineBreak: true });
    doc.addPage();
    doc.font(boldFontName).fontSize(15).fillColor("#111111").text("How to use this book", area.x, area.y);
    doc.font(bodyFontName).fontSize(10).fillColor("#222222").text([
        "Every puzzle is printed with the clues or the list it needs. Work at your own pace and use a pencil if you may want a second attempt.",
        "",
        "Answers for every puzzle are collected in the second half of the book, in the same order as the puzzles, and each answer keeps its puzzle number.",
        "",
        "Difficulty rises through the book, and every puzzle page shows its difficulty next to the puzzle number.",
        "",
        `Book reference ${reference}. Quote it if you contact support about this edition.`
    ].join("\n"), area.x, area.y + 24, { width: area.width, height: area.height - 24, ellipsis: false, lineBreak: true });
    doc.addPage();
    doc.font(boldFontName).fontSize(15).fillColor("#111111").text("Contents", area.x, area.y);
    const byDifficulty = new Map();
    for (const puzzle of puzzles)
        byDifficulty.set(puzzle.difficultyLabel, (byDifficulty.get(puzzle.difficultyLabel) ?? 0) + 1);
    doc.font(bodyFontName).fontSize(10).fillColor("#222222").text([...byDifficulty.entries()].map(([label, count]) => `${label}: ${count} puzzles`).join("\n"), area.x, area.y + 24, { width: area.width, height: area.height - 60, ellipsis: false });
    const pages = buildPages(puzzles);
    const pageMap = [];
    const firstPuzzlePage = 3;
    pages.forEach((pagePuzzles, pageIndex) => {
        doc.addPage();
        const pagesBefore = doc.bufferedPageRange().count;
        if (pagePuzzles.length === 1) {
            drawPuzzleCell(doc, pagePuzzles[0], area, true);
        }
        else {
            const gap = 16;
            const half = (area.height - gap) / 2;
            drawPuzzleCell(doc, pagePuzzles[0], { x: area.x, y: area.y, width: area.width, height: half }, false);
            doc.moveTo(area.x, area.y + half + gap / 2).lineTo(area.x + area.width, area.y + half + gap / 2).lineWidth(0.4).strokeColor("#cccccc").stroke();
            drawPuzzleCell(doc, pagePuzzles[1], { x: area.x, y: area.y + half + gap, width: area.width, height: half }, false);
        }
        const pagesAfter = doc.bufferedPageRange().count;
        if (pagesAfter !== pagesBefore) {
            throw new Error(`Puzzle ${pagePuzzles.map((puzzle) => `${puzzle.puzzleNumber} (${puzzle.puzzleType})`).join(" + ")} overflowed its page by ${pagesAfter - pagesBefore}; the layout must fit without pdfkit paginating.`);
        }
        for (const puzzle of pagePuzzles)
            pageMap.push({ puzzleNumber: puzzle.puzzleNumber, pageIndex: firstPuzzlePage + pageIndex, answerPageIndex: null });
    });
    // A puzzle page that overflows makes pdfkit insert a page of its own, which
    // shifts every following reference. Fail loudly instead of shipping that.
    const pagesAfterPuzzles = doc.bufferedPageRange().count;
    const expectedAfterPuzzles = firstPuzzlePage + pages.length;
    if (pagesAfterPuzzles !== expectedAfterPuzzles) {
        throw new Error(`Puzzle pages overflowed by ${pagesAfterPuzzles - expectedAfterPuzzles} page(s); the puzzle layout must fit its pages.`);
    }
    const answerStartIndex = firstPuzzlePage + pages.length + 1;
    if (input.answersInBack && puzzles.length) {
        doc.addPage();
        doc.font(boldFontName).fontSize(24).fillColor("#111111").text("Answers", area.x, area.y + 200, { width: area.width, align: "center" });
        doc.font(bodyFontName).fontSize(10.5).fillColor("#555555").text("The answer for each puzzle keeps its puzzle number.", area.x, doc.y + 14, { width: area.width, align: "center" });
        doc.font(bodyFontName).fontSize(8).fillColor("#777777").text(reference, area.x, area.y + area.height - 30, { width: area.width, align: "center", lineBreak: false });
        const groups = buildAnswerGroups(puzzles, area);
        let placed = 0;
        groups.forEach((answerGroup, offset) => {
            doc.addPage();
            drawAnswerPage(doc, answerGroup, area, "Answers", `Page ${offset + 1} of ${groups.length} - ${reference}`);
            answerGroup.forEach((_, index) => {
                pageMap[placed + index].answerPageIndex = answerStartIndex + offset;
            });
            placed += answerGroup.length;
        });
        const pagesAfterAnswers = doc.bufferedPageRange().count;
        const expectedAfterAnswers = answerStartIndex + groups.length;
        if (pagesAfterAnswers !== expectedAfterAnswers) {
            throw new Error(`Answer pages overflowed by ${pagesAfterAnswers - expectedAfterAnswers} page(s); the answer layout must fit its pages.`);
        }
        if (placed !== puzzles.length)
            throw new Error(`Answer layout dropped ${puzzles.length - placed} answers; refusing to write an incomplete book.`);
    }
    doc.addPage();
    doc.font(boldFontName).fontSize(15).fillColor("#111111").text("More from MyPuzzles", area.x, area.y);
    doc.font(bodyFontName).fontSize(10).fillColor("#222222").text([
        "MyPuzzles builds calm, printable puzzle books across crossword, sudoku, wordsearch, kriss kross, codeword, pieceword, backwards, pathfinder and colour sudoku.",
        "",
        input.shopUrl ? `Find the rest of the series at ${input.shopUrl}` : "Find the rest of the series in the MyPuzzles shop.",
        "",
        `Book reference ${reference} - version ${input.volumeVersion}`,
        `(c) ${year} ${copyright}. All rights reserved.`,
        "Printed to order. Please enjoy this copy personally rather than redistributing it."
    ].join("\n"), area.x, area.y + 24, { width: area.width, height: area.height - 24, ellipsis: false, lineBreak: true });
    let range = doc.bufferedPageRange();
    if (range.count % 2 !== 0) {
        doc.addPage();
        doc.font(bodyFontName).fontSize(9).fillColor("#999999").text("Notes", area.x, area.y, { width: area.width });
        range = doc.bufferedPageRange();
    }
    for (let page = range.start; page < range.start + range.count; page += 1) {
        doc.switchToPage(page);
        const label = page === range.start ? `${brandLine} - ${reference}` : `${brandLine} - ${reference} - page ${page + 1}`;
        const bottomMargin = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        doc.font(bodyFontName).fontSize(7.5).fillColor("#777777");
        doc.text(label, area.x, trim.heightPt - 20, { width: area.width, align: "center", lineBreak: false });
        doc.page.margins.bottom = bottomMargin;
    }
    doc.flushPages();
    doc.end();
    return { buffer: await finished, pageMap, pageCount: range.count };
}
async function renderCover(input, pageCount) {
    const trim = bookTrimSizes[input.trimSize] ?? bookTrimSizes.A4;
    const bleed = 9;
    const spineWidth = Math.max(36, pageCount * 0.162144);
    const width = trim.widthPt * 2 + spineWidth + bleed * 2;
    const height = trim.heightPt + bleed * 2;
    const doc = new PDFDocument({
        size: [width, height],
        margin: 0,
        autoFirstPage: false,
        compress: true,
        info: { Title: `${input.title} - cover`, Author: input.copyrightHolder ?? brandLine, Producer: `${brandLine} book engine`, CreationDate: input.generatedAt, ModDate: input.generatedAt }
    });
    registerFonts(doc);
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    const finished = new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
    const reference = input.bookReference ?? `${brandLine.toUpperCase()}-BOOK`;
    const year = input.generatedAt.getUTCFullYear();
    doc.addPage();
    const frontX = bleed + trim.widthPt + spineWidth;
    const frontW = trim.widthPt;
    doc.rect(0, 0, width, height).fill("#f7f6f2");
    doc.rect(frontX, bleed, frontW, trim.heightPt).fill("#1f3d33");
    doc.rect(bleed, bleed, trim.widthPt, trim.heightPt).fill("#ffffff");
    doc.rect(bleed + trim.widthPt, bleed, spineWidth, trim.heightPt).fill("#16291f");
    doc.font(boldFontName).fontSize(24).fillColor("#ffffff").text(input.title, frontX + 34, bleed + 116, { width: frontW - 68, lineBreak: true });
    if (input.subtitle)
        doc.font(bodyFontName).fontSize(11).fillColor("#d7e3dc").text(input.subtitle, frontX + 34, doc.y + 12, { width: frontW - 68 });
    doc.font(boldFontName).fontSize(14).fillColor("#ffffff").text(`${input.puzzles.length} puzzles`, frontX + 34, bleed + trim.heightPt - 152, { width: frontW - 68 });
    doc.font(bodyFontName).fontSize(9.5).fillColor("#d7e3dc").text("Answers in the second half - large print", frontX + 34, doc.y + 8, { width: frontW - 68 });
    doc.font(boldFontName).fontSize(15).fillColor("#f0e6c8").text(brandLine.toUpperCase(), frontX + 34, bleed + trim.heightPt - 94, { width: frontW - 68 });
    doc.font(bodyFontName).fontSize(8).fillColor("#c9d8cf").text(`${reference} - v${input.volumeVersion}`, frontX + 34, doc.y + 4, { width: frontW - 68 });
    doc.save();
    doc.translate(bleed + trim.widthPt + spineWidth / 2, bleed + trim.heightPt / 2);
    doc.rotate(-90);
    doc.font(boldFontName).fontSize(10.5).fillColor("#ffffff").text(`${input.title} - ${reference}`, -trim.heightPt / 2 + 24, -6, { width: trim.heightPt - 48, align: "center", lineBreak: false });
    doc.restore();
    doc.font(boldFontName).fontSize(14).fillColor("#11331f").text("About this book", bleed + 34, bleed + 78, { width: trim.widthPt - 68 });
    doc.font(bodyFontName).fontSize(9.5).fillColor("#333333").text([
        `${input.puzzles.length} large-print puzzles with the answers collected in the second half of the book.`,
        "",
        "Every page shows its difficulty next to the puzzle number, and the answer key keeps the same numbering.",
        "",
        `Book reference ${reference}.`,
        `(c) ${year} ${input.copyrightHolder ?? "SETTIS LLC"}. All rights reserved.`,
        input.shopUrl ? `More volumes: ${input.shopUrl}` : "More volumes in the MyPuzzles shop."
    ].join("\n"), bleed + 34, bleed + 104, { width: trim.widthPt - 68, lineBreak: true });
    doc.font(boldFontName).fontSize(11).fillColor("#11331f").text(`${brandLine.toUpperCase()} - ${reference}`, bleed + 34, bleed + trim.heightPt - 78, { width: trim.widthPt - 68 });
    doc.end();
    return finished;
}
export async function renderBookArtifacts(input) {
    const digital = await renderInterior(input, "digital");
    const print = await renderInterior(input, "print");
    const coverPdf = await renderCover(input, digital.pageCount);
    return {
        digitalPdf: digital.buffer,
        printPdf: print.buffer,
        coverPdf,
        pageCount: Math.max(digital.pageCount, print.pageCount),
        pageMap: digital.pageMap
    };
}

/**
 * Studio entry point: renders a bundle from a JSON file into the four artifacts
 * the studio offers, using the same renderer as the web app.
 */
export async function renderBook(bundle) {
  const result = await renderBookArtifacts({
    title: bundle.title ?? "Puzzle book",
    subtitle: bundle.subtitle ?? null,
    volumeVersion: bundle.volumeVersion ?? 1,
    trimSize: bundle.trimSize ?? "A4",
    answersInBack: bundle.answersInBack !== false,
    bookReference: bundle.bookReference ?? null,
    copyrightHolder: bundle.copyrightHolder ?? "SETTIS LLC",
    puzzles: bundle.puzzles ?? [],
    generatedAt: bundle.generatedAt ? new Date(bundle.generatedAt) : new Date(),
    shopUrl: bundle.shopUrl ?? null
  });
  return { digital: result.digitalPdf, print: result.printPdf, cover: result.coverPdf, pageMap: result.pageMap, pageCount: result.pageCount };
}