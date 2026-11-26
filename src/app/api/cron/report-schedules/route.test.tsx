import ExcelJS from "exceljs";
import { afterEach, expect, it, vi } from "vitest";
import { resolveSharedLocale } from "@/i18n/shared-text";
import { activeDemoCurrency } from "@/lib/demo/demo-mode";
import { reportTemplateConfigSchema } from "@/lib/reports/config-schema";
import { copenhagenToday } from "@/lib/time/copenhagen";
import { GET } from "./route";

const state = vi.hoisted(() => ({
  schedules: [] as unknown[],
  ownerLocale: "da",
  aggregate: vi.fn(
    (_entries: unknown, _grouping: unknown, _options: unknown) => ({
      summary: { totalHours: 0 },
      groups: [],
    }),
  ),
  ownerEmail: "demo-eur-owner@demo.invalid",
  send: vi.fn(async (_mail: { attachments: { content: Buffer }[] }) => ({
    error: null,
  })),
  render: vi.fn(async () => Buffer.from("PDF")),
}));

vi.mock("@/lib/cron/log-cron-run", () => ({
  withCronLogging: (_name: string, run: unknown) => run,
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({ where: async () => state.schedules }),
      }),
    }),
    query: {
      users: { findFirst: async () => ({ email: state.ownerEmail }) },
      companyProfiles: { findFirst: async () => undefined },
    },
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  },
}));
vi.mock("@/lib/reports/query", () => ({
  loadReportEntries: async () => [],
  aggregateReport: state.aggregate,
}));
vi.mock("@/lib/email/mail-brand", () => ({
  resolveMailBrand: async () => null,
}));
vi.mock("@/lib/email/recipient-locale", () => ({
  getRecipientLocale: async () => state.ownerLocale,
}));
vi.mock("@/lib/resend", () => ({
  DEFAULT_FROM_EMAIL: "sender@example.invalid",
  resend: { emails: { send: state.send } },
}));
vi.mock("@react-pdf/renderer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@react-pdf/renderer")>()),
  renderToBuffer: () => state.render(),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it.each([
  ["1", "demo-eur-owner@demo.invalid", "EUR", "en"],
  ["1", "demo-legacy@demo.invalid", "DKK", "da"],
  ["0", "demo-eur-owner@demo.invalid", "DKK", "da"],
])(
  "uses the schedule owner's currency with DEMO_MODE=%s for %s",
  async (mode, email, currency, locale) => {
    vi.stubEnv("DEMO_MODE", mode);
    state.ownerEmail = email;
    state.ownerLocale = locale;
    state.schedules = ["pdf", "csv", "xlsx"].map((format) => ({
      id: format,
      userId: "owner",
      frequency: "monthly",
      sendDay: Number(copenhagenToday().slice(8, 10)),
      format,
      templateName: "Report",
      recipients: ["recipient@example.invalid"],
      config: reportTemplateConfigSchema.parse({
        columns: ["value"],
        filters: {},
        branding: {},
      }),
    }));
    const renderCurrencies: string[] = [];
    const renderLocales: string[] = [];
    state.render.mockImplementation(async () => {
      await Promise.resolve();
      renderCurrencies.push(activeDemoCurrency());
      renderLocales.push(resolveSharedLocale());
      return Buffer.from("PDF");
    });

    const result = await GET(
      new Request("http://localhost/api/cron/report-schedules"),
    );
    expect(result).toMatchObject({ itemsSucceeded: 3 });
    expect(renderCurrencies).toEqual([currency]);
    expect(renderLocales).toEqual([locale]);
    expect(state.aggregate.mock.calls.map(([, , options]) => options)).toEqual(
      Array.from({ length: 3 }, () => expect.objectContaining({ locale })),
    );

    const [, csv, xlsx] = state.send.mock.calls.map(
      ([mail]) => mail.attachments[0].content,
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(xlsx).buffer);
    const workbookHeader = workbook.worksheets[0].getCell("A1").text;
    expect(csv.toString().trim()).toBe(workbookHeader);
    expect(workbookHeader).toBe(locale === "en" ? "Value (EUR)" : "Værdi");
  },
);
