# Protected Life Organizer widget feed

Separate Cloudflare Worker for `organizer.jaronschurer.com`. The personal website remains static. This is a protected summary export, not the whole Life Organizer and not an autonomous cloud planner.

- `GET /summary`: reader bearer token required; compact saved JSON only.
- `PUT /summary`: separate writer bearer token required; validated, allowlisted payload, maximum 32 KiB.
- `GET /widget.js`: public Scriptable source only; contains no credentials or personal summaries. Import on iPhone, run once and enter the reader key. It is stored in Scriptable Keychain.
- All responses are no-store/noindex; query-string tokens are rejected. Worker preview and workers.dev endpoints are disabled.
- Worker bindings contain only SHA-256 digests of independent 256-bit random bearer tokens, plus a dedicated KV namespace. Only one current summary is stored. This is access control, not end-to-end encryption; Cloudflare processes the authorized content.
- The local publisher is installed next to the existing widget data adapter. It reads its writer configuration from `~/Library/Application Support/Life Organizer/widget-feed.json` (0600), outside the locally served widget directory and outside Git. Upload is deduplicated and limited to one changed payload per five minutes. No redirect following.
- Mac refresh invokes the publisher every minute while Übersicht runs. The source timestamps are retained; successful upload does not mean remote sources were just checked. An offline Mac cannot produce new summaries.
- iPhone caches the last successful response locally. iOS controls refresh timing. Notion task URLs open Notion; standalone calendar ingestion and mobile organizer-chat links are not implemented.

Run `node --test mobile-widget/worker.test.mjs` from the repository root. Do not commit tokens, local config, summary JSON or private organizer snapshots. Revoke a key by replacing its digest and provisioning a fresh key on the device or publisher.
