# Mac information board

An opaque Übersicht board with flexible sections, padded click targets and native app links. It is a desktop window, not a WidgetKit extension, and does not join Apple's widget grid.

## Install

1. Install [Übersicht](https://tracesof.net/uebersicht/) and open its Widgets Folder.
2. Copy `life-organizer.widget` into it.
3. Inside that folder, copy `config.example.json` to `config.json`; set `organizer_root` to the local organizer folder and optionally set your own chat link.
4. Refresh widgets and enable interaction in Übersicht if needed.

The display helper chooses one external monitor when available, otherwise the main display. The board uses a 16px inset at the top left. Display selection refreshes every 15 seconds; content only after an organizer run, with `refreshFrequency = false`. Existing desktop widgets must be moved manually if their positions conflict.

## Content and actions

The organizer writes `runtime/state/widget-board.json`. Sections and item counts come from this editorial board, rather than fixed attention/update/task templates. See the [board contract](../docs/BOARD.md). The adapter validates saved source data; timestamps describe the saved source, not a new remote check.

Notion actions open the installed Notion app. Calendar actions use a verified native event link with a date fallback. Existing draft links may open their mail app; clicking never creates another draft. The chat button appears only with a configured valid chat target.

The exported command reads local data only. To enable mobile publishing, follow the [mobile feed guide](../mobile-widget/README.md) and configure the local publisher separately. Übersicht and the local organizer must run on an awake Mac for new output.

Do not commit real configuration, runtime files or personal screenshots. [Preview mockup](../docs/images/desktop-widget.png) uses fictional content.
