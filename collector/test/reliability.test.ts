import { expect, it } from "vitest";
import { itemHash, computeChanges } from "../src/collector/model";
import { parseChallengeMetadata } from "../src/collector/units/netsec";

it("ignores Moodle session/footer clocks but still detects teaching changes", () => {
 const a={title:"Course",url:"https://www.moodle.tum.de/mod/page/view.php?id=1",content:{text:"Deadline: 02.11.2026 14:00\nSie sind angemeldet als Example User sesskey=one",notification:{timecreatedpretty:"2 minutes",text:"Q1"}}};
 const b={...a,content:{...a.content,text:"Deadline: 02.11.2026 14:00\nSie sind angemeldet als Example User sesskey=two",notification:{timecreatedpretty:"5 minutes",text:"Q1"}}};
 expect(itemHash(a)).toBe(itemHash(b));expect(computeChanges(a,b)).toEqual([]);
 expect(itemHash(a)).not.toBe(itemHash({...b,content:{...b.content,text:"Deadline: 03.11.2026 14:00"}}));
 expect(itemHash(a)).not.toBe(itemHash({...b,content:{...b.content,notification:{timecreatedpretty:"5 minutes",text:"Q2"}}}));
});
const listing=(link='/tasks/1',due='02.11.2026 14:00')=>`signed in as Example User<table><tr><th>#</th><th>Name</th><th>Due</th><th>Your submission</th><th>Score</th></tr><tr><td>pwn01_01</td><td><a href="${link}">Intro</a></td><td>${due}</td><td>Not submitted by you</td><td>ungraded (of 0)</td></tr><tr><td>Total</td></tr></table>`;
it("extracts only official challenge metadata and refuses logins/format drift",()=>{
 expect(parseChallengeMetadata(listing())).toEqual([{id:"pwn01_01",title:"Intro",url:"https://netsec.net.in.tum.de/tasks/1",due_display:"02.11.2026 14:00",own_submission_status:"Not submitted by you",grading_status:"ungraded (of 0)"}]);
 expect(()=>parseChallengeMetadata('<form>Login</form>')).toThrow();
 expect(()=>parseChallengeMetadata(listing('https://evil.test/tasks/1'))).toThrow();
 expect(()=>parseChallengeMetadata(listing('/tasks/1','unknown'))).toThrow();
});
