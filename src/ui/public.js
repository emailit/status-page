/** Public status page (home) and per-service detail page renderers. */
import { config, REGION_LABELS } from "../config.js";
import {
  page,
  escapeHtml,
  statusLabel,
  statusColorVar,
  incidentTypeColor,
  fmtDate,
  fmtDuration,
  tsSpan,
  isSignificantIncident,
} from "./layout.js";

const DAY = 86400;

function overallStatus(states) {
  const vals = config.services.map((s) => states[s.id]?.current_status ?? "unknown");
  if (vals.includes("down")) return "down";
  if (vals.includes("degraded")) return "degraded";
  if (vals.every((v) => v === "available")) return "available";
  return "unknown";
}

function overallHeadline(status, activeIncidents) {
  if (activeIncidents.length > 0) {
    const n = activeIncidents.length;
    return { title: `${n} active incident${n === 1 ? "" : "s"}`, sub: "We are actively investigating." };
  }
  switch (status) {
    case "available":
      return { title: "All systems operational", sub: "We are not aware of any issues at this time." };
    case "degraded":
      return { title: "Degraded performance", sub: "Some services are experiencing issues." };
    case "down":
      return { title: "Major outage", sub: "We are actively mitigating an outage." };
    default:
      return { title: "Status unknown", sub: "Awaiting first monitoring data." };
  }
}

function header() {
  return `<header class="site-header">
    <div class="container header-inner">
      <div class="brand"><a href="/">${escapeHtml(config.pageTitle)}</a></div>
      <div class="header-tools">
        <label class="tz-select">
          <span class="tz-label">Timezone</span>
          <select data-tz-select aria-label="Timezone"></select>
        </label>
      </div>
    </div>
  </header>`;
}

function renderFooter() {
  const columns = config.footer?.columns ?? [];
  if (!columns.length) return `<footer class="footer"></footer>`;
  const cols = columns
    .map((col) => {
      const links = (col.links ?? [])
        .map(
          (l) =>
            `<li><a href="${escapeHtml(l.href)}" rel="noopener">${escapeHtml(l.label)}</a></li>`
        )
        .join("");
      return `<div class="footer-col">
        <h4 class="footer-title">${escapeHtml(col.title ?? "")}</h4>
        <ul class="footer-links">${links}</ul>
      </div>`;
    })
    .join("");
  return `<footer class="footer footer-cols"><div class="footer-inner">${cols}</div></footer>`;
}

export function renderHome({ states, matrix, activeIncidents, recentIncidents, lastUpdated }) {
  const status = overallStatus(states);
  const headline = overallHeadline(status, activeIncidents);

  const body = `
  ${header()}
  <main class="container" data-status-root>
    ${renderBanner(status, headline)}
    ${activeIncidents.length ? renderActiveIncidents(activeIncidents) : ""}
    ${renderLiveMatrix(matrix, lastUpdated)}
    ${renderServices(states)}
    ${renderRecentIncidents(recentIncidents)}
  </main>
  ${renderFooter()}
  <div class="tooltip" data-tooltip hidden></div>
  <script src="/app.js" defer></script>`;

  return page({ title: `${config.pageTitle} Status`, body });
}

function renderBanner(status, headline) {
  return `<section class="banner banner-${status}">
    <div class="banner-dot" style="background:${statusColorVar(status)}"></div>
    <div>
      <h1 class="banner-title">${escapeHtml(headline.title)}</h1>
      <p class="banner-sub">${escapeHtml(headline.sub)}</p>
    </div>
  </section>`;
}

function renderActiveIncidents(incidents) {
  const items = incidents
    .map((i) => {
      const latest = i.updates?.[0];
      return `<a class="incident-card" href="/incident/${escapeHtml(i.id)}">
        <div class="incident-head">
          <span class="pill" style="--pill:${incidentTypeColor(i.type)}">${escapeHtml(i.type)}</span>
          <span class="incident-title">${escapeHtml(i.title)}</span>
        </div>
        <div class="incident-meta">${escapeHtml(i.status)} · ${tsSpan(i.started_at)}</div>
        ${latest ? `<p class="incident-body">${escapeHtml(latest.body)}</p>` : ""}
      </a>`;
    })
    .join("");
  return `<section class="section">
    <h2 class="section-title">Active incidents</h2>
    <div class="incident-list">${items}</div>
  </section>`;
}

function renderLiveMatrix(matrix, lastUpdated) {
  const regions = config.regions;
  const head = regions
    .map((r) => `<th title="${escapeHtml(r)}">${escapeHtml(REGION_LABELS[r] || r)}</th>`)
    .join("");

  const rows = config.services
    .map((svc) => {
      const cells = regions
        .map((region) => {
          const cell = matrix[svc.id]?.[region];
          if (!cell) return `<td class="cell cell-none" title="no data">-</td>`;
          const cls = cell.ok ? "cell-ok" : "cell-bad";
          const detail = cell.ok
            ? `${cell.latency_ms != null ? cell.latency_ms + " ms" : "ok"}`
            : escapeHtml(cell.error || `HTTP ${cell.status_code ?? "?"}`);
          const label = cell.ok ? (cell.latency_ms != null ? `${cell.latency_ms} ms` : "ok") : "×";
          return `<td class="cell ${cls}" title="${escapeHtml(detail)}">${escapeHtml(label)}</td>`;
        })
        .join("");
      return `<tr><th class="row-head">${escapeHtml(svc.name)}</th>${cells}</tr>`;
    })
    .join("");

  return `<section class="section">
    <h2 class="section-title">Live service data</h2>
    <p class="section-sub">Live probe results by source region. Numbers show response latency; × indicates a failed check.</p>
    <div class="matrix-wrap">
      <table class="matrix">
        <thead><tr><th class="row-head">Service</th>${head}</tr></thead>
        <tbody data-matrix-body>${rows}</tbody>
      </table>
    </div>
    <div class="last-updated">Last updated ${lastUpdated ? tsSpan(lastUpdated) : "<span data-last-updated>N/A</span>"}</div>
  </section>`;
}

function renderServices(states) {
  const items = config.services
    .map((svc) => {
      const st = states[svc.id]?.current_status ?? "unknown";
      return `<a class="service-row" href="/service/${escapeHtml(svc.id)}" data-status="${escapeHtml(st)}">
        <span class="service-name">${escapeHtml(svc.name)}</span>
        <span class="status-badge status-badge-${escapeHtml(st)}">
          <span class="status-dot"></span>
          <span class="status-text">${escapeHtml(statusLabel(st))}</span>
        </span>
      </a>`;
    })
    .join("");

  return `<section class="section">
    <h2 class="section-title">Services</h2>
    <div class="service-grid" data-service-list>${items}</div>
  </section>`;
}

function renderRecentIncidents(incidents) {
  const visible = incidents.filter(isSignificantIncident);
  if (!visible.length) {
    return `<section class="section">
      <h2 class="section-title">Past incidents</h2>
      <p class="empty">No incidents reported.</p>
    </section>`;
  }
  return `<section class="section">
    <h2 class="section-title">Past incidents</h2>
    <div class="past-list">${visible.map(pastIncidentRow).join("")}</div>
  </section>`;
}

function pastIncidentRow(i) {
  const duration = i.resolved_at ? fmtDuration(i.started_at, i.resolved_at) : "ongoing";
  const state = i.status === "resolved" ? "Resolved" : escapeHtml(i.status);
  return `<a class="past-incident" href="/incident/${escapeHtml(i.id)}">
    <div class="past-meta">${tsSpan(i.started_at)}</div>
    <div class="past-title">${escapeHtml(i.title)}</div>
    <div class="past-tags">
      <span class="muted">${state}</span>
      <span class="muted">Duration: ${escapeHtml(duration)}</span>
      <span class="pill" style="--pill:${incidentTypeColor(i.type)}">${escapeHtml(i.type)}</span>
    </div>
  </a>`;
}

/* ------------------------------------------------------------- detail page */

export function renderServiceDetail({
  service,
  state,
  uptime,
  uptime24h,
  uptime1h,
  issueCounts,
  incidents,
  dailyUptime,
  intradayRecent,
}) {
  const st = state?.current_status ?? "unknown";
  const visibleIncidents = incidents.filter(isSignificantIncident);
  const dayBars = renderDailyBars(dailyUptime, visibleIncidents, 30);
  const intradayBars = renderIntradayBars(intradayRecent, 6, 5);
  const lastHourPct =
    uptime1h?.uptime != null ? (uptime1h.uptime * 100).toFixed(2) + "%" : "N/A";

  const incidentItems = visibleIncidents.length
    ? visibleIncidents.map(pastIncidentRow).join("")
    : `<p class="empty">No past issues.</p>`;

  const body = `
  ${header()}
  <main class="container" data-status-root>
    <nav class="crumbs"><a href="/">Overview</a> / <span>${escapeHtml(service.name)}</span></nav>
    <section class="banner banner-${st}">
      <div class="banner-dot" style="background:${statusColorVar(st)}"></div>
      <div>
        <h1 class="banner-title">${escapeHtml(service.name)}</h1>
        <p class="banner-sub">${escapeHtml(detailSub(st, uptime1h))}</p>
      </div>
    </section>

    <section class="section detail-row">
      <div class="metric-card">
        <div class="metric-head">
          <div class="metric-label">Up Time 30 Days</div>
          <div class="metric-value">${uptime.uptime != null ? (uptime.uptime * 100).toFixed(3) + "%" : "N/A"}</div>
        </div>
        <div class="uptime-bars" data-bars>${dayBars}</div>
      </div>

      <div class="metric-card">
        <div class="metric-label">Issues 30 Days</div>
        <div class="issues-counts">
          <span><strong style="color:${incidentTypeColor("disruption")}">${issueCounts.disruption}</strong> disruption</span>
          <span><strong style="color:${incidentTypeColor("info")}">${issueCounts.info}</strong> info</span>
          <span><strong style="color:${incidentTypeColor("outage")}">${issueCounts.outage}</strong> outage</span>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="metric-card metric-card-chart">
        <div class="metric-head">
          <div>
            <div class="metric-label">Recent uptime</div>
            <p class="metric-caption">Last 6 hours · 5-min buckets · right = now</p>
          </div>
          <div class="metric-stats">
            <span class="metric-stat">
              <span class="metric-stat-value">${uptime24h?.uptime != null ? (uptime24h.uptime * 100).toFixed(2) + "%" : "N/A"}</span>
              <span class="metric-stat-label">24h</span>
            </span>
            <span class="metric-stat">
              <span class="metric-stat-value">${lastHourPct}</span>
              <span class="metric-stat-label">1h</span>
            </span>
          </div>
        </div>
        <div class="uptime-bars uptime-bars-dense uptime-bars-fill" data-bars data-bars-recent>${intradayBars}</div>
      </div>
    </section>

    <section class="section">
      <h2 class="section-title">Past Issues</h2>
      <div class="past-list">${incidentItems}</div>
    </section>
  </main>
  ${renderFooter()}
  <div class="tooltip" data-tooltip hidden></div>
  <script src="/app.js" defer></script>`;

  return page({ title: `${service.name} Status`, body });
}

function detailSub(status, uptime1h) {
  switch (status) {
    case "available":
      if (uptime1h?.uptime != null && uptime1h.uptime >= 0.999) {
        return "Service fully operational. All probes passing in the last hour.";
      }
      return "Service fully operational.";
    case "degraded":
      return "Service is experiencing degraded performance.";
    case "down":
      return "Service is currently experiencing an outage.";
    default:
      return "Awaiting monitoring data.";
  }
}

function barColor(ratio) {
  if (ratio == null) return "var(--muted)";
  if (ratio >= 0.999) return "var(--ok)";
  if (ratio >= 0.5) return "var(--warn)";
  return "var(--bad)";
}

/**
 * 30-day uptime bars, gap-filled so every day has a bar (gray when no data).
 * Hover shows date, uptime %, and any incidents that started that day.
 */
function renderDailyBars(dailyUptime, incidents, days) {
  const byDay = new Map();
  for (const d of dailyUptime) byDay.set(Number(d.day), d);

  // Map incidents to their start day-index.
  const incByDay = new Map();
  for (const i of incidents) {
    const dayIdx = Math.floor(i.started_at / DAY);
    if (!incByDay.has(dayIdx)) incByDay.set(dayIdx, []);
    incByDay.get(dayIdx).push(i);
  }

  const todayIdx = Math.floor(Date.now() / 1000 / DAY);
  const bars = [];
  for (let k = days - 1; k >= 0; k--) {
    const dayIdx = todayIdx - k;
    const row = byDay.get(dayIdx);
    const total = row?.total ?? 0;
    const ok = row?.ok_count ?? 0;
    const ratio = total > 0 ? ok / total : null;
    const dateStr = new Date(dayIdx * DAY * 1000).toISOString().slice(0, 10);
    const pct = ratio != null ? (ratio * 100).toFixed(2) + "%" : "No data";

    const incs = incByDay.get(dayIdx) ?? [];
    const incLines = incs
      .map((i) => `${i.type}: ${i.title}`)
      .join("\n");
    const tip = [`${dateStr}`, `Uptime: ${pct}`, incLines].filter(Boolean).join("\n");

    bars.push(
      `<span class="bar" style="background:${barColor(ratio)}" data-tip="${escapeHtml(tip)}"></span>`
    );
  }
  return bars.join("");
}

/**
 * 24h uptime bars in 5-minute buckets (288 bars), gap-filled (gray = no data).
 * Hover shows the time window and uptime %.
 */
function renderIntradayBars(intraday, hours, bucketMin) {
  const bucketSec = bucketMin * 60;
  const byBucket = new Map();
  for (const b of intraday) byBucket.set(Number(b.bucket), b);

  const nowBucket = Math.floor(Date.now() / 1000 / bucketSec);
  const fullCount = Math.round((hours * 3600) / bucketSec);
  const windowStart = nowBucket - (fullCount - 1);

  // Always render the full window with the right edge pinned to "now" so the
  // most recent probes are visible without horizontal scrolling.
  const bars = [];
  for (let idx = windowStart; idx <= nowBucket; idx++) {
    const row = byBucket.get(idx);
    const total = row?.total ?? 0;
    const ok = row?.ok_count ?? 0;
    const ratio = total > 0 ? ok / total : null;
    const startSec = idx * bucketSec;
    const pct = ratio != null ? (ratio * 100).toFixed(0) + "%" : "No data";
    bars.push(
      `<span class="bar bar-dense" style="background:${barColor(ratio)}" data-tip-ts="${startSec}" data-tip-dur="${bucketSec}" data-tip-pct="${escapeHtml(pct)}"></span>`
    );
  }
  return bars.join("");
}

export function renderIncidentPage(incident) {
  if (!incident) {
    return page({
      title: "Incident not found",
      body: `${header()}<main class="container"><p class="empty">Incident not found.</p><p><a href="/">Back</a></p></main>${renderFooter()}<script src="/app.js" defer></script>`,
    });
  }
  const duration = incident.resolved_at ? fmtDuration(incident.started_at, incident.resolved_at) : "ongoing";
  const updates = (incident.updates ?? [])
    .map(
      (u) => `<li class="timeline-item">
        <div class="timeline-status">${escapeHtml(u.status)}</div>
        <div class="timeline-body">${escapeHtml(u.body)}</div>
        <div class="timeline-time">${tsSpan(u.created_at)}</div>
      </li>`
    )
    .join("");

  const services = (incident.affected_service_ids ?? [])
    .map((id) => config.services.find((s) => s.id === id)?.name || id)
    .map((n) => `<span class="muted">${escapeHtml(n)}</span>`)
    .join(", ");

  const body = `
  ${header()}
  <main class="container" data-status-root>
    <nav class="crumbs"><a href="/">Overview</a> / <span>Incident</span></nav>
    <section class="section">
      <div class="incident-head">
        <span class="pill" style="--pill:${incidentTypeColor(incident.type)}">${escapeHtml(incident.type)}</span>
        <h1 class="banner-title">${escapeHtml(incident.title)}</h1>
      </div>
      <p class="muted">Started ${tsSpan(incident.started_at)} · ${escapeHtml(incident.status)} · Duration: ${escapeHtml(duration)}</p>
      ${services ? `<p class="muted">Affected: ${services}</p>` : ""}
    </section>
    <section class="section">
      <h2 class="section-title">Timeline</h2>
      <ul class="timeline">${updates || '<li class="empty">No updates.</li>'}</ul>
    </section>
  </main>
  ${renderFooter()}
  <div class="tooltip" data-tooltip hidden></div>
  <script src="/app.js" defer></script>`;

  return page({ title: `${incident.title}`, body });
}
