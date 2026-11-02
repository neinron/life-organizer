# Editorial board contract

`runtime/state/widget-board.json` is the only board content source. The organizer authors it after checking tasks, calendars, deadlines, dependencies and source changes together. Missing board data is reported; there are no topic-specific fallback templates.

```json
{
  "verified_at": "2026-01-15T08:00:00Z",
  "sections": [
    {
      "title": "Choose the next step",
      "surfaces": ["desktop", "mobile"],
      "items": [
        {
          "label": "Proposal review",
          "text": "Review the proposal before the confirmed planning meeting. The available preparation block is sufficient for the estimated effort.",
          "mobile_text": "Review the proposal before the planning meeting.",
          "severity": "warning",
          "action": {"url": "notion://www.notion.so/11111111111141118111111111111111"}
        }
      ]
    }
  ]
}
```

The example is fictional. `verified_at` reflects source verification, not rendering or upload. Preserve the last valid board on failure and write updates atomically under the shared lease. An empty valid board remains empty.

## Editorial judgment

Explain what matters now, why and the next realistic action. Use actual calendar availability and preparation requirements rather than copying lists. Make genuine trade-offs explicit, preserve fixed work and real appointments, remove resolved or duplicate hints and distinguish recommendations from saved changes. Do not invent urgency, free time, effort or completion.

Titles, labels, order and the presence of sections are data, not renderer rules. `surfaces` controls device selection without matching section names. Provide concise `mobile_text` and optional `mobile_label` alongside full text. The mobile renderer measures wrapping, fits content into its widget budget and expands short text when there is space; it cannot scroll. Device layout still needs real-device validation.

The feed accepts at most six sections with five items each and a total request of 32 KiB. These are validation limits, not a required editorial structure.

## Click targets

Use existing Notion pages and verified native calendar actions. Calendar actions may include `desktop_url` and `calendar` metadata (title, calendar title, start/end) for device-local resolution. Never reuse Mac event identifiers on iPhone. See [mobile calendar actions](../mobile-widget/README.md#native-calendar-actions).

Mail links must open an existing, verified draft if supported. A link to a received message is not a draft. If direct opening is unavailable, identify the saved draft and offer only a verified app-opening action; do not create another draft through `mailto:`. Widget actions never authorize sending.
