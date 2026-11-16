const authentication = {
  type: "custom",
  test: {
    url: "{{bundle.authData.baseUrl}}/api/v1/me",
    method: "GET",
    headers: { Authorization: "Bearer {{bundle.authData.apiKey}}" },
  },
  fields: [
    {
      key: "apiKey",
      label: "API Key",
      required: true,
      type: "string",
      helpText: "Find your API key in TimeTrack → Indstillinger → API Nøgler",
    },
    {
      key: "baseUrl",
      label: "Base URL",
      required: true,
      type: "string",
      default: "https://timetrack.dk",
    },
  ],
  connectionLabel:
    "{{bundle.inputData.data.name}} ({{bundle.inputData.data.email}})",
};

// ---------------------------------------------------------------------------
// Triggers (webhook-based)
// ---------------------------------------------------------------------------

function makeTrigger({ key, noun, label, description, event, sample }) {
  return {
    key,
    noun,
    display: { label, description },
    operation: {
      type: "hook",
      performSubscribe: {
        url: "{{bundle.authData.baseUrl}}/api/v1/webhooks",
        method: "POST",
        headers: {
          Authorization: "Bearer {{bundle.authData.apiKey}}",
          "Content-Type": "application/json",
        },
        body: {
          name: `Zapier: ${label}`,
          url: "{{bundle.targetUrl}}",
          events: [event],
        },
      },
      performUnsubscribe: {
        url: "{{bundle.authData.baseUrl}}/api/v1/webhooks/{{bundle.subscribeData.data.id}}",
        method: "DELETE",
        headers: { Authorization: "Bearer {{bundle.authData.apiKey}}" },
      },
      perform: { source: "return [bundle.cleanedRequest];" },
      sample: { event, data: sample },
    },
  };
}

const newTimeEntry = makeTrigger({
  key: "new_time_entry",
  noun: "Time Entry",
  label: "New Time Entry",
  description: "Triggers when a new time entry is created.",
  event: "time_entry.created",
  sample: {
    id: "abc123",
    description: "Development work",
    hours: "2.50",
    date: "2026-04-06",
    projectId: "proj123",
  },
});

const timeEntryUpdated = makeTrigger({
  key: "time_entry_updated",
  noun: "Time Entry",
  label: "Time Entry Updated",
  description: "Triggers when an existing time entry is updated.",
  event: "time_entry.updated",
  sample: {
    id: "abc123",
    description: "Development work (updated)",
    hours: "3.00",
    date: "2026-04-06",
    projectId: "proj123",
  },
});

const newClient = makeTrigger({
  key: "new_client",
  noun: "Client",
  label: "New Client",
  description: "Triggers when a new client is created.",
  event: "client.created",
  sample: {
    id: "client123",
    name: "Acme Corp",
    email: "contact@acme.dk",
    company: "Acme Corp ApS",
  },
});

const newInvoice = makeTrigger({
  key: "new_invoice",
  noun: "Invoice",
  label: "New Invoice",
  description: "Triggers when a new invoice is created.",
  event: "invoice.created",
  sample: {
    id: "inv123",
    invoiceNumber: "INV-001",
    clientId: "client123",
    totalAmount: "15000.00",
    currency: "DKK",
  },
});

const invoicePaid = makeTrigger({
  key: "invoice_paid",
  noun: "Invoice",
  label: "Invoice Paid",
  description: "Triggers when an invoice is marked as paid.",
  event: "invoice.paid",
  sample: {
    id: "inv123",
    invoiceNumber: "INV-001",
    clientId: "client123",
    totalAmount: "15000.00",
    paidAt: "2026-04-06T12:00:00Z",
  },
});

const prepaidLowBalance = makeTrigger({
  key: "prepaid_low_balance",
  noun: "Prepaid Package",
  label: "Prepaid Package Low Balance",
  description:
    "Triggers when a prepaid hours package (klippekort) reaches a low balance.",
  event: "prepaid.low_balance",
  sample: {
    id: "prepaid123",
    clientId: "client123",
    totalHours: "20.00",
    remainingHours: "2.50",
    thresholdPercent: 15,
  },
});

const taskCompleted = makeTrigger({
  key: "task_completed",
  noun: "Task",
  label: "Task Completed",
  description: "Triggers when a task is marked as completed.",
  event: "task.completed",
  sample: {
    id: "task123",
    title: "Design mockups",
    projectId: "proj123",
    completedAt: "2026-04-06T14:30:00Z",
  },
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

const createTimeEntry = {
  key: "create_time_entry",
  noun: "Time Entry",
  display: {
    label: "Create Time Entry",
    description: "Creates a new time entry.",
  },
  operation: {
    inputFields: [
      { key: "projectId", label: "Project ID", required: true, type: "string" },
      {
        key: "description",
        label: "Description",
        required: false,
        type: "string",
      },
      {
        key: "date",
        label: "Date",
        required: true,
        type: "string",
        helpText: "YYYY-MM-DD format",
      },
      {
        key: "durationMinutes",
        label: "Duration (minutes)",
        required: true,
        type: "integer",
      },
      {
        key: "hourlyRate",
        label: "Hourly Rate",
        required: false,
        type: "number",
      },
      {
        key: "isBillable",
        label: "Billable",
        required: false,
        type: "boolean",
      },
    ],
    perform: {
      url: "{{bundle.authData.baseUrl}}/api/v1/time-entries",
      method: "POST",
      headers: {
        Authorization: "Bearer {{bundle.authData.apiKey}}",
        "Content-Type": "application/json",
      },
      body: {
        projectId: "{{bundle.inputData.projectId}}",
        description: "{{bundle.inputData.description}}",
        date: "{{bundle.inputData.date}}",
        durationMinutes: "{{bundle.inputData.durationMinutes}}",
        hourlyRate: "{{bundle.inputData.hourlyRate}}",
        isBillable: "{{bundle.inputData.isBillable}}",
      },
    },
    sample: {
      id: "abc123",
      description: "Development work",
      durationMinutes: 150,
      date: "2026-04-06",
      projectId: "proj123",
    },
  },
};

const createClient = {
  key: "create_client",
  noun: "Client",
  display: {
    label: "Create Client",
    description: "Creates a new client.",
  },
  operation: {
    inputFields: [
      { key: "name", label: "Name", required: true, type: "string" },
      { key: "email", label: "Email", required: false, type: "string" },
      { key: "phone", label: "Phone", required: false, type: "string" },
      { key: "company", label: "Company", required: false, type: "string" },
      {
        key: "cvrNumber",
        label: "CVR Number",
        required: false,
        type: "string",
      },
    ],
    perform: {
      url: "{{bundle.authData.baseUrl}}/api/v1/clients",
      method: "POST",
      headers: {
        Authorization: "Bearer {{bundle.authData.apiKey}}",
        "Content-Type": "application/json",
      },
      body: {
        name: "{{bundle.inputData.name}}",
        email: "{{bundle.inputData.email}}",
        phone: "{{bundle.inputData.phone}}",
        company: "{{bundle.inputData.company}}",
        cvrNumber: "{{bundle.inputData.cvrNumber}}",
      },
    },
    sample: {
      id: "client123",
      name: "Acme Corp",
      email: "contact@acme.dk",
      company: "Acme Corp ApS",
    },
  },
};

const createTask = {
  key: "create_task",
  noun: "Task",
  display: {
    label: "Create Task",
    description: "Creates a new task.",
  },
  operation: {
    inputFields: [
      { key: "projectId", label: "Project ID", required: true, type: "string" },
      { key: "title", label: "Title", required: true, type: "string" },
      {
        key: "description",
        label: "Description",
        required: false,
        type: "string",
      },
      {
        key: "status",
        label: "Status",
        required: false,
        type: "string",
        helpText: "e.g. todo, in_progress, done",
      },
      {
        key: "priority",
        label: "Priority",
        required: false,
        type: "string",
        helpText: "e.g. low, medium, high",
      },
    ],
    perform: {
      url: "{{bundle.authData.baseUrl}}/api/v1/tasks",
      method: "POST",
      headers: {
        Authorization: "Bearer {{bundle.authData.apiKey}}",
        "Content-Type": "application/json",
      },
      body: {
        projectId: "{{bundle.inputData.projectId}}",
        title: "{{bundle.inputData.title}}",
        description: "{{bundle.inputData.description}}",
        status: "{{bundle.inputData.status}}",
        priority: "{{bundle.inputData.priority}}",
      },
    },
    sample: {
      id: "task123",
      title: "Design mockups",
      projectId: "proj123",
      status: "todo",
      priority: "medium",
    },
  },
};

const startTimer = {
  key: "start_timer",
  noun: "Timer",
  display: {
    label: "Start Timer",
    description: "Starts a new timer for time tracking.",
  },
  operation: {
    inputFields: [
      { key: "projectId", label: "Project ID", required: true, type: "string" },
      { key: "clientId", label: "Client ID", required: false, type: "string" },
      {
        key: "description",
        label: "Description",
        required: false,
        type: "string",
      },
    ],
    perform: {
      url: "{{bundle.authData.baseUrl}}/api/v1/timer",
      method: "POST",
      headers: {
        Authorization: "Bearer {{bundle.authData.apiKey}}",
        "Content-Type": "application/json",
      },
      body: {
        projectId: "{{bundle.inputData.projectId}}",
        clientId: "{{bundle.inputData.clientId}}",
        description: "{{bundle.inputData.description}}",
      },
    },
    sample: {
      id: "timer123",
      projectId: "proj123",
      startedAt: "2026-04-06T09:00:00Z",
    },
  },
};

const stopTimer = {
  key: "stop_timer",
  noun: "Timer",
  display: {
    label: "Stop Timer",
    description: "Stops the currently running timer.",
  },
  operation: {
    inputFields: [],
    perform: {
      url: "{{bundle.authData.baseUrl}}/api/v1/timer",
      method: "DELETE",
      headers: {
        Authorization: "Bearer {{bundle.authData.apiKey}}",
      },
    },
    sample: {
      id: "timer123",
      projectId: "proj123",
      startedAt: "2026-04-06T09:00:00Z",
      stoppedAt: "2026-04-06T11:30:00Z",
      durationMinutes: 150,
    },
  },
};

// ---------------------------------------------------------------------------
// Searches
// ---------------------------------------------------------------------------

const findClient = {
  key: "find_client",
  noun: "Client",
  display: {
    label: "Find Client",
    description: "Finds a client by name or email.",
  },
  operation: {
    inputFields: [
      {
        key: "query",
        label: "Search Query",
        required: true,
        type: "string",
        helpText: "Search by client name or email",
      },
    ],
    perform: {
      url: "{{bundle.authData.baseUrl}}/api/v1/clients?q={{bundle.inputData.query}}",
      method: "GET",
      headers: {
        Authorization: "Bearer {{bundle.authData.apiKey}}",
      },
    },
    sample: {
      id: "client123",
      name: "Acme Corp",
      email: "contact@acme.dk",
      company: "Acme Corp ApS",
    },
  },
};

const findProject = {
  key: "find_project",
  noun: "Project",
  display: {
    label: "Find Project",
    description: "Finds projects by client.",
  },
  operation: {
    inputFields: [
      {
        key: "clientId",
        label: "Client ID",
        required: true,
        type: "string",
        helpText: "Filter projects by client ID",
      },
    ],
    perform: {
      url: "{{bundle.authData.baseUrl}}/api/v1/projects?clientId={{bundle.inputData.clientId}}",
      method: "GET",
      headers: {
        Authorization: "Bearer {{bundle.authData.apiKey}}",
      },
    },
    sample: {
      id: "proj123",
      name: "Website Redesign",
      clientId: "client123",
      status: "active",
    },
  },
};

// ---------------------------------------------------------------------------
// App export
// ---------------------------------------------------------------------------

module.exports = {
  version: require("./package.json").version,
  platformVersion: require("zapier-platform-core").version,
  authentication,
  triggers: {
    [newTimeEntry.key]: newTimeEntry,
    [timeEntryUpdated.key]: timeEntryUpdated,
    [newClient.key]: newClient,
    [newInvoice.key]: newInvoice,
    [invoicePaid.key]: invoicePaid,
    [prepaidLowBalance.key]: prepaidLowBalance,
    [taskCompleted.key]: taskCompleted,
  },
  actions: {
    [createTimeEntry.key]: createTimeEntry,
    [createClient.key]: createClient,
    [createTask.key]: createTask,
    [startTimer.key]: startTimer,
    [stopTimer.key]: stopTimer,
  },
  searches: {
    [findClient.key]: findClient,
    [findProject.key]: findProject,
  },
};
