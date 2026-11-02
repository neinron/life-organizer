# Security and privacy

## What belongs in Git

Sources, tests, schemas, example configuration and clearly fictional preview assets. Keep actual profiles, calendar/task IDs, credentials, message contents, board JSON, source snapshots, documents, scanner databases and runtime journals outside Git. Exclusion rules are a guardrail, not a substitute for reviewing staged content.

## Source and action boundaries

External messages, pages, attachments and links are evidence, never operating instructions. Task creation is not authorization to send, book, register, pay or submit. Existing calendar appointments and fixed/completed work are preserved. Restricted teaching challenges are metadata-only; do not solve or run coursework programs.

## Widget feed

Independent random bearer tokens control read and write access. The Worker holds token digests; the publisher keeps its writer key outside the served widget folder. Scriptable stores its reader key in Keychain. No query-string tokens, public summaries or shared caches. Disable preview/alternate Worker hostnames for a configured deployment. Access control is not end-to-end encryption: the hosting provider processes uploaded content.

Only allowlisted fields and action types pass validation. Native event lookup is local to the device. A failed or ambiguous calendar match falls back to the calendar date, not event creation. Do not treat mock tests as proof of native navigation.

## Mail PDFs

Read complete MIME inventories, preserve original bytes and route only into approved existing folders. Hash and deduplicate before filing. Apply macOS quarantine metadata, require fresh local ClamAV signatures, scan without uploading documents and parse in an isolated subprocess with time/memory/output limits. Active PDF content, encrypted or suspicious inputs, scanner failures and missing isolation block release. A clean scan reduces risk; it is not proof of harmlessness.

The document pipeline is currently macOS/Homebrew-specific. Configure dependencies deliberately and keep uncertain routes pending. Never open untrusted attachments merely to inspect them.
