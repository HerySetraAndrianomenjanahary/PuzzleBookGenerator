#!/usr/bin/env node
/**
 * MyPuzzles Book Studio — local book generator.
 *
 *   mypuzzles-books serve                       open the local studio in a browser
 *   mypuzzles-books render <bundle.json> [outDir]
 *   mypuzzles-books inspect <file.pdf>
 *   mypuzzles-books verify <file.pdf>
 *   mypuzzles-books pack <interior.pdf> [cover.pdf] [out.pdf]
 *   mypuzzles-books watermark <file.pdf> <text> [out.pdf]
 *   mypuzzles-books selftest
 */
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bookTrimSizes, describeBundle } from "./recipe.js";
import { renderBook } from "./render.js";
import { buildPrintPack, inspectPdf, mergePdfs, readPdf, verifyPdf, watermarkPdf } from "./pdf.js";

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = join(here, "..");
const safeName = (value) => String(value ?? "book").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "book";

const banner = (text) => console.log(`\n${text}\n${"-".repeat(text.length)}`);

async function loadBundle(path) {
  const raw = await readFile(path, "utf8");
  const bundle = JSON.parse(raw);
  if (!Array.isArray(bundle.puzzles) || bundle.puzzles.length === 0) throw new Error("The bundle has no puzzles. Expected { title, puzzles: [...] }.");
  return bundle;
}

async function commandRender([bundlePath, outDirArg]) {
  if (!bundlePath) throw new Error("Usage: mypuzzles-books render <bundle.json> [outDir]");
  const bundle = await loadBundle(bundlePath);
  const summary = describeBundle(bundle);
  const outDir = resolve(outDirArg ?? join(process.cwd(), "out"));
  await mkdir(outDir, { recursive: true });

  banner(`Rendering ${summary.title}`);
  console.log(`${summary.puzzles} puzzles · layout ${summary.layout.totalPages} pages (padded to even)`);
  for (const row of summary.byDifficulty) console.log(`  ${row.label}: ${row.count}`);

  const started = Date.now();
  const result = await renderBook(bundle);
  const base = safeName(bundle.title ?? basename(bundlePath, extname(bundlePath)));
  const files = {
    digital: join(outDir, `${base}-digital.pdf`),
    print: join(outDir, `${base}-print.pdf`),
    cover: join(outDir, `${base}-cover.pdf`),
    pack: join(outDir, `${base}-print-pack.pdf`)
  };
  await writeFile(files.digital, result.digital);
  await writeFile(files.print, result.print);
  await writeFile(files.cover, result.cover);
  await writeFile(files.pack, await buildPrintPack(result.print, result.cover));

  const verification = await verifyPdf(result.print);
  console.log(`\nWrote in ${((Date.now() - started) / 1000).toFixed(1)}s:`);
  for (const [kind, path] of Object.entries(files)) console.log(`  ${kind.padEnd(8)} ${path}`);
  console.log(`\n${result.pageCount} pages · every puzzle has an answer page: ${result.pageMap.every((entry) => entry.answerPageIndex !== null)}`);
  console.log(`Print checks: ${verification.pass ? "passed" : "attention needed"}`);
  for (const check of verification.checks) console.log(`  ${check.pass ? "ok  " : "warn"} ${check.name} — ${check.detail}`);
}

async function commandInspect([file]) {
  if (!file) throw new Error("Usage: mypuzzles-books inspect <file.pdf>");
  const info = await inspectPdf(await readPdf(file));
  banner(`Inspecting ${file}`);
  for (const [key, value] of Object.entries(info)) console.log(`  ${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`);
}

async function commandVerify([file]) {
  if (!file) throw new Error("Usage: mypuzzles-books verify <file.pdf>");
  const result = await verifyPdf(await readPdf(file));
  banner(`Verifying ${file}`);
  for (const check of result.checks) console.log(`  ${check.pass ? "ok  " : "warn"} ${check.name} — ${check.detail}`);
  console.log(`\n${result.pass ? "Ready to print." : "Not ready: fix the warnings above."}`);
  if (!result.pass) process.exitCode = 2;
}

async function commandPack([interior, cover, out]) {
  if (!interior) throw new Error("Usage: mypuzzles-books pack <interior.pdf> [cover.pdf] [out.pdf]");
  const interiorBuffer = await readPdf(interior);
  const coverBuffer = cover && existsSync(cover) ? await readPdf(cover) : null;
  const packed = await buildPrintPack(interiorBuffer, coverBuffer);
  const target = out ?? join(dirname(resolve(interior)), `${safeName(basename(interior, extname(interior)))}-print-pack.pdf`);
  await writeFile(target, packed);
  const info = await inspectPdf(packed);
  banner("Print pack written");
  console.log(`  ${target}\n  ${info.pageCount} pages · ${(info.bytes / 1024).toFixed(0)}KB`);
}

async function commandWatermark([file, text, out]) {
  if (!file || !text) throw new Error("Usage: mypuzzles-books watermark <file.pdf> <text> [out.pdf]");
  const stamped = await watermarkPdf(await readPdf(file), text);
  const target = out ?? join(dirname(resolve(file)), `${safeName(basename(file, extname(file)))}-watermarked.pdf`);
  await writeFile(target, stamped);
  banner("Watermarked copy written");
  console.log(`  ${target}`);
}

async function commandSelftest() {
  const sample = join(rootDir, "examples", "sample-bundle.json");
  const bundle = await loadBundle(sample);
  banner("Self test");
  const result = await renderBook(bundle);
  const verification = await verifyPdf(result.print);
  const answersPresent = result.pageMap.every((entry) => entry.answerPageIndex !== null);
  console.log(`  rendered ${result.pageCount} pages from ${bundle.puzzles.length} puzzles`);
  console.log(`  answer pages present for every puzzle: ${answersPresent}`);
  console.log(`  even page count: ${verification.info.evenPageCount}`);
  console.log(`  ${verification.pass && answersPresent ? "self test passed" : "self test FAILED"}`);
  if (!verification.pass || !answersPresent) process.exitCode = 1;
}

// --- Local studio -----------------------------------------------------------------

const contentTypeFor = (path) => {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".pdf")) return "application/pdf";
  if (path.endsWith(".json")) return "application/json";
  return "application/octet-stream";
};

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

async function commandServe([portArg]) {
  const port = Number(portArg ?? process.env.PORT ?? 4173);
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://localhost:${port}`);
    const sendJson = (status, payload) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(payload));
    };

    try {
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        const html = await readFile(join(rootDir, "public", "index.html"));
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(html);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/trim-sizes") {
        sendJson(200, { trimSizes: Object.entries(bookTrimSizes).map(([id, value]) => ({ id, label: value.label })) });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/render") {
        const body = await readBody(request);
        const payload = JSON.parse(body.toString("utf8") || "{}");
        const bundle = payload.bundle;
        if (!bundle?.puzzles?.length) throw new Error("The bundle has no puzzles.");
        if (payload.trimSize) bundle.trimSize = payload.trimSize;
        const result = await renderBook(bundle);
        const base = safeName(bundle.title ?? "book");
        const pack = await buildPrintPack(result.print, result.cover);
        globalThis.__studioArtifacts = globalThis.__studioArtifacts ?? new Map();
        globalThis.__studioArtifacts.set(`${base}-digital.pdf`, result.digital.toString("base64"));
        globalThis.__studioArtifacts.set(`${base}-print.pdf`, result.print.toString("base64"));
        globalThis.__studioArtifacts.set(`${base}-cover.pdf`, result.cover.toString("base64"));
        globalThis.__studioArtifacts.set(`${base}-print-pack.pdf`, pack.toString("base64"));
        sendJson(200, {
          pageCount: result.pageCount,
          summary: describeBundle(bundle),
          files: {
            digital: `/api/download?name=${base}-digital.pdf`,
            print: `/api/download?name=${base}-print.pdf`,
            cover: `/api/download?name=${base}-cover.pdf`,
            pack: `/api/download?name=${base}-print-pack.pdf`
          }
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/download") {
        const name = url.searchParams.get("name");
        const payload = globalThis.__studioArtifacts?.get(name);
        if (!payload) {
          sendJson(404, { error: "That file is no longer in memory. Render the book again." });
          return;
        }
        response.writeHead(200, { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"` });
        response.end(Buffer.from(payload, "base64"));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/inspect") {
        const body = await readBody(request);
        const payload = JSON.parse(body.toString("utf8") || "{}");
        const buffer = Buffer.from(payload.base64 ?? "", "base64");
        if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("That file is not a PDF.");
        const verification = await verifyPdf(buffer);
        sendJson(200, verification);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/pack") {
        const body = await readBody(request);
        const payload = JSON.parse(body.toString("utf8") || "{}");
        const interior = Buffer.from(payload.interior ?? "", "base64");
        const cover = payload.cover ? Buffer.from(payload.cover, "base64") : null;
        if (interior.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("The interior must be a PDF.");
        const packed = await buildPrintPack(interior, cover);
        const name = `${safeName(payload.title ?? "book")}-print-pack.pdf`;
        globalThis.__studioArtifacts = globalThis.__studioArtifacts ?? new Map();
        globalThis.__studioArtifacts.set(name, packed.toString("base64"));
        sendJson(200, { pageCount: (await inspectPdf(packed)).pageCount, file: `/api/download?name=${name}` });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/merge") {
        const body = await readBody(request);
        const payload = JSON.parse(body.toString("utf8") || "{}");
        const buffers = (payload.files ?? []).map((entry) => Buffer.from(entry, "base64"));
        if (buffers.length < 2) throw new Error("Choose at least two PDFs to merge.");
        const merged = await mergePdfs(buffers);
        const name = `${safeName(payload.title ?? "merged")}.pdf`;
        globalThis.__studioArtifacts = globalThis.__studioArtifacts ?? new Map();
        globalThis.__studioArtifacts.set(name, merged.toString("base64"));
        sendJson(200, { pageCount: (await inspectPdf(merged)).pageCount, file: `/api/download?name=${name}` });
        return;
      }

      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Not found" }));
    } catch (error) {
      sendJson(400, { error: error instanceof Error ? error.message : "Something went wrong." });
    }
  });

  // Artifacts stay in this process memory only, keyed by file name.
  globalThis.__studioArtifacts = globalThis.__studioArtifacts ?? new Map();

  server.listen(port, () => {
    banner("MyPuzzles Book Studio");
    console.log(`  Local studio:  http://localhost:${port}`);
    console.log(`  Data:          nothing leaves this machine`);
    console.log(`  Stop:          Ctrl+C`);
  });
}

const commands = {
  serve: commandServe,
  render: commandRender,
  inspect: commandInspect,
  verify: commandVerify,
  pack: commandPack,
  watermark: commandWatermark,
  selftest: commandSelftest
};

const [command = "help", ...args] = process.argv.slice(2);
if (command === "help" || !commands[command]) {
  console.log(`MyPuzzles Book Studio

  serve                                   open the local studio in a browser
  render <bundle.json> [outDir]           render screen, print and cover PDFs
  inspect <file.pdf>                      page size, page count, hash
  verify <file.pdf>                       print-readiness checks
  pack <interior.pdf> [cover.pdf] [out]   one file for the printer
  watermark <file.pdf> <text> [out.pdf]   stamp a copy
  selftest                                render the bundled example and check it
`);
  process.exit(command === "help" ? 0 : 1);
}

commands[command](args).catch((error) => {
  console.error(`\nError: ${error.message}`);
  process.exit(1);
});