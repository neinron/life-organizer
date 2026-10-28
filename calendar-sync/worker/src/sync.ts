import { ApiError, GoogleCalendarClient, GoogleCalendarError, NotionClient } from "./clients";
import {
  desiredGoogleEvent,
  calendarTitleToNotion,
  googleEventToNotionProperties,
  googleHash,
  isCompleted,
  notionHash,
  notionTaskToGoogleBody,
  parseNotionTask,
} from "./serialize";
import { D1State } from "./state";
import type { GoogleEvent, NotionTask, SyncRecord, SyncStats } from "./types";

const DEFAULT_TASK_LIMIT = 6;
const DEFAULT_CLEANUP_LIMIT = 10;

type ErrorKind = "retryable" | "config" | "manual";
type CourseMetadata = { registered: boolean; name: string; icon?: string };

export class SyncEngine {
  constructor(
    private readonly state: D1State,
    private readonly notion: NotionClient,
    private readonly google: GoogleCalendarClient,
  ) {}

  private readonly courses = new Map<string, CourseMetadata>();

  async sync(options: { limit?: number; cleanupLimit?: number } = {}): Promise<SyncStats> {
    const limit = options.limit ?? DEFAULT_TASK_LIMIT;
    const cleanupLimit = options.cleanupLimit ?? DEFAULT_CLEANUP_LIMIT;
    const phase = ((await this.state.getSetting("sync_phase")) || "tasks") as "tasks" | "cleanup";
    const stats = newStats(phase);

    if (phase === "cleanup") {
      await this.cleanupEvents(stats, cleanupLimit);
      return stats;
    }

    const scanId = await this.currentScanId();
    const events = googleEventsByNotionPageId(await this.google.listEvents());
    let cursor = await this.state.getSetting("notion_cursor");
    let hasMore = true;

    while (stats.processed < limit && hasMore) {
      const pageSize = Math.max(1, Math.min(10, limit - stats.processed));
      const page = await this.notion.listTasksPage({ startCursor: cursor || undefined, pageSize });
      const tasks = prioritizeCalendarTasks(page.tasks);

      for (const task of tasks) {
        await this.state.markSeen(scanId, task.pageId);
        stats.processed += 1;

        try {
          const courseContext = await this.taskCourseContext(task);
          if (!courseContext.registered) {
            await this.syncUnregisteredTask(courseContext.task, events.get(task.pageId) ?? null, stats);
          } else {
            await this.syncTask(courseContext.task, events.get(task.pageId) ?? null, stats);
          }
        } catch (error) {
          const kind = classifySyncError(error);
          const message = errorMessage(error);
          if (kind === "config") throw error;
          if (kind === "manual") {
            await this.state.markManualConflict(task.pageId, events.get(task.pageId)?.eventId ?? null, message);
            stats.manual_conflicts += 1;
          } else {
            await this.state.markRetryable(task.pageId, events.get(task.pageId)?.eventId ?? null, message);
            stats.retryable_errors += 1;
          }
        }
      }

      cursor = page.nextCursor;
      hasMore = page.hasMore;
      if (hasMore) {
        await this.state.setSetting("notion_cursor", cursor);
      }
    }

    if (hasMore) {
      stats.has_more = true;
      return stats;
    }

    await this.state.deleteSetting("notion_cursor");
    await this.state.setSetting("last_complete_scan_id", scanId);
    await this.state.deleteSetting("current_scan_id");
    await this.state.setSetting("sync_phase", "cleanup");
    stats.has_more = true;
    return stats;
  }

  /** A bounded change window independent of the daily full-scan/cleanup cursors. */
  async syncRecent(options: { limit?: number } = {}): Promise<SyncStats> {
    const stats = newStats("changes");
    const limit = Math.max(1, Math.min(options.limit ?? 10, 10));
    let until = await this.state.getSetting("changes_until");
    if (!until) {
      until = new Date().toISOString();
      const watermark = await this.state.getSetting("changes_watermark");
      const since = new Date(watermark ? Date.parse(watermark) - 120_000 : Date.now() - 86_400_000).toISOString();
      await this.state.setSetting("changes_since", since);
      await this.state.setSetting("changes_until", until);
    }
    const since = await this.state.getSetting("changes_since");
    const cursor = await this.state.getSetting("changes_cursor");
    const notionDone = await this.state.getSetting("changes_notion_done");
    const page = notionDone ? { tasks: [], nextCursor: "", hasMore: false } :
      await this.notion.listTasksPage({ startCursor: cursor || undefined, pageSize: limit, editedSince: since, editedUntil: until });
    const events = googleEventsByNotionPageId(await this.google.listEvents());
    const records = await this.state.listRecords();
    const googleChanged: string[] = [];
    for (const record of records) {
      const event = events.get(record.notion_page_id);
      if (record.sync_status === "synced" && event && record.last_google_hash && await googleHash(event) !== record.last_google_hash) googleChanged.push(record.notion_page_id);
    }
    const tasks = [...page.tasks];
    const selected = new Set(tasks.map(t => t.pageId));
    for (const id of googleChanged) {
      if (tasks.length >= limit) break;
      if (!selected.has(id)) {
        try { tasks.push(await this.notion.retrieveTask(id)); selected.add(id); }
        catch (error) { stats.retryable_errors++; break; }
      }
    }
    for (const task of tasks) {
      stats.processed++;
      try {
        const context = await this.taskCourseContext(task);
        if (context.registered) await this.syncTask(context.task, events.get(task.pageId) ?? null, stats);
        else await this.syncUnregisteredTask(context.task, events.get(task.pageId) ?? null, stats);
      } catch (error) {
        const kind = classifySyncError(error);
        if (kind === "config") throw error;
        if (kind === "manual") { await this.state.markManualConflict(task.pageId, events.get(task.pageId)?.eventId ?? null, errorMessage(error)); stats.manual_conflicts++; }
        else { await this.state.markRetryable(task.pageId, events.get(task.pageId)?.eventId ?? null, errorMessage(error)); stats.retryable_errors++; }
      }
    }
    if (stats.retryable_errors) { stats.has_more = true; return stats; }
    if (page.hasMore) await this.state.setSetting("changes_cursor", page.nextCursor);
    else await this.state.setSetting("changes_notion_done", "1");
    stats.has_more = page.hasMore || googleChanged.some(id => !selected.has(id));
    if (!stats.has_more) {
      await this.state.setSetting("changes_watermark", until);
      await this.state.setSetting("last_recent_scan_at", new Date().toISOString());
      for (const key of ["changes_since", "changes_until", "changes_cursor", "changes_notion_done"]) await this.state.deleteSetting(key);
    }
    return stats;
  }

  private async currentScanId(): Promise<string> {
    const existing = await this.state.getSetting("current_scan_id");
    if (existing) return existing;
    const scanId = crypto.randomUUID();
    await this.state.setSetting("current_scan_id", scanId);
    return scanId;
  }

  private async cleanupEvents(stats: SyncStats, cleanupLimit: number): Promise<void> {
    if (cleanupLimit <= 0) {
      await this.state.deleteSetting("cleanup_cursor");
      await this.state.deleteSetting("sync_phase");
      return;
    }

    const scanId = await this.state.getSetting("last_complete_scan_id");
    if (!scanId) {
      await this.state.deleteSetting("sync_phase");
      return;
    }

    const cursor = await this.state.getSetting("cleanup_cursor");
    let cursorSeen = !cursor;
    let lastProcessedEventId = "";
    const events = (await this.google.listEvents()).sort((left, right) => left.eventId.localeCompare(right.eventId));

    for (const event of events) {
      if (!cursorSeen) {
        if (event.eventId === cursor) cursorSeen = true;
        continue;
      }

      lastProcessedEventId = event.eventId;
      stats.processed += 1;
      if (event.status === "cancelled") {
        if (stats.processed >= cleanupLimit) {
          stats.has_more = true;
          await this.state.setSetting("cleanup_cursor", lastProcessedEventId);
          return;
        }
        continue;
      }

      if (!(await this.state.wasSeenInScan(scanId, event.notionPageId))) {
        // A task can be scheduled by the fast lane while the full scan is running.
        // Absence from an older scan is never enough evidence to delete its event.
        try {
          const task = await this.notion.retrieveTask(event.notionPageId);
          const context = await this.taskCourseContext(task);
          if (context.registered) await this.syncTask(context.task, event, stats);
          else await this.syncUnregisteredTask(context.task, event, stats);
          await this.state.markSeen(scanId, task.pageId);
        } catch (error) {
          if (error instanceof ApiError && error.statusCode === 404) {
            // Notion also returns 404 when the integration loses page access.
            // Only a readable task can prove completion, archive or removal of its date.
            await this.state.markManualConflict(event.notionPageId, event.eventId, "Notion page not visible (404); calendar event preserved until access or task state is verified");
            stats.manual_conflicts++;
          } else {
            // A permission failure or timeout must not turn into data loss.
            throw error;
          }
        }
      }

      if (stats.processed >= cleanupLimit) {
        stats.has_more = true;
        await this.state.setSetting("cleanup_cursor", lastProcessedEventId);
        return;
      }
    }

    await this.state.deleteSetting("cleanup_cursor");
    await this.state.deleteSetting("sync_phase");
    await this.state.setSetting("last_full_scan_at", new Date().toISOString());
  }

  private async taskCourseContext(task: NotionTask): Promise<{ registered: boolean; task: NotionTask }> {
    const courseIds = task.course.split(",").filter(Boolean);
    const registeredNames: string[] = [];
    const registeredIcons: string[] = [];
    // Life Organizer: new personal tasks do not require enrollment in an academic course.
    // Preserve exclusion of historical standalone records and unregistered old courses.
    const created = (task.raw as { created_time?: string } | null)?.created_time ?? "";
    const personal = courseIds.length === 0 && created >= "2026-10-28T00:00:00Z";
    let registered = personal;
    if (personal) {
      registeredNames.push("Persönlich");
      registeredIcons.push("📌");
    }

    for (const courseId of courseIds) {
      let metadata = this.courses.get(courseId);
      if (!metadata) {
        metadata = await this.notion.courseMetadata(courseId);
        this.courses.set(courseId, metadata);
      }
      if (metadata.registered) {
        registered = true;
        registeredNames.push(metadata.name || courseId);
        if (metadata.icon) registeredIcons.push(metadata.icon);
      }
    }

    return {
      registered,
      task: {
        ...task,
        courseNames: registeredNames.join(", "),
        courseIcons: [...new Set(registeredIcons)].join(" "),
      },
    };
  }

  private async syncUnregisteredTask(task: NotionTask, event: GoogleEvent | null, stats: SyncStats): Promise<void> {
    const record = await this.state.get(task.pageId);
    const currentNotionHash = await notionHash(task);
    if (event && event.status !== "cancelled") {
      await this.google.deleteEvent(event.eventId);
      stats.deleted_google += 1;
    }
    await this.state.upsert(task.pageId, {
      googleEventId: event?.eventId ?? record?.google_event_id ?? null,
      lastNotionHash: currentNotionHash,
      lastGoogleHash: event ? await googleHash(event) : "",
      lastNotionEditedTime: task.lastEditedTime,
      lastGoogleUpdated: event?.updated ?? "",
      syncStatus: "unregistered",
      lastError: "",
    });
  }

  private async syncTask(task: NotionTask, event: GoogleEvent | null, stats: SyncStats): Promise<void> {
    const record = await this.state.get(task.pageId);
    const currentNotionHash = await notionHash(task);
    const terminal = isCompleted(task) ? "done" : task.googleSyncStatus === "deleted" ? "google_deleted" : !task.doStart ? "unscheduled" : "";
    if (terminal && record?.sync_status === terminal && record.last_notion_hash === currentNotionHash && (!event || event.status === "cancelled")) {
      stats.skipped++;
      return;
    }

    if (isCompleted(task)) {
      if (event && event.status !== "cancelled") {
        await this.google.deleteEvent(event.eventId);
        stats.deleted_google += 1;
      }
      await this.state.upsert(task.pageId, {
        googleEventId: event?.eventId ?? record?.google_event_id ?? null,
        lastNotionHash: currentNotionHash,
        lastGoogleHash: event ? await googleHash(event) : "",
        lastNotionEditedTime: task.lastEditedTime,
        lastGoogleUpdated: event?.updated ?? "",
        syncStatus: "done",
        lastError: "",
      });
      return;
    }

    if (task.googleSyncStatus === "deleted") {
      const currentGoogleHash = event ? await googleHash(event) : "";
      if (event && event.status !== "cancelled" && record?.sync_status === "google_deleted" && record.google_event_id !== event.eventId) {
        const markedTask = await this.markGoogleSyncStatus(task, "synced");
        await this.state.upsert(task.pageId, {
          googleEventId: event.eventId,
          lastNotionHash: await notionHash(markedTask),
          lastGoogleHash: currentGoogleHash,
          lastNotionEditedTime: markedTask.lastEditedTime,
          lastGoogleUpdated: event.updated,
          syncStatus: "synced",
          lastError: "",
        });
        stats.updated_notion += 1;
        return;
      }
      if (event && event.status !== "cancelled") {
        await this.google.deleteEvent(event.eventId);
        stats.deleted_google += 1;
      }
      await this.state.upsert(task.pageId, {
        googleEventId: event?.eventId ?? record?.google_event_id ?? null,
        lastNotionHash: currentNotionHash,
        lastGoogleHash: currentGoogleHash,
        lastNotionEditedTime: task.lastEditedTime,
        lastGoogleUpdated: event?.updated ?? "",
        syncStatus: "google_deleted",
        lastError: "",
      });
      return;
    }

    if (!task.doStart) {
      if (event && event.status !== "cancelled") {
        await this.google.deleteEvent(event.eventId);
        stats.deleted_google += 1;
      }
      await this.state.upsert(task.pageId, {
        googleEventId: event?.eventId ?? record?.google_event_id ?? null,
        lastNotionHash: currentNotionHash,
        lastGoogleHash: event ? await googleHash(event) : "",
        lastNotionEditedTime: task.lastEditedTime,
        lastGoogleUpdated: event?.updated ?? "",
        syncStatus: "unscheduled",
        lastError: "",
      });
      return;
    }

    if (event?.status === "cancelled") {
      const currentGoogleHash = await googleHash(event);
      const notionChanged = Boolean(record?.last_notion_hash && record.last_notion_hash !== currentNotionHash);
      if (notionChanged || !shouldHonorGoogleCancellation(record, event)) {
        const created = await this.google.createEvent(notionTaskToGoogleBody(task));
        const markedTask = await this.markGoogleSyncStatus(task, "synced");
        await this.state.upsert(task.pageId, {
          googleEventId: created.eventId,
          lastNotionHash: await notionHash(markedTask),
          lastGoogleHash: await googleHash(created),
          lastNotionEditedTime: markedTask.lastEditedTime,
          lastGoogleUpdated: created.updated,
          syncStatus: "synced",
          lastError: "",
        });
        stats.created += 1;
        return;
      }
      const markedTask = await this.markGoogleSyncStatus(task, "deleted");
      await this.state.upsert(task.pageId, {
        googleEventId: event.eventId,
        lastNotionHash: await notionHash(markedTask),
        lastGoogleHash: currentGoogleHash,
        lastNotionEditedTime: markedTask.lastEditedTime,
        lastGoogleUpdated: event.updated,
        syncStatus: "google_deleted",
        lastError: "",
      });
      return;
    }

    if (!event) {
      const created = await this.google.createEvent(notionTaskToGoogleBody(task));
      const markedTask = await this.markGoogleSyncStatus(task, "synced");
      await this.state.upsert(task.pageId, {
        googleEventId: created.eventId,
        lastNotionHash: await notionHash(markedTask),
        lastGoogleHash: await googleHash(created),
        lastNotionEditedTime: markedTask.lastEditedTime,
        lastGoogleUpdated: created.updated,
        syncStatus: "synced",
        lastError: "",
      });
      stats.created += 1;
      return;
    }

    const currentGoogleHash = await googleHash(event);
    const notionChanged = Boolean(record?.last_notion_hash && record.last_notion_hash !== currentNotionHash);
    const googleChanged = Boolean(record?.last_google_hash && record.last_google_hash !== currentGoogleHash);

    if (notionChanged && googleChanged) {
      await this.updateGoogleFromNotion(task, event, currentNotionHash, stats);
      return;
    }

    if (googleChanged && !notionChanged) {
      const updatedPage = await this.notion.updatePageProperties(task.pageId, {
        ...googleEventToNotionProperties(event, task),
        "Synced with Google": { select: { name: "synced" } },
      });
      const updatedTask = updatedPage.properties ? { ...parseNotionTask(updatedPage), courseNames: task.courseNames, courseIcons: task.courseIcons } : {
        ...task,
        title: calendarTitleToNotion(event, task),
        doStart: event.start,
        doEnd: event.end,
        doIsDatetime: !event.isAllDay,
        googleSyncStatus: "synced",
        lastEditedTime: updatedPage.last_edited_time ?? task.lastEditedTime,
      };
      await this.state.upsert(task.pageId, {
        googleEventId: event.eventId,
        lastNotionHash: await notionHash(updatedTask),
        lastGoogleHash: currentGoogleHash,
        lastNotionEditedTime: updatedTask.lastEditedTime,
        lastGoogleUpdated: event.updated,
        syncStatus: "synced",
        lastError: "",
      });
      stats.updated_notion += 1;
      return;
    }

    const desired = desiredGoogleEvent(event.eventId, task, event);
    if (notionChanged || (await googleHash(desired)) !== currentGoogleHash) {
      await this.updateGoogleFromNotion(task, event, currentNotionHash, stats);
      return;
    }

    if (record?.sync_status !== "synced") {
      const markedTask = await this.markGoogleSyncStatus(task, "synced");
      await this.state.upsert(task.pageId, {
        googleEventId: event.eventId,
        lastNotionHash: await notionHash(markedTask),
        lastGoogleHash: currentGoogleHash,
        lastNotionEditedTime: markedTask.lastEditedTime,
        lastGoogleUpdated: event.updated,
        syncStatus: "synced",
        lastError: "",
      });
      stats.updated_notion += 1;
      return;
    }

    // No platform write and no database churn for identical content.
    if (record.last_notion_hash !== currentNotionHash || record.last_google_hash !== currentGoogleHash || record.last_error) {
      await this.state.upsert(task.pageId, {
        googleEventId: event.eventId, lastNotionHash: currentNotionHash, lastGoogleHash: currentGoogleHash,
        lastNotionEditedTime: task.lastEditedTime, lastGoogleUpdated: event.updated, syncStatus: "synced", lastError: "",
      });
    }
    stats.skipped += 1;
  }

  private async updateGoogleFromNotion(
    task: NotionTask,
    event: GoogleEvent,
    currentNotionHash: string,
    stats: SyncStats,
  ): Promise<void> {
    const body = notionTaskToGoogleBody(task);
    let updated: GoogleEvent;
    try {
      updated = await this.google.updateEvent(event.eventId, body);
    } catch (error) {
      if (!(error instanceof GoogleCalendarError) || error.statusCode !== 400) throw error;
      await this.google.deleteEvent(event.eventId);
      updated = await this.google.createEvent(body);
    }
    const markedTask = await this.markGoogleSyncStatus(task, "synced");
    await this.state.upsert(task.pageId, {
      googleEventId: updated.eventId,
      lastNotionHash: await notionHash(markedTask),
      lastGoogleHash: await googleHash(updated),
      lastNotionEditedTime: markedTask.lastEditedTime,
      lastGoogleUpdated: updated.updated,
      syncStatus: "synced",
      lastError: "",
    });
    stats.updated_google += 1;
  }

  private async markGoogleSyncStatus(task: NotionTask, status: "synced" | "deleted"): Promise<NotionTask> {
    if (task.googleSyncStatus === status) return task;
    const updatedPage = await this.notion.setGoogleSyncStatus(task.pageId, status);
    return { ...task, googleSyncStatus: status, lastEditedTime: updatedPage.last_edited_time ?? task.lastEditedTime };
  }
}

export function classifySyncError(error: unknown): ErrorKind {
  const status = error instanceof ApiError || error instanceof GoogleCalendarError ? error.statusCode : 0;
  const message = errorMessage(error);
  if (message.includes("Too many subrequests")) return "retryable";
  if (status === 401 || status === 403) return "config";
  if (status === 408 || status === 409 || status === 429 || status >= 500) return "retryable";
  if (status >= 400) return "manual";
  if (error instanceof TypeError) return "retryable";
  return "retryable";
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function newStats(phase: "tasks" | "cleanup" | "changes"): SyncStats {
  return {
    ok: true,
    phase,
    processed: 0,
    created: 0,
    updated_google: 0,
    updated_notion: 0,
    deleted_google: 0,
    cleared_notion_dates: 0,
    retryable_errors: 0,
    manual_conflicts: 0,
    skipped: 0,
  };
}

function prioritizeCalendarTasks(tasks: NotionTask[]): NotionTask[] {
  return [...tasks].sort((left, right) => taskPriority(left) - taskPriority(right));
}

function taskPriority(task: NotionTask): number {
  if (task.doStart && !isCompleted(task)) return 0;
  if (!task.doStart && !isCompleted(task)) return 1;
  return 2;
}

function googleEventsByNotionPageId(events: GoogleEvent[]): Map<string, GoogleEvent> {
  const selected = new Map<string, GoogleEvent>();
  for (const event of events) {
    if (!event.notionPageId) continue;
    const existing = selected.get(event.notionPageId);
    if (!existing || googleEventPreferred(event, existing)) {
      selected.set(event.notionPageId, event);
    }
  }
  return selected;
}

function googleEventPreferred(candidate: GoogleEvent, existing: GoogleEvent): boolean {
  const candidateRank = candidate.status === "cancelled" ? 0 : 1;
  const existingRank = existing.status === "cancelled" ? 0 : 1;
  if (candidateRank !== existingRank) return candidateRank > existingRank;
  return timestamp(candidate.updated) > timestamp(existing.updated);
}

function shouldHonorGoogleCancellation(record: SyncRecord | null, event: GoogleEvent): boolean {
  if (!record) return false;
  if (record.sync_status !== "synced") return false;
  if (record.google_event_id !== event.eventId) return false;
  if (!record.last_google_updated || !event.updated) return false;
  return timestamp(event.updated) > timestamp(record.last_google_updated);
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}
