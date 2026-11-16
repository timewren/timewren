import { brand } from "@/lib/brand";
import { getAppUrl, getMarketingUrl } from "@/lib/config";
export function buildOpenApiSpec() {
  const serverUrl = getAppUrl();

  return {
    openapi: "3.1.0",
    info: {
      title: `${brand.name} API`,
      version: "1.0.0",
      description: `Public REST API for ${brand.name}, Danish time tracking with prepaid hour packages (klippekort) for freelancers and small agencies. Manage clients, projects, time entries, invoices, prepaid hour packages (klippekort), and tasks.`,
      contact: {
        name: `${brand.name} Support`,
        url: getMarketingUrl(),
      },
    },
    servers: [
      {
        url: serverUrl,
        description: `${brand.name} API server`,
      },
    ],
    security: [{ bearerAuth: [] }],
    tags: [
      { name: "Me", description: "Current user and API key info" },
      { name: "Clients", description: "Manage clients" },
      { name: "Projects", description: "Manage projects" },
      { name: "Time Entries", description: "Track time" },
      { name: "Invoices", description: "Create and send invoices" },
      {
        name: "Prepaid Packages",
        description: "Klippekort — prepaid hour packages",
      },
      { name: "Tasks", description: "Manage tasks" },
      {
        name: "Reports",
        description: "Aggregated time and revenue reports",
      },
      { name: "Timer", description: "Start, stop and sync timer" },
      {
        name: "Webhooks",
        description: "Manage outgoing webhook subscriptions",
      },
    ],
    paths: {
      "/api/v1/me": {
        get: {
          tags: ["Me"],
          summary: "Get current user profile and API key info",
          description:
            "Returns the authenticated user's profile and info about the API key used for the request. No specific scope required — any valid API key can access this.",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": {
              description: "User profile and API key info",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { $ref: "#/components/schemas/Me" },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
          },
        },
      },
      "/api/v1/clients": {
        get: {
          tags: ["Clients"],
          summary: "List clients",
          description:
            "Paginated in the database: `pagination.total` counts every matching client, and `pagination.hasMore`/`nextPage` tell you whether to fetch another page.",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "includeArchived",
              in: "query",
              schema: { type: "boolean", default: false },
              description: "Include archived clients",
            },
            {
              name: "q",
              in: "query",
              schema: { type: "string" },
              description:
                "Search clients by name, email, company, or CVR number",
            },
            {
              name: "page",
              in: "query",
              schema: { type: "integer", default: 1, minimum: 1 },
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 25, maximum: 100 },
            },
            {
              name: "sort",
              in: "query",
              schema: {
                type: "string",
                enum: ["createdAt", "name", "company", "email"],
              },
              description: "Sort field",
            },
            {
              name: "order",
              in: "query",
              schema: {
                type: "string",
                enum: ["asc", "desc"],
                default: "desc",
              },
            },
          ],
          responses: {
            "200": {
              description: "List of clients",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "array",
                        items: { $ref: "#/components/schemas/Client" },
                      },
                      pagination: {
                        $ref: "#/components/schemas/Pagination",
                      },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
          },
        },
        post: {
          tags: ["Clients"],
          summary: "Create a client",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ClientCreate" },
              },
            },
          },
          responses: {
            "201": {
              description: "Client created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { $ref: "#/components/schemas/Client" },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "422": { $ref: "#/components/responses/ValidationError" },
          },
        },
      },
      "/api/v1/clients/{id}": {
        get: {
          tags: ["Clients"],
          summary: "Get a client",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/Id" }],
          responses: {
            "200": {
              description: "Client details",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { $ref: "#/components/schemas/Client" },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        patch: {
          tags: ["Clients"],
          summary: "Update a client",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/Id" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ClientCreate" },
              },
            },
          },
          responses: {
            "200": {
              description: "Client updated",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { $ref: "#/components/schemas/Client" },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
            "422": { $ref: "#/components/responses/ValidationError" },
          },
        },
        delete: {
          tags: ["Clients"],
          summary: "Archive a client",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/Id" }],
          responses: {
            "200": {
              description: "Client archived",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { $ref: "#/components/schemas/Client" },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/api/v1/projects": {
        get: {
          tags: ["Projects"],
          summary: "List projects",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "clientId",
              in: "query",
              schema: { type: "string" },
              description: "Filter by client ID",
            },
            {
              name: "includeArchived",
              in: "query",
              schema: { type: "boolean", default: false },
            },
            {
              name: "page",
              in: "query",
              schema: { type: "integer", default: 1, minimum: 1 },
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 25, maximum: 100 },
            },
            {
              name: "sort",
              in: "query",
              schema: {
                type: "string",
                enum: ["createdAt", "name", "status"],
              },
              description: "Sort field",
            },
            {
              name: "order",
              in: "query",
              schema: {
                type: "string",
                enum: ["asc", "desc"],
                default: "desc",
              },
            },
          ],
          responses: {
            "200": {
              description: "List of projects",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "array",
                        items: { $ref: "#/components/schemas/Project" },
                      },
                      pagination: {
                        $ref: "#/components/schemas/Pagination",
                      },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
          },
        },
        post: {
          tags: ["Projects"],
          summary: "Create a project",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ProjectCreate" },
              },
            },
          },
          responses: {
            "201": {
              description: "Project created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { $ref: "#/components/schemas/Project" },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "422": { $ref: "#/components/responses/ValidationError" },
          },
        },
      },
      "/api/v1/projects/{id}": {
        get: {
          tags: ["Projects"],
          summary: "Get a project",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/Id" }],
          responses: {
            "200": {
              description: "Project details",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { $ref: "#/components/schemas/Project" },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        patch: {
          tags: ["Projects"],
          summary: "Update a project",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/Id" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ProjectCreate" },
              },
            },
          },
          responses: {
            "200": {
              description: "Project updated",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { $ref: "#/components/schemas/Project" },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        delete: {
          tags: ["Projects"],
          summary: "Archive a project",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/Id" }],
          responses: {
            "200": {
              description: "Project archived",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { $ref: "#/components/schemas/Project" },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/api/v1/time-entries": {
        get: {
          tags: ["Time Entries"],
          summary: "List time entries",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "projectId",
              in: "query",
              schema: { type: "string" },
              description: "Filter by project ID",
            },
            {
              name: "clientId",
              in: "query",
              schema: { type: "string" },
              description: "Filter by client ID",
            },
            {
              name: "from",
              in: "query",
              schema: { type: "string", format: "date" },
              description: "Start date (YYYY-MM-DD)",
            },
            {
              name: "to",
              in: "query",
              schema: { type: "string", format: "date" },
              description: "End date (YYYY-MM-DD)",
            },
            {
              name: "isBillable",
              in: "query",
              schema: { type: "boolean" },
              description: "Filter by billable status",
            },
            {
              name: "isBilled",
              in: "query",
              schema: { type: "boolean" },
              description: "Filter by billed (invoiced) status",
            },
            {
              name: "page",
              in: "query",
              schema: { type: "integer", default: 1, minimum: 1 },
            },
            {
              name: "limit",
              in: "query",
              schema: {
                type: "integer",
                default: 25,
                minimum: 1,
                maximum: 100,
              },
            },
            {
              name: "sort",
              in: "query",
              schema: {
                type: "string",
                enum: ["createdAt", "date", "hours"],
                default: "createdAt",
              },
            },
            {
              name: "order",
              in: "query",
              schema: {
                type: "string",
                enum: ["asc", "desc"],
                default: "desc",
              },
            },
          ],
          responses: {
            "200": {
              description: "List of time entries",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "array",
                        items: { $ref: "#/components/schemas/TimeEntry" },
                      },
                      pagination: {
                        $ref: "#/components/schemas/Pagination",
                      },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
          },
        },
        post: {
          tags: ["Time Entries"],
          summary: "Create a time entry",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TimeEntryCreate" },
              },
            },
          },
          responses: {
            "201": {
              description: "Time entry created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { $ref: "#/components/schemas/TimeEntry" },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "422": { $ref: "#/components/responses/ValidationError" },
          },
        },
      },
      "/api/v1/time-entries/{id}": {
        get: {
          tags: ["Time Entries"],
          summary: "Get a time entry",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/Id" }],
          responses: {
            "200": {
              description: "Time entry details",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { $ref: "#/components/schemas/TimeEntry" },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        patch: {
          tags: ["Time Entries"],
          summary: "Update a time entry",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/Id" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TimeEntryCreate" },
              },
            },
          },
          responses: {
            "200": {
              description: "Time entry updated",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { $ref: "#/components/schemas/TimeEntry" },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        delete: {
          tags: ["Time Entries"],
          summary: "Delete a time entry",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/Id" }],
          responses: {
            "200": { description: "Time entry deleted" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/api/v1/invoices": {
        get: {
          tags: ["Invoices"],
          summary: "List invoices",
          description:
            "Paginated in the database: `pagination.total` counts every matching invoice, and `pagination.hasMore`/`nextPage` tell you whether to fetch another page. There is no upper bound on how many invoices can be paged through.",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "clientId",
              in: "query",
              schema: { type: "string" },
            },
            {
              name: "status",
              in: "query",
              schema: {
                type: "string",
                enum: ["draft", "sent", "paid", "overdue"],
              },
            },
            {
              name: "page",
              in: "query",
              schema: { type: "integer", default: 1, minimum: 1 },
            },
            {
              name: "limit",
              in: "query",
              schema: {
                type: "integer",
                default: 25,
                minimum: 1,
                maximum: 100,
              },
            },
            {
              name: "sort",
              in: "query",
              schema: {
                type: "string",
                enum: [
                  "createdAt",
                  "status",
                  "amount",
                  "totalAmount",
                  "issueDate",
                  "dueDate",
                ],
                default: "createdAt",
              },
              description:
                "Sort field. `totalAmount` is an alias for `amount`.",
            },
            {
              name: "order",
              in: "query",
              schema: {
                type: "string",
                enum: ["asc", "desc"],
                default: "desc",
              },
            },
          ],
          responses: {
            "200": {
              description: "List of invoices",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "array",
                        items: { $ref: "#/components/schemas/Invoice" },
                      },
                      pagination: {
                        $ref: "#/components/schemas/Pagination",
                      },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
          },
        },
        post: {
          tags: ["Invoices"],
          summary: "Create an invoice",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/InvoiceCreate" },
              },
            },
          },
          responses: {
            "201": {
              description: "Invoice created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { $ref: "#/components/schemas/Invoice" },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "422": { $ref: "#/components/responses/ValidationError" },
          },
        },
      },
      "/api/v1/invoices/{id}": {
        get: {
          tags: ["Invoices"],
          summary: "Get an invoice",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/Id" }],
          responses: {
            "200": {
              description: "Invoice details",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { $ref: "#/components/schemas/Invoice" },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        patch: {
          tags: ["Invoices"],
          summary: "Update an invoice",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/Id" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/InvoiceCreate" },
              },
            },
          },
          responses: {
            "200": {
              description: "Invoice updated",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { $ref: "#/components/schemas/Invoice" },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        delete: {
          tags: ["Invoices"],
          summary: "Delete an invoice (soft delete)",
          description:
            "Soft-deletes the invoice by setting its status. Requires `invoices:write` scope.",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/Id" }],
          responses: {
            "200": { description: "Invoice deleted" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/api/v1/invoices/from-time-entries": {
        post: {
          tags: ["Invoices"],
          summary: "Generate a draft invoice from time entries",
          description:
            "Creates a draft invoice with an itemized specification and computed total from a client's time entries, and marks them billed. If `timeEntryIds` is omitted, all unbilled billable entries for the client are used. Requires `invoices:write` scope.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["clientId"],
                  properties: {
                    clientId: { type: "string" },
                    timeEntryIds: {
                      type: "array",
                      items: { type: "string", format: "uuid" },
                      description:
                        "Optional. When omitted, all unbilled billable entries for the client are used.",
                    },
                    notes: { type: "string" },
                    dueDate: { type: "string", format: "date" },
                    dryRun: {
                      type: "boolean",
                      description:
                        "Preview line items + total without creating the invoice or marking entries billed.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Draft invoice created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { data: { type: "object" } },
                  },
                },
              },
            },
            "400": {
              description: "No unbilled billable entries found",
            },
          },
        },
      },
      "/api/v1/invoices/{id}/send": {
        post: {
          tags: ["Invoices"],
          summary: "Send an invoice by email",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/Id" }],
          responses: {
            "200": { description: "Invoice sent" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/api/v1/invoices/{id}/mark-paid": {
        post: {
          tags: ["Invoices"],
          summary: "Mark an invoice as paid",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/Id" }],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    paidAt: {
                      type: "string",
                      format: "date",
                      description: "Payment date (defaults to today)",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Invoice marked as paid" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/api/v1/prepaid-packages": {
        get: {
          tags: ["Prepaid Packages"],
          summary: "List prepaid packages (klippekort)",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "clientId",
              in: "query",
              schema: { type: "string" },
            },
            {
              name: "activeOnly",
              in: "query",
              schema: { type: "boolean", default: false },
              description: "Only return active (non-depleted) packages",
            },
            {
              name: "includeArchived",
              in: "query",
              schema: { type: "boolean", default: false },
            },
            {
              name: "page",
              in: "query",
              schema: { type: "integer", default: 1, minimum: 1 },
            },
            {
              name: "limit",
              in: "query",
              schema: {
                type: "integer",
                default: 25,
                minimum: 1,
                maximum: 100,
              },
            },
            {
              name: "sort",
              in: "query",
              schema: {
                type: "string",
                enum: ["createdAt", "name", "totalHours"],
                default: "createdAt",
              },
            },
            {
              name: "order",
              in: "query",
              schema: {
                type: "string",
                enum: ["asc", "desc"],
                default: "desc",
              },
            },
          ],
          responses: {
            "200": {
              description: "List of prepaid packages",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "array",
                        items: {
                          $ref: "#/components/schemas/PrepaidPackage",
                        },
                      },
                      pagination: {
                        $ref: "#/components/schemas/Pagination",
                      },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
          },
        },
        post: {
          tags: ["Prepaid Packages"],
          summary: "Create a prepaid package",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/PrepaidPackageCreate",
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Prepaid package created",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/PrepaidPackage",
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "422": { $ref: "#/components/responses/ValidationError" },
          },
        },
      },
      "/api/v1/prepaid-packages/{id}": {
        get: {
          tags: ["Prepaid Packages"],
          summary: "Get a prepaid package",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/Id" }],
          responses: {
            "200": {
              description: "Prepaid package details",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/PrepaidPackage",
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        patch: {
          tags: ["Prepaid Packages"],
          summary: "Update a prepaid package",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/Id" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/PrepaidPackageCreate",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Prepaid package updated",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/PrepaidPackage",
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/api/v1/tasks": {
        get: {
          tags: ["Tasks"],
          summary: "List tasks",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "projectId",
              in: "query",
              schema: { type: "string" },
            },
            {
              name: "clientId",
              in: "query",
              schema: { type: "string" },
            },
            {
              name: "status",
              in: "query",
              schema: {
                type: "string",
                enum: ["backlog", "todo", "in_progress", "done"],
              },
            },
            {
              name: "priority",
              in: "query",
              schema: {
                type: "string",
                enum: ["low", "medium", "high", "urgent"],
              },
            },
            {
              name: "page",
              in: "query",
              schema: { type: "integer", default: 1, minimum: 1 },
            },
            {
              name: "limit",
              in: "query",
              schema: {
                type: "integer",
                default: 25,
                minimum: 1,
                maximum: 100,
              },
            },
            {
              name: "sort",
              in: "query",
              schema: {
                type: "string",
                enum: ["createdAt", "status", "priority", "deadline"],
                default: "createdAt",
              },
            },
            {
              name: "order",
              in: "query",
              schema: {
                type: "string",
                enum: ["asc", "desc"],
                default: "desc",
              },
            },
          ],
          responses: {
            "200": {
              description: "List of tasks",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "array",
                        items: { $ref: "#/components/schemas/Task" },
                      },
                      pagination: {
                        $ref: "#/components/schemas/Pagination",
                      },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
          },
        },
        post: {
          tags: ["Tasks"],
          summary: "Create a task",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TaskCreate" },
              },
            },
          },
          responses: {
            "201": {
              description: "Task created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { data: { $ref: "#/components/schemas/Task" } },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "422": { $ref: "#/components/responses/ValidationError" },
          },
        },
      },
      "/api/v1/tasks/{id}": {
        get: {
          tags: ["Tasks"],
          summary: "Get a task",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/Id" }],
          responses: {
            "200": {
              description: "Task details",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { data: { $ref: "#/components/schemas/Task" } },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        patch: {
          tags: ["Tasks"],
          summary: "Update a task",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/Id" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TaskCreate" },
              },
            },
          },
          responses: {
            "200": {
              description: "Task updated",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { data: { $ref: "#/components/schemas/Task" } },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        delete: {
          tags: ["Tasks"],
          summary: "Delete a task",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/Id" }],
          responses: {
            "200": { description: "Task deleted" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/api/v1/reports/unbilled": {
        get: {
          tags: ["Reports"],
          summary: "Get unbilled hours and amount grouped by client",
          description:
            "Returns unbilled hours and amount per client, with totals. Unbilled means: not yet invoiced, billable, not drawn from a prepaid package, not awaiting or denied approval, and belonging to a non-internal client. Requires `reports:read` scope.",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": {
              description: "Unbilled summary",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "object",
                        properties: {
                          totalHours: { type: "string" },
                          totalAmount: { type: "string" },
                          byClient: {
                            type: "array",
                            items: {
                              type: "object",
                              properties: {
                                clientId: { type: "string", nullable: true },
                                clientName: { type: "string" },
                                hours: { type: "string" },
                                amount: { type: "string" },
                                entryCount: { type: "integer" },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/v1/reports/time-summary": {
        get: {
          tags: ["Reports"],
          summary: "Get time summary for a date range",
          description:
            "Returns aggregated time tracking stats: total hours, billed/unbilled hours, and revenue. Billed + unbilled can be less than the total. `unbilled` counts only time that is ready to be invoiced, so the difference is time that is not: internal clients, non-billable entries, prepaid (klippekort) hours, entries without a client, and entries awaiting or denied approval. Some of it may become invoiceable later — approval-pending time in particular — so do not read the difference as permanently unbillable. Requires `reports:read` scope.",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "from",
              in: "query",
              required: true,
              schema: { type: "string", format: "date" },
              description: "Start date (YYYY-MM-DD)",
            },
            {
              name: "to",
              in: "query",
              required: true,
              schema: { type: "string", format: "date" },
              description: "End date (YYYY-MM-DD)",
            },
            {
              name: "clientId",
              in: "query",
              schema: { type: "string" },
              description: "Filter by client ID",
            },
            {
              name: "projectId",
              in: "query",
              schema: { type: "string" },
              description: "Filter by project ID",
            },
          ],
          responses: {
            "200": {
              description: "Time summary",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        $ref: "#/components/schemas/TimeSummary",
                      },
                    },
                  },
                },
              },
            },
            "400": {
              description: "Missing required date parameters",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
          },
        },
      },
      "/api/v1/reports/revenue": {
        get: {
          tags: ["Reports"],
          summary: "Get revenue breakdown",
          description:
            "Returns revenue breakdown grouped by client or project. Requires `reports:read` scope.",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "from",
              in: "query",
              required: true,
              schema: { type: "string", format: "date" },
              description: "Start date (YYYY-MM-DD)",
            },
            {
              name: "to",
              in: "query",
              required: true,
              schema: { type: "string", format: "date" },
              description: "End date (YYYY-MM-DD)",
            },
            {
              name: "groupBy",
              in: "query",
              schema: {
                type: "string",
                enum: ["client", "project"],
                default: "client",
              },
              description: "Group revenue by client or project",
            },
            {
              name: "clientId",
              in: "query",
              schema: { type: "string" },
              description: "Filter by client ID (only when groupBy=project)",
            },
          ],
          responses: {
            "200": {
              description: "Revenue breakdown",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        $ref: "#/components/schemas/RevenueBreakdown",
                      },
                    },
                  },
                },
              },
            },
            "400": {
              description: "Missing required date parameters",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
          },
        },
      },
      "/api/v1/webhooks": {
        get: {
          tags: ["Webhooks"],
          summary: "List webhooks",
          description:
            "Returns all webhook subscriptions. Secrets are masked. Requires `webhooks:read` scope.",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": {
              description: "List of webhooks",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "array",
                        items: { $ref: "#/components/schemas/Webhook" },
                      },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
          },
        },
        post: {
          tags: ["Webhooks"],
          summary: "Create a webhook",
          description:
            "Creates a new webhook subscription. The full signing secret is returned only in this response. Requires `webhooks:write` scope. URL must use HTTPS.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WebhookCreate" },
              },
            },
          },
          responses: {
            "201": {
              description: "Webhook created (includes full secret)",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        $ref: "#/components/schemas/WebhookWithSecret",
                      },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "422": { $ref: "#/components/responses/ValidationError" },
          },
        },
      },
      "/api/v1/webhooks/event-types": {
        get: {
          tags: ["Webhooks"],
          summary: "List available webhook event types",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": {
              description: "Available event types",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            type: { type: "string" },
                            category: { type: "string" },
                            action: { type: "string" },
                            label: { type: "string" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
          },
        },
      },
      "/api/v1/webhooks/{id}": {
        get: {
          tags: ["Webhooks"],
          summary: "Get a webhook",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/Id" }],
          responses: {
            "200": {
              description: "Webhook details",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { $ref: "#/components/schemas/Webhook" },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        patch: {
          tags: ["Webhooks"],
          summary: "Update a webhook",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/Id" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WebhookUpdate" },
              },
            },
          },
          responses: {
            "200": {
              description: "Webhook updated",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { $ref: "#/components/schemas/Webhook" },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        delete: {
          tags: ["Webhooks"],
          summary: "Delete a webhook",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/Id" }],
          responses: {
            "200": { description: "Webhook deleted" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/api/v1/webhooks/{id}/test": {
        post: {
          tags: ["Webhooks"],
          summary: "Send a test event to a webhook",
          description:
            "Sends a test ping event to the webhook URL to verify it's working.",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/Id" }],
          responses: {
            "200": {
              description: "Test result",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "object",
                        properties: {
                          success: { type: "boolean" },
                          statusCode: { type: "integer" },
                          duration: { type: "integer" },
                        },
                      },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/api/v1/webhooks/{id}/deliveries": {
        get: {
          tags: ["Webhooks"],
          summary: "Get delivery history for a webhook",
          security: [{ bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/Id" },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 50, maximum: 100 },
            },
          ],
          responses: {
            "200": {
              description: "List of deliveries",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "array",
                        items: {
                          $ref: "#/components/schemas/WebhookDelivery",
                        },
                      },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/api/v1/timer": {
        get: {
          tags: ["Timer"],
          summary: "Get current timer status",
          description:
            "Returns the current server-synced timer state. Requires `time:read` scope.",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": {
              description: "Timer state",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { $ref: "#/components/schemas/TimerState" },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
          },
        },
        post: {
          tags: ["Timer"],
          summary: "Start or sync timer",
          description:
            "Starts a new timer or syncs existing timer state. Requires `time:write` scope.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TimerSync" },
              },
            },
          },
          responses: {
            "200": {
              description: "Timer synced",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "object",
                        properties: {
                          success: { type: "boolean" },
                          syncedAt: {
                            type: "string",
                            format: "date-time",
                          },
                          version: { type: "integer" },
                        },
                      },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
          },
        },
        delete: {
          tags: ["Timer"],
          summary: "Stop and clear the timer",
          description:
            "Stops the running timer and resets all state. Requires `time:write` scope.",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": {
              description: "Timer cleared",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "object",
                        properties: {
                          success: { type: "boolean" },
                          version: { type: "integer" },
                        },
                      },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
          },
        },
      },
      "/api/v1/invoices/{id}/lines": {
        get: {
          tags: ["Invoices"],
          summary: "List invoice lines",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/Id" }],
          responses: {
            "200": {
              description: "Invoice lines",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "array",
                        items: {
                          $ref: "#/components/schemas/InvoiceLine",
                        },
                      },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        post: {
          tags: ["Invoices"],
          summary: "Create an invoice line",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/Id" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/InvoiceLineCreate",
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Invoice line created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        $ref: "#/components/schemas/InvoiceLine",
                      },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "422": { $ref: "#/components/responses/ValidationError" },
          },
        },
      },
      "/api/v1/invoices/{id}/lines/{lineId}": {
        patch: {
          tags: ["Invoices"],
          summary: "Update an invoice line",
          security: [{ bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/Id" },
            {
              name: "lineId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/InvoiceLineCreate",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Invoice line updated",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        $ref: "#/components/schemas/InvoiceLine",
                      },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        delete: {
          tags: ["Invoices"],
          summary: "Delete an invoice line",
          security: [{ bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/Id" },
            {
              name: "lineId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": { description: "Invoice line deleted" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/api/v1/time-entries/batch": {
        post: {
          tags: ["Time Entries"],
          summary: "Batch operations on time entries",
          description:
            "Perform bulk operations: import, delete, or markBilled. Requires `time:write` scope.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    { $ref: "#/components/schemas/BatchImport" },
                    { $ref: "#/components/schemas/BatchDelete" },
                    { $ref: "#/components/schemas/BatchMarkBilled" },
                  ],
                  discriminator: {
                    propertyName: "operation",
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description:
                "Delete or markBilled operation completed successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { type: "object" },
                    },
                  },
                },
              },
            },
            "201": {
              description:
                "Import operation completed — new time entries were created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "object",
                        properties: {
                          created: { type: "integer" },
                          skipped: { type: "integer" },
                        },
                      },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "422": { $ref: "#/components/responses/ValidationError" },
          },
        },
      },
      "/api/v1/rate-history": {
        get: {
          tags: ["Reports"],
          summary: "Get rate change history",
          description:
            "Returns history of hourly rate changes, filterable by client or project. Requires `reports:read` scope.",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "clientId",
              in: "query",
              schema: { type: "string" },
              description: "Filter by client ID",
            },
            {
              name: "projectId",
              in: "query",
              schema: { type: "string" },
              description: "Filter by project ID",
            },
          ],
          responses: {
            "200": {
              description: "Rate history",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "array",
                        items: {
                          $ref: "#/components/schemas/RateHistoryEntry",
                        },
                      },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
          },
        },
      },
      "/api/v1/rate-changes": {
        get: {
          tags: ["Reports"],
          summary: "List scheduled rate changes",
          description:
            "Returns scheduled hourly rate changes for one client or project (exactly one of clientId/projectId). By default only planned (not yet applied, not cancelled) changes are returned. Requires `reports:read` scope.",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "clientId",
              in: "query",
              schema: { type: "string", format: "uuid" },
              description: "Client ID (client-level changes)",
            },
            {
              name: "projectId",
              in: "query",
              schema: { type: "string", format: "uuid" },
              description: "Project ID (project-level changes)",
            },
            {
              name: "includeInactive",
              in: "query",
              schema: { type: "boolean", default: false },
              description: "Also return applied and cancelled changes",
            },
          ],
          responses: {
            "200": {
              description: "Scheduled rate changes, ordered by effectiveDate",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "array",
                        items: {
                          $ref: "#/components/schemas/ScheduledRateChange",
                        },
                      },
                    },
                  },
                },
              },
            },
            "400": {
              description: "Missing or ambiguous clientId/projectId",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
          },
        },
        post: {
          tags: ["Reports"],
          summary: "Schedule a rate change",
          description:
            "Schedules a new hourly rate for a client or project from `effectiveDate`. Time entries are stamped by their own date: entries dated on/after effectiveDate get newRate, earlier entries keep the old rate — regardless of when they are created. Unbilled entries dated on/after effectiveDate are re-stamped immediately (entries whose rate was set manually are left alone); the response reports how many. The client's/project's current rate is switched by a daily job on effectiveDate (Europe/Copenhagen). effectiveDate may be in the past. Requires `clients:write` (client) or `projects:write` (project) scope.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ScheduledRateChangeCreate",
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Rate change scheduled",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "object",
                        properties: {
                          change: {
                            $ref: "#/components/schemas/ScheduledRateChange",
                          },
                          restamped: {
                            type: "integer",
                            description:
                              "Number of unbilled time entries that got the new rate",
                          },
                          appliesImmediately: {
                            type: "boolean",
                            description:
                              "effectiveDate is today or earlier — the current rate is switched on the next daily run",
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            "400": {
              description: "Invalid rate, date or target",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
            "409": {
              description:
                "An already applied change for the same client/project has a later effectiveDate",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/api/v1/rate-changes/{id}": {
        delete: {
          tags: ["Reports"],
          summary: "Cancel a scheduled rate change",
          description:
            "Cancels a planned rate change. Entries that were re-stamped by it get the previous rate back (unless changed manually since). Applied changes cannot be cancelled (409) — update the client's/project's rate instead. Requires `clients:write` or `projects:write` scope.",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/Id" }],
          responses: {
            "200": {
              description: "Rate change cancelled",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "object",
                        properties: {
                          success: { type: "boolean" },
                          restamped: { type: "integer" },
                        },
                      },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
            "409": {
              description: "The change has already been applied",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "API Key",
          description: "Pass your API key as a Bearer token",
        },
      },
      parameters: {
        Id: {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string" },
          description: "Resource ID",
        },
      },
      responses: {
        Unauthorized: {
          description: "Missing or invalid API key",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
            },
          },
        },
        NotFound: {
          description: "Resource not found",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
            },
          },
        },
        ValidationError: {
          description: "Validation error",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
            },
          },
        },
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                code: { type: "string" },
                message: { type: "string" },
                details: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      field: { type: "string" },
                      message: { type: "string" },
                    },
                  },
                },
              },
              required: ["code", "message"],
            },
          },
        },
        Pagination: {
          type: "object",
          properties: {
            page: { type: "integer", description: "Current page (1-indexed)" },
            limit: { type: "integer", description: "Items per page" },
            total: {
              type: "integer",
              description: "Total number of items across all pages",
            },
            totalPages: {
              type: "integer",
              description: "Total number of pages",
            },
            hasMore: {
              type: "boolean",
              description:
                "True when there are more items after this page. Keep requesting `nextPage` until it is false.",
            },
            nextPage: {
              type: "integer",
              nullable: true,
              description: "The next page number, or null on the last page",
            },
          },
          required: [
            "page",
            "limit",
            "total",
            "totalPages",
            "hasMore",
            "nextPage",
          ],
        },
        Me: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            email: { type: "string", format: "email" },
            image: { type: "string", nullable: true },
            defaultHourlyRate: {
              type: "string",
              nullable: true,
              description: "Default hourly rate",
            },
            timezone: { type: "string", nullable: true },
            workingHoursStart: { type: "string", nullable: true },
            workingHoursEnd: { type: "string", nullable: true },
            weeklyHourGoal: { type: "number", nullable: true },
            createdAt: { type: "string", format: "date-time" },
            apiKey: {
              type: "object",
              properties: {
                id: { type: "string" },
                scopes: {
                  type: "array",
                  items: { type: "string" },
                },
              },
            },
          },
        },
        TimeSummary: {
          type: "object",
          properties: {
            totalHours: { type: "string", description: "Total hours tracked" },
            totalRevenue: {
              type: "string",
              description: "Total revenue (hours * rate)",
            },
            billedHours: {
              type: "string",
              description: "Already billed hours",
            },
            unbilledHours: {
              type: "string",
              description: "Not yet billed hours",
            },
            unbilledRevenue: {
              type: "string",
              description: "Revenue from unbilled hours",
            },
            entriesCount: {
              type: "integer",
              description: "Number of time entries",
            },
          },
        },
        RevenueBreakdown: {
          type: "object",
          properties: {
            groupBy: {
              type: "string",
              enum: ["client", "project"],
            },
            breakdown: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  clientId: { type: "string" },
                  clientName: { type: "string" },
                  projectId: { type: "string" },
                  projectName: { type: "string" },
                  hours: { type: "string" },
                  revenue: { type: "string" },
                },
              },
            },
          },
        },
        Webhook: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            name: { type: "string" },
            url: { type: "string", format: "uri" },
            secret: {
              type: "string",
              description: "Masked signing secret",
            },
            events: {
              type: "array",
              items: { type: "string" },
              description: "Event types this webhook subscribes to",
            },
            clientId: { type: "string", nullable: true },
            projectId: { type: "string", nullable: true },
            isActive: { type: "boolean" },
            retryCount: { type: "integer" },
            timeoutMs: { type: "integer" },
            totalDeliveries: { type: "integer" },
            successfulDeliveries: { type: "integer" },
            failedDeliveries: { type: "integer" },
            consecutiveFailures: { type: "integer" },
            lastDeliveredAt: {
              type: "string",
              format: "date-time",
              nullable: true,
            },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        WebhookWithSecret: {
          allOf: [
            { $ref: "#/components/schemas/Webhook" },
            {
              type: "object",
              properties: {
                secretFull: {
                  type: "string",
                  description:
                    "Full signing secret — only returned at creation time",
                },
              },
            },
          ],
        },
        WebhookCreate: {
          type: "object",
          required: ["name", "url", "events"],
          properties: {
            name: { type: "string", maxLength: 100 },
            url: {
              type: "string",
              format: "uri",
              description: "Must use HTTPS",
            },
            events: {
              type: "array",
              items: { type: "string" },
              minItems: 1,
              description:
                "Event types to subscribe to. Use GET /webhooks/event-types for valid values.",
            },
            clientId: {
              type: "string",
              format: "uuid",
              description: "Optional: only receive events for this client",
            },
            projectId: {
              type: "string",
              format: "uuid",
              description: "Optional: only receive events for this project",
            },
            retryCount: {
              type: "integer",
              minimum: 0,
              maximum: 10,
              default: 3,
            },
            timeoutMs: {
              type: "integer",
              minimum: 1000,
              maximum: 60000,
              default: 30000,
            },
          },
        },
        WebhookUpdate: {
          type: "object",
          properties: {
            name: { type: "string", maxLength: 100 },
            url: { type: "string", format: "uri" },
            events: {
              type: "array",
              items: { type: "string" },
              minItems: 1,
            },
            clientId: { type: "string", format: "uuid", nullable: true },
            projectId: { type: "string", format: "uuid", nullable: true },
            isActive: { type: "boolean" },
            retryCount: { type: "integer", minimum: 0, maximum: 10 },
            timeoutMs: {
              type: "integer",
              minimum: 1000,
              maximum: 60000,
            },
          },
        },
        WebhookDelivery: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            webhookId: { type: "string", format: "uuid" },
            eventType: { type: "string" },
            statusCode: { type: "integer", nullable: true },
            success: { type: "boolean" },
            errorMessage: { type: "string", nullable: true },
            attemptNumber: { type: "integer" },
            durationMs: { type: "integer", nullable: true },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        TimerState: {
          type: "object",
          properties: {
            isRunning: { type: "boolean" },
            startTime: {
              type: "string",
              format: "date-time",
              nullable: true,
            },
            elapsedSeconds: { type: "integer" },
            baseSeconds: { type: "integer" },
            projectId: { type: "string", nullable: true },
            clientId: { type: "string", nullable: true },
            taskId: { type: "string", nullable: true },
            description: { type: "string" },
            project: {
              type: "object",
              nullable: true,
              properties: {
                id: { type: "string" },
                name: { type: "string" },
              },
            },
            client: {
              type: "object",
              nullable: true,
              properties: {
                id: { type: "string" },
                name: { type: "string" },
              },
            },
            version: { type: "integer" },
          },
        },
        TimerSync: {
          type: "object",
          properties: {
            isRunning: { type: "boolean", default: true },
            startTime: {
              type: "integer",
              description: "Unix timestamp in ms",
              nullable: true,
            },
            sessionStartTime: {
              type: "integer",
              description: "Unix timestamp in ms of the current session start",
              nullable: true,
            },
            elapsedSeconds: { type: "integer", default: 0 },
            baseSeconds: { type: "integer", default: 0 },
            projectId: { type: "string", nullable: true },
            clientId: { type: "string", nullable: true },
            taskId: { type: "string", nullable: true },
            description: { type: "string", default: "" },
          },
        },
        InvoiceLine: {
          type: "object",
          properties: {
            id: { type: "string" },
            invoiceId: { type: "string" },
            description: { type: "string" },
            quantity: { type: "string" },
            unitPrice: { type: "string" },
            amount: { type: "string" },
            timeEntryId: { type: "string", nullable: true },
            sortOrder: { type: "integer" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        InvoiceLineCreate: {
          type: "object",
          required: ["description", "unitPrice", "amount"],
          properties: {
            description: { type: "string" },
            quantity: { type: "string", default: "1" },
            unitPrice: { type: "string" },
            amount: { type: "string" },
            timeEntryId: { type: "string" },
            sortOrder: { type: "integer", default: 0 },
          },
        },
        BatchImport: {
          type: "object",
          required: ["operation", "entries"],
          properties: {
            operation: { type: "string", const: "import" },
            entries: {
              type: "array",
              items: {
                type: "object",
                required: ["date", "hours", "description"],
                properties: {
                  date: { type: "string", format: "date" },
                  hours: { type: "number", minimum: 0.01 },
                  description: { type: "string" },
                  projectName: { type: "string" },
                  clientName: { type: "string" },
                },
              },
            },
            defaultProjectId: { type: "string" },
            skipDuplicates: { type: "boolean", default: true },
          },
        },
        BatchDelete: {
          type: "object",
          required: ["operation", "ids"],
          properties: {
            operation: { type: "string", const: "delete" },
            ids: {
              type: "array",
              items: { type: "string", format: "uuid" },
            },
          },
        },
        BatchMarkBilled: {
          type: "object",
          required: ["operation", "ids"],
          properties: {
            operation: { type: "string", const: "markBilled" },
            ids: {
              type: "array",
              items: { type: "string", format: "uuid" },
            },
            isBilled: { type: "boolean", default: true },
          },
        },
        ScheduledRateChange: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            clientId: { type: "string", nullable: true },
            projectId: { type: "string", nullable: true },
            newRate: { type: "string", description: "Decimal as string" },
            oldRate: {
              type: "string",
              nullable: true,
              description: "Rate before the change — set when it is applied",
            },
            effectiveDate: { type: "string", format: "date" },
            status: {
              type: "string",
              enum: ["planned", "applied", "cancelled"],
            },
            appliedAt: { type: "string", format: "date-time", nullable: true },
            cancelledAt: {
              type: "string",
              format: "date-time",
              nullable: true,
            },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        ScheduledRateChangeCreate: {
          type: "object",
          required: ["newRate", "effectiveDate"],
          properties: {
            clientId: {
              type: "string",
              format: "uuid",
              description: "Exactly one of clientId or projectId",
            },
            projectId: {
              type: "string",
              format: "uuid",
              description: "Exactly one of clientId or projectId",
            },
            newRate: {
              type: "string",
              description:
                "New hourly rate, >= 0 with at most two decimals (numbers accepted)",
            },
            effectiveDate: {
              type: "string",
              format: "date",
              description: "YYYY-MM-DD — first day the new rate applies",
            },
          },
        },
        RateHistoryEntry: {
          type: "object",
          properties: {
            id: { type: "string" },
            clientId: { type: "string", nullable: true },
            projectId: { type: "string", nullable: true },
            oldRate: { type: "string" },
            newRate: { type: "string" },
            rateType: { type: "string" },
            effectiveDate: { type: "string", format: "date" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        Client: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            company: { type: "string", nullable: true },
            email: { type: "string", format: "email", nullable: true },
            phone: { type: "string", nullable: true },
            cvrNumber: {
              type: "string",
              nullable: true,
              description: "Danish CVR number (company registration)",
            },
            address: { type: "string", nullable: true },
            city: { type: "string", nullable: true },
            postalCode: { type: "string", nullable: true },
            country: { type: "string", nullable: true },
            defaultHourlyRate: {
              type: "string",
              nullable: true,
              description: "Default hourly rate (decimal as string)",
            },
            currency: { type: "string", default: "DKK" },
            defaultBillable: {
              type: "boolean",
              default: true,
              description:
                "Default billable flag for new time entries created without an explicit isBillable. Set false for internal clients.",
            },
            isArchived: { type: "boolean" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        ClientCreate: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 1 },
            company: { type: "string" },
            email: { type: "string", format: "email" },
            phone: { type: "string" },
            cvrNumber: { type: "string" },
            address: { type: "string" },
            city: { type: "string" },
            postalCode: { type: "string" },
            country: { type: "string" },
            defaultHourlyRate: {
              type: "string",
              description: "Decimal as string",
            },
            currency: { type: "string" },
            defaultBillable: {
              type: "boolean",
              default: true,
              description:
                "Set false for internal clients: new time entries without an explicit isBillable become non-billable.",
            },
          },
        },
        Project: {
          type: "object",
          properties: {
            id: { type: "string" },
            clientId: { type: "string" },
            name: { type: "string" },
            description: { type: "string", nullable: true },
            hourlyRate: {
              type: "string",
              nullable: true,
              description: "Decimal as string",
            },
            fixedPrice: {
              type: "string",
              nullable: true,
              description: "Decimal as string",
            },
            status: {
              type: "string",
              enum: ["active", "completed", "on_hold", "archived"],
            },
            startDate: { type: "string", format: "date", nullable: true },
            endDate: { type: "string", format: "date", nullable: true },
            urlPatterns: {
              type: "array",
              items: { type: "string" },
              nullable: true,
            },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        ProjectCreate: {
          type: "object",
          required: ["clientId", "name"],
          properties: {
            clientId: { type: "string" },
            name: { type: "string", minLength: 1 },
            description: { type: "string" },
            hourlyRate: {
              type: "string",
              description: "Decimal as string",
            },
            fixedPrice: {
              type: "string",
              description: "Decimal as string",
            },
            status: {
              type: "string",
              enum: ["active", "completed", "on_hold", "archived"],
              default: "active",
            },
            startDate: { type: "string", format: "date" },
            endDate: { type: "string", format: "date" },
            urlPatterns: { type: "array", items: { type: "string" } },
          },
        },
        TimeEntry: {
          type: "object",
          properties: {
            id: { type: "string" },
            projectId: { type: "string" },
            clientId: { type: "string", nullable: true },
            description: { type: "string" },
            notes: { type: "string", nullable: true },
            date: { type: "string", format: "date" },
            hours: {
              type: "string",
              description: "Decimal hours as string",
            },
            roundedHours: {
              type: "string",
              description: "Rounded hours per rounding config",
            },
            startTime: {
              type: "string",
              format: "date-time",
              nullable: true,
            },
            endTime: {
              type: "string",
              format: "date-time",
              nullable: true,
            },
            billableRate: { type: "string", nullable: true },
            isBillable: { type: "boolean" },
            isBilled: { type: "boolean" },
            isPrepaid: { type: "boolean" },
            prepaidPackageId: { type: "string", nullable: true },
            taskId: { type: "string", nullable: true },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        TimeEntryCreate: {
          type: "object",
          required: ["description", "hours", "date"],
          properties: {
            projectId: {
              type: "string",
              description: "Either projectId or clientId must be provided",
            },
            clientId: {
              type: "string",
              description: "Either projectId or clientId must be provided",
            },
            description: { type: "string", minLength: 1, maxLength: 500 },
            notes: { type: "string", maxLength: 5000 },
            hours: { type: "number", minimum: 0.01 },
            date: {
              type: "string",
              format: "date",
              description: "YYYY-MM-DD",
            },
            startTime: { type: "string", format: "date-time" },
            endTime: { type: "string", format: "date-time" },
            isBillable: { type: "boolean", default: true },
            isBilled: { type: "boolean" },
            taskId: { type: "string", format: "uuid" },
            billableRate: {
              type: "string",
              description:
                "Explicit rate override (decimal as string). Defaults to the rate hierarchy when omitted — resolved for the entry's own date, so scheduled rate changes (see /api/v1/rate-changes) apply by date.",
            },
            prepaidPackageId: {
              type: "string",
              format: "uuid",
              description:
                "Draw the hours from this prepaid package (klippekort). On PATCH, null removes the deduction. Cannot be combined with `prepaid`.",
            },
            prepaid: {
              type: "string",
              enum: ["auto"],
              description:
                "Set to \"auto\" to draw the hours from the client's klippekort using the same rule as the web app and browser extension: among the client's active packages with auto-deduct and hours left, the one that expires first (packages without expiry last). If the client has no such package, the entry is created without a deduction. On PATCH, an entry already drawn from one of the client's packages keeps it, and billed entries are left unchanged. The client is the entry's clientId, or the project's client.",
            },
            prepaidHoursOverride: {
              type: "number",
              description: "Override hours deducted from klippekort",
            },
          },
        },
        Invoice: {
          type: "object",
          properties: {
            id: { type: "string" },
            clientId: { type: "string" },
            invoiceNumber: { type: "string" },
            status: {
              type: "string",
              enum: ["draft", "sent", "paid", "overdue"],
            },
            issueDate: { type: "string", format: "date" },
            dueDate: { type: "string", format: "date" },
            paidDate: { type: "string", format: "date", nullable: true },
            subtotal: { type: "number" },
            vatAmount: { type: "number" },
            total: { type: "number" },
            currency: { type: "string", default: "DKK" },
            notes: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        InvoiceCreate: {
          type: "object",
          required: ["clientId", "amount", "issueDate"],
          properties: {
            clientId: { type: "string" },
            amount: {
              type: "string",
              description:
                "Total invoice amount (decimal as string, max 2 decimals)",
            },
            status: {
              type: "string",
              enum: ["draft", "sent", "paid", "overdue"],
              default: "draft",
            },
            issueDate: { type: "string", format: "date" },
            dueDate: { type: "string", format: "date" },
            notes: { type: "string" },
            timeEntryIds: {
              type: "array",
              items: { type: "string", format: "uuid" },
              description:
                "Time entry IDs to mark as billed and link to this invoice",
            },
          },
        },
        PrepaidPackage: {
          type: "object",
          description: "Klippekort — a prepaid hours package",
          properties: {
            id: { type: "string" },
            clientId: { type: "string" },
            name: { type: "string" },
            totalHours: { type: "number" },
            usedHours: { type: "number" },
            remainingHours: { type: "number" },
            hourlyRate: { type: "number" },
            status: {
              type: "string",
              enum: ["active", "depleted", "expired"],
            },
            expiresAt: { type: "string", format: "date" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        PrepaidPackageCreate: {
          type: "object",
          required: ["clientId", "name", "totalHours"],
          properties: {
            clientId: { type: "string" },
            name: { type: "string" },
            totalHours: { type: "number", minimum: 0.5 },
            hourlyRate: { type: "number" },
            expiresAt: { type: "string", format: "date" },
          },
        },
        Task: {
          type: "object",
          properties: {
            id: { type: "string" },
            projectId: { type: "string", nullable: true },
            clientId: { type: "string", nullable: true },
            parentTaskId: { type: "string", nullable: true },
            title: { type: "string" },
            description: { type: "string", nullable: true },
            status: {
              type: "string",
              enum: ["backlog", "todo", "in_progress", "done"],
            },
            priority: {
              type: "string",
              enum: ["low", "medium", "high", "urgent"],
            },
            deadline: {
              type: "string",
              format: "date-time",
              nullable: true,
            },
            estimatedMinutes: { type: "integer", nullable: true },
            actualMinutes: { type: "integer", nullable: true },
            position: { type: "integer", nullable: true },
            sourceType: {
              type: "string",
              enum: ["manual", "email", "calendar", "extension"],
              nullable: true,
            },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        TaskCreate: {
          type: "object",
          required: ["title"],
          properties: {
            title: { type: "string", minLength: 1 },
            description: { type: "string" },
            projectId: { type: "string" },
            clientId: { type: "string" },
            status: {
              type: "string",
              enum: ["backlog", "todo", "in_progress", "done"],
            },
            priority: {
              type: "string",
              enum: ["low", "medium", "high", "urgent"],
            },
            deadline: {
              type: "string",
              format: "date-time",
              description: "ISO-8601 date-time",
            },
            parentTaskId: { type: "string" },
            estimatedMinutes: { type: "integer" },
            position: { type: "integer" },
            sourceType: {
              type: "string",
              enum: ["manual", "email", "calendar", "extension"],
            },
            sourceId: { type: "string" },
            sourceUrl: { type: "string", format: "uri" },
          },
        },
      },
    },
  } as const;
}
