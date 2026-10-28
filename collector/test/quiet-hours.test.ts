import { describe, expect, it } from "vitest";
import { isQuietHours } from "../src/lib/quiet-hours";
import policy from "../config/watcher.json";

describe("Berlin watcher quiet hours", () => {
  it.each([
    ["2026-12-01T21:59:59Z", false], ["2026-12-01T22:00:00Z", true],
    ["2026-12-02T04:59:59Z", true], ["2026-12-02T05:00:00Z", false],
    ["2026-07-01T20:59:59Z", false], ["2026-07-01T21:00:00Z", true],
    ["2026-07-02T03:59:59Z", true], ["2026-07-02T04:00:00Z", false],
    ["2026-10-25T00:30:00Z", true], ["2026-10-25T01:30:00Z", true],
    ["2026-03-29T00:30:00Z", true], ["2026-03-29T01:30:00Z", true],
  ])("%s → quiet=%s", (instant, quiet) => {
    expect(isQuietHours(new Date(instant), { ...policy.quiet_hours, enabled: true })).toBe(quiet);
  });
  it("allows every hour with Example User's disabled quiet-hours policy, including DST changes", () => {
    expect(policy.quiet_hours.enabled).toBe(false);
    for (const day of ["2026-12-01", "2026-07-01", "2026-10-25", "2026-03-29"]) {
      for (let hour = 0; hour < 24; hour++) {
        expect(isQuietHours(new Date(`${day}T${String(hour).padStart(2, "0")}:30:00Z`))).toBe(false);
      }
    }
  });
});
