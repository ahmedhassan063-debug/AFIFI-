# AFIFI Clothing Brand — Frontend & Admin

Static storefront and admin dashboard for the AFIFI clothing brand, integrated with the Laravel API backend.

**→ Full handoff, setup, deployment, and QA:** see [HANDOFF.md](./HANDOFF.md)

## Quick start

1. Start the backend: `E:\AFIFI Back-End\afifi-backend` → `php artisan serve`
2. Serve this folder with any static server (e.g. `npx serve .`)
3. Open `index.html` (storefront) or `admin.html` (after logging in as admin)

Backend API docs: `E:\AFIFI Back-End\afifi-backend\README.md`

## Production deployment

See [HANDOFF.md §9](./HANDOFF.md) for the complete checklist. Summary:

### 1. Set API base URL (split / static hosting)

GitHub Pages, Netlify, and CDNs do not run Laravel. Before `brand.js` on **each** public HTML page:

```html
<script>window.AFIFI_API_BASE_URL = 'https://api.yourdomain.com/api';</script>
<script src="brand.js?v=1.36"></script>
```

Same for `admin.html` before `admin.js` if admin is on a separate origin.

| Deployment model | `AFIFI_API_BASE_URL` |
|------------------|----------------------|
| Same domain (`example.com` + `/api` proxied to Laravel) | Not required |
| Split (`shop.example.com` + `api.example.com`) | **Required** on all HTML pages |
| GitHub Pages (`*.github.io`) | **Required** |

Local dev (`localhost`, `127.0.0.1`) auto-targets `http://127.0.0.1:8000/api` — do not set the override locally.

### 2. Deploy files

Upload: all `*.html`, `brand.css`, `brand.js`, `admin.css`, `admin.js`, `images/`, `favicon.ico`.

Current cache versions: `brand.css?v=1.46`, `brand.js?v=1.36`, `admin.css?v=1.12`, `admin.js?v=1.12`.

### 3. GitHub Pages

1. Enable Pages (Settings → Pages → branch `main` / root).
2. Set `AFIFI_API_BASE_URL` to your production API before publishing.
3. Configure CORS on the Laravel API to allow your `*.github.io` or custom domain origin.
4. Use HTTPS (enforced by GitHub Pages for `github.io` subdomains).

### 4. Admin access

1. Seed admin on backend with `ADMIN_EMAIL` / `ADMIN_PASSWORD` (see backend README).
2. Log in via storefront auth modal or API login.
3. Open `admin.html` — requires `reports.view` permission (`super_admin` by default).
4. Keep `admin.html` unlinked from public nav (`noindex` is already set).

### 5. Post-deploy smoke tests

- [ ] Homepage and shop load products from API
- [ ] Product images load (`/storage/...` URLs from API)
- [ ] Login/register works; no CORS errors in DevTools
- [ ] `admin.html` dashboard loads for admin user
- [ ] Cart and wishlist work (guest + logged-in)

### 6. Rollback

Revert HTML/CSS/JS to the previous release. Restore prior `AFIFI_API_BASE_URL` if changed. Bump `?v=` to match rolled-back assets.

---

**Backend deploy commands, `.env`, CORS/Sanctum, database, rollback:** [HANDOFF.md §9](./HANDOFF.md)
