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
  nowSec,
  createIncident,
  updateIncident,
  addIncidentUpdate,
  findOpenAutoIncident,
} from "./db.js";
import { sendDownAlert, sendDegradedAlert, sendRecoveryAlert } from "./alerts.js";

/** Run one full probe + evaluation cycle. */
export async function runProbeCycle(env) {
  const services = config.services;
  const regions = config.regions;
  if (!services.length || !regions.length) return;

  // Fan out: one DO per region, placed near that region.
  const perRegion = await Promise.all(
    regions.map(async (region) => {
      try {
        const id = env.REGION_PROBE.idFromName(region);
        const stub = env.REGION_PROBE.get(id, { locationHint: region });
        const results = await stub.probeAll({ region, services });
        return { region, results };
      } catch (err) {
        // If a region DO fails entirely, record failures for visibility.
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
          })),
        };
      }
    })
  );

  // Flatten + persist raw checks.
  const allRows = perRegion.flatMap((r) => r.results);
  await insertChecks(env.DB, allRows);

  // Group results by service for evaluation.
  const byService = new Map();
  for (const row of allRows) {
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
  const alerts = config.alerts ?? {};
  const failFraction = alerts.regionFailFraction ?? 0.5;
  const threshold = alerts.failureThreshold ?? 2;

  const total = rows.length || 1;
  const failed = rows.filter((r) => !r.ok).length;
  const failRatio = failed / total;

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

  const cycleFailing = failRatio >= failFraction;
  const consecutiveFailures = cycleFailing ? (prev.consecutive_failures ?? 0) + 1 : 0;

  // Determine new status.
  let newStatus;
  if (consecutiveFailures >= threshold) {
    newStatus = "down";
  } else if (cycleFailing) {
    // Failing but below threshold -> show degraded rather than fully down.
    newStatus = "degraded";
  } else if (anySlow) {
    newStatus = "degraded";
  } else {
    newStatus = "available";
  }

  const statusChanged = newStatus !== prev.current_status;
  const now = nowSec();

  const evaluation = {
    service,
    status: newStatus,
    previousStatus: prev.current_status,
    failRatio,
    avgLatency,
    regions: rows,
  };

  // Alerting + incident management on meaningful transitions.
  let lastAlertedAt = prev.last_alerted_at ?? null;

  const becameDown = newStatus === "down" && prev.current_status !== "down";
  const recovered =
    newStatus === "available" && (prev.current_status === "down" || prev.current_status === "degraded");

  if (becameDown) {
    await openOrUpdateAutoIncident(env, service, "outage", rows);
    const r = await sendDownAlert(env, service, evaluation);
    if (r.ok) lastAlertedAt = now;
  } else if (newStatus === "degraded" && prev.current_status === "available") {
    await openOrUpdateAutoIncident(env, service, "disruption", rows);
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
