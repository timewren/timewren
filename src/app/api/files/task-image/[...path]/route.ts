import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resolveActiveOrgId } from "@/lib/auth/active-org";
import { db } from "@/lib/db";
import { prefixKey } from "@/lib/s3";
import { isStorageConfigured } from "@/lib/storage/config";
import { getObjectStream, headObject } from "@/lib/storage/objects";
import { taskImageKeyFromSegments } from "@/lib/upload/s3";
import { canReadTaskImage } from "@/lib/upload/task-image-access";

/**
 * Streamer private opgave- og kommentarbilleder gennem appen.
 *
 * Billederne ligger uden ACL i S3; denne rute er den eneste vej til dem.
 * Alle afvisninger efter login er 404, så ruten ikke afslører om en nøgle
 * findes i en anden org.
 */

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

const NOT_FOUND = () =>
  NextResponse.json({ error: "Not found" }, { status: 404 });

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const { path } = await params;
  const key = taskImageKeyFromSegments(path ?? []);
  if (!key) {
    return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
  }

  if (!isStorageConfigured()) {
    return NextResponse.json(
      { error: "File storage is not configured" },
      { status: 503 },
    );
  }

  try {
    const objectKey = prefixKey(key);

    // Metadata først: adgangstjekket afgøres af den, og kroppen hentes først
    // når brugeren må se billedet.
    const head = await headObject(objectKey);
    if (!head) return NOT_FOUND();

    const requesterOrgId = await resolveActiveOrgId({
      db,
      userId,
      session: session as unknown as Record<string, unknown>,
    });

    const allowed = await canReadTaskImage({
      db,
      userId,
      requesterOrgId,
      key,
      metadata: head.metadata,
    });
    if (!allowed) return NOT_FOUND();

    const object = await getObjectStream(objectKey);
    if (!object) return NOT_FOUND();

    // Content-Type udledes af den validerede filendelse, ikke af hvad
    // objektet påstår, så en fil aldrig kan serveres som html.
    const ext = key.slice(key.lastIndexOf(".") + 1);
    const headers: Record<string, string> = {
      "Content-Type": CONTENT_TYPE_BY_EXT[ext] ?? "application/octet-stream",
      "Content-Disposition": `inline; filename="image.${ext}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    };
    if (object.contentLength !== undefined) {
      headers["Content-Length"] = String(object.contentLength);
    }

    return new NextResponse(object.stream, { status: 200, headers });
  } catch (error) {
    console.error("[Files] Kunne ikke læse task-image:", error);
    return NextResponse.json({ error: "Could not read file" }, { status: 500 });
  }
}
