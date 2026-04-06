import { mkdir, readdir, unlink, writeFile, stat } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { config } from "../config.js";

const MIME_TO_EXT = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

function resolvedAvatarDir() {
  const d = config.avatarLocalDir;
  if (path.isAbsolute(d)) return d;
  return path.resolve(process.cwd(), d);
}

export function isS3Configured() {
  return Boolean(config.s3Bucket && config.s3Region);
}

export function extForMime(mime) {
  return MIME_TO_EXT[mime] || null;
}

function s3Client() {
  const opts = { region: config.s3Region };
  if (config.awsAccessKeyId && config.awsSecretAccessKey) {
    opts.credentials = {
      accessKeyId: config.awsAccessKeyId,
      secretAccessKey: config.awsSecretAccessKey,
    };
  }
  return new S3Client(opts);
}

/** Stable object key per user (overwrite on each upload). */
function s3ObjectKey(userId) {
  const p = config.s3KeyPrefix ? `${config.s3KeyPrefix}/` : "";
  return `${p}avatars/user-${userId}`;
}

export async function removeLocalAvatarFiles(userId) {
  const dir = resolvedAvatarDir();
  if (!existsSync(dir)) return;
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  const prefix = `${userId}.`;
  await Promise.all(
    names
      .filter((n) => n.startsWith(prefix))
      .map((n) => unlink(path.join(dir, n)).catch(() => {})),
  );
}

/**
 * @param {number} userId
 * @returns {Promise<string | null>} absolute filesystem path
 */
export async function findLocalAvatarPath(userId) {
  const dir = resolvedAvatarDir();
  if (!existsSync(dir)) return null;
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }
  const prefix = `${userId}.`;
  const name = names.find((n) => n.startsWith(prefix));
  if (!name) return null;
  return path.join(dir, name);
}

/**
 * Save buffer to local disk or S3; returns public URL to store in `users.avatar_url`.
 */
export async function storeUploadedAvatar(userId, buffer, mime) {
  const ext = extForMime(mime);
  if (!ext) {
    const err = new Error("Unsupported image type");
    err.statusCode = 400;
    throw err;
  }

  if (isS3Configured()) {
    await deleteStoredAvatar(userId);
    const key = s3ObjectKey(userId);
    const client = s3Client();
    await client.send(
      new PutObjectCommand({
        Bucket: config.s3Bucket,
        Key: key,
        Body: buffer,
        ContentType: mime,
        CacheControl: "public, max-age=31536000",
      }),
    );
    const v = Date.now();
    if (config.s3PublicBaseUrl) {
      return `${config.s3PublicBaseUrl}/${key}?v=${v}`;
    }
    return `https://${config.s3Bucket}.s3.${config.s3Region}.amazonaws.com/${key}?v=${v}`;
  }

  await mkdir(resolvedAvatarDir(), { recursive: true });
  await removeLocalAvatarFiles(userId);
  const filename = `${userId}${ext}`;
  const filepath = path.join(resolvedAvatarDir(), filename);
  await writeFile(filepath, buffer);
  const v = Date.now();
  return `${config.publicApiUrl}/api/media/avatars/${userId}?v=${v}`;
}

export async function removeS3Avatar(userId) {
  if (!isS3Configured()) return;
  const client = s3Client();
  const key = s3ObjectKey(userId);
  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: config.s3Bucket,
        Key: key,
      }),
    );
  } catch {
    /* no object or permission - ignore */
  }
}

/**
 * Remove uploaded avatar (local files and/or S3 object). Does not clear DB.
 * Safe when the user previously had only an external URL (e.g. Google).
 */
export async function deleteStoredAvatar(userId) {
  await removeLocalAvatarFiles(userId);
  if (isS3Configured()) {
    await removeS3Avatar(userId);
  }
}

export function mimeForPath(filepath) {
  const ext = path.extname(filepath).toLowerCase();
  const map = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
  };
  return map[ext] || "application/octet-stream";
}

export async function streamLocalAvatarToResponse(userId, res) {
  const filepath = await findLocalAvatarPath(userId);
  if (!filepath || !existsSync(filepath)) {
    return false;
  }
  const st = await stat(filepath);
  res.setHeader("Content-Type", mimeForPath(filepath));
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.setHeader("Content-Length", String(st.size));
  await pipeline(createReadStream(filepath), res);
  return true;
}
