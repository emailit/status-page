/**
 * Email alerting via the Emailit API.
 * Docs: POST https://api.emailit.com/v2/emails  (Authorization: Bearer <key>)
 */
import { config } from "./config.js";

const EMAILIT_ENDPOINT = "https://api.emailit.com/v2/emails";

/**
 * Send an email through Emailit.
 * @returns {Promise<{ok:boolean, status?:number, error?:string}>}
 */
export async function sendEmail(env, { subject, html, text }) {
  const alerts = config.alerts;
  if (!alerts?.enabled) return { ok: false, error: "alerts disabled" };
  if (!env.EMAILIT_API_KEY) return { ok: false, error: "EMAILIT_API_KEY not set" };
  if (!alerts.toEmails?.length) return { ok: false, error: "no recipients configured" };

  try {
    const res = await fetch(EMAILIT_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.EMAILIT_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: alerts.fromEmail,
        to: alerts.toEmails,
        subject,
        html,
        text: text ?? stripHtml(html),
      }),
    });
    if (!res.ok) {
      const detail = await safeText(res);
      return { ok: false, status: res.status, error: detail };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

export async function sendDownAlert(env, service, evaluation) {
  const subject = `[DOWN] ${service.name}`;
  const html = alertHtml({
    heading: `${service.name} is down`,
    accent: "#e5484d",
    service,
    evaluation,
    env,
  });
  return sendEmail(env, { subject, html });
}

export async function sendDegradedAlert(env, service, evaluation) {
  const subject = `[DEGRADED] ${service.name}`;
  const html = alertHtml({
    heading: `${service.name} is degraded`,
    accent: "#f5a623",
    service,
    evaluation,
    env,
  });
  return sendEmail(env, { subject, html });
}

export async function sendRecoveryAlert(env, service, evaluation) {
  const subject = `[RESOLVED] ${service.name} recovered`;
  const html = alertHtml({
    heading: `${service.name} has recovered`,
    accent: "#30a46c",
    service,
    evaluation,
    env,
  });
  return sendEmail(env, { subject, html });
}

function alertHtml({ heading, accent, service, evaluation, env }) {
  const baseUrl = env.PUBLIC_BASE_URL || "";
  const rows = (evaluation?.regions ?? [])
    .map(
      (r) => `
      <tr>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;">${escapeHtml(r.region)}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;color:${r.ok ? "#30a46c" : "#e5484d"};">
          ${r.ok ? "OK" : "FAIL"}
        </td>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;">${r.latency_ms != null ? r.latency_ms + " ms" : "-"}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;">${escapeHtml(r.error || (r.status_code ? "HTTP " + r.status_code : "-"))}</td>
      </tr>`
    )
    .join("");

  return `<!doctype html>
  <html>
  <body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f6f7f9;margin:0;padding:24px;color:#11181c;">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e6e8eb;">
      <div style="height:6px;background:${accent};"></div>
      <div style="padding:24px;">
        <h1 style="font-size:18px;margin:0 0 8px;">${escapeHtml(heading)}</h1>
        <p style="margin:0 0 16px;color:#687076;font-size:14px;">
          Service <strong>${escapeHtml(service.name)}</strong> (<code>${escapeHtml(service.url)}</code>)
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="text-align:left;color:#687076;">
              <th style="padding:6px 12px;">Region</th>
              <th style="padding:6px 12px;">Result</th>
              <th style="padding:6px 12px;">Latency</th>
              <th style="padding:6px 12px;">Detail</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        ${
          baseUrl
            ? `<p style="margin-top:20px;"><a href="${escapeHtml(baseUrl)}" style="color:#0091ff;">View status page</a></p>`
            : ""
        }
        <p style="margin-top:20px;color:#889096;font-size:12px;">Sent by Cloudflare Status Page at ${new Date().toUTCString()}.</p>
      </div>
    </div>
  </body>
  </html>`;
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function safeText(res) {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return `HTTP ${res.status}`;
  }
}
