# Audit Pro Renderer

Renderer riêng cho Audit Pro. Input là `report.json`; output là deliverable đẹp để xem nội bộ hoặc gửi khách.

## Usage

```bash
node renderer/run.mjs \
  --input /path/to/report.json \
  --template consulting-v1 \
  --formats html,pdf,wp-html \
  --out /path/to/deliverables
```

## Templates

- `consulting-v1`: standalone HTML/PDF, phù hợp gửi khách.
- `wordpress-embed-v1`: HTML được scope CSS để nhúng WordPress page.

## Layout

Report được render theo thứ tự:

1. Cover + executive dashboard.
2. Risk cards màu theo severity/priority.
3. Priority action plan.
4. Issue overview.
5. Detailed findings ở phần dưới, gom theo severity/area/code.
6. GEO readiness, page detail, technical signals.

## Boundary

Renderer không crawl, không audit, không upload Drive. Nó chỉ đọc `report.json` và render output.
