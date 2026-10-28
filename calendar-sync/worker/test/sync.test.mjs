import assert from "node:assert/strict";
import test from "node:test";

import { ApiError, GoogleCalendarError } from "../src/clients.ts";
import { eventDescription, googleHash, notionHash } from "../src/serialize.ts";
import { SyncEngine } from "../src/sync.ts";

function task(overrides = {}) {
  return {
    pageId: "page1",
    url: "https://notion.so/page1",
    title: "Task",
    status: "not started",
    taskType: "To-Do",
    priority: "High",
    course: "course1",
    courseNames: "",
    googleSyncStatus: "",
    dueStart: "2026-05-22",
    doStart: "2026-05-21T10:00:00+02:00",
    doEnd: "2026-05-21T11:00:00+02:00",
    doIsDatetime: true,
    lastEditedTime: "n1",
    raw: {},
    ...overrides,
  };
}

function event(overrides = {}) {
  const pageId = overrides.notionPageId ?? "page1";
  const title = overrides.title ?? "Task";
  return {
    eventId: "event1",
    notionPageId: pageId,
    title,
    description: eventDescription(task({ pageId, title })),
    start: "2026-05-21T10:00:00+02:00",
    end: "2026-05-21T11:00:00+02:00",
    isAllDay: false,
    updated: "g1",
    status: "confirmed",
    raw: {},
    ...overrides,
  };
}

class FakeState {
  constructor(record = null, { registeredCourses = new Map([["course1", true]]) } = {}) {
    this.record = record;
    this.conflicts = [];
    this.retryable = [];
    this.settings = new Map();
    this.seen = new Map();
    this.registeredCourses = registeredCourses;
  }

  async listRecords() { return this.record ? [this.record] : []; }

  async get() {
    return this.record;
  }

  async getSetting(key) {
    return this.settings.get(key) ?? "";
  }

  async setSetting(key, value) {
    this.settings.set(key, value);
  }

  async deleteSetting(key) {
    this.settings.delete(key);
  }

  async getCourseRegistration(courseId) {
    if (!this.registeredCourses.has(courseId)) return null;
    return { registered: this.registeredCourses.get(courseId), updatedAt: new Date().toISOString() };
  }

  async upsertCourseRegistration(courseId, registered) {
    this.registeredCourses.set(courseId, registered);
  }

  async markSeen(scanId, notionPageId) {
    this.seen.set(notionPageId, scanId);
  }

  async wasSeenInScan(scanId, notionPageId) {
    return this.seen.get(notionPageId) === scanId;
  }

  async upsert(notionPageId, data) {
    this.record = {
      notion_page_id: notionPageId,
      google_event_id: data.googleEventId ?? null,
      last_notion_hash: data.lastNotionHash,
      last_google_hash: data.lastGoogleHash,
      last_notion_edited_time: data.lastNotionEditedTime,
      last_google_updated: data.lastGoogleUpdated,
      sync_status: data.syncStatus ?? "synced",
      last_error: data.lastError ?? "",
      updated_at: "now",
    };
  }

  async markConflict(notionPageId, googleEventId, error) {
    this.conflicts.push({ notionPageId, googleEventId, error });
  }

  async markRetryable(notionPageId, googleEventId, error) {
    this.retryable.push({ notionPageId, googleEventId, error });
    this.record = {
      notion_page_id: notionPageId,
      google_event_id: googleEventId ?? null,
      last_notion_hash: "",
      last_google_hash: "",
      last_notion_edited_time: "",
      last_google_updated: "",
      sync_status: "retry_pending",
      last_error: error,
      updated_at: "now",
    };
  }

  async markManualConflict(notionPageId, googleEventId, error) {
    this.conflicts.push({ notionPageId, googleEventId, error });
  }
}

class FakeNotion {
  constructor(tasks, { registeredCourses = new Map() } = {}) {
    this.tasks = tasks;
    this.updated = [];
    this.courseReads = 0;
    this.registeredCourses = registeredCourses;
  }

  async listTasksPage({ startCursor, pageSize = 10 } = {}) {
    const start = startCursor ? Number(startCursor) : 0;
    const page = this.tasks.slice(start, start + pageSize);
    const next = start + page.length;
    return { tasks: page, nextCursor: String(next), hasMore: next < this.tasks.length };
  }

  async retrieveTask(id) {
    const found = this.tasks.find(t => t.pageId === id);
    if (!found) throw new ApiError("Not found", 404, "");
    return found;
  }

  async courseMetadata(courseId) {
    this.courseReads += 1;
    return {
      registered: this.registeredCourses.get(courseId) ?? true,
      name: `Course ${courseId}`,
    };
  }

  async updatePageProperties(pageId, properties) {
    this.updated.push({ pageId, properties });
    return { last_edited_time: "n2" };
  }

  async setGoogleSyncStatus(pageId, status) {
    return await this.updatePageProperties(pageId, {
      "Synced with Google": { select: { name: status } },
    });
  }
}

class FakeGoogle {
  constructor(events, { failUpdate400 = false, failCreate = null } = {}) {
    this.events = events;
    this.failUpdate400 = failUpdate400;
    this.failCreate = failCreate;
    this.created = [];
    this.updated = [];
    this.deleted = [];
  }

  async listEvents() {
    return this.events;
  }

  async createEvent(body) {
    if (this.failCreate) throw this.failCreate;
    this.created.push(body);
    return event({ eventId: "created", title: body.summary, updated: "g2" });
  }

  async updateEvent(eventId, body) {
    this.updated.push({ eventId, body });
    if (this.failUpdate400) throw new GoogleCalendarError("bad request", 400, '{"error":"invalid end"}');
    return event({ eventId, title: body.summary, updated: "g2" });
  }

  async deleteEvent(eventId) {
    this.deleted.push(eventId);
  }
}

test("simultaneous Notion and Google changes use Notion as source of truth", async () => {
  const oldTask = task();
  const oldEvent = event();
  const newTask = task({ title: "Changed in Notion", lastEditedTime: "n2" });
  const newEvent = event({ title: "Changed in Google", updated: "g2" });
  const state = new FakeState({
    notion_page_id: "page1",
    google_event_id: "event1",
    last_notion_hash: await notionHash(oldTask),
    last_google_hash: await googleHash(oldEvent),
    last_notion_edited_time: "n1",
    last_google_updated: "g1",
    sync_status: "synced",
    last_error: "",
    updated_at: "then",
  });
  const google = new FakeGoogle([newEvent]);
  const result = await new SyncEngine(state, new FakeNotion([newTask]), google).sync();

  assert.equal(result.manual_conflicts, 0);
  assert.equal(result.updated_google, 1);
  assert.equal(google.updated[0].body.summary, "Changed in Notion");
  assert.equal(state.record.sync_status, "synced");
});

test("Google update 400 deletes and recreates the event from Notion", async () => {
  const oldTask = task();
  const oldEvent = event();
  const newTask = task({ title: "Changed in Notion", lastEditedTime: "n2" });
  const state = new FakeState({
    notion_page_id: "page1",
    google_event_id: "event1",
    last_notion_hash: await notionHash(oldTask),
    last_google_hash: await googleHash(oldEvent),
    last_notion_edited_time: "n1",
    last_google_updated: "g1",
    sync_status: "synced",
    last_error: "",
    updated_at: "then",
  });
  const google = new FakeGoogle([event()], { failUpdate400: true });
  const result = await new SyncEngine(state, new FakeNotion([newTask]), google).sync();

  assert.equal(result.updated_google, 1);
  assert.deepEqual(google.deleted, ["event1"]);
  assert.equal(google.created[0].summary, "Changed in Notion");
  assert.equal(state.record.google_event_id, "created");
});

test("Google datetime normalization avoids repeated updates for dropped milliseconds", async () => {
  const notionTask = task({
    doStart: "2026-05-21T10:00:00.000+02:00",
    doEnd: "2026-05-21T11:00:00.000+02:00",
    courseNames: "Course course1",
  });
  const googleEvent = event({
    start: "2026-05-21T10:00:00+02:00",
    end: "2026-05-21T11:00:00+02:00",
    description: eventDescription(notionTask),
  });
  const state = new FakeState({
    notion_page_id: "page1",
    google_event_id: "event1",
    last_notion_hash: await notionHash(notionTask),
    last_google_hash: await googleHash(googleEvent),
    last_notion_edited_time: "n1",
    last_google_updated: "g1",
    sync_status: "synced",
    last_error: "",
    updated_at: "then",
  });
  const google = new FakeGoogle([googleEvent]);
  const result = await new SyncEngine(state, new FakeNotion([notionTask]), google).sync();

  assert.equal(result.updated_google, 0);
  assert.equal(result.skipped, 1);
  assert.equal(google.updated.length, 0);
});

test("Google hash treats equivalent millisecond and non-millisecond datetimes as equal", async () => {
  assert.equal(
    await googleHash(event({ start: "2026-05-21T10:00:00.000+02:00", end: "2026-05-21T11:00:00.000+02:00" })),
    await googleHash(event({ start: "2026-05-21T10:00:00+02:00", end: "2026-05-21T11:00:00+02:00" })),
  );
});

test("existing Google event is deleted when its Notion task belongs to an unregistered course", async () => {
  const state = new FakeState();
  const google = new FakeGoogle([event({ notionPageId: "old-course-task", eventId: "old-event" })]);
  const result = await new SyncEngine(
    state,
    new FakeNotion([task({ pageId: "old-course-task", course: "old-course" })], {
      registeredCourses: new Map([["old-course", false]]),
    }),
    google,
  ).sync();

  assert.equal(result.deleted_google, 1);
  assert.deepEqual(google.deleted, ["old-event"]);
  assert.equal(state.record.sync_status, "unregistered");
});

test("stale cancelled Google event without prior sync is recreated from Notion", async () => {
  const state = new FakeState();
  const notion = new FakeNotion([task()]);
  const google = new FakeGoogle([event({ status: "cancelled", updated: "2026-05-21T09:00:00Z" })]);
  const result = await new SyncEngine(state, notion, google).sync();

  assert.equal(result.created, 1);
  assert.equal(state.record.sync_status, "synced");
  assert.equal(state.record.google_event_id, "created");
  assert.deepEqual(notion.updated[0], {
    pageId: "page1",
    properties: { "Synced with Google": { select: { name: "synced" } } },
  });
});

test("trusted cancelled Google event marks Notion as deleted without clearing Do Date", async () => {
  const oldTask = task();
  const syncedTask = task({ courseNames: "Course course1" });
  const oldEvent = event({ updated: "2026-05-21T08:00:00Z" });
  const state = new FakeState({
    notion_page_id: "page1",
    google_event_id: "event1",
    last_notion_hash: await notionHash(syncedTask),
    last_google_hash: await googleHash(oldEvent),
    last_notion_edited_time: "n1",
    last_google_updated: "2026-05-21T08:00:00Z",
    sync_status: "synced",
    last_error: "",
    updated_at: "then",
  });
  const notion = new FakeNotion([oldTask]);
  const google = new FakeGoogle([event({ status: "cancelled", updated: "2026-05-21T09:00:00Z" })]);
  const result = await new SyncEngine(state, notion, google).sync();

  assert.equal(result.cleared_notion_dates, 0);
  assert.equal(state.record.sync_status, "google_deleted");
  assert.deepEqual(notion.updated[0], {
    pageId: "page1",
    properties: { "Synced with Google": { select: { name: "deleted" } } },
  });
  assert.equal("Do Date" in notion.updated[0].properties, false);
});

test("active Google event wins over stale cancelled duplicate", async () => {
  const notionTask = task();
  const syncedTask = task({ courseNames: "Course course1" });
  const activeEvent = event({
    eventId: "active",
    updated: "2026-05-21T08:00:00Z",
    description: eventDescription(syncedTask),
  });
  const cancelledEvent = event({ eventId: "cancelled", status: "cancelled", updated: "2026-05-21T09:00:00Z" });
  const state = new FakeState({
    notion_page_id: "page1",
    google_event_id: "active",
    last_notion_hash: await notionHash(syncedTask),
    last_google_hash: await googleHash(activeEvent),
    last_notion_edited_time: "n1",
    last_google_updated: "2026-05-21T08:00:00Z",
    sync_status: "synced",
    last_error: "",
    updated_at: "then",
  });
  const notion = new FakeNotion([notionTask]);
  const google = new FakeGoogle([activeEvent, cancelledEvent]);
  const result = await new SyncEngine(state, notion, google).sync();

  assert.equal(result.skipped, 1);
  assert.equal(result.updated_notion, 0);
  assert.equal(result.created, 0);
  assert.equal(google.deleted.length, 0);
  assert.equal(state.record.google_event_id, "active");
  assert.equal(state.record.sync_status, "synced");
});

test("retryable runtime errors are not stored as manual conflicts", async () => {
  const state = new FakeState();
  const google = new FakeGoogle([], { failCreate: new Error("Too many subrequests by single Worker invocation") });
  const result = await new SyncEngine(state, new FakeNotion([task()]), google).sync();

  assert.equal(result.retryable_errors, 1);
  assert.equal(result.manual_conflicts, 0);
  assert.equal(state.conflicts.length, 0);
  assert.equal(state.record.sync_status, "retry_pending");
});

test("per-run course registration memory cache prevents repeated Notion course reads", async () => {
  const state = new FakeState(null, { registeredCourses: new Map() });
  const notion = new FakeNotion([task({ pageId: "page1" }), task({ pageId: "page2" })]);
  const result = await new SyncEngine(state, notion, new FakeGoogle([])).sync();

  assert.equal(result.created, 2);
  assert.equal(notion.courseReads, 1);
});

test("Google event description uses course name instead of course id", async () => {
  const state = new FakeState();
  const google = new FakeGoogle([]);
  const result = await new SyncEngine(state, new FakeNotion([task()]), google).sync();

  assert.equal(result.created, 1);
  assert.match(String(google.created[0].description), /Course: Course course1/);
  assert.doesNotMatch(String(google.created[0].description), /Course: course1$/m);
});

test("Notion deleted sync status prevents Google event creation", async () => {
  const state = new FakeState();
  const google = new FakeGoogle([]);
  const result = await new SyncEngine(state, new FakeNotion([task({ googleSyncStatus: "deleted" })]), google).sync();

  assert.equal(result.created, 0);
  assert.equal(google.created.length, 0);
  assert.equal(state.record.sync_status, "google_deleted");
});

test("Notion deleted sync status removes active Google event", async () => {
  const state = new FakeState();
  const google = new FakeGoogle([event()]);
  const result = await new SyncEngine(state, new FakeNotion([task({ googleSyncStatus: "deleted" })]), google).sync();

  assert.equal(result.deleted_google, 1);
  assert.deepEqual(google.deleted, ["event1"]);
  assert.equal(state.record.sync_status, "google_deleted");
});

test("task and cleanup phases continue across small batches", async () => {
  const state = new FakeState();
  const notion = new FakeNotion([task({ pageId: "page1" }), task({ pageId: "page2" })]);
  const google = new FakeGoogle([event({ notionPageId: "missing-page", eventId: "missing-event" })]);

  const first = await new SyncEngine(state, notion, google).sync({ limit: 1, cleanupLimit: 1 });
  assert.equal(first.phase, "tasks");
  assert.equal(first.has_more, true);
  assert.equal(state.settings.get("notion_cursor"), "1");

  const second = await new SyncEngine(state, notion, google).sync({ limit: 1, cleanupLimit: 1 });
  assert.equal(second.phase, "tasks");
  assert.equal(second.has_more, true);
  assert.equal(state.settings.get("sync_phase"), "cleanup");

  const third = await new SyncEngine(state, notion, google).sync({ limit: 1, cleanupLimit: 1 });
  assert.equal(third.phase, "cleanup");
  assert.equal(third.deleted_google, 0);
  assert.equal(third.manual_conflicts, 1);
  assert.deepEqual(google.deleted, []);
  assert.match(state.conflicts[0].error, /not visible/);
});

test("cleanup phase limits inspected events even when nothing is deleted", async () => {
  const state = new FakeState();
  const scanId = "scan1";
  state.settings.set("sync_phase", "cleanup");
  state.settings.set("last_complete_scan_id", scanId);
  state.seen.set("page1", scanId);
  state.seen.set("page2", scanId);
  state.seen.set("page3", scanId);

  const google = new FakeGoogle([
    event({ notionPageId: "page1", eventId: "event1" }),
    event({ notionPageId: "page2", eventId: "event2" }),
    event({ notionPageId: "page3", eventId: "event3" }),
  ]);

  const first = await new SyncEngine(state, new FakeNotion([]), google).sync({ cleanupLimit: 1 });
  assert.equal(first.phase, "cleanup");
  assert.equal(first.processed, 1);
  assert.equal(first.deleted_google, 0);
  assert.equal(first.has_more, true);
  assert.equal(state.settings.get("cleanup_cursor"), "event1");

  const second = await new SyncEngine(state, new FakeNotion([]), google).sync({ cleanupLimit: 1 });
  assert.equal(second.processed, 1);
  assert.equal(second.deleted_google, 0);
  assert.equal(second.has_more, true);
  assert.equal(state.settings.get("cleanup_cursor"), "event2");
});


test("irrelevant tasks never become calendar events", async () => {
  const state = new FakeState();
  const google = new FakeGoogle([]);
  const stats = await new SyncEngine(state, new FakeNotion([task({status:"irrelevant"})]), google).sync();
  assert.equal(stats.created, 0);
  assert.equal(state.record.sync_status, "done");
});

test("recent lane does not disturb full-scan cursors or delete unrelated events", async () => {
  const state = new FakeState();
  state.settings.set("notion_cursor", "full-cursor");
  state.settings.set("current_scan_id", "full-scan");
  const google = new FakeGoogle([event({notionPageId:"other"})]);
  const stats = await new SyncEngine(state, new FakeNotion([task()]), google).syncRecent();
  assert.equal(stats.phase, "changes");
  assert.equal(stats.created, 1);
  assert.equal(state.settings.get("notion_cursor"), "full-cursor");
  assert.equal(state.settings.get("current_scan_id"), "full-scan");
  assert.deepEqual(google.deleted, []);
  assert(state.settings.has("changes_watermark"));
});

test("failed recent writes keep the window retryable and do not advance its watermark", async () => {
  const state = new FakeState();
  const stats = await new SyncEngine(state, new FakeNotion([task()]), new FakeGoogle([], {failCreate:new TypeError("network down")})).syncRecent();
  assert.equal(stats.retryable_errors, 1);
  assert.equal(stats.has_more, true);
  assert(state.settings.has("changes_until"));
  assert(!state.settings.has("changes_watermark"));
});

test("full cleanup preserves tasks newly scheduled during an older scan", async () => {
  const state = new FakeState();
  state.settings.set("sync_phase", "cleanup");
  state.settings.set("last_complete_scan_id", "older-scan");
  const t=task({courseNames:"Course course1",googleSyncStatus:"synced"});
  const e=event({description:eventDescription(t)});
  const google=new FakeGoogle([e]);
  await new SyncEngine(state, new FakeNotion([t]), google).sync();
  assert.deepEqual(google.deleted, []);
  assert.equal(state.seen.get(t.pageId), "older-scan");
});

test("Google time changes are written back once and then become a no-op", async () => {
  const t=task({courseNames:"Course course1",googleSyncStatus:"synced"});
  const before=event({description:eventDescription(t)});
  const state=new FakeState({notion_page_id:t.pageId,google_event_id:before.eventId,last_notion_hash:await notionHash(t),last_google_hash:await googleHash(before),sync_status:"synced",last_error:""});
  const moved=event({...before,start:"2026-05-21T12:00:00+02:00",end:"2026-05-21T13:00:00+02:00",updated:"g2"});
  const notion=new FakeNotion([t]);
  const google=new FakeGoogle([moved]);
  const first=await new SyncEngine(state,notion,google).syncRecent();
  assert.equal(first.updated_notion,1);
  notion.tasks=[{...t,doStart:moved.start,doEnd:moved.end,lastEditedTime:"n2"}];
  const second=await new SyncEngine(state,notion,google).syncRecent();
  assert.equal(second.updated_notion,0);
  assert.equal(second.updated_google,0);
  assert.equal(second.skipped,1);
  assert.equal(notion.updated.length,1);
});


test("real Notion update response preserves resolved course identity in the stored hash", async () => {
  const t=task({courseNames:"Course course1",googleSyncStatus:"synced"});
  const before=event({description:eventDescription(t)});
  const state=new FakeState({notion_page_id:t.pageId,google_event_id:before.eventId,last_notion_hash:await notionHash(t),last_google_hash:await googleHash(before),sync_status:"synced",last_error:""});
  const moved=event({...before,start:"2026-05-21T12:00:00+02:00",end:"2026-05-21T13:00:00+02:00",updated:"g2"});
  const notion=new FakeNotion([t]);
  notion.updatePageProperties=async () => ({id:t.pageId,url:t.url,last_edited_time:"n2",properties:{Name:{title:[{plain_text:t.title}]},Status:{status:{name:t.status}},Type:{select:{name:t.taskType}},Priority:{select:{name:t.priority}},Course:{relation:[{id:t.course}]},"Synced with Google":{select:{name:"synced"}},"Due Date":{date:{start:t.dueStart}},"Do Date":{date:{start:moved.start,end:moved.end}}}});
  const google=new FakeGoogle([moved]);
  const first=await new SyncEngine(state,notion,google).syncRecent();
  assert.equal(first.updated_notion,1);
  const updated={...t,doStart:moved.start,doEnd:moved.end,lastEditedTime:"n2"};
  assert.equal(state.record.last_notion_hash,await notionHash(updated));
  notion.tasks=[updated];
  const second=await new SyncEngine(state,notion,google).syncRecent();
  assert.equal(second.updated_google,0);
  assert.equal(second.updated_notion,0);
});

test("terminal calendar tombstones cannot starve the recent change window", async () => {
  const t=task({status:"done"});const e=event({status:"cancelled"});
  const state=new FakeState({notion_page_id:t.pageId,last_google_hash:"previous-active-hash",sync_status:"done"});
  const notion=new FakeNotion([]);
  const stats=await new SyncEngine(state,notion,new FakeGoogle([e])).syncRecent();
  assert.equal(stats.processed,0);
  assert.equal(stats.retryable_errors,0);
  assert.equal(stats.has_more,false);
});


test("new standalone personal tasks sync without academic registration", async () => {
  const t=task({course:"",raw:{created_time:"2026-10-28T10:00:00Z"}});
  const google=new FakeGoogle([]);
  const result=await new SyncEngine(new FakeState(),new FakeNotion([t]),google).sync();
  assert.equal(result.created,1);assert.equal(result.retryable_errors,0);
  assert.equal(google.created[0].summary,"📌 Task");
});

test("historical standalone records remain excluded", async () => {
  const t=task({course:"",raw:{created_time:"2026-07-01T10:00:00Z"}});
  const google=new FakeGoogle([]);
  const result=await new SyncEngine(new FakeState(),new FakeNotion([t]),google).sync();
  assert.equal(result.created,0);assert.equal(google.created.length,0);
});
