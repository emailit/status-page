/**
 * RegionProbe Durable Object.
 *
 * One instance per configured region. Created with a `locationHint` so the
 * instance (and therefore the outbound probe requests) run from a data center
 * near that region. The coordinator calls `probeAll()` via RPC each cycle.
 */
import { DurableObject } from "cloudflare:workers";
import { allowedStatusCodes } from "./config.js";

export class RegionProbe extends DurableObject {
  /**
   * Probe a list of services and return per-service results.
   * @param {object} args
   * @param {string} args.region   region label this instance represents
   * @param {Array}  args.services service configs
   * @returns {Promise<Array>} results
   */
  async probeAll({ region, services }) {
    const checkedAt = Math.floor(Date.now() / 1000);
    const results = await Promise.all(
      services.map((svc) => this.#probeOne(svc, region, checkedAt))
    );
    return results;
  }

  async #probeOne(service, region, checkedAt) {
    const allowed = allowedStatusCodes(service);
    const timeoutMs = service.timeoutMs ?? 5000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();

    const base = {
      service_id: service.id,
      region,
      checked_at: checkedAt,
      status_code: null,
      latency_ms: null,
      error: null,
    };

    try {
      const res = await fetch(service.url, {
        method: service.method ?? "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "CloudflareStatusPage/1.0 (+probe)" },
        cf: { cacheTtl: 0, cacheEverything: false },
      });
      const latency = Date.now() - started;
      const ok = allowed.includes(res.status);
      return {
        ...base,
        ok,
        status_code: res.status,
        latency_ms: latency,
        error: ok ? null : `unexpected status ${res.status}`,
      };
    } catch (err) {
      const latency = Date.now() - started;
      const aborted = err?.name === "AbortError";
      return {
        ...base,
        ok: false,
        latency_ms: latency,
        error: aborted ? `timeout after ${timeoutMs}ms` : String(err?.message || err),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
