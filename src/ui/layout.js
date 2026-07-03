/** Shared HTML helpers and page chrome (x.ai-inspired, minimal/neutral). */

export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function statusLabel(status) {
  switch (status) {
    case "available":
      return "Operational";
    case "degraded":
      return "Degraded";
    case "down":
      return "Outage";
    default:
      return "Unknown";
  }
}

export function statusColorVar(status) {
  switch (status) {
    case "available":
      return "var(--ok)";
    case "degraded":
      return "var(--warn)";
    case "down":
      return "var(--bad)";
    default:
      return "var(--muted)";
  }
}

export function incidentTypeColor(type) {
  switch (type) {
    case "outage":
      return "var(--bad)";
    case "disruption":
      return "var(--warn)";
    case "info":
      return "var(--info)";
    default:
      return "var(--muted)";
  }
}

export function fmtDate(epochSec) {
  if (!epochSec) return "N/A";
  return new Date(epochSec * 1000).toLocaleString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }) + " UTC";
}

/**
 * Timestamp span that the client reformats into the selected timezone.
 * The server renders a UTC fallback for no-JS / initial paint.
 */
export function tsSpan(epochSec) {
  if (!epochSec) return `<span>N/A</span>`;
  return `<span data-ts="${epochSec}">${escapeHtml(fmtDate(epochSec))}</span>`;
}

export function fmtDuration(startSec, endSec) {
  if (!startSec || !endSec) return "-";
  let s = Math.max(0, endSec - startSec);
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m} minute${m === 1 ? "" : "s"}`;
}

export function page({ title, body, head = "" }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="stylesheet" href="/styles.css" />
  ${head}
</head>
<body>
  ${body}
</body>
</html>`;
}
