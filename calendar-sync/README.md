# Notion ↔ Google Calendar sync

A Cloudflare Worker maintains task/calendar mirrors using a dedicated D1 state database. Notion owns task identity and status. This component owns generated work events; the organizer must not create a second copy.

Use a test Notion database and test task calendar for initial setup. Deployment enables the schedule in `wrangler.toml`, so configure the intended scope before deploying.

## 1. Prepare account access

- Create your own Notion integration and give it access to the intended database. The database schema must match [the setup guide](../docs/SETUP.md#3-configure-your-task-source-and-scope).
- In your Google project, enable the Google Calendar API and configure an OAuth client/consent flow for the calendar owner. Obtain a refresh token through that account's approved consent flow with the needed calendar permissions. No token-generation/login helper is bundled here.
- Create a dedicated Google Calendar for task work and obtain its calendar ID. Make sure the authorized Google account can edit it.
- Choose your Worker's public base URL. Configure a custom hostname or use the actual workers.dev URL consistently; do not keep `calendar-sync.example.com`.

Agent connector permissions and Worker integration permissions are separate. Opening Notion or Calendar on your Mac does not authorize this Worker.

## 2. Install and create state storage

Run these commands from `calendar-sync/`:

```sh
npm ci
npm run test:worker
npm run typecheck
npx wrangler login
npx wrangler d1 create notion_calendar_sync
```

Copy the returned database ID into `wrangler.toml` → `d1_databases.database_id`. Set your own Worker name and `vars.PUBLIC_BASE_URL`; review the schedules and timezone. Keep `database_name = "notion_calendar_sync"` unless you also update the database name in the migration commands in `package.json`. Do not reuse the collector database or another person's IDs.

Local development uses `npm run dev:worker`. Copy `.env.example` to the ignored `.env` for that local workflow. It does not provision production secrets.

## 3. Configure production secrets

Use `npx wrangler secret put NAME` for each credential, entering values at its prompt:

| Name | Your value |
| --- | --- |
| `NOTION_API_KEY` | Integration token with access to your selected database |
| `DATABASE_ID` | Your Notion database ID |
| `GOOGLE_CALENDAR_ID` | Your dedicated task calendar |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Your Google OAuth client |
| `GOOGLE_REFRESH_TOKEN` | Refresh token granted by the intended Google account |
| `SYNC_SECRET` | A separate random secret protecting manual operations |
| `GOOGLE_WEBHOOK_TOKEN` | A separate random token for calendar watch verification |

`PUBLIC_BASE_URL` is configuration, not a secret; set it to the actual deployed endpoint. [`.env.example`](.env.example) lists all expected values. Never commit a populated environment file or paste tokens into URLs.

## 4. Migrate and deploy

```sh
npm run d1:migrate:remote
npm run deploy:worker
```

The migration command targets the database configured in `wrangler.toml`. Check its identity before accepting a production operation. The Worker schedule and optional webhooks perform synchronization; there is no need to add a widget-driven job.

## 5. Verify before expanding scope

Check `/health` at your own base URL for configuration readiness. Then use one approved test task:

1. Give it a future `Do Date` start/end and an eligible status/scope. Keep `Due Date` as a real deadline if one exists.
2. Confirm one event appears in the selected task calendar.
3. Move the task's work date and confirm the existing event updates instead of duplicating it.
4. Verify the expected handling of a completed/fixed task and calendar-side edits against the current sync rules before enabling a broader database.

A successful Notion update is not proof of the calendar mirror. Inspect the task, event and Worker state before retrying; do not manually create another work event to cover an unexplained failure.

Manual helpers are in `scripts/drain-sync.mjs`. `sync:prod:*` scripts change live state, so use them only with the intended credentials, scope and authorization. See [Architecture](../docs/ARCHITECTURE.md) and [Operations](../docs/OPERATIONS.md).
