# Cloudflare Status Page

A self-hostable, multi-region status page that runs entirely on Cloudflare Workers. Configure your services in one file, click deploy, and get an [x.ai](https://status.x.ai/)-style status page with:

- **Multi-region uptime probing** from Durable Objects placed near each region (`enam`, `weur`, `apac`, ...).
- **Live service-data matrix** (service x source region) plus per-service uptime, latency, and incident history.
- **Incident management** (info / disruption / outage) via a password-protected admin UI, with auto-generated incidents when probes detect downtime.
- **Email alerting** through the [Emailit](https://emailit.com/) API on outage, degradation, and recovery.

Built with plain JavaScript (ES modules), [Hono](https://hono.dev/), D1, and Durable Objects. No build step, no TypeScript.

## Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/funfirst/getstatuspage)

Deploying provisions the D1 database and Durable Object automatically and runs migrations as part of the `deploy` script.

### After deploying, set your secrets

```bash
wrangler secret put ADMIN_PASSWORD     # password for the /admin dashboard
wrangler secret put EMAILIT_API_KEY    # only needed if email alerts are enabled
```

Optionally set the public URL (used in alert emails):

```bash
wrangler secret put PUBLIC_BASE_URL    # e.g. https://status.yourdomain.com
```

## Configure your services

Everything is configured in [`src/config.js`](src/config.js). Edit the `services`, `regions`, and `alerts` fields, then redeploy.

```js
export const config = {
  pageTitle: "Acme Status",
  regions: ["enam", "weur", "apac"], // Durable Object location hints
  probeIntervalSec: 60,
  services: [
    {
      id: "api-us-east",
      name: "API (us-east-1)",
      url: "https://us-east-1.api.example.com/health",
      method: "GET",
      expectStatus: 200,     // or an array, e.g. [200, 301, 302]
      timeoutMs: 5000,
      degradedMs: 1500,      // optional: slower than this => "degraded"
      group: "API",
    },
  ],
  alerts: {
    enabled: true,
    fromEmail: "Acme Status <status@example.com>", // verified Emailit domain
    toEmails: ["oncall@example.com"],
    failureThreshold: 2,     // consecutive failed cycles before "down" + alert
    regionFailFraction: 0.5, // down only if >= this fraction of regions fail
  },
};
```

### Supported regions (location hints)

`wnam` (US West), `enam` (US East), `sam` (South America), `weur` (EU West), `eeur` (EU East), `apac` (Asia-Pacific), `apac-ne`, `apac-se`, `oc` (Oceania), `afr` (Africa), `me` (Middle East).

## How it works

```
Cron (every minute) -> scheduled() coordinator
  -> fan out to one RegionProbe Durable Object per region (locationHint)
     -> each DO fetches every service URL from its region
     -> results written to D1 (checks)
  -> evaluate per-service health, open/close auto-incidents, send Emailit alerts
Visitors -> Worker fetch() -> render status page / per-service detail from D1
Operators -> /admin (password) -> create & manage incidents in D1
```

Cloudflare Cron Triggers cannot be pinned to a region, so per-region execution is achieved with Durable Object `locationHint` (best-effort placement near the hinted region).

## Local development

```bash
npm install
npm run db:migrations:apply:local      # set up the local D1 database
echo "ADMIN_PASSWORD=devpass" > .dev.vars
npm run dev                            # http://localhost:8787
```

Trigger a probe cycle manually (requires admin login) by POSTing to `/api/admin/probe`.

## Routes

| Route | Description |
| --- | --- |
| `GET /` | Status page: banner, live region matrix, services, incidents |
| `GET /service/:id` | Per-service detail: 30-day uptime, issue counts, history |
| `GET /incident/:id` | Incident detail + timeline |
| `GET /api/status.json` | JSON snapshot (auto-refreshes the home page every 30s) |
| `GET /admin` | Admin dashboard (password protected) |
| `POST /api/admin/incidents` | Create incident |
| `POST /api/admin/incidents/:id/updates` | Post a timeline update |
| `POST /api/admin/incidents/:id/resolve` | Resolve an incident |
| `PATCH /api/admin/incidents/:id` | Edit incident fields (JSON) |
| `POST /api/admin/incidents/:id/delete` | Delete an incident |

## Incident types

- **info** — informational notice (maintenance, announcements).
- **disruption** — partial/degraded service.
- **outage** — service unavailable.

Auto-incidents are created as `disruption` when a service becomes degraded and `outage` when it goes down, and are resolved automatically on recovery. Manual incidents are fully managed from `/admin`.

## License

MIT
