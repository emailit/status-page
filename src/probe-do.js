/**
 * RegionProbe Durable Object.
 *
 * One instance per configured region. Created with a `locationHint` so the
 * instance (and therefore the outbound probe requests) run from a data center
 * near that region. The coordinator calls `probeAll()` via RPC each cycle.
 */
import { DurableObject } from "cloudflare:workers";
import { connect } from "cloudflare:sockets";
import { config, allowedStatusCodes } from "./config.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
      services.map((svc) => this.#probeWithRetries(svc, region, checkedAt))
    );
    return results;
  }

  /**
   * Probe a service, retrying on failure to filter out transient blips.
   * Returns as soon as an attempt succeeds; otherwise returns the last failure
   * (annotated with the number of attempts made).
   */
  async #probeWithRetries(service, region, checkedAt) {
    const maxRetries = Math.max(0, config.retries ?? 0);
    const retryDelayMs = config.retryDelayMs ?? 500;

    let result;
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      result = await this.#probeOne(service, region, checkedAt);
      result.attempts = attempt;
      if (result.ok) return result;
      if (attempt <= maxRetries) await sleep(retryDelayMs);
    }
    return result;
  }

  async #probeOne(service, region, checkedAt) {
    if (service.type === "tcp") {
      return this.#probeTcp(service, region, checkedAt);
    }
    return this.#probeHttp(service, region, checkedAt);
  }

  /** TCP connectivity check via the Workers socket API (used for SMTP, etc.). */
  async #probeTcp(service, region, checkedAt) {
    const timeoutMs = service.timeoutMs ?? 5000;
    const started = Date.now();
    const base = {
      service_id: service.id,
      region,
      checked_at: checkedAt,
      status_code: null,
      latency_ms: null,
      error: null,
    };

    let socket;
    try {
      socket = connect(
        { hostname: service.host, port: service.port },
        service.tls ? { secureTransport: "on" } : undefined
      );
      // `opened` resolves once the TCP (and TLS, if enabled) handshake completes.
      const opened = socket.opened;
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs)
      );
      await Promise.race([opened, timeout]);
      const latency = Date.now() - started;
      return { ...base, ok: true, latency_ms: latency };
    } catch (err) {
      const latency = Date.now() - started;
      return { ...base, ok: false, latency_ms: latency, error: String(err?.message || err) };
    } finally {
      try {
        await socket?.close();
      } catch {
        /* ignore */
      }
    }
  }

  async #probeHttp(service, region, checkedAt) {
    const allowed = allowedStatusCodes(service);
    const timeoutMs = service.timeoutMs ?? 5000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const base = {
      service_id: service.id,
      region,
      checked_at: checkedAt,
      status_code: null,
      latency_ms: null,
      error: null,
    };

    const doFetch = () =>
      fetch(service.url, {
        method: service.method ?? "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "CloudflareStatusPage/1.0 (+probe)" },
        cf: { cacheTtl: 0, cacheEverything: false },
      });

    // Warm-up: a throwaway request pays the DNS + TCP + TLS handshake cost so the
    // timed request below reuses the warm connection. The reported latency then
    // reflects steady-state request/response time rather than cold-connection
    // setup. Warm-up failures are ignored; the timed request re-checks and will
    // surface any genuine error accurately.
    const warmup = service.warmup ?? config.warmup ?? true;
    if (warmup) {
      try {
        const pre = await doFetch();
        await pre.body?.cancel?.();
      } catch {
        /* ignore warm-up errors */
      }
    }

    try {
      const started = Date.now();
      const res = await doFetch();
      const latency = Date.now() - started;
      await res.body?.cancel?.();
      const ok = allowed.includes(res.status);
      return {
        ...base,
        ok,
        status_code: res.status,
        latency_ms: latency,
        error: ok ? null : `unexpected status ${res.status}`,
      };
    } catch (err) {
      const aborted = err?.name === "AbortError";
      return {
        ...base,
        ok: false,
        latency_ms: null,
        error: aborted ? `timeout after ${timeoutMs}ms` : String(err?.message || err),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
