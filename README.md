# Life Organizer

A personal organizer for university, research, career and everyday life. It turns verified source changes into deduplicated Notion tasks, plans work against selected calendars and preserves real deadlines and fixed appointments.

## Components

- `collector/`: read-only Cloudflare MCP collector with resumable change journal, Moodle/TUM integrations and metadata-only Netsec monitoring.
- `organizer/`: offline planning, verified file sync and shared run lock. Start from `profile.example.json`; keep your actual profile private.
- `calendar-sync/`: existing Notion ↔ Google Calendar worker, including new standalone personal tasks.

## Planning policy

Notion is the task source of truth. `Fixiert` protects a task from automatic moves. Missed `not started` blocks can be replanned; completed/in-progress work is preserved. Working window08:30–21:30,15-minute buffer, flexible daily target. Important deadlines aim for completion the previous day. Same-course lecture blocks may host older unfinished lectures; verified own-work blocks may host matching work. Real appointments remain protected.

Only create personal tasks from concrete source evidence. A shipment announcement is not pickup readiness. Do not invent deadlines or publish pickup codes, credentials or private message contents. Selected Apple reminders are deadline alerts, not a second full task list. Source collection is not permission to send messages, register for exams, submit coursework or solve restricted challenges.

## Setup

1. Configure and deploy the collector following its README. Use Worker Secrets for credentials.
2. Configure the calendar-sync Worker with your own Notion/Google credentials; apply its D1 migrations. Never commit `.env` files.
3. Copy `organizer/profile.example.json` to a local ignored `profile.json`, configure source/context/calendar IDs and individual durations.
4. Provide complete fresh Notion and calendar snapshots/manifests before running planners. Use a local scheduled Codex runner to evaluate changes and execute reviewed task plans; the source collector does not call an LLM API.
5. Use `python3 organizer/scripts/run-mac-sync.py` for preview/apply with a shared lock. The local application must be running for local evaluation/UI fallbacks.

```sh
cd collector && npm ci && npm test && npm run type-check
cd ../calendar-sync && npm ci && npm run test:worker && npm run typecheck
cd ../organizer && python3 scripts/test_rolling_plan.py && python3 scripts/test_sync_files.py
```

This is a sanitized code snapshot, not a backup of a personal deployment. No personal configuration, messages, source materials, runtime journals or pre-existing private Git history are included. Use your own resource IDs, OAuth settings and permissions.

## Credits

The original TUM collector was built by **Max Michels**: [mxmichels17/tum-mcp](https://github.com/mxmichels17/tum-mcp). It is MIT-licensed; its original copyright and license are preserved in `collector/LICENSE` and the root `LICENSE`. Life Organizer extends that foundation with personal planning, private-task support, reminders and verified file organization.
