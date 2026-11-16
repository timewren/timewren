import { tr } from "@/i18n/server-text";
/**
 * HTTP-endpointet bag feedback-panelet (bugbottle/ui).
 *
 * bugbottles panel kræver en URL, ikke en tRPC-mutation, så denne rute er en
 * tynd adapter: `parseBugbottleReport` validerer med bugbottles egne
 * server-validatorer og oversætter rapporttypen til TimeTracks, og ruten kalder
 * den samme `submitFeedback` som `feedback.submit` bruger.
 */

import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resolveActiveOrgId } from "@/lib/auth/active-org";
import { db } from "@/lib/db";
import { parseBugbottleReport } from "@/lib/feedback/report";
import { FeedbackSubmitError, submitFeedback } from "@/lib/feedback/submit";
import { FEEDBACK_USER_HEADER } from "@/lib/feedback/types";

/**
 * Største body vi overhovedet læser. Screenshottet er kappet til 2 MB binært
 * (~2,8 MB base64) i `feedbackSubmitSchema`, og resten af rapporten er små
 * strenge — 4 MB er rigeligt og holder en ondsindet body ude af hukommelsen.
 * Next har ingen default-grænse for route handlers, og `middleware.ts`
 * undtager `/api/`, så grænsen skal stå her.
 */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: await tr("serverErrors", "api.feedback.notSignedIn") },
      { status: 401 },
    );
  }

  // Skrevet af en anden bruger end den, der er logget ind nu (en rapport fra
  // offline-køen efter brugerskift): afvis med et 4xx, så køen smider den ud
  // i stedet for at gemme den under den forkerte konto.
  const reporter = request.headers.get(FEEDBACK_USER_HEADER);
  if (reporter && reporter !== session.user.id) {
    return NextResponse.json(
      { error: await tr("serverErrors", "api.feedback.otherUser") },
      { status: 409 },
    );
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: await tr("serverErrors", "api.feedback.tooLarge") },
      { status: 413 },
    );
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return NextResponse.json(
      { error: await tr("serverErrors", "api.feedback.invalid") },
      { status: 400 },
    );
  }
  // Content-Length mangler på en chunked body, så den rigtige størrelse måles her
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: await tr("serverErrors", "api.feedback.tooLarge") },
      { status: 413 },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { error: await tr("serverErrors", "api.invalidJson") },
      { status: 400 },
    );
  }
  const parsed = parseBugbottleReport(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const orgId = await resolveActiveOrgId({
    db,
    userId: session.user.id,
    session: session as unknown as Record<string, unknown>,
  });

  try {
    const result = await submitFeedback({
      db,
      user: session.user,
      orgId,
      input: parsed.input,
    });
    // Samme svar som bugbottles `handleReport`: 201 `{ id }`. Panelet læser
    // `id` og viser det i bekræftelsen som rapport-nummer.
    return NextResponse.json({ id: result.id }, { status: 201 });
  } catch (err) {
    if (err instanceof FeedbackSubmitError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.code === "RATE_LIMITED" ? 429 : 400 },
      );
    }
    console.error("[Feedback] Indsendelse fejlede:", err);
    return NextResponse.json(
      { error: await tr("serverErrors", "api.feedback.saveFailed") },
      { status: 500 },
    );
  }
}
