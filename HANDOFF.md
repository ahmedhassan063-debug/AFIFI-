# AFIFI — Final Project Handoff

This document is the production handoff for the **AFIFI clothing brand** stack: a static HTML/CSS/JS storefront plus a separate **Laravel API backend** and **admin dashboard**.

---

## 1. Project overview

AFIFI is an e-commerce platform for a clothing brand with two codebases:

| Component | Location (this machine) | Purpose |
|-----------|-------------------------|---------|
| **Storefront** | `E:\Afifi clothing brand\` | Customer-facing site: catalog, product details, cart, wishlist, auth modal |
| **Admin dashboard** | Same folder: `admin.html`, `admin.css`, `admin.js` | Staff panel: products, orders, customers, settings, roles, coupons, inventory, messages, media |
| **Backend API** | `E:\AFIFI Back-End\afifi-backend\` | Laravel REST API: catalog, cart, checkout, orders, payments, admin endpoints |

**Architecture**

- Storefront and admin are **static frontends** (no build step). They talk to the API via `fetch` using a shared API client pattern.
- Auth uses **Laravel Sanctum** bearer tokens stored in `localStorage` (`afifiAuthToken`, `afifiUser`). A session started on the storefront works in the admin dashboard and vice versa.
- Admin access is gated by API permissions (not a separate login system). The admin shell loads only after `GET /api/admin/dashboard` succeeds (`reports.view` permission).
- Product images are served from the backend public disk: `{APP_URL}/storage/{path}`.

**Storefront pages**

- `index.html` — homepage
- `shop.html` — catalog with filters
- `product.html` — product details (`?id=slug`)
- `about.html`, `contact.html`, `support.html`
- `admin.html` — admin dashboard (not linked in public nav; `noindex`)

**Admin sections (sidebar)**

Dashboard · Products · Orders · Customers · Settings · Roles & Permissions · Coupons · Inventory · Messages · Media

---

## 2. Backend setup

**Requirements:** PHP 8.3+, Composer, SQLite (dev) or MySQL/PostgreSQL (production)

```bash
cd "E:\AFIFI Back-End\afifi-backend"

composer install
cp .env.example .env          # Windows: copy .env.example .env
php artisan key:generate
```

Configure `.env` (see §4), then:

```bash
php artisan migrate --seed
php artisan storage:link
php artisan serve
```

API base URL (local): `http://127.0.0.1:8000/api`

**Optional**

```bash
npm install && npm run build   # Laravel/Vite assets only
php artisan test               # 71 tests (see backend README)
```

**API docs**

- OpenAPI: `http://127.0.0.1:8000/docs/`
- Postman: `public/docs/postman_collection.json`

Full backend reference: `E:\AFIFI Back-End\afifi-backend\README.md`

---

## 3. Frontend setup

**Requirements:** A static file server or any web host. No Node/npm build for the storefront or admin.

### Local development (recommended)

1. Start the Laravel API (`php artisan serve` on port 8000).
2. Serve the frontend folder, e.g.:

   ```bash
   cd "E:\Afifi clothing brand"
   npx --yes serve .
   ```

   Or use VS Code Live Server / IIS / nginx pointing at the folder.

3. Open `http://localhost:<port>/index.html` (or the port `serve` prints).
4. Open `http://localhost:<port>/admin.html` after logging in as an admin user.

**API URL resolution (automatic)**

Both `brand.js` and `admin.js` use the same logic:

1. `window.AFIFI_API_BASE_URL` if set in HTML **before** the script loads (required for split/static deployments)
2. `http://127.0.0.1:8000/api` when hostname is `localhost`, `127.0.0.1`, or `file:`
3. Otherwise `{page-origin}/api` (same-origin deployment only)

**Production / GitHub Pages override**

Static hosts (e.g. `*.github.io`) have no Laravel API at `{origin}/api`. Set the real API URL on **every public HTML page** immediately before `brand.js`:

```html
<!--
  API base URL (production / split deployment only):
  Uncomment and set before brand.js when the Laravel API is NOT on the same origin as this site.
  Required for static hosts such as GitHub Pages. Local dev (localhost, 127.0.0.1, file://)
  automatically uses http://127.0.0.1:8000/api — do not set this override locally.
  Example:
  <script>window.AFIFI_API_BASE_URL = 'https://api.yourdomain.com/api';</script>
-->
<script>window.AFIFI_API_BASE_URL = 'https://api.yourdomain.com/api';</script>
<script src="brand.js?v=1.31"></script>
```

- Replace `https://api.yourdomain.com/api` with your deployed Laravel API base (must include `/api`).
- Do **not** hardcode a placeholder URL in the repo — each deployer sets their own.
- Configure CORS on Laravel when the storefront origin differs from the API origin.
- The same pattern applies to `admin.html` with `admin.js` if admin is hosted separately.

**Unreachable API errors**

When the browser cannot reach the API (network failure, static-host 404 HTML, or wrong base URL), the auth modal and other API surfaces show:

`Unable to connect to the server. Please try again later.`

Validation and permission errors from a live API still show their specific messages.

**Cache busting (current versions)**

| Asset | Storefront | Admin |
|-------|------------|-------|
| CSS | `brand.css?v=1.46` | `admin.css?v=1.12` |
| JS | `brand.js?v=1.36` | `admin.js?v=1.12` |

Bump `?v=` on any HTML reference after changing CSS/JS.

---

## 4. Required `.env` keys

### Core (required)

| Variable | Example / notes |
|----------|-----------------|
| `APP_NAME` | `AFIFI` |
| `APP_ENV` | `local` / `production` |
| `APP_KEY` | Generated by `php artisan key:generate` |
| `APP_DEBUG` | `true` (local), **`false` (production)** |
| `APP_URL` | `http://127.0.0.1:8000` — must match public URL for storage links |

### Database (required)

| Variable | Local example | Production |
|----------|---------------|------------|
| `DB_CONNECTION` | `sqlite` | `mysql` or `pgsql` |
| `DB_DATABASE` | `database/database.sqlite` | database name |
| `DB_HOST` | — | host |
| `DB_PORT` | — | `3306` / `5432` |
| `DB_USERNAME` | — | user |
| `DB_PASSWORD` | — | password |

### Storage & files

| Variable | Notes |
|----------|-------|
| `FILESYSTEM_DISK` | `local` (dev); `public` disk used for product media. Use S3 vars for cloud storage in production. |

### Seeded admin user (optional overrides)

| Variable | Default if unset |
|----------|----------------|
| `ADMIN_EMAIL` | `admin@afifi.local` |
| `ADMIN_PASSWORD` | `ChangeMe123!` |
| `ADMIN_NAME` | `AFIFI Admin` |
| `ADMIN_PHONE` | `01000000000` |

**Change `ADMIN_PASSWORD` in production** before running `db:seed`.

### Other (see `.env.example`)

`SESSION_DRIVER`, `QUEUE_CONNECTION`, `CACHE_STORE`, `MAIL_*`, `AWS_*` — configure for production as needed.

---

## 5. Database migration & seed commands

```bash
cd "E:\AFIFI Back-End\afifi-backend"

# First-time / upgrade
php artisan migrate

# Migrate + all seeders (roles, admin user, catalog, demo products, placeholder media, CMS, settings)
php artisan migrate --seed

# Re-seed without migrating
php artisan db:seed

# Full reset (destructive)
php artisan migrate:fresh --seed

# Production (no prompt)
php artisan migrate --force
```

**Seeder order** (`DatabaseSeeder`): roles/permissions → admin user → currencies/shipping/governorates → colors/sizes → brand/categories → settings/CMS → demo products → product media placeholders.

**Idempotent seeders:** `ProductMediaSeeder` and permission seeding use `firstOrCreate` / `syncPermissions` — safe to re-run.

---

## 6. Storage link command

Product and media URLs expect files under `storage/app/public/`, exposed at `/storage/...`:

```bash
php artisan storage:link
```

Creates `public/storage` → `storage/app/public`. Required for storefront and admin image previews. Re-run after deploy if the symlink is missing.

---

## 7. Admin login & roles

### How to log in

1. **Storefront:** Open any page with the auth modal (e.g. `index.html`), register or log in. Token is stored in `localStorage`.
2. **Admin:** Open `admin.html`. The auth gate calls `GET /api/auth/me` then `GET /api/admin/dashboard`. If the user has `reports.view`, the dashboard shell appears.
3. **API only:** `POST /api/auth/login` with `{ "email", "password" }` → use returned `token` as `Authorization: Bearer <token>`.

Default seeded admin (unless `.env` overrides):

- **Email:** `admin@afifi.local`
- **Password:** `ChangeMe123!`
- **Role:** `super_admin` (all permissions)

### Roles (seeded)

| Role | Typical use |
|------|-------------|
| `super_admin` | Full access |
| `catalog_manager` | Products + inventory |
| `fulfillment` | Inventory, orders, payments |
| `support` | Users (view), orders, payments, contact messages |
| `marketing` | Products (view), coupons, campaigns, CMS/media, reports |

Role permissions are defined in `database/seeders/RolesAndPermissionsSeeder.php`. Re-run seeder after adding new permissions in code.

**Note:** `/api/auth/me` does not return roles/permissions. Section-level 403 messages appear when a user lacks the permission for that area.

---

## 8. Permissions summary

| Permission | Admin area / action |
|------------|---------------------|
| `reports.view` | Dashboard (auth gate), analytics cards |
| `products.view` | Products list/detail, categories (read), variant picker |
| `products.create` | Add product, add variants |
| `products.update` | Edit product, toggle active, variant PATCH |
| `products.delete` | Delete product |
| `inventory.view` | Inventory movements list |
| `inventory.update` | Create stock adjustment |
| `orders.view` | Orders list, order detail |
| `orders.update` | Update order status |
| `users.view` | Customers list, customer detail |
| `settings.manage` | Settings form read/write |
| `roles.view` | Roles list, role detail, permissions list |
| `roles.manage` | Update role permissions (not `super_admin`) |
| `coupons.manage` | Coupons CRUD |
| `cms.manage` | Media library list/delete (metadata API) |
| `contact.view` | Contact messages list/detail |
| `contact.manage` | Message status update, delete |
| `payments.view` | Payment-related admin routes (fulfillment) |
| `payments.update` | Mark payments paid / update payment status |
| `payments.refund` | Create and process refunds |
| `campaigns.manage` | Campaign admin API (not in dashboard UI yet) |

`users.create` / `users.update` / `users.delete` exist in the seeder but customer mutation UI is not implemented in the admin dashboard.

---

## 9. Production deployment checklist

This is the final go-live checklist for AFIFI. **Documentation only** — follow these steps on your server/hosting; no code changes are required for deployment itself.

### 9.1 Pre-deploy requirements

| Component | Requirement |
|-----------|-------------|
| **Backend** | PHP 8.3+, Composer 2.x, MySQL 8+ or PostgreSQL 14+ (SQLite is dev/test only) |
| **Web server** | nginx or Apache with PHP-FPM; HTTPS termination |
| **Storefront** | Static host (GitHub Pages, Netlify, S3+CloudFront, nginx static, etc.) |
| **Admin** | Same static host as storefront, or separate origin with `AFIFI_API_BASE_URL` set |
| **DNS** | API subdomain (e.g. `api.example.com`), shop domain (e.g. `shop.example.com` or `www.example.com`) |

### 9.2 Backend deployment steps

**1. Deploy code**

```bash
cd /var/www/afifi-backend   # your deploy path
git pull origin main          # or upload release artifact
```

**2. Install production dependencies**

```bash
composer install --no-dev --optimize-autoloader
```

**3. Environment file (first deploy)**

```bash
cp .env.example .env
php artisan key:generate      # first deploy only; skip if APP_KEY already set
```

Edit `.env` with production values (see §9.4 and §4).

**4. Database**

```bash
# First production deploy (full reference data + demo catalog)
php artisan migrate --force
php artisan db:seed --force

# OR upgrade deploy (schema only)
php artisan migrate --force

# Re-sync roles/permissions after code updates that add new permissions
php artisan db:seed --class=RolesAndPermissionsSeeder --force
php artisan permission:cache-reset
```

**5. Storage**

```bash
php artisan storage:link
```

Ensure `storage/` and `bootstrap/cache/` are writable by the web server user.

**6. Optimize Laravel (run after every backend deploy)**

```bash
php artisan config:clear      # required before caching when config files changed
php artisan config:cache
php artisan route:cache
php artisan view:cache
```

**7. Process managers**

```bash
# If QUEUE_CONNECTION=database (default in .env.example)
php artisan queue:work --sleep=3 --tries=3 --max-time=3600
# Run under systemd/supervisor in production

# Reload PHP after deploy
sudo systemctl reload php8.3-fpm   # adjust version/service name
```

**8. Health check**

```bash
curl -f https://api.yourdomain.com/up
```

### 9.3 Frontend deployment steps

**1. Prepare API URL**

For **split hosting** (storefront on GitHub Pages / CDN, API on separate subdomain), set the real API base on **every** HTML page that loads `brand.js`, immediately before the script tag:

```html
<script>window.AFIFI_API_BASE_URL = 'https://api.yourdomain.com/api';</script>
<script src="brand.js?v=1.36"></script>
```

Pages to update:

- `index.html`, `shop.html`, `product.html`, `about.html`, `contact.html`, `support.html`
- `profile.html`, `orders.html`, `order.html` (if used)

For **admin** on a separate origin, add the same line before `admin.js` in `admin.html`:

```html
<script>window.AFIFI_API_BASE_URL = 'https://api.yourdomain.com/api';</script>
<script src="admin.js?v=1.12"></script>
```

For **same-origin** deployment (`example.com` serves static files and reverse-proxies `/api` to Laravel), no override is needed — `brand.js` / `admin.js` resolve `{origin}/api` automatically.

**2. Deploy static assets**

Upload the full storefront folder:

```
index.html, shop.html, product.html, about.html, contact.html, support.html
profile.html, orders.html, order.html
brand.css, brand.js
admin.html, admin.css, admin.js
images/
favicon.ico
```

**3. GitHub Pages**

- Enable Pages on the repo (branch `main` / root, or `gh-pages` branch).
- Optional custom domain + HTTPS in repo Settings → Pages.
- Set `window.AFIFI_API_BASE_URL` before deploy (step 1) — GitHub Pages cannot run PHP/Laravel.
- Do **not** commit production API URLs if they differ per environment; set at deploy time via CI/CD env substitution or a release script.

**4. Post-upload**

- Confirm HTTPS on the storefront URL.
- Bump `?v=` on CSS/JS references after any asset change.
- Verify `admin.html` stays `noindex` (already set).

### 9.4 Required `.env` variables (production)

#### Core (required)

| Variable | Production value |
|----------|------------------|
| `APP_NAME` | `AFIFI` |
| `APP_ENV` | `production` |
| `APP_KEY` | Base64 key from `php artisan key:generate` |
| `APP_DEBUG` | **`false`** |
| `APP_URL` | `https://api.yourdomain.com` (must match public API URL for storage links) |

#### Database (required)

| Variable | Example |
|----------|---------|
| `DB_CONNECTION` | `mysql` or `pgsql` |
| `DB_HOST` | DB server hostname |
| `DB_PORT` | `3306` / `5432` |
| `DB_DATABASE` | `afifi_production` |
| `DB_USERNAME` | dedicated DB user |
| `DB_PASSWORD` | strong password |

#### Session, cache, queue

| Variable | Production recommendation |
|----------|---------------------------|
| `SESSION_DRIVER` | `database` or `redis` |
| `CACHE_STORE` | `redis` or `database` (not `file` on multi-node) |
| `QUEUE_CONNECTION` | `database` or `redis` (not `sync` if using workers) |

#### Storage & media

| Variable | Notes |
|----------|-------|
| `FILESYSTEM_DISK` | `local` with persistent disk, or `s3` with AWS vars below |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION`, `AWS_BUCKET` | Required for S3 media |
| `MEDIA_MAX_SIZE_BYTES` | Optional; default 10 MB (`config/media.php`) |

#### Admin seed overrides (set before first seed)

| Variable | Notes |
|----------|-------|
| `ADMIN_EMAIL` | Production admin login email |
| `ADMIN_PASSWORD` | **Strong password** — never use `ChangeMe123!` |
| `ADMIN_NAME` | Display name |
| `ADMIN_PHONE` | Unique phone key for `AdminUserSeeder` |

#### CORS / Sanctum (split frontend + API)

| Variable | Notes |
|----------|-------|
| `SANCTUM_STATEFUL_DOMAINS` | Comma-separated storefront/admin origins if using cookie-based SPA auth later (e.g. `shop.example.com,admin.example.com`) |
| `SESSION_DOMAIN` | Leading-dot cookie domain if using stateful Sanctum across subdomains (e.g. `.example.com`) |

**Bearer-token auth (current storefront/admin):** Tokens are sent via `Authorization: Bearer <token>` from `localStorage`. CORS is the primary cross-origin requirement; publish and tighten `config/cors.php` (see §9.5).

#### Mail (optional but recommended)

| Variable | Notes |
|----------|-------|
| `MAIL_MAILER`, `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD` | Transactional mail |
| `MAIL_FROM_ADDRESS`, `MAIL_FROM_NAME` | From header |

### 9.5 CORS & Sanctum (split hosting)

The storefront and admin use **Sanctum API tokens** in `localStorage` (`afifiAuthToken`), not cookie sessions. For split deployment:

**1. Publish CORS config (recommended for production)**

```bash
php artisan config:publish cors
```

Edit `config/cors.php`:

```php
'paths' => ['api/*', 'sanctum/csrf-cookie'],
'allowed_methods' => ['*'],
'allowed_origins' => [
    'https://shop.yourdomain.com',
    'https://www.yourdomain.com',
    'https://youruser.github.io',   // if using GitHub Pages
],
'allowed_headers' => ['*'],
'supports_credentials' => false,     // bearer tokens; keep false
```

Then `php artisan config:clear && php artisan config:cache`.

**Default:** Laravel ships with `allowed_origins => ['*']` — acceptable for bearer-token APIs, but restrict origins in production when possible.

**2. Sanctum stateful domains**

Only required if you later enable cookie/CSRF SPA mode (`EnsureFrontendRequestsAreStateful`). For current token auth, optional:

```env
SANCTUM_STATEFUL_DOMAINS=shop.yourdomain.com,www.yourdomain.com,localhost,127.0.0.1
```

**3. Reverse proxy (same domain)**

If nginx serves `https://example.com` (static) and proxies `https://example.com/api` → Laravel:

- Set `APP_URL=https://example.com`
- Trust proxies in Laravel (`TrustProxies` middleware / `APP_URL`)
- No CORS needed (same origin)
- No `AFIFI_API_BASE_URL` override on frontend

### 9.6 Admin login setup

1. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env` **before** first seed.
2. Run `php artisan db:seed --class=AdminUserSeeder --force` (or full `db:seed`).
3. Open `admin.html` on the storefront host.
4. Log in via the storefront auth modal (`index.html`) **or** API `POST /api/auth/login`.
5. Admin gate checks `GET /api/auth/me` then `GET /api/admin/dashboard` (`reports.view`).
6. Default role: `super_admin`. Assign other roles via database or future user-management UI.

**Re-seed permissions after backend updates:**

```bash
php artisan db:seed --class=RolesAndPermissionsSeeder --force
php artisan permission:cache-reset
```

### 9.7 Media & storage notes

- Product/media URLs: `{APP_URL}/storage/{path}` (requires `php artisan storage:link`).
- Media admin API registers **metadata only** — upload files to `storage/app/public/` (or S3) separately; paths must match registered metadata.
- Allowed MIME types and max size: `config/media.php` (images + mp4/webm; 10 MB default).
- Soft-delete removes DB record and deletes the physical file when present on `public`/`local` disk.
- After deploy, verify: `GET /api/catalog/products` returns image URLs that load in the browser.

### 9.8 Security checklist

- [ ] `APP_DEBUG=false`, `APP_ENV=production`
- [ ] Unique `APP_KEY`; never commit `.env`
- [ ] Strong `ADMIN_PASSWORD`; change from default before seed
- [ ] HTTPS on API and storefront
- [ ] CORS `allowed_origins` restricted to known storefront/admin domains
- [ ] Database user has least privilege (not root)
- [ ] `storage/` and `.env` not web-accessible
- [ ] Rate limits active: `auth-public` 10/min, `auth-sensitive` 5/min (production)
- [ ] `admin.html` not linked in public nav; consider IP allowlist or HTTP auth on admin path
- [ ] Run `php artisan test` on CI before deploy (71 tests)
- [ ] Backups: automated DB dumps + `storage/app/public` (or S3 versioning)

### 9.9 Post-deploy smoke tests

**API (curl or Postman)**

```bash
curl -s https://api.yourdomain.com/up
curl -s https://api.yourdomain.com/api/settings/public
curl -s https://api.yourdomain.com/api/catalog/products
curl -s https://api.yourdomain.com/api/campaigns/active
curl -s https://api.yourdomain.com/api/cms/homepage
```

**Auth**

```bash
curl -s -X POST https://api.yourdomain.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"YOUR_ADMIN_EMAIL","password":"YOUR_ADMIN_PASSWORD"}'
```

**Browser**

- [ ] Storefront homepage loads products and images
- [ ] Shop filters and product detail work
- [ ] Register / login stores token; cart syncs when logged in
- [ ] `admin.html` shows dashboard for `super_admin`
- [ ] One product list, one order view, one settings read in admin
- [ ] Media URL opens in new tab from admin Media section
- [ ] Split-host: no CORS errors in browser DevTools Network tab

### 9.10 Rollback plan

**Application rollback (code)**

1. Redeploy previous release tag/commit.
2. Clear caches:

```bash
php artisan config:clear
php artisan route:clear
php artisan view:clear
php artisan permission:cache-reset
```

3. Re-optimize if staying on rolled-back release:

```bash
php artisan config:cache
php artisan route:cache
php artisan view:cache
```

4. Reload PHP-FPM / restart queue workers.

**Database rollback**

- If the failed deploy ran migrations: restore from pre-deploy DB backup (preferred), or `php artisan migrate:rollback --force` only if the migration is reversible and no destructive data changes occurred.
- Do **not** rollback permission seeders on live data without a backup — `syncPermissions` may change role assignments.

**Frontend rollback**

- Revert static files to previous release (HTML/CSS/JS).
- Restore previous `AFIFI_API_BASE_URL` if it changed.
- Bump or restore `?v=` cache-bust strings to match rolled-back assets.

**Storage rollback**

- Media file deletes are not automatic on app rollback. Restore `storage/app/public` from backup if files were removed during the failed release.

**Incident checklist**

| Step | Action |
|------|--------|
| 1 | Put site in maintenance (`php artisan down` on API if needed) |
| 2 | Restore last known-good backend + frontend artifacts |
| 3 | Restore database backup if schema/data changed |
| 4 | `config:clear`, `route:clear`, `view:clear`, `permission:cache-reset` |
| 5 | Smoke test §9.9 |
| 6 | `php artisan up` |

### 9.11 Quick checklist summary

**Backend**

- [ ] `composer install --no-dev --optimize-autoloader`
- [ ] `.env` production values (`APP_DEBUG=false`, MySQL/PostgreSQL, `APP_URL`)
- [ ] `php artisan key:generate` (first deploy)
- [ ] `php artisan migrate --force`
- [ ] `php artisan db:seed --class=RolesAndPermissionsSeeder --force`
- [ ] `php artisan permission:cache-reset`
- [ ] `php artisan storage:link`
- [ ] `php artisan config:clear && config:cache && route:cache && view:cache`
- [ ] Queue worker running (if not `sync`)
- [ ] CORS origins configured
- [ ] HTTPS + `/up` health check

**Frontend**

- [ ] Deploy all HTML, CSS, JS, `images/`
- [ ] Set `window.AFIFI_API_BASE_URL` on split/static hosts
- [ ] HTTPS enabled
- [ ] Cache-bust `?v=` bumped after asset changes

---

## 10. Final QA checklist

### Auth & session

- [ ] Logged-out user redirected from admin gate
- [ ] User without `reports.view` sees “no admin access” on `admin.html`
- [ ] Expired token: any admin API call redirects to `index.html` (401 handler)
- [ ] Logout clears session and returns to storefront

### Storefront

- [ ] Homepage and shop load products from API
- [ ] Product page `?id=slug` loads variants, cart, wishlist
- [ ] Cart: guest `localStorage`; logged-in user syncs with API
- [ ] Auth modal opens/closes; register + login work
- [ ] WhatsApp button and mobile menu work
- [ ] Contact/newsletter forms show demo-only notes (not wired to API)

### Admin — all sections

- [ ] Each sidebar section: loading → data or empty state
- [ ] 403 message when permission missing
- [ ] Retry on error where implemented
- [ ] Modals: open, close (X / Cancel / overlay / Escape), no stuck submit state

### Admin — mutations (as `super_admin`)

- [ ] Product create/edit, toggle active, delete
- [ ] Order detail + status update (valid transitions only)
- [ ] Customer detail (read-only actions disabled as documented)
- [ ] Settings save (per-key PUT)
- [ ] Role permissions save (non–`super_admin` roles)
- [ ] Coupon create/edit/toggle/delete
- [ ] Inventory adjustment (delta, audit row)
- [ ] Message status + delete
- [ ] Media open URL, copy URL, soft delete

### Backend

- [ ] `php artisan test` passes (71 tests)
- [ ] GitHub Actions test workflow green on push/PR

---

## 11. Known intentional limitations

Do **not** treat these as bugs without an explicit product decision to implement them.

| Limitation | Details |
|------------|---------|
| **Media upload not implemented** | `POST /api/admin/media` accepts JSON metadata only. No multipart upload. Admin Media section lists/deletes/copies URLs; files must exist under `storage/app/public/` or be seeded. |
| **User role assignment disabled** | Admin UI shows users per role but cannot assign/remove roles on users. API endpoints for user role management are not exposed in the dashboard. |
| **Product color/size list endpoints not implemented** | Product form uses numeric Color ID / Size ID inputs. No admin dropdown from `/api/admin/colors` or `/api/admin/sizes`. |
| **Storefront files frozen** | `brand.html/css/js` and public pages should only change for confirmed bug fixes—not feature work without approval. |
| **Contact form not connected** | `contact.html` form is demo-only. Backend has `ContactMessage` model and admin Messages UI; no public `POST` contact endpoint wired to storefront. |
| **Checkout on storefront** | Cart checkout uses WhatsApp message flow, not `POST /api/checkout` from the static site. |
| **Newsletter demo-only** | `index.html` newsletter is not connected to backend. |
| **Customer account mutations** | Edit/disable/delete customer buttons are placeholders in admin. |
| **Shipment tracking in admin** | Order detail shows shipment block read-only; no update UI. |
| **Payment status in admin** | Read-only; derived from payments/refunds. |
| **Image upload in product form** | Product images are read-only in edit modal; upload not available. |
| **Archive for contact messages** | Delete is hard delete; no archive status. |
| **Physical file on media delete** | Soft-delete removes DB record and deletes the file from `public`/`local` disk when present. Orphan/missing files do not crash delete. |

---

## 12. Repository layout reference

```
E:\Afifi clothing brand\          # Storefront + admin (this repo)
  index.html, shop.html, product.html, ...
  brand.css, brand.js
  admin.html, admin.css, admin.js
  images/
  HANDOFF.md                      # This file

E:\AFIFI Back-End\afifi-backend\  # Laravel API (separate repo/folder)
  app/, routes/, database/
  public/docs/                    # OpenAPI + Postman
  README.md                       # Backend-focused documentation
```

---

## 13. Support contacts & next steps

For backend internals (services, policies, tests), use `afifi-backend/README.md` and `public/docs/openapi.yaml`.

**Suggested post-handoff work** (out of scope for this handoff):

- Multipart media upload endpoint + admin upload UI
- Public contact form API + storefront integration
- Color/size admin list endpoints + product form dropdowns
- User role assignment UI
- Full checkout integration on storefront

---

*Document version: handoff v2 — production deployment checklist. Storefront `brand v=1.46/1.36`, admin `v=1.12`.*
