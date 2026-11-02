import Foundation
import EventKit

// Local EventKit adapter. There is deliberately no calendar-event write command.
@main struct AppleStore {
    static let store = EKEventStore()
    static let ownedList = "Life Organizer"
    static func output(_ object: Any) throws {
        let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        print(String(decoding: data, as: UTF8.self))
    }
    static func fail(_ message: String) throws -> Never {
        try output(["ok": false, "error": message]); exit(2)
    }
    static func flag(_ name: String) -> String? {
        let args = CommandLine.arguments
        guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
        return args[i + 1]
    }
    static func date(_ value: String) throws -> Date {
        let f = ISO8601DateFormatter()
        let plain = f.date(from: value)
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let d = plain ?? f.date(from: value) else { try fail("ISO-8601 timestamp with offset required") }
        return d
    }
    static func iso(_ d: Date) -> String { ISO8601DateFormatter().string(from: d) }
    static func authorized(_ entity: EKEntityType) -> Bool {
        EKEventStore.authorizationStatus(for: entity) == .fullAccess
    }
    static func require(_ entity: EKEntityType) throws {
        guard authorized(entity) else { try fail("permission_required: use request-access explicitly; no source was checked") }
    }
    static func reminderRows(_ calendars: [EKCalendar]) async -> [EKReminder] {
        await withCheckedContinuation { continuation in
            store.fetchReminders(matching: store.predicateForReminders(in: calendars)) { rows in
                continuation.resume(returning: rows ?? [])
            }
        }
    }
    static func calendarRow(_ c: EKCalendar) -> [String: Any] {
        ["id": c.calendarIdentifier, "title": c.title, "source_id": c.source.sourceIdentifier,
         "source_title": c.source.title, "source_type": c.source.sourceType.rawValue,
         "allows_modifications": c.allowsContentModifications]
    }
    static func main() async {
        do {
            let command = CommandLine.arguments.dropFirst().first ?? "status"
            switch command {
            case "status":
                try output(["ok": true, "events_authorized": authorized(.event),
                            "reminders_authorized": authorized(.reminder),
                            "events_status": EKEventStore.authorizationStatus(for: .event).rawValue,
                            "reminders_status": EKEventStore.authorizationStatus(for: .reminder).rawValue])
            case "request-access":
                let kind = flag("--kind") ?? "events"
                guard ["events", "reminders"].contains(kind) else { try fail("unknown access kind") }
                let granted = try await (kind == "events" ? store.requestFullAccessToEvents() : store.requestFullAccessToReminders())
                try output(["ok": granted, "kind": kind, "granted": granted])
            case "calendars":
                try require(.event)
                try output(["ok": true, "calendars": store.calendars(for: .event).map(calendarRow)])
            case "events":
                try require(.event)
                guard let a = flag("--start"), let b = flag("--end"), let ids = flag("--calendar-ids") else {
                    try fail("events requires --start, --end and explicit --calendar-ids")
                }
                let start = try date(a), end = try date(b)
                guard end > start, end.timeIntervalSince(start) <= 32 * 86400 else { try fail("window must be at most32days") }
                let wanted = Set(ids.split(separator: ",").map(String.init))
                let calendars = store.calendars(for: .event).filter { wanted.contains($0.calendarIdentifier) }
                guard !wanted.isEmpty, calendars.count == wanted.count else { try fail("calendar allowlist is incomplete; retain previous busy data") }
                let events = store.events(matching: store.predicateForEvents(withStart: start, end: end, calendars: calendars))
                let rows: [[String: Any]] = events.map { e in
                    ["id": e.eventIdentifier ?? e.calendarItemIdentifier,
                     "calendar_item_id": e.calendarItemIdentifier,
                     "external_id": e.calendarItemExternalIdentifier ?? "", "calendar_id": e.calendar.calendarIdentifier,
                     "title": e.title ?? "", "start": iso(e.startDate), "end": iso(e.endDate),
                     "all_day": e.isAllDay, "status": e.status.rawValue,
                     "busy": e.availability != .free && e.status != .canceled,
                     "recurring": e.hasRecurrenceRules]
                }.sorted { ($0["start"] as! String) < ($1["start"] as! String) }
                try output(["ok": true, "complete": true, "timeMin": a, "timeMax": b,
                            "checked_at": iso(Date()), "calendars": calendars.map(calendarRow), "events": rows])
            case "reminders":
                try require(.reminder)
                let lists = store.calendars(for: .reminder).filter { $0.title == ownedList }
                guard lists.count <= 1 else { try fail("multiple Life Organizer lists; choose the existing list before writes") }
                let rows = lists.isEmpty ? [] : await reminderRows(lists)
                try output(["ok": true, "list_exists": !lists.isEmpty, "reminders": rows.map { r in
                    ["id": r.calendarItemIdentifier, "title": r.title ?? "", "notes": r.notes ?? "",
                     "completed": r.isCompleted, "due": r.dueDateComponents?.date.map(iso) ?? ""] as [String: Any]
                }])
            case "upsert-reminder":
                try require(.reminder)
                guard let file = flag("--input") else { try fail("--input JSON required") }
                let payload = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: file))) as? [String: Any]
                guard let p = payload, let id = p["life_id"] as? String, !id.isEmpty,
                      id.range(of: "^[A-Za-z0-9:_-]{1,180}$", options: .regularExpression) != nil,
                      let title = p["title"] as? String, !title.isEmpty,
                      let notion = p["notion_url"] as? String, let url = URL(string: notion),
                      ["www.notion.so", "notion.so", "app.notion.com"].contains(url.host ?? ""), url.scheme == "https",
                      let dueText = p["due"] as? String else { try fail("invalid reminder intent; Life-ID, title, official Notion URL and due required") }
                let due = try date(dueText)
                let minutes = p["early_minutes"] as? Int ?? 0
                guard minutes >= 0 && minutes <= 10080 else { try fail("early_minutes out of range") }
                let lists = store.calendars(for: .reminder).filter { $0.title == ownedList }
                guard lists.count == 1, lists[0].allowsContentModifications else { try fail("existing writable Life Organizer list required; no list created automatically") }
                let rows = await reminderRows(lists), marker = "Life-ID:" + id
                let matches = rows.filter { ($0.notes ?? "").split(separator: "\n").contains { $0.replacingOccurrences(of: "Life-ID: ", with: "Life-ID:").trimmingCharacters(in: .whitespaces) == marker } }
                guard matches.count <= 1 else { try fail("duplicate Life-ID; no write") }
                let reminder = matches.first ?? EKReminder(eventStore: store)
                if p["completed"] as? Bool == true {
                    guard p["notion_status"] as? String == "done", !matches.isEmpty else { try fail("completion requires an existing Life-ID and verified Notion done status") }
                    if reminder.isCompleted { try output(["ok": true, "action": "unchanged", "life_id": id]); return }
                    guard CommandLine.arguments.contains("--apply") else { try output(["ok": true, "action": "would_complete", "life_id": id]); return }
                    reminder.isCompleted = true; try store.save(reminder, commit: true)
                    guard (store.calendarItem(withIdentifier: reminder.calendarItemIdentifier) as? EKReminder)?.isCompleted == true else { try fail("completion readback failed") }
                    try output(["ok": true, "action": "completed", "life_id": id]); return
                }
                if reminder.isCompleted { try output(["ok": true, "action": "preserved_completed", "life_id": id]); return }
                var notes = reminder.notes ?? ""
                if notes.isEmpty { notes = notion + "\n" + marker + "\nNotion bleibt die Aufgabenquelle." }
                else if !notes.contains(notion) { notes += "\n" + notion }
                var cal = Calendar(identifier: .gregorian); cal.timeZone = TimeZone(identifier: "Europe/Berlin")!
                var desiredDue = cal.dateComponents([.year,.month,.day,.hour,.minute,.timeZone], from: due)
                desiredDue.calendar = cal
                let alarmDate = due.addingTimeInterval(-Double(minutes * 60))
                let unchanged = reminder.title == title && reminder.notes == notes && reminder.dueDateComponents?.date == desiredDue.date && reminder.alarms?.count == 1 && reminder.alarms?.first?.absoluteDate == alarmDate
                if unchanged { try output(["ok": true, "action": "unchanged", "life_id": id]); return }
                guard CommandLine.arguments.contains("--apply") else { try output(["ok": true, "action": matches.isEmpty ? "would_create" : "would_update", "life_id": id]); return }
                reminder.calendar = lists[0]; reminder.title = title; reminder.notes = notes; reminder.url = url
                reminder.dueDateComponents = desiredDue
                reminder.alarms = [EKAlarm(absoluteDate: alarmDate)]
                try store.save(reminder, commit: true)
                guard let saved = store.calendarItem(withIdentifier: reminder.calendarItemIdentifier) as? EKReminder,
                      saved.title == title, saved.notes == notes, saved.dueDateComponents?.date == desiredDue.date else { try fail("reminder readback failed") }
                try output(["ok": true, "action": matches.isEmpty ? "created" : "updated", "life_id": id, "id": saved.calendarItemIdentifier])
            default: try fail("unknown command")
            }
        } catch {
            try? output(["ok": false, "error": String(describing: error)]); exit(2)
        }
    }
}
