/**
 * Dinero API Integration
 * Documentation: https://api.dinero.dk/docs
 */

import { syncT } from "@/i18n/sync-text";
import { BaseIntegration, fetchWithTimeout } from "./base";

// Source: Dinero swagger ContactCreateModel.
// Required: CountryKey, IsMember, IsPerson, Name, UseCvr.
export interface DineroContact {
  contactGuid?: string;
  name: string;
  street?: string;
  zipCode?: string;
  city?: string;
  countryKey: string; // required — "DK", "GB", etc.
  phone?: string;
  email?: string;
  webpage?: string;
  attPerson?: string;
  vatNumber?: string; // CVR number
  ean?: string;
  isPerson: boolean;
  isMember: boolean; // required — association membership, false for businesses
  useCvr: boolean; // required — true when vatNumber is a Danish CVR
  paymentConditionType?: "Netto" | "NettoCash" | "CurrentMonthOut" | "Paid";
  paymentConditionNumberOfDays?: number;
}

// Source: Dinero swagger EntryAccountReadModel.
// GET /v1/{orgId}/accounts/entry returns the organization's chart of accounts.
export interface DineroAccount {
  accountNumber: number;
  name: string;
  description?: string;
  // Legacy derived type (income/expense/…). Populated for back-compat; for
  // new code, trust `category` and `vatCode` from Dinero.
  accountType: "income" | "expense" | "asset" | "liability" | "equity";
  isActive: boolean;
  // Category names exactly as Dinero returns them. "Turnover" = revenue
  // accounts valid for invoice lines.
  category?:
    | "Turnover"
    | "Variable Expenses"
    | "Salary"
    | "Sales Expenses"
    | "Property Expenses"
    | "Administration Expenses"
    | "Travel Expenses"
    | "Depreciation"
    | "Interest Income"
    | "Interest Expenses"
    | "Property"
    | "Turnover Assets"
    | "Financial Assets"
    | "Receivables"
    | "Liquid Assets"
    | "Equity"
    | "Long Term Debt"
    | "Short Term Debt"
    | "Vat Due"
    | "Salary Due"
    | "Analysis"
    | "Not Set"
    | "Tax"
    | "Charge"
    | "IntangibleProperty";
  categoryName?: string; // Danish display name
  vatCode?: string; // e.g. "U25" (sales 25%) or "I25" (purchase 25%)
  isHidden?: boolean;
  isDefaultSalesAccount?: boolean;
}

export interface DineroInvoice {
  guid?: string;
  timestamp?: string; // concurrency token returned by Dinero, needed for book/email
  number?: number;
  contactGuid: string;
  currency: string;
  language: string;
  externalReference?: string;
  description?: string;
  comment?: string;
  date: string;
  paymentDate?: string;
  productLines: DineroProductLine[];
  status?:
    | "Draft"
    | "Booked"
    | "Sent"
    | "Paid"
    | "PartiallyPaid"
    | "Credited"
    | "Cancelled";
  totalExclVat?: number;
  totalInclVat?: number;
  remainingAmount?: number;
}

// Source: Dinero swagger InvoiceLinesCreateModel
// https://api.dinero.dk/openapi/v1/swagger.json
export type DineroLineUnit =
  | "hours"
  | "parts"
  | "km"
  | "day"
  | "week"
  | "month"
  | "kilogram"
  | "cubicMetre"
  | "set"
  | "litre"
  | "box"
  | "case"
  | "carton"
  | "metre"
  | "package"
  | "shipment"
  | "squareMetre"
  | "session"
  | "tonne";

export interface DineroProductLine {
  // Required by Dinero API: AccountNumber, BaseAmountValue, Discount, Quantity.
  description: string;
  comments?: string;
  quantity: number;
  unit?: DineroLineUnit;
  baseAmountValue: number;
  discount: number; // 0-100, percentage. Required — send 0 when no discount.
  taxAmount?: number;
  totalAmount?: number;
  accountNumber?: number;
  lineType?: "Product" | "Text";
  productGuid?: string;
}

export interface DineroProduct {
  productGuid: string;
  name: string;
  productNumber: string | null;
  baseAmountValue: number;
  accountNumber: number | null;
  unit: DineroLineUnit | null;
  externalReference: string | null;
  comment: string | null;
}

export class DineroIntegration extends BaseIntegration {
  protected integrationName = "Dinero";
  private apiKey: string;
  private organizationId: string;
  private baseUrl = "https://api.dinero.dk/v1";

  constructor(apiKey: string, organizationId: string) {
    super();
    if (!apiKey) {
      throw new Error(syncT("integrations.dinero.keyRequired"));
    }
    if (!organizationId) {
      throw new Error(syncT("integrations.dinero.orgIdRequired"));
    }
    this.apiKey = apiKey;
    this.organizationId = organizationId;
  }

  updateApiKey(newKey: string): void {
    this.apiKey = newKey;
  }

  /**
   * Test connection to Dinero API
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await fetchWithTimeout(
        `${this.baseUrl}/${this.organizationId}/contacts?page=0&pageSize=1`,
        {
          headers: this.getHeaders(),
        },
      );

      return response.ok;
    } catch (error) {
      console.error("Dinero connection test failed:", error);
      return false;
    }
  }

  /**
   * Get contacts from Dinero.
   * @param queryFilter - optional server-side search string (Dinero filters by name/vatNumber)
   */
  async getContacts(
    page = 0,
    pageSize = 100,
    queryFilter?: string,
  ): Promise<DineroContact[]> {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (queryFilter) {
      params.set("queryFilter", queryFilter);
    }
    return this.fetchWithRetry(
      `${this.baseUrl}/${this.organizationId}/contacts?${params.toString()}`,
      { headers: this.getHeaders() },
      async (response) => {
        const data = await response.json();
        return data.Collection ?? data.collection ?? [];
      },
    );
  }

  /**
   * Get a single contact by GUID
   */
  async getContact(contactGuid: string): Promise<DineroContact> {
    return this.fetchWithRetry(
      `${this.baseUrl}/${this.organizationId}/contacts/${contactGuid}`,
      { headers: this.getHeaders() },
      async (response) => response.json(),
    );
  }

  /**
   * Find contact by VAT number (CVR).
   * Uses server-side queryFilter to avoid fetching the entire contacts list.
   */
  async findContactByVat(vatNumber: string): Promise<DineroContact | null> {
    // Dinero queryFilter syntax: `PropertyName op 'value'`
    const filter = `VatNumber eq '${vatNumber.replace(/'/g, "")}'`;
    const contacts = await this.getContacts(0, 100, filter);
    return contacts.find((c) => c.vatNumber === vatNumber) || null;
  }

  /**
   * Create a new contact in Dinero. Normalizes the response so callers can
   * rely on `contactGuid` regardless of Dinero's exact wire format — which
   * historically varies between `ContactGuid`, `contactGuid`, `Guid`, or a
   * bare GUID string.
   */
  async createContact(contact: DineroContact): Promise<DineroContact> {
    return this.fetchWithRetry(
      `${this.baseUrl}/${this.organizationId}/contacts`,
      {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(contact),
      },
      async (response) => {
        const raw: unknown = await response.json();
        console.log("[Dinero] createContact response:", JSON.stringify(raw));

        let guid: string | undefined;
        if (typeof raw === "string" && raw.length > 0) {
          guid = raw.replace(/^"|"$/g, "");
        } else if (typeof raw === "object" && raw !== null) {
          const obj = raw as Record<string, unknown>;
          guid =
            (obj.contactGuid as string | undefined) ??
            (obj.ContactGuid as string | undefined) ??
            (obj.Guid as string | undefined) ??
            (obj.guid as string | undefined) ??
            (obj.Id as string | undefined) ??
            (obj.id as string | undefined);
        }

        if (!guid) {
          console.error(
            "[Dinero] createContact: could not extract GUID from response:",
            JSON.stringify(raw),
          );
        }

        return {
          ...contact,
          ...(typeof raw === "object" && raw !== null ? raw : {}),
          contactGuid: guid,
        };
      },
    );
  }

  /**
   * Update an existing contact in Dinero
   */
  async updateContact(
    contactGuid: string,
    contact: Partial<DineroContact>,
  ): Promise<DineroContact> {
    return this.fetchWithRetry(
      `${this.baseUrl}/${this.organizationId}/contacts/${contactGuid}`,
      {
        method: "PUT",
        headers: this.getHeaders(),
        body: JSON.stringify(contact),
      },
      async (response) => response.json(),
    );
  }

  /**
   * Get the organization's chart of accounts (all "entry" accounts).
   * Dinero endpoint: /accounts/entry (not /accounts — the latter always 404s).
   */
  async getAccounts(): Promise<DineroAccount[]> {
    return this.fetchWithRetry(
      `${this.baseUrl}/${this.organizationId}/accounts/entry`,
      { headers: this.getHeaders() },
      async (response) => {
        const data = (await response.json()) as Array<Record<string, unknown>>;
        if (!Array.isArray(data)) return [];
        return data.map((a) => {
          const category = (a.Category ?? a.category) as
            | DineroAccount["category"]
            | undefined;
          // Derive legacy accountType from Category for back-compat callers.
          const accountType: DineroAccount["accountType"] =
            category === "Turnover"
              ? "income"
              : category === "Equity"
                ? "equity"
                : category === "Long Term Debt" ||
                    category === "Short Term Debt" ||
                    category === "Vat Due" ||
                    category === "Salary Due"
                  ? "liability"
                  : category === "Property" ||
                      category === "Turnover Assets" ||
                      category === "Financial Assets" ||
                      category === "Receivables" ||
                      category === "Liquid Assets" ||
                      category === "IntangibleProperty"
                    ? "asset"
                    : "expense";
          return {
            accountNumber: (a.AccountNumber ?? a.accountNumber) as number,
            name: (a.Name ?? a.name ?? "") as string,
            description: a.Description as string | undefined,
            accountType,
            category,
            categoryName: (a.CategoryName ?? a.categoryName) as
              | string
              | undefined,
            vatCode: (a.VatCode ?? a.vatCode) as string | undefined,
            isActive: !(a.IsHidden ?? a.isHidden ?? false),
            isHidden: (a.IsHidden ?? a.isHidden ?? false) as boolean,
            isDefaultSalesAccount: (a.IsDefaultSalesAccount ??
              a.isDefaultSalesAccount ??
              false) as boolean,
          };
        });
      },
    );
  }

  /**
   * Get accounts valid for invoice lines. Filters on Dinero's Category
   * field — only "Turnover" (omsætning) accounts are accepted by Dinero
   * as invoice voucher-line accounts. Hidden accounts are excluded.
   * The default sales account is sorted to the top.
   */
  async getIncomeAccounts(): Promise<DineroAccount[]> {
    const accounts = await this.getAccounts();
    return accounts
      .filter((a) => !a.isHidden && a.category === "Turnover")
      .sort((a, b) => {
        if (a.isDefaultSalesAccount && !b.isDefaultSalesAccount) return -1;
        if (!a.isDefaultSalesAccount && b.isDefaultSalesAccount) return 1;
        return a.accountNumber - b.accountNumber;
      });
  }

  /**
   * Get all products from the Dinero product catalog.
   */
  async getProducts(): Promise<DineroProduct[]> {
    return this.fetchWithRetry(
      `${this.baseUrl}/${this.organizationId}/products?page=0&pageSize=1000`,
      { headers: this.getHeaders() },
      async (response) => {
        const data = (await response.json()) as {
          Collection?: Array<Record<string, unknown>>;
          collection?: Array<Record<string, unknown>>;
        };
        const collection = data.Collection ?? data.collection ?? [];
        return collection.map((p) => ({
          productGuid: ((p.ProductGuid ?? p.productGuid) as string) || "",
          name: ((p.Name ?? p.name) as string) || "",
          productNumber:
            ((p.ProductNumber ?? p.productNumber) as string | null) ?? null,
          baseAmountValue:
            ((p.BaseAmountValue ?? p.baseAmountValue) as number) || 0,
          accountNumber:
            ((p.AccountNumber ?? p.accountNumber) as number | null) ?? null,
          unit: ((p.Unit ?? p.unit) as DineroLineUnit | null) ?? null,
          externalReference:
            ((p.ExternalReference ?? p.externalReference) as string | null) ??
            null,
          comment: ((p.Comment ?? p.comment) as string | null) ?? null,
        }));
      },
    );
  }

  /**
   * Create a new invoice in Dinero.
   * Dinero returns { Guid, TimeStamp } — we normalize to { guid, timestamp }
   * and merge back onto the input payload so callers can still see the
   * description/productLines they sent.
   */
  async createInvoice(invoice: DineroInvoice): Promise<DineroInvoice> {
    return this.fetchWithRetry(
      `${this.baseUrl}/${this.organizationId}/invoices`,
      {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(invoice),
      },
      async (response) => {
        const raw = (await response.json()) as Record<string, unknown>;
        console.log("[Dinero] createInvoice response:", JSON.stringify(raw));
        return {
          ...invoice,
          guid: (raw.Guid ?? raw.guid) as string | undefined,
          timestamp: (raw.TimeStamp ?? raw.Timestamp ?? raw.timestamp) as
            | string
            | undefined,
        };
      },
    );
  }

  /**
   * Get all invoices from Dinero
   */
  async getInvoices(page = 0, pageSize = 100): Promise<DineroInvoice[]> {
    return this.fetchWithRetry(
      `${this.baseUrl}/${this.organizationId}/invoices?page=${page}&pageSize=${pageSize}`,
      { headers: this.getHeaders() },
      async (response) => {
        const data = await response.json();
        return data.Collection ?? data.collection ?? [];
      },
    );
  }

  /**
   * Get a single invoice by GUID
   */
  async getInvoice(invoiceGuid: string): Promise<DineroInvoice> {
    return this.fetchWithRetry(
      `${this.baseUrl}/${this.organizationId}/invoices/${invoiceGuid}`,
      { headers: this.getHeaders() },
      async (response) => {
        const raw = await response.json();
        return {
          ...raw,
          totalInclVat: raw.TotalInclVat ?? raw.totalInclVat,
          currency: raw.Currency ?? raw.currency,
        };
      },
    );
  }

  /**
   * Get invoice status (for syncing payment status)
   */
  async getInvoiceStatus(
    invoiceGuid: string,
  ): Promise<{ status: string; remainingAmount: number; isPaid: boolean }> {
    const invoice = await this.getInvoice(invoiceGuid);
    return {
      status: invoice.status || "Draft",
      remainingAmount: invoice.remainingAmount || 0,
      isPaid: invoice.status === "Paid" || (invoice.remainingAmount || 0) === 0,
    };
  }

  /**
   * Book an invoice (finalize it). Dinero requires a Timestamp in the body
   * to detect concurrent modifications.
   */
  async bookInvoice(
    invoiceGuid: string,
    timestamp: string,
  ): Promise<DineroInvoice> {
    return this.fetchWithRetry(
      `${this.baseUrl}/${this.organizationId}/invoices/${invoiceGuid}/book`,
      {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({ Timestamp: timestamp }),
      },
      async (response) => {
        const raw = (await response.json()) as Record<string, unknown>;
        return {
          guid: invoiceGuid,
          timestamp: (raw.TimeStamp ?? raw.Timestamp) as string | undefined,
          status: "Booked",
        } as DineroInvoice;
      },
    );
  }

  /**
   * Send invoice via email. Dinero requires ShouldAddTrustPilotEmailAsBcc
   * and uses Receiver / AddVoucherAsPdfAttachment field names.
   */
  async sendInvoice(
    invoiceGuid: string,
    email: string,
    subject?: string,
    message?: string,
  ): Promise<void> {
    await this.fetchWithRetry(
      `${this.baseUrl}/${this.organizationId}/invoices/${invoiceGuid}/email`,
      {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({
          Receiver: email,
          Subject: subject || "Faktura",
          Message: message || undefined,
          AddVoucherAsPdfAttachment: true,
          ShouldAddTrustPilotEmailAsBcc: false,
        }),
      },
      async () => undefined,
    );
  }

  private getHeaders(): HeadersInit {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }
}

/**
 * Helper function to convert TimeTrack client to Dinero contact format
 */
export function convertToDineroContact(client: {
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  postalCode?: string;
  cvrNumber?: string;
}): DineroContact {
  return {
    name: client.name,
    street: client.address,
    zipCode: client.postalCode,
    city: client.city,
    countryKey: "DK",
    phone: client.phone,
    email: client.email,
    vatNumber: client.cvrNumber,
    isPerson: !client.cvrNumber,
    isMember: false,
    useCvr: Boolean(client.cvrNumber),
    paymentConditionType: "Netto",
    paymentConditionNumberOfDays: 14, // 14 days payment terms
  };
}
