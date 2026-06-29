/** Admin UI: login screen and incident management dashboard. */
import { config } from "../config.js";
import { page, escapeHtml, incidentTypeColor, fmtDate } from "./layout.js";

export function renderLogin(error = "") {
  const body = `
  <main class="container admin">
    <h1 class="banner-title">Admin sign in</h1>
    <p class="muted">${escapeHtml(config.pageTitle)} status administration</p>
    ${error ? `<p class="form-error">${escapeHtml(error)}</p>` : ""}
    <form method="POST" action="/admin/login" class="card form">
      <label class="field">
        <span>Password</span>
        <input type="password" name="password" autocomplete="current-password" required />
      </label>
      <button class="btn btn-primary" type="submit">Sign in</button>
    </form>
    <p class="muted"><a href="/">Back to status page</a></p>
  </main>`;
  return page({ title: "Admin sign in", body });
}

export function renderAdmin(incidents) {
  const serviceOptions = config.services
    .map((s) => `<label class="check"><input type="checkbox" name="services" value="${escapeHtml(s.id)}" /> ${escapeHtml(s.name)}</label>`)
    .join("");

  const incidentList = incidents.length
    ? incidents
        .map((i) => renderAdminIncident(i))
        .join("")
    : `<p class="empty">No incidents yet.</p>`;

  const body = `
  <main class="container admin">
    <div class="admin-top">
      <h1 class="banner-title">Incidents</h1>
      <div class="admin-actions">
        <a class="btn" href="/" target="_blank">View status page</a>
        <form method="POST" action="/admin/logout" style="display:inline"><button class="btn">Sign out</button></form>
      </div>
    </div>

    <section class="section card">
      <h2 class="section-title">Create incident</h2>
      <form method="POST" action="/api/admin/incidents" class="form">
        <label class="field"><span>Title</span><input name="title" required /></label>
        <label class="field"><span>Message</span><textarea name="body" rows="3" placeholder="What's happening?"></textarea></label>
        <div class="form-row">
          <label class="field"><span>Type</span>
            <select name="type">
              <option value="info">info</option>
              <option value="disruption" selected>disruption</option>
              <option value="outage">outage</option>
            </select>
          </label>
          <label class="field"><span>Status</span>
            <select name="status">
              <option value="investigating" selected>investigating</option>
              <option value="identified">identified</option>
              <option value="monitoring">monitoring</option>
              <option value="resolved">resolved</option>
            </select>
          </label>
        </div>
        <div class="field"><span>Affected services</span><div class="checks">${serviceOptions}</div></div>
        <button class="btn btn-primary" type="submit">Create incident</button>
      </form>
    </section>

    <section class="section">
      <h2 class="section-title">All incidents</h2>
      <div class="admin-incidents">${incidentList}</div>
    </section>
  </main>`;

  return page({ title: "Admin · Incidents", body });
}

function renderAdminIncident(i) {
  const updates = (i.updates ?? [])
    .map(
      (u) => `<li><strong>${escapeHtml(u.status)}</strong> — ${escapeHtml(u.body)} <span class="muted">${escapeHtml(fmtDate(u.created_at))}</span></li>`
    )
    .join("");

  const statusOptions = ["investigating", "identified", "monitoring", "resolved"]
    .map((s) => `<option value="${s}" ${s === i.status ? "selected" : ""}>${s}</option>`)
    .join("");

  return `<div class="card admin-incident">
    <div class="incident-head">
      <span class="pill" style="--pill:${incidentTypeColor(i.type)}">${escapeHtml(i.type)}</span>
      <span class="incident-title">${escapeHtml(i.title)}</span>
      ${i.auto ? '<span class="badge">auto</span>' : ""}
    </div>
    <div class="muted">${escapeHtml(i.status)} · started ${escapeHtml(fmtDate(i.started_at))}${i.resolved_at ? " · resolved " + escapeHtml(fmtDate(i.resolved_at)) : ""}</div>
    <ul class="admin-updates">${updates}</ul>

    <form method="POST" action="/api/admin/incidents/${escapeHtml(i.id)}/updates" class="form inline-form">
      <input name="body" placeholder="Post an update…" required />
      <select name="status">${statusOptions}</select>
      <button class="btn btn-primary" type="submit">Update</button>
    </form>

    <div class="admin-incident-actions">
      ${
        i.status !== "resolved"
          ? `<form method="POST" action="/api/admin/incidents/${escapeHtml(i.id)}/resolve"><button class="btn">Mark resolved</button></form>`
          : ""
      }
      <form method="POST" action="/api/admin/incidents/${escapeHtml(i.id)}/delete" onsubmit="return confirm('Delete this incident?')"><button class="btn btn-danger">Delete</button></form>
    </div>
  </div>`;
}
