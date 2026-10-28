import { D1State } from "./state";
import type { Env } from "./types";
import {
  constantTimeEqual,
  json,
  missingRequired,
  notionSignatureValid,
  renewGoogleWatch,
  requireToken,
  runSync,
  runSyncJob,
} from "./http";
import { classifySyncError, errorMessage } from "./sync";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" && request.method === "GET") {
      return json({ ok: true, service: "notion-calendar-sync-worker" });
    }

    if (url.pathname === "/health" && request.method === "GET") {
      const missing = missingRequired(env);
      return json(
        {
          ok: missing.length === 0,
          missing,
          calendar_id_set: Boolean(env.GOOGLE_CALENDAR_ID),
          public_base_url_set: Boolean(env.PUBLIC_BASE_URL),
          google_webhook_token_set: Boolean(env.GOOGLE_WEBHOOK_TOKEN),
          queue_binding_set: false,
          queue_usage: "disabled",
        },
        missing.length ? 503 : 200,
      );
    }

    if (url.pathname === "/sync" && ["GET", "POST"].includes(request.method)) {
      const tokenError = requireToken(request, env);
      if (tokenError) return tokenError;
      return await runSync(env, request);
    }

    if (url.pathname === "/conflicts" && request.method === "GET") {
      const tokenError = requireToken(request, env);
      if (tokenError) return tokenError;
      return json({ ok: true, conflicts: await new D1State(env.DB).listConflicts() });
    }

    if (url.pathname === "/webhook-channels" && request.method === "GET") {
      const tokenError = requireToken(request, env);
      if (tokenError) return tokenError;
      return json({ ok: true, channels: await new D1State(env.DB).listWebhookChannels() });
    }

    if (url.pathname === "/runs" && request.method === "GET") {
      const tokenError = requireToken(request, env);
      if (tokenError) return tokenError;
      return json({ ok: true, runs: await new D1State(env.DB).listRuns() });
    }

    if (url.pathname === "/google/watch/renew" && ["GET", "POST"].includes(request.method)) {
      const tokenError = requireToken(request, env);
      if (tokenError) return tokenError;
      return await renewGoogleWatch(env);
    }

    if (url.pathname === "/webhooks/google" && request.method === "POST") {
      if (!env.GOOGLE_WEBHOOK_TOKEN) return json({ ok: false, error: "GOOGLE_WEBHOOK_TOKEN is not configured" }, 503);
      const supplied = request.headers.get("X-Goog-Channel-Token") || "";
      if (!constantTimeEqual(supplied, env.GOOGLE_WEBHOOK_TOKEN)) return json({ ok: false, error: "invalid google channel token" }, 403);
      const state = request.headers.get("X-Goog-Resource-State") || "";
      if (state === "sync") return json({ ok: true, ignored: true, reason: "channel sync notification" }, 202);
      ctx.waitUntil(markWebhookDirty(env, "google-webhook"));
      return json({ ok: true, accepted: true, batched: true }, 202);
    }

    if (url.pathname === "/webhooks/notion" && request.method === "POST") {
      const body = await request.text();
      const payload = body ? JSON.parse(body) : {};
      const state = new D1State(env.DB);
      if (payload.verification_token) {
        await state.setSetting("notion_webhook_verification_token", payload.verification_token);
        return json({ ok: true, verification_token_received: true, stored: true });
      }
      const secret = env.NOTION_WEBHOOK_VERIFICATION_TOKEN || (await state.getSetting("notion_webhook_verification_token"));
      if (!secret) return json({ ok: false, error: "NOTION_WEBHOOK_VERIFICATION_TOKEN is not configured" }, 503);
      if (!(await notionSignatureValid(secret, body, request.headers.get("X-Notion-Signature") || ""))) {
        return json({ ok: false, error: "invalid notion signature" }, 403);
      }
      ctx.waitUntil(markWebhookDirty(env, "notion-webhook"));
      return json({ ok: true, accepted: true, batched: true }, 202);
    }

    return json({ ok: false, error: "not found" }, 404);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (controller.cron === "7 3 * * *") {
      ctx.waitUntil(renewGoogleWatch(env).then((res) => res.text()).then((body) => console.log("renew", body)));
    }
    ctx.waitUntil(runScheduledSync(env, controller.cron));
  },
};

async function runScheduledSync(env: Env, cron: string): Promise<void> {
  const state = new D1State(env.DB);
  const reason = `cron:${cron}`;
  const dailySafetyScan = cron === "7 3 * * *";
  const dirtyReason = await state.getSetting("webhook_dirty");
  const pendingContinuation = await hasPendingSync(state);
  if (dailySafetyScan) await state.setSetting("full_scan_requested", new Date().toISOString());
  const recentAt = Date.parse(await state.getSetting("last_recent_scan_at"));
  const recentPending = Boolean(await state.getSetting("changes_until"));
  const recentDue = recentPending || Boolean(dirtyReason) || !Number.isFinite(recentAt) || Date.now() - recentAt >= 5 * 60_000;
  const fullAt = Date.parse(await state.getSetting("last_full_scan_at"));
  const fullRequested = Boolean(await state.getSetting("full_scan_requested")) || !Number.isFinite(fullAt) || Date.now() - fullAt >= 24 * 60 * 60_000;

  if (!recentDue && !fullRequested && !pendingContinuation) {
    console.log(JSON.stringify({ message: "scheduled sync skipped", reason }));
    return;
  }

  try {
    const mode = recentDue ? "changes" : "full";
    const stats = await runSyncJob(env, reason, { limit: 10, cleanupLimit: 10, mode });
    if (!stats.has_more) {
      if (mode === "changes") {
        // Preserve a webhook that arrived while this batch was being processed.
        if (await state.getSetting("webhook_dirty") === dirtyReason) await state.deleteSetting("webhook_dirty");
      } else await state.deleteSetting("full_scan_requested");
    }
    const changed = stats.created + stats.updated_google + stats.updated_notion + stats.deleted_google;
    if (changed || stats.retryable_errors || stats.manual_conflicts) console.log(JSON.stringify({ message: "scheduled sync completed", reason, dirtyReason, stats }));
  } catch (error) {
    const kind = classifySyncError(error);
    console.error(JSON.stringify({ message: "scheduled sync failed", reason, kind, error: errorMessage(error) }));
    if (kind === "retryable") throw error;
  }
}

async function hasPendingSync(state: D1State): Promise<boolean> {
  return Boolean(
    (await state.getSetting("notion_cursor")) ||
      (await state.getSetting("cleanup_cursor")) ||
      (await state.getSetting("sync_phase")) ||
      (await state.getSetting("current_scan_id")),
  );
}

async function markWebhookDirty(env: Env, reason: string): Promise<void> {
  const state = new D1State(env.DB);
  await state.setSetting("webhook_dirty", `${reason}:${crypto.randomUUID()}`);
  console.log(JSON.stringify({ message: "webhook marked dirty", reason }));
}
