import { describe, it, expect } from "vitest";
import { embeddedMedia, webContent } from "../src/collector/web";

describe("embedded lecture material", () => {
  it("detects iframe-only uploads and strips session keys without fetching videos", () => {
    const html = `<main><iframe src="https://video.example/embed/1?a=1&amp;sesskey=SECRET" title="Week 2"></iframe></main>`;
    expect(webContent(html,"https://moodle.example/course").embedded_media).toEqual([
      {type:"iframe",url:"https://video.example/embed/1?a=1",title:"Week 2"},
    ]);
  });
  it("supports lazy sources and relative URLs, rejecting executable URLs and duplicates", () => {
    expect(embeddedMedia(`<video data-src='/movie.mp4'></video><source src='/movie.mp4'><iframe src='javascript:alert(1)'></iframe><embed src='data:text/html,test'>`,"https://moodle.example/course")).toEqual([
      {type:"video",url:"https://moodle.example/movie.mp4",title:""},
    ]);
  });
});
