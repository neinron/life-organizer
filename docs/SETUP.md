# Set up your own Life Organizer

This guide takes you from a fresh checkout to a first verified organizer run, then adds calendar synchronization, documents and widgets. Start with a small scope and enable additional components after the core workflow works.

**What you are installing:** source connectors, a journal, local planning/file tools and optional displays. **What you must provide:** your own accounts, permissions, task database, calendars and an agent that reads the sources and makes decisions. There is no bundled model/API key, personal automation or single command that starts a complete executive assistant.

## 1. Choose the components you need

| Component | Needed for | What you provide |
| --- | --- | --- |
| Local organizer + agent | Evaluation and planning | An agent with local file access and approved source connections |
| Notion | Task source of truth | Your own task database and access for the agent/integration |
| Calendar access | Availability-aware plans | The calendars that actually constrain your time |
| Cloudflare collector | Bundled university/mail sources | Cloudflare, GitHub OAuth and credentials for your selected sources |
| Calendar-sync Worker | Automatic task/calendar mirrors | Notion integration, Google OAuth and a dedicated task calendar |
| Native Mac helper | Exchange/iCloud availability and selected reminders | macOS permissions and an explicit calendar allowlist |
| Mail PDF processing | Verified local filing | Existing destination folders and local scanner dependencies |
| Übersicht / Scriptable | Mac / iPhone overview | The relevant apps; a private feed for iPhone |

The bundled university adapters target TUM services. They are not generic university connectors or a universal Gmail/Outlook inbox integration. If they do not fit your accounts, use your agent's approved source connections or adapt the collector. Do not enter unrelated service credentials into a TUM configuration.

## 2. Prepare your Mac and checkout

The complete local workflow targets macOS. Native calendar/reminder access uses EventKit; PDF isolation uses macOS facilities. Use macOS 14 or later, Xcode Command Line Tools (`swiftc` and `codesign`), Git, Node.js 24 LTS and a compatible Python installation (3.11+ recommended).

From a directory where you keep projects:

```sh
git clone https://github.com/neinron/life-organizer.git
cd life-organizer
node --version
python3 --version
swiftc --version
cp organizer/profile.example.json organizer/profile.json
```

Install the Python dependencies with your chosen Python installation. The isolated PDF inspector currently resolves dependencies from that interpreter's **user site**, so its supported path is:

```sh
python3 -m pip install --user -r organizer/requirements.txt
```

If your Python distribution blocks user installs, use a separate Python installation that supports them or adapt and test the inspector's dependency paths. Simply placing packages in an arbitrary virtual environment is not sufficient for this inspector. PDF processing can stay disabled while you set up the core organizer.

**Checkpoint:** `organizer/profile.json` exists locally and is ignored by Git. Real source exports, files and journals belong under the ignored `organizer/runtime/`, not in documentation or fixtures.

## 3. Configure your task source and scope

Give your agent access to the correct Notion workspace/database. If using the calendar-sync Worker, also give its own Notion integration access to that database; the agent's connector access does not automatically authorize the Worker.

The supplied parsers expect these property names. Reuse them or deliberately adapt the parsers to your schema:

| Property | Type / meaning |
| --- | --- |
| `Name` | Title |
| `Status` | Status; planners recognize exact eligible values such as `not started` |
| `Do Date` | Date range for planned work, including start and end |
| `Due Date` | Actual deadline, separate from planned work |
| `Fixiert` | Checkbox protecting a task from automatic rescheduling |
| `Codex Logs` | Rich text used by planning change payloads |
| `Course`, `Registration` | Course relation/registration data when academic scoping is enabled |
| `Type`, `Priority` | Optional select fields read by adapters |
| `Synced with Google` | Select used by calendar sync, including `synced` and `deleted` |

See [`normalize-notion.py`](../organizer/scripts/normalize-notion.py), [planning scope](../organizer/scripts/planning_scope.py) and [calendar serialization](../calendar-sync/worker/src/serialize.ts) for the exact expectations. There is no automatic Notion database creator. Start with one synthetic test task in a test database or an explicitly approved task scope.

Edit `organizer/profile.json`:

- Set your timezone, actual document root and semester folder if relevant.
- Configure `courses` / `excluded_courses` only for your own scope; leave academic sources empty when unused.
- In `planning`, choose work start, capacity, actual task durations and protected/deferred tasks. Keep `enabled` false during configuration. Enable it only to generate reviewed proposals from verified inputs; this flag does not authorize applying them.
- Replace the example `personal.standalone_created_since` with your deliberate inclusion boundary. It controls which unlinked personal tasks qualify; it is not an installation date to accept blindly.
- Configure actual calendar IDs. Keep `local_calendars.enabled` false until you have discovered and selected the native calendars.
- Keep `mail_documents.enabled` false until the scanner and routes are ready.

Some planning adapters retain workflow-specific assumptions. Review the scoping/status rules and task ordering before using them on a different database. A copied example profile alone does not make every existing task eligible.

**Checkpoint:** your agent can read the selected test task, its status and both date fields. Unrelated or protected tasks remain outside the proposed change set.

## 4. Connect sources and calendars

### Bundled Cloudflare collector

Skip this subsection if you are starting with supported direct source connections instead.

From the repository root:

```sh
npm --prefix collector ci
npm --prefix collector test
npm --prefix collector run type-check
```

Customize `collector/wrangler.jsonc`: choose your Worker/resource names, set `PUBLIC_ORIGIN` to your own Worker URL and review the collection schedule. Configure only your own sources in `collector/config/`.

Follow the [collector authentication guide](../collector/README.md#github-oauth-app): create your own GitHub OAuth app with a callback at your Worker's `/callback`; configure `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `ALLOWED_GITHUB_LOGIN` and the appropriate source secrets. Store credentials in Cloudflare Secrets, not JSON, URLs or source files. The exact source-specific names are in [`collector/.env.example`](../collector/.env.example).

Deploy **from `collector/`** using `npx wrangler login` and `npx wrangler deploy`, or configure Workers Builds with the repository root directory set to **`collector`**. First provisioning may require enabling the relevant storage products in your own account. Read the collector guide for resource setup; do not copy another deployment's resource IDs.

Add `https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp` to a compatible authenticated MCP client and complete its GitHub authorization. Verify `server_info`, the actual tool list and a read-only source lookup. `/mcp` uses stateless requests; do not reintroduce persistent sessions to handle ordinary tool calls.

**Checkpoint:** your authorized account can access the tools, an unauthenticated request is rejected, and the selected source is actually readable. A successful deployment alone proves none of those source permissions.

### Google and native calendars

Connect the agent to the Google calendars it should read. Select a dedicated calendar for task mirrors if enabling synchronization later. Keep real appointments distinct from generated task work.

For Exchange/iCloud calendars already added to macOS Calendar, build and authorize the native helper:

```sh
python3 organizer/scripts/build-apple-store.py
organizer/runtime/bin/apple-store status
organizer/runtime/bin/apple-store request-access --kind events
organizer/runtime/bin/apple-store calendars
```

Approve the system prompt and put only the intended calendar IDs into `profile.json` → `local_calendars.calendar_ids`, then enable that section. Grant reminder access separately, only if using reminder alerts:

```sh
organizer/runtime/bin/apple-store request-access --kind reminders
```

The helper cannot write calendar events. Reminder commands have their own preview/apply behavior. Build it with a stable identity; if distributing your own fork as a separate app, review its bundle identifier and permission descriptions in the build script.

**Checkpoint:** read a known appointment in the exact selected calendar and planning window. Seeing the calendar name alone does not establish complete availability.

## 5. Configure the reasoning agent and perform a supervised first run

Give the agent the repository/local organizer path, your intended task database, permitted source connections, calendar scope, priorities and explicit action permissions. Keep credentials in the connections themselves. Use [the starter instructions](templates/organizer-instructions.md) as a starting point, then adapt the policy to your own needs.

That template is deliberately **not an installed automation**. Configure it in your chosen agent, and start manually with proposals only. A recurring schedule is a separate step after the supervised workflow is verified.

The first run should:

1. Establish the shared lease and actual source coverage.
2. Read one complete, bounded task scope and the matching calendar window. Finish pagination; preserve source timestamps.
3. Normalize the source data and create the manifests expected by the planning scripts. Once coverage is verified, enable the planner to generate proposals; keep the agent in proposal-only mode.
4. Propose a small change set, without applying it. Review the actual task IDs, before/after dates and protected tasks.
5. Apply only approved changes through the appropriate source connection, read them back and save the disposition before acknowledging processed deltas.
6. Report what was checked, what changed, what remains pending and which sources were unavailable.

The scripts are not all raw-API adapters. For example, `normalize-notion.py` expects a JSON array of flattened connector pages (`results`, `has_more`, `next_cursor`) plus an explicit registration map. Its output manifest and the planners' free/busy manifests must match the actual saved bytes. See [the script](../organizer/scripts/normalize-notion.py) rather than pasting an arbitrary Notion API response into it.

If using native calendars, merge their coverage with the agent's saved Google free/busy response before planning:

```sh
python3 organizer/scripts/local-calendars.py \
  --freebusy organizer/runtime/reports/FIRST-RUN/google-freebusy.json \
  --out organizer/runtime/reports/FIRST-RUN/freebusy-latest.json
```

`FIRST-RUN` is your run directory, not a bundled fixture. The input must already exist, contain the verified calendar response and cover the intended planning window. This command does not fetch Google availability for you.

**Checkpoint:** one reviewed action is reflected in its owning source, with no unrelated changes. Only then enable the desired planning behavior and your agent's recurring run. Do not add a separate widget-driven organizer job.

## 6. Add optional integrations

### Notion ↔ Google Calendar sync

Use a test database/task calendar first. Set up a Notion integration, enable the Google Calendar API in your own Google project and complete user consent for the account/calendar the Worker will use. You need your own client ID, client secret and refresh token; this repository does not run the Google consent flow for you.

The [sync guide](../calendar-sync/README.md) and [environment example](../calendar-sync/.env.example) list the configuration. Create its D1 database, replace the placeholder in `calendar-sync/wrangler.toml`, store credentials as secrets, run the component tests, apply its migrations and deploy. This database is separate from the collector's journal.

Verify one planned task creates one calendar mirror. Change its work date and confirm that the existing event moves rather than duplicating it. Review synchronization behavior before permitting calendar-side changes. This Worker owns task mirrors; the organizer must not also create them.

### Local document filing

Choose existing destination folders and sender/content rules in `mail_documents.routes`. Install ClamAV at the path expected by `organizer/lib/pdf_security.py`, then run:

```sh
python3 organizer/scripts/update-mail-security.py
```

Use synthetic PDFs to verify scanning/isolation and preview routing before enabling real mail filing. The pipeline expects a complete message/attachment inventory; it is not a new inbox account connector. Missing/stale signatures, failed isolation and ambiguous routes remain blocked. See [security](SECURITY.md).

### Mac board

Install Übersicht, copy `desktop-widget/life-organizer.widget` into its Widgets Folder and create its ignored `config.json` from the included example. Set `organizer_root` to the **absolute path of your checkout's `organizer` folder**. Leave the optional chat link empty unless you have a supported target.

Have the organizer author `organizer/runtime/state/widget-board.json` using the [board contract](BOARD.md); do not export an entire source inbox. Read the [Mac guide](../desktop-widget/README.md) for interaction and monitor selection. The widget command remains on `lib/data.py` with `refreshFrequency = false`.

**Checkpoint:** the saved source time and a synthetic task appear correctly; clicking opens the intended existing item.

### iPhone Home Screen and Lock Screen

Install Scriptable and follow [the mobile guide](../mobile-widget/README.md#configure-your-own-deployment). Deploy a separate summary Worker on your own hostname with a KV binding named `BOARD` and separate reader/writer token digests. Configure your own endpoint in both Scriptable source copies. The reader key belongs in Scriptable Keychain; the writer key belongs in the local ignored publisher config.

After a successful organizer run, call the installed publisher with `--publish` once. Do not run it on a timer. Test unauthenticated rejection before uploading a personal board. Add the Scriptable widget to the Home Screen or Lock Screen and select your script. iOS decides when to fetch the saved feed; it does not run the organizer and the widget cannot scroll.

## 7. Validate and keep it running

Use [Development](DEVELOPMENT.md) for component checks and [Operations](OPERATIONS.md) for recovery. Before relying on a recurring setup, verify:

- The source connections and calendar coverage work with your actual account.
- A protected/fixed task is preserved and a completed task is not reopened.
- Repeating the same run does not create duplicate tasks, calendar events or documents.
- A failed source keeps its last valid state and is reported as missing/stale.
- Widget publication occurs only after organizer runs, and an unchanged board causes no upload.
- Private configuration and runtime data remain ignored by Git.

Review Cloudflare usage after initial setup and after changes to collection/synchronization schedules. Those schedules are independent of widget refresh. The stateless MCP transport removes protocol-session writes, but source collection and calendar sync still have their own resource use. Do not assume a free-tier allowance guarantees capacity for every configuration.
