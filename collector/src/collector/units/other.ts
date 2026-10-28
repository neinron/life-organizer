// TUM-Live (streams and recordings: data and link only, videos are never downloaded).

import { api as tumliveApi, currentSemester } from "../../platforms/tumlive";
import { toJson } from "../model";
import { errText, item, type UnitCtx } from "../unit";

const LIVE = "https://live.rbg.tum.de";

/** Signed playback URLs rotate without new teaching content. The stable watch URL is on Item.url. */
export function stableTumliveStream(s: Record<string, any>): Record<string, any> {
	const { liveNow, viewers, playlistUrl, playlistUrlPres, playlistUrlCam, hlsUrl, ...content } = s;
	return content;
}

export async function unitTumlive(ctx: UnitCtx): Promise<void> {
	const sem = await currentSemester(ctx.env);
	const r = await tumliveApi(ctx.env, "/courses/enrolled", sem);
	const courses = (r.courses ?? []) as Record<string, any>[];
	await ctx.apply({
		scope: "tumlive:courses",
		complete: true,
		entries: courses.map((c) => {
			const key = `tumlive:course:${c.slug}`;
			const { lastRecording: _l, nextLecture: _n, ...raw } = c;
			return { key, item: item("tumlive", key, String(c.name ?? c.slug), `${LIVE}/old/course/${sem.year}/${sem.term}/${c.slug}`, { semester: sem, course: toJson(raw) }) };
		}),
	});
	for (const c of courses.slice(0, 20)) {
		try {
			const d = await tumliveApi(ctx.env, `/courses/${encodeURIComponent(c.slug)}`, sem);
			await ctx.apply({
				scope: `tumlive:streams:${c.slug}`,
				complete: true,
				entries: ((d.course?.streams ?? []) as Record<string, any>[]).map((s) => {
					const key = `tumlive:stream:${s.id}`;
					const raw = stableTumliveStream(s);
					return { key, item: item("tumlive", key, `${c.name}: ${s.name || s.start || s.id}`, `${LIVE}/w/${c.slug}/${s.id}`, { course: String(c.name ?? c.slug), slug: c.slug, stream: toJson(raw), video: "not downloaded, link only" }) };
				}),
			});
		} catch (e) {
			ctx.note(`${c.name}: ${errText(e)}`);
		}
	}
}
