/** Builds the data snapshot used by the home page and /api/status.json. */
import { config } from "./config.js";
import { getLatestMatrix, getAllServiceState, listActiveIncidents, listIncidents } from "./db.js";

export async function buildSnapshot(env) {
  const [matrixRows, stateRows, activeIncidents, recentIncidents] = await Promise.all([
    getLatestMatrix(env.DB),
    getAllServiceState(env.DB),
    listActiveIncidents(env.DB),
    listIncidents(env.DB, { limit: 15 }),
  ]);

  // states keyed by service id
  const states = {};
  for (const s of stateRows) states[s.service_id] = s;

  // matrix[serviceId][region] = cell
  const matrix = {};
  let lastUpdated = 0;
  for (const row of matrixRows) {
    if (!matrix[row.service_id]) matrix[row.service_id] = {};
    matrix[row.service_id][row.region] = {
      ok: !!row.ok,
      status_code: row.status_code,
      latency_ms: row.latency_ms,
      error: row.error,
      checked_at: row.checked_at,
    };
    if (row.checked_at > lastUpdated) lastUpdated = row.checked_at;
  }

  return {
    pageTitle: config.pageTitle,
    regions: config.regions,
    services: config.services.map((s) => ({ id: s.id, name: s.name, group: s.group || "Services" })),
    states,
    matrix,
    activeIncidents,
    recentIncidents,
    lastUpdated: lastUpdated || null,
  };
}
