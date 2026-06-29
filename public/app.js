// Auto-refresh the live service matrix and service statuses without a full reload.
(function () {
  const REFRESH_MS = 30000;
  const root = document.querySelector("[data-status-root]");
  if (!root) return;

  const REGION_LABELS = {
    wnam: "US West", enam: "US East", sam: "South America", weur: "EU West",
    eeur: "EU East", apac: "Asia-Pacific", "apac-ne": "Asia-Pacific NE",
    "apac-se": "Asia-Pacific SE", oc: "Oceania", afr: "Africa", me: "Middle East",
  };

  function statusColor(status) {
    return status === "available" ? "var(--ok)"
      : status === "degraded" ? "var(--warn)"
      : status === "down" ? "var(--bad)" : "var(--muted)";
  }
  function statusText(status) {
    return status === "available" ? "Operational"
      : status === "degraded" ? "Degraded"
      : status === "down" ? "Outage" : "Unknown";
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
  function fmtDate(epoch) {
    if (!epoch) return "N/A";
    return new Date(epoch * 1000).toLocaleString("en-US", {
      timeZone: "UTC", month: "short", day: "numeric", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    }) + " UTC";
  }

  function updateMatrix(snap) {
    const body = document.querySelector("[data-matrix-body]");
    if (!body) return;
    body.innerHTML = snap.services.map((svc) => {
      const cells = snap.regions.map((region) => {
        const cell = snap.matrix[svc.id] && snap.matrix[svc.id][region];
        if (!cell) return '<td class="cell cell-none" title="no data">-</td>';
        const cls = cell.ok ? "cell-ok" : "cell-bad";
        const label = cell.ok ? (cell.latency_ms != null ? String(cell.latency_ms) : "ok") : "\u00d7";
        const detail = cell.ok
          ? (cell.latency_ms != null ? cell.latency_ms + " ms" : "ok")
          : (cell.error || ("HTTP " + (cell.status_code || "?")));
        return '<td class="cell ' + cls + '" title="' + esc(detail) + '">' + esc(label) + "</td>";
      }).join("");
      return '<tr><th class="row-head">' + esc(svc.name) + "</th>" + cells + "</tr>";
    }).join("");

    const lu = document.querySelector("[data-last-updated]");
    if (lu) lu.textContent = snap.lastUpdated ? fmtDate(snap.lastUpdated) : "N/A";
  }

  function updateServices(snap) {
    document.querySelectorAll(".service-row").forEach((row) => {
      const href = row.getAttribute("href") || "";
      const id = href.split("/service/")[1];
      if (!id) return;
      const st = (snap.states[id] && snap.states[id].current_status) || "unknown";
      const text = row.querySelector(".status-text");
      const dot = row.querySelector(".status-dot");
      if (text) { text.textContent = statusText(st); text.style.color = statusColor(st); }
      if (dot) dot.style.background = statusColor(st);
    });
  }

  async function refresh() {
    try {
      const res = await fetch("/api/status.json", { headers: { accept: "application/json" } });
      if (!res.ok) return;
      const snap = await res.json();
      updateMatrix(snap);
      updateServices(snap);
    } catch (_) { /* ignore transient errors */ }
  }

  setInterval(refresh, REFRESH_MS);
})();
