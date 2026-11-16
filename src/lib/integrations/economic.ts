/**
 * e-conomic API Integration
 * Documentation: https://restdocs.e-conomic.com/
 *
 * e-conomic uses a REST API with two tokens:
 * - App Secret Token: Identifies your application
 * - Agreement Grant Token: Identifies the customer's agreement
 */

import { syncT } from "@/i18n/sync-text";
import { BaseIntegration, fetchWithTimeout } from "./base";

export interface EconomicCustomer {
  customerNumber?: number;
  name: string;
  address?: string;
  zip?: string;
  city?: string;
  country?: string;
  email?: string;
  telephoneAndFaxNumber?: string;
  website?: string;
  corporateIdentificationNumber?: string; // CVR number
  vatNumber?: string;
  paymentTerms: {
    paymentTermsNumber: number;
  };
  vatZone: {
    vatZoneNumber: number;
  };
  currency: string;
  customerGroup: {
    customerGroupNumber: number;
  };
  balance?: number;
  contacts?: EconomicContact[];
}

export interface EconomicContact {
  contactNumber?: number;
  customerNumber?: number;
  name: string;
  email?: string;
  phone?: string;
  eInvoiceId?: string;
}

export interface EconomicInvoice {
  draftInvoiceNumber?: number;
  bookedInvoiceNumber?: number;
  currency: string;
  customer: {
    customerNumber: number;
  };
  date: string;
  dueDate?: string;
  paymentTerms: {
    paymentTermsNumber: number;
  };
  layout?: {
    layoutNumber: number;
  };
  lines: EconomicInvoiceLine[];
  notes?: {
    heading?: string;
    textLine1?: string;
    textLine2?: string;
  };
  references?: {
    other?: string;
  };
  grossAmount?: number;
  netAmount?: number;
  vatAmount?: number;
  remainder?: number;
  remainderInBaseCurrency?: number;
  pdf?: {
    download: string;
  };
}

export interface EconomicInvoiceLine {
  lineNumber?: number;
  description: string;
  quantity: number;
  unitNetPrice: number;
  totalNetAmount?: number;
  product?: {
    productNumber: string;
  };
  unit?: {
    unitNumber: number;
    name?: string;
  };
  discountPercentage?: number;
}

export interface EconomicProduct {
  productNumber: string;
  name: string;
  description?: string;
  salesPrice?: number;
  costPrice?: number;
  barCode?: string;
  unit?: {
    unitNumber: number;
    name: string;
  };
  productGroup: {
    productGroupNumber: number;
  };
}

export interface EconomicLayout {
  layoutNumber: number;
  name: string;
}

export interface EconomicPaymentTerms {
  paymentTermsNumber: number;
  name: string;
  daysOfCredit: number;
  paymentTermsType: string;
}

export interface EconomicVatZone {
  vatZoneNumber: number;
  name: string;
}

export interface EconomicAccount {
  accountNumber: number;
  name: string;
  accountType: string;
  balance?: number;
  debitCredit: "debit" | "credit";
}

export class EconomicIntegration extends BaseIntegration {
  protected integrationName = "e-conomic";
  private appSecretToken: string;
  private agreementGrantToken: string;
  private baseUrl = "https://restapi.e-conomic.com";

  constructor(appSecretToken: string, agreementGrantToken: string) {
    super();
    if (!appSecretToken) {
      throw new Error(syncT("integrations.economic.secretRequired"));
    }
    if (!agreementGrantToken) {
      throw new Error(syncT("integrations.economic.grantRequired"));
    }
    this.appSecretToken = appSecretToken;
    this.agreementGrantToken = agreementGrantToken;
  }

  /**
   * Test connection to e-conomic API
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await fetchWithTimeout(`${this.baseUrl}/self`, {
        headers: this.getHeaders(),
      });

      return response.ok;
    } catch (error) {
      console.error("e-conomic connection test failed:", error);
      return false;
    }
  }

  async getAgreementInfo(): Promise<{
    agreementNumber: number;
    companyName: string;
    userName: string;
  }> {
    return this.fetchWithRetry(
      `${this.baseUrl}/self`,
      { headers: this.getHeaders() },
      async (response) => {
        const data = await response.json();
        return {
          agreementNumber: data.agreementNumber,
          companyName: data.company?.name || data.application?.name || "Ukendt",
          userName: data.userName || "",
        };
      },
    );
  }

  // ===== CUSTOMERS =====

  /**
   * Get all customers from e-conomic
   */
  async getCustomers(
    pageSize = 1000,
    skipToken?: string,
  ): Promise<{ customers: EconomicCustomer[]; nextPage?: string }> {
    let url = `${this.baseUrl}/customers?pagesize=${pageSize}`;
    if (skipToken) {
      url += `&skippages=${skipToken}`;
    }

    return this.fetchWithRetry(
      url,
      { headers: this.getHeaders() },
      async (response) => {
        const data = await response.json();
        return {
          customers: data.collection || [],
          nextPage: data.pagination?.nextPage,
        };
      },
    );
  }

  /**
   * Get a single customer by number
   */
  async getCustomer(customerNumber: number): Promise<EconomicCustomer> {
    return this.fetchWithRetry(
      `${this.baseUrl}/customers/${customerNumber}`,
      { headers: this.getHeaders() },
      async (response) => response.json(),
    );
  }

  /**
   * Find customer by CVR number
   */
  async findCustomerByCvr(cvrNumber: string): Promise<EconomicCustomer | null> {
    const result = await this.getCustomers(1000);
    return (
      result.customers.find(
        (c) =>
          c.corporateIdentificationNumber === cvrNumber ||
          c.vatNumber === cvrNumber,
      ) || null
    );
  }

  /**
   * Create a new customer in e-conomic
   */
  async createCustomer(
    customer: Partial<EconomicCustomer>,
  ): Promise<EconomicCustomer> {
    return this.fetchWithRetry(
      `${this.baseUrl}/customers`,
      {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(customer),
      },
      async (response) => response.json(),
    );
  }

  /**
   * Update an existing customer in e-conomic
   */
  async updateCustomer(
    customerNumber: number,
    customer: Partial<EconomicCustomer>,
  ): Promise<EconomicCustomer> {
    return this.fetchWithRetry(
      `${this.baseUrl}/customers/${customerNumber}`,
      {
        method: "PUT",
        headers: this.getHeaders(),
        body: JSON.stringify(customer),
      },
      async (response) => response.json(),
    );
  }

  // ===== INVOICES =====

  /**
   * Create a draft invoice in e-conomic
   */
  async createDraftInvoice(
    invoice: Partial<EconomicInvoice>,
  ): Promise<EconomicInvoice> {
    return this.fetchWithRetry(
      `${this.baseUrl}/invoices/drafts`,
      {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(invoice),
      },
      async (response) => response.json(),
    );
  }

  /**
   * Get all draft invoices
   */
  async getDraftInvoices(pageSize = 1000): Promise<EconomicInvoice[]> {
    return this.fetchWithRetry(
      `${this.baseUrl}/invoices/drafts?pagesize=${pageSize}`,
      { headers: this.getHeaders() },
      async (response) => {
        const data = await response.json();
        return data.collection || [];
      },
    );
  }

  /**
   * Get a single draft invoice
   */
  async getDraftInvoice(draftInvoiceNumber: number): Promise<EconomicInvoice> {
    return this.fetchWithRetry(
      `${this.baseUrl}/invoices/drafts/${draftInvoiceNumber}`,
      { headers: this.getHeaders() },
      async (response) => response.json(),
    );
  }

  /**
   * Book a draft invoice (finalize it)
   */
  async bookDraftInvoice(draftInvoiceNumber: number): Promise<EconomicInvoice> {
    return this.fetchWithRetry(
      `${this.baseUrl}/invoices/booked`,
      {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({
          draftInvoice: {
            draftInvoiceNumber,
          },
        }),
      },
      async (response) => response.json(),
    );
  }

  /**
   * Get all booked invoices
   */
  async getBookedInvoices(pageSize = 1000): Promise<EconomicInvoice[]> {
    return this.fetchWithRetry(
      `${this.baseUrl}/invoices/booked?pagesize=${pageSize}`,
      { headers: this.getHeaders() },
      async (response) => {
        const data = await response.json();
        return data.collection || [];
      },
    );
  }

  /**
   * Get a single booked invoice
   */
  async getBookedInvoice(
    bookedInvoiceNumber: number,
  ): Promise<EconomicInvoice> {
    return this.fetchWithRetry(
      `${this.baseUrl}/invoices/booked/${bookedInvoiceNumber}`,
      { headers: this.getHeaders() },
      async (response) => response.json(),
    );
  }

  /**
   * Get invoice status (for syncing payment status)
   */
  async getInvoiceStatus(
    bookedInvoiceNumber: number,
  ): Promise<{ remainder: number; isPaid: boolean }> {
    const invoice = await this.getBookedInvoice(bookedInvoiceNumber);
    return {
      remainder: invoice.remainder || 0,
      isPaid: (invoice.remainder || 0) === 0,
    };
  }

  /**
   * Get PDF download link for a booked invoice
   */
  async getInvoicePdf(bookedInvoiceNumber: number): Promise<string | null> {
    const invoice = await this.getBookedInvoice(bookedInvoiceNumber);
    return invoice.pdf?.download || null;
  }

  /**
   * Send invoice via email
   * Note: e-conomic doesn't have a direct email send API,
   * so this downloads the PDF for manual sending
   */
  async getInvoiceForEmail(bookedInvoiceNumber: number): Promise<{
    pdfUrl: string | null;
    customerEmail: string | null;
  }> {
    const invoice = await this.getBookedInvoice(bookedInvoiceNumber);
    const customer = await this.getCustomer(invoice.customer.customerNumber);
    return {
      pdfUrl: invoice.pdf?.download || null,
      customerEmail: customer.email || null,
    };
  }

  // ===== LAYOUTS =====

  /**
   * Get available invoice layouts
   */
  async getLayouts(): Promise<EconomicLayout[]> {
    return this.fetchWithRetry(
      `${this.baseUrl}/layouts`,
      { headers: this.getHeaders() },
      async (response) => {
        const data = await response.json();
        return data.collection || [];
      },
    );
  }

  // ===== PAYMENT TERMS =====

  /**
   * Get available payment terms
   */
  async getPaymentTerms(): Promise<EconomicPaymentTerms[]> {
    return this.fetchWithRetry(
      `${this.baseUrl}/payment-terms`,
      { headers: this.getHeaders() },
      async (response) => {
        const data = await response.json();
        return data.collection || [];
      },
    );
  }

  // ===== VAT ZONES =====

  /**
   * Get available VAT zones
   */
  async getVatZones(): Promise<EconomicVatZone[]> {
    return this.fetchWithRetry(
      `${this.baseUrl}/vat-zones`,
      { headers: this.getHeaders() },
      async (response) => {
        const data = await response.json();
        return data.collection || [];
      },
    );
  }

  // ===== ACCOUNTS =====

  /**
   * Get all accounts (for account mapping)
   */
  async getAccounts(): Promise<EconomicAccount[]> {
    return this.fetchWithRetry(
      `${this.baseUrl}/accounts`,
      { headers: this.getHeaders() },
      async (response) => {
        const data = await response.json();
        return data.collection || [];
      },
    );
  }

  /**
   * Get revenue accounts only
   */
  async getRevenueAccounts(): Promise<EconomicAccount[]> {
    const accounts = await this.getAccounts();
    // Revenue accounts typically have debitCredit: credit
    return accounts.filter((a) => a.debitCredit === "credit");
  }

  // ===== PRODUCTS =====

  /**
   * Get all products
   */
  async getProducts(pageSize = 1000): Promise<EconomicProduct[]> {
    return this.fetchWithRetry(
      `${this.baseUrl}/products?pagesize=${pageSize}`,
      { headers: this.getHeaders() },
      async (response) => {
        const data = await response.json();
        return data.collection || [];
      },
    );
  }

  /**
   * Create a product (for time tracking services)
   */
  async createProduct(
    product: Partial<EconomicProduct>,
  ): Promise<EconomicProduct> {
    return this.fetchWithRetry(
      `${this.baseUrl}/products`,
      {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(product),
      },
      async (response) => response.json(),
    );
  }

  private getHeaders(): HeadersInit {
    return {
      "X-AppSecretToken": this.appSecretToken,
      "X-AgreementGrantToken": this.agreementGrantToken,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }
}

/**
 * Helper function to convert TimeTrack client to e-conomic customer format
 * Note: Requires customerGroup and paymentTerms to be set
 */
export function convertToEconomicCustomer(
  client: {
    name: string;
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
    postalCode?: string;
    cvrNumber?: string;
  },
  options: {
    customerGroupNumber: number;
    paymentTermsNumber: number;
    vatZoneNumber?: number;
    currency?: string;
  },
): Partial<EconomicCustomer> {
  return {
    name: client.name,
    address: client.address,
    zip: client.postalCode,
    city: client.city,
    country: "Danmark",
    email: client.email,
    telephoneAndFaxNumber: client.phone,
    corporateIdentificationNumber: client.cvrNumber,
    vatNumber: client.cvrNumber,
    currency: options.currency || "DKK",
    customerGroup: {
      customerGroupNumber: options.customerGroupNumber,
    },
    paymentTerms: {
      paymentTermsNumber: options.paymentTermsNumber,
    },
    vatZone: {
      vatZoneNumber: options.vatZoneNumber || 1, // 1 is typically "Domestic"
    },
  };
}

/**
 * Helper function to create invoice lines from time entries
 */
export function createInvoiceLinesFromTimeEntries(
  entries: Array<{
    description?: string | null;
    hours: string;
    billableRate?: string | null;
  }>,
  productNumber?: string,
): EconomicInvoiceLine[] {
  return entries.map((entry, index) => ({
    lineNumber: index + 1,
    description:
      entry.description ||
      syncT("integrations.economic.consultingHours", { hours: entry.hours }),
    quantity: Number.parseFloat(entry.hours),
    unitNetPrice: Number.parseFloat(entry.billableRate || "0"),
    product: productNumber ? { productNumber } : undefined,
  }));
}
