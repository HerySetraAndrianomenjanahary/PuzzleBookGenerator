/**
 * Book recipes and page layout.
 *
 * Mirrors the rules used by the MyPuzzles web app so a book produced here and a
 * book produced there have the same structure: a Standard single-type book of
 * 100 puzzles (25 normal plus 15 in every other difficulty) and a Gauntlet
 * volume of 50 puzzles covering every printable family at one difficulty.
 */

export const printablePuzzleTypes = [
  "wordsearch",
  "crossword",
  "cryptic-crossword",
  "kriss-kross",
  "backwords",
  "pieceword",
  "sudoku",
  "colour-sudoku",
  "codeword",
  "pathfinder"
];

export const difficulties = ["very-easy", "easy", "normal", "hard", "very-hard", "elite"];

export const difficultyLabels = {
  "very-easy": "Very Easy",
  easy: "Easy",
  normal: "Normal",
  hard: "Hard",
  "very-hard": "Very Hard",
  elite: "Elite"
};

export const puzzleLabels = {
  wordsearch: "Wordsearch",
  crossword: "Crossword",
  "cryptic-crossword": "Cryptic Crossword",
  "kriss-kross": "Kriss Kross",
  backwords: "Backwards",
  pieceword: "Pieceword",
  sudoku: "Sudoku",
  "colour-sudoku": "Colour Sudoku",
  codeword: "Codeword",
  pathfinder: "Pathfinder"
};

export const bookTrimSizes = {
  A4: { label: "A4 (210 x 297 mm)", widthPt: 595.28, heightPt: 841.89, marginPt: 48 },
  US_LETTER: { label: "US Letter (8.5 x 11 in)", widthPt: 612, heightPt: 792, marginPt: 48 },
  SIX_BY_NINE: { label: "6 x 9 in trade paperback", widthPt: 432, heightPt: 648, marginPt: 40 }
};

export const standardBookDifficultyCounts = {
  "very-easy": 15,
  easy: 15,
  normal: 25,
  hard: 15,
  "very-hard": 15,
  elite: 15
};

export const gauntletPuzzlesPerType = 5;
export const standardBookPuzzleCount = 100;
export const gauntletVolumePuzzleCount = printablePuzzleTypes.length * gauntletPuzzlesPerType;

export function standardBookRecipe(puzzleType) {
  if (!printablePuzzleTypes.includes(puzzleType)) throw new Error(`${puzzleType} is not a printable puzzle type.`);
  return difficulties.map((difficulty, index) => ({
    puzzleType,
    difficulty,
    puzzleCount: standardBookDifficultyCounts[difficulty],
    sortOrder: index
  }));
}

export function gauntletRecipe(difficulty) {
  if (!difficulties.includes(difficulty)) throw new Error(`${difficulty} is not a known difficulty.`);
  return printablePuzzleTypes.map((puzzleType, index) => ({ puzzleType, difficulty, puzzleCount: gauntletPuzzlesPerType, sortOrder: index }));
}

/** Three front-matter pages, one page per puzzle, a divider, answers, one back page. */
export function bookPageLayout(sections, { answersInBack = true } = {}) {
  const frontMatterPages = 3;
  const backMatterPages = 1;
  const puzzlePages = sections.reduce((total, section) => total + Math.max(0, section.puzzleCount), 0);
  const answerPages = answersInBack ? Math.max(1, Math.ceil(puzzlePages / 6)) : 0;
  const dividerPages = answersInBack ? 1 : 0;
  const rawPages = frontMatterPages + puzzlePages + dividerPages + answerPages + backMatterPages;
  return { frontMatterPages, puzzlePages, dividerPages, answerPages, backMatterPages, rawPages, totalPages: rawPages % 2 === 0 ? rawPages : rawPages + 1 };
}

/** How many answers fit legibly on one answer page. */
export function answerDensityForPuzzle(puzzle) {
  const rows = puzzle.board?.length ?? 0;
  const columns = Math.max(1, ...(puzzle.board ?? []).map((row) => row.length));
  const span = Math.max(rows, columns);
  if (!span) return 6;
  if (span > 20) return 1;
  if (span > 15) return 2;
  if (span > 10) return 4;
  return 6;
}

export function describeBundle(bundle) {
  const puzzles = bundle.puzzles ?? [];
  const byDifficulty = new Map();
  for (const puzzle of puzzles) byDifficulty.set(puzzle.difficulty, (byDifficulty.get(puzzle.difficulty) ?? 0) + 1);
  return {
    title: bundle.title ?? "Untitled book",
    puzzles: puzzles.length,
    byDifficulty: [...byDifficulty.entries()].map(([difficulty, count]) => ({ difficulty, label: difficultyLabels[difficulty] ?? difficulty, count })),
    layout: bookPageLayout(puzzles.map((puzzle) => ({ puzzleCount: 1 })), { answersInBack: bundle.answersInBack !== false })
  };
}