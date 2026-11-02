# Notion ↔ Google Calendar sync

Cloudflare Worker and D1 state for the existing task/calendar mirror. Notion owns task status and task identity. This component owns calendar copies of planned task work; the organizer must not create duplicate copies.

## Setup

1. Review `.env.example` and set your own Notion/Google credentials using the deployment's secret configuration.
2. Replace D1 and public-origin placeholders in `wrangler.toml`.
3. Run `npm ci`, `npm run test:worker` and `npm run typecheck`.
4. Apply migrations with the correct local/remote script, deploy, then verify a real task and its mirror.

Local development: `npm run dev:worker`. Manual synchronization helpers are in `scripts/drain-sync.mjs`; the production scripts change live state and require the configured authorization.

A successful Notion update is not proof that its calendar mirror is visible. Preserve IDs and inspect the existing worker state before retrying. See [architecture](../docs/ARCHITECTURE.md) and [operations](../docs/OPERATIONS.md).
