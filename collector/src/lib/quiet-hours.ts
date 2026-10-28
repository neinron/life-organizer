import policy from "../../config/watcher.json";

/** Local clock time, including Berlin's daylight-saving transitions. */
export function isQuietHours(now = new Date(), quietHours = policy.quiet_hours): boolean {
  if (!quietHours.enabled) return false;
  const hour = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: policy.timezone, hour: "2-digit", hourCycle: "h23",
  }).format(now));
  return hour >= quietHours.start_hour || hour < quietHours.end_hour;
}
