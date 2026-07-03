/**
 * Probe coordinator + health evaluation.
 *
 * Called from `scheduled()` each cron cycle. Fans out to one RegionProbe
 * Durable Object per configured region (placed via locationHint), records
 * results in D1, evaluates per-service health, manages auto-incidents, and
 * sends Emailit alerts on state transitions.
 */
import { config, getService } from "./config.js";
import {
  insertChecks,
  getServiceState,
  upsertServiceState,
  pruneOldChecks,
  getLastCheckTime,
  nowSec,
  createIncident,
  updateIncident,
  addIncidentUpdate,
  findOpenAutoIncident,
} from "./db.js";
import { sendDownAlert, sendDegradedAlert, sendRecoveryAlert } from "./alerts.js";

/**
 * Run one full probe + evaluation cycle.
 * @param {object} env
 * @param {object} [opts]
 * @param {boolean} [opts.force] skip the interval gate (used by manual probe)
 */
export async function runProbeCycle(env, opts = {}) {
  const services = config.services;
  const regions = config.regions;
  if (!services.length || !regions.length) return;

  // Cadence gate: only probe if probeIntervalMin has elapsed since the last check.
  // The cron fires every minute; this makes the effective interval configurable.
  if (!opts.force) {
    const intervalSec = (config.probeIntervalMin ?? 5) * 60;
    const last = await getLastCheckTime(env.DB);
    // Allow a small slack so a 5-min interval isn't pushed to 6 by cron jitter.
    if (last && nowSec() - last < intervalSec - 15) return;
  }

  // Fan out: one DO per region, placed near that region.
  const perRegion = await Promise.all(
    regions.map(async (region) => {
      try {
        const id = env.REGION_PROBE.idFromName(region);
        const stub = env.REGION_PROBE.get(id, { locationHint: region });
        const results = await stub.probeAll({ region, services });
        return { region, results };
      } catch (err) {
        // The region's Durable Object could not run this cycle (e.g. cold-start
        // / placement hiccup on Cloudflare's side). This is a MONITORING failure,
        // not a service failure. Record the rows for visibility but flag them so
        // health evaluation ignores them (otherwise a single region's probe
        // outage would falsely mark every service degraded).
        const checkedAt = nowSec();
        return {
          region,
          results: services.map((svc) => ({
            service_id: svc.id,
            region,
            ok: false,
            status_code: null,
            latency_ms: null,
            error: `probe dispatch failed: ${String(err?.message || err)}`,
            checked_at: checkedAt,
            probe_error: true,
          })),
        };
      }
    })
  );

  // Flatten. Drop monitoring-failure rows (a region DO that couldn't run this
  // cycle) so they never count as service downtime in uptime charts, the live
  // matrix, or health evaluation.
  const allRows = perRegion.flatMap((r) => r.results);
  const realRows = allRows.filter((r) => !r.probe_error);
  const dispatchFailures = allRows.length - realRows.length;
  if (dispatchFailures > 0) {
    console.warn(
      `probe: ${dispatchFailures} region/service dispatch failure(s) ignored (monitoring issue, not a service outage)`
    );
  }

  // Persist only real probe results.
  await insertChecks(env.DB, realRows);

  // Group results by service for evaluation.
  const byService = new Map();
  for (const row of realRows) {
    if (!byService.has(row.service_id)) byService.set(row.service_id, []);
    byService.get(row.service_id).push(row);
  }

  for (const svc of services) {
    const rows = byService.get(svc.id) ?? [];
    await evaluateService(env, svc, rows);
  }

  // Housekeeping: prune old rows occasionally (roughly 1 in 30 cycles).
  if (Math.random() < 1 / 30) {
    try {
      await pruneOldChecks(env.DB, config.retentionDays ?? 45);
    } catch {
      /* best effort */
    }
  }
}

/**
 * Evaluate a single service's health from this cycle's region results,
 * update service_state, manage auto-incidents, and alert on transitions.
 */
async function evaluateService(env, service, rows) {
  // No successful dispatch to any region this cycle => no signal. Leave the
  // service's status untouched rather than inventing an outage/disruption.
  if (rows.length === 0) return;

  const total = rows.length;
  const failed = rows.filter((r) => !r.ok).length;
  const allFail = failed >= total;
  const someFail = failed > 0 && failed < total;

  // Degraded if up everywhere but slow beyond degradedMs in any region.
  const degradedMs = service.degradedMs;
  const anySlow =
    degradedMs != null &&
    rows.some((r) => r.ok && r.latency_ms != null && r.latency_ms > degradedMs);

  const okRows = rows.filter((r) => r.ok);
  const avgLatency =
    okRows.length > 0
      ? Math.round(okRows.reduce((a, r) => a + (r.latency_ms ?? 0), 0) / okRows.length)
      : null;
  const lastStatusCode = rows.find((r) => r.status_code != null)?.status_code ?? null;

  const prev = (await getServiceState(env.DB, service.id)) ?? {
    current_status: "unknown",
    consecutive_failures: 0,
    last_changed_at: nowSec(),
    last_alerted_at: null,
  };

  // Status semantics:
  //   all regions fail  -> down    (outage)
  //   some regions fail -> degraded (disruption)
  //   all up but slow   -> degraded
  //   otherwise         -> available
  // Probes are already retried in-region, so a failure here is not transient.
  let newStatus;
  let incidentType = null;
  if (allFail) {
    newStatus = "down";
    incidentType = "outage";
  } else if (someFail) {
    newStatus = "degraded";
    incidentType = "disruption";
  } else if (anySlow) {
    newStatus = "degraded";
    incidentType = "disruption";
  } else {
    newStatus = "available";
  }

  const consecutiveFailures = newStatus === "available" ? 0 : (prev.consecutive_failures ?? 0) + 1;
  const statusChanged = newStatus !== prev.current_status;
  const now = nowSec();

  const evaluation = {
    service,
    status: newStatus,
    previousStatus: prev.current_status,
    failedCount: failed,
    total,
    avgLatency,
    regions: rows,
  };

  // Alerting + incident management on meaningful transitions.
  let lastAlertedAt = prev.last_alerted_at ?? null;

  const wasProblem = prev.current_status === "down" || prev.current_status === "degraded";
  const recovered = newStatus === "available" && wasProblem;

  if (newStatus === "down" && prev.current_status !== "down") {
    await openOrUpdateAutoIncident(env, service, "outage", rows);
    const r = await sendDownAlert(env, service, evaluation);
    if (r.ok) lastAlertedAt = now;
  } else if (newStatus === "degraded" && prev.current_status !== "degraded") {
    await openOrUpdateAutoIncident(env, service, incidentType ?? "disruption", rows);
    const r = await sendDegradedAlert(env, service, evaluation);
    if (r.ok) lastAlertedAt = now;
  } else if (recovered) {
    await resolveAutoIncident(env, service);
    const r = await sendRecoveryAlert(env, service, evaluation);
    if (r.ok) lastAlertedAt = now;
  }

  await upsertServiceState(env.DB, service.id, {
    current_status: newStatus,
    consecutive_failures: consecutiveFailures,
    last_status_code: lastStatusCode,
    last_latency_ms: avgLatency,
    last_changed_at: statusChanged ? now : prev.last_changed_at ?? now,
    last_alerted_at: lastAlertedAt,
  });
}

async function openOrUpdateAutoIncident(env, service, type, rows) {
  const existing = await findOpenAutoIncident(env.DB, service.id);
  const detail = summarizeFailures(rows);
  if (existing) {
    if (existing.type !== type) {
      await updateIncident(env.DB, existing.id, { type, status: "identified" });
    }
    await addIncidentUpdate(env.DB, existing.id, detail, "identified");
    return existing.id;
  }
  const inc = await createIncident(env.DB, {
    title: `${service.name} ${type === "outage" ? "outage" : "degraded performance"}`,
    body: detail,
    type,
    status: "investigating",
    affectedServiceIds: [service.id],
    auto: true,
  });
  return inc.id;
}

async function resolveAutoIncident(env, service) {
  const existing = await findOpenAutoIncident(env.DB, service.id);
  if (!existing) return;
  await addIncidentUpdate(env.DB, existing.id, `${service.name} has recovered.`, "resolved");
  await updateIncident(env.DB, existing.id, { status: "resolved" });
}

function summarizeFailures(rows) {
  const failing = rows.filter((r) => !r.ok);
  if (!failing.length) return "Automated probe detected an issue.";
  const parts = failing.map(
    (r) => `${r.region}: ${r.error || (r.status_code ? "HTTP " + r.status_code : "failed")}`
  );
  return `Automated probe detected failures from ${failing.length} region(s): ${parts.join("; ")}.`;
}
