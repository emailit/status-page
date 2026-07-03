import { Hono } from "hono";
import { config, getService } from "./config.js";
import { runProbeCycle } from "./health.js";
import { buildSnapshot } from "./snapshot.js";
import {
  getServiceState,
  getUptime,
  getDailyUptime,
  getIntradayUptime,
  listIncidentsForService,
  getIncident,
  listIncidents,
  createIncident,
  updateIncident,
  addIncidentUpdate,
  deleteIncident,
} from "./db.js";
import {
  isAuthenticated,
  verifyPassword,
  makeToken,
  sessionCookie,
  clearCookie,
} from "./auth.js";
import { renderHome, renderServiceDetail, renderIncidentPage } from "./ui/public.js";
import { renderLogin, renderAdmin } from "./ui/admin.js";

export { RegionProbe } from "./probe-do.js";

const app = new Hono();

const html = (c, markup, status = 200) =>
  c.body(markup, status, { "Content-Type": "text/html; charset=utf-8" });

/* --------------------------------------------------------------- public */

app.get("/", async (c) => {
  const snap = await buildSnapshot(c.env);
  return html(c, renderHome(snap));
});

app.get("/api/status.json", async (c) => {
  const snap = await buildSnapshot(c.env);
  return c.json(snap, 200, { "Cache-Control": "no-store" });
});

app.get("/service/:id", async (c) => {
  const service = getService(c.req.param("id"));
  if (!service) return html(c, renderIncidentPage(null), 404);

  const [state, uptime, uptime24h, dailyUptime, intraday, incidents] = await Promise.all([
    getServiceState(c.env.DB, service.id),
    getUptime(c.env.DB, service.id, 30),
    getUptime(c.env.DB, service.id, 1),
    getDailyUptime(c.env.DB, service.id, 30),
    getIntradayUptime(c.env.DB, service.id, 24, 5),
    listIncidentsForService(c.env.DB, service.id, { limit: 50 }),
  ]);

  const issueCounts = countIssues(incidents, 30);
  return html(
    c,
    renderServiceDetail({
      service,
      state,
      uptime,
      uptime24h,
      issueCounts,
      incidents,
      dailyUptime,
      intraday,
    })
  );
});

app.get("/incident/:id", async (c) => {
  const incident = await getIncident(c.env.DB, c.req.param("id"));
  return html(c, renderIncidentPage(incident), incident ? 200 : 404);
});

/* ---------------------------------------------------------------- admin */

app.get("/admin", async (c) => {
  if (!c.env.ADMIN_PASSWORD) {
    return html(c, renderLogin("ADMIN_PASSWORD is not configured. In the Cloudflare dashboard, add it under Settings > Variables and Secrets as a Secret (not a Build variable), or run `wrangler secret put ADMIN_PASSWORD`."));
  }
  if (!(await isAuthenticated(c.req.raw, c.env))) {
    return html(c, renderLogin());
  }
  const incidents = await listIncidents(c.env.DB, { limit: 100 });
  return html(c, renderAdmin(incidents));
});

app.post("/admin/login", async (c) => {
  const form = await c.req.formData();
  const password = form.get("password");
  if (!(await verifyPassword(c.env, password))) {
    return html(c, renderLogin("Incorrect password."), 401);
  }
  const token = await makeToken(c.env.ADMIN_PASSWORD);
  c.header("Set-Cookie", sessionCookie(token));
  return c.redirect("/admin", 303);
});

app.post("/admin/logout", (c) => {
  c.header("Set-Cookie", clearCookie());
  return c.redirect("/admin", 303);
});

// Guard all admin API routes.
app.use("/api/admin/*", async (c, next) => {
  if (!(await isAuthenticated(c.req.raw, c.env))) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});

app.post("/api/admin/incidents", async (c) => {
  const { fields, wantsJson } = await readBody(c);
  const affected = fields.servicesList ?? [];
  const incident = await createIncident(c.env.DB, {
    title: fields.title,
    body: fields.body,
    type: fields.type,
    status: fields.status,
    affectedServiceIds: affected,
    auto: false,
  });
  return wantsJson ? c.json(incident, 201) : c.redirect("/admin", 303);
});

app.post("/api/admin/incidents/:id/updates", async (c) => {
  const { fields, wantsJson } = await readBody(c);
  const id = c.req.param("id");
  await addIncidentUpdate(c.env.DB, id, fields.body, fields.status || "monitoring");
  if (fields.status) await updateIncident(c.env.DB, id, { status: fields.status });
  const incident = await getIncident(c.env.DB, id);
  return wantsJson ? c.json(incident) : c.redirect("/admin", 303);
});

app.post("/api/admin/incidents/:id/resolve", async (c) => {
  const { wantsJson } = await readBody(c);
  const id = c.req.param("id");
  await addIncidentUpdate(c.env.DB, id, "Incident resolved.", "resolved");
  const incident = await updateIncident(c.env.DB, id, { status: "resolved" });
  return wantsJson ? c.json(incident) : c.redirect("/admin", 303);
});

app.patch("/api/admin/incidents/:id", async (c) => {
  const fields = await c.req.json().catch(() => ({}));
  const incident = await updateIncident(c.env.DB, c.req.param("id"), {
    title: fields.title,
    body: fields.body,
    type: fields.type,
    status: fields.status,
    affectedServiceIds: fields.affectedServiceIds,
  });
  return c.json(incident ?? { error: "not found" }, incident ? 200 : 404);
});

app.post("/api/admin/incidents/:id/delete", async (c) => {
  const { wantsJson } = await readBody(c);
  await deleteIncident(c.env.DB, c.req.param("id"));
  return wantsJson ? c.json({ ok: true }) : c.redirect("/admin", 303);
});

// Manual probe trigger (handy for testing without waiting for cron).
// Forced so it ignores the probe-interval cadence gate.
app.post("/api/admin/probe", async (c) => {
  await runProbeCycle(c.env, { force: true });
  return c.json({ ok: true });
});

app.notFound((c) => html(c, renderIncidentPage(null), 404));

/* ------------------------------------------------------------- helpers */

function countIssues(incidents, days) {
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const counts = { info: 0, disruption: 0, outage: 0 };
  for (const i of incidents) {
    if (i.started_at >= since && counts[i.type] !== undefined) counts[i.type]++;
  }
  return counts;
}

async function readBody(c) {
  const contentType = c.req.header("content-type") || "";
  if (contentType.includes("application/json")) {
    const json = await c.req.json().catch(() => ({}));
    return {
      wantsJson: true,
      fields: {
        title: json.title,
        body: json.body,
        type: json.type,
        status: json.status,
        servicesList: json.affectedServiceIds ?? json.services ?? [],
      },
    };
  }
  const form = await c.req.formData();
  return {
    wantsJson: false,
    fields: {
      title: form.get("title") ?? undefined,
      body: form.get("body") ?? undefined,
      type: form.get("type") ?? undefined,
      status: form.get("status") ?? undefined,
      servicesList: form.getAll("services"),
    },
  };
}

/* ------------------------------------------------------ Worker handlers */

export default {
  fetch: app.fetch,

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runProbeCycle(env));
  },
};
