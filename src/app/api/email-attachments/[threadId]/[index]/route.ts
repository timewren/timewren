import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { emailThreads } from "@/lib/db/schema";
import { locateEmailAttachment } from "@/lib/email/attachment-location";
import { getObjectStream } from "@/lib/storage/objects";

const ATTACHMENT_DIR =
  process.env.EMAIL_ATTACHMENT_DIR || "storage/email-attachments";

function sanitizeHeaderFilename(filename: string): string {
  const trimmed = filename?.trim();
  if (!trimmed) return "attachment";

  return trimmed
    .replace(/[\r\n"]/g, "")
    .replace(/[^\x20-\x7E]/g, "_")
    .slice(0, 120);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string; index: string }> },
) {
  const { threadId, index } = await params;
  const attachmentIndex = Number(index);

  if (!Number.isFinite(attachmentIndex) || attachmentIndex < 0) {
    return NextResponse.json(
      { error: "Invalid attachment index" },
      { status: 400 },
    );
  }

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const thread = await db.query.emailThreads.findFirst({
    where: eq(emailThreads.id, threadId),
  });

  if (!thread || thread.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const attachments = thread.attachments || [];
  const attachment = attachments[attachmentIndex];

  if (!attachment?.storagePath) {
    return NextResponse.json(
      { error: "Attachment not available" },
      { status: 404 },
    );
  }

  // Ejerskabet af tråden er afgjort ovenfor, før noget læses fra S3 eller disk.
  const location = locateEmailAttachment(attachment.storagePath);
  if (location.kind === "invalid") {
    return NextResponse.json(
      { error: "Invalid attachment path" },
      { status: 400 },
    );
  }
  if (location.kind === "s3") {
    try {
      const object = await getObjectStream(location.key);
      if (!object) {
        return NextResponse.json(
          { error: "Attachment not found" },
          { status: 404 },
        );
      }
      const safeFilename = sanitizeHeaderFilename(attachment.filename || "");
      const headers: Record<string, string> = {
        "Content-Type": attachment.contentType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safeFilename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      };
      if (object.contentLength !== undefined) {
        headers["Content-Length"] = String(object.contentLength);
      }
      return new NextResponse(object.stream, { status: 200, headers });
    } catch (error) {
      console.error("Failed to read attachment from storage", error);
      return NextResponse.json(
        { error: "Attachment not found" },
        { status: 404 },
      );
    }
  }

  const resolvedBase = path.resolve(/* turbopackIgnore: true */ ATTACHMENT_DIR);
  const resolvedPath = path.resolve(
    /* turbopackIgnore: true */ attachment.storagePath,
  );

  // + path.sep: uden separator-grænsen ville en søster-mappe med samme
  // prefix (fx /data/attachments-evil) passere checket.
  if (!resolvedPath.startsWith(resolvedBase + path.sep)) {
    return NextResponse.json(
      { error: "Invalid attachment path" },
      { status: 400 },
    );
  }

  try {
    const fileStat = await stat(resolvedPath);
    const fileBuffer = await readFile(resolvedPath);
    const safeFilename = sanitizeHeaderFilename(attachment.filename || "");

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": attachment.contentType || "application/octet-stream",
        "Content-Length": fileStat.size.toString(),
        "Content-Disposition": `attachment; filename="${safeFilename}"`,
      },
    });
  } catch (error) {
    console.error("Failed to read attachment", error);
    return NextResponse.json(
      { error: "Attachment not found" },
      { status: 404 },
    );
  }
}
