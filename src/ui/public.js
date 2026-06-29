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
} from "./layout.js";

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
      <div class="brand">${escapeHtml(config.pageTitle)}</div>
      <nav class="nav"><a href="/">Status</a></nav>
    </div>
  </header>`;
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
    <footer class="footer">
      <span>Powered by Cloudflare Status Page</span>
    </footer>
  </main>
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
        <div class="incident-meta">${escapeHtml(i.status)} · ${escapeHtml(fmtDate(i.started_at))}</div>
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
          const label = cell.ok ? (cell.latency_ms != null ? `${cell.latency_ms}` : "ok") : "×";
          return `<td class="cell ${cls}" title="${escapeHtml(detail)}">${escapeHtml(label)}</td>`;
        })
        .join("");
      return `<tr><th class="row-head">${escapeHtml(svc.name)}</th>${cells}</tr>`;
    })
    .join("");

  return `<section class="section">
    <h2 class="section-title">Live service data</h2>
    <p class="section-sub">Live probe results by source region. Numbers are latency in ms; × indicates a failed check.</p>
    <div class="matrix-wrap">
      <table class="matrix">
        <thead><tr><th class="row-head">Service</th>${head}</tr></thead>
        <tbody data-matrix-body>${rows}</tbody>
      </table>
    </div>
    <div class="last-updated">Last updated <span data-last-updated>${escapeHtml(lastUpdated ? fmtDate(lastUpdated) : "N/A")}</span></div>
  </section>`;
}

function renderServices(states) {
  const groups = new Map();
  for (const svc of config.services) {
    const g = svc.group || "Services";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(svc);
  }

  const sections = [...groups.entries()]
    .map(([group, svcs]) => {
      const items = svcs
        .map((svc) => {
          const st = states[svc.id]?.current_status ?? "unknown";
          return `<a class="service-row" href="/service/${escapeHtml(svc.id)}">
            <span class="service-name">${escapeHtml(svc.name)}</span>
            <span class="service-status">
              <span class="status-text" style="color:${statusColorVar(st)}">${escapeHtml(statusLabel(st))}</span>
              <span class="status-dot" style="background:${statusColorVar(st)}"></span>
            </span>
          </a>`;
        })
        .join("");
      return `<div class="service-group">
        <h3 class="service-group-title">${escapeHtml(group)}</h3>
        <div class="service-list" data-service-list>${items}</div>
      </div>`;
    })
    .join("");

  return `<section class="section">
    <h2 class="section-title">Services</h2>
    ${sections}
  </section>`;
}

function renderRecentIncidents(incidents) {
  if (!incidents.length) {
    return `<section class="section">
      <h2 class="section-title">Past incidents</h2>
      <p class="empty">No incidents reported.</p>
    </section>`;
  }
  const items = incidents
    .map((i) => {
      const duration = i.resolved_at ? fmtDuration(i.started_at, i.resolved_at) : "ongoing";
      return `<a class="past-incident" href="/incident/${escapeHtml(i.id)}">
        <div class="past-meta">${escapeHtml(fmtDate(i.started_at))}</div>
        <div class="past-title">${escapeHtml(i.title)}</div>
        <div class="past-tags">
          <span class="pill" style="--pill:${incidentTypeColor(i.type)}">${escapeHtml(i.type)}</span>
          <span class="muted">${escapeHtml(i.status)}</span>
          <span class="muted">Duration: ${escapeHtml(duration)}</span>
        </div>
      </a>`;
    })
    .join("");
  return `<section class="section">
    <h2 class="section-title">Past incidents</h2>
    <div class="past-list">${items}</div>
  </section>`;
}

export function renderServiceDetail({ service, state, uptime, issueCounts, incidents, dailyUptime, recent }) {
  const st = state?.current_status ?? "unknown";
  const bars = renderUptimeBars(dailyUptime);
  const incidentItems = incidents.length
    ? incidents
        .map((i) => {
          const duration = i.resolved_at ? fmtDuration(i.started_at, i.resolved_at) : "ongoing";
          return `<a class="past-incident" href="/incident/${escapeHtml(i.id)}">
            <div class="past-meta">${escapeHtml(fmtDate(i.started_at))}</div>
            <div class="past-title">${escapeHtml(i.title)}</div>
            <div class="past-tags">
              <span class="pill" style="--pill:${incidentTypeColor(i.type)}">${escapeHtml(i.type)}</span>
              <span class="muted">${escapeHtml(i.status)}</span>
              <span class="muted">Duration: ${escapeHtml(duration)}</span>
            </div>
          </a>`;
        })
        .join("")
    : `<p class="empty">No past issues.</p>`;

  const body = `
  ${header()}
  <main class="container">
    <nav class="crumbs"><a href="/">Overview</a> / <span>${escapeHtml(service.name)}</span></nav>
    <section class="banner banner-${st}">
      <div class="banner-dot" style="background:${statusColorVar(st)}"></div>
      <div>
        <h1 class="banner-title">${escapeHtml(service.name)}</h1>
        <p class="banner-sub">${escapeHtml(detailSub(st))}</p>
      </div>
    </section>

    <section class="section stats-grid">
      <div class="stat">
        <div class="stat-label">Uptime 30 days</div>
        <div class="stat-value">${uptime.uptime != null ? (uptime.uptime * 100).toFixed(3) + "%" : "N/A"}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Issues 30 days</div>
        <div class="stat-value stat-issues">
          <span><strong style="color:${incidentTypeColor("disruption")}">${issueCounts.disruption}</strong> disruption</span>
          <span><strong style="color:${incidentTypeColor("outage")}">${issueCounts.outage}</strong> outage</span>
          <span><strong style="color:${incidentTypeColor("info")}">${issueCounts.info}</strong> info</span>
        </div>
      </div>
      <div class="stat">
        <div class="stat-label">Avg latency</div>
        <div class="stat-value">${state?.last_latency_ms != null ? state.last_latency_ms + " ms" : "N/A"}</div>
      </div>
    </section>

    <section class="section">
      <h2 class="section-title">Uptime (last ${dailyUptime.length || 0} days)</h2>
      <div class="uptime-bars">${bars}</div>
    </section>

    <section class="section">
      <h2 class="section-title">Past issues</h2>
      <div class="past-list">${incidentItems}</div>
    </section>

    <footer class="footer"><a href="/">Back to overview</a></footer>
  </main>`;

  return page({ title: `${service.name} Status`, body });
}

function detailSub(status) {
  switch (status) {
    case "available":
      return "Service fully operational.";
    case "degraded":
      return "Service is experiencing degraded performance.";
    case "down":
      return "Service is currently experiencing an outage.";
    default:
      return "Awaiting monitoring data.";
  }
}

function renderUptimeBars(dailyUptime) {
  if (!dailyUptime.length) {
    return `<span class="empty">No data yet.</span>`;
  }
  return dailyUptime
    .map((d) => {
      const ratio = d.total > 0 ? d.ok_count / d.total : null;
      let color = "var(--muted)";
      if (ratio != null) {
        if (ratio >= 0.999) color = "var(--ok)";
        else if (ratio >= 0.95) color = "var(--warn)";
        else color = "var(--bad)";
      }
      const pct = ratio != null ? (ratio * 100).toFixed(2) + "%" : "no data";
      const date = new Date(d.day * 86400 * 1000).toISOString().slice(0, 10);
      return `<span class="bar" style="background:${color}" title="${date}: ${pct}"></span>`;
    })
    .join("");
}

export function renderIncidentPage(incident) {
  if (!incident) {
    return page({
      title: "Incident not found",
      body: `${header()}<main class="container"><p class="empty">Incident not found.</p><p><a href="/">Back</a></p></main>`,
    });
  }
  const duration = incident.resolved_at ? fmtDuration(incident.started_at, incident.resolved_at) : "ongoing";
  const updates = (incident.updates ?? [])
    .map(
      (u) => `<li class="timeline-item">
        <div class="timeline-status">${escapeHtml(u.status)}</div>
        <div class="timeline-body">${escapeHtml(u.body)}</div>
        <div class="timeline-time">${escapeHtml(fmtDate(u.created_at))}</div>
      </li>`
    )
    .join("");

  const services = (incident.affected_service_ids ?? [])
    .map((id) => config.services.find((s) => s.id === id)?.name || id)
    .map((n) => `<span class="muted">${escapeHtml(n)}</span>`)
    .join(", ");

  const body = `
  ${header()}
  <main class="container">
    <nav class="crumbs"><a href="/">Overview</a> / <span>Incident</span></nav>
    <section class="section">
      <div class="incident-head">
        <span class="pill" style="--pill:${incidentTypeColor(incident.type)}">${escapeHtml(incident.type)}</span>
        <h1 class="banner-title">${escapeHtml(incident.title)}</h1>
      </div>
      <p class="muted">Started ${escapeHtml(fmtDate(incident.started_at))} · ${escapeHtml(incident.status)} · Duration: ${escapeHtml(duration)}</p>
      ${services ? `<p class="muted">Affected: ${services}</p>` : ""}
    </section>
    <section class="section">
      <h2 class="section-title">Timeline</h2>
      <ul class="timeline">${updates || '<li class="empty">No updates.</li>'}</ul>
    </section>
    <footer class="footer"><a href="/">Back to overview</a></footer>
  </main>`;

  return page({ title: `${incident.title}`, body });
}
