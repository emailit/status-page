/**
 * Status page configuration.
 *
 * Edit this file to describe the services you want to monitor, the regions you
 * want to probe from, and where alerts should be delivered. Commit your changes
 * and deploy (or click "Deploy to Cloudflare").
 *
 * Secrets are NOT stored here. Set them after deploy:
 *   wrangler secret put EMAILIT_API_KEY
 *   wrangler secret put ADMIN_PASSWORD
 */

/**
 * Supported region location hints (Cloudflare Durable Objects).
 * Each region runs a probe instance placed near that geography.
 *   wnam  - Western North America
 *   enam  - Eastern North America
 *   sam   - South America
 *   weur  - Western Europe
 *   eeur  - Eastern Europe
 *   apac  - Asia-Pacific
 *   apac-ne - Northeast Asia-Pacific
 *   apac-se - Southeast Asia-Pacific
 *   oc    - Oceania
 *   afr   - Africa
 *   me    - Middle East
 */
export const REGION_LABELS = {
  wnam: "US West",
  enam: "US East",
  sam: "South America",
  weur: "EU West",
  eeur: "EU East",
  apac: "Asia-Pacific",
  "apac-ne": "Asia-Pacific NE",
  "apac-se": "Asia-Pacific SE",
  oc: "Oceania",
  afr: "Africa",
  me: "Middle East",
};

export const config = {
  // Shown in the header and <title>.
  pageTitle: "Emailit Status",
  pageDescription: "Current status of Emailit services.",

  // Regions to probe from. Use the location hints above.
  regions: ["enam", "weur", "apac"],

  // How often, in minutes, services are actually probed. The Worker cron fires
  // every minute, but a cycle only probes if this much time has elapsed since
  // the last recorded check. Change this value (not the cron) to adjust cadence.
  probeIntervalMin: 5,

  // When a probe fails, retry this many additional times immediately (with
  // retryDelayMs between attempts) before recording a failure. Guards against
  // one-off network blips being counted as downtime.
  retries: 3,
  retryDelayMs: 500,

  // How long to retain raw check rows (days). Older rows are pruned.
  retentionDays: 45,

  // Services to monitor. Each service is probed from every region above.
  //
  // HTTP service (default):
  //   id            unique slug (used in URLs and the DB)
  //   name          display name
  //   url           URL to probe
  //   method        HTTP method (default GET)
  //   expectStatus  expected HTTP status (default 200); or array of allowed codes
  //   timeoutMs     per-probe timeout (default 5000)
  //   degradedMs    latency above this (ms) marks the service "degraded" (optional)
  //
  // TCP service (for SMTP and other raw TCP endpoints):
  //   type: "tcp"   enables a TCP connectivity check via the Workers socket API
  //   host          hostname to connect to
  //   port          TCP port
  //   tls           set true to require a successful TLS handshake (implicit TLS, e.g. 465)
  services: [
    {
      id: "api-v2",
      name: "API v2",
      url: "https://api.emailit.com/v2",
      method: "GET",
      // Unauthenticated hits to the API base may return 401/404/405; any of these
      // still proves the API is up and serving.
      expectStatus: [200, 301, 302, 307, 308, 400, 401, 403, 404, 405],
      timeoutMs: 5000,
      degradedMs: 1500,
    },
    {
      id: "app",
      name: "App",
      url: "https://api.emailit.com/",
      method: "GET",
      expectStatus: [200, 301, 302, 307, 308, 401, 403, 404],
      timeoutMs: 5000,
      degradedMs: 1500,
    },
    {
      id: "website",
      name: "Website",
      url: "https://emailit.com",
      method: "GET",
      expectStatus: [200, 301, 302, 307, 308],
      timeoutMs: 5000,
    },
    {
      id: "docs",
      name: "Docs",
      url: "https://emailit.com/docs",
      method: "GET",
      expectStatus: [200, 301, 302, 307, 308],
      timeoutMs: 5000,
    },
    {
      id: "api-reference",
      name: "API Reference",
      url: "https://emailit.com/docs/api-reference/endpoints/",
      method: "GET",
      expectStatus: [200, 301, 302, 307, 308],
      timeoutMs: 5000,
    },
    {
      id: "smtp-587",
      name: "SMTP (submission 587)",
      type: "tcp",
      host: "smtp.emailit.com",
      port: 587,
      timeoutMs: 5000,
      degradedMs: 1500,
    },
    {
      id: "smtp-465",
      name: "SMTP (TLS 465)",
      type: "tcp",
      host: "smtp.emailit.com",
      port: 465,
      tls: true,
      timeoutMs: 5000,
      degradedMs: 1500,
    },
    {
      id: "smtp-2525",
      name: "SMTP (submission 2525)",
      type: "tcp",
      host: "smtp.emailit.com",
      port: 2525,
      timeoutMs: 5000,
      degradedMs: 1500,
    },
  ],

  alerts: {
    // Enable/disable email alerting. Requires EMAILIT_API_KEY secret.
    enabled: true,
    // RFC sender. Domain must be verified in Emailit.
    fromEmail: "Emailit Status <status@emailit.com>",
    // Recipients notified on outage/recovery.
    toEmails: ["oncall@emailit.com"],
    // Minimum minutes between repeated "still down" reminders (0 = only alert on transitions).
    reminderIntervalMin: 0,
  },

  // Optional footer. Only rendered when `columns` is non-empty. Mirrors the
  // multi-column footer on status.x.ai.
  //   columns: [{ title, links: [{ label, href }] }]
  footer: {
    columns: [
      {
        title: "Emailit",
        links: [
          { label: "Home", href: "https://emailit.com" },
          { label: "App", href: "https://api.emailit.com/" },
        ],
      },
      {
        title: "Developers",
        links: [
          { label: "Documentation", href: "https://emailit.com/docs" },
          { label: "API Reference", href: "https://emailit.com/docs/api-reference/endpoints/" },
        ],
      },
      {
        title: "Sending",
        links: [
          { label: "API v2", href: "https://api.emailit.com/v2" },
          { label: "SMTP (smtp.emailit.com)", href: "https://emailit.com/docs" },
        ],
      },
    ],
  },
};

/** Look up a service config by id. */
export function getService(id) {
  return config.services.find((s) => s.id === id);
}

/** Normalize expectStatus into an array of allowed codes. */
export function allowedStatusCodes(service) {
  const e = service.expectStatus ?? 200;
  return Array.isArray(e) ? e : [e];
}
