# Setup

## Prerequisites

Use macOS for EventKit and document isolation, Python 3.9+ for local scripts, and Node.js 24 LTS (compatible with the component lockfiles). You need your own Cloudflare account, Notion task source and calendars. Übersicht is needed for the Mac board; Scriptable is needed for iPhone widgets. No custom iPhone application is required.

## 1. Source collection

Follow the [collector setup](../collector/README.md). Configure your permitted courses and sources. Put credentials in Worker Secrets, never in examples or Git. Verify the actual deployed collector and authenticated access before treating a source as covered.

## 2. Local organizer

Copy `organizer/profile.example.json` to the ignored `organizer/profile.json` and replace all placeholders. Configure selected calendars, personal scope, actual source IDs and measured or reasoned task durations. Install Python packages from `organizer/requirements.txt`; PDF isolation currently resolves packages from the user site, so use `python3 -m pip install --user -r organizer/requirements.txt` for that component.

Build the EventKit helper with `python3 organizer/scripts/build-apple-store.py`. Grant the explicitly needed calendar/reminder permissions, discover calendars and allowlist only the intended sources. The helper has no calendar-event write command.

The local agent must enforce operating rules and a shared lease. There is deliberately no bundled personal automation configuration. See [organizer](../organizer/README.md).

## 3. Calendar synchronization

Follow [calendar-sync](../calendar-sync/README.md), supply your own Notion/Google credentials and apply the D1 migrations. Confirm mirrors using real records. Do not duplicate task events through the organizer.

## 4. Editorial board and Mac widget

Produce a verified `runtime/state/widget-board.json` according to [the board contract](BOARD.md), then install the [desktop widget](../desktop-widget/README.md). No personal board JSON belongs in the repository.

## 5. Optional iPhone feed

Deploy the [mobile feed](../mobile-widget/README.md) to your own hostname with separate reader and writer tokens. Install the local publisher beside the desktop adapter and opt into its command. Import the configured Scriptable script, store the reader key through its first-run prompt and add a widget. Test the actual phone separately from mocks.

## 6. Optional mail document processing

Install ClamAV at the configured Homebrew path and refresh local signatures with `organizer/scripts/update-mail-security.py`. Configure only existing approved document routes. Use preview before apply; missing signatures, unavailable isolation and failed inspections block PDF release. See [security](SECURITY.md).

Widget publication is run-driven: after a successful verified board write, call the installed `publish-feed.py --publish` once. No widget content timer or periodic upload job. Unchanged content is not uploaded. The display helper only selects the monitor locally; iOS may still fetch the saved feed on its own schedule.
