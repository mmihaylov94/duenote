import { config } from "../config.js";
import { readStoredMaterialBuffer } from "./materials.service.js";
import { PDFDocument } from "pdf-lib";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function parsePagesParam(raw) {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return [];
  const parts = s.split(",").map((x) => x.trim()).filter(Boolean);
  const out = new Set();
  for (const p of parts) {
    const m = p.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) continue;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      for (let k = lo; k <= hi; k += 1) out.add(k);
      continue;
    }
    const n = Number(p);
    if (Number.isFinite(n) && n > 0) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

export function pagesToParam(pages) {
  const list = Array.isArray(pages)
    ? [...new Set(pages.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b)
    : [];
  if (list.length === 0) return "";
  // Compact into ranges: 1-3,5,7-9
  const ranges = [];
  let start = list[0];
  let prev = list[0];
  for (let i = 1; i < list.length; i += 1) {
    const cur = list[i];
    if (cur === prev + 1) {
      prev = cur;
      continue;
    }
    ranges.push(start === prev ? String(start) : `${start}-${prev}`);
    start = cur;
    prev = cur;
  }
  ranges.push(start === prev ? String(start) : `${start}-${prev}`);
  return ranges.join(",");
}

function requireDocIntelConfigured() {
  if (!config.azureDocIntelEndpoint || !config.azureDocIntelKey) {
    const err = new Error(
      "OCR is not configured. Set AZURE_DOCINTEL_ENDPOINT and AZURE_DOCINTEL_KEY in backend .env.",
    );
    err.statusCode = 501;
    throw err;
  }
}

async function docIntelAnalyzeFromBuffer({ buffer, pages, contentType }) {
  requireDocIntelConfigured();
  const endpoint = config.azureDocIntelEndpoint;
  const pagesParam = pagesToParam(pages);
  const url =
    `${endpoint}/documentintelligence/documentModels/prebuilt-read:analyze` +
    `?api-version=2024-11-30` +
    (pagesParam ? `&pages=${encodeURIComponent(pagesParam)}` : "");

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": config.azureDocIntelKey,
      "Content-Type": contentType || "application/octet-stream",
      Accept: "application/json",
    },
    body: buffer,
  });

  if (r.status !== 202) {
    const detail = await r.text().catch(() => "");
    const err = new Error(`Document Intelligence analyze failed (HTTP ${r.status})`);
    err.statusCode = 502;
    err.detail = detail ? detail.slice(0, 500) : "";
    throw err;
  }
  const opLoc = r.headers.get("operation-location") || r.headers.get("Operation-Location") || "";
  if (!opLoc) {
    const err = new Error("Document Intelligence did not return Operation-Location.");
    err.statusCode = 502;
    throw err;
  }
  return opLoc;
}

async function pollAnalyzeResult(operationLocation, { timeoutMs = 120000 } = {}) {
  requireDocIntelConfigured();
  const start = Date.now();
  let delay = 800;
  while (Date.now() - start < timeoutMs) {
    const r = await fetch(operationLocation, {
      headers: {
        "Ocp-Apim-Subscription-Key": config.azureDocIntelKey,
      },
    });
    const j = await r.json().catch(() => null);
    const status = j?.status ? String(j.status).toLowerCase() : "";
    if (status === "succeeded") return j?.analyzeResult || j?.analyzeResult?.result || j?.analyzeResult || j;
    if (status === "failed") {
      const err = new Error("OCR failed.");
      err.statusCode = 502;
      err.detail = j?.error || j?.errors || null;
      throw err;
    }
    await sleep(delay);
    delay = Math.min(5000, Math.floor(delay * 1.35));
  }
  const err = new Error("OCR timed out.");
  err.statusCode = 504;
  throw err;
}

function pickPageShape(p) {
  if (!p) return null;
  const pageNumber = Number(p.pageNumber ?? p.page_number);
  if (!Number.isFinite(pageNumber) || pageNumber <= 0) return null;
  const width = p.width != null ? Number(p.width) : null;
  const height = p.height != null ? Number(p.height) : null;
  const unit = typeof p.unit === "string" ? p.unit : null;
  const lines = Array.isArray(p.lines) ? p.lines : [];
  const words = Array.isArray(p.words) ? p.words : [];
  return {
    pageNumber,
    width: Number.isFinite(width) ? width : null,
    height: Number.isFinite(height) ? height : null,
    unit,
    lines,
    words,
  };
}

async function extractSinglePagePdfBuffer(pdfDoc, pageIndex0) {
  const out = await PDFDocument.create();
  const [copied] = await out.copyPages(pdfDoc, [pageIndex0]);
  out.addPage(copied);
  return Buffer.from(await out.save());
}

export async function analyzeMaterialWithReadModel({ material, pages }) {
  // `material` comes from materials.repository: includes storage + storageKey + mimeType.
  const buf = await readStoredMaterialBuffer({
    storage: material.storage,
    storageKey: material.storageKey,
  });
  if (!buf) {
    const err = new Error("Material file missing.");
    err.statusCode = 404;
    throw err;
  }

  const ctRaw = typeof material?.mimeType === "string" ? material.mimeType.trim().toLowerCase() : "";
  const isPdf = ctRaw.includes("pdf") || String(material?.title || "").toLowerCase().endsWith(".pdf");

  // Document Intelligence rejects large PDFs even when `pages=` is specified, because the entire
  // file bytes are still sent. To avoid the size limit, analyze PDF pages individually by sending
  // a single-page PDF per request, then map results back to original page numbers.
  if (isPdf) {
    const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
    const total = doc.getPageCount();
    const out = [];
    for (const p of pages || []) {
      const pageNumber = Number(p);
      if (!Number.isFinite(pageNumber) || pageNumber <= 0 || pageNumber > total) continue;
      const singleBuf = await extractSinglePagePdfBuffer(doc, pageNumber - 1);
      const opLoc = await docIntelAnalyzeFromBuffer({
        buffer: singleBuf,
        pages: null,
        contentType: "application/pdf",
      });
      const result = await pollAnalyzeResult(opLoc);
      const pagesRaw = Array.isArray(result?.pages)
        ? result.pages
        : Array.isArray(result?.analyzeResult?.pages)
          ? result.analyzeResult.pages
          : [];
      const shaped = pagesRaw.map(pickPageShape).filter(Boolean);
      const first = shaped[0];
      if (!first) continue;
      out.push({
        pageNumber,
        width: first.width,
        height: first.height,
        unit: first.unit,
        lines: first.lines,
        words: first.words,
      });
    }
    return out;
  }

  // Non-PDF (image/etc): send buffer once with pages param.
  const contentType = ctRaw || "application/octet-stream";
  const opLoc = await docIntelAnalyzeFromBuffer({ buffer: buf, pages, contentType });
  const result = await pollAnalyzeResult(opLoc);
  const pagesRaw = Array.isArray(result?.pages)
    ? result.pages
    : Array.isArray(result?.analyzeResult?.pages)
      ? result.analyzeResult.pages
      : [];
  return pagesRaw.map(pickPageShape).filter(Boolean);
}

