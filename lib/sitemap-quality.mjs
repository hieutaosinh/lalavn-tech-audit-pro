/**
 * Sitemap quality check.
 *
 * Cross-validate: URLs trong sitemap có
 *  - Trả về 200 không (404/410 = critical)
 *  - Có meta noindex không (sitemap không nên chứa noindex page)
 *  - Có canonical trỏ đi nơi khác không (sitemap nên là canonical)
 *  - Có < 50,000 URL / file không (Google limit)
 *
 * Input: sitemap URLs đã collect được, page results đã crawl được.
 * Output: list issues + summary.
 */

const GOOGLE_SITEMAP_URL_LIMIT = 50000;

/**
 * @param {Array<{url: string, count: number}>} sitemapsUsed - sitemaps đã fetch
 * @param {Array<string>} sitemapUrls - tất cả URL trong sitemap (đã flatten)
 * @param {Array<Object>} crawledPages - pages từ crawler (có status, finalUrl, redirected)
 * @param {Map<string, Object>} signalsByUrl - signals[noindex, canonical] per page
 */
export function analyzeSitemapQuality(sitemapsUsed, sitemapUrls, crawledPages, signalsByUrl) {
  const issues = [];
  const summary = {
    sitemaps: sitemapsUsed.length,
    totalUrls: sitemapUrls.length,
    overSizedSitemaps: 0,
    urlsBroken: [],
    urlsNoindex: [],
    urlsRedirected: [],
    urlsCanonicalElsewhere: [],
    urlsNotInCrawl: 0,
  };

  if (!sitemapUrls || sitemapUrls.length === 0) return { issues, summary };

  // Kiểm tra số URL / file
  for (const sm of sitemapsUsed) {
    if (sm.count > GOOGLE_SITEMAP_URL_LIMIT) {
      summary.overSizedSitemaps++;
      issues.push({
        severity: "warning",
        code: "SITEMAP_TOO_LARGE",
        message: `Sitemap ${sm.url} có ${sm.count} URL — vượt giới hạn ${GOOGLE_SITEMAP_URL_LIMIT} của Google. Nên tách thành sitemap index.`,
        area: "technical",
      });
    }
  }

  // Build lookup từ crawl results
  const pageByUrl = new Map();
  for (const p of crawledPages) {
    pageByUrl.set(p.url, p);
    if (p.finalUrl && p.finalUrl !== p.url) pageByUrl.set(p.finalUrl, p);
  }

  // Cross-check từng URL trong sitemap
  // Lưu ý: chỉ check URL nào đã được crawl (vì sitemap có thể có URL mà crawler không reach do depth limit)
  let checked = 0;
  for (const sUrl of sitemapUrls) {
    const cleanUrl = sUrl.split("#")[0];
    const page = pageByUrl.get(cleanUrl);
    if (!page) {
      summary.urlsNotInCrawl++;
      continue;
    }
    checked++;

    if (page.status >= 400) {
      summary.urlsBroken.push({ url: cleanUrl, status: page.status });
    } else if (page.redirected) {
      summary.urlsRedirected.push({ url: cleanUrl, finalUrl: page.finalUrl });
    }

    const sig = signalsByUrl.get(page.finalUrl) || signalsByUrl.get(cleanUrl);
    if (sig?.noindex) {
      summary.urlsNoindex.push(cleanUrl);
    }
    if (sig?.canonical) {
      try {
        const canonAbs = new URL(sig.canonical, page.finalUrl).toString().split("#")[0];
        const target = (page.finalUrl || cleanUrl).split("#")[0];
        if (canonAbs !== target && canonAbs !== cleanUrl) {
          summary.urlsCanonicalElsewhere.push({ url: cleanUrl, canonical: canonAbs });
        }
      } catch {}
    }
  }
  summary.urlsChecked = checked;

  // ── Issues
  if (summary.urlsBroken.length > 0) {
    issues.push({
      severity: "critical",
      code: "SITEMAP_HAS_BROKEN_URLS",
      message: `${summary.urlsBroken.length} URL trong sitemap trả 4xx/5xx — Google sẽ giảm crawl trust`,
      area: "technical",
    });
  }
  if (summary.urlsNoindex.length > 0) {
    issues.push({
      severity: "warning",
      code: "SITEMAP_HAS_NOINDEX",
      message: `${summary.urlsNoindex.length} URL trong sitemap có meta noindex — mâu thuẫn với việc khai báo trong sitemap`,
      area: "technical",
    });
  }
  if (summary.urlsRedirected.length >= 5) {
    issues.push({
      severity: "warning",
      code: "SITEMAP_HAS_REDIRECTS",
      message: `${summary.urlsRedirected.length} URL trong sitemap đang bị 3xx redirect — nên cập nhật sitemap dùng URL đích`,
      area: "technical",
    });
  }
  if (summary.urlsCanonicalElsewhere.length >= 3) {
    issues.push({
      severity: "warning",
      code: "SITEMAP_CANONICAL_MISMATCH",
      message: `${summary.urlsCanonicalElsewhere.length} URL trong sitemap có canonical trỏ trang khác — sitemap nên chỉ chứa canonical URL`,
      area: "technical",
    });
  }

  return { issues, summary };
}
