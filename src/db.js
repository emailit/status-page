/**
 * D1 query helpers. All timestamps are unix epoch seconds.
 */
import { config } from "./config.js";

export function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function genId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/* ------------------------------------------------------------------ checks */

/**
 * Insert a batch of check rows.
 * @param {D1Database} db
 * @param {Array<{service_id,region,ok,status_code,latency_ms,error,checked_at}>} rows
 */
export async function insertChecks(db, rows) {
  if (!rows.length) return;
  const stmt = db.prepare(
    `INSERT INTO checks (service_id, region, ok, status_code, latency_ms, error, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const batch = rows.map((r) =>
    stmt.bind(
      r.service_id,
      r.region,
      r.ok ? 1 : 0,
      r.status_code ?? null,
      r.latency_ms ?? null,
      r.error ?? null,
      r.checked_at
    )
  );
  await db.batch(batch);
}

/** Latest check per (service, region) - powers the live matrix. */
export async function getLatestMatrix(db) {
  const { results } = await db
    .prepare(
      `SELECT c.service_id, c.region, c.ok, c.status_code, c.latency_ms, c.error, c.checked_at
       FROM checks c
       JOIN (
         SELECT service_id, region, MAX(checked_at) AS max_at
         FROM checks
         GROUP BY service_id, region
       ) m
       ON c.service_id = m.service_id AND c.region = m.region AND c.checked_at = m.max_at
       GROUP BY c.service_id, c.region`
    )
    .all();
  return results ?? [];
}

/** Probe cadence in seconds — used to group region results into one cycle. */
function probeCycleSec() {
  return (config.probeIntervalMin ?? 5) * 60;
}

/**
 * Score probe cycles to match service health semantics: 1 = all regions up,
 * 0.5 = partial, 0 = all down. Regions are grouped by probe-interval window
 * (not exact checked_at) so parallel DO probes 1s apart count as one cycle.
 */
function cycleScoreSql() {
  return `
  WITH cycles AS (
    SELECT
      CAST(checked_at / ? AS INTEGER) AS cycle_id,
      COUNT(*) AS regions,
      SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS ok_regions
    FROM checks
    WHERE service_id = ? AND checked_at >= ?
    GROUP BY cycle_id
  ),
  cycle_score AS (
    SELECT
      cycle_id,
      CASE
        WHEN ok_regions = 0 THEN 0.0
        WHEN ok_regions < regions THEN 0.5
        ELSE 1.0
      END AS score
    FROM cycles
  )`;
}

/** Uptime fraction + counts for a service over the past N days. */
export async function getUptime(db, serviceId, days) {
  const since = nowSec() - days * 86400;
  const cycleSec = probeCycleSec();
  const row = await db
    .prepare(
      `${cycleScoreSql()}
       SELECT COUNT(*) AS total, SUM(score) AS ok_count FROM cycle_score`
    )
    .bind(cycleSec, serviceId, since)
    .first();
  const total = row?.total ?? 0;
  const okCount = row?.ok_count ?? 0;
  return {
    total,
    okCount,
    uptime: total > 0 ? okCount / total : null,
  };
}

/** Uptime over the past N hours (for "last hour" on the detail page). */
export async function getUptimeHours(db, serviceId, hours) {
  const since = nowSec() - hours * 3600;
  const cycleSec = probeCycleSec();
  const row = await db
    .prepare(
      `${cycleScoreSql()}
       SELECT COUNT(*) AS total, SUM(score) AS ok_count FROM cycle_score`
    )
    .bind(cycleSec, serviceId, since)
    .first();
  const total = row?.total ?? 0;
  const okCount = row?.ok_count ?? 0;
  return {
    total,
    okCount,
    uptime: total > 0 ? okCount / total : null,
  };
}

/** Recent latency samples for a service (for sparkline / detail page). */
export async function getRecentChecks(db, serviceId, limit = 90) {
  const { results } = await db
    .prepare(
      `SELECT region, ok, status_code, latency_ms, error, checked_at
       FROM checks
       WHERE service_id = ?
       ORDER BY checked_at DESC
       LIMIT ?`
    )
    .bind(serviceId, limit)
    .all();
  return results ?? [];
}

/** Daily uptime buckets for the last N days (for the uptime bar chart). */
export async function getDailyUptime(db, serviceId, days) {
  const since = nowSec() - days * 86400;
  const cycleSec = probeCycleSec();
  const { results } = await db
    .prepare(
      `${cycleScoreSql()},
       scored AS (
         SELECT CAST((cycle_id * ?) / 86400 AS INTEGER) AS day, score
         FROM cycle_score
       )
       SELECT day, COUNT(*) AS total, SUM(score) AS ok_count
       FROM scored
       GROUP BY day
       ORDER BY day ASC`
    )
    .bind(cycleSec, serviceId, since, cycleSec)
    .all();
  return results ?? [];
}

/**
 * Uptime buckets over the last `hours`, grouped into `bucketMin`-minute windows.
 * Returns rows keyed by bucket index (checked_at / (bucketMin*60)). The renderer
 * gap-fills to a contiguous range so empty buckets render gray.
 */
export async function getIntradayUptime(db, serviceId, hours = 24, bucketMin = 5) {
  const bucketSec = bucketMin * 60;
  const since = nowSec() - hours * 3600;
  const cycleSec = probeCycleSec();
  const { results } = await db
    .prepare(
      `${cycleScoreSql()},
       scored AS (
         SELECT CAST((cycle_id * ?) / ? AS INTEGER) AS bucket, score
         FROM cycle_score
       )
       SELECT bucket, COUNT(*) AS total, SUM(score) AS ok_count
       FROM scored
       GROUP BY bucket
       ORDER BY bucket ASC`
    )
    .bind(cycleSec, serviceId, since, cycleSec, bucketSec)
    .all();
  return results ?? [];
}

export async function pruneOldChecks(db, retentionDays) {
  const cutoff = nowSec() - retentionDays * 86400;
  await db.prepare(`DELETE FROM checks WHERE checked_at < ?`).bind(cutoff).run();
}

/** Most recent checked_at across all checks (0 if none). Used to gate cadence. */
export async function getLastCheckTime(db) {
  const row = await db.prepare(`SELECT MAX(checked_at) AS last FROM checks`).first();
  return row?.last ?? 0;
}

/* ----------------------------------------------------------- service_state */

export async function getServiceState(db, serviceId) {
  return db
    .prepare(`SELECT * FROM service_state WHERE service_id = ?`)
    .bind(serviceId)
    .first();
}

export async function getAllServiceState(db) {
  const { results } = await db.prepare(`SELECT * FROM service_state`).all();
  return results ?? [];
}

export async function upsertServiceState(db, serviceId, state) {
  const now = nowSec();
  await db
    .prepare(
      `INSERT INTO service_state
         (service_id, current_status, consecutive_failures, last_status_code, last_latency_ms, last_changed_at, last_alerted_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(service_id) DO UPDATE SET
         current_status = excluded.current_status,
         consecutive_failures = excluded.consecutive_failures,
         last_status_code = excluded.last_status_code,
         last_latency_ms = excluded.last_latency_ms,
         last_changed_at = excluded.last_changed_at,
         last_alerted_at = excluded.last_alerted_at,
         updated_at = excluded.updated_at`
    )
    .bind(
      serviceId,
      state.current_status,
      state.consecutive_failures ?? 0,
      state.last_status_code ?? null,
      state.last_latency_ms ?? null,
      state.last_changed_at ?? now,
      state.last_alerted_at ?? null,
      now
    )
    .run();
}

/* -------------------------------------------------------------- incidents */

export async function createIncident(db, { title, body, type, status, affectedServiceIds, auto }) {
  const id = genId("inc");
  const now = nowSec();
  const resolved = status === "resolved" ? now : null;
  await db
    .prepare(
      `INSERT INTO incidents (id, title, body, type, status, affected_service_ids, auto, started_at, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      title,
      body ?? null,
      type ?? "disruption",
      status ?? "investigating",
      JSON.stringify(affectedServiceIds ?? []),
      auto ? 1 : 0,
      now,
      resolved
    )
    .run();
  await addIncidentUpdate(db, id, body || title, status ?? "investigating");
  return getIncident(db, id);
}

export async function getIncident(db, id) {
  const inc = await db.prepare(`SELECT * FROM incidents WHERE id = ?`).bind(id).first();
  if (!inc) return null;
  inc.affected_service_ids = safeParseArray(inc.affected_service_ids);
  inc.updates = await getIncidentUpdates(db, id);
  return inc;
}

export async function listIncidents(db, { limit = 50, includeResolved = true } = {}) {
  const where = includeResolved ? "" : `WHERE status != 'resolved'`;
  const { results } = await db
    .prepare(`SELECT * FROM incidents ${where} ORDER BY started_at DESC LIMIT ?`)
    .bind(limit)
    .all();
  return (results ?? []).map((i) => ({
    ...i,
    affected_service_ids: safeParseArray(i.affected_service_ids),
  }));
}

export async function listActiveIncidents(db) {
  return listIncidents(db, { includeResolved: false });
}

export async function listIncidentsForService(db, serviceId, { limit = 50 } = {}) {
  const all = await listIncidents(db, { limit: 500 });
  return all.filter((i) => i.affected_service_ids.includes(serviceId)).slice(0, limit);
}

export async function updateIncident(db, id, fields) {
  const existing = await db.prepare(`SELECT * FROM incidents WHERE id = ?`).bind(id).first();
  if (!existing) return null;

  const next = {
    title: fields.title ?? existing.title,
    body: fields.body ?? existing.body,
    type: fields.type ?? existing.type,
    status: fields.status ?? existing.status,
    affected_service_ids:
      fields.affectedServiceIds !== undefined
        ? JSON.stringify(fields.affectedServiceIds)
        : existing.affected_service_ids,
  };

  let resolvedAt = existing.resolved_at;
  if (next.status === "resolved" && !existing.resolved_at) {
    resolvedAt = nowSec();
  } else if (next.status !== "resolved") {
    resolvedAt = null;
  }

  await db
    .prepare(
      `UPDATE incidents
       SET title = ?, body = ?, type = ?, status = ?, affected_service_ids = ?, resolved_at = ?
       WHERE id = ?`
    )
    .bind(next.title, next.body, next.type, next.status, next.affected_service_ids, resolvedAt, id)
    .run();

  return getIncident(db, id);
}

export async function deleteIncident(db, id) {
  await db.prepare(`DELETE FROM incident_updates WHERE incident_id = ?`).bind(id).run();
  await db.prepare(`DELETE FROM incidents WHERE id = ?`).bind(id).run();
}

export async function addIncidentUpdate(db, incidentId, body, status) {
  const id = genId("upd");
  const now = nowSec();
  await db
    .prepare(
      `INSERT INTO incident_updates (id, incident_id, body, status, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(id, incidentId, body, status, now)
    .run();
  return { id, incident_id: incidentId, body, status, created_at: now };
}

export async function getIncidentUpdates(db, incidentId) {
  const { results } = await db
    .prepare(
      `SELECT * FROM incident_updates WHERE incident_id = ? ORDER BY created_at DESC`
    )
    .bind(incidentId)
    .all();
  return results ?? [];
}

/** Find an open auto-incident for a service (used by the alert engine). */
export async function findOpenAutoIncident(db, serviceId) {
  const all = await listIncidents(db, { limit: 200, includeResolved: false });
  return all.find((i) => i.auto === 1 && i.affected_service_ids.includes(serviceId)) ?? null;
}

function safeParseArray(s) {
  try {
    const v = JSON.parse(s ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
