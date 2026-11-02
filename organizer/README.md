# Local organizer

The organizer combines complete task and calendar snapshots, preserves user decisions and prepares verified work plans and editorial board data. The reasoning/evaluation cycle is supplied by your local agent; this folder is not a standalone autonomous service.

## Entry points

| Script | Purpose |
| --- | --- |
| `normalize-notion.py` | Validate complete paginated source data and generate typed snapshots/manifests |
| `local-calendars.py` | Merge allowed native calendar availability into a fresh planning snapshot |
| `plan-rolling-tasks.py` | Reflow eligible not-started work after missed blocks |
| `plan-current-tasks.py` | Propose work dates for missing eligible tasks |
| `run-mac-sync.py` | Preview/apply verified file sync under the shared lease |
| `process-mail-documents.py` | Inventory, route and file approved mail PDFs |
| `fetch-mail-pdf.py` | Retrieve allowlisted public HTTPS document links |
| `update-mail-security.py` | Refresh local malware signatures, at most daily |
| `check-widget-text.py` | Flag likely missing spaces in editorial display fields |
| `lease.py` | Shared run coordination |
| `build-apple-store.py` | Build the EventKit helper |

All scripts are under `scripts/`; reusable logic is under `lib/`. Start with `profile.example.json`, keep the real profile local and ignored, then follow [Setup](../docs/SETUP.md). Mail document routes are disabled in the example until configured.

The planner does not replace the calendar-sync worker. Preserve actual statuses, fixed tasks, real deadlines and appointments. Do not schedule from partial source views or fabricate travel/opening hours. See [Operations](../docs/OPERATIONS.md), [Board](../docs/BOARD.md) and [Security](../docs/SECURITY.md).
