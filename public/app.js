// Client behavior: timezone localization, hover tooltips for uptime bars, and
// live auto-refresh of the service matrix / statuses.
(function () {
  const REFRESH_MS = 30000;
  const TZ_KEY = "sp_tz";

  /* --------------------------------------------------------- timezone */

  function browserZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch (_) {
      return "UTC";
    }
  }

  function selectedZone() {
    return localStorage.getItem(TZ_KEY) || browserZone();
  }

  function zoneList() {
    try {
      if (typeof Intl.supportedValuesOf === "function") {
        return Intl.supportedValuesOf("timeZone");
      }
    } catch (_) {}
    return ["UTC", browserZone()];
  }

  function fmtTs(epoch, zone) {
    const opts = {
      timeZone: zone,
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    };
    try {
      return new Intl.DateTimeFormat("en-US", opts).format(new Date(epoch * 1000));
    } catch (_) {
      return new Date(epoch * 1000).toUTCString();
    }
  }

  function tzAbbrev(zone) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        timeZoneName: "short",
      }).formatToParts(new Date());
      const p = parts.find((x) => x.type === "timeZoneName");
      return p ? p.value : zone;
    } catch (_) {
      return zone;
    }
  }

  function applyTimezone(zone) {
    document.querySelectorAll("[data-ts]").forEach((el) => {
      const ts = Number(el.getAttribute("data-ts"));
      if (!ts) return;
      el.textContent = fmtTs(ts, zone) + " " + tzAbbrev(zone);
    });
  }

  function initTimezone() {
    const select = document.querySelector("[data-tz-select]");
    const zone = selectedZone();
    if (select) {
      const zones = zoneList();
      if (!zones.includes(zone)) zones.unshift(zone);
      select.innerHTML = zones
        .map(
          (z) =>
            '<option value="' + z + '"' + (z === zone ? " selected" : "") + ">" + z + "</option>"
        )
        .join("");
      select.addEventListener("change", () => {
        localStorage.setItem(TZ_KEY, select.value);
        applyTimezone(select.value);
      });
    }
    applyTimezone(zone);
  }

  /* --------------------------------------------------------- tooltips */

  function initTooltips() {
    const tip = document.querySelector("[data-tooltip]");
    if (!tip) return;
    const zone = selectedZone();

    function show(e, text) {
      tip.textContent = text;
      tip.hidden = false;
      move(e);
    }
    function move(e) {
      const pad = 12;
      let x = e.clientX + pad;
      let y = e.clientY + pad;
      const rect = tip.getBoundingClientRect();
      if (x + rect.width > window.innerWidth) x = e.clientX - rect.width - pad;
      if (y + rect.height > window.innerHeight) y = e.clientY - rect.height - pad;
      tip.style.left = x + "px";
      tip.style.top = y + "px";
    }
    function hide() {
      tip.hidden = true;
    }

    document.addEventListener("mouseover", (e) => {
      const bar = e.target.closest("[data-tip], [data-tip-ts]");
      if (!bar) return;
      let text;
      if (bar.hasAttribute("data-tip")) {
        text = bar.getAttribute("data-tip");
      } else {
        const start = Number(bar.getAttribute("data-tip-ts"));
        const dur = Number(bar.getAttribute("data-tip-dur")) || 300;
        const pct = bar.getAttribute("data-tip-pct") || "";
        const z = selectedZone();
        const t1 = fmtTs(start, z);
        const t2 = new Intl.DateTimeFormat("en-US", {
          timeZone: z,
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date((start + dur) * 1000));
        text = t1 + " – " + t2 + "\nUptime: " + pct;
      }
      show(e, text);
    });
    document.addEventListener("mousemove", (e) => {
      if (!tip.hidden) move(e);
    });
    document.addEventListener("mouseout", (e) => {
      const bar = e.target.closest("[data-tip], [data-tip-ts]");
      if (bar) hide();
    });
  }

  /* ----------------------------------------------------- live refresh */

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

  function updateMatrix(snap) {
    const body = document.querySelector("[data-matrix-body]");
    if (!body) return;
    body.innerHTML = snap.services.map((svc) => {
      const cells = snap.regions.map((region) => {
        const cell = snap.matrix[svc.id] && snap.matrix[svc.id][region];
        if (!cell) return '<td class="cell cell-none" title="no data">-</td>';
        const cls = cell.ok ? "cell-ok" : "cell-bad";
        const label = cell.ok ? (cell.latency_ms != null ? cell.latency_ms + " ms" : "ok") : "\u00d7";
        const detail = cell.ok
          ? (cell.latency_ms != null ? cell.latency_ms + " ms" : "ok")
          : (cell.error || ("HTTP " + (cell.status_code || "?")));
        return '<td class="cell ' + cls + '" title="' + esc(detail) + '">' + esc(label) + "</td>";
      }).join("");
      return '<tr><th class="row-head">' + esc(svc.name) + "</th>" + cells + "</tr>";
    }).join("");

    const lu = document.querySelector("[data-ts]");
    // last-updated span is re-localized by applyTimezone via its data-ts.
    if (snap.lastUpdated) {
      const luSpan = document.querySelector(".last-updated [data-ts]");
      if (luSpan) {
        luSpan.setAttribute("data-ts", snap.lastUpdated);
        luSpan.textContent = fmtTs(snap.lastUpdated, selectedZone()) + " " + tzAbbrev(selectedZone());
      }
    }
  }

  function updateServices(snap) {
    document.querySelectorAll(".service-row").forEach((row) => {
      const href = row.getAttribute("href") || "";
      const id = href.split("/service/")[1];
      if (!id) return;
      const st = (snap.states[id] && snap.states[id].current_status) || "unknown";
      row.setAttribute("data-status", st);
      const badge = row.querySelector(".status-badge");
      const text = row.querySelector(".status-text");
      if (badge) {
        badge.className =
          "status-badge status-badge-" + st;
      }
      if (text) text.textContent = statusText(st);
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

  /* -------------------------------------------------------------- init */

  initTimezone();
  initTooltips();
  document.querySelectorAll("[data-bars-recent]").forEach((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  if (document.querySelector("[data-status-root]") && document.querySelector("[data-matrix-body]")) {
    setInterval(refresh, REFRESH_MS);
  }
})();
