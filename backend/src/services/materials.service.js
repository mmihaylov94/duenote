import { mkdir, writeFile, unlink, stat, readFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { config } from "../config.js";
import { createS3Client, isS3Configured } from "./s3.storage.js";

function resolvedMaterialsDir() {
  const d = config.materialsLocalDir;
  if (path.isAbsolute(d)) return d;
  return path.resolve(process.cwd(), d);
}

function safeFilename(name) {
  return String(name || "file")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 120) || "file";
}

function extensionFromName(name) {
  const ext = path.extname(String(name || "")).toLowerCase();
  if (!ext || ext.length > 10) return "";
  return ext;
}

function s3ObjectKey(courseId, materialId, originalName) {
  const p = config.s3KeyPrefix ? `${config.s3KeyPrefix}/` : "";
  const ext = extensionFromName(originalName);
  return `${p}materials/course-${courseId}/material-${materialId}${ext}`;
}

function localRelativeKey(courseId, materialId, originalName) {
  const ext = extensionFromName(originalName);
  return path.join(`course-${courseId}`, `material-${materialId}${ext}`);
}

export async function storeMaterial({ courseId, materialId, buffer, mimeType, originalName }) {
  const cid = Number(courseId);
  const mid = Number(materialId);
  if (!Number.isFinite(cid) || !Number.isFinite(mid)) {
    const err = new Error("Invalid id");
    err.statusCode = 400;
    throw err;
  }

  if (isS3Configured()) {
    const key = s3ObjectKey(cid, mid, originalName);
    const client = createS3Client();
    await client.send(
      new PutObjectCommand({
        Bucket: config.s3Bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType || "application/octet-stream",
        CacheControl: "private, max-age=0",
      }),
    );
    return { storage: "s3", storageKey: key };
  }

  const rel = localRelativeKey(cid, mid, originalName);
  const absDir = path.join(resolvedMaterialsDir(), `course-${cid}`);
  await mkdir(absDir, { recursive: true });
  const absPath = path.join(resolvedMaterialsDir(), rel);
  await writeFile(absPath, buffer);
  return { storage: "local", storageKey: rel };
}

export async function deleteStoredMaterial({ storage, storageKey }) {
  const st = String(storage || "");
  const key = String(storageKey || "");
  if (!key) return;

  if (st === "s3") {
    if (!isS3Configured()) return;
    const client = createS3Client();
    try {
      await client.send(
        new DeleteObjectCommand({
          Bucket: config.s3Bucket,
          Key: key,
        }),
      );
    } catch {
      /* ignore */
    }
    return;
  }

  const absPath = path.join(resolvedMaterialsDir(), key);
  try {
    await unlink(absPath);
  } catch {
    /* ignore */
  }
}

export async function streamStoredMaterialToResponse({ storage, storageKey, mimeType, filename }, res) {
  const st = String(storage || "");
  const key = String(storageKey || "");
  const name = safeFilename(filename || "material");

  res.setHeader("Content-Type", mimeType || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.setHeader("Cache-Control", "private, max-age=0");

  if (st === "s3") {
    if (!isS3Configured()) return false;
    const client = createS3Client();
    const out = await client.send(
      new GetObjectCommand({
        Bucket: config.s3Bucket,
        Key: key,
      }),
    );
    if (!out?.Body) return false;
    // Body is a readable stream in Node runtime.
    await pipeline(out.Body, res);
    return true;
  }

  const absPath = path.join(resolvedMaterialsDir(), key);
  if (!existsSync(absPath)) return false;
  const stInfo = await stat(absPath).catch(() => null);
  if (!stInfo) return false;
  res.setHeader("Content-Length", String(stInfo.size));
  await pipeline(createReadStream(absPath), res);
  return true;
}

/** Full file buffer for metadata (e.g. page count); null if missing. */
export async function readStoredMaterialBuffer({ storage, storageKey }) {
  const st = String(storage || "");
  const key = String(storageKey || "");
  if (!key) return null;

  if (st === "s3") {
    if (!isS3Configured()) return null;
    const client = createS3Client();
    const out = await client.send(
      new GetObjectCommand({
        Bucket: config.s3Bucket,
        Key: key,
      }),
    );
    if (!out?.Body) return null;
    return Buffer.from(await out.Body.transformToByteArray());
  }

  const absPath = path.join(resolvedMaterialsDir(), key);
  if (!existsSync(absPath)) return null;
  return readFile(absPath);
}

