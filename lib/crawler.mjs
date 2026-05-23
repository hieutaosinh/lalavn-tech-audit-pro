/**
 * Recursive BFS crawler with concurrency, robots.txt respect, timeout.
 * Pure ESM, depends on cheerio + fast-xml-parser only.
 *
 * v0.4 additions:
 *   - Redirect chain tracking (HEAD-then-GET với redirect: "manual")
 *   - Response headers captured (lowercase) for security/compression analysis
 *   - Sitemap URLs returned as flat list (cho cross-validation)
 *   - Sitemap fetch errors surfaced (không silent swallow nữa)
 */

import * as cheerio from "cheerio";
import { XMLParser } from "fast-xml-parser";
import { performance } from "node:perf_hooks";

const MAX_REDIRECT_HOPS = 10;

export class Crawler {
  constructor(config = {}) {
    this.config = {
      maxUrls: 200,
      maxDepth: 3,
      concurrency: 5,
      respectRobotsTxt: true,
      requestTimeoutMs: 15000,
      delayBetweenRequestsMs: 100,
      userAgent: "LalavnDeepAudit/0.4",
      ...config,
    };
    this.robotsRules = null;
    this.fetchedCount = 0;
    this.sitemapErrors = [];
  }

  async fetchWithTimeout(url, opts = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.config.requestTimeoutMs);
    try {
      return await fetch(url, {
        redirect: "follow",
        signal: ctrl.signal,
        ...opts,
        headers: {
          "user-agent": this.config.userAgent,
          accept: "text/html,application/xhtml+xml,application/xml,*/*",
          ...(opts.headers || {}),
        },
      });
    } finally {
      clearTimeout(t);
    }
  }

  /**
   * Fetch with manual redirect following so we can capture the chain.
   * Returns: { finalRes, finalUrl, chain: [{from, to, status}], hops }
   */
  async fetchWithRedirectChain(url) {
    const chain = [];
    let current = url;
    let hops = 0;
    let lastRes = null;

    while (hops < MAX_REDIRECT_HOPS) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), this.config.requestTimeoutMs);
      let res;
      try {
        res = await fetch(current, {
          redirect: "manual",
          signal: ctrl.signal,
          headers: {
            "user-agent": this.config.userAgent,
            accept: "text/html,application/xhtml+xml,application/xml,*/*",
          },
        });
      } finally {
        clearTimeout(t);
      }
      lastRes = res;

      // 3xx with Location → follow
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        let nextUrl;
        try {
          nextUrl = new URL(res.headers.get("location"), current).toString();
        } catch {
          break;
        }
        chain.push({ from: current, to: nextUrl, status: res.status });
        // Đọc body nhỏ để release connection (Node fetch yêu cầu)
        try { await res.text(); } catch {}
        current = nextUrl;
        hops++;
        continue;
      }
      break;
    }

    return { finalRes: lastRes, finalUrl: current, chain, hops };
  }

  // ─── robots.txt ───────────────────────────────────────────────
  async loadRobots(origin) {
    const result = { exists: false, sitemaps: [], disallow: [], allow: [], crawlDelay: null };
    try {
      const res = await this.fetchWithTimeout(origin + "/robots.txt");
      if (!res.ok) return result;
      const text = await res.text();
      result.exists = true;
      result.raw = text;

      let activeUA = null;
      for (const lineRaw of text.split(/\r?\n/)) {
        const line = lineRaw.trim();
        if (!line || line.startsWith("#")) continue;
        const m = line.match(/^([a-zA-Z-]+):\s*(.*)$/);
        if (!m) continue;
        const key = m[1].toLowerCase();
        const val = m[2].trim();
        if (key === "user-agent") {
          activeUA = val.toLowerCase();
        } else if (key === "sitemap") {
          result.sitemaps.push(val);
        } else if (activeUA === "*" || activeUA === this.config.userAgent.toLowerCase().split("/")[0]) {
          if (key === "disallow" && val) result.disallow.push(val);
          if (key === "allow" && val) result.allow.push(val);
          if (key === "crawl-delay") result.crawlDelay = parseFloat(val);
        }
      }
    } catch (e) {
      result.error = e.message;
    }
    this.robotsRules = result;
    return result;
  }

  isAllowedByRobots(url) {
    if (!this.config.respectRobotsTxt || !this.robotsRules || !this.robotsRules.exists) return true;
    let path;
    try { path = new URL(url).pathname + new URL(url).search; } catch { return true; }

    // Allow rules win over Disallow if more specific (longest match wins)
    let bestAllow = null, bestDisallow = null;
    for (const rule of this.robotsRules.allow) {
      if (this.matchRobotsRule(path, rule)) {
        if (!bestAllow || rule.length > bestAllow.length) bestAllow = rule;
      }
    }
    for (const rule of this.robotsRules.disallow) {
      if (this.matchRobotsRule(path, rule)) {
        if (!bestDisallow || rule.length > bestDisallow.length) bestDisallow = rule;
      }
    }
    if (bestAllow && bestDisallow) return bestAllow.length >= bestDisallow.length;
    if (bestDisallow) return false;
    return true;
  }

  matchRobotsRule(path, rule) {
    if (!rule) return false;
    // Convert robots pattern to regex (basic: * = any, $ = end)
    const pattern = "^" + rule
      .replace(/[.+?()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\\\$$/, "$");
    try {
      return new RegExp(pattern).test(path);
    } catch {
      return path.startsWith(rule);
    }
  }

  // ─── sitemap ──────────────────────────────────────────────────
  async fetchSitemapUrls(sitemapUrl, depth = 0, acc = []) {
    if (depth > 2) return acc;
    try {
      const res = await this.fetchWithTimeout(sitemapUrl);
      if (!res.ok) {
        this.sitemapErrors.push({ url: sitemapUrl, status: res.status, error: `HTTP ${res.status}` });
        return acc;
      }
      const xml = await res.text();
      const parser = new XMLParser({ ignoreAttributes: false });
      const doc = parser.parse(xml);
      if (doc.sitemapindex?.sitemap) {
        const list = Array.isArray(doc.sitemapindex.sitemap) ? doc.sitemapindex.sitemap : [doc.sitemapindex.sitemap];
        for (const s of list) {
          if (s?.loc) await this.fetchSitemapUrls(s.loc, depth + 1, acc);
        }
      } else if (doc.urlset?.url) {
        const list = Array.isArray(doc.urlset.url) ? doc.urlset.url : [doc.urlset.url];
        for (const u of list) if (u?.loc) acc.push(u.loc);
      }
    } catch (e) {
      this.sitemapErrors.push({ url: sitemapUrl, status: 0, error: e.message });
    }
    return acc;
  }

  // ─── seed URL collection ──────────────────────────────────────
  async collectSeedUrls(startUrl) {
    const startObj = new URL(startUrl);
    const origin = startObj.origin;
    const robots = await this.loadRobots(origin);

    const candidates = new Set([startUrl]);
    let sitemapsUsed = [];
    const allSitemapUrls = new Set();

    // From robots
    const sitemapCandidates = [...new Set([
      ...robots.sitemaps,
      origin + "/sitemap.xml",
      origin + "/sitemap_index.xml",
    ])];

    for (const sm of sitemapCandidates) {
      const found = await this.fetchSitemapUrls(sm);
      if (found.length > 0) {
        sitemapsUsed.push({ url: sm, count: found.length });
        for (const u of found) {
          allSitemapUrls.add(u.split("#")[0]);
          if (this.isSameOrigin(u, startUrl)) candidates.add(u.split("#")[0]);
        }
      }
    }

    return {
      seeds: [...candidates],
      sitemapsUsed,
      sitemapUrls: [...allSitemapUrls],
      sitemapFound: sitemapsUsed.length > 0,
      sitemapErrors: this.sitemapErrors.slice(),
      robots,
    };
  }

  isSameOrigin(a, b) {
    try { return new URL(a).origin === new URL(b).origin; }
    catch { return false; }
  }

  extractInternalLinks(html, baseUrl) {
    const $ = cheerio.load(html);
    const out = new Set();
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) return;
      try {
        const abs = new URL(href, baseUrl).toString().split("#")[0];
        if (this.isSameOrigin(abs, baseUrl)) out.add(abs);
      } catch {}
    });
    return [...out];
  }

  // ─── BFS crawl ────────────────────────────────────────────────
  async crawl(startUrl, fetchHandler, onProgress) {
    const { seeds, sitemapsUsed, sitemapUrls, sitemapFound, sitemapErrors, robots } = await this.collectSeedUrls(startUrl);

    const queue = seeds.map((u) => ({ url: u, depth: 0 }));
    const visited = new Map(); // url → result
    const skipped = []; // { url, reason }
    const allInternalLinks = new Map(); // sourceUrl → [target1, target2]

    const processOne = async ({ url, depth }) => {
      if (visited.has(url) || visited.size >= this.config.maxUrls) return;
      if (!this.isAllowedByRobots(url)) {
        skipped.push({ url, reason: "robots_disallow" });
        return;
      }
      visited.set(url, { pending: true, depth });
      this.fetchedCount++;

      const t0 = performance.now();
      let result = {
        url, depth,
        status: 0,
        finalUrl: url,
        redirected: false,
        redirectChain: [],
        redirectHops: 0,
        durationMs: 0,
        html: "",
        contentType: "",
        contentLength: 0,
        headers: {},
        error: null,
      };
      try {
        const { finalRes, finalUrl, chain, hops } = await this.fetchWithRedirectChain(url);
        if (!finalRes) {
          result.error = "no_response";
        } else {
          result.status = finalRes.status;
          result.finalUrl = finalUrl;
          result.redirected = chain.length > 0;
          result.redirectChain = chain;
          result.redirectHops = hops;
          result.contentType = finalRes.headers.get("content-type") || "";
          // Lowercase headers map
          const hdr = {};
          finalRes.headers.forEach((v, k) => { hdr[k.toLowerCase()] = v; });
          result.headers = hdr;
          const cl = finalRes.headers.get("content-length");
          if (cl) result.contentLength = parseInt(cl, 10);
          if (result.contentType.includes("text/html") || result.contentType.includes("xml")) {
            result.html = await finalRes.text();
            if (!result.contentLength) result.contentLength = Buffer.byteLength(result.html, "utf8");
          } else {
            // Drain body để release socket
            try { await finalRes.text(); } catch {}
          }
        }
      } catch (e) {
        result.error = e.message;
      }
      result.durationMs = Math.round(performance.now() - t0);

      visited.set(url, result);
      if (onProgress) onProgress({ done: visited.size, total: Math.min(this.config.maxUrls, queue.length + visited.size), result });

      // Custom per-page handler (analysis)
      if (fetchHandler && result.html) {
        try { await fetchHandler(result); } catch (e) { result.handlerError = e.message; }
      }

      // Discover more URLs
      if (depth < this.config.maxDepth && result.html) {
        const links = this.extractInternalLinks(result.html, result.finalUrl);
        allInternalLinks.set(result.finalUrl, links);
        for (const link of links) {
          if (!visited.has(link) && !queue.find((q) => q.url === link)) {
            queue.push({ url: link, depth: depth + 1 });
          }
        }
      }

      if (this.config.delayBetweenRequestsMs > 0) {
        await new Promise((r) => setTimeout(r, this.config.delayBetweenRequestsMs));
      }
    };

    // Concurrency pool
    //
    // Loop invariant: each iteration MUST either spawn at least one worker,
    // await at least one in-flight worker, or break out. Without that we
    // risk a tight infinite loop when the queue still has items but we've
    // already reached maxUrls (so we can't spawn) AND no workers are in
    // flight (so there's nothing to await). v0.5 had this bug — process
    // appeared to "hang after crawl" because the event loop was pinned
    // before reaching the report-export stage.
    const workers = new Set();
    while (true) {
      // Stop if cap reached and nothing is in flight (queue may still have
      // leftover items beyond the cap — that's expected, just drop them).
      if (visited.size >= this.config.maxUrls && workers.size === 0) break;
      // Stop if there's nothing left to do at all.
      if (queue.length === 0 && workers.size === 0) break;

      // Spawn workers up to concurrency and within maxUrls budget.
      while (
        workers.size < this.config.concurrency &&
        queue.length > 0 &&
        visited.size < this.config.maxUrls
      ) {
        const item = queue.shift();
        const p = processOne(item).finally(() => workers.delete(p));
        workers.add(p);
      }

      if (workers.size > 0) {
        // Yield to the event loop and wait for at least one worker to settle.
        await Promise.race(workers);
      } else {
        // No workers and we couldn't spawn (cap reached or nothing allowed
        // by robots etc). Exit cleanly instead of spinning.
        break;
      }
    }

    return {
      pages: [...visited.values()].filter((p) => !p.pending),
      skipped,
      sitemapsUsed,
      sitemapUrls,
      sitemapFound,
      sitemapErrors,
      robots,
      allInternalLinks,
    };
  }
}
