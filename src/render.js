/**
 * Book renderer.
 *
 * Lays a puzzle bundle out as a printable book: front matter, one page per
 * puzzle, a divider, the answer key in the second half, and a back page. The
 * page count is padded to an even number and the answer pages are sized by grid
 * legibility so no answer is ever dropped.
 *
 * A bundle is either produced by the MyPuzzles web app (`--bundle`) or built by
 * hand; see examples/sample-bundle.json.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import PDFDocument from "pdfkit";

import { answerDensityForPuzzle, bookTrimSizes, difficultyLabels, puzzleLabels } from "./recipe.js";

const here = dirname(fileURLToPath(import.meta.url));
const fontDir = join(here, "..", "assets", "fonts");
const bodyFontPath = join(fontDir, "DejaVuSans.ttf");
const boldFontPath = join(fontDir, "DejaVuSans-Bold.ttf");
const hasFonts = existsSync(bodyFontPath) && existsSync(boldFontPath);
const bodyFontName = hasFonts ? "BookBody" : "Helvetica";
const boldFontName = hasFonts ? "BookBody-Bold" : "Helvetica-Bold";

function registerFonts(doc) {
  if (hasFonts) {
    doc.registerFont("BookBody", bodyFontPath);
    doc.registerFont("BookBody-Bold", boldFontPath);
  }
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const asRows = (value) => (Array.isArray(value) ? value.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : [String(row ?? "")])) : []);
const asStringArray = (value) => (Array.isArray(value) ? value.map((entry) => String(entry ?? "")) : []);
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const records = (value) => (Array.isArray(value) ? value.filter(isRecord) : []);
const meta = (puzzle) => puzzle.metadata ?? {};

export function drawGrid(doc, options) {
  const grid = options.grid ?? [];
  const rows = Math.max(1, grid.length);
  const columns = Math.max(1, ...grid.map((row) => row.length));
  const cellSize = Math.max(options.minCell ?? 8, Math.min(options.width / columns, options.height / rows));
  const gridWidth = cellSize * columns;
  const gridHeight = cellSize * rows;
  const baseFont = options.fontSize ?? clamp(cellSize * 0.52, 6, 18);

  doc.save();
  doc.lineWidth(0.4);
  doc.strokeColor("#111111");
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
      const label = options.cellLabel ? options.cellLabel(cell, row, col) : cell;
      if (label) {
        doc.fillColor("#111111").font(boldFontName).fontSize(baseFont);
        const textWidth = doc.widthOfString(label);
        doc.text(label, x + (cellSize - textWidth) / 2, y + cellSize / 2 - baseFont * 0.62, { lineBreak: false });
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
      if (col % options.heavyEvery) continue;
      const x = options.x + col * cellSize;
      doc.moveTo(x, options.y).lineTo(x, options.y + gridHeight).stroke();
    }
    for (let row = 0; row <= rows; row += 1) {
      if (row % options.heavyEvery) continue;
      const y = options.y + row * cellSize;
      doc.moveTo(options.x, y).lineTo(options.x + gridWidth, y).stroke();
    }
  }
  doc.rect(options.x, options.y, gridWidth, gridHeight).lineWidth(1.2).stroke();
  doc.restore();
  return { cellSize, width: gridWidth, height: gridHeight };
}

function balanceColumns(items, columnCount) {
  if (columnCount <= 1) return [items];
  const perColumn = Math.ceil(items.length / columnCount);
  const columns = [];
  for (let index = 0; index < items.length; index += perColumn) columns.push(items.slice(index, index + perColumn));
  return columns;
}

function clueBlocks(puzzle) {
  const data = meta(puzzle);
  const blocks = [];
  for (const [key, heading] of [["across", "Across"], ["down", "Down"]]) {
    const entries = records(data[key]);
    if (!entries.length) continue;
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
    if (!match) continue;
    const [, row, col, letter] = match;
    if (grid[Number(row)]?.[Number(col)] !== undefined && grid[Number(row)][Number(col)] !== "#") grid[Number(row)][Number(col)] = letter;
  }
  return grid;
}

function backwordsAnswerGrid(puzzle) {
  const rows = puzzle.board.length;
  const columns = puzzle.board[0]?.length ?? 0;
  const raw = puzzle.solution?.[0] ?? "";
  const mask = raw.includes("|") ? raw.slice(raw.indexOf("|") + 1) : raw;
  if (mask.length < rows * columns) return puzzle.board;
  return puzzle.board.map((row, r) => row.map((cell, c) => (mask[r * columns + c] === "1" ? cell : "#")));
}

function krissKrossGrid(puzzle, filled) {
  const data = meta(puzzle);
  const rows = Number(data.rows ?? 0);
  const columns = Number(data.columns ?? 0);
  const entries = records(data.entries);
  if (!rows || !columns || !entries.length) return null;
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
      if (grid[r]?.[c] === undefined) continue;
      grid[r][c] = word[offset] ?? "";
    }
  });
  return grid;
}

function colourLookup(puzzle) {
  const byValue = new Map();
  const byName = new Map();
  for (const color of records(meta(puzzle).colors)) {
    if (color.value) byValue.set(String(color.value), String(color.hex ?? "#cccccc"));
    if (color.name) byName.set(String(color.name).toUpperCase(), String(color.hex ?? "#cccccc"));
  }
  return { byValue, byName };
}

function sudokuAnswerRows(puzzle) {
  const raw = puzzle.solution?.[0] ?? "";
  if (!raw.includes(",")) return null;
  return raw.split(",").map((row) => row.split(""));
}

function codewordBlocks(puzzle) {
  const data = meta(puzzle);
  const numbers = asStringArray(data.numbers);
  const revealed = records(data.revealed);
  const blocks = [];
  if (numbers.length) blocks.push({ heading: "Code numbers", lines: [numbers.join(" · ")] });
  if (revealed.length) blocks.push({ heading: "Given letters", lines: [revealed.map((entry) => `${entry.number} = ${entry.letter}`).join("   ")] });
  return blocks;
}

function buildGridSpec(puzzle) {
  const board = asRows(puzzle.board);
  const numbers = new Map();
  for (const entry of records(meta(puzzle).entries)) {
    const row = Number(entry.row ?? -1);
    const col = Number(entry.col ?? -1);
    if (row < 0 || col < 0 || entry.number === undefined || entry.number === null) continue;
    if (!numbers.has(`${row}:${col}`)) numbers.set(`${row}:${col}`, String(entry.number));
  }
  switch (puzzle.puzzleType) {
    case "crossword":
    case "cryptic-crossword":
      return { grid: board, options: { isBlocked: (cell) => cell === "#", cornerLabel: (cell, row, col) => (cell === "#" ? null : numbers.get(`${row}:${col}`) ?? null) }, heightFraction: 0.46, clueColumns: 3 };
    case "backwords":
      return { grid: board, options: {}, heightFraction: 0.42, clueColumns: 3 };
    case "kriss-kross":
      return { grid: krissKrossGrid(puzzle, false) ?? board, options: { isBlocked: (cell) => cell === "#" }, heightFraction: 0.5, clueColumns: 2 };
    case "sudoku":
      return { grid: board.map((row) => row.map((cell) => (cell === "." ? "" : cell))), options: { heavyEvery: 3, fontSize: 14 }, heightFraction: 0.62, clueColumns: 2 };
    case "colour-sudoku": {
      const { byValue } = colourLookup(puzzle);
      return { grid: board.map((row) => row.map((cell) => (cell === "." ? "" : cell))), options: { heavyEvery: 3, fontSize: 12, cellFill: (cell) => (cell ? byValue.get(cell) ?? null : null) }, heightFraction: 0.55, clueColumns: 2 };
    }
    case "wordsearch":
      return { grid: board, options: { fontSize: 9 }, heightFraction: 0.58, clueColumns: 3 };
    case "pathfinder":
      return { grid: board, options: { fontSize: 9 }, heightFraction: 0.55, clueColumns: 2 };
    case "codeword":
      return { grid: board, options: { isBlocked: (cell) => cell === "" }, heightFraction: 0, clueColumns: 2 };
    default:
      return { grid: board, options: {}, heightFraction: 0.5, clueColumns: 2 };
  }
}

function puzzleExtras(puzzle) {
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
      if (!bank.length) return [];
      const grouped = new Map();
      for (const word of bank) grouped.set(word.length, [...(grouped.get(word.length) ?? []), word]);
      return [{ heading: "Word bank", lines: [...grouped.entries()].sort((a, b) => a[0] - b[0]).map(([length, words]) => `${length} letters: ${words.join(", ")}`) }];
    }
    case "pieceword": {
      const across = asStringArray(data.acrossRows);
      if (across.length) return [{ heading: "Across clues", lines: across }];
      return (puzzle.instructions ?? []).length ? [{ heading: "How to solve", lines: puzzle.instructions }] : [];
    }
    case "pathfinder": {
      const targets = records(data.targets);
      return targets.length ? [{ heading: "Hidden paths", lines: targets.map((target, index) => `${index + 1}. ${String(target.label ?? "Path")} — ${String(target.length ?? 0)} letters`) }] : [];
    }
    case "codeword":
      return codewordBlocks(puzzle);
    case "colour-sudoku": {
      const colors = records(data.colors);
      return colors.length ? [{ heading: "Colours", lines: colors.map((color) => `${String(color.value ?? "")} = ${String(color.name ?? "")}`) }] : [];
    }
    default:
      return [];
  }
}

function answerView(puzzle) {
  const data = meta(puzzle);
  switch (puzzle.puzzleType) {
    case "crossword":
    case "cryptic-crossword":
      return { grid: crosswordAnswerGrid(puzzle), options: { isBlocked: (cell) => cell === "#", fontSize: 8 }, lines: [], heightFraction: 0.5 };
    case "backwords":
      return { grid: backwordsAnswerGrid(puzzle), options: { isBlocked: (cell) => cell === "#", fontSize: 8 }, lines: [], heightFraction: 0.5 };
    case "kriss-kross": {
      const grid = krissKrossGrid(puzzle, true);
      return { grid, options: { isBlocked: (cell) => cell === "#", fontSize: 8 }, lines: grid ? [] : (puzzle.solution ?? []).map((word, index) => `${index + 1}. ${word}`), heightFraction: 0.5 };
    }
    case "pieceword":
      return { grid: null, options: {}, lines: (puzzle.solution ?? []).map((entry, index) => `${index + 1}. ${entry}`), heightFraction: 0.2 };
    case "sudoku":
      return { grid: sudokuAnswerRows(puzzle), options: { heavyEvery: 3, fontSize: 9 }, lines: [], heightFraction: 0.5 };
    case "colour-sudoku": {
      const { byName } = colourLookup(puzzle);
      return { grid: sudokuAnswerRows(puzzle), options: { heavyEvery: 3, fontSize: 9, cellFill: (cell) => (cell ? byName.get(String(cell).toUpperCase()) ?? null : null) }, lines: [], heightFraction: 0.5 };
    }
    case "wordsearch": {
      const words = records(data.targets).map((target) => String(target.word ?? ""));
      const coordinates = (puzzle.solution ?? []).map((entry) => {
        const parts = entry.split("|");
        return parts.length >= 4 ? parts[3].replace(/;/g, " - ") : "";
      });
      return { grid: null, options: {}, lines: words.map((word, index) => `${word}${coordinates[index] ? `  (${coordinates[index]})` : ""}`), heightFraction: 0.2 };
    }
    case "pathfinder":
      return {
        grid: null,
        options: {},
        lines: (puzzle.solution ?? []).map((entry, index) => {
          const word = entry.split(":")[2] ?? "";
          const cells = entry.split(":").slice(3).join(":");
          return `Path ${index + 1}: ${word} (${cells ? cells.split("|").length : 0} cells)`;
        }),
        heightFraction: 0.2
      };
    case "codeword":
      return { grid: null, options: {}, lines: (puzzle.solution ?? []).map((word, index) => `${index + 1}. ${word}`), heightFraction: 0.2 };
    default:
      return { grid: null, options: {}, lines: puzzle.solution ?? [], heightFraction: 0.2 };
  }
}

function drawCodewordPuzzle(doc, puzzle, x, y, width, height) {
  const rows = puzzle.board.length;
  if (!rows) return y;
  const rowHeight = Math.min(64, height / rows);
  let cursorY = y;
  doc.font(bodyFontName).fontSize(10).fillColor("#111111");
  puzzle.board.forEach((row) => {
    const words = row.map((cell) => String(cell).split("-").filter(Boolean));
    const cellSize = Math.min(16, (width - 40) / Math.max(1, Math.max(...words.map((word) => word.length))));
    let cursorX = x;
    words.forEach((word) => {
      word.forEach((number) => {
        doc.lineWidth(0.4).strokeColor("#111111");
        doc.rect(cursorX, cursorY, cellSize, cellSize).stroke();
        doc.font(boldFontName).fontSize(Math.max(6, cellSize * 0.5)).fillColor("#111111");
        doc.text(number, cursorX + 1, cursorY + cellSize * 0.25, { width: cellSize - 2, align: "center", lineBreak: false });
        cursorX += cellSize;
      });
      cursorX += 8;
    });
    cursorY += rowHeight;
  });
  return cursorY;
}

function drawExtras(doc, blocks, x, y, width, height, maxColumns) {
  if (!blocks.length || height < 20) return;
  const flat = [];
  for (const block of blocks) [block.heading, ...block.lines].forEach((text, index) => flat.push({ heading: index === 0, text }));
  const lineHeight = 10.5;
  const columns = Math.min(Math.max(1, maxColumns), Math.max(1, Math.ceil((flat.length * lineHeight) / height)));
  const columnWidth = width / columns - 8;
  balanceColumns(flat, columns).forEach((bucket, columnIndex) => {
    let cursorY = y;
    const columnX = x + columnIndex * (columnWidth + 8);
    for (const item of bucket) {
      const remaining = y + height - cursorY;
      if (remaining < 6) break;
      doc.font(item.heading ? boldFontName : bodyFontName).fontSize(item.heading ? 9 : 8).fillColor(item.heading ? "#111111" : "#222222");
      doc.text(item.text, columnX, cursorY, { width: columnWidth, height: remaining, ellipsis: false, lineBreak: true });
      cursorY = doc.y + (item.heading ? 3 : 1);
    }
  });
}

function puzzleHeader(doc, puzzle, x, y, width) {
  doc.font(boldFontName).fontSize(13).fillColor("#111111");
  doc.text(`${puzzle.title ?? puzzleLabels[puzzle.puzzleType] ?? puzzle.puzzleType} · ${difficultyLabels[puzzle.difficulty] ?? puzzle.difficulty}`, x, y, { width: width * 0.7, lineBreak: false });
  doc.font(bodyFontName).fontSize(11).fillColor("#444444");
  doc.text(`Puzzle ${puzzle.puzzleNumber}`, x, y + 1, { width, align: "right", lineBreak: false });
  if (puzzle.prompt) {
    doc.font(bodyFontName).fontSize(8.5).fillColor("#555555");
    doc.text(puzzle.prompt, x, y + 20, { width, lineBreak: true });
  }
  return doc.y + 6;
}

function drawPuzzlePage(doc, puzzle, area) {
  puzzle.board = asRows(puzzle.board);
  const startY = puzzleHeader(doc, puzzle, area.x, area.y, area.width);
  const spec = buildGridSpec(puzzle);
  if (puzzle.puzzleType === "codeword") {
    drawCodewordPuzzle(doc, puzzle, area.x, startY, area.width, area.height * 0.55);
    drawExtras(doc, puzzleExtras(puzzle), area.x, startY + area.height * 0.6, area.width, area.height * 0.35, spec.clueColumns);
    return;
  }
  const gridHeight = Math.max(60, area.height * spec.heightFraction);
  const maxGridWidth = spec.clueColumns > 1 ? area.width * 0.62 : area.width;
  const drawn = drawGrid(doc, { grid: spec.grid, x: area.x + Math.max(0, (maxGridWidth - Math.min(maxGridWidth, gridHeight)) / 2), y: startY, width: maxGridWidth, height: gridHeight, ...spec.options });
  const extrasX = area.x + drawn.width + 16;
  const extrasWidth = area.width - drawn.width - 16;
  const blocks = puzzleExtras(puzzle);
  if (extrasWidth > 140) drawExtras(doc, blocks, extrasX, startY, extrasWidth, Math.max(area.height - (startY - area.y), 80), 2);
  else drawExtras(doc, blocks, area.x, startY + drawn.height + 14, area.width, Math.max(area.height - (startY - area.y) - drawn.height - 14, 0), spec.clueColumns);
}

function drawAnswerPage(doc, puzzles, area, heading, pageLabel) {
  doc.font(boldFontName).fontSize(14).fillColor("#111111").text(heading, area.x, area.y, { width: area.width, lineBreak: false });
  doc.font(bodyFontName).fontSize(9).fillColor("#555555").text(pageLabel, area.x, area.y + 18, { width: area.width, lineBreak: false });
  const headerSpace = 38;
  const perPuzzle = (area.height - headerSpace) / Math.max(1, puzzles.length);
  let cursorY = area.y + headerSpace;
  for (const puzzle of puzzles) {
    const view = answerView(puzzle);
    const blockHeight = view.grid ? Math.max(40, Math.min(area.height * view.heightFraction, perPuzzle - 18)) : 0;
    doc.font(boldFontName).fontSize(10).fillColor("#111111");
    doc.text(`Puzzle ${puzzle.puzzleNumber} · ${puzzle.title ?? puzzleLabels[puzzle.puzzleType] ?? ""} · ${difficultyLabels[puzzle.difficulty] ?? ""}`, area.x, cursorY, { width: area.width, lineBreak: false });
    cursorY += 14;
    if (view.grid) {
      const drawn = drawGrid(doc, { grid: view.grid, x: area.x, y: cursorY, width: Math.min(area.width, blockHeight), height: blockHeight, ...view.options });
      cursorY += drawn.height + 6;
    }
    if (view.lines.length) {
      const columns = view.lines.length > 18 ? 3 : view.lines.length > 8 ? 2 : 1;
      const columnWidth = area.width / columns - 8;
      balanceColumns(view.lines, columns).forEach((bucket, index) => {
        doc.font(bodyFontName).fontSize(8).fillColor("#222222");
        doc.text(bucket.join("\n"), area.x + index * (columnWidth + 8), cursorY, { width: columnWidth, height: Math.max(10, area.y + area.height - cursorY), ellipsis: false, lineBreak: true });
      });
      cursorY += 8 + Math.ceil(view.lines.length / columns) * 10;
    }
    cursorY += 10;
  }
}

/** Renders the interior. Returns { buffer, pageMap, pageCount }. */
export async function renderInterior(bundle, { pass = "digital" } = {}) {
  const trim = bookTrimSizes[bundle.trimSize ?? "A4"] ?? bookTrimSizes.A4;
  const puzzles = (bundle.puzzles ?? []).map((puzzle, index) => ({ ...puzzle, puzzleNumber: puzzle.puzzleNumber ?? index + 1 }));
  const answersInBack = bundle.answersInBack !== false;

  const doc = new PDFDocument({
    size: [trim.widthPt, trim.heightPt],
    margin: trim.marginPt,
    autoFirstPage: false,
    bufferPages: true,
    compress: true,
    info: {
      Title: bundle.title ?? "Puzzle book",
      Author: bundle.author ?? "MyPuzzles",
      Subject: bundle.subtitle ?? "Printable puzzle book",
      Creator: `MyPuzzles Book Studio (${pass})`,
      Producer: "MyPuzzles Book Studio",
      CreationDate: new Date(bundle.generatedAt ?? Date.now()),
      ModDate: new Date(bundle.generatedAt ?? Date.now())
    }
  });
  registerFonts(doc);
  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const finished = new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const area = { x: trim.marginPt, y: trim.marginPt, width: trim.widthPt - trim.marginPt * 2, height: trim.heightPt - trim.marginPt * 2 };

  doc.addPage();
  doc.font(boldFontName).fontSize(30).fillColor("#111111").text(bundle.title ?? "Puzzle book", area.x, area.y + 120, { width: area.width, align: "center" });
  if (bundle.subtitle) doc.font(bodyFontName).fontSize(14).fillColor("#444444").text(bundle.subtitle, area.x, doc.y + 12, { width: area.width, align: "center" });
  doc.font(bodyFontName).fontSize(11).fillColor("#555555").text(`${puzzles.length} puzzles · Answers in the second half`, area.x, doc.y + 24, { width: area.width, align: "center" });

  doc.addPage();
  doc.font(boldFontName).fontSize(16).fillColor("#111111").text("How to use this book", area.x, area.y);
  doc.font(bodyFontName).fontSize(10).fillColor("#222222").text(
    [
      "Every puzzle is printed on its own page. Work at your own pace and use a pencil if you may want a second attempt.",
      "",
      "Answers for every puzzle are collected in the second half of the book, in the same order as the puzzles, and each answer keeps its puzzle number.",
      "",
      "Difficulty rises through the book, and every puzzle page shows its difficulty next to the title.",
      "",
      `Generated ${new Date(bundle.generatedAt ?? Date.now()).toISOString().slice(0, 10)} · version ${bundle.volumeVersion ?? 1}`
    ].join("\n"),
    area.x,
    area.y + 26,
    { width: area.width, height: area.height - 26, ellipsis: false, lineBreak: true }
  );

  doc.addPage();
  doc.font(boldFontName).fontSize(16).fillColor("#111111").text("Contents", area.x, area.y);
  const byDifficulty = new Map();
  for (const puzzle of puzzles) byDifficulty.set(puzzle.difficulty, (byDifficulty.get(puzzle.difficulty) ?? 0) + 1);
  doc.font(bodyFontName).fontSize(10).fillColor("#222222").text(
    [...byDifficulty.entries()].map(([difficulty, count]) => `${difficultyLabels[difficulty] ?? difficulty}: ${count} puzzles`).join("\n"),
    area.x,
    area.y + 26,
    { width: area.width, height: area.height - 60, ellipsis: false }
  );

  const pageMap = [];
  for (const puzzle of puzzles) {
    doc.addPage();
    drawPuzzlePage(doc, puzzle, area);
    pageMap.push({ puzzleNumber: puzzle.puzzleNumber, pageIndex: 0, answerPageIndex: null });
  }
  const firstPuzzlePage = 3;
  pageMap.forEach((entry, index) => {
    entry.pageIndex = firstPuzzlePage + index;
  });

  const answerStartIndex = firstPuzzlePage + puzzles.length + 1;
  if (answersInBack && puzzles.length) {
    doc.addPage();
    doc.font(boldFontName).fontSize(26).fillColor("#111111").text("Answers", area.x, area.y + 200, { width: area.width, align: "center" });
    doc.font(bodyFontName).fontSize(11).fillColor("#555555").text("The answer for each puzzle keeps its puzzle number.", area.x, doc.y + 16, { width: area.width, align: "center" });

    const groups = [];
    let group = [];
    for (const puzzle of puzzles) {
      const limit = Math.min(answerDensityForPuzzle(puzzle), ...group.map(answerDensityForPuzzle), Number.POSITIVE_INFINITY);
      if (group.length >= limit) {
        groups.push(group);
        group = [];
      }
      group.push(puzzle);
    }
    if (group.length) groups.push(group);

    let placed = 0;
    groups.forEach((answerGroup, offset) => {
      doc.addPage();
      drawAnswerPage(doc, answerGroup, area, "Answers", `Page ${offset + 1}`);
      answerGroup.forEach((_, index) => {
        pageMap[placed + index].answerPageIndex = answerStartIndex + offset;
      });
      placed += answerGroup.length;
    });
    if (placed !== puzzles.length) throw new Error(`Answer layout dropped ${puzzles.length - placed} answers; refusing to write an incomplete book.`);
  }

  doc.addPage();
  doc.font(boldFontName).fontSize(16).fillColor("#111111").text("More from MyPuzzles", area.x, area.y);
  doc.font(bodyFontName).fontSize(10).fillColor("#222222").text(
    [
      "MyPuzzles builds calm, printable puzzle books across crossword, sudoku, wordsearch, kriss kross, codeword, pieceword, backwards, pathfinder and colour sudoku.",
      "",
      bundle.shopUrl ? `Find the rest of the series at ${bundle.shopUrl}` : "Find the rest of the series in the MyPuzzles shop.",
      "",
      "This book is generated content owned by MyPuzzles; please enjoy it personally rather than redistributing it."
    ].join("\n"),
    area.x,
    area.y + 26,
    { width: area.width, height: area.height - 26, ellipsis: false, lineBreak: true }
  );

  let range = doc.bufferedPageRange();
  if (range.count % 2 !== 0) {
    doc.addPage();
    range = doc.bufferedPageRange();
  }
  for (let page = range.start; page < range.start + range.count; page += 1) {
    doc.switchToPage(page);
    const label = page === range.start ? "" : `MyPuzzles · ${page + 1}`;
    if (!label) continue;
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font(bodyFontName).fontSize(8).fillColor("#777777");
    doc.text(label, area.x, trim.heightPt - 22, { width: area.width, align: "center", lineBreak: false });
    doc.page.margins.bottom = bottomMargin;
  }
  doc.flushPages();
  doc.end();

  return { buffer: await finished, pageMap, pageCount: range.count };
}

/** Renders a cover wrap sized to the real page count (spine included). */
export async function renderCover(bundle, pageCount) {
  const trim = bookTrimSizes[bundle.trimSize ?? "A4"] ?? bookTrimSizes.A4;
  const bleed = 9;
  const spineWidth = Math.max(36, pageCount * 0.162144);
  const width = trim.widthPt * 2 + spineWidth + bleed * 2;
  const height = trim.heightPt + bleed * 2;

  const doc = new PDFDocument({ size: [width, height], margin: 0, autoFirstPage: false, compress: true, info: { Title: `${bundle.title ?? "Puzzle book"} — cover`, Author: bundle.author ?? "MyPuzzles", Producer: "MyPuzzles Book Studio" } });
  registerFonts(doc);
  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const finished = new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  doc.addPage();
  const frontX = bleed + trim.widthPt + spineWidth;
  const frontW = trim.widthPt;
  doc.rect(0, 0, width, height).fill("#f7f6f2");
  doc.rect(frontX, bleed, frontW, trim.heightPt).fill("#1f3d33");
  doc.rect(bleed, bleed, trim.widthPt, trim.heightPt).fill("#ffffff");
  doc.rect(bleed + trim.widthPt, bleed, spineWidth, trim.heightPt).fill("#16291f");

  doc.font(boldFontName).fontSize(26).fillColor("#ffffff").text(bundle.title ?? "Puzzle book", frontX + 36, bleed + 130, { width: frontW - 72, lineBreak: true });
  if (bundle.subtitle) doc.font(bodyFontName).fontSize(12).fillColor("#d7e3dc").text(bundle.subtitle, frontX + 36, doc.y + 14, { width: frontW - 72 });
  doc.font(boldFontName).fontSize(14).fillColor("#ffffff").text(`${(bundle.puzzles ?? []).length} puzzles`, frontX + 36, bleed + trim.heightPt - 150, { width: frontW - 72 });
  doc.font(bodyFontName).fontSize(10).fillColor("#d7e3dc").text("Answers in the second half · Large print", frontX + 36, doc.y + 8, { width: frontW - 72 });
  doc.font(boldFontName).fontSize(15).fillColor("#f0e6c8").text("MYPUZZLES", frontX + 36, bleed + trim.heightPt - 88, { width: frontW - 72 });

  doc.save();
  doc.translate(bleed + trim.widthPt + spineWidth / 2, bleed + trim.heightPt / 2);
  doc.rotate(-90);
  doc.font(boldFontName).fontSize(11).fillColor("#ffffff").text(`${bundle.title ?? "Puzzle book"} · MyPuzzles`, -trim.heightPt / 2 + 24, -6, { width: trim.heightPt - 48, align: "center", lineBreak: false });
  doc.restore();

  doc.font(boldFontName).fontSize(15).fillColor("#11331f").text("About this book", bleed + 36, bleed + 90, { width: trim.widthPt - 72 });
  doc.font(bodyFontName).fontSize(10).fillColor("#333333").text(
    [
      `${(bundle.puzzles ?? []).length} large-print puzzles with the answers collected in the second half of the book.`,
      "",
      "Printed edition, version " + (bundle.volumeVersion ?? 1) + ". Generated " + new Date(bundle.generatedAt ?? Date.now()).toISOString().slice(0, 10) + ".",
      "",
      bundle.shopUrl ? `More volumes: ${bundle.shopUrl}` : "More volumes in the MyPuzzles shop."
    ].join("\n"),
    bleed + 36,
    bleed + 120,
    { width: trim.widthPt - 72, lineBreak: true }
  );
  doc.font(boldFontName).fontSize(12).fillColor("#11331f").text("MYPUZZLES", bleed + 36, bleed + trim.heightPt - 80, { width: trim.widthPt - 72 });

  doc.end();
  return finished;
}

/** Renders the whole book: interior (screen + print variants) and the cover. */
export async function renderBook(bundle) {
  const digital = await renderInterior(bundle, { pass: "digital" });
  const print = await renderInterior(bundle, { pass: "print" });
  const cover = await renderCover(bundle, digital.pageCount);
  return { digital: digital.buffer, print: print.buffer, cover, pageMap: digital.pageMap, pageCount: digital.pageCount };
}