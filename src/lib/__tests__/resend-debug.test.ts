import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("keeps raw Resend API errors out of the server log even in SDK debug mode", async () => {
  vi.stubEnv("MAIL_TRANSPORT", "resend");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("RESEND_DEBUG", "true");
  vi.stubEnv("DEMO_MODE", "");
  const recipient = "recipient@example.com";
  const providerError = {
    name: "validation_error",
    statusCode: 422,
    message: `Invalid recipient: ${recipient}`,
  };
  const fetchMock = vi.fn(async () =>
    Response.json(providerError, { status: 422 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});

  const { resend } = await import("@/lib/resend");
  const result = await resend.emails.send({
    from: "sender@example.com",
    to: recipient,
    subject: "Welcome",
    text: "Welcome",
  });

  expect(fetchMock).toHaveBeenCalledOnce();
  expect(result.error).toEqual(providerError);
  expect(log).not.toHaveBeenCalled();
});
