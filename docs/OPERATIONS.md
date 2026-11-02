# Operations

## One organizer cycle

1. Acquire the shared lease; defer writes if another run owns it.
2. Read collector metadata and all pages of deltas. Resume pending actions as well as new changes.
3. Read complete Notion snapshots and selected Google/native calendar coverage. Normalize and hash manifests.
4. Deduplicate concrete actions. Plan only supported changes, preserve status/fixed work and read changes back.
5. Save dispositions before acknowledging a contiguous collector range. Do not skip unprocessed changes.
6. Write the editorial board from verified evidence. Run `python3 organizer/scripts/check-widget-text.py /path/to/widget-board.json` to flag likely spacing mistakes; it does not rewrite content.
7. Publish through the existing adapter, then read the protected feed back. Report source coverage, timestamps, pending sync and missing access honestly.
8. Release the lease in `finally`.

## Refresh and limits

The Mac widget has no periodic content refresh. A successful organizer run invokes `publish-feed.py --publish` once; only changed content is uploaded and that one Mac widget is refreshed. The display selector checks attached monitors every 15 seconds without querying Cloudflare. Scriptable requests a refresh no earlier than 15 minutes; iOS decides actual scheduling. Reimport the script after code changes; board content changes use the existing feed.

## Recovery

| Symptom | Check |
| --- | --- |
| Old phone content | Board source time, awake Mac, Übersicht, publisher result and device cache |
| Board not displayed | Valid source file, desktop config, Übersicht widget visibility and running Applications copy |
| Planning refused | Complete manifests, current native availability, actual deadlines and capacity conflicts |
| Calendar mirror pending | Existing sync worker and record IDs; do not create another copy |
| Document blocked | Scanner, fresh signatures, quarantine and isolation; do not disable checks |
| Mail draft does not open | Actual provider support and saved draft identity; avoid duplicate drafts |

A failed source does not invalidate independent verified work. It does prevent claims of complete current coverage. Do not recover another agent's lease by age alone; only the existing lease rules allow recovery of a provably dead process-owned lock.

Widget publication is run-driven: after a successful verified board write, call the installed `publish-feed.py --publish` once. No widget content timer or periodic upload job. Unchanged content is not uploaded. The display helper only selects the monitor locally; iOS may still fetch the saved feed on its own schedule.
