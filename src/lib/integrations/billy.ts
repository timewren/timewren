/**
 * Billy's Billing API Integration
 * Documentation: https://www.billy.dk/api
 */

import { syncT } from "@/i18n/sync-text";
import { billyInvoiceIsPaid } from "@/lib/integrations/billy-match";
import { BaseIntegration, fetchWithTimeout } from "./base";

export interface BillyContactPerson {
  id?: string;
  name?: string;
  email?: string;
  isPrimary?: boolean;
  // Note: phone is NOT a valid field on contactPerson in Billy API
}

export interface BillyContact {
  id: string;
  name: string;
  type: "company" | "person";
  registrationNo?: string; // CVR number for Danish companies
  countryId: string;
  street?: string;
  cityText?: string;
  zipcodeText?: string;
  phone?: string;
  // Note: email is NOT a valid field on contact - use contactPersons instead
  contactPersons?: BillyContactPerson[];
  isCustomer: boolean;
  isSupplier: boolean;
  isArchived?: boolean;
}

export interface BillyInvoice {
  id?: string;
  invoiceNo?: number;
  contactId: string;
  type: "invoice";
  state: "draft" | "approved" | "sent" | "paid" | "voided";
  currencyId?: string; // Billy uses currencyId, not currency (e.g., "DKK")
  entryDate: string;
  paymentDate?: string;
  dueDate?: string; // Writable — the invoice's due date (entryDate + payment term days)
  lines: BillyInvoiceLine[];
  sentState?: "sent" | "notSent";
  grossAmount?: number;
  netAmount?: number;
  /** Nettobeløb — det Billy kalder `amount` i API-svaret */
  amount?: number;
  balance?: number;
  /** Billy's egen betalingsmarkering — kilden til sandhed for "betalt" */
  isPaid?: boolean;
  contactMessage?: string; // Extra message shown on the invoice
}

export interface BillyInvoiceLine {
  productId: string; // Required by Billy API
  description?: string;
  quantity: number;
  unitPrice: number;
  // Note: Billy does NOT accept taxRate directly on lines
  // Tax is handled via organization settings or product settings
  discount?: number;
}

export interface BillyProduct {
  id: string;
  name: string;
  description?: string;
  productNo?: string;
  salesPrice?: number;
  isArchived?: boolean;
}

export interface BillyAccount {
  id: string;
  accountNo: number;
  name: string;
  description?: string;
  groupId: string;
  nature: "debit" | "credit";
  isBankAccount: boolean;
  isPaymentEnabled: boolean;
}

export interface BillyOrganization {
  id: string;
  name: string;
  street?: string;
  cityText?: string;
  zipcodeText?: string;
  countryId: string;
  registrationNo?: string;
  phone?: string;
  email?: string;
}

export class BillyIntegration extends BaseIntegration {
  protected integrationName = "Billy";
  private apiKey: string;
  private baseUrl = "https://api.billysbilling.com/v2";

  constructor(apiKey: string) {
    super();
    if (!apiKey) {
      throw new Error(syncT("integrations.billy.keyRequired"));
    }
    this.apiKey = apiKey;
  }

  /**
   * Test connection to Billy API
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await fetchWithTimeout(`${this.baseUrl}/organization`, {
        headers: this.getHeaders(),
      });

      return response.ok;
    } catch (error) {
      console.error("Billy connection test failed:", error);
      return false;
    }
  }

  /**
   * Get organization info
   */
  async getOrganization(): Promise<BillyOrganization> {
    return this.fetchWithRetry(
      `${this.baseUrl}/organization`,
      { headers: this.getHeaders() },
      async (response) => {
        const data = await response.json();
        return data.organization;
      },
    );
  }

  /**
   * Get all contacts (customers) from Billy
   */
  async getContacts(): Promise<BillyContact[]> {
    return this.fetchWithRetry(
      `${this.baseUrl}/contacts?isCustomer=true`,
      { headers: this.getHeaders() },
      async (response) => {
        const data = await response.json();
        return data.contacts || [];
      },
    );
  }

  /**
   * Get a single contact by ID
   */
  async getContact(contactId: string): Promise<BillyContact> {
    return this.fetchWithRetry(
      `${this.baseUrl}/contacts/${contactId}`,
      { headers: this.getHeaders() },
      async (response) => {
        const data = await response.json();
        return data.contact;
      },
    );
  }

  /**
   * Find contact by CVR number
   */
  async findContactByCvr(cvrNumber: string): Promise<BillyContact | null> {
    const contacts = await this.getContacts();
    // Arkiverede kontakter springes over: en dublet med samme CVR må ikke
    // få klienten koblet (og opdateret) i stedet for den aktive kontakt.
    return (
      contacts.find((c) => c.registrationNo === cvrNumber && !c.isArchived) ||
      null
    );
  }

  /**
   * Create a new contact in Billy
   */
  async createContact(contact: Partial<BillyContact>): Promise<BillyContact> {
    return this.fetchWithRetry(
      `${this.baseUrl}/contacts`,
      {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({ contact }),
      },
      async (response) => {
        const data = await response.json();
        console.log("[Billy] createContact response:", JSON.stringify(data));
        // Billy returns contacts array for POST, not a single contact
        const createdContact = data.contact || data.contacts?.[0];
        if (!createdContact) {
          throw new Error(
            `Billy createContact returned unexpected format: ${JSON.stringify(data)}`,
          );
        }
        return createdContact;
      },
    );
  }

  /**
   * Update an existing contact in Billy
   */
  async updateContact(
    contactId: string,
    contact: Partial<BillyContact>,
  ): Promise<BillyContact> {
    return this.fetchWithRetry(
      `${this.baseUrl}/contacts/${contactId}`,
      {
        method: "PUT",
        headers: this.getHeaders(),
        body: JSON.stringify({ contact }),
      },
      async (response) => {
        const data = await response.json();
        console.log("[Billy] updateContact response:", JSON.stringify(data));
        const updatedContact = data.contact || data.contacts?.[0];
        if (!updatedContact?.id) {
          throw new Error(
            `Billy updateContact returned unexpected format: ${JSON.stringify(data)}`,
          );
        }
        return updatedContact;
      },
    );
  }

  /**
   * Get all accounts (for account mapping)
   */
  async getAccounts(): Promise<BillyAccount[]> {
    return this.fetchWithRetry(
      `${this.baseUrl}/accounts`,
      { headers: this.getHeaders() },
      async (response) => {
        const data = await response.json();
        return data.accounts || [];
      },
    );
  }

  /**
   * Get revenue accounts only (for invoice line mapping)
   */
  async getRevenueAccounts(): Promise<BillyAccount[]> {
    const accounts = await this.getAccounts();
    // Revenue accounts typically have nature: credit and are not bank accounts
    return accounts.filter((a) => a.nature === "credit" && !a.isBankAccount);
  }

  /**
   * Get all products from Billy
   */
  async getProducts(): Promise<BillyProduct[]> {
    return this.fetchWithRetry(
      `${this.baseUrl}/products`,
      { headers: this.getHeaders() },
      async (response) => {
        const data = await response.json();
        return data.products || [];
      },
    );
  }

  /**
   * Create a product in Billy
   */
  async createProduct(product: Partial<BillyProduct>): Promise<BillyProduct> {
    return this.fetchWithRetry(
      `${this.baseUrl}/products`,
      {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({ product }),
      },
      async (response) => {
        const data = await response.json();
        console.log("[Billy] createProduct response:", JSON.stringify(data));
        const createdProduct = data.product || data.products?.[0];
        if (!createdProduct) {
          throw new Error(
            `Billy createProduct returned unexpected format: ${JSON.stringify(data)}`,
          );
        }
        return createdProduct;
      },
    );
  }

  /**
   * Get or create a default "Consulting" product for time entries
   */
  async getOrCreateDefaultProduct(): Promise<BillyProduct> {
    const products = await this.getProducts();

    // Look for an existing "TimeTrack" or "Konsulent" product
    const existingProduct = products.find(
      (p) =>
        !p.isArchived &&
        (p.name.toLowerCase().includes("timetrack") ||
          p.name.toLowerCase().includes("konsulent") ||
          p.name.toLowerCase().includes("consulting")),
    );

    if (existingProduct) {
      console.log("[Billy] Found existing product:", existingProduct.name);
      return existingProduct;
    }

    // Create a default product
    console.log("[Billy] Creating default TimeTrack product...");
    return this.createProduct({
      name: "TimeTrack Konsulentarbejde",
      description: syncT("integrations.billy.productDescription"),
    });
  }

  /**
   * Create a new invoice in Billy
   */
  async createInvoice(invoice: Partial<BillyInvoice>): Promise<BillyInvoice> {
    return this.fetchWithRetry(
      `${this.baseUrl}/invoices`,
      {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({ invoice }),
      },
      async (response) => {
        const data = await response.json();
        console.log("[Billy] createInvoice response:", JSON.stringify(data));
        // Billy may return invoices array or invoice object
        const createdInvoice = data.invoice || data.invoices?.[0];
        if (!createdInvoice) {
          throw new Error(
            `Billy createInvoice returned unexpected format: ${JSON.stringify(data)}`,
          );
        }
        return createdInvoice;
      },
    );
  }

  /**
   * Get all invoices from Billy
   */
  async getInvoices(
    opts: { minEntryDate?: string; pageSize?: number } = {},
  ): Promise<BillyInvoice[]> {
    // Nyeste først, så en match på dato+beløb rammer indenfor første side
    const params = new URLSearchParams({
      sortProperty: "entryDate",
      sortDirection: "DESC",
      pageSize: String(opts.pageSize ?? 200),
    });
    if (opts.minEntryDate) params.set("minEntryDate", opts.minEntryDate);
    return this.fetchWithRetry(
      `${this.baseUrl}/invoices?${params}`,
      { headers: this.getHeaders() },
      async (response) => {
        const data = await response.json();
        return data.invoices || [];
      },
    );
  }

  /**
   * Get a single invoice by ID
   */
  async getInvoice(invoiceId: string): Promise<BillyInvoice> {
    return this.fetchWithRetry(
      `${this.baseUrl}/invoices/${invoiceId}`,
      { headers: this.getHeaders() },
      async (response) => {
        const data = await response.json();
        return data.invoice;
      },
    );
  }

  /**
   * Get invoice status (for syncing payment status)
   */
  async getInvoiceStatus(
    invoiceId: string,
  ): Promise<{ state: string; balance: number; isPaid: boolean }> {
    const invoice = await this.getInvoice(invoiceId);
    // Billy har ingen "paid"-state (kun draft/approved/voided); betaling
    // står i `isPaid`. `balance || 0` læste et manglende felt som betalt.
    return {
      state: invoice.state,
      balance: invoice.balance ?? 0,
      isPaid: billyInvoiceIsPaid(invoice),
    };
  }

  /**
   * Approve invoice (required before sending)
   * Billy API uses PUT to update invoice state, not a separate /approve endpoint
   */
  async approveInvoice(invoiceId: string): Promise<BillyInvoice> {
    return this.fetchWithRetry(
      `${this.baseUrl}/invoices/${invoiceId}`,
      {
        method: "PUT",
        headers: this.getHeaders(),
        body: JSON.stringify({
          invoice: {
            state: "approved",
          },
        }),
      },
      async (response) => {
        const data = await response.json();
        console.log("[Billy] approveInvoice response:", JSON.stringify(data));
        const approvedInvoice = data.invoice || data.invoices?.[0];
        if (!approvedInvoice) {
          throw new Error(
            `Billy approveInvoice returned unexpected format: ${JSON.stringify(data)}`,
          );
        }
        return approvedInvoice;
      },
    );
  }

  /**
   * Send invoice via email
   */
  async sendInvoice(
    invoiceId: string,
    email: string,
    message?: string,
  ): Promise<void> {
    await this.fetchWithRetry(
      `${this.baseUrl}/invoices/${invoiceId}/send`,
      {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({
          recipientEmail: email,
          message: message || "",
        }),
      },
      async () => undefined,
    );
  }

  private getHeaders(): HeadersInit {
    return {
      "X-Access-Token": this.apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }
}

/**
 * Helper function to convert TimeTrack client to Billy contact format
 */
export function convertToBillyContact(client: {
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  postalCode?: string;
  cvrNumber?: string;
}): Partial<BillyContact> {
  const contact: Partial<BillyContact> = {
    name: client.name,
    type: client.cvrNumber ? "company" : "person",
    registrationNo: client.cvrNumber || undefined,
    countryId: "DK",
    street: client.address || undefined,
    cityText: client.city || undefined,
    zipcodeText: client.postalCode || undefined,
    phone: client.phone || undefined,
    isCustomer: true,
    isSupplier: false,
  };

  // Add contact person with email if email is provided
  // Note: Billy API does not accept phone on contactPerson, only on contact
  if (client.email) {
    contact.contactPersons = [
      {
        name: client.name,
        email: client.email,
        isPrimary: true,
      },
    ];
  }

  return contact;
}
