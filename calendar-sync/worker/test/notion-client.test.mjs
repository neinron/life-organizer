import assert from "node:assert/strict";
import test from "node:test";

import { NotionClient } from "../src/clients.ts";

function notionTaskPage(id, courseId) {
  return {
    id,
    url: `https://notion.so/${id}`,
    last_edited_time: "2026-05-24T10:00:00Z",
    properties: {
      Name: { title: [{ plain_text: `Task ${id}` }] },
      Status: { status: { name: "Not started" } },
      Type: { select: { name: "To-Do" } },
      Priority: { select: { name: "Medium" } },
      Course: { relation: [{ id: courseId }] },
      "Synced with Google": { select: null },
      "Do Date": { date: { start: "2026-05-24" } },
      "Due Date": { date: null },
    },
  };
}

test("Notion client returns one task page and can read course registration", async () => {
  const oldFetch = globalThis.fetch;
  const calls = [];
  const bodies = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    if (String(url).includes("/databases/db/query")) {
      bodies.push(JSON.parse(init.body));
      return Response.json({
        has_more: true,
        next_cursor: "next-page",
        results: [notionTaskPage("registered-task", "registered-course")],
      });
    }
    if (String(url).endsWith("/pages/registered-course")) {
      return Response.json({
        icon: { type: "emoji", emoji: "🧠" },
        properties: {
          Name: { title: [{ plain_text: "Machine Learning" }] },
          Registration: { checkbox: true },
        },
      });
    }
    if (String(url).endsWith("/pages/old-course")) {
      return Response.json({ properties: { Registered: { checkbox: false } } });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  try {
    const client = new NotionClient({
      NOTION_API_KEY: "notion",
      NOTION_VERSION: "2022-06-28",
      DATABASE_ID: "db",
    });
    const page = await client.listTasksPage({ pageSize: 1 });
    const metadata = await client.courseMetadata("registered-course");

    assert.deepEqual(
      page.tasks.map((task) => task.pageId),
      ["registered-task"],
    );
    assert.equal(page.hasMore, true);
    assert.equal(page.nextCursor, "next-page");
    assert.deepEqual(metadata, { registered: true, name: "Machine Learning", icon: "🧠" });
    assert(calls.some((url) => url.endsWith("/pages/registered-course")));
    assert.deepEqual(bodies[0].filter, {
      or: [
        { property: "Do Date", date: { is_not_empty: true } },
        { property: "Synced with Google", select: { is_not_empty: true } },
      ],
    });
  } finally {
    globalThis.fetch = oldFetch;
  }
});


test("recent Notion query freezes a bounded edit window", async () => {
  const oldFetch=globalThis.fetch;
  let body;
  globalThis.fetch=async(url,init)=>{body=JSON.parse(init.body);return Response.json({results:[],has_more:false,next_cursor:null});};
  try {
    await new NotionClient({NOTION_API_KEY:"test",DATABASE_ID:"db"}).listTasksPage({editedSince:"2026-10-26T10:00:00Z",editedUntil:"2026-10-26T10:05:00Z"});
    assert.deepEqual(body.filter.and[1],{timestamp:"last_edited_time",last_edited_time:{on_or_after:"2026-10-26T10:00:00Z"}});
    assert.deepEqual(body.filter.and[2],{timestamp:"last_edited_time",last_edited_time:{on_or_before:"2026-10-26T10:05:00Z"}});
  } finally {globalThis.fetch=oldFetch;}
});
