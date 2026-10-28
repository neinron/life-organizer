import assert from "node:assert/strict";
import test from "node:test";

import { notionTaskToGoogleBody, googleEventToNotionProperties } from "../src/serialize.ts";

function task(overrides = {}) {
  return {
    pageId: "page1",
    url: "https://notion.so/page1",
    title: "Task",
    status: "not started",
    taskType: "To-Do",
    priority: "High",
    course: "course1",
    dueStart: "2026-05-22",
    doStart: "2026-05-21T10:00:00+02:00",
    doEnd: "2026-05-21T11:00:00+02:00",
    doIsDatetime: true,
    lastEditedTime: "n1",
    raw: {},
    ...overrides,
  };
}

test("date-only Notion task without end gets next-day Google end", () => {
  const body = notionTaskToGoogleBody(task({ doStart: "2026-05-21", doEnd: "", doIsDatetime: false }));
  assert.deepEqual(body.start, { date: "2026-05-21" });
  assert.deepEqual(body.end, { date: "2026-05-22" });
});

test("datetime Notion task without end gets one-hour Google end preserving offset", () => {
  const body = notionTaskToGoogleBody(task({ doStart: "2026-05-21T10:00:00+02:00", doEnd: "" }));
  assert.deepEqual(body.start, { dateTime: "2026-05-21T10:00:00+02:00" });
  assert.deepEqual(body.end, { dateTime: "2026-05-21T11:00:00+02:00" });
});

test("datetime without explicit timezone gets configured Google timezone", () => {
  const body = notionTaskToGoogleBody(task({ doStart: "2026-05-21T10:00:00", doEnd: "" }), "Europe/Berlin");
  assert.deepEqual(body.start, { dateTime: "2026-05-21T10:00:00", timeZone: "Europe/Berlin" });
  assert.deepEqual(body.end, { dateTime: "2026-05-21T11:00:00", timeZone: "Europe/Berlin" });
});

test("course emoji prefixes a calendar event exactly once and is stored as presentation metadata", () => {
  const body = notionTaskToGoogleBody(task({courseIcons: "👨🏽‍💻"}));
  assert.equal(body.summary, "👨🏽‍💻 Task");
  assert.equal(body.extendedProperties.private.notion_course_prefix, "👨🏽‍💻");
  assert.equal(notionTaskToGoogleBody(task({courseIcons:"👨🏽‍💻",title:"👨🏽‍💻 Task"})).summary,"👨🏽‍💻 Task");
});
test("calendar move or rename strips only the generated course prefix", () => {
  const event={title:"🛡️ Renamed",start:"2026-11-01T10:00:00+01:00",end:"2026-11-01T12:15:00+01:00",raw:{extendedProperties:{private:{notion_course_prefix:"🛡️"}}}};
  const props=googleEventToNotionProperties(event,task({courseIcons:"🛡️"}));
  assert.equal(props.Name.title[0].text.content,"Renamed");
  assert.equal(props["Do Date"].date.end,event.end);
  assert.equal(googleEventToNotionProperties({...event,title:"⭐ Personal title"}).Name.title[0].text.content,"⭐ Personal title");
});
test("verified non-hour work durations are preserved exactly",()=>{
  assert.equal(notionTaskToGoogleBody(task({doEnd:"2026-05-21T10:15:00+02:00"})).end.dateTime,"2026-05-21T10:15:00+02:00");
});
