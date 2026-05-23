/**
 * Rule-based Action Plan generator.
 * Reads issues + signals → produces P0/P1/P2 tasks with effort + impact estimates.
 *
 * No AI/LLM. Pure rules. Mỗi rule trả về 0-N task, sau đó merge & dedupe.
 */

const RULES = [
  // ── P0: Critical — fix tuần này
  {
    id: "fix_noindex_unintended",
    priority: "P0",
    test: ({ issuesByCode }) => issuesByCode.has("META_NOINDEX"),
    build: ({ issuesByCode }) => ({
      title: "Gỡ bỏ noindex trên các trang quan trọng",
      reason: `${issuesByCode.get("META_NOINDEX").length} trang đang bị noindex — Google không index được`,
      action: "Kiểm tra meta robots trong CMS / theme; gỡ noindex khỏi các trang không phải /tag, /author, /search.",
      effort: "low",
      impact: "high",
      area: "indexability",
    }),
  },
  {
    id: "fix_canonical_cross_domain",
    priority: "P0",
    test: ({ issuesByCode }) => issuesByCode.has("CANONICAL_CROSS_DOMAIN"),
    build: ({ issuesByCode }) => ({
      title: "Sửa canonical đang trỏ sang domain khác",
      reason: `${issuesByCode.get("CANONICAL_CROSS_DOMAIN").length} trang có canonical sai — Google sẽ ưu tiên trang đích thay vì trang hiện tại`,
      action: "Sửa thẻ <link rel=canonical> trỏ về URL hiện tại của site.",
      effort: "low",
      impact: "high",
      area: "technical",
    }),
  },
  {
    id: "fix_http_4xx_5xx",
    priority: "P0",
    test: ({ pages }) => pages.filter((p) => p.status >= 400).length > 0,
    build: ({ pages }) => {
      const bad = pages.filter((p) => p.status >= 400);
      return {
        title: `Sửa ${bad.length} URL trả lỗi HTTP`,
        reason: `${bad.length} URL trong sitemap/internal link đang lỗi 4xx/5xx`,
        action: `Redirect 301 các URL này về trang phù hợp, hoặc xoá khỏi sitemap. URLs: ${bad.slice(0, 3).map((p) => p.url).join(", ")}${bad.length > 3 ? ", ..." : ""}`,
        effort: "medium",
        impact: "high",
        area: "technical",
      };
    },
  },
  {
    id: "enable_https",
    priority: "P0",
    test: ({ siteSignals }) => !siteSignals.https,
    build: () => ({
      title: "Bật HTTPS",
      reason: "Site chưa dùng HTTPS — Google đánh giá thấp + Chrome cảnh báo 'Not Secure'",
      action: "Cài Let's Encrypt SSL miễn phí qua Cloudflare hoặc certbot. Setup 301 từ HTTP sang HTTPS.",
      effort: "medium",
      impact: "critical",
      area: "technical",
    }),
  },
  {
    id: "fix_lcp_critical",
    priority: "P0",
    test: ({ issuesByCode }) => {
      const lcp = issuesByCode.get("LCP_SLOW");
      return lcp && lcp.some((i) => i.severity === "critical");
    },
    build: ({ issuesByCode }) => ({
      title: "Tối ưu LCP (Largest Contentful Paint)",
      reason: "LCP > 4s trên mobile — Google Core Web Vitals fail, ảnh hưởng ranking",
      action: "Tối ưu ảnh hero (compress, WebP, dùng srcset). Preload critical resources. Xem PSI opportunities chi tiết trong báo cáo.",
      effort: "medium",
      impact: "high",
      area: "performance",
    }),
  },

  // ── P1: Tháng này
  {
    id: "create_robots_txt",
    priority: "P1",
    test: ({ siteSignals }) => !siteSignals.robotsTxt?.exists,
    build: () => ({
      title: "Tạo file robots.txt",
      reason: "Site chưa có robots.txt — search engine không có hướng dẫn crawl",
      action: "Tạo robots.txt ở root domain. Khai báo sitemap. Tham khảo template trong báo cáo.",
      effort: "low",
      impact: "medium",
      area: "technical",
    }),
  },
  {
    id: "create_sitemap",
    priority: "P1",
    test: ({ siteSignals }) => !siteSignals.sitemapFound,
    build: () => ({
      title: "Tạo sitemap.xml",
      reason: "Site chưa có sitemap — Google khó discover URL mới",
      action: "Tạo sitemap.xml động từ CMS (WordPress: dùng plugin Yoast/RankMath). Submit qua Google Search Console.",
      effort: "low",
      impact: "high",
      area: "technical",
    }),
  },
  {
    id: "fix_duplicate_content",
    priority: "P1",
    test: ({ issuesByCode }) => issuesByCode.has("DUPLICATE_TITLE") || issuesByCode.has("DUPLICATE_META"),
    build: ({ issuesByCode }) => {
      const dt = issuesByCode.get("DUPLICATE_TITLE")?.length || 0;
      const dm = issuesByCode.get("DUPLICATE_META")?.length || 0;
      return {
        title: "Viết lại title / meta cho trang trùng",
        reason: `${dt} title trùng, ${dm} meta description trùng — Google không phân biệt được trang nào ưu tiên`,
        action: "Mỗi URL phải có title + meta riêng. Ưu tiên các trang quan trọng (homepage, pillar, category).",
        effort: "medium",
        impact: "medium",
        area: "on-page",
      };
    },
  },
  {
    id: "fix_thin_content",
    priority: "P1",
    test: ({ issuesByCode }) => (issuesByCode.get("THIN_CONTENT")?.length || 0) >= 3,
    build: ({ issuesByCode }) => ({
      title: "Mở rộng nội dung cho trang thin content",
      reason: `${issuesByCode.get("THIN_CONTENT").length} trang dưới ngưỡng từ — Google đánh giá là low-value`,
      action: "Audit từng trang: thêm ví dụ thật, FAQ, hình ảnh có alt mô tả. Hoặc gộp/redirect nếu trang không quan trọng.",
      effort: "high",
      impact: "high",
      area: "content",
    }),
  },
  {
    id: "fix_h1",
    priority: "P1",
    test: ({ issuesByCode }) => issuesByCode.has("H1_MISSING") || issuesByCode.has("H1_MULTIPLE"),
    build: ({ issuesByCode }) => {
      const missing = issuesByCode.get("H1_MISSING")?.length || 0;
      const multi = issuesByCode.get("H1_MULTIPLE")?.length || 0;
      return {
        title: "Chuẩn hoá thẻ H1",
        reason: `${missing} trang thiếu H1, ${multi} trang có nhiều H1`,
        action: "Mỗi trang đúng 1 H1, chứa target keyword. Sửa template theme nếu lỗi cấu trúc.",
        effort: "low",
        impact: "medium",
        area: "on-page",
      };
    },
  },
  {
    id: "fix_orphan_pages",
    priority: "P1",
    test: ({ issuesByCode }) => issuesByCode.has("ORPHAN_PAGES"),
    build: ({ issuesByCode }) => ({
      title: "Thêm internal link tới trang orphan",
      reason: `${issuesByCode.get("ORPHAN_PAGES")[0].message} — page không có internal link → khó index, ít authority`,
      action: "Audit từng trang orphan, thêm link từ pillar/category liên quan. Tạo related posts widget.",
      effort: "medium",
      impact: "medium",
      area: "internal-linking",
    }),
  },
  {
    id: "add_schema",
    priority: "P1",
    test: ({ pages, signalsByUrl }) => {
      let hasArticle = 0;
      for (const sig of signalsByUrl.values()) {
        if (sig.schemaTypes?.some((t) => /Article|BlogPosting/.test(t))) hasArticle++;
      }
      return hasArticle < pages.length * 0.5; // < 50% trang có Article schema
    },
    build: ({ pages, signalsByUrl }) => {
      let hasArticle = 0;
      for (const sig of signalsByUrl.values()) {
        if (sig.schemaTypes?.some((t) => /Article|BlogPosting/.test(t))) hasArticle++;
      }
      return {
        title: "Bổ sung schema markup (JSON-LD)",
        reason: `Chỉ ${hasArticle}/${pages.length} trang có Article schema — bỏ lỡ rich result + AI Overview`,
        action: "Thêm Article + BreadcrumbList ở mọi bài viết, FAQPage ở trang FAQ, Organization + WebSite ở homepage. Dùng tool schema-gen của Lalaseo.",
        effort: "medium",
        impact: "high",
        area: "schema",
      };
    },
  },

  // ── P0: AI Search blocker — fix gấp
  {
    id: "geo_unblock_ai_bots",
    priority: "P0",
    test: ({ issuesByCode }) => issuesByCode.has("GEO_AI_BLOCKED"),
    build: ({ issuesByCode }) => ({
      title: "Mở quyền crawl cho AI bots (GPTBot, ClaudeBot, PerplexityBot...)",
      reason: issuesByCode.get("GEO_AI_BLOCKED")[0].message,
      action: "Sửa robots.txt — gỡ Disallow: / cho các AI user-agent (GPTBot, ClaudeBot, PerplexityBot, Google-Extended). Nếu chỉ muốn block training, allow crawl nhưng add 'noai' meta tag thay vì block hoàn toàn.",
      effort: "low",
      impact: "critical",
      area: "ai-search",
    }),
  },

  // ── P1: GEO foundation — tháng này
  {
    id: "geo_create_llms_txt",
    priority: "P1",
    test: ({ issuesByCode }) => issuesByCode.has("GEO_LLMS_TXT_MISSING"),
    build: () => ({
      title: "Tạo file /llms.txt",
      reason: "Đa số site VN chưa có llms.txt — đây là chuẩn mới giúp LLM hiểu site nhanh và đầy đủ hơn, ưu thế first-mover",
      action: "Dùng schema-gen --recipe llms-txt để generate. Đặt ở root domain. Liệt kê các trang quan trọng, About, Sản phẩm.",
      effort: "low",
      impact: "high",
      area: "ai-search",
    }),
  },
  {
    id: "geo_organization_schema",
    priority: "P1",
    test: ({ issuesByCode }) => issuesByCode.has("GEO_NO_ORG_SCHEMA"),
    build: () => ({
      title: "Thêm Organization schema vào homepage",
      reason: "Không có Organization schema → LLM không biết site này là tổ chức gì, ai đứng sau, không tin tưởng để cite",
      action: "Dùng schema-gen --recipe homepage. Điền name, url, logo, sameAs (social profiles), description đầy đủ.",
      effort: "low",
      impact: "high",
      area: "ai-search",
    }),
  },
  {
    id: "geo_author_eeat",
    priority: "P1",
    test: ({ issuesByCode }) => (issuesByCode.get("GEO_NO_AUTHOR")?.length || 0) >= 3,
    build: ({ issuesByCode }) => ({
      title: "Bổ sung author bio + Person schema cho mỗi tác giả",
      reason: `${issuesByCode.get("GEO_NO_AUTHOR").length} trang không có thông tin tác giả — LLM cần E-E-A-T (Experience, Expertise, Authority, Trust) để cite`,
      action: "Mỗi bài viết: thêm author bio cuối bài + Person schema (jobTitle, sameAs LinkedIn/Twitter, alumniOf nếu có). Dùng schema-gen --recipe author-eeat.",
      effort: "medium",
      impact: "high",
      area: "ai-search",
    }),
  },
  {
    id: "geo_improve_citability",
    priority: "P1",
    test: ({ issuesByCode }) => (issuesByCode.get("GEO_LOW_CITABILITY")?.length || 0) >= 3,
    build: ({ issuesByCode }) => ({
      title: "Tăng citability — thêm số liệu, FAQ, TL;DR",
      reason: `${issuesByCode.get("GEO_LOW_CITABILITY").length} trang có citability score thấp — LLM khó trích dẫn`,
      action: "Mỗi bài: thêm TL;DR ở đầu, ≥ 3 số liệu cụ thể (%, năm, $), 1 FAQ section cuối bài, 'theo X / nguồn:' cho data quan trọng. Đây là format LLM cite nhiều nhất.",
      effort: "medium",
      impact: "high",
      area: "ai-search",
    }),
  },

  // ── P2: GEO polish — quý này
  {
    id: "geo_add_faq",
    priority: "P2",
    test: ({ issuesByCode }) => (issuesByCode.get("GEO_NO_FAQ")?.length || 0) >= 5,
    build: ({ issuesByCode }) => ({
      title: "Thêm FAQ section cho các bài quan trọng",
      reason: `${issuesByCode.get("GEO_NO_FAQ").length} trang dài chưa có FAQ — bỏ lỡ format AI rất ưa cite`,
      action: "Cuối mỗi bài thêm 3-5 Q&A trả lời câu hỏi liên quan. Wrap bằng FAQPage schema (dùng schema-gen --recipe faq).",
      effort: "medium",
      impact: "medium",
      area: "ai-search",
    }),
  },
  {
    id: "geo_chunkability",
    priority: "P2",
    test: ({ issuesByCode }) => (issuesByCode.get("GEO_POOR_CHUNK")?.length || 0) >= 3,
    build: ({ issuesByCode }) => ({
      title: "Cải thiện cấu trúc H2 (chunkability)",
      reason: `${issuesByCode.get("GEO_POOR_CHUNK").length} trang có H2 không tự đứng được — LLM tách bài theo H2, mỗi section nên trả lời 1 câu hỏi`,
      action: "Mỗi H2 nên có ≥ 50 từ nội dung, mở đầu trả lời ngay câu hỏi tiềm ẩn của section. Tránh H2 → H3 ngay không có đoạn intro.",
      effort: "medium",
      impact: "medium",
      area: "ai-search",
    }),
  },

  // ── P2: Quý này (polish)
  {
    id: "fix_redirect_chains",
    priority: "P2",
    test: ({ issuesByCode }) => issuesByCode.has("REDIRECT_CHAIN_LONG"),
    build: ({ issuesByCode }) => ({
      title: "Gộp redirect chain dài thành 1 hop",
      reason: `${issuesByCode.get("REDIRECT_CHAIN_LONG").length} URL có redirect chain ≥ 3 hops — mỗi hop tốn 100-300ms, lãng phí crawl budget`,
      action: "Sửa rule redirect (server config / CMS) để mọi URL gốc redirect 1 lần thẳng tới URL đích cuối.",
      effort: "low",
      impact: "medium",
      area: "technical",
    }),
  },
  {
    id: "fix_internal_redirect_links",
    priority: "P2",
    test: ({ issuesByCode }) => issuesByCode.has("INTERNAL_LINK_TO_REDIRECT"),
    build: ({ issuesByCode }) => ({
      title: "Cập nhật internal link trỏ tới URL bị redirect",
      reason: issuesByCode.get("INTERNAL_LINK_TO_REDIRECT")[0].message,
      action: "Find & replace trong CMS: thay URL cũ bằng URL đích cuối. Tiết kiệm crawl budget + giữ link equity.",
      effort: "medium",
      impact: "medium",
      area: "internal-linking",
    }),
  },
  {
    id: "fix_internal_broken_links",
    priority: "P1",
    test: ({ issuesByCode }) => issuesByCode.has("INTERNAL_LINK_TO_BROKEN"),
    build: ({ issuesByCode }) => ({
      title: "Sửa internal link trỏ tới URL 4xx/5xx",
      reason: issuesByCode.get("INTERNAL_LINK_TO_BROKEN")[0].message,
      action: "Tìm các trang chứa link broken trong báo cáo, đổi link sang URL hoạt động hoặc xoá.",
      effort: "medium",
      impact: "medium",
      area: "internal-linking",
    }),
  },
  {
    id: "fix_mixed_content",
    priority: "P0",
    test: ({ issuesByCode }) => issuesByCode.has("MIXED_CONTENT"),
    build: ({ issuesByCode }) => ({
      title: "Sửa mixed content (HTTPS load resource HTTP)",
      reason: `${issuesByCode.get("MIXED_CONTENT").length} trang HTTPS load resource HTTP — Chrome block hoặc cảnh báo lỗ hổng bảo mật`,
      action: "Tìm các resource http:// trong báo cáo, đổi sang https:// (CDN, ảnh, script). Hoặc dùng protocol-relative //example.com/foo.",
      effort: "low",
      impact: "high",
      area: "security",
    }),
  },
  {
    id: "add_security_headers",
    priority: "P1",
    test: ({ issuesByCode }) =>
      issuesByCode.has("MISSING_STRICT_TRANSPORT_SECURITY") ||
      issuesByCode.has("MISSING_X_CONTENT_TYPE_OPTIONS") ||
      issuesByCode.has("MISSING_CONTENT_SECURITY_POLICY"),
    build: ({ issuesByCode }) => {
      const missing = [];
      if (issuesByCode.has("MISSING_STRICT_TRANSPORT_SECURITY")) missing.push("HSTS");
      if (issuesByCode.has("MISSING_X_CONTENT_TYPE_OPTIONS")) missing.push("X-Content-Type-Options");
      if (issuesByCode.has("MISSING_CONTENT_SECURITY_POLICY")) missing.push("CSP");
      if (issuesByCode.has("MISSING_X_FRAME_OPTIONS")) missing.push("X-Frame-Options");
      if (issuesByCode.has("MISSING_REFERRER_POLICY")) missing.push("Referrer-Policy");
      if (issuesByCode.has("MISSING_PERMISSIONS_POLICY")) missing.push("Permissions-Policy");
      return {
        title: "Thêm HTTP security headers",
        reason: `Thiếu ${missing.join(", ")} — Lighthouse/Mozilla Observatory đánh giá thấp, dễ bị XSS/clickjacking`,
        action: "Cấu hình ở server/CDN: HSTS max-age ≥ 180 ngày, X-Content-Type-Options: nosniff, CSP cơ bản, Referrer-Policy: strict-origin-when-cross-origin.",
        effort: "low",
        impact: "medium",
        area: "security",
      };
    },
  },
  {
    id: "enable_compression",
    priority: "P1",
    test: ({ issuesByCode }) => issuesByCode.has("NO_COMPRESSION"),
    build: () => ({
      title: "Bật gzip/Brotli compression",
      reason: "Server không nén response — page weight tăng 60-80%, LCP chậm rõ rệt",
      action: "Bật compression ở server/CDN. Nginx: gzip on + brotli on. Cloudflare: bật Brotli trong Speed → Optimization.",
      effort: "low",
      impact: "high",
      area: "performance",
    }),
  },
  {
    id: "fix_sitemap_quality",
    priority: "P1",
    test: ({ issuesByCode }) =>
      issuesByCode.has("SITEMAP_HAS_BROKEN_URLS") ||
      issuesByCode.has("SITEMAP_HAS_NOINDEX") ||
      issuesByCode.has("SITEMAP_HAS_REDIRECTS"),
    build: ({ issuesByCode }) => {
      const reasons = [];
      if (issuesByCode.has("SITEMAP_HAS_BROKEN_URLS")) reasons.push(issuesByCode.get("SITEMAP_HAS_BROKEN_URLS")[0].message);
      if (issuesByCode.has("SITEMAP_HAS_NOINDEX")) reasons.push(issuesByCode.get("SITEMAP_HAS_NOINDEX")[0].message);
      if (issuesByCode.has("SITEMAP_HAS_REDIRECTS")) reasons.push(issuesByCode.get("SITEMAP_HAS_REDIRECTS")[0].message);
      return {
        title: "Dọn dẹp sitemap.xml",
        reason: reasons.join(" · "),
        action: "Sitemap chỉ nên chứa URL canonical, status 200, không noindex. Re-generate sitemap từ CMS hoặc filter trước khi deploy.",
        effort: "low",
        impact: "medium",
        area: "technical",
      };
    },
  },
  {
    id: "fix_html_lang_viewport",
    priority: "P2",
    test: ({ issuesByCode }) => issuesByCode.has("HTML_LANG_MISSING") || issuesByCode.has("VIEWPORT_MISSING"),
    build: ({ issuesByCode }) => {
      const missing = [];
      if (issuesByCode.has("HTML_LANG_MISSING")) missing.push(`<html lang> (${issuesByCode.get("HTML_LANG_MISSING").length} trang)`);
      if (issuesByCode.has("VIEWPORT_MISSING")) missing.push(`viewport meta (${issuesByCode.get("VIEWPORT_MISSING").length} trang)`);
      return {
        title: "Bổ sung a11y baseline (lang + viewport)",
        reason: `Thiếu ${missing.join(", ")} — search engine khó xác định ngôn ngữ, mobile không responsive`,
        action: "Sửa template theme: thêm <html lang=\"vi\"> và <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"> ở head.",
        effort: "low",
        impact: "medium",
        area: "accessibility",
      };
    },
  },
  {
    id: "fix_form_labels",
    priority: "P2",
    test: ({ issuesByCode }) => (issuesByCode.get("FORM_INPUT_NO_LABEL")?.length || 0) >= 2,
    build: ({ issuesByCode }) => ({
      title: "Thêm label cho form input",
      reason: `${issuesByCode.get("FORM_INPUT_NO_LABEL").length} trang có form input không có label — fail WCAG, screen reader không đọc được`,
      action: "Mỗi input cần <label for=\"id\"> hoặc aria-label. Tránh chỉ dùng placeholder vì biến mất khi user gõ.",
      effort: "low",
      impact: "low",
      area: "accessibility",
    }),
  },
  {
    id: "fix_hreflang_reciprocity",
    priority: "P2",
    test: ({ issuesByCode }) => issuesByCode.has("HREFLANG_NO_RECIPROCAL") || issuesByCode.has("HREFLANG_NO_X_DEFAULT") || issuesByCode.has("HREFLANG_INVALID_CODE"),
    build: ({ issuesByCode }) => {
      const probs = [];
      if (issuesByCode.has("HREFLANG_NO_RECIPROCAL")) probs.push(`${issuesByCode.get("HREFLANG_NO_RECIPROCAL").length} hreflang không có reciprocal`);
      if (issuesByCode.has("HREFLANG_NO_X_DEFAULT")) probs.push("không có x-default");
      if (issuesByCode.has("HREFLANG_INVALID_CODE")) probs.push(`${issuesByCode.get("HREFLANG_INVALID_CODE").length} mã hreflang không hợp lệ`);
      return {
        title: "Sửa hreflang reciprocity",
        reason: `Vấn đề hreflang: ${probs.join(", ")} — Google sẽ ignore toàn bộ hreflang nếu không reciprocal đúng cách`,
        action: "Mỗi cặp ngôn ngữ A↔B phải khai báo lẫn nhau. Thêm <link rel=alternate hreflang=x-default> ở mọi trang. Dùng mã ISO 639-1 chuẩn (vi, en, en-US).",
        effort: "medium",
        impact: "medium",
        area: "i18n",
      };
    },
  },
  {
    id: "geo_add_trust_pages",
    priority: "P1",
    test: ({ issuesByCode }) => issuesByCode.has("GEO_MISSING_TRUST_PAGES"),
    build: ({ issuesByCode }) => ({
      title: "Tạo trang trust (About / Contact / Privacy / Terms)",
      reason: issuesByCode.get("GEO_MISSING_TRUST_PAGES")[0].message,
      action: "Tạo /about (mô tả tổ chức + đội ngũ), /contact (email + địa chỉ + map), /privacy, /terms. LLM dùng làm trust signal mạnh trước khi cite.",
      effort: "medium",
      impact: "high",
      area: "ai-search",
    }),
  },
  {
    id: "geo_add_sameas",
    priority: "P1",
    test: ({ issuesByCode }) => issuesByCode.has("GEO_NO_SAMEAS") || issuesByCode.has("GEO_SAMEAS_THIN"),
    build: ({ issuesByCode }) => ({
      title: "Bổ sung sameAs cho Organization schema",
      reason: (issuesByCode.get("GEO_NO_SAMEAS") || issuesByCode.get("GEO_SAMEAS_THIN"))[0].message,
      action: "Trong Organization JSON-LD, thêm \"sameAs\": [\"https://linkedin.com/company/...\", \"https://twitter.com/...\", \"https://wikipedia.org/wiki/...\"]. Đây là backbone của Knowledge Graph mà LLM dùng để verify danh tính.",
      effort: "low",
      impact: "high",
      area: "ai-search",
    }),
  },
  {
    id: "geo_add_direct_answer",
    priority: "P2",
    test: ({ issuesByCode }) => (issuesByCode.get("GEO_NO_DIRECT_ANSWER")?.length || 0) >= 3,
    build: ({ issuesByCode }) => ({
      title: "Thêm direct-answer paragraph sau mỗi H2",
      reason: `${issuesByCode.get("GEO_NO_DIRECT_ANSWER").length} trang có < 40% H2 với direct-answer paragraph — đây là format ChatGPT/Perplexity cite nhiều nhất`,
      action: "Ngay sau mỗi H2 dạng câu hỏi, viết 1 đoạn 30-100 từ trả lời thẳng câu hỏi đó. Tránh đoạn intro mơ hồ. Format: \"X là Y. Cụ thể: [3-5 ý chính]\".",
      effort: "medium",
      impact: "high",
      area: "ai-search",
    }),
  },

  // ── P0: Google official guidance — fix gấp
  {
    id: "fix_googlebot_blocked",
    priority: "P0",
    test: ({ issuesByCode }) => issuesByCode.has("GOOGLEBOT_BLOCKED"),
    build: ({ issuesByCode }) => ({
      title: "Mở quyền crawl cho Googlebot",
      reason: issuesByCode.get("GOOGLEBOT_BLOCKED")[0].message,
      action: "Sửa robots.txt, gỡ Disallow: / cho User-agent: Googlebot. Đây là Google official guidance — không có Googlebot crawl thì site KHÔNG xuất hiện trong cả Google Search lẫn AI Overviews/AI Mode.",
      effort: "low",
      impact: "critical",
      area: "indexability",
    }),
  },
  {
    id: "fix_nosnippet_unintended",
    priority: "P0",
    test: ({ issuesByCode }) => issuesByCode.has("NOSNIPPET_PRESENT") || issuesByCode.has("MAX_SNIPPET_ZERO"),
    build: ({ issuesByCode }) => {
      const ns = issuesByCode.get("NOSNIPPET_PRESENT")?.length || 0;
      const ms0 = issuesByCode.get("MAX_SNIPPET_ZERO")?.length || 0;
      return {
        title: "Gỡ nosnippet / max-snippet:0 nếu không cố ý",
        reason: `${ns} trang có nosnippet, ${ms0} trang có max-snippet:0 — Google sẽ KHÔNG cite trong AI Overviews. Đây là Google official "kill switch" cho AI features.`,
        action: "Kiểm tra meta robots, X-Robots-Tag header, googlebot meta. Nếu không cố ý opt-out khỏi AI Overviews thì gỡ ngay.",
        effort: "low",
        impact: "critical",
        area: "indexability",
      };
    },
  },

  // ── P1: Google official — content & schema
  {
    id: "fix_article_schema_for_ai",
    priority: "P1",
    test: ({ issuesByCode }) => (issuesByCode.get("ARTICLE_SCHEMA_INCOMPLETE_FOR_AI")?.length || 0) >= 3,
    build: ({ issuesByCode }) => ({
      title: "Bổ sung field thiếu cho Article schema (AI Overviews)",
      reason: `${issuesByCode.get("ARTICLE_SCHEMA_INCOMPLETE_FOR_AI").length} bài thiếu field quan trọng — Google official: AI Overviews ưu tiên cite Article có image, author.url, dateModified, publisher.logo, mainEntityOfPage`,
      action: "Cập nhật JSON-LD: thêm image (≥1200×630), author dạng object {@type:Person,name,url}, publisher.logo, dateModified mỗi lần edit, mainEntityOfPage trỏ về URL canonical.",
      effort: "medium",
      impact: "high",
      area: "schema",
    }),
  },
  {
    id: "fix_product_schema_for_ai",
    priority: "P1",
    test: ({ issuesByCode }) => issuesByCode.has("PRODUCT_SCHEMA_INCOMPLETE"),
    build: ({ issuesByCode }) => ({
      title: "Bổ sung Product schema cho AI Mode shopping",
      reason: `${issuesByCode.get("PRODUCT_SCHEMA_INCOMPLETE").length} product thiếu field — Google AI Mode shopping yêu cầu offers (price, currency, availability), image, brand, gtin/sku, aggregateRating`,
      action: "Cập nhật JSON-LD Product. Nếu dùng Shopify/WooCommerce, kiểm tra plugin SEO. Đảm bảo offers.priceCurrency, offers.availability đúng format schema.org.",
      effort: "medium",
      impact: "high",
      area: "schema",
    }),
  },
  {
    id: "refresh_stale_content",
    priority: "P2",
    test: ({ issuesByCode }) => (issuesByCode.get("CONTENT_VERY_STALE")?.length || 0) >= 5,
    build: ({ issuesByCode }) => ({
      title: "Refresh content quá cũ",
      reason: `${issuesByCode.get("CONTENT_VERY_STALE").length} bài có dateModified ≥ 24 tháng — Google official: AI Overviews ưu tiên content fresh`,
      action: "Audit từng bài: cập nhật số liệu, ví dụ, deprecated info; cập nhật dateModified. Nếu không refresh được, gộp/redirect sang bài thay thế.",
      effort: "high",
      impact: "medium",
      area: "content",
    }),
  },
  {
    id: "remove_intrusive_interstitial",
    priority: "P2",
    test: ({ issuesByCode }) => (issuesByCode.get("POSSIBLE_INTERSTITIAL")?.length || 0) >= 3,
    build: ({ issuesByCode }) => ({
      title: "Kiểm tra intrusive interstitial trên mobile",
      reason: `${issuesByCode.get("POSSIBLE_INTERSTITIAL").length} trang phát hiện element nghi vấn là popup/paywall che content — Google official page experience signal`,
      action: "Test trực tiếp trên mobile: nếu popup che > 50% viewport ngay khi load → page experience penalty. Cookie consent banner OK, nhưng newsletter/subscribe popup nên dùng exit intent hoặc scroll trigger thay vì onload.",
      effort: "medium",
      impact: "medium",
      area: "user-experience",
    }),
  },
  {
    id: "fix_crawl_budget_waste",
    priority: "P2",
    test: ({ issuesByCode }) => issuesByCode.has("CRAWL_BUDGET_WASTE"),
    build: ({ issuesByCode }) => ({
      title: "Disallow URL lãng phí crawl budget",
      reason: issuesByCode.get("CRAWL_BUDGET_WASTE")[0].message,
      action: "Thêm vào robots.txt: Disallow: /search/, Disallow: /*?utm_, Disallow: /cart/, Disallow: /checkout/. Cho phép Googlebot focus vào content có giá trị.",
      effort: "low",
      impact: "medium",
      area: "indexability",
    }),
  },
  {
    id: "build_topic_clusters",
    priority: "P2",
    test: ({ issuesByCode }) => issuesByCode.has("WEAK_TOPIC_CLUSTERS"),
    build: ({ issuesByCode }) => ({
      title: "Xây topic cluster (pillar + cluster pages)",
      reason: issuesByCode.get("WEAK_TOPIC_CLUSTERS")[0].message,
      action: "Mỗi pillar page (1500-3000 từ) nên có ≥ 5 internal link tới cluster page (subtopic). Google AI Mode dùng query fan-out — site có cluster sẽ cover được nhiều subquery hơn.",
      effort: "high",
      impact: "high",
      area: "internal-linking",
    }),
  },

  {
    id: "fix_soft_404",
    priority: "P1",
    test: ({ issuesByCode }) => issuesByCode.has("SOFT_404"),
    build: ({ issuesByCode }) => ({
      title: "Sửa soft 404 — page báo not-found nhưng trả status 200",
      reason: `${issuesByCode.get("SOFT_404").length} trang trả HTTP 200 nhưng nội dung "not found / 404" — Google không index, lãng phí crawl budget`,
      action: "Server config: trả HTTP 404 hoặc 410 cho các URL này. Hoặc 301 redirect về trang phù hợp (homepage, category gần nhất). Đặc biệt phổ biến trong SPA chưa SSR error state.",
      effort: "low",
      impact: "high",
      area: "indexability",
    }),
  },
  {
    id: "fix_spa_empty_root",
    priority: "P1",
    test: ({ issuesByCode }) => (issuesByCode.get("SPA_EMPTY_ROOT")?.length || 0) >= 3,
    build: ({ issuesByCode }) => ({
      title: "SSR / SSG cho SPA — Googlebot thấy HTML rỗng",
      reason: `${issuesByCode.get("SPA_EMPTY_ROOT").length} trang là SPA với root container rỗng — Google official khuyến nghị SSR hoặc dynamic rendering, JS render queue chậm + không reliable`,
      action: "Migrate sang Next.js/Nuxt/Astro với SSR/SSG. Hoặc dùng prerender.io / rendertron. Audit-pro hiện chỉ crawl static HTML nên các check khác có thể inaccurate trên SPA này.",
      effort: "high",
      impact: "high",
      area: "javascript-seo",
    }),
  },
  {
    id: "fix_pagination_canonical",
    priority: "P1",
    test: ({ issuesByCode }) => issuesByCode.has("PAGINATION_CANONICAL_TO_PAGE_1"),
    build: ({ issuesByCode }) => ({
      title: "Sửa canonical của paginated pages",
      reason: issuesByCode.get("PAGINATION_CANONICAL_TO_PAGE_1")[0].message,
      action: "Mỗi paginated URL (?page=2, /page/3/) phải có self-canonical trỏ về chính nó. Google deprecated rel=next/prev (2019). Đảm bảo crawlable <a href> đến mọi page trong dãy.",
      effort: "low",
      impact: "medium",
      area: "indexability",
    }),
  },
  {
    id: "fix_js_navigation",
    priority: "P2",
    test: ({ issuesByCode }) => issuesByCode.has("JS_NAVIGATION_ON_NON_ANCHOR") || issuesByCode.has("JAVASCRIPT_HREF"),
    build: ({ issuesByCode }) => {
      const a = issuesByCode.get("JS_NAVIGATION_ON_NON_ANCHOR")?.length || 0;
      const b = issuesByCode.get("JAVASCRIPT_HREF")?.length || 0;
      return {
        title: "Dùng <a href> thay vì onclick / javascript: links",
        reason: `${a} trang dùng span/div + onclick để navigate, ${b} trang có javascript: links — Googlebot không crawl được`,
        action: "Thay bằng <a href=\"/real-url\">. Có thể stylize bằng CSS giống button. Cho action thật (submit, modal) dùng <button>. Dùng Router (Next/Nuxt) với <Link> component sẽ tự render <a href>.",
        effort: "medium",
        impact: "medium",
        area: "javascript-seo",
      };
    },
  },

  // ── P2: Quý này (polish - existing rules)
  {
    id: "img_alt",
    priority: "P2",
    test: ({ issuesByCode }) => issuesByCode.has("IMG_ALT_MISSING"),
    build: ({ issuesByCode }) => ({
      title: "Bổ sung alt cho ảnh",
      reason: `${issuesByCode.get("IMG_ALT_MISSING").length} trang có ảnh thiếu alt`,
      action: "Viết alt mô tả ngắn gọn, đúng nội dung ảnh. Auto-fill từ filename nếu lười.",
      effort: "medium",
      impact: "low",
      area: "accessibility",
    }),
  },
  {
    id: "img_modern_format",
    priority: "P2",
    test: ({ issuesByCode }) => issuesByCode.has("IMG_OLD_FORMAT"),
    build: () => ({
      title: "Convert ảnh sang WebP/AVIF",
      reason: "Ảnh JPG/PNG nặng hơn WebP ~30% và AVIF ~50%",
      action: "Cấu hình CDN/server tự convert (Cloudflare Polish, NextJS next/image), hoặc batch convert qua sharp/squoosh.",
      effort: "low",
      impact: "medium",
      area: "performance",
    }),
  },
  {
    id: "img_dimensions",
    priority: "P2",
    test: ({ issuesByCode }) => issuesByCode.has("IMG_NO_DIMENSIONS"),
    build: () => ({
      title: "Thêm width/height cho ảnh",
      reason: "Ảnh thiếu dimension gây Cumulative Layout Shift (CLS)",
      action: "Set width + height trên thẻ <img> (CSS aspect-ratio sẽ giữ responsive).",
      effort: "low",
      impact: "medium",
      area: "performance",
    }),
  },
  {
    id: "og_tags",
    priority: "P2",
    test: ({ issuesByCode }) => issuesByCode.has("OG_MISSING"),
    build: ({ issuesByCode }) => ({
      title: "Bổ sung OpenGraph tags",
      reason: `${issuesByCode.get("OG_MISSING").length} trang thiếu OG — share lên social không có preview đẹp`,
      action: "Thêm og:title, og:description, og:image cho mọi trang. Dùng plugin SEO của CMS hoặc thêm vào theme head.",
      effort: "low",
      impact: "low",
      area: "on-page",
    }),
  },
  {
    id: "heading_hierarchy",
    priority: "P2",
    test: ({ issuesByCode }) => (issuesByCode.get("HEADING_HIERARCHY")?.length || 0) >= 3,
    build: ({ issuesByCode }) => ({
      title: "Sửa cấu trúc heading bị skip cấp",
      reason: `${issuesByCode.get("HEADING_HIERARCHY").length} trang có heading skip cấp (vd H2 → H4)`,
      action: "Heading phải tuần tự: H1 → H2 → H3, không nhảy cóc. Quan trọng cho accessibility + SEO semantic.",
      effort: "low",
      impact: "low",
      area: "content",
    }),
  },
];

export function generateActionPlan(input) {
  const { allIssues, pages, signalsByUrl, siteSignals } = input;

  const issuesByCode = new Map();
  for (const i of allIssues) {
    if (!issuesByCode.has(i.code)) issuesByCode.set(i.code, []);
    issuesByCode.get(i.code).push(i);
  }

  const ctx = { allIssues, issuesByCode, pages, signalsByUrl, siteSignals };
  const tasks = [];
  for (const rule of RULES) {
    try {
      if (rule.test(ctx)) {
        const task = rule.build(ctx);
        tasks.push({ id: rule.id, priority: rule.priority, ...task });
      }
    } catch {} // rule lỗi không làm hỏng plan
  }

  // Group by priority
  const grouped = { P0: [], P1: [], P2: [] };
  for (const t of tasks) grouped[t.priority]?.push(t);

  return {
    total: tasks.length,
    byPriority: grouped,
    summary: {
      P0: grouped.P0.length,
      P1: grouped.P1.length,
      P2: grouped.P2.length,
    },
  };
}

export function impactEstimate(allIssues) {
  // Rule-based impact estimate cho exec summary
  let trafficLossPct = 0;
  const counts = countBySeverity(allIssues);

  if (allIssues.find((i) => i.code === "META_NOINDEX")) trafficLossPct += 30;
  if (allIssues.find((i) => i.code === "NO_HTTPS")) trafficLossPct += 15;
  if (allIssues.find((i) => i.code === "LCP_SLOW" && i.severity === "critical")) trafficLossPct += 10;
  if (allIssues.find((i) => i.code === "CANONICAL_CROSS_DOMAIN")) trafficLossPct += 10;
  trafficLossPct += Math.min(15, counts.warning);
  trafficLossPct = Math.min(60, trafficLossPct);

  return {
    estimatedTrafficLossPct: trafficLossPct,
    severity: trafficLossPct >= 30 ? "high" : trafficLossPct >= 15 ? "medium" : "low",
  };
}

function countBySeverity(issues) {
  return {
    critical: issues.filter((i) => i.severity === "critical").length,
    warning: issues.filter((i) => i.severity === "warning").length,
    info: issues.filter((i) => i.severity === "info").length,
  };
}
