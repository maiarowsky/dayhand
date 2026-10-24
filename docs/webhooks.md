# Webhooks

Since backend 0.8.0, Dayhand can tell other systems about changes as they happen: a webhook is an
HTTPS address that gets a signed `POST` for every change of a task. Messages follow
[Standard Webhooks](https://www.standardwebhooks.com), so any of its verification libraries
(JavaScript, Python, Go, …) checks them.

Webhooks are managed with a full API key through the REST API ([api.md](api.md)) or `dayhand`:

```sh
dayhand webhook add https://n8n.example.com/webhook/dayhand --event task.completed --event task.created
dayhand webhook list
dayhand webhook test <id>
dayhand webhook deliveries <id>
dayhand webhook rm <id> --yes
```

| Route | What it does |
|---|---|
| `GET /api/v1/webhooks` | Every webhook (never its secret) |
| `POST /api/v1/webhooks` | `{ "url": "https://…", "events": ["task.completed"], "description": "n8n" }` → `{ webhook, secret }` (`201`); the secret is shown only here |
| `GET /api/v1/webhooks/{id}` | One webhook |
| `DELETE /api/v1/webhooks/{id}` | Removes it and its delivery log; messages still waiting are dropped |
| `POST /api/v1/webhooks/{id}/test` | Sends a `webhook.test` message now (`202`), also to a webhook that is turned off |
| `POST /api/v1/webhooks/{id}/enable` | Turns it back on after it was turned off for failing |
| `GET /api/v1/webhooks/{id}/deliveries?limit=50` | The delivery log: newest first, each attempt with its time, duration, HTTP status or error, and the body sent |

A user may have at most 10 webhooks.

## Events

| Type | When |
|---|---|
| `task.created` | A task is added (also the next occurrence of a repeating task, and imported tasks) |
| `task.updated` | A task's fields, status or now flag change, it is archived, or it is claimed or released (`claim_task`, `release_task`; renewing a claim sends nothing) |
| `task.completed` | A task is marked done |
| `task.deleted` | A task goes to the trash |
| `task.restored` | A task comes back from the trash or the archive |
| `now.changed` | A task becomes the now task or stops being it (one message per task whose flag changed) |
| `approval.decided` | The owner decided an approval request (`request_approval`, since 0.11.0); `data.approval` is the request with its decision ([schema](schemas/approval.schema.json)) |
| `task.returned` | Only to the webhooks a task names in `returnTo`, whatever they subscribe to: the task was completed, rejected or merged into another task (since 0.11.0) |
| `webhook.test` | Only from `POST …/test` |

Leaving out `events` subscribes to the task events and `now.changed`; `approval.decided` has to be
listed, because its `data` holds an approval, not a task. Changes from every surface count: the app,
MCP, the REST API and `dayhand`. A dry run (`dryRun`) sends nothing, and neither does a change that
fails: the message is queued in the same transaction as the change.

The body (`docs/schemas/webhook-event.schema.json`):

```json
{
  "type": "task.updated",
  "timestamp": "2026-11-03T09:12:44.120Z",
  "data": { "task": { "id": "…", "ref": 42, "title": "Dentist at 15:30", "status": "todo", "…": "…" } },
  "previous": { "title": "Dentist" },
  "actor": { "type": "agent", "name": "n8n" }
}
```

`data.task` is the task after the change, in the same shape as everywhere else
([schemas/task.schema.json](schemas/task.schema.json)). `previous` holds only the fields that
changed, with their values before (`{}` for a new task). `actor` is who made the change: `app`,
`cli` or `agent` and the key's or client's name. `now.changed` adds `data.isNow`. Fields may be
added in a minor version.

`task.returned` is how an agent or an integration that asked for a task hears back
([agent-work.md](agent-work.md#7-the-proposal-inbox)). Its `data` holds `outcome` (`completed`,
`rejected` or `merged`), `task`, `proof` (the task's proof or `null`), `source`, `requestedBy`,
and `reason` (rejected) or `mergedInto` (merged: the task it went into, whose own completion
sends `completed` later). A turned-off webhook gets nothing.

## Verifying a message

Every message carries three headers:

| Header | Value |
|---|---|
| `webhook-id` | The message id, e.g. `msg_kn74…`. The same on every retry: store it and drop a message you have already handled |
| `webhook-timestamp` | When this attempt was sent, Unix seconds. Reject messages older than a few minutes (replays) |
| `webhook-signature` | `v1,<base64>`: HMAC-SHA256 of `<webhook-id>.<webhook-timestamp>.<body>` with the secret's bytes (the base64 after `whsec_`) |

With the reference library:

```js
import { Webhook } from "standardwebhooks";
const payload = new Webhook(process.env.DAYHAND_WEBHOOK_SECRET).verify(rawBody, headers); // throws when not genuine
```

Verify the raw body exactly as received, before parsing it. To change a secret, add a new
webhook, move the receiver to its secret, then remove the old one.

## Delivery, retries and turning off

A delivery succeeds on any `2xx` answer within 10 seconds. Anything else (another status, a
timeout, a refused connection, a redirect, which is never followed) is retried with the same
`webhook-id` and body after 5 s, 5 min, 30 min, 2 h, 5 h, 10 h and 10 h: eight attempts in about
27 hours. Messages can arrive more than once and out of order; use `webhook-id` and the
`timestamp` in the body.

When 5 deliveries in a row fail on every attempt, the webhook is **turned off**: `enabled:
false`, `disabledAt` and `disabledReason` in `dayhand webhook list` and `GET /webhooks`, and a
`webhook.disable` entry in the history. Changes then send nothing to it. Fix the receiver, check
it with `dayhand webhook test <id>`, and turn it on with `dayhand webhook enable <id>`. A successful
delivery sets the count back to 0; test messages do not count.

The delivery log keeps 30 days (a daily cron removes older entries).

## Security

- **Only HTTPS on public hosts.** Dayhand refuses (when the webhook is added, and again before each
  attempt) `http://`, user names or passwords in the URL, `localhost` and names under `.local`,
  `.internal`, `.localhost`, `.home.arpa`, `.lan`, `.corp`, `.intranet`, single-label names, and
  IP addresses that are loopback, private, link-local (cloud metadata such as 169.254.169.254),
  carrier-grade NAT, multicast or reserved, in IPv4 or IPv6 (also IPv4-mapped). Redirects are
  not followed. What remains: a public name whose DNS points at a private address (DNS
  rebinding). Convex runs the requests from its own network, not the user's, which limits what
  such a name could reach; on a self-hosted deployment, keep the backend's outbound traffic away
  from internal services.
- `DAYHAND_WEBHOOK_ALLOWED_ORIGINS` (comma-separated origins, e.g. `http://127.0.0.1:8080`)
  exempts those exact origins from the rules, for tests or a receiver on a self-hosted
  deployment's own network. Production leaves it unset.
- The secret is stored as it is, because every message is signed with it, and is shown only
  once. Anyone with admin access to the deployment can read it. A webhook sends the user's own
  tasks to an address the user chose, so managing webhooks needs a full key: a read or write key
  for an integration cannot add one.
- The message body has the task's title, note and other fields. Treat the receiver like any
  place that stores the plan.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `DAYHAND_WEBHOOK_ALLOWED_ORIGINS` | unset | Origins exempt from the address rules (above) |
| `DAYHAND_WEBHOOK_RETRY_DELAYS` | `5,300,1800,7200,18000,36000,36000` | Seconds before each retry; the number of values is the number of retries |
