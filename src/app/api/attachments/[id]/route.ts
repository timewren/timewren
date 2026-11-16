import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { taskAttachments } from "@/lib/db/schema";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const attachment = await db.query.taskAttachments.findFirst({
    where: and(
      eq(taskAttachments.id, id),
      eq(taskAttachments.userId, session.user.id),
    ),
  });

  if (!attachment) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!attachment.content) {
    // If content is stored externally (storageUrl), redirect or return error
    if (attachment.storageUrl) {
      // storageUrl er en relativ app-URL (/api/files/task-image/...), og
      // NextResponse.redirect kræver en absolut URL. Location må gerne være
      // relativ, og det undgår at gætte værtsnavnet bag proxyen.
      return new NextResponse(null, {
        status: 307,
        headers: { Location: attachment.storageUrl },
      });
    }
    return NextResponse.json(
      { error: "Attachment content not available" },
      { status: 404 },
    );
  }

  return new NextResponse(new Uint8Array(attachment.content), {
    headers: {
      "Content-Type": attachment.contentType,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(attachment.filename)}"`,
      "Content-Length": String(attachment.sizeBytes),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
