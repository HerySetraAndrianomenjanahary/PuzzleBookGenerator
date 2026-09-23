/**
 * PDF helpers: inspect, verify, merge (print pack), watermark and text stamping.
 * Everything is local; nothing is sent anywhere.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

export async function readPdf(path) {
  const buffer = await readFile(path);
  if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error(`${path} is not a PDF file.`);
  return buffer;
}

export async function inspectPdf(buffer) {
  const doc = await PDFDocument.load(buffer, { updateMetadata: false });
  const pages = doc.getPages();
  const sizes = pages.map((page) => page.getSize());
  const first = sizes[0] ?? { width: 0, height: 0 };
  const uniform = sizes.every((size) => Math.abs(size.width - first.width) < 1 && Math.abs(size.height - first.height) < 1);
  return {
    pageCount: doc.getPageCount(),
    title: doc.getTitle() ?? null,
    author: doc.getAuthor() ?? null,
    producer: doc.getProducer() ?? null,
    bytes: buffer.length,
    sha256: sha256(buffer),
    pageSize: { width: Number(first.width.toFixed(2)), height: Number(first.height.toFixed(2)) },
    uniformPageSize: uniform,
    evenPageCount: doc.getPageCount() % 2 === 0
  };
}

/** Print-readiness checks a printer would care about. */
export async function verifyPdf(buffer) {
  const info = await inspectPdf(buffer);
  const checks = [
    { name: "Readable PDF", pass: true, detail: `${info.pageCount} pages` },
    { name: "Even page count", pass: info.evenPageCount, detail: info.evenPageCount ? "even" : "odd — a printer may add a blank page" },
    { name: "Uniform page size", pass: info.uniformPageSize, detail: info.uniformPageSize ? `${info.pageSize.width} x ${info.pageSize.height} pt` : "mixed page sizes" },
    { name: "Positive page count", pass: info.pageCount > 0, detail: String(info.pageCount) },
    { name: "Reasonable size", pass: info.bytes < 200 * 1024 * 1024, detail: `${(info.bytes / 1024 / 1024).toFixed(1)}MB` }
  ];
  return { info, checks, pass: checks.every((check) => check.pass) };
}

export async function mergePdfs(buffers) {
  const merged = await PDFDocument.create();
  for (const buffer of buffers) {
    const doc = await PDFDocument.load(buffer, { updateMetadata: false });
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  return Buffer.from(await merged.save());
}

/** One file for a printer: interior first, then the cover wrap. */
export async function buildPrintPack(interior, cover) {
  return cover ? mergePdfs([interior, cover]) : interior;
}

export async function watermarkPdf(buffer, text, { size = 6, opacity = 0.75 } = {}) {
  const doc = await PDFDocument.load(buffer);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const page of doc.getPages()) {
    page.drawText(text, { x: 20, y: 8, size, font, color: rgb(0.42, 0.42, 0.42), opacity });
  }
  return Buffer.from(await doc.save());
}

export const writePdf = (path, buffer) => writeFile(path, buffer);