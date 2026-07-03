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
  pageTitle: "Acme Status",
  pageDescription: "Current status of Acme services.",

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
  //   id            unique slug (used in URLs and the DB)
  //   name          display name
  //   url           URL to probe
  //   method        HTTP method (default GET)
  //   expectStatus  expected HTTP status (default 200); or array of allowed codes
  //   timeoutMs     per-probe timeout (default 5000)
  //   degradedMs    latency above this (ms) marks the service "degraded" (optional)
  services: [
    {
      id: "api-us-east",
      name: "API (us-east-1)",
      url: "https://example.com/health",
      method: "GET",
      expectStatus: 200,
      timeoutMs: 5000,
      degradedMs: 1500,
    },
    {
      id: "api-eu-west",
      name: "API (eu-west-1)",
      url: "https://example.com/health",
      method: "GET",
      expectStatus: 200,
      timeoutMs: 5000,
      degradedMs: 1500,
    },
    {
      id: "web-app",
      name: "Web App",
      url: "https://example.com",
      method: "GET",
      expectStatus: [200, 301, 302],
      timeoutMs: 5000,
    },
    {
      id: "docs",
      name: "Docs",
      url: "https://example.com/docs",
      method: "GET",
      expectStatus: 200,
      timeoutMs: 5000,
    },
  ],

  alerts: {
    // Enable/disable email alerting. Requires EMAILIT_API_KEY secret.
    enabled: true,
    // RFC sender, e.g. "Acme Status <status@acme.com>". Domain must be verified in Emailit.
    fromEmail: "Acme Status <status@example.com>",
    // Recipients notified on outage/recovery.
    toEmails: ["oncall@example.com"],
    // Minimum minutes between repeated "still down" reminders (0 = only alert on transitions).
    reminderIntervalMin: 0,
  },

  // Optional footer. Only rendered when `columns` is non-empty. Mirrors the
  // multi-column footer on status.x.ai.
  //   columns: [{ title, links: [{ label, href }] }]
  footer: {
    columns: [
      // {
      //   title: "Company",
      //   links: [
      //     { label: "Home", href: "https://example.com" },
      //     { label: "Docs", href: "https://example.com/docs" },
      //   ],
      // },
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
