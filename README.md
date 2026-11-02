# Life Organizer

A personal executive assistant that brings tasks, calendars and verified source changes together. It helps identify what needs attention, proposes realistic next steps and publishes a concise information board for Mac and iPhone.

Notion owns task status. The calendar represents commitments and planned work. The organizer evaluates them together; the widgets display its editorial output.

![Mac information board with fictional data](docs/images/desktop-widget.png)

*All preview content is fictional. Screenshots are illustrative mockups, not personal source exports.*

## What it does

- Collects changes from configured university and personal sources with a resumable journal.
- Plans unfinished work around selected calendars while preserving completed work, fixed tasks and real deadlines.
- Produces a flexible information board: decisions, preparation, conflicts, replies and useful updates are chosen from current evidence, without fixed content categories.
- Shows the board on a Mac through Übersicht and on an iPhone through Scriptable, including dedicated Lock Screen layouts.
- Files relevant mail PDFs conservatively, with duplicate checks, a local malware scan and isolated parsing.

The source collector and widget feed run on Cloudflare. Evaluation, native calendar access and publishing still need an awake Mac and the configured local runner. This repository does not provide an autonomous cloud assistant.

## Preview

| iPhone Home Screen | Lock Screen |
| --- | --- |
| ![iPhone board mockup](docs/images/iphone-widget.png) | ![Lock Screen mockup](docs/images/lock-screen.png) |

## Start here

| Goal | Guide |
| --- | --- |
| Understand the components and data flow | [Architecture](docs/ARCHITECTURE.md) |
| Set up the system in order | [Setup](docs/SETUP.md) |
| Run it and diagnose missing/stale information | [Operations](docs/OPERATIONS.md) |
| Define the board and safe click targets | [Board contract](docs/BOARD.md) |
| Understand access, privacy and document checks | [Security](docs/SECURITY.md) |
| Run validation | [Development](docs/DEVELOPMENT.md) |

## Repository map

| Directory | Responsibility |
| --- | --- |
| [`collector/`](collector/README.md) | Cloudflare MCP source collection, authentication and resumable change journal |
| [`organizer/`](organizer/README.md) | Local planning, native calendar adapter, file processing and editorial checks |
| [`calendar-sync/`](calendar-sync/README.md) | Existing Notion ↔ Google Calendar synchronization |
| [`desktop-widget/`](desktop-widget/README.md) | Mac information board and external-monitor selection |
| [`mobile-widget/`](mobile-widget/README.md) | Authenticated summary feed, Mac publisher and Scriptable iPhone widget |
| [`docs/`](docs/README.md) | Cross-component setup, operation and reference material |

## Operating principles

Use verified sources and preserve their timestamps. Deduplicate actions across mail, tasks and calendars. Do not infer completion from elapsed time or invent deadlines, travel time or free slots. A click opens an existing item; it does not send mail, create duplicate drafts, register for exams or submit coursework.

This is a sanitized source repository. Personal profiles, accounts, messages, tasks, runtime journals, documents and access keys stay outside Git. Configure your own resources and permissions. Mock tests and published source do not prove a particular deployment, calendar sync or phone notification worked.

## Credits

The original TUM collector was built by **Max Michels**: [mxmichels17/tum-mcp](https://github.com/mxmichels17/tum-mcp). It is MIT-licensed; the original copyright and license are preserved in [collector/LICENSE](collector/LICENSE) and [LICENSE](LICENSE). Life Organizer extends that foundation with personal planning, private-task support, reminders, information boards and verified file organization.
