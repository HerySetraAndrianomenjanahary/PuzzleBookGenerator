# Printing notes

## What a print shop needs

1. **Interior**: one PDF, page size matching the trim size, an even page count,
   fonts embedded. `node src/cli.js render` writes exactly that as `*-print.pdf`.
2. **Cover**: a wrap file whose width is `2 × trim width + spine + bleed`.
   `*-cover.pdf` already includes a 9pt bleed on every side and a spine width
   calculated as `pages × 0.162144pt`, which is the standard 60# black-and-white
   paper thickness. If your printer uses different paper, adjust the spine in
   `src/render.js` (`spineWidth`).
3. **One combined file**, if they prefer it: `*-print-pack.pdf` (interior first,
   then the cover).

## Trim sizes

| Id | Size | Notes |
| --- | --- | --- |
| `A4` | 210 × 297 mm | default, best for large-print grids |
| `US_LETTER` | 8.5 × 11 in | US equivalent |
| `SIX_BY_NINE` | 6 × 9 in | cheapest print-on-demand tier, small for elite grids |

Pass it in the bundle (`"trimSize": "US_LETTER"`) or pick it in the studio.

## Before sending a file out

```bash
node src/cli.js verify out/my-book-print.pdf
```

The report tells you the page count, whether it is even, the page size and the
file size. Fix anything marked `warn` first: a printer that receives an odd page
count will usually insert a blank page of its own, and a mixed page size is
rejected by print-on-demand services.

## Print-on-demand services

The exported files are ordinary PDFs. When you use a print-on-demand API
(Lulu, Prodigi, Bookvault, Peecho), upload `*-print.pdf` as the interior and
`*-cover.pdf` as the cover, and check that service's own PDF/X and bleed
requirements, which differ slightly between vendors.

## Watermarking a single copy

For a review copy or a one-off:

```bash
node src/cli.js watermark out/my-book-digital.pdf "Review copy - not for resale"
```

The MyPuzzles shop does this automatically for every customer download.