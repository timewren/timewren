import { type NextRequest, NextResponse } from "next/server";
import { prefixKey } from "@/lib/s3";
import { getStorageDriver } from "@/lib/storage/config";
import { getObjectStream } from "@/lib/storage/objects";

/**
 * Serverer offentlige uploads (avatarer, logoer, favicons) når lageret er
 * lokalt (STORAGE_DRIVER=local). Med S3 ligger de offentligt i bucketen, så
 * ruten svarer 404 dér. Kun præcis det mønster, `/api/upload` skriver.
 */
const PUBLIC_KEY_RE =
  /^(?:logos|favicons|profile|uploads)\/[A-Za-z0-9_-]{1,64}\/\d{1,16}\.webp$/;

const NOT_FOUND = () =>
  NextResponse.json({ error: "Not found" }, { status: 404 });

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  if (getStorageDriver() !== "local") return NOT_FOUND();

  const { path } = await params;
  const key = (path ?? []).join("/");
  if (!PUBLIC_KEY_RE.test(key)) return NOT_FOUND();

  try {
    const object = await getObjectStream(prefixKey(key));
    if (!object) return NOT_FOUND();

    const headers: Record<string, string> = {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    };
    if (object.contentLength !== undefined) {
      headers["Content-Length"] = String(object.contentLength);
    }
    return new NextResponse(object.stream, { status: 200, headers });
  } catch (error) {
    console.error("[Files] Kunne ikke læse offentlig fil:", error);
    return NextResponse.json({ error: "Could not read file" }, { status: 500 });
  }
}
