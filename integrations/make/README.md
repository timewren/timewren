# TimeTrack Make Integration

## Setup

1. Go to Make.com -> Custom Apps -> Create
2. Use these module definitions
3. Set Base URL to `https://timetrack.dk`
4. Set API Key in connection settings

## Authentication

- Type: API Key
- Header: `Authorization: Bearer {apiKey}`
- Test URL: `GET /api/v1/me`

## Modules

### Watch Triggers (Webhook-based)

- New Time Entry (time_entry.created)
- New Client (client.created)
- New Invoice (invoice.created)
- Invoice Paid (invoice.paid)
- Prepaid Low Balance (prepaid.low_balance)
- Task Completed (task.completed)

### Actions

- Create Time Entry (POST /api/v1/time-entries)
- Create Client (POST /api/v1/clients)
- Create Task (POST /api/v1/tasks)
- Start Timer (POST /api/v1/timer)
- Stop Timer (DELETE /api/v1/timer)

### Searches

- Find Client (GET /api/v1/clients?q=)
- Find Project (GET /api/v1/projects?clientId=)
