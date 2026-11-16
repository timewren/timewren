import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { tr } from "@/i18n/server-text";
import { auth } from "@/lib/auth";
import { resolveActiveOrgId } from "@/lib/auth/active-org";
import { db } from "@/lib/db";
import {
  readFormDataWithLimit,
  SHARP_INPUT_OPTIONS,
} from "@/lib/upload/limits";
import {
  newTaskImageKey,
  ORG_ID_META,
  UPLOADED_BY_META,
  uploadToS3,
} from "@/lib/upload/s3";
import { rateLimiter, userRateLimitKey } from "@/lib/utils/rate-limiter";

const MAX_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  const formData = await readFormDataWithLimit(request, MAX_SIZE);
  if (!formData) {
    return NextResponse.json(
      { error: "File too large (max 10 MB)" },
      { status: 413 },
    );
  }
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Invalid file type" }, { status: 400 });
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: "File too large (max 10 MB)" },
      { status: 400 },
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const rawBuffer = Buffer.from(arrayBuffer);

  let buffer: Buffer;
  try {
    buffer = await sharp(rawBuffer, SHARP_INPUT_OPTIONS)
      .resize({ width: 1920, withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch {
    // Ulæseligt billede eller over pixelgrænsen
    return NextResponse.json(
      { error: await tr("serverErrors", "api.upload.invalidImage") },
      { status: 400 },
    );
  }

  // Billedet er privat. Uploader og org gemmes som S3-metadata, så
  // /api/files/task-image kan afgøre adgang uden at gætte på ejerskab.
  const orgId = await resolveActiveOrgId({
    db,
    userId: session.user.id,
    session: session as unknown as Record<string, unknown>,
  });
  const key = newTaskImageKey();

  const url = await uploadToS3(buffer, key, "image/jpeg", {
    [UPLOADED_BY_META]: session.user.id,
    ...(orgId ? { [ORG_ID_META]: orgId } : {}),
  });

  return NextResponse.json({
    url,
    fileName: file.name,
    sizeBytes: buffer.length,
    key,
  });
}
