import { PutObjectCommand } from "@aws-sdk/client-s3";
import { type NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { tr } from "@/i18n/server-text";
import { auth } from "@/lib/auth";
import { getPublicUrl, prefixKey, S3_BUCKET, s3 } from "@/lib/s3";
import { isStorageConfigured } from "@/lib/storage/config";
import {
  readFormDataWithLimit,
  SHARP_INPUT_OPTIONS,
} from "@/lib/upload/limits";
import { rateLimiter, userRateLimitKey } from "@/lib/utils/rate-limiter";

const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8 MB (images are optimized before storage)
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

const VALID_FOLDERS = new Set(["profile", "logos", "uploads", "favicons"]);

/** Max dimensions per folder type */
const FOLDER_MAX_SIZES: Record<string, { width: number; height: number }> = {
  profile: { width: 256, height: 256 },
  logos: { width: 400, height: 400 },
  uploads: { width: 1200, height: 1200 },
  favicons: { width: 64, height: 64 },
};

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: await tr("serverErrors", "api.upload.notAuthorized") },
      { status: 401 },
    );
  }

  const rate = await rateLimiter.check(
    userRateLimitKey(session.user.id, "upload"),
    "upload",
  );
  if (!rate.allowed) {
    return NextResponse.json(
      { error: await tr("serverErrors", "api.tooManyRequestsLater") },
      { status: 429 },
    );
  }

  const formData = await readFormDataWithLimit(request, MAX_FILE_SIZE);
  if (!formData) {
    return NextResponse.json(
      { error: await tr("serverErrors", "api.upload.tooBig") },
      { status: 413 },
    );
  }
  const file = formData.get("file") as File | null;
  const rawFolder = (formData.get("folder") as string) || "uploads";
  const folder = VALID_FOLDERS.has(rawFolder) ? rawFolder : "uploads";

  if (!file) {
    return NextResponse.json(
      { error: await tr("serverErrors", "api.upload.noFile") },
      { status: 400 },
    );
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: await tr("serverErrors", "api.upload.imageTypes") },
      { status: 400 },
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: await tr("serverErrors", "api.upload.tooBig") },
      { status: 400 },
    );
  }

  if (!isStorageConfigured()) {
    return NextResponse.json(
      {
        error: await tr("serverErrors", "api.upload.notConfigured"),
      },
      { status: 503 },
    );
  }

  const rawBuffer = Buffer.from(await file.arrayBuffer());

  const maxSize = FOLDER_MAX_SIZES[folder] || FOLDER_MAX_SIZES.uploads;

  let optimizedBuffer: Buffer;
  try {
    optimizedBuffer = await sharp(rawBuffer, SHARP_INPUT_OPTIONS)
      .resize(maxSize.width, maxSize.height, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    // Ulæseligt billede eller over pixelgrænsen
    return NextResponse.json(
      { error: await tr("serverErrors", "api.upload.invalidImage") },
      { status: 400 },
    );
  }

  const contentType = "image/webp";
  const fileExt = "webp";

  const key = `${folder}/${session.user.id}/${Date.now()}.${fileExt}`;

  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: prefixKey(key),
        Body: optimizedBuffer,
        ContentType: contentType,
        ACL: "public-read",
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
  } catch (error) {
    console.error("[Upload] S3 error:", error);
    return NextResponse.json(
      { error: await tr("serverErrors", "api.upload.failed") },
      { status: 500 },
    );
  }

  const url = getPublicUrl(key);

  return NextResponse.json({ url });
}
