/**
 * HTTP security headers + compression check.
 *
 * Đọc response headers (đã được crawler capture) → trả ra issues + signals.
 * Apply cho homepage (đại diện) — tránh noise per-page với 100 trang.
 */

const HEADER_RULES = {
  "strict-transport-security": {
    severity: "warning",
    area: "security",
    label: "HSTS",
    why: "Force browser dùng HTTPS, tránh downgrade attack",
  },
  "content-security-policy": {
    severity: "info",
    area: "security",
    label: "CSP",
    why: "Hạn chế XSS bằng cách giới hạn nguồn script/style được load",
  },
  "x-content-type-options": {
    severity: "info",
    area: "security",
    label: "X-Content-Type-Options",
    why: "Chặn MIME-sniffing (nên là 'nosniff')",
  },
  "x-frame-options": {
    severity: "info",
    area: "security",
    label: "X-Frame-Options",
    why: "Chặn clickjacking (nên là 'SAMEORIGIN' hoặc dùng CSP frame-ancestors)",
  },
  "referrer-policy": {
    severity: "info",
    area: "security",
    label: "Referrer-Policy",
    why: "Kiểm soát thông tin referrer khi user click ra ngoài",
  },
  "permissions-policy": {
    severity: "info",
    area: "security",
    label: "Permissions-Policy",
    why: "Khoá quyền truy cập sensor/camera/mic mặc định",
  },
};

/**
 * @param {Object} headers - lowercase header name → value
 * @param {string} url - URL của page (để xác định HTTPS hay không)
 */
export function analyzeSecurityHeaders(headers, url) {
  const issues = [];
  const signals = {
    present: {},
    missing: [],
    compression: "none",
    hsts: null,
    httpsOnly: url.startsWith("https://"),
  };
  if (!headers) return { issues, signals };

  // ── Required headers
  for (const [name, rule] of Object.entries(HEADER_RULES)) {
    const v = headers[name];
    if (v) {
      signals.present[name] = v;
    } else {
      // HSTS chỉ có ý nghĩa với HTTPS
      if (name === "strict-transport-security" && !signals.httpsOnly) continue;
      signals.missing.push(name);
      const code = `MISSING_${name.toUpperCase().replace(/-/g, "_")}`;
      issues.push({
        severity: rule.severity,
        code,
        message: `Thiếu HTTP header ${rule.label} — ${rule.why}`,
        area: rule.area,
      });
    }
  }

  // ── HSTS quality
  if (signals.present["strict-transport-security"]) {
    const hsts = signals.present["strict-transport-security"];
    const maxAgeMatch = hsts.match(/max-age\s*=\s*(\d+)/i);
    const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 0;
    signals.hsts = {
      raw: hsts,
      maxAge,
      includeSubDomains: /includesubdomains/i.test(hsts),
      preload: /preload/i.test(hsts),
    };
    if (maxAge > 0 && maxAge < 15552000) {
      // < 6 tháng (180 ngày)
      issues.push({
        severity: "info",
        code: "HSTS_MAX_AGE_SHORT",
        message: `HSTS max-age ngắn (${maxAge}s ~ ${Math.round(maxAge / 86400)} ngày, nên ≥ 180 ngày)`,
        area: "security",
      });
    }
  }

  // ── X-Content-Type-Options value check
  const xcto = signals.present["x-content-type-options"];
  if (xcto && !/nosniff/i.test(xcto)) {
    issues.push({
      severity: "info",
      code: "XCTO_NOT_NOSNIFF",
      message: `X-Content-Type-Options = "${xcto}" — nên là "nosniff"`,
      area: "security",
    });
  }

  // ── Compression
  const enc = (headers["content-encoding"] || "").toLowerCase();
  signals.compression = enc || "none";
  if (!enc) {
    issues.push({
      severity: "warning",
      code: "NO_COMPRESSION",
      message: "Response không được nén (gzip/br) — page weight tăng, LCP chậm hơn",
      area: "performance",
    });
  } else if (!enc.includes("br")) {
    // gzip OK nhưng Brotli tốt hơn
    issues.push({
      severity: "info",
      code: "COMPRESSION_NOT_BROTLI",
      message: `Server dùng "${enc}" — Brotli (br) tiết kiệm thêm ~15-20% cho text/HTML`,
      area: "performance",
    });
  }

  return { issues, signals };
}
