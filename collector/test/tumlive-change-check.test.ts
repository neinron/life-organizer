import { expect, it } from "vitest";
import { stableTumliveStream } from "../src/collector/units/other";

it("ignores rotating playback links and viewer counts but retains new teaching content", () => {
  const before = { id: 77815, name: "Introduction", recording: true, duration: 3600, playlistUrl: "https://video/stream?sig=one", hlsUrl: "one", viewers: 2 };
  expect(stableTumliveStream(before)).toEqual(stableTumliveStream({ ...before, playlistUrl: "https://video/stream?sig=two", hlsUrl: "two", viewers: 9 }));
  expect(stableTumliveStream(before)).not.toEqual(stableTumliveStream({ ...before, duration: 3700 }));
  expect(stableTumliveStream(before)).not.toEqual(stableTumliveStream({ ...before, name: "New topic" }));
});
