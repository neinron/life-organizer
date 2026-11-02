# Protected Life Organizer widget feed

Separate Cloudflare Worker for your configured organizer subdomain. The personal website remains static. This is a protected summary export, not the whole Life Organizer and not an autonomous cloud planner.

- `GET /summary`: reader bearer token required; compact saved JSON only.
- `PUT /summary`: separate writer bearer token required; validated, allowlisted payload, maximum 32 KiB.
- `GET /widget.js`: public Scriptable source only; contains no credentials or personal summaries. Import on iPhone, run once and enter the reader key. It is stored in Scriptable Keychain.
- All responses are no-store/noindex; query-string tokens are rejected. Worker preview and workers.dev endpoints are disabled.
- Worker bindings contain only SHA-256 digests of independent 256-bit random bearer tokens, plus a dedicated KV namespace. Only one current summary is stored. This is access control, not end-to-end encryption; Cloudflare processes the authorized content.
- The local publisher is installed next to the existing widget data adapter. It reads its writer configuration from `~/Library/Application Support/Life Organizer/widget-feed.json` (0600), outside the locally served widget directory and outside Git. Upload is deduplicated and limited to one changed payload per five minutes. No redirect following.
- Mac refresh invokes the publisher every minute while Übersicht runs. The source timestamps are retained; successful upload does not mean remote sources were just checked. An offline Mac cannot produce new summaries.
- iPhone caches the last successful response locally. iOS controls refresh timing. Notion task URLs open Notion; verified calendar actions resolve locally in Apple Calendar with a native date fallback. Organizer-chat navigation remains dependent on configured supported links.

Run `node --test mobile-widget/worker.test.mjs` from the repository root. Do not commit tokens, local config, summary JSON or private organizer snapshots. Revoke a key by replacing its digest and provisioning a fresh key on the device or publisher.

## Lock Screen

The same Scriptable script detects accessory families automatically: rectangular shows the highest-priority note and a contextual SF Symbol; circular shows the number of attention notes; inline shows a short count/status above the clock. Uses the system-adaptive accessory background and monochrome text instead of the Home Screen layout. A tap links to the highest-priority Notion item. Offline or old source data is labeled.

Reimport the updated `LifeOrganizer.js`, replacing the existing script; the Keychain entry is unchanged. Add a Scriptable widget through Lock Screen Customize and select this script. Rectangular is recommended for prose. Final appearance depends on the wallpaper and iOS tint and must be checked on the device.

Run `node --test mobile-widget/worker.test.mjs mobile-widget/scriptable.test.mjs` in the exported repository for auth/data checks and mocked rendering of accessory and Home Screen layouts.


## Native calendar actions

Calendar hints open Apple Calendar on each device. `action.url` is a `calshow:` date fallback, `action.desktop_url` targets the verified local macOS event, and `action.calendar` contains the verified title, calendar title, start and end. Calendar web actions are rejected. The iPhone script resolves an exact, unique match inside that named local calendar and uses the iPhone identifiers, never the Mac identifiers. Permission denial, missing sync, ambiguous matches or unsupported identifier formats keep the native date fallback. No events are created or changed, and local calendar query results are not uploaded.

The existing iCloud Scriptable file retains its filename and widget binding. Run it once in Scriptable on iPhone and grant the approved calendar access. Direct navigation must still be checked on the actual iPhone; passing mocks does not prove device behavior. Tests: `node --test mobile-widget/worker.test.mjs mobile-widget/scriptable.test.mjs`.

## Configure your own deployment

1. Create a dedicated Cloudflare KV namespace and bind it as `BOARD`. Configure the Worker entry point as `worker.mjs` and use your own custom hostname. Keep public preview endpoints disabled.
2. Generate independent random reader/writer keys (32 random bytes each). Store only their SHA-256 hex digests in Worker secrets `READ_TOKEN_SHA256` and `WRITE_TOKEN_SHA256`. Provision the original keys privately; never put them in Git or URLs.
3. Deploy using your own Wrangler configuration. Check that an unauthenticated `GET /summary` is denied before supplying personal content.
4. Copy `publish-feed.py` beside the Mac widget's `lib/data.py`. Create the ignored `~/Library/Application Support/Life Organizer/widget-feed.json` from [the example](widget-feed.example.json), set your own endpoint/writer key and restrict permissions to `0600`. Configure the Übersicht command to invoke this publisher instead of `data.py` when uploads are desired.
5. Set your own `/summary` endpoint in the Scriptable source. `iphone-script.mjs` is the source served by the Worker; `LifeOrganizer.js` is the matching importable file. Keep both copies synchronized. Import into Scriptable, run once and enter the reader key into the Keychain prompt. Add a Scriptable Home Screen or Lock Screen widget and select that script.

The local data adapter must produce a valid editorial board first. No automatic planner or remote-source polling is installed by the feed. The mobile script requests refresh after at least fifteen minutes; actual scheduling belongs to iOS. Home Screen widgets cannot scroll. Short mobile variants, measured line wrapping and flexible sections fit the available content budget; use the full app for longer detail.

[Mockup previews](../README.md#preview) illustrate presentation with invented content; they are not simulator screenshots or proof of device behavior.
