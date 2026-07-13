// ==========================================================================
// AFIFI ADMIN DASHBOARD
// Part 1: shell, auth guard, dashboard overview
// Part 2: Products management (list/read/manage - no create/edit yet)
//
// Deliberately self-contained and NOT loaded together with brand.js:
// brand.js injects storefront-only UI (cart drawer, wishlist widgets,
// WhatsApp button, customer auth modal) directly into <body> on every page
// that loads it, which does not belong in the admin dashboard. Instead,
// this file reuses the exact same localStorage keys and API base URL
// resolution strategy as brand.js so a session started on the storefront
// (or vice versa) carries over automatically without duplicating a login
// screen.
// ==========================================================================

const ADMIN_AUTH_TOKEN_KEY = 'afifiAuthToken'; // must match AUTH_TOKEN_KEY in brand.js
const ADMIN_USER_KEY = 'afifiUser'; // must match AUTH_USER_KEY in brand.js

function adminResolveApiBaseUrl() {
    if (window.AFIFI_API_BASE_URL) {
        return String(window.AFIFI_API_BASE_URL).replace(/\/+$/, '');
    }

    const { protocol, hostname } = window.location;
    const isLocalHost = protocol === 'file:' || hostname === 'localhost' || hostname === '127.0.0.1';

    if (isLocalHost) return 'https://afifi-backend-production.up.railway.app/api';

    return 'https://afifi-backend-production.up.railway.app/api';
}

const ADMIN_API_BASE_URL = adminResolveApiBaseUrl();

function adminGetToken() {
    return localStorage.getItem(ADMIN_AUTH_TOKEN_KEY);
}

function adminStoreUser(user) {
    localStorage.setItem(ADMIN_USER_KEY, JSON.stringify(user || null));
}

function adminClearSession() {
    localStorage.removeItem(ADMIN_AUTH_TOKEN_KEY);
    localStorage.removeItem(ADMIN_USER_KEY);
}

class AdminApiError extends Error {
    constructor(message, status, errors) {
        super(message);
        this.name = 'AdminApiError';
        this.status = status;
        this.errors = errors || null;
    }
}

async function adminApiRequest(endpoint, options = {}) {
    const { body, headers, ...rest } = options;
    const hasBody = body !== undefined && body !== null;

    const finalHeaders = { Accept: 'application/json', ...headers };
    if (hasBody) finalHeaders['Content-Type'] = 'application/json';

    const token = adminGetToken();
    if (token) finalHeaders.Authorization = `Bearer ${token}`;

    const fetchOptions = { ...rest, headers: finalHeaders };
    if (hasBody) fetchOptions.body = JSON.stringify(body);

    let response;
    try {
        response = await fetch(`${ADMIN_API_BASE_URL}${endpoint}`, fetchOptions);
    } catch (networkError) {
        throw new AdminApiError('Network error: could not reach the server.', 0);
    }

    let data = null;
    try {
        data = await response.json();
    } catch (parseError) {
        data = null;
    }

    if (!response.ok) {
        if (response.status === 401) {
            adminClearSession();
            window.location.href = 'index.html';
            throw new AdminApiError('Your session has expired.', 401);
        }

        let message = (data && data.message) || 'Request failed.';
        if (data && data.errors && typeof data.errors === 'object') {
            const details = Object.values(data.errors).flat().filter(Boolean);
            if (details.length > 0) message = details.join(' ');
        }
        throw new AdminApiError(message, response.status, data && data.errors);
    }

    return data;
}

// ========== DOM REFERENCES ==========
const adminGate = document.getElementById('adminAuthGate');
const adminGateMessage = document.getElementById('adminGateMessage');
const adminGateActions = document.getElementById('adminGateActions');
const adminGateRetryBtn = document.getElementById('adminGateRetryBtn');
const adminGateHomeLink = document.getElementById('adminGateHomeLink');
const adminShell = document.getElementById('adminShell');
const adminUserName = document.getElementById('adminUserName');
const adminUserRole = document.getElementById('adminUserRole');
const adminLogoutBtn = document.getElementById('adminLogoutBtn');
const adminMenuToggle = document.getElementById('adminMenuToggle');
const adminSidebar = document.getElementById('adminSidebar');
const adminSidebarBackdrop = document.getElementById('adminSidebarBackdrop');
const adminPageTitle = document.getElementById('adminPageTitle');

// ========== AUTH GATE UI HELPERS ==========
function setGateState(state, message, options = {}) {
    if (adminGate) adminGate.setAttribute('data-state', state);
    if (adminGateMessage) adminGateMessage.textContent = message;

    const showRetry = Boolean(options.showRetry);
    const showHome = Boolean(options.showHome);
    if (adminGateActions) adminGateActions.hidden = !(showRetry || showHome);
    if (adminGateRetryBtn) adminGateRetryBtn.hidden = !showRetry;
    if (adminGateHomeLink) adminGateHomeLink.hidden = !showHome;
}

function redirectHome(delayMs = 1200) {
    setTimeout(() => {
        window.location.href = 'index.html';
    }, delayMs);
}

function revealDashboard() {
    if (adminGate) adminGate.hidden = true;
    if (adminShell) adminShell.hidden = false;
}

function renderUserInfo(user) {
    if (!user) return;
    if (adminUserName) adminUserName.textContent = user.name || user.email || user.phone || 'Admin';
    // The backend does not yet expose roles/permissions on /auth/me (see
    // TODO in initAdminAuth). We only know the user passed the
    // /admin/dashboard permission check, so we label them generically.
    if (adminUserRole) adminUserRole.textContent = 'Admin Access';
}

function setCardValue(id, value, options = {}) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('is-loading', 'is-error');
    if (value === undefined || value === null) {
        el.textContent = options.emptyText || '—';
        el.classList.add('is-error');
        return;
    }
    el.textContent = Number(value).toLocaleString();
}

function formatDashboardMoney(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return `${num.toLocaleString()} EGP`;
}

// Recent orders/low stock rely on renderOrderStatusPill/renderPaymentStatusPill/
// adminFormatPrice/formatCustomerDate defined later in the file (Parts 4/5) -
// safe because these are only ever invoked at runtime, after the whole
// script (and its hoisted function declarations) has loaded.
function renderDashboardRecentOrders(orders) {
    const container = document.getElementById('dashboardRecentOrders');
    if (!container) return;
    const list = Array.isArray(orders) ? orders : [];

    if (list.length === 0) {
        container.innerHTML = '<p class="admin-table-muted">No orders yet.</p>';
        return;
    }

    container.innerHTML = `
        <div class="admin-table-wrap">
            <table class="admin-table">
                <thead>
                    <tr><th>Order #</th><th>Customer</th><th>Date</th><th>Total</th><th>Payment</th><th>Status</th></tr>
                </thead>
                <tbody>
                    ${list.map(order => `
                        <tr>
                            <td>${adminEscapeHtml(order.order_number || `#${order.id}`)}</td>
                            <td>${adminEscapeHtml(order.customer_name || '—')}</td>
                            <td>${formatCustomerDate(order.created_at)}</td>
                            <td>${adminFormatPrice(order.grand_total)}</td>
                            <td>${renderPaymentStatusPill(order.payment_status)}</td>
                            <td>${renderOrderStatusPill(order.status)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderDashboardLowStock(variants) {
    const container = document.getElementById('dashboardLowStockList');
    if (!container) return;
    const list = Array.isArray(variants) ? variants : [];

    if (list.length === 0) {
        container.innerHTML = '<p class="admin-table-muted">No low stock variants right now.</p>';
        return;
    }

    container.innerHTML = `
        <div class="admin-table-wrap">
            <table class="admin-table">
                <thead>
                    <tr><th>Product</th><th>SKU</th><th>Stock</th></tr>
                </thead>
                <tbody>
                    ${list.map(variant => `
                        <tr>
                            <td>${adminEscapeHtml(variant.product && variant.product.name ? variant.product.name : '—')}</td>
                            <td>${adminEscapeHtml(variant.sku || '—')}</td>
                            <td>${adminEscapeHtml(String(variant.stock != null ? variant.stock : '—'))}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderDashboardStats(stats) {
    const data = stats || {};
    // Snapshot counters (current state, not date-scoped).
    setCardValue('cardProducts', data.active_products_count);
    setCardValue('cardCustomers', data.users_count);
    setCardValue('cardLowStock', data.low_stock_variants_count);
    setCardValue('cardPendingReturns', data.pending_returns_count);
    setCardValue('cardNewMessages', data.new_contact_messages_count);
    // Activity counters (respect the selected date range, if any).
    setCardValue('cardOrders', data.pending_orders_count);
    setCardValue('cardUnpaidOrders', data.unpaid_orders_count);

    const revenueEl = document.getElementById('cardRevenue');
    if (revenueEl) {
        revenueEl.classList.remove('is-loading', 'is-error');
        const formatted = data.revenue ? formatDashboardMoney(data.revenue.net) : null;
        if (formatted) {
            revenueEl.textContent = formatted;
        } else {
            revenueEl.textContent = 'N/A';
            revenueEl.classList.add('is-error');
        }
    }

    renderDashboardRecentOrders(data.recent_orders);
    renderDashboardLowStock(data.low_stock_variants);
}

// Used by the date-range filter to refresh dashboard data in place, without
// re-running the full auth gate (initAdminAuth already handles the initial,
// unfiltered load as part of the permission check).
async function reloadDashboardStats(from, to) {
    const dashboardErrorEl = document.getElementById('dashboardError');
    if (dashboardErrorEl) dashboardErrorEl.hidden = true;

    document.querySelectorAll('#section-dashboard .admin-card-value').forEach(el => {
        el.classList.add('is-loading');
        el.classList.remove('is-error');
        el.textContent = 'Loading…';
    });

    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const query = params.toString();

    try {
        const stats = await adminApiRequest(`/admin/dashboard${query ? `?${query}` : ''}`);
        renderDashboardStats(stats);
    } catch (error) {
        const isForbidden = error && error.status === 403;
        if (dashboardErrorEl) {
            dashboardErrorEl.textContent = isForbidden
                ? 'You do not have permission to view reports.'
                : (error && error.message ? error.message : 'Could not load dashboard data. Please try again.');
            dashboardErrorEl.hidden = false;
        }
        document.querySelectorAll('#section-dashboard .admin-card-value').forEach(el => {
            el.classList.remove('is-loading');
            el.classList.add('is-error');
            el.textContent = '—';
        });
    }
}

const dashboardFromDateInput = document.getElementById('dashboardFromDate');
const dashboardToDateInput = document.getElementById('dashboardToDate');
const dashboardApplyRangeBtn = document.getElementById('dashboardApplyRangeBtn');
const dashboardResetRangeBtn = document.getElementById('dashboardResetRangeBtn');

if (dashboardApplyRangeBtn) {
    dashboardApplyRangeBtn.addEventListener('click', () => {
        const from = dashboardFromDateInput && dashboardFromDateInput.value ? dashboardFromDateInput.value : null;
        const to = dashboardToDateInput && dashboardToDateInput.value ? dashboardToDateInput.value : null;
        reloadDashboardStats(from, to);
    });
}

if (dashboardResetRangeBtn) {
    dashboardResetRangeBtn.addEventListener('click', () => {
        if (dashboardFromDateInput) dashboardFromDateInput.value = '';
        if (dashboardToDateInput) dashboardToDateInput.value = '';
        reloadDashboardStats(null, null);
    });
}

const dashboardReturnsCard = document.querySelector('[data-card="returns"]');
if (dashboardReturnsCard) {
    dashboardReturnsCard.classList.add('admin-card-link');
    dashboardReturnsCard.setAttribute('role', 'button');
    dashboardReturnsCard.setAttribute('tabindex', '0');
    dashboardReturnsCard.setAttribute('aria-label', 'View orders to manage return requests');
    const goToOrders = () => switchAdminSection('orders');
    dashboardReturnsCard.addEventListener('click', goToOrders);
    dashboardReturnsCard.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            goToOrders();
        }
    });
}

// ========== AUTH GUARD ==========
async function initAdminAuth() {
    const token = adminGetToken();

    if (!token) {
        setGateState('unauthenticated', 'Please log in to access the admin dashboard. Redirecting…');
        redirectHome();
        return;
    }

    let user = null;
    try {
        const meResponse = await adminApiRequest('/auth/me');
        user = meResponse && meResponse.user;
        adminStoreUser(user);
    } catch (error) {
        if (error.status === 401) {
            adminClearSession();
            setGateState('unauthenticated', 'Your session has expired. Redirecting to login…');
            redirectHome();
            return;
        }
        setGateState('error', 'Could not verify your session. Please check your connection and try again.', { showRetry: true });
        return;
    }

    // GET /admin/dashboard requires the `reports.view` permission, so this
    // call doubles as both the admin-access gate and the overview stats
    // source. The backend does not currently expose roles/permissions on
    // /auth/me, so there is no separate "is this user an admin" endpoint to
    // check first.
    // TODO(backend): expose roles/permissions on /auth/me (or add a
    // dedicated endpoint) so future admin sections can be gated per
    // permission instead of relying on the dashboard endpoint alone.
    try {
        const stats = await adminApiRequest('/admin/dashboard');
        renderUserInfo(user);
        renderDashboardStats(stats);
        revealDashboard();
    } catch (error) {
        if (error.status === 401) {
            adminClearSession();
            setGateState('unauthenticated', 'Your session has expired. Redirecting to login…');
            redirectHome();
            return;
        }
        if (error.status === 403) {
            setGateState('error', 'You are logged in, but this account does not have admin access.', { showHome: true });
            return;
        }
        setGateState('error', 'Could not load the dashboard. Please try again.', { showRetry: true });
    }
}

if (adminGateRetryBtn) {
    adminGateRetryBtn.addEventListener('click', () => {
        setGateState('checking', 'Checking access…');
        initAdminAuth();
    });
}

// ========== LOGOUT ==========
// Mirrors the storefront's handleLogout() behavior (brand.js): call the
// logout endpoint, then clear local session state regardless of the API
// result so the user is never stuck "logged in" locally after a failure.
async function handleAdminLogout() {
    if (!adminLogoutBtn) return;
    adminLogoutBtn.disabled = true;
    adminLogoutBtn.textContent = 'Logging out…';

    try {
        await adminApiRequest('/auth/logout', { method: 'POST' });
    } catch (error) {
        console.warn('AFIFI Admin: logout request failed, clearing local session anyway.', error);
    }

    adminClearSession();
    window.location.href = 'index.html';
}

if (adminLogoutBtn) {
    adminLogoutBtn.addEventListener('click', handleAdminLogout);
}

// ========== SIDEBAR (mobile) ==========
function toggleSidebar(forceOpen) {
    if (!adminSidebar) return;
    const isOpen = typeof forceOpen === 'boolean' ? forceOpen : !adminSidebar.classList.contains('admin-sidebar-open');
    adminSidebar.classList.toggle('admin-sidebar-open', isOpen);
    if (adminSidebarBackdrop) adminSidebarBackdrop.classList.toggle('show', isOpen);
    if (adminMenuToggle) adminMenuToggle.setAttribute('aria-expanded', String(isOpen));
}

if (adminMenuToggle) {
    adminMenuToggle.addEventListener('click', () => toggleSidebar());
}

if (adminSidebarBackdrop) {
    adminSidebarBackdrop.addEventListener('click', () => toggleSidebar(false));
}

// ========== SECTION NAVIGATION ==========
// Part 2 adds the Products management view; Orders/Customers/Settings
// still render the "coming soon" placeholder already in the HTML.
const ADMIN_SECTION_TITLES = {
    dashboard: 'Dashboard',
    products: 'Products',
    orders: 'Orders',
    customers: 'Customers',
    settings: 'Settings',
    roles: 'Roles & Permissions',
    coupons: 'Coupons',
    inventory: 'Inventory',
    messages: 'Messages',
    media: 'Media'
};

function switchAdminSection(sectionKey) {
    document.querySelectorAll('.admin-nav-link[data-section]').forEach(link => {
        const isActive = link.dataset.section === sectionKey;
        link.classList.toggle('active', isActive);
        if (isActive) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
    });

    document.querySelectorAll('.admin-section[data-section-panel]').forEach(panel => {
        panel.hidden = panel.dataset.sectionPanel !== sectionKey;
    });

    if (adminPageTitle) adminPageTitle.textContent = ADMIN_SECTION_TITLES[sectionKey] || 'Dashboard';
    toggleSidebar(false);

    // Lazy-load: fetch products the first time the section is opened, not
    // eagerly at page load. Cached afterwards; use Retry to force a refresh.
    if (sectionKey === 'products' && adminProductsCache === null && !adminProductsLoading) {
        loadProductsSection();
    }

    if (sectionKey === 'orders' && adminOrdersCache === null && !adminOrdersLoading) {
        loadOrdersSection();
    }

    if (sectionKey === 'customers' && adminCustomersCache === null && !adminCustomersLoading) {
        loadCustomersSection();
    }

    if (sectionKey === 'settings' && adminSettingsCache === null && !adminSettingsLoading) {
        loadSettingsSection();
    }

    if (sectionKey === 'roles' && adminRolesCache === null && !adminRolesLoading) {
        loadRolesSection();
    }

    if (sectionKey === 'coupons' && adminCouponsCache === null && !adminCouponsLoading) {
        loadCouponsSection();
    }

    if (sectionKey === 'inventory' && adminInventoryCache === null && !adminInventoryLoading) {
        loadInventorySection();
    }

    if (sectionKey === 'messages' && adminMessagesCache === null && !adminMessagesLoading) {
        loadMessagesSection();
    }

    if (sectionKey === 'media' && adminMediaCache === null && !adminMediaLoading) {
        loadMediaSection();
    }
}

document.querySelectorAll('.admin-nav-link[data-section]').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        switchAdminSection(link.dataset.section);
    });
});

// ==========================================================================
// PRODUCTS MANAGEMENT (Part 2: list/read/manage only - no create/edit yet)
// ==========================================================================

const ADMIN_PRODUCT_PLACEHOLDER_IMAGE = 'images/AFIFI_BRANDS_VECTOR.svg';

const productSearchInput = document.getElementById('productSearchInput');
const productStatusFilter = document.getElementById('productStatusFilter');
const productsTableBody = document.getElementById('productsTableBody');
const productsCount = document.getElementById('productsCount');
const productsActionError = document.getElementById('productsActionError');

let adminProductsCache = null; // null = never successfully loaded yet
let adminProductsLoading = false;

function adminEscapeHtml(str) {
    return String(str === null || str === undefined ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function adminFormatPrice(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '—';
    return `${num.toLocaleString()} EGP`;
}

// The API returns a media `path`, not a full URL (same limitation already
// handled in brand.js for the storefront). Reconstruct the storage URL the
// same way: {origin}/storage/{path}.
function adminResolveMediaUrl(path) {
    if (!path) return '';
    if (/^https?:\/\//i.test(path)) return path;
    const origin = ADMIN_API_BASE_URL.replace(/\/api\/?$/, '');
    return `${origin}/storage/${path}`;
}

function getProductThumbUrl(product) {
    const images = Array.isArray(product.images) ? product.images : [];
    if (images.length === 0) return ADMIN_PRODUCT_PLACEHOLDER_IMAGE;
    const primary = images.find(img => img.is_primary) || images[0];
    const path = primary && primary.media && primary.media.path;
    const url = adminResolveMediaUrl(path);
    return url || ADMIN_PRODUCT_PLACEHOLDER_IMAGE;
}

// SKU lives on variants, not the product itself. Show the first one and
// indicate if there are more, rather than pretending products have a single
// top-level SKU.
function getProductSkuDisplay(product) {
    const variants = Array.isArray(product.variants) ? product.variants : [];
    const skus = variants.map(v => v.sku).filter(Boolean);
    if (skus.length === 0) return '—';
    if (skus.length === 1) return skus[0];
    return `${skus[0]} (+${skus.length - 1})`;
}

// Stock is tracked per variant, not on the product. Returns null when there
// is nothing to sum (no variants) so the caller can render "—" instead of 0.
function getProductTotalStock(product) {
    const variants = Array.isArray(product.variants) ? product.variants : [];
    if (variants.length === 0) return null;
    return variants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);
}

// There is no backend "status" enum: is_active is the real, updatable field.
// "Sold Out" is derived (all variant stock = 0) for display only - it is not
// a state the API can be told to set directly, so it has no action button.
function getProductStatusInfo(product) {
    if (!product.is_active) return { key: 'inactive', label: 'Inactive' };
    const totalStock = getProductTotalStock(product);
    if (totalStock !== null && totalStock === 0) return { key: 'sold_out', label: 'Sold Out' };
    return { key: 'active', label: 'Active' };
}

// There is no single is_featured flag on products - show whichever real
// flags are true instead of inventing one.
function getProductFeaturedLabels(product) {
    const labels = [];
    if (product.is_featured_drop) labels.push('Featured Drop');
    if (product.is_new_arrival) labels.push('New Arrival');
    if (product.is_best_seller) labels.push('Best Seller');
    return labels;
}

function showProductsActionError(message) {
    if (!productsActionError) return;
    productsActionError.textContent = message;
    productsActionError.hidden = false;
}

function hideProductsActionError() {
    if (!productsActionError) return;
    productsActionError.hidden = true;
}

function setProductsToolbarEnabled(enabled) {
    if (productSearchInput) productSearchInput.disabled = !enabled;
    if (productStatusFilter) productStatusFilter.disabled = !enabled;
}

function renderProductsTableMessage(text) {
    if (!productsTableBody) return;
    productsTableBody.innerHTML = `<tr class="admin-table-message-row"><td colspan="8">${adminEscapeHtml(text)}</td></tr>`;
    if (productsCount) productsCount.textContent = '';
}

function renderProductsTableError(message) {
    if (!productsTableBody) return;
    productsTableBody.innerHTML = `
        <tr class="admin-table-message-row is-error">
            <td colspan="8">
                ${adminEscapeHtml(message)}
                <button type="button" class="admin-inline-retry-btn" id="productsRetryBtn">RETRY</button>
            </td>
        </tr>`;
    if (productsCount) productsCount.textContent = '';
    const retryBtn = document.getElementById('productsRetryBtn');
    if (retryBtn) retryBtn.addEventListener('click', loadProductsSection);
}

// Fetches every page of GET /admin/products (per_page=100, following
// meta.last_page) so client-side search/filter operates on the full catalog
// rather than silently only the first page.
async function fetchAdminProducts() {
    const perPage = 100;
    const maxPages = 50; // safety cap against a runaway/misbehaving API
    let page = 1;
    let lastPage = 1;
    let allProducts = [];

    while (page <= lastPage && page <= maxPages) {
        const response = await adminApiRequest(`/admin/products?per_page=${perPage}&page=${page}`);
        const pageProducts = Array.isArray(response && response.data) ? response.data : [];
        allProducts = allProducts.concat(pageProducts);

        const metaLastPage = Number(response && response.meta && response.meta.last_page);
        lastPage = Number.isFinite(metaLastPage) && metaLastPage > 0 ? metaLastPage : 1;
        page += 1;
    }

    return allProducts;
}

async function loadProductsSection() {
    if (adminProductsLoading) return;
    adminProductsLoading = true;
    hideProductsActionError();
    setProductsToolbarEnabled(false);
    renderProductsTableMessage('Loading products…');

    try {
        const products = await fetchAdminProducts();
        adminProductsCache = products;
        setProductsToolbarEnabled(true);
        renderProductsTable();
    } catch (error) {
        adminProductsCache = null;
        const message = error && error.status === 403
            ? 'You do not have permission to view products.'
            : 'Could not load products. Please try again.';
        renderProductsTableError(message);
    } finally {
        adminProductsLoading = false;
    }
}

function getFilteredProducts() {
    if (!Array.isArray(adminProductsCache)) return [];
    const query = ((productSearchInput && productSearchInput.value) || '').trim().toLowerCase();
    const statusFilter = productStatusFilter ? productStatusFilter.value : 'all';

    return adminProductsCache.filter(product => {
        if (query) {
            const nameMatch = (product.name || '').toLowerCase().includes(query);
            const skuMatch = Array.isArray(product.variants) &&
                product.variants.some(v => (v.sku || '').toLowerCase().includes(query));
            if (!nameMatch && !skuMatch) return false;
        }
        if (statusFilter && statusFilter !== 'all') {
            if (getProductStatusInfo(product).key !== statusFilter) return false;
        }
        return true;
    });
}

function renderProductRow(product) {
    const name = adminEscapeHtml(product.name || 'Unnamed product');
    const thumbUrl = adminEscapeHtml(getProductThumbUrl(product));
    const sku = adminEscapeHtml(getProductSkuDisplay(product));
    const price = adminFormatPrice(product.base_price);
    const totalStock = getProductTotalStock(product);
    const stockDisplay = totalStock === null ? '—' : totalStock.toLocaleString();
    const statusInfo = getProductStatusInfo(product);
    const featuredLabels = getProductFeaturedLabels(product);
    const featuredDisplay = featuredLabels.length > 0
        ? featuredLabels.map(label => `<span class="admin-pill admin-pill-featured">${adminEscapeHtml(label)}</span>`).join('')
        : '<span class="admin-table-muted">—</span>';
    const toggleLabel = product.is_active ? 'Deactivate' : 'Activate';

    return `
        <tr data-product-id="${product.id}">
            <td><img class="admin-product-thumb" src="${thumbUrl}" alt="${name}" loading="lazy" onerror="this.src='${ADMIN_PRODUCT_PLACEHOLDER_IMAGE}'"></td>
            <td>${name}</td>
            <td>${sku}</td>
            <td>${price}</td>
            <td>${stockDisplay}</td>
            <td><span class="admin-pill admin-pill-${statusInfo.key}">${statusInfo.label}</span></td>
            <td>${featuredDisplay}</td>
            <td>
                <div class="admin-row-actions">
                    <button type="button" class="admin-action-btn" data-action="edit" data-product-id="${product.id}">Edit</button>
                    <button type="button" class="admin-action-btn admin-action-toggle" data-action="toggle-active" data-product-id="${product.id}">${toggleLabel}</button>
                    <button type="button" class="admin-action-btn admin-action-danger" data-action="delete" data-product-id="${product.id}">Delete</button>
                </div>
            </td>
        </tr>
    `;
}

function wireProductRowActions() {
    productsTableBody.querySelectorAll('[data-action="toggle-active"]').forEach(btn => {
        btn.addEventListener('click', () => handleToggleActive(btn.dataset.productId, btn));
    });
    productsTableBody.querySelectorAll('[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', () => handleDeleteProduct(btn.dataset.productId, btn));
    });
    productsTableBody.querySelectorAll('[data-action="edit"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const product = adminProductsCache && adminProductsCache.find(p => String(p.id) === String(btn.dataset.productId));
            if (product) openProductForm('edit', product);
        });
    });
}

function renderProductsTable() {
    if (!productsTableBody) return;

    if (!Array.isArray(adminProductsCache) || adminProductsCache.length === 0) {
        renderProductsTableMessage('No products yet.');
        return;
    }

    const filtered = getFilteredProducts();

    if (filtered.length === 0) {
        productsTableBody.innerHTML = `
            <tr class="admin-table-message-row">
                <td colspan="8">
                    No products match your search/filter.
                    <button type="button" class="admin-inline-retry-btn" id="productsClearFiltersBtn">CLEAR FILTERS</button>
                </td>
            </tr>`;
        if (productsCount) productsCount.textContent = '';
        const clearBtn = document.getElementById('productsClearFiltersBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (productSearchInput) productSearchInput.value = '';
                if (productStatusFilter) productStatusFilter.value = 'all';
                renderProductsTable();
            });
        }
        return;
    }

    productsTableBody.innerHTML = filtered.map(renderProductRow).join('');
    wireProductRowActions();

    if (productsCount) {
        const total = adminProductsCache.length;
        productsCount.textContent = filtered.length === total
            ? `${total} product${total === 1 ? '' : 's'}`
            : `${filtered.length} of ${total} products`;
    }
}

// Toggling is_active is a real, safe, reversible update the backend
// supports directly (UpdateProductRequest treats it as `sometimes|boolean`),
// so this is wired for real instead of being a visual-only placeholder.
async function handleToggleActive(productId, btn) {
    const product = adminProductsCache && adminProductsCache.find(p => String(p.id) === String(productId));
    if (!product) return;

    hideProductsActionError();
    const nextActive = !product.is_active;
    const originalLabel = btn ? btn.textContent : '';
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Saving…';
    }

    try {
        const response = await adminApiRequest(`/admin/products/${productId}`, {
            method: 'PATCH',
            body: { is_active: nextActive }
        });
        const updated = (response && response.data) || null;
        if (updated) {
            Object.assign(product, updated);
        } else {
            product.is_active = nextActive;
        }
        renderProductsTable();
    } catch (error) {
        console.warn('AFIFI Admin: could not update product status.', error);
        showProductsActionError(error && error.message ? error.message : 'Could not update product status. Please try again.');
        if (btn) {
            btn.disabled = false;
            btn.textContent = originalLabel;
        }
    }
}

// Delete calls the real DELETE endpoint (soft-delete on the backend) behind
// a confirmation, since this is a destructive action even if reversible in
// the database.
async function handleDeleteProduct(productId, btn) {
    const product = adminProductsCache && adminProductsCache.find(p => String(p.id) === String(productId));
    if (!product) return;

    const confirmed = window.confirm(`Delete "${product.name}"? It will be hidden from customers immediately.`);
    if (!confirmed) return;

    hideProductsActionError();
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Deleting…';
    }

    try {
        await adminApiRequest(`/admin/products/${productId}`, { method: 'DELETE' });
        adminProductsCache = adminProductsCache.filter(p => String(p.id) !== String(productId));
        renderProductsTable();
    } catch (error) {
        console.warn('AFIFI Admin: could not delete product.', error);
        showProductsActionError(error && error.message ? error.message : 'Could not delete product. Please try again.');
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Delete';
        }
    }
}

if (productSearchInput) {
    productSearchInput.addEventListener('input', renderProductsTable);
}

if (productStatusFilter) {
    productStatusFilter.addEventListener('change', renderProductsTable);
}

// ==========================================================================
// ORDERS MANAGEMENT (Part 4)
//
// GET /admin/orders and GET /admin/orders/{id} did not exist on the backend
// before this phase - only PATCH .../status did. They were added
// (OrderController::adminIndex/adminShow) gated by the existing
// `orders.view` permission, reusing OrderResource/OrderPolicy as-is.
// ==========================================================================

const ORDER_STATUS_LABELS = {
    pending_confirmation: 'Pending Confirmation',
    confirmed: 'Confirmed',
    processing: 'Processing',
    shipped: 'Shipped',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
    returned: 'Returned'
};

// Mirrors OrderService::STATUS_TRANSITIONS on the backend so the dropdown
// only ever offers moves the backend will actually accept.
const ORDER_STATUS_TRANSITIONS = {
    pending_confirmation: ['confirmed', 'cancelled'],
    confirmed: ['processing', 'cancelled'],
    processing: ['shipped', 'cancelled'],
    shipped: ['delivered', 'returned'],
    delivered: ['returned'],
    cancelled: [],
    returned: []
};

const PAYMENT_STATUS_LABELS = {
    unpaid: 'Unpaid',
    partially_paid: 'Partially Paid',
    paid: 'Paid',
    partially_refunded: 'Partially Refunded',
    refunded: 'Refunded'
};

const PAYMENT_RECORD_STATUS_LABELS = {
    pending: 'Pending',
    paid: 'Paid',
    failed: 'Failed'
};

const MANUAL_PAYMENT_PROVIDER_IDS = ['instapay', 'vodafone_cash'];

const RETURN_TYPE_LABELS = {
    return: 'Return',
    exchange: 'Exchange'
};

const RETURN_STATUS_LABELS = {
    pending: 'Pending',
    approved: 'Approved',
    rejected: 'Rejected',
    completed: 'Completed'
};

const RETURN_STATUS_TRANSITIONS = {
    pending: ['approved', 'rejected'],
    approved: ['completed', 'rejected'],
    rejected: [],
    completed: []
};

const REFUND_STATUS_LABELS = {
    pending: 'Pending',
    processed: 'Processed',
    failed: 'Failed'
};

const REFUND_STATUS_TRANSITIONS = {
    pending: ['processed', 'failed'],
    processed: [],
    failed: []
};

const FINAL_PAYMENT_RECORD_STATUSES = ['paid', 'failed'];

const orderSearchInput = document.getElementById('orderSearchInput');
const orderStatusFilter = document.getElementById('orderStatusFilter');
const orderPaymentStatusFilter = document.getElementById('orderPaymentStatusFilter');
const ordersTableBody = document.getElementById('ordersTableBody');
const ordersCount = document.getElementById('ordersCount');
const orderDetailOverlay = document.getElementById('orderDetailOverlay');
const orderDetailTitle = document.getElementById('orderDetailTitle');
const orderDetailCloseBtn = document.getElementById('orderDetailCloseBtn');
const orderDetailBody = document.getElementById('orderDetailBody');

let adminOrdersCache = null; // null = never successfully loaded yet
let adminOrdersLoading = false;
let orderStatusUpdateSubmitting = false;
let orderDetailLoading = false;
const paymentUpdateInFlight = new Set();
const returnUpdateInFlight = new Set();
const refundCreateInFlight = new Set();
const refundStatusUpdateInFlight = new Set();

function setOrdersToolbarEnabled(enabled) {
    if (orderSearchInput) orderSearchInput.disabled = !enabled;
    if (orderStatusFilter) orderStatusFilter.disabled = !enabled;
    if (orderPaymentStatusFilter) orderPaymentStatusFilter.disabled = !enabled;
}

function renderOrdersTableMessage(message) {
    if (!ordersTableBody) return;
    ordersTableBody.innerHTML = `<tr class="admin-table-message-row"><td colspan="9">${adminEscapeHtml(message)}</td></tr>`;
}

function renderOrdersTableError(message, onRetry) {
    if (!ordersTableBody) return;
    ordersTableBody.innerHTML = `
        <tr class="admin-table-message-row is-error">
            <td colspan="9">
                ${adminEscapeHtml(message)}
                <button type="button" class="admin-inline-retry-btn" id="ordersRetryBtn">Retry</button>
            </td>
        </tr>
    `;
    const retryBtn = document.getElementById('ordersRetryBtn');
    if (retryBtn) retryBtn.addEventListener('click', onRetry);
}

// Same fetch-all-pages-then-cache approach used for admin products, so
// search/filter can run client-side against the full data set.
async function fetchAdminOrders() {
    const perPage = 100;
    const maxPages = 50;
    let page = 1;
    let lastPage = 1;
    let all = [];

    while (page <= lastPage && page <= maxPages) {
        const response = await adminApiRequest(`/admin/orders?per_page=${perPage}&page=${page}`);
        const items = Array.isArray(response && response.data) ? response.data : [];
        all = all.concat(items);
        const metaLastPage = Number(response && response.meta && response.meta.last_page);
        lastPage = Number.isFinite(metaLastPage) && metaLastPage > 0 ? metaLastPage : 1;
        page += 1;
    }

    return all;
}

async function loadOrdersSection() {
    adminOrdersLoading = true;
    setOrdersToolbarEnabled(false);
    renderOrdersTableMessage('Loading orders…');

    try {
        const orders = await fetchAdminOrders();
        adminOrdersCache = orders;
        setOrdersToolbarEnabled(true);
        renderOrdersTable();
    } catch (error) {
        adminOrdersCache = null;
        const isForbidden = error && error.status === 403;
        renderOrdersTableError(
            isForbidden
                ? 'You do not have permission to view orders.'
                : (error && error.message ? error.message : 'Could not load orders. Please try again.'),
            loadOrdersSection
        );
    } finally {
        adminOrdersLoading = false;
    }
}

function getOrderCustomerDisplay(order) {
    if (order.user && order.user.name) return order.user.name;
    if (order.guest_email) return `${order.guest_email} (guest)`;
    if (order.guest_phone) return `${order.guest_phone} (guest)`;
    return '—';
}

function getOrderCustomerSearchText(order) {
    const parts = [
        order.order_number,
        order.user && order.user.name,
        order.user && order.user.email,
        order.user && order.user.phone,
        order.guest_email,
        order.guest_phone
    ];
    return parts.filter(Boolean).join(' ').toLowerCase();
}

function getFilteredOrders() {
    if (!Array.isArray(adminOrdersCache)) return [];
    const search = orderSearchInput ? orderSearchInput.value.trim().toLowerCase() : '';
    const statusFilter = orderStatusFilter ? orderStatusFilter.value : '';
    const paymentFilter = orderPaymentStatusFilter ? orderPaymentStatusFilter.value : '';

    return adminOrdersCache.filter(order => {
        if (statusFilter && order.status !== statusFilter) return false;
        if (paymentFilter && order.payment_status !== paymentFilter) return false;
        if (search && !getOrderCustomerSearchText(order).includes(search)) return false;
        return true;
    });
}

function formatOrderDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatOrderMoney(value, currencyCode) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '—';
    const code = currencyCode || 'EGP';
    return `${num.toLocaleString()} ${adminEscapeHtml(code)}`;
}

function moneyToMinorUnits(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    return Math.round(num * 100);
}

function minorUnitsToMoney(minorUnits) {
    return Math.max(0, minorUnits) / 100;
}

function formatOrderMoneyFromMinor(minorUnits, currencyCode) {
    return formatOrderMoney(minorUnitsToMoney(minorUnits), currencyCode);
}

function roundMoneyAmount(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return Math.round(num * 100) / 100;
}

function getOrderRefundBalance(order) {
    const payments = Array.isArray(order && order.payments) ? order.payments : [];
    const refunds = Array.isArray(order && order.refunds) ? order.refunds : [];

    const paidMinor = payments
        .filter(payment => payment && payment.status === 'paid')
        .reduce((sum, payment) => sum + moneyToMinorUnits(payment.amount), 0);

    const reservedMinor = refunds
        .filter(refund => refund && (refund.status === 'pending' || refund.status === 'processed'))
        .reduce((sum, refund) => sum + moneyToMinorUnits(refund.amount), 0);

    return {
        paidMinor,
        reservedMinor,
        availableMinor: Math.max(0, paidMinor - reservedMinor)
    };
}

function findOrderPaymentById(order, paymentId) {
    const payments = Array.isArray(order && order.payments) ? order.payments : [];
    return payments.find(payment => Number(payment.id) === Number(paymentId)) || null;
}

function getRefundPaymentProvider(refund, order) {
    if (refund && refund.payment && refund.payment.provider) {
        return refund.payment.provider;
    }
    const payment = findOrderPaymentById(order, refund && refund.payment_id);
    return payment ? payment.provider : null;
}

function getOrderItemCount(order) {
    const items = Array.isArray(order && order.items) ? order.items : [];
    return items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
}

function getOrderPaymentMethodDisplay(order) {
    const method = order && order.payment_method;
    if (!method) return '—';
    const payments = Array.isArray(order.payments) ? order.payments : [];
    const provider = payments.find(p => p && p.provider)?.provider;
    if (provider && provider !== method) {
        return `${method} · ${provider}`;
    }
    return String(method);
}

function findOrderItemById(order, orderItemId) {
    const items = Array.isArray(order && order.items) ? order.items : [];
    return items.find(item => Number(item.id) === Number(orderItemId)) || null;
}

function getReturnItemLabel(order, returnRequest) {
    const item = returnRequest.order_item || findOrderItemById(order, returnRequest.order_item_id);
    if (!item) return `Item #${returnRequest.order_item_id}`;
    const parts = [item.product_name || 'Item'];
    const variant = [item.color_name, item.size_name].filter(Boolean).join(' / ');
    if (variant) parts.push(variant);
    if (item.sku) parts.push(`SKU ${item.sku}`);
    parts.push(`Qty ${item.quantity || 0}`);
    return parts.filter(Boolean).join(' · ');
}

function renderOrderStatusPill(status) {
    const label = ORDER_STATUS_LABELS[status] || status || '—';
    return `<span class="admin-pill admin-pill-status-${adminEscapeHtml(status || '')}">${adminEscapeHtml(label)}</span>`;
}

function renderPaymentStatusPill(status) {
    const label = PAYMENT_STATUS_LABELS[status] || status || '—';
    return `<span class="admin-pill admin-pill-pay-${adminEscapeHtml(status || '')}">${adminEscapeHtml(label)}</span>`;
}

function renderOrderRow(order) {
    const customer = adminEscapeHtml(getOrderCustomerDisplay(order));
    const orderNumber = adminEscapeHtml(order.order_number || `#${order.id}`);
    const date = formatOrderDate(order.created_at);
    const total = formatOrderMoney(order.grand_total, order.currency_code);
    const itemCount = getOrderItemCount(order);
    const paymentMethod = adminEscapeHtml(getOrderPaymentMethodDisplay(order));

    return `
        <tr>
            <td>${orderNumber}</td>
            <td>${customer}</td>
            <td>${date}</td>
            <td>${total}</td>
            <td>${itemCount}</td>
            <td>${paymentMethod}</td>
            <td>${renderPaymentStatusPill(order.payment_status)}</td>
            <td>${renderOrderStatusPill(order.status)}</td>
            <td>
                <div class="admin-row-actions">
                    <button type="button" class="admin-action-btn" data-action="view-order" data-order-id="${order.id}">View</button>
                </div>
            </td>
        </tr>
    `;
}

function wireOrderRowActions() {
    ordersTableBody.querySelectorAll('[data-action="view-order"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const order = adminOrdersCache && adminOrdersCache.find(o => String(o.id) === String(btn.dataset.orderId));
            if (order) openOrderDetail(order.id);
        });
    });
}

function renderOrdersTable() {
    if (!ordersTableBody) return;

    const filtered = getFilteredOrders();

    if (ordersCount) {
        const total = Array.isArray(adminOrdersCache) ? adminOrdersCache.length : 0;
        ordersCount.textContent = total > 0 ? `${filtered.length} of ${total} orders` : '';
    }

    if (!Array.isArray(adminOrdersCache)) return;

    if (adminOrdersCache.length === 0) {
        renderOrdersTableMessage('No orders yet.');
        return;
    }

    if (filtered.length === 0) {
        renderOrdersTableMessage('No orders match your search/filters.');
        return;
    }

    ordersTableBody.innerHTML = filtered.map(renderOrderRow).join('');
    wireOrderRowActions();
}

if (orderSearchInput) {
    orderSearchInput.addEventListener('input', renderOrdersTable);
}
if (orderStatusFilter) {
    orderStatusFilter.addEventListener('change', renderOrdersTable);
}
if (orderPaymentStatusFilter) {
    orderPaymentStatusFilter.addEventListener('change', renderOrdersTable);
}

// ---- Order detail modal ----

function closeOrderDetail() {
    if (orderStatusUpdateSubmitting || orderDetailLoading) return;
    if (orderDetailOverlay) orderDetailOverlay.hidden = true;
}

if (orderDetailCloseBtn) orderDetailCloseBtn.addEventListener('click', closeOrderDetail);
if (orderDetailOverlay) {
    orderDetailOverlay.addEventListener('click', (e) => {
        if (e.target === orderDetailOverlay) closeOrderDetail();
    });
}
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && orderDetailOverlay && !orderDetailOverlay.hidden) {
        closeOrderDetail();
    }
});

function renderAddressBlock(address) {
    if (!address) return '<dd>No address on file.</dd>';
    const lines = [
        address.full_name,
        address.phone,
        [address.building, address.street].filter(Boolean).join(' '),
        [address.area, address.city, address.governorate_name].filter(Boolean).join(', '),
        address.floor ? `Floor ${address.floor}` : '',
        address.postal_code
    ].filter(Boolean);
    return lines.map(line => `<dd>${adminEscapeHtml(line)}</dd>`).join('');
}

function renderOrderItemsTable(items) {
    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) return '<p class="admin-table-muted">No items found for this order.</p>';

    const rows = list.map(item => {
        const variant = [item.color_name, item.size_name].filter(Boolean).join(' / ') || '—';
        return `
            <tr>
                <td>${adminEscapeHtml(item.product_name || '—')}</td>
                <td>${adminEscapeHtml(item.sku || '—')}</td>
                <td>${adminEscapeHtml(variant)}</td>
                <td>${adminEscapeHtml(String(item.quantity != null ? item.quantity : '—'))}</td>
                <td>${adminFormatPrice(item.unit_price)}</td>
                <td>${adminFormatPrice(item.line_total)}</td>
            </tr>
        `;
    }).join('');

    return `
        <div class="admin-table-wrap">
            <table class="admin-table">
                <thead>
                    <tr><th>Product</th><th>SKU</th><th>Variant</th><th>Qty</th><th>Unit Price</th><th>Line Total</th></tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;
}

function renderPaymentsList(order) {
    const payments = Array.isArray(order && order.payments) ? order.payments : [];
    const orderPaymentStatus = order ? order.payment_status : null;

    if (payments.length === 0) {
        return '<p class="admin-table-muted">No payment records yet.</p>';
    }

    const rows = payments.map(payment => {
        const isManual = MANUAL_PAYMENT_PROVIDER_IDS.includes(payment.provider);
        const isPending = payment.status === 'pending';
        const isFinal = FINAL_PAYMENT_RECORD_STATUSES.includes(payment.status);
        const statusLabel = PAYMENT_RECORD_STATUS_LABELS[payment.status] || payment.status || '—';
        const showActions = isManual && isPending && !isFinal;

        return `
            <tr>
                <td>${adminEscapeHtml(payment.provider || '—')}</td>
                <td>${adminEscapeHtml(payment.provider_reference || '—')}</td>
                <td>${formatOrderMoney(payment.amount, payment.currency || order.currency_code)}</td>
                <td>${adminEscapeHtml(statusLabel)}</td>
                <td>${formatOrderDate(payment.paid_at)}</td>
                <td>
                    ${showActions ? `
                        <div class="admin-row-actions">
                            <button type="button" class="admin-action-btn" data-action="mark-payment-paid" data-payment-id="${payment.id}" data-order-id="${order.id}">Mark Paid</button>
                            <button type="button" class="admin-action-btn admin-action-danger" data-action="mark-payment-failed" data-payment-id="${payment.id}" data-order-id="${order.id}">Mark Failed</button>
                        </div>
                    ` : '<span class="admin-table-muted">—</span>'}
                </td>
            </tr>
        `;
    }).join('');

    return `
        <p class="admin-table-muted" style="margin-bottom:10px;">Order payment status: <strong>${adminEscapeHtml(PAYMENT_STATUS_LABELS[orderPaymentStatus] || orderPaymentStatus || '—')}</strong></p>
        <div class="admin-error-banner" id="orderPaymentError" hidden></div>
        <div class="admin-table-wrap">
            <table class="admin-table">
                <thead>
                    <tr><th>Provider</th><th>Reference</th><th>Amount</th><th>Status</th><th>Paid At</th><th>Actions</th></tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        <p class="admin-field-hint" style="margin-top:8px;">Customer-submitted references are read-only. Use explicit actions to verify manual payments.</p>
    `;
}

function renderRefundBalanceSummary(order, balance) {
    const currency = order.currency_code || 'EGP';
    return `
        <dl class="admin-detail-block admin-refund-balance-summary">
            <dt>Total Paid</dt><dd>${formatOrderMoneyFromMinor(balance.paidMinor, currency)}</dd>
            <dt>Reserved Refunds</dt><dd>${formatOrderMoneyFromMinor(balance.reservedMinor, currency)}</dd>
            <dt>Available to Refund</dt><dd><strong>${formatOrderMoneyFromMinor(balance.availableMinor, currency)}</strong></dd>
        </dl>
        <p class="admin-field-hint">Available balance is an estimate. The backend enforces the final refundable amount.</p>
    `;
}

function renderRefundCreateForm(order, payment, balance) {
    const currency = order.currency_code || 'EGP';
    const maxAmount = minorUnitsToMoney(balance.availableMinor);
    const provider = payment.provider || '—';

    return `
        <form class="admin-refund-create-form" data-payment-id="${payment.id}" data-order-id="${order.id}" novalidate>
            <div class="admin-refund-create-header">
                <strong>Create Refund</strong>
                <span class="admin-table-muted">${adminEscapeHtml(provider)} · Payment #${adminEscapeHtml(String(payment.id))}</span>
            </div>
            <p class="admin-table-muted">Payment amount: ${formatOrderMoney(payment.amount, payment.currency || currency)} · Available: ${formatOrderMoneyFromMinor(balance.availableMinor, currency)}</p>
            <div class="admin-status-update-row">
                <label class="admin-form-field">
                    <span class="visually-hidden">Refund amount</span>
                    <input type="number" name="amount" min="0.01" max="${maxAmount}" step="0.01" required placeholder="Amount (${adminEscapeHtml(currency)})" aria-label="Refund amount">
                </label>
                <textarea name="reason" placeholder="Optional reason…" maxlength="500" aria-label="Refund reason"></textarea>
                <button type="submit" class="admin-btn-primary">Create Refund</button>
            </div>
            <p class="checkout-field-error admin-refund-form-error" role="alert" hidden></p>
        </form>
    `;
}

function renderRefundsList(order, refunds) {
    const currency = order.currency_code || 'EGP';
    const rows = refunds.map(refund => {
        const statusLabel = REFUND_STATUS_LABELS[refund.status] || refund.status || '—';
        const provider = getRefundPaymentProvider(refund, order);
        const transitions = REFUND_STATUS_TRANSITIONS[refund.status] || [];
        const reason = String(refund.reason || '').trim();
        const processedAt = refund.processed_at ? formatOrderDate(refund.processed_at) : '';

        const actionButtons = transitions.map(status => {
            const action = status === 'processed' ? 'mark-refund-processed' : 'mark-refund-failed';
            const label = status === 'processed' ? 'Mark Processed' : 'Mark Failed';
            const dangerClass = status === 'failed' ? ' admin-action-danger' : '';
            return `
                <button type="button" class="admin-action-btn${dangerClass}" data-action="${action}" data-refund-id="${refund.id}" data-payment-id="${refund.payment_id}" data-order-id="${order.id}">${label}</button>
            `;
        }).join('');

        return `
            <tr>
                <td>${formatOrderMoney(refund.amount, currency)}</td>
                <td><span class="admin-pill admin-pill-refund-${adminEscapeHtml(refund.status || '')}">${adminEscapeHtml(statusLabel)}</span></td>
                <td>${adminEscapeHtml(reason || '—')}</td>
                <td>${adminEscapeHtml(provider || '—')}</td>
                <td>${formatOrderDate(refund.created_at)}</td>
                <td>${processedAt || '—'}</td>
                <td>
                    ${actionButtons
                        ? `<div class="admin-row-actions">${actionButtons}</div>`
                        : '<span class="admin-table-muted">—</span>'}
                </td>
            </tr>
        `;
    }).join('');

    return `
        <div class="admin-table-wrap admin-refund-table-wrap">
            <table class="admin-table">
                <thead>
                    <tr><th>Amount</th><th>Status</th><th>Reason</th><th>Payment</th><th>Created</th><th>Processed</th><th>Actions</th></tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;
}

function renderRefundsSection(order) {
    const refunds = Array.isArray(order && order.refunds) ? order.refunds : [];
    const payments = Array.isArray(order && order.payments) ? order.payments : [];
    const paidPayments = payments.filter(payment => payment && payment.status === 'paid');
    const balance = getOrderRefundBalance(order);
    const hasPaidPayments = paidPayments.length > 0;
    const hasRefunds = refunds.length > 0;
    const canCreateRefund = balance.availableMinor > 0 && hasPaidPayments;

    if (!hasPaidPayments && !hasRefunds) {
        return '<p class="admin-table-muted">No refunds yet. Refunds require a paid payment.</p>';
    }

    let html = '<div class="admin-error-banner" id="orderRefundError" hidden></div>';

    if (hasPaidPayments) {
        html += renderRefundBalanceSummary(order, balance);
    }

    if (hasRefunds) {
        html += renderRefundsList(order, refunds);
    } else {
        html += '<p class="admin-table-muted">No refunds recorded for this order yet.</p>';
    }

    if (canCreateRefund) {
        html += `<div class="admin-refund-create-list">${paidPayments.map(payment => renderRefundCreateForm(order, payment, balance)).join('')}</div>`;
    } else if (hasPaidPayments && balance.availableMinor <= 0) {
        html += '<p class="admin-table-muted">No refundable balance remains on this order.</p>';
    }

    return html;
}

function renderReturnRequestsSection(order) {
    const returnRequests = Array.isArray(order && order.return_requests) ? order.return_requests : [];

    if (returnRequests.length === 0) {
        return '<p class="admin-table-muted">No return or exchange requests for this order.</p>';
    }

    return `
        <div class="admin-return-list">
            ${returnRequests.map(request => {
                const transitions = RETURN_STATUS_TRANSITIONS[request.status] || [];
                const statusOptions = transitions.map(status => `
                    <option value="${status}">${adminEscapeHtml(RETURN_STATUS_LABELS[status] || status)}</option>
                `).join('');
                const itemLabel = getReturnItemLabel(order, request);
                const adminNotes = String(request.admin_notes || '').trim();
                const resolvedAt = request.resolved_at ? formatOrderDate(request.resolved_at) : '';

                return `
                    <article class="admin-return-card">
                        <div class="admin-return-card-top">
                            <span class="admin-pill admin-pill-status-${adminEscapeHtml(request.status || '')}">${adminEscapeHtml(RETURN_STATUS_LABELS[request.status] || request.status || '—')}</span>
                            <span class="admin-table-muted">${adminEscapeHtml(RETURN_TYPE_LABELS[request.type] || request.type || '—')}</span>
                        </div>
                        <dl class="admin-detail-block">
                            <dt>Item</dt><dd>${adminEscapeHtml(itemLabel)}</dd>
                            <dt>Reason</dt><dd>${adminEscapeHtml(String(request.reason || '').trim() || '—')}</dd>
                            <dt>Requested</dt><dd>${formatOrderDate(request.requested_at)}</dd>
                            ${resolvedAt ? `<dt>Resolved</dt><dd>${resolvedAt}</dd>` : ''}
                            ${adminNotes ? `<dt>Admin Notes</dt><dd>${adminEscapeHtml(adminNotes)}</dd>` : ''}
                        </dl>
                        ${statusOptions ? `
                            <form class="admin-return-update-form" data-return-id="${request.id}" data-order-id="${order.id}" novalidate>
                                <div class="admin-status-update-row">
                                    <select name="status" required aria-label="New return status">
                                        <option value="">Select new status…</option>
                                        ${statusOptions}
                                    </select>
                                    <textarea name="admin_notes" placeholder="Optional admin notes…" maxlength="1000">${adminEscapeHtml(adminNotes)}</textarea>
                                    <button type="submit" class="admin-btn-primary">Update Return</button>
                                </div>
                                <p class="checkout-field-error admin-return-form-error" role="alert" hidden></p>
                            </form>
                        ` : `<p class="admin-table-muted">No further status changes available.</p>`}
                    </article>
                `;
            }).join('')}
        </div>
        <p class="admin-field-hint" style="margin-top:8px;">Return updates do not process refunds or restock inventory automatically.</p>
    `;
}

function renderShipmentBlock(shipment) {
    if (!shipment || !shipment.id) {
        return '<p class="admin-table-muted">No shipment info yet. Shipment tracking management is coming in a future phase.</p>';
    }
    return `
        <dl class="admin-detail-block">
            <dt>Carrier</dt><dd>${adminEscapeHtml(shipment.carrier || '—')}</dd>
            <dt>Tracking Number</dt><dd>${adminEscapeHtml(shipment.tracking_number || '—')}</dd>
            <dt>Shipped At</dt><dd>${formatOrderDate(shipment.shipped_at)}</dd>
            <dt>Delivered At</dt><dd>${formatOrderDate(shipment.delivered_at)}</dd>
        </dl>
    `;
}

function renderStatusHistory(history) {
    const list = Array.isArray(history) ? history : [];
    if (list.length === 0) return '<p class="admin-table-muted">No status changes recorded yet.</p>';

    return `
        <ul class="admin-status-history-list">
            ${list.map(entry => `
                <li>
                    <strong>${adminEscapeHtml(entry.from_status || 'created')}</strong> → <strong>${adminEscapeHtml(entry.to_status)}</strong>
                    ${entry.note ? `— ${adminEscapeHtml(entry.note)}` : ''}
                    <br>${formatOrderDate(entry.created_at)}${entry.changed_by ? ` · by admin #${adminEscapeHtml(String(entry.changed_by))}` : ' · system'}
                </li>
            `).join('')}
        </ul>
    `;
}

function renderOrderDetailContent(order) {
    const customerName = order.user ? order.user.name : (order.guest_email || order.guest_phone || 'Guest');
    const customerEmail = order.user ? order.user.email : order.guest_email;
    const customerPhone = order.user ? order.user.phone : order.guest_phone;

    const addresses = Array.isArray(order.addresses) ? order.addresses : [];
    const shippingAddress = addresses.find(a => a.type === 'shipping') || addresses[0] || null;
    const billingAddress = addresses.find(a => a.type === 'billing') || null;

    const validNextStatuses = ORDER_STATUS_TRANSITIONS[order.status] || [];
    const statusOptions = validNextStatuses.length > 0
        ? validNextStatuses.map(status => `<option value="${status}">${adminEscapeHtml(ORDER_STATUS_LABELS[status] || status)}</option>`).join('')
        : '';

    const adminNotes = String(order.admin_notes || '').trim();
    const customerNotes = String(order.customer_notes || '').trim();

    return `
        <div class="admin-order-overview">
            ${renderOrderStatusPill(order.status)}
            ${renderPaymentStatusPill(order.payment_status)}
            <span class="admin-table-muted">Placed ${formatOrderDate(order.created_at)}</span>
        </div>

        <div class="admin-form-section" style="margin-top:16px; padding-top:0; border-top:none;">
            <div class="admin-detail-grid">
                <dl class="admin-detail-block">
                    <dt>Customer</dt><dd>${adminEscapeHtml(customerName || '—')}</dd>
                    <dt>Email</dt><dd>${adminEscapeHtml(customerEmail || '—')}</dd>
                    <dt>Phone</dt><dd>${adminEscapeHtml(customerPhone || '—')}</dd>
                    <dt>Payment Method</dt><dd>${adminEscapeHtml(order.payment_method || '—')}</dd>
                    <dt>Currency</dt><dd>${adminEscapeHtml(order.currency_code || '—')}</dd>
                </dl>
                <dl class="admin-detail-block">
                    <dt>Shipping Address</dt>
                    ${renderAddressBlock(shippingAddress)}
                    ${billingAddress ? `<dt>Billing Address</dt>${renderAddressBlock(billingAddress)}` : ''}
                </dl>
            </div>
        </div>

        ${customerNotes ? `
            <div class="admin-form-section">
                <h3>Customer Notes</h3>
                <p class="admin-table-muted">${adminEscapeHtml(customerNotes)}</p>
            </div>
        ` : ''}

        ${adminNotes ? `
            <div class="admin-form-section">
                <h3>Admin Notes</h3>
                <p class="admin-table-muted">${adminEscapeHtml(adminNotes)}</p>
            </div>
        ` : ''}

        <div class="admin-form-section">
            <h3>Items</h3>
            ${renderOrderItemsTable(order.items)}
        </div>

        <div class="admin-form-section">
            <h3>Totals</h3>
            <div class="admin-totals-row"><span>Subtotal</span><span>${formatOrderMoney(order.subtotal, order.currency_code)}</span></div>
            <div class="admin-totals-row"><span>Shipping</span><span>${formatOrderMoney(order.shipping_fee, order.currency_code)}</span></div>
            <div class="admin-totals-row"><span>Discount</span><span>-${formatOrderMoney(order.discount_total, order.currency_code)}</span></div>
            <div class="admin-totals-row"><span>Grand Total</span><span>${formatOrderMoney(order.grand_total, order.currency_code)}</span></div>
        </div>

        <div class="admin-form-section">
            <h3>Payments</h3>
            ${renderPaymentsList(order)}
        </div>

        <div class="admin-form-section">
            <h3>Refunds</h3>
            ${renderRefundsSection(order)}
        </div>

        <div class="admin-form-section">
            <h3>Shipment</h3>
            ${renderShipmentBlock(order.shipment)}
        </div>

        <div class="admin-form-section">
            <h3>Status History</h3>
            ${renderStatusHistory(order.status_history)}
        </div>

        <div class="admin-form-section">
            <h3>Return Requests</h3>
            ${renderReturnRequestsSection(order)}
        </div>

        <div class="admin-form-section">
            <h3>Update Order Status</h3>
            <div class="admin-error-banner" id="orderStatusError" hidden></div>
            ${statusOptions
                ? `
                    <form id="orderStatusForm" class="admin-status-update-row" data-order-id="${order.id}" novalidate>
                        <select id="orderStatusSelect" required>
                            <option value="">Select new status…</option>
                            ${statusOptions}
                        </select>
                        <textarea id="orderStatusNote" placeholder="Optional note…" maxlength="500"></textarea>
                        <button type="submit" class="admin-btn-primary" id="orderStatusSubmitBtn">Update Status</button>
                    </form>
                `
                : `<p class="admin-table-muted">This order is in its final status (${adminEscapeHtml(ORDER_STATUS_LABELS[order.status] || order.status)}) — no further transitions are available.</p>`
            }
        </div>
    `;
}

function showOrderDetailErrorBanner(elementId, message) {
    const el = document.getElementById(elementId);
    if (!el) return;
    if (!message) {
        el.hidden = true;
        el.textContent = '';
        return;
    }
    el.hidden = false;
    el.textContent = message;
}

async function refreshOrderDetailAndList(orderId) {
    const response = await adminApiRequest(`/admin/orders/${orderId}`);
    const order = response && response.data;
    if (!order) throw new Error('Order not found.');

    if (Array.isArray(adminOrdersCache)) {
        const index = adminOrdersCache.findIndex(entry => String(entry.id) === String(orderId));
        if (index >= 0) {
            adminOrdersCache[index] = order;
        }
        renderOrdersTable();
    }

    if (orderDetailOverlay && !orderDetailOverlay.hidden && orderDetailBody) {
        if (orderDetailTitle) orderDetailTitle.textContent = `Order ${order.order_number || `#${order.id}`}`;
        orderDetailBody.innerHTML = renderOrderDetailContent(order);
        wireOrderDetailActions(order.id);
    }

    return order;
}

let orderDetailActionsWired = false;

function ensureOrderDetailActionsWired() {
    if (orderDetailActionsWired || !orderDetailBody) return;
    orderDetailActionsWired = true;

    orderDetailBody.addEventListener('submit', async (event) => {
        const statusForm = event.target.closest('#orderStatusForm');
        if (statusForm) {
            event.preventDefault();
            const orderId = statusForm.dataset.orderId;
            if (!orderId || orderStatusUpdateSubmitting) return;

            const select = document.getElementById('orderStatusSelect');
            const note = document.getElementById('orderStatusNote');
            const status = select ? select.value : '';
            const submitBtn = document.getElementById('orderStatusSubmitBtn');

            showOrderDetailErrorBanner('orderStatusError', '');
            if (!status) {
                showOrderDetailErrorBanner('orderStatusError', 'Please select a status.');
                return;
            }

            orderStatusUpdateSubmitting = true;
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = 'Updating…';
            }

            try {
                await adminApiRequest(`/admin/orders/${orderId}/status`, {
                    method: 'PATCH',
                    body: { status, admin_notes: note && note.value.trim() ? note.value.trim() : undefined }
                });
                await refreshOrderDetailAndList(orderId);
            } catch (error) {
                showOrderDetailErrorBanner(
                    'orderStatusError',
                    error && error.message ? error.message : 'Could not update order status. Please try again.'
                );
            } finally {
                orderStatusUpdateSubmitting = false;
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Update Status';
                }
            }
            return;
        }

        const returnForm = event.target.closest('.admin-return-update-form');
        if (returnForm) {
            event.preventDefault();
            const returnId = returnForm.dataset.returnId;
            const orderId = returnForm.dataset.orderId;
            if (!returnId || !orderId || returnUpdateInFlight.has(returnId)) return;

            const statusSelect = returnForm.querySelector('select[name="status"]');
            const notesInput = returnForm.querySelector('textarea[name="admin_notes"]');
            const errorEl = returnForm.querySelector('.admin-return-form-error');
            const submitBtn = returnForm.querySelector('button[type="submit"]');
            const status = statusSelect ? statusSelect.value : '';
            const adminNotes = notesInput ? notesInput.value.trim() : '';

            if (errorEl) {
                errorEl.hidden = true;
                errorEl.textContent = '';
            }
            if (!status) {
                if (errorEl) {
                    errorEl.textContent = 'Please select a status.';
                    errorEl.hidden = false;
                }
                return;
            }

            returnUpdateInFlight.add(returnId);
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = 'Updating…';
            }

            try {
                await adminApiRequest(`/admin/returns/${returnId}/status`, {
                    method: 'PATCH',
                    body: { status, admin_notes: adminNotes || undefined }
                });
                await refreshOrderDetailAndList(orderId);
            } catch (error) {
                if (errorEl) {
                    errorEl.textContent = error && error.message
                        ? error.message
                        : 'Could not update return request. Please try again.';
                    errorEl.hidden = false;
                }
            } finally {
                returnUpdateInFlight.delete(returnId);
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Update Return';
                }
            }
            return;
        }

        const refundForm = event.target.closest('.admin-refund-create-form');
        if (!refundForm) return;

        event.preventDefault();
        const paymentId = refundForm.dataset.paymentId;
        const orderId = refundForm.dataset.orderId;
        const inFlightKey = `${orderId}:${paymentId}`;
        if (!paymentId || !orderId || refundCreateInFlight.has(inFlightKey)) return;

        const amountInput = refundForm.querySelector('input[name="amount"]');
        const reasonInput = refundForm.querySelector('textarea[name="reason"]');
        const errorEl = refundForm.querySelector('.admin-refund-form-error');
        const submitBtn = refundForm.querySelector('button[type="submit"]');
        const rawAmount = amountInput ? amountInput.value.trim() : '';
        const amount = roundMoneyAmount(rawAmount);
        const reason = reasonInput ? reasonInput.value.trim() : '';

        showOrderDetailErrorBanner('orderRefundError', '');
        if (errorEl) {
            errorEl.hidden = true;
            errorEl.textContent = '';
        }

        if (!rawAmount || amount == null || amount < 0.01) {
            const message = 'Refund amount must be at least 0.01.';
            if (errorEl) {
                errorEl.textContent = message;
                errorEl.hidden = false;
            }
            return;
        }

        const maxAmount = amountInput ? Number(amountInput.max) : null;
        if (Number.isFinite(maxAmount) && amount > maxAmount) {
            const message = 'Refund amount exceeds the available refundable balance.';
            if (errorEl) {
                errorEl.textContent = message;
                errorEl.hidden = false;
            }
            return;
        }

        if (reason.length > 500) {
            const message = 'Refund reason must be 500 characters or fewer.';
            if (errorEl) {
                errorEl.textContent = message;
                errorEl.hidden = false;
            }
            return;
        }

        refundCreateInFlight.add(inFlightKey);
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Creating…';
        }

        try {
            await adminApiRequest(`/admin/payments/${paymentId}/refunds`, {
                method: 'POST',
                body: {
                    payment_id: Number(paymentId),
                    order_id: Number(orderId),
                    amount,
                    reason: reason || undefined
                }
            });
            await refreshOrderDetailAndList(orderId);
        } catch (error) {
            const message = error && error.status === 403
                ? 'You do not have permission to create refunds.'
                : (error && error.message ? error.message : 'Could not create refund. Please try again.');
            if (errorEl) {
                errorEl.textContent = message;
                errorEl.hidden = false;
            } else {
                showOrderDetailErrorBanner('orderRefundError', message);
            }
        } finally {
            refundCreateInFlight.delete(inFlightKey);
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Create Refund';
            }
        }
    });

    orderDetailBody.addEventListener('click', async (event) => {
        const refundBtn = event.target.closest('[data-action="mark-refund-processed"], [data-action="mark-refund-failed"]');
        if (refundBtn && orderDetailBody.contains(refundBtn)) {
            const refundId = refundBtn.dataset.refundId;
            const paymentId = refundBtn.dataset.paymentId;
            const orderId = refundBtn.dataset.orderId;
            const action = refundBtn.dataset.action;
            if (!refundId || !paymentId || !orderId || refundStatusUpdateInFlight.has(refundId)) return;

            const status = action === 'mark-refund-processed' ? 'processed' : 'failed';
            showOrderDetailErrorBanner('orderRefundError', '');
            refundStatusUpdateInFlight.add(refundId);
            refundBtn.disabled = true;

            try {
                await adminApiRequest(`/admin/payments/${paymentId}/refunds/${refundId}/status`, {
                    method: 'PATCH',
                    body: { status }
                });
                await refreshOrderDetailAndList(orderId);
            } catch (error) {
                showOrderDetailErrorBanner(
                    'orderRefundError',
                    error && error.status === 403
                        ? 'You do not have permission to update refunds.'
                        : (error && error.message ? error.message : 'Could not update refund status. Please try again.')
                );
            } finally {
                refundStatusUpdateInFlight.delete(refundId);
                refundBtn.disabled = false;
            }
            return;
        }

        const btn = event.target.closest('[data-action="mark-payment-paid"], [data-action="mark-payment-failed"]');
        if (!btn || !orderDetailBody.contains(btn)) return;

        const paymentId = btn.dataset.paymentId;
        const orderId = btn.dataset.orderId;
        const action = btn.dataset.action;
        if (!paymentId || !orderId || paymentUpdateInFlight.has(paymentId)) return;

        showOrderDetailErrorBanner('orderPaymentError', '');
        paymentUpdateInFlight.add(paymentId);
        btn.disabled = true;

        try {
            if (action === 'mark-payment-paid') {
                await adminApiRequest(`/admin/payments/${paymentId}/paid`, { method: 'PATCH' });
            } else if (action === 'mark-payment-failed') {
                await adminApiRequest(`/admin/payments/${paymentId}/status`, {
                    method: 'PATCH',
                    body: { status: 'failed' }
                });
            }
            await refreshOrderDetailAndList(orderId);
        } catch (error) {
            showOrderDetailErrorBanner(
                'orderPaymentError',
                error && error.message ? error.message : 'Could not update payment. Please try again.'
            );
        } finally {
            paymentUpdateInFlight.delete(paymentId);
            btn.disabled = false;
        }
    });
}

function wireOrderDetailActions(orderId) {
    ensureOrderDetailActionsWired();
    const statusForm = document.getElementById('orderStatusForm');
    if (statusForm) statusForm.dataset.orderId = String(orderId);
}

async function openOrderDetail(orderId) {
    if (orderDetailLoading) return;

    if (orderDetailTitle) orderDetailTitle.textContent = 'Order Details';
    if (orderDetailBody) orderDetailBody.innerHTML = '<p class="admin-table-muted">Loading order…</p>';
    if (orderDetailOverlay) orderDetailOverlay.hidden = false;

    orderDetailLoading = true;
    try {
        const response = await adminApiRequest(`/admin/orders/${orderId}`);
        const order = response && response.data;
        if (!order) throw new Error('Order not found.');

        if (orderDetailTitle) orderDetailTitle.textContent = `Order ${order.order_number || `#${order.id}`}`;
        if (orderDetailBody) {
            orderDetailBody.innerHTML = renderOrderDetailContent(order);
            wireOrderDetailActions(order.id);
        }
    } catch (error) {
        const isForbidden = error && error.status === 403;
        if (orderDetailBody) {
            orderDetailBody.innerHTML = `<p class="admin-error-banner">${adminEscapeHtml(
                isForbidden
                    ? 'You do not have permission to view this order.'
                    : (error && error.message ? error.message : 'Could not load order details. Please try again.')
            )}</p>`;
        }
    } finally {
        orderDetailLoading = false;
    }
}

// ==========================================================================
// CUSTOMERS MANAGEMENT (Part 5)
//
// GET /admin/users and GET /admin/users/{id} did not exist on the backend
// before this phase - there was no UserController/UserResource/UserPolicy
// at all. Minimal list + detail endpoints were added, gated by the
// already-seeded `users.view` permission. Edit/disable/delete are
// deliberately NOT wired to new endpoints in this phase (per scope) - the
// buttons are shown disabled with "coming next" copy instead.
// ==========================================================================

const customerSearchInput = document.getElementById('customerSearchInput');
const customerStatusFilter = document.getElementById('customerStatusFilter');
const customersTableBody = document.getElementById('customersTableBody');
const customersCount = document.getElementById('customersCount');
const customerDetailOverlay = document.getElementById('customerDetailOverlay');
const customerDetailTitle = document.getElementById('customerDetailTitle');
const customerDetailCloseBtn = document.getElementById('customerDetailCloseBtn');
const customerDetailBody = document.getElementById('customerDetailBody');

let adminCustomersCache = null; // null = never successfully loaded yet
let adminCustomersLoading = false;

function setCustomersToolbarEnabled(enabled) {
    if (customerSearchInput) customerSearchInput.disabled = !enabled;
    if (customerStatusFilter) customerStatusFilter.disabled = !enabled;
}

function renderCustomersTableMessage(message) {
    if (!customersTableBody) return;
    customersTableBody.innerHTML = `<tr class="admin-table-message-row"><td colspan="8">${adminEscapeHtml(message)}</td></tr>`;
}

function renderCustomersTableError(message, onRetry) {
    if (!customersTableBody) return;
    customersTableBody.innerHTML = `
        <tr class="admin-table-message-row is-error">
            <td colspan="8">
                ${adminEscapeHtml(message)}
                <button type="button" class="admin-inline-retry-btn" id="customersRetryBtn">Retry</button>
            </td>
        </tr>
    `;
    const retryBtn = document.getElementById('customersRetryBtn');
    if (retryBtn) retryBtn.addEventListener('click', onRetry);
}

// Same fetch-all-pages-then-cache approach used for admin products/orders.
async function fetchAdminCustomers() {
    const perPage = 100;
    const maxPages = 50;
    let page = 1;
    let lastPage = 1;
    let all = [];

    while (page <= lastPage && page <= maxPages) {
        const response = await adminApiRequest(`/admin/users?per_page=${perPage}&page=${page}`);
        const items = Array.isArray(response && response.data) ? response.data : [];
        all = all.concat(items);
        const metaLastPage = Number(response && response.meta && response.meta.last_page);
        lastPage = Number.isFinite(metaLastPage) && metaLastPage > 0 ? metaLastPage : 1;
        page += 1;
    }

    return all;
}

async function loadCustomersSection() {
    adminCustomersLoading = true;
    setCustomersToolbarEnabled(false);
    renderCustomersTableMessage('Loading customers…');

    try {
        const customers = await fetchAdminCustomers();
        adminCustomersCache = customers;
        setCustomersToolbarEnabled(true);
        renderCustomersTable();
    } catch (error) {
        adminCustomersCache = null;
        const isForbidden = error && error.status === 403;
        renderCustomersTableError(
            isForbidden
                ? 'You do not have permission to view customers.'
                : (error && error.message ? error.message : 'Could not load customers. Please try again.'),
            loadCustomersSection
        );
    } finally {
        adminCustomersLoading = false;
    }
}

function getCustomerSearchText(customer) {
    const parts = [customer.name, customer.email, customer.phone];
    return parts.filter(Boolean).join(' ').toLowerCase();
}

function getFilteredCustomers() {
    if (!Array.isArray(adminCustomersCache)) return [];
    const search = customerSearchInput ? customerSearchInput.value.trim().toLowerCase() : '';
    const statusFilter = customerStatusFilter ? customerStatusFilter.value : '';

    return adminCustomersCache.filter(customer => {
        if (statusFilter === 'active' && !customer.is_active) return false;
        if (statusFilter === 'inactive' && customer.is_active) return false;
        if (search && !getCustomerSearchText(customer).includes(search)) return false;
        return true;
    });
}

function formatCustomerDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function getCustomerRoleLabel(customer) {
    const roles = Array.isArray(customer.roles) ? customer.roles : [];
    if (roles.length === 0) return 'Customer';
    return roles.join(', ');
}

function renderCustomerRow(customer) {
    const name = adminEscapeHtml(customer.name || '—');
    const email = adminEscapeHtml(customer.email || '—');
    const phone = adminEscapeHtml(customer.phone || '—');
    const role = adminEscapeHtml(getCustomerRoleLabel(customer));
    const statusPill = customer.is_active
        ? '<span class="admin-pill admin-pill-active">Active</span>'
        : '<span class="admin-pill admin-pill-inactive">Inactive</span>';
    const ordersCount = customer.orders_count != null ? customer.orders_count : '—';
    const joined = formatCustomerDate(customer.created_at);

    return `
        <tr>
            <td>${name}</td>
            <td>${email}</td>
            <td>${phone}</td>
            <td>${role}</td>
            <td>${statusPill}</td>
            <td>${adminEscapeHtml(String(ordersCount))}</td>
            <td>${joined}</td>
            <td>
                <div class="admin-row-actions">
                    <button type="button" class="admin-action-btn" data-action="view-customer" data-customer-id="${customer.id}">View</button>
                    <button type="button" class="admin-action-btn" disabled title="Coming in a future phase">Edit</button>
                    <button type="button" class="admin-action-btn admin-action-danger" disabled title="Coming in a future phase">Disable</button>
                </div>
            </td>
        </tr>
    `;
}

function wireCustomerRowActions() {
    customersTableBody.querySelectorAll('[data-action="view-customer"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const customer = adminCustomersCache && adminCustomersCache.find(c => String(c.id) === String(btn.dataset.customerId));
            if (customer) openCustomerDetail(customer.id);
        });
    });
}

function renderCustomersTable() {
    if (!customersTableBody) return;

    const filtered = getFilteredCustomers();

    if (customersCount) {
        const total = Array.isArray(adminCustomersCache) ? adminCustomersCache.length : 0;
        customersCount.textContent = total > 0 ? `${filtered.length} of ${total} customers` : '';
    }

    if (!Array.isArray(adminCustomersCache)) return;

    if (adminCustomersCache.length === 0) {
        renderCustomersTableMessage('No customers yet.');
        return;
    }

    if (filtered.length === 0) {
        renderCustomersTableMessage('No customers match your search/filters.');
        return;
    }

    customersTableBody.innerHTML = filtered.map(renderCustomerRow).join('');
    wireCustomerRowActions();
}

if (customerSearchInput) {
    customerSearchInput.addEventListener('input', renderCustomersTable);
}
if (customerStatusFilter) {
    customerStatusFilter.addEventListener('change', renderCustomersTable);
}

// ---- Customer detail modal ----

function closeCustomerDetail() {
    if (customerDetailOverlay) customerDetailOverlay.hidden = true;
}

if (customerDetailCloseBtn) customerDetailCloseBtn.addEventListener('click', closeCustomerDetail);
if (customerDetailOverlay) {
    customerDetailOverlay.addEventListener('click', (e) => {
        if (e.target === customerDetailOverlay) closeCustomerDetail();
    });
}
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && customerDetailOverlay && !customerDetailOverlay.hidden) {
        closeCustomerDetail();
    }
});

function renderCustomerAddresses(addresses) {
    const list = Array.isArray(addresses) ? addresses : [];
    if (list.length === 0) return '<p class="admin-table-muted">No saved addresses.</p>';

    return list.map(address => {
        const governorateName = address.governorate && address.governorate.name ? address.governorate.name : '';
        const lines = [
            address.full_name,
            address.phone,
            [address.building, address.street].filter(Boolean).join(' '),
            [address.area, address.city, governorateName].filter(Boolean).join(', '),
            address.is_default ? 'Default address' : ''
        ].filter(Boolean);

        return `
            <dl class="admin-detail-block" style="margin-bottom:14px;">
                ${lines.map(line => `<dd>${adminEscapeHtml(line)}</dd>`).join('')}
            </dl>
        `;
    }).join('');
}

function renderCustomerOrders(orders) {
    const list = Array.isArray(orders) ? orders : [];
    if (list.length === 0) return '<p class="admin-table-muted">No orders yet.</p>';

    return `
        <div class="admin-table-wrap">
            <table class="admin-table">
                <thead>
                    <tr><th>Order #</th><th>Date</th><th>Total</th><th>Status</th></tr>
                </thead>
                <tbody>
                    ${list.map(order => `
                        <tr>
                            <td>${adminEscapeHtml(order.order_number || `#${order.id}`)}</td>
                            <td>${formatCustomerDate(order.created_at)}</td>
                            <td>${adminFormatPrice(order.grand_total)}</td>
                            <td>${adminEscapeHtml(ORDER_STATUS_LABELS[order.status] || order.status || '—')}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderCustomerDetailContent(customer) {
    const statusPill = customer.is_active
        ? '<span class="admin-pill admin-pill-active">Active</span>'
        : '<span class="admin-pill admin-pill-inactive">Inactive</span>';

    return `
        <div class="admin-order-overview">
            ${statusPill}
            <span class="admin-table-muted">${adminEscapeHtml(getCustomerRoleLabel(customer))}</span>
            <span class="admin-table-muted">Joined ${formatCustomerDate(customer.created_at)}</span>
        </div>

        <div class="admin-form-section" style="margin-top:16px; padding-top:0; border-top:none;">
            <dl class="admin-detail-block">
                <dt>Name</dt><dd>${adminEscapeHtml(customer.name || '—')}</dd>
                <dt>Email</dt><dd>${adminEscapeHtml(customer.email || '—')}</dd>
                <dt>Phone</dt><dd>${adminEscapeHtml(customer.phone || '—')}</dd>
                <dt>Total Orders</dt><dd>${adminEscapeHtml(String(customer.orders_count != null ? customer.orders_count : '—'))}</dd>
            </dl>
        </div>

        <div class="admin-form-section">
            <h3>Saved Addresses</h3>
            ${renderCustomerAddresses(customer.addresses)}
        </div>

        <div class="admin-form-section">
            <h3>Recent Orders</h3>
            ${renderCustomerOrders(customer.orders)}
            <p class="admin-field-hint" style="margin-top:8px;">Showing the 10 most recent orders.</p>
        </div>

        <div class="admin-form-section">
            <h3>Account Actions</h3>
            <p class="admin-table-muted">Editing, disabling, and deleting customer accounts are coming in a future phase.</p>
        </div>
    `;
}

async function openCustomerDetail(customerId) {
    if (customerDetailTitle) customerDetailTitle.textContent = 'Customer Details';
    if (customerDetailBody) customerDetailBody.innerHTML = '<p class="admin-table-muted">Loading customer…</p>';
    if (customerDetailOverlay) customerDetailOverlay.hidden = false;

    try {
        const response = await adminApiRequest(`/admin/users/${customerId}`);
        const customer = response && response.data;
        if (!customer) throw new Error('Customer not found.');

        if (customerDetailTitle) customerDetailTitle.textContent = customer.name || 'Customer Details';
        if (customerDetailBody) customerDetailBody.innerHTML = renderCustomerDetailContent(customer);
    } catch (error) {
        const isForbidden = error && error.status === 403;
        if (customerDetailBody) {
            customerDetailBody.innerHTML = `<p class="admin-error-banner">${adminEscapeHtml(
                isForbidden
                    ? 'You do not have permission to view this customer.'
                    : (error && error.message ? error.message : 'Could not load customer details. Please try again.')
            )}</p>`;
        }
    }
}

// ==========================================================================
// SETTINGS MANAGEMENT (Part 6)
//
// Settings already had full admin endpoints (GET /admin/settings, PUT
// /admin/settings/{id}) - no backend changes were needed. Settings are
// stored one row per key (no bulk update), so "Save Changes" diffs the form
// against the loaded values and sends one PUT per changed setting. Only the
// keys that actually exist today are shown - there are no address/social
// link settings on the backend, so none are fabricated here.
// ==========================================================================

const settingsBody = document.getElementById('settingsBody');

let adminSettingsCache = null; // null = never successfully loaded yet
let adminSettingsLoading = false;
let settingsSaveSubmitting = false;

const SETTINGS_GROUP_LABELS = {
    site: 'Site',
    store: 'Store',
    checkout: 'Checkout',
    shipping: 'Shipping',
    orders: 'Orders',
    media: 'Media',
    seo: 'SEO'
};

function settingsFieldId(key) {
    return `setting-${String(key).replace(/[^a-zA-Z0-9]/g, '-')}`;
}

async function fetchAdminSettings() {
    const perPage = 100;
    const maxPages = 10;
    let page = 1;
    let lastPage = 1;
    let all = [];

    while (page <= lastPage && page <= maxPages) {
        const response = await adminApiRequest(`/admin/settings?per_page=${perPage}&page=${page}`);
        const items = Array.isArray(response && response.data) ? response.data : [];
        all = all.concat(items);
        const metaLastPage = Number(response && response.meta && response.meta.last_page);
        lastPage = Number.isFinite(metaLastPage) && metaLastPage > 0 ? metaLastPage : 1;
        page += 1;
    }

    return all;
}

async function loadSettingsSection() {
    if (!settingsBody) return;

    adminSettingsLoading = true;
    settingsBody.innerHTML = '<p class="admin-table-muted">Loading settings…</p>';

    try {
        const settings = await fetchAdminSettings();
        adminSettingsCache = settings;
        renderSettingsForm(settings);
    } catch (error) {
        adminSettingsCache = null;
        const isForbidden = error && error.status === 403;
        settingsBody.innerHTML = `
            <div class="admin-error-banner">${adminEscapeHtml(
                isForbidden
                    ? 'You do not have permission to view settings.'
                    : (error && error.message ? error.message : 'Could not load settings. Please try again.')
            )}</div>
            <button type="button" class="admin-inline-retry-btn" id="settingsRetryBtn">Retry</button>
        `;
        const retryBtn = document.getElementById('settingsRetryBtn');
        if (retryBtn) retryBtn.addEventListener('click', loadSettingsSection);
    } finally {
        adminSettingsLoading = false;
    }
}

function renderSettingsFieldInput(setting) {
    const id = settingsFieldId(setting.key);
    const key = adminEscapeHtml(setting.key);
    const value = setting.value != null ? String(setting.value) : '';

    if (setting.type === 'boolean') {
        const checked = ['1', 1, true, 'true'].includes(setting.value);
        return `<label class="admin-checkbox"><input type="checkbox" id="${id}" data-setting-key="${key}" data-setting-type="boolean" ${checked ? 'checked' : ''}> Enabled</label>`;
    }

    if (setting.type === 'integer') {
        return `<input type="number" step="1" id="${id}" data-setting-key="${key}" data-setting-type="integer" value="${adminEscapeHtml(value)}">`;
    }

    if (setting.type === 'decimal') {
        return `<input type="number" step="0.01" id="${id}" data-setting-key="${key}" data-setting-type="decimal" value="${adminEscapeHtml(value)}">`;
    }

    if (setting.type === 'json') {
        return `<textarea id="${id}" data-setting-key="${key}" data-setting-type="json" rows="3">${adminEscapeHtml(value)}</textarea>`;
    }

    if (setting.key.includes('description')) {
        return `<textarea id="${id}" data-setting-key="${key}" data-setting-type="string" rows="2">${adminEscapeHtml(value)}</textarea>`;
    }

    return `<input type="text" id="${id}" data-setting-key="${key}" data-setting-type="string" value="${adminEscapeHtml(value)}">`;
}

function renderSettingsForm(settings) {
    if (!settingsBody) return;
    const list = Array.isArray(settings) ? settings : [];

    if (list.length === 0) {
        settingsBody.innerHTML = '<p class="admin-table-muted">No settings found.</p>';
        return;
    }

    const groups = {};
    list.forEach(setting => {
        const group = setting.group || 'general';
        if (!groups[group]) groups[group] = [];
        groups[group].push(setting);
    });

    const sectionsHtml = Object.keys(groups).sort().map(group => {
        const fieldsHtml = groups[group].map(setting => `
            <div class="admin-form-field">
                <label for="${settingsFieldId(setting.key)}">${adminEscapeHtml(setting.key)}</label>
                ${renderSettingsFieldInput(setting)}
                <div class="admin-setting-meta">
                    ${setting.description ? `<span class="admin-field-hint">${adminEscapeHtml(setting.description)}</span>` : ''}
                    <span class="admin-field-hint">${setting.is_public ? '(public)' : '(internal)'}</span>
                </div>
            </div>
        `).join('');

        return `
            <div class="admin-form-section">
                <h3>${adminEscapeHtml(SETTINGS_GROUP_LABELS[group] || group)}</h3>
                <div class="admin-form-grid">${fieldsHtml}</div>
            </div>
        `;
    }).join('');

    settingsBody.innerHTML = `
        <div class="admin-error-banner" id="settingsFormError" hidden></div>
        <div class="admin-form-success" id="settingsFormSuccess" hidden></div>
        <form id="settingsForm">
            ${sectionsHtml}
            <div class="admin-modal-footer" style="justify-content:flex-start; border-top:none; margin-top:8px;">
                <button type="submit" class="admin-btn-primary" id="settingsSaveBtn">Save Changes</button>
            </div>
        </form>
    `;

    wireSettingsForm();
}

function collectChangedSettings() {
    if (!Array.isArray(adminSettingsCache)) return [];
    const changed = [];

    adminSettingsCache.forEach(setting => {
        const el = document.querySelector(`[data-setting-key="${setting.key}"]`);
        if (!el) return;

        const newValue = setting.type === 'boolean' ? (el.checked ? '1' : '0') : el.value;
        const originalValue = setting.value != null ? String(setting.value) : '';

        if (newValue !== originalValue) {
            changed.push({ id: setting.id, key: setting.key, type: setting.type, value: newValue });
        }
    });

    return changed;
}

function wireSettingsForm() {
    const form = document.getElementById('settingsForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (settingsSaveSubmitting) return;

        const errorBox = document.getElementById('settingsFormError');
        const successBox = document.getElementById('settingsFormSuccess');
        const saveBtn = document.getElementById('settingsSaveBtn');

        if (errorBox) errorBox.hidden = true;
        if (successBox) successBox.hidden = true;

        const changed = collectChangedSettings();

        if (changed.length === 0) {
            if (successBox) {
                successBox.textContent = 'No changes to save.';
                successBox.hidden = false;
            }
            return;
        }

        const jsonErrors = [];
        changed.forEach(item => {
            if (item.type === 'json' && item.value) {
                try {
                    JSON.parse(item.value);
                } catch (err) {
                    jsonErrors.push(`"${item.key}" must be valid JSON.`);
                }
            }
        });

        if (jsonErrors.length > 0) {
            if (errorBox) {
                errorBox.textContent = jsonErrors.join(' ');
                errorBox.hidden = false;
            }
            return;
        }

        settingsSaveSubmitting = true;
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving…';
        }

        const failures = [];

        for (const item of changed) {
            try {
                await adminApiRequest(`/admin/settings/${item.id}`, {
                    method: 'PUT',
                    body: { value: item.value === '' ? null : item.value }
                });
            } catch (error) {
                failures.push(`"${item.key}": ${error && error.message ? error.message : 'failed'}`);
            }
        }

        settingsSaveSubmitting = false;
        adminSettingsCache = null; // force a fresh reload so the form reflects saved values
        await loadSettingsSection();

        if (failures.length > 0) {
            const box = document.getElementById('settingsFormError');
            if (box) {
                box.textContent = `${changed.length - failures.length} of ${changed.length} setting(s) saved. Failed: ${failures.join(' ')}`;
                box.hidden = false;
            }
        } else {
            const box = document.getElementById('settingsFormSuccess');
            if (box) {
                box.textContent = 'Settings saved successfully.';
                box.hidden = false;
            }
        }
    });
}

// ==========================================================================
// PRODUCT CREATE/EDIT FORM (Part 3)
//
// Two backend constraints shape this form:
// 1. POST /admin/products does NOT accept nested variants/images - variants
//    are separate POST/PATCH/DELETE calls to /admin/product-variants after
//    the product itself is saved.
// 2. There is no list endpoint for Colors/Sizes, so variant rows take a
//    numeric Color ID / Size ID directly instead of a dropdown (see the
//    on-screen TODO hint). Edit mode shows the current color/size name next
//    to the ID, read from the already-loaded variant data, for reference.
// ==========================================================================

const addProductBtn = document.getElementById('addProductBtn');
const productFormOverlay = document.getElementById('productFormOverlay');
const productFormTitle = document.getElementById('productFormTitle');
const productFormCloseBtn = document.getElementById('productFormCloseBtn');
const productFormCancelBtn = document.getElementById('productFormCancelBtn');
const productFormSubmitBtn = document.getElementById('productFormSubmitBtn');
const productFormError = document.getElementById('productFormError');
const productForm = document.getElementById('productForm');
const pfName = document.getElementById('pfName');
const pfSlug = document.getElementById('pfSlug');
const pfCategory = document.getElementById('pfCategory');
const pfBasePrice = document.getElementById('pfBasePrice');
const pfComparePrice = document.getElementById('pfComparePrice');
const pfDescription = document.getElementById('pfDescription');
const pfIsActive = document.getElementById('pfIsActive');
const pfIsFeaturedDrop = document.getElementById('pfIsFeaturedDrop');
const pfIsNewArrival = document.getElementById('pfIsNewArrival');
const pfIsBestSeller = document.getElementById('pfIsBestSeller');
const pfAddVariantBtn = document.getElementById('pfAddVariantBtn');
const pfVariantsList = document.getElementById('pfVariantsList');
const pfImagesSection = document.getElementById('pfImagesSection');
const pfImagesList = document.getElementById('pfImagesList');

let productFormMode = 'create'; // 'create' | 'edit'
let productFormProductId = null;
let productFormSubmitting = false;
let productFormSlugManuallyEdited = false;
let adminCategoriesCache = null;

function slugify(text) {
    return String(text || '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function showProductFormError(message) {
    if (!productFormError) return;
    productFormError.textContent = message;
    productFormError.hidden = false;
}

function hideProductFormError() {
    if (!productFormError) return;
    productFormError.hidden = true;
}

function setProductFormBusy(isBusy, label) {
    if (productFormSubmitBtn) {
        productFormSubmitBtn.disabled = isBusy;
        productFormSubmitBtn.textContent = isBusy ? (label || 'Saving…') : 'Save Product';
    }
    if (productFormCancelBtn) productFormCancelBtn.disabled = isBusy;
    if (productFormCloseBtn) productFormCloseBtn.disabled = isBusy;
}

// Fetches every page of GET /admin/categories, same pagination-aware
// approach used for products, so the dropdown reflects the full list.
async function fetchAllAdminCategories() {
    const perPage = 100;
    const maxPages = 20;
    let page = 1;
    let lastPage = 1;
    let all = [];

    while (page <= lastPage && page <= maxPages) {
        const response = await adminApiRequest(`/admin/categories?per_page=${perPage}&page=${page}`);
        const items = Array.isArray(response && response.data) ? response.data : [];
        all = all.concat(items);
        const metaLastPage = Number(response && response.meta && response.meta.last_page);
        lastPage = Number.isFinite(metaLastPage) && metaLastPage > 0 ? metaLastPage : 1;
        page += 1;
    }

    return all;
}

function populateCategorySelect(categories) {
    if (!pfCategory) return;
    const sorted = [...categories].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    pfCategory.innerHTML = '<option value="">Select a category…</option>' +
        sorted.map(c => `<option value="${c.id}">${adminEscapeHtml(c.name)}</option>`).join('');
}

async function ensureCategoriesLoaded() {
    if (adminCategoriesCache) {
        populateCategorySelect(adminCategoriesCache);
        return;
    }
    if (pfCategory) pfCategory.innerHTML = '<option value="">Loading categories…</option>';
    try {
        adminCategoriesCache = await fetchAllAdminCategories();
        populateCategorySelect(adminCategoriesCache);
    } catch (error) {
        console.warn('AFIFI Admin: could not load categories.', error);
        if (pfCategory) pfCategory.innerHTML = '<option value="">Could not load categories</option>';
    }
}

function renderProductFormImages(images) {
    if (!pfImagesSection || !pfImagesList) return;
    const list = Array.isArray(images) ? images : [];

    pfImagesSection.hidden = false;

    if (list.length === 0) {
        pfImagesList.innerHTML = '<span class="admin-table-muted">No images yet.</span>';
        return;
    }

    pfImagesList.innerHTML = list.map(img => {
        const path = img && img.media && img.media.path;
        const url = adminResolveMediaUrl(path) || ADMIN_PRODUCT_PLACEHOLDER_IMAGE;
        const alt = adminEscapeHtml(img.alt_text || 'Product image');
        return `<img class="admin-form-image-thumb" src="${adminEscapeHtml(url)}" alt="${alt}" onerror="this.src='${ADMIN_PRODUCT_PLACEHOLDER_IMAGE}'">`;
    }).join('');
}

// Builds one variant row. `variant` is either a real API variant object
// (edit mode) or omitted/undefined (blank new row).
function addVariantRow(variant) {
    if (!pfVariantsList) return;

    const row = document.createElement('div');
    row.className = 'admin-variant-row';
    row.dataset.variantRow = 'true';

    const isExisting = Boolean(variant && variant.id);
    if (isExisting) row.dataset.variantId = variant.id;

    const colorId = variant ? (variant.color_id != null ? variant.color_id : (variant.color && variant.color.id)) : '';
    const sizeId = variant ? (variant.size_id != null ? variant.size_id : (variant.size && variant.size.id)) : '';
    const colorHint = variant && variant.color && variant.color.name ? ` (currently: ${adminEscapeHtml(variant.color.name)})` : '';
    const sizeHint = variant && variant.size && variant.size.name ? ` (currently: ${adminEscapeHtml(variant.size.name)})` : '';
    const sku = variant && variant.sku ? adminEscapeHtml(variant.sku) : '';
    const stock = variant && variant.stock != null ? variant.stock : 0;

    row.innerHTML = `
        <div class="admin-form-field">
            <label>SKU *</label>
            <input type="text" data-field="sku" maxlength="255" value="${sku}">
        </div>
        <div class="admin-form-field">
            <label>Color ID *${colorHint}</label>
            <input type="number" data-field="color_id" min="1" value="${colorId !== '' && colorId != null ? colorId : ''}">
        </div>
        <div class="admin-form-field">
            <label>Size ID *${sizeHint}</label>
            <input type="number" data-field="size_id" min="1" value="${sizeId !== '' && sizeId != null ? sizeId : ''}">
        </div>
        <div class="admin-form-field">
            <label>Stock</label>
            <input type="number" data-field="stock" min="0" value="${stock}">
        </div>
        <button type="button" class="admin-action-btn admin-action-danger" data-remove-variant-row>${isExisting ? 'Delete' : 'Remove'}</button>
    `;

    pfVariantsList.appendChild(row);
    row.querySelector('[data-remove-variant-row]').addEventListener('click', () => handleRemoveVariantRow(row));
}

// Existing variants are deleted immediately (with confirmation) rather than
// staged, so the form never hides a pending destructive action behind
// "Cancel". New, never-saved rows just disappear from the DOM.
async function handleRemoveVariantRow(row) {
    const variantId = row.dataset.variantId;
    if (!variantId) {
        row.remove();
        return;
    }

    const confirmed = window.confirm('Delete this variant now? This cannot be undone by cancelling the form.');
    if (!confirmed) return;

    const btn = row.querySelector('[data-remove-variant-row]');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Deleting…';
    }

    try {
        await adminApiRequest(`/admin/product-variants/${variantId}`, { method: 'DELETE' });
        row.remove();
    } catch (error) {
        showProductFormError(error && error.message ? error.message : 'Could not delete variant. Please try again.');
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Delete';
        }
    }
}

if (pfAddVariantBtn) {
    pfAddVariantBtn.addEventListener('click', () => addVariantRow());
}

function resetProductForm() {
    if (productForm) productForm.reset();
    productFormSlugManuallyEdited = false;
    if (pfVariantsList) pfVariantsList.innerHTML = '';
    if (pfImagesSection) pfImagesSection.hidden = true;
    if (pfImagesList) pfImagesList.innerHTML = '';
    hideProductFormError();
    setProductFormBusy(false); // guards against reopening right after a save left the submit button mid-label
}

function populateProductForm(product) {
    if (pfName) pfName.value = product.name || '';
    if (pfSlug) pfSlug.value = product.slug || '';
    productFormSlugManuallyEdited = true; // don't silently rewrite an existing product's slug/URL
    if (pfCategory) pfCategory.value = String(product.category_id || (product.category && product.category.id) || '');
    if (pfBasePrice) pfBasePrice.value = product.base_price != null ? product.base_price : '';
    if (pfComparePrice) pfComparePrice.value = product.compare_at_price != null ? product.compare_at_price : '';
    if (pfDescription) pfDescription.value = product.description || '';
    if (pfIsActive) pfIsActive.checked = Boolean(product.is_active);
    if (pfIsFeaturedDrop) pfIsFeaturedDrop.checked = Boolean(product.is_featured_drop);
    if (pfIsNewArrival) pfIsNewArrival.checked = Boolean(product.is_new_arrival);
    if (pfIsBestSeller) pfIsBestSeller.checked = Boolean(product.is_best_seller);

    if (pfVariantsList) pfVariantsList.innerHTML = '';
    const variants = Array.isArray(product.variants) ? product.variants : [];
    variants.forEach(variant => addVariantRow(variant));

    renderProductFormImages(product.images);
}

function closeProductForm() {
    if (productFormSubmitting) return;
    if (productFormOverlay) productFormOverlay.hidden = true;
}

async function openProductForm(mode, product) {
    productFormMode = mode;
    productFormProductId = product ? product.id : null;
    resetProductForm();

    if (productFormTitle) productFormTitle.textContent = mode === 'edit' ? 'Edit Product' : 'Add Product';
    if (productFormOverlay) productFormOverlay.hidden = false;

    ensureCategoriesLoaded();

    if (mode === 'edit' && productFormProductId) {
        setProductFormBusy(true, 'Loading product…');
        try {
            const response = await adminApiRequest(`/admin/products/${productFormProductId}`);
            const fresh = response && response.data;
            if (fresh) populateProductForm(fresh);
            else showProductFormError('Could not load product details.');
        } catch (error) {
            showProductFormError(error && error.message ? error.message : 'Could not load product details. Please try again.');
        } finally {
            setProductFormBusy(false);
        }
    } else {
        addVariantRow();
    }

    if (pfName) pfName.focus();
}

if (addProductBtn) {
    addProductBtn.addEventListener('click', () => openProductForm('create', null));
}

if (productFormCloseBtn) productFormCloseBtn.addEventListener('click', closeProductForm);
if (productFormCancelBtn) productFormCancelBtn.addEventListener('click', closeProductForm);

if (productFormOverlay) {
    productFormOverlay.addEventListener('click', (e) => {
        if (e.target === productFormOverlay) closeProductForm();
    });
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && productFormOverlay && !productFormOverlay.hidden) {
        closeProductForm();
    }
});

if (pfName) {
    pfName.addEventListener('input', () => {
        if (!productFormSlugManuallyEdited && pfSlug) {
            pfSlug.value = slugify(pfName.value);
        }
    });
}

if (pfSlug) {
    pfSlug.addEventListener('input', () => {
        productFormSlugManuallyEdited = true;
    });
}

function validateProductFormValues(values) {
    const errors = [];
    if (!values.name) errors.push('Name is required.');
    if (!values.slug) errors.push('Slug is required.');
    if (!values.category_id) errors.push('Category is required.');
    if (values.base_price === '' || !Number.isFinite(Number(values.base_price)) || Number(values.base_price) < 0) {
        errors.push('A valid price is required.');
    }
    if (values.compare_at_price !== '' && (!Number.isFinite(Number(values.compare_at_price)) || Number(values.compare_at_price) < 0)) {
        errors.push('Compare-at price must be a valid non-negative number.');
    }
    return errors;
}

// Reads variant rows from the DOM. Completely blank *new* rows are skipped
// silently (an admin who clicked "+ Add Variant" but changed their mind
// shouldn't be blocked from saving); partially-filled rows are flagged.
function collectVariantRowsForSubmit() {
    const rows = pfVariantsList ? Array.from(pfVariantsList.querySelectorAll('[data-variant-row]')) : [];
    const variants = [];
    const errors = [];

    rows.forEach((row, index) => {
        const id = row.dataset.variantId || null;
        const sku = row.querySelector('[data-field="sku"]').value.trim();
        const colorId = row.querySelector('[data-field="color_id"]').value.trim();
        const sizeId = row.querySelector('[data-field="size_id"]').value.trim();
        const stock = row.querySelector('[data-field="stock"]').value.trim();

        const isCompletelyEmpty = !sku && !colorId && !sizeId && !stock;
        if (!id && isCompletelyEmpty) return;

        if (!sku || !colorId || !sizeId) {
            errors.push(`Variant ${index + 1}: SKU, Color ID, and Size ID are required.`);
            return;
        }

        variants.push({
            id,
            sku,
            color_id: Number(colorId),
            size_id: Number(sizeId),
            stock: stock ? Number(stock) : 0
        });
    });

    return { variants, errors };
}

// Variants are saved one request at a time after the product itself is
// saved (the backend has no nested-create). Failures are collected instead
// of aborting, so one bad SKU doesn't hide the fact everything else saved.
async function saveVariants(productId, variants) {
    const failures = [];

    for (const variant of variants) {
        const body = {
            sku: variant.sku,
            color_id: variant.color_id,
            size_id: variant.size_id,
            stock: variant.stock
        };

        try {
            if (variant.id) {
                await adminApiRequest(`/admin/product-variants/${variant.id}`, { method: 'PATCH', body });
            } else {
                await adminApiRequest('/admin/product-variants', {
                    method: 'POST',
                    body: { ...body, product_id: productId }
                });
            }
        } catch (error) {
            failures.push(`"${variant.sku}": ${error && error.message ? error.message : 'failed'}`);
        }
    }

    return failures;
}

if (productForm) {
    productForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (productFormSubmitting) return;

        hideProductFormError();

        const values = {
            name: pfName ? pfName.value.trim() : '',
            slug: pfSlug ? pfSlug.value.trim() : '',
            category_id: pfCategory ? pfCategory.value : '',
            base_price: pfBasePrice ? pfBasePrice.value.trim() : '',
            compare_at_price: pfComparePrice ? pfComparePrice.value.trim() : '',
            description: pfDescription ? pfDescription.value.trim() : ''
        };

        const fieldErrors = validateProductFormValues(values);
        const { variants, errors: variantErrors } = collectVariantRowsForSubmit();
        const allErrors = fieldErrors.concat(variantErrors);

        if (allErrors.length > 0) {
            showProductFormError(allErrors.join(' '));
            return;
        }

        const payload = {
            name: values.name,
            slug: values.slug,
            category_id: Number(values.category_id),
            base_price: Number(values.base_price),
            compare_at_price: values.compare_at_price ? Number(values.compare_at_price) : null,
            description: values.description || null,
            is_active: Boolean(pfIsActive && pfIsActive.checked),
            is_featured_drop: Boolean(pfIsFeaturedDrop && pfIsFeaturedDrop.checked),
            is_new_arrival: Boolean(pfIsNewArrival && pfIsNewArrival.checked),
            is_best_seller: Boolean(pfIsBestSeller && pfIsBestSeller.checked)
        };

        productFormSubmitting = true;
        setProductFormBusy(true, productFormMode === 'edit' ? 'Saving changes…' : 'Creating product…');

        try {
            let productId = productFormProductId;

            if (productFormMode === 'edit') {
                await adminApiRequest(`/admin/products/${productId}`, { method: 'PATCH', body: payload });
            } else {
                const response = await adminApiRequest('/admin/products', { method: 'POST', body: payload });
                productId = response && response.data && response.data.id;
            }

            const variantFailures = await saveVariants(productId, variants);

            adminProductsCache = null; // force a fresh reload so the table reflects the save
            productFormSubmitting = false;
            closeProductForm();
            await loadProductsSection();

            if (variantFailures.length > 0) {
                showProductsActionError(`Product saved, but ${variantFailures.length} variant(s) failed: ${variantFailures.join(' ')}`);
            }
        } catch (error) {
            productFormSubmitting = false;
            setProductFormBusy(false);
            showProductFormError(error && error.message ? error.message : 'Could not save product. Please check the form and try again.');
        }
    });
}

// ==========================================================================
// ROLES & PERMISSIONS MANAGEMENT (Part 8)
//
// Brand new backend surface for this phase: no roles/permissions API existed
// before, so GET/PUT /admin/roles* and GET /admin/permissions were added
// following the same permission-per-resource pattern as every other admin
// domain (roles.view / roles.manage). super_admin's own permission set is
// blocked from editing on the backend (RolePolicy::update), not just in this
// UI, since disabling checkboxes alone is not a real security boundary.
// ==========================================================================

const rolesCount = document.getElementById('rolesCount');
const rolesTableBody = document.getElementById('rolesTableBody');
const roleDetailOverlay = document.getElementById('roleDetailOverlay');
const roleDetailTitle = document.getElementById('roleDetailTitle');
const roleDetailCloseBtn = document.getElementById('roleDetailCloseBtn');
const roleDetailBody = document.getElementById('roleDetailBody');

let adminRolesCache = null; // null = never successfully loaded yet
let adminRolesLoading = false;
let adminAllPermissionsCache = null;
let rolePermissionsSubmitting = false;

function renderRolesTableMessage(message) {
    if (!rolesTableBody) return;
    rolesTableBody.innerHTML = `<tr class="admin-table-message-row"><td colspan="4">${adminEscapeHtml(message)}</td></tr>`;
    if (rolesCount) rolesCount.textContent = '';
}

function renderRolesTableError(message, onRetry) {
    if (!rolesTableBody) return;
    rolesTableBody.innerHTML = `
        <tr class="admin-table-message-row is-error">
            <td colspan="4">
                ${adminEscapeHtml(message)}
                <button type="button" class="admin-inline-retry-btn" id="rolesRetryBtn">Retry</button>
            </td>
        </tr>
    `;
    if (rolesCount) rolesCount.textContent = '';
    const retryBtn = document.getElementById('rolesRetryBtn');
    if (retryBtn) retryBtn.addEventListener('click', onRetry);
}

async function fetchAdminRoles() {
    const response = await adminApiRequest('/admin/roles');
    return Array.isArray(response && response.data) ? response.data : [];
}

async function loadRolesSection() {
    adminRolesLoading = true;
    renderRolesTableMessage('Loading roles…');

    try {
        const roles = await fetchAdminRoles();
        adminRolesCache = roles;
        renderRolesTable(roles);
    } catch (error) {
        adminRolesCache = null;
        const isForbidden = error && error.status === 403;
        renderRolesTableError(
            isForbidden
                ? 'You do not have permission to view roles.'
                : (error && error.message ? error.message : 'Could not load roles. Please try again.'),
            loadRolesSection
        );
    } finally {
        adminRolesLoading = false;
    }
}

function renderRoleRow(role) {
    const name = adminEscapeHtml(role.name || '—');
    const badge = role.is_super_admin ? ' <span class="admin-pill admin-pill-featured">Super Admin</span>' : '';
    const permissionsCount = role.permissions_count != null ? role.permissions_count : '—';
    const usersCount = role.users_count != null ? role.users_count : '—';

    return `
        <tr data-role-id="${role.id}">
            <td>${name}${badge}</td>
            <td>${adminEscapeHtml(String(permissionsCount))}</td>
            <td>${adminEscapeHtml(String(usersCount))}</td>
            <td>
                <div class="admin-row-actions">
                    <button type="button" class="admin-action-btn" data-action="view-role" data-role-id="${role.id}">View</button>
                </div>
            </td>
        </tr>
    `;
}

function wireRoleRowActions() {
    if (!rolesTableBody) return;
    rolesTableBody.querySelectorAll('[data-action="view-role"]').forEach(btn => {
        btn.addEventListener('click', () => openRoleDetail(btn.dataset.roleId));
    });
}

function renderRolesTable(roles) {
    if (!rolesTableBody) return;
    const list = Array.isArray(roles) ? roles : [];

    if (list.length === 0) {
        renderRolesTableMessage('No roles found.');
        return;
    }

    rolesTableBody.innerHTML = list.map(renderRoleRow).join('');
    if (rolesCount) rolesCount.textContent = `${list.length} role${list.length === 1 ? '' : 's'}`;
    wireRoleRowActions();
}

// GET /admin/permissions is the full system permission list, used to render
// every checkbox (including ones NOT assigned to the role being viewed).
// Cached for the session since permissions are effectively static reference
// data - only reset alongside adminRolesCache on the next full reload.
async function fetchAllPermissions() {
    if (Array.isArray(adminAllPermissionsCache)) return adminAllPermissionsCache;
    const response = await adminApiRequest('/admin/permissions');
    adminAllPermissionsCache = Array.isArray(response && response.data) ? response.data : [];
    return adminAllPermissionsCache;
}

function groupPermissionsByDomain(permissions) {
    const groups = {};
    (Array.isArray(permissions) ? permissions : []).forEach(permission => {
        const domain = String(permission.name || '').split('.')[0] || 'other';
        if (!groups[domain]) groups[domain] = [];
        groups[domain].push(permission);
    });
    return groups;
}

function renderRoleUsersList(users) {
    const list = Array.isArray(users) ? users : [];
    if (list.length === 0) return '<p class="admin-table-muted">No users are assigned to this role.</p>';

    return `
        <ul class="admin-role-users-list">
            ${list.map(user => `
                <li>${adminEscapeHtml(user.name || 'Unnamed user')} <span class="admin-table-muted">(${adminEscapeHtml(user.email || '—')})</span></li>
            `).join('')}
        </ul>
    `;
}

function renderRoleDetailContent(role, allPermissions) {
    const isSuperAdmin = Boolean(role.is_super_admin);
    const assignedNames = new Set((Array.isArray(role.permissions) ? role.permissions : []).map(p => p.name));
    const groups = groupPermissionsByDomain(allPermissions);
    const domainKeys = Object.keys(groups).sort();

    const permissionGroupsHtml = domainKeys.length > 0 ? domainKeys.map(domain => {
        const checkboxesHtml = groups[domain].map(permission => `
            <label class="admin-checkbox">
                <input type="checkbox" data-permission-name="${adminEscapeHtml(permission.name)}" ${assignedNames.has(permission.name) ? 'checked' : ''} ${isSuperAdmin ? 'disabled' : ''}>
                ${adminEscapeHtml(permission.name)}
            </label>
        `).join('');

        return `
            <div class="admin-permission-group">
                <h4>${adminEscapeHtml(domain)}</h4>
                <div class="admin-permission-grid">${checkboxesHtml}</div>
            </div>
        `;
    }).join('') : '<p class="admin-table-muted">No permissions exist in the system yet.</p>';

    const permissionsCount = role.permissions_count != null ? role.permissions_count : assignedNames.size;
    const usersCount = role.users_count != null ? role.users_count : (Array.isArray(role.users) ? role.users.length : 0);

    return `
        <div class="admin-order-overview">
            <span class="admin-pill admin-pill-active">${adminEscapeHtml(String(permissionsCount))} permissions</span>
            <span class="admin-table-muted">${adminEscapeHtml(String(usersCount))} users</span>
            ${isSuperAdmin ? '<span class="admin-pill admin-pill-featured">Super Admin</span>' : ''}
        </div>

        <form id="roleForm">
            <div class="admin-form-section" style="margin-top:16px;">
                <div class="admin-form-section-header">
                    <h3>Permissions</h3>
                </div>
                <div class="admin-error-banner" id="roleFormError" hidden></div>
                <div class="admin-form-success" id="roleFormSuccess" hidden></div>
                ${isSuperAdmin ? '<p class="admin-field-hint" style="margin-bottom:12px;">super_admin always has every permission. This cannot be changed.</p>' : ''}
                ${permissionGroupsHtml}
            </div>

            ${isSuperAdmin ? '' : `
                <div class="admin-modal-footer" style="justify-content:flex-start; border-top:none;">
                    <button type="submit" class="admin-btn-primary" id="roleFormSubmitBtn">Save Permissions</button>
                </div>
            `}
        </form>

        <div class="admin-form-section">
            <div class="admin-form-section-header">
                <h3>Users with this Role</h3>
            </div>
            ${renderRoleUsersList(role.users)}
        </div>

        <div class="admin-form-section">
            <div class="admin-form-section-header">
                <h3>Assign Users to this Role</h3>
            </div>
            <p class="admin-table-muted">Assigning or removing this role from a user is coming in a future phase.</p>
        </div>
    `;
}

function wireRoleForm(roleId) {
    const form = document.getElementById('roleForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (rolePermissionsSubmitting) return;

        const errorBox = document.getElementById('roleFormError');
        const successBox = document.getElementById('roleFormSuccess');
        const submitBtn = document.getElementById('roleFormSubmitBtn');

        if (errorBox) errorBox.hidden = true;
        if (successBox) successBox.hidden = true;

        const checkboxes = form.querySelectorAll('input[data-permission-name]');
        const permissions = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.dataset.permissionName);

        rolePermissionsSubmitting = true;
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Saving…';
        }

        try {
            const response = await adminApiRequest(`/admin/roles/${roleId}/permissions`, {
                method: 'PUT',
                body: { permissions }
            });

            adminRolesCache = null; // force a fresh reload so the list reflects the new counts
            const role = response && response.data;
            if (role) {
                if (roleDetailTitle) roleDetailTitle.textContent = role.name || 'Role Details';
                if (roleDetailBody) {
                    const allPermissions = await fetchAllPermissions();
                    roleDetailBody.innerHTML = renderRoleDetailContent(role, allPermissions);
                    wireRoleForm(roleId);
                    const newSuccessBox = document.getElementById('roleFormSuccess');
                    if (newSuccessBox) {
                        newSuccessBox.textContent = 'Permissions saved successfully.';
                        newSuccessBox.hidden = false;
                    }
                }
            }
        } catch (error) {
            rolePermissionsSubmitting = false;
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Save Permissions';
            }
            const isForbidden = error && error.status === 403;
            if (errorBox) {
                errorBox.textContent = isForbidden
                    ? 'You do not have permission to change this role\u2019s permissions.'
                    : (error && error.message ? error.message : 'Could not save permissions. Please try again.');
                errorBox.hidden = false;
            }
            return;
        }

        rolePermissionsSubmitting = false;
    });
}

async function openRoleDetail(roleId) {
    if (roleDetailTitle) roleDetailTitle.textContent = 'Role Details';
    if (roleDetailBody) roleDetailBody.innerHTML = '<p class="admin-table-muted">Loading role…</p>';
    if (roleDetailOverlay) roleDetailOverlay.hidden = false;

    try {
        const [roleResponse, allPermissions] = await Promise.all([
            adminApiRequest(`/admin/roles/${roleId}`),
            fetchAllPermissions()
        ]);
        const role = roleResponse && roleResponse.data;
        if (!role) throw new Error('Role not found.');

        if (roleDetailTitle) roleDetailTitle.textContent = role.name || 'Role Details';
        if (roleDetailBody) {
            roleDetailBody.innerHTML = renderRoleDetailContent(role, allPermissions);
            wireRoleForm(role.id);
        }
    } catch (error) {
        const isForbidden = error && error.status === 403;
        if (roleDetailBody) {
            roleDetailBody.innerHTML = `<p class="admin-error-banner">${adminEscapeHtml(
                isForbidden
                    ? 'You do not have permission to view this role.'
                    : (error && error.message ? error.message : 'Could not load role details. Please try again.')
            )}</p>`;
        }
    }
}

function closeRoleDetail() {
    if (roleDetailOverlay) roleDetailOverlay.hidden = true;
}

if (roleDetailCloseBtn) roleDetailCloseBtn.addEventListener('click', closeRoleDetail);
if (roleDetailOverlay) {
    roleDetailOverlay.addEventListener('click', (e) => {
        if (e.target === roleDetailOverlay) closeRoleDetail();
    });
}
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && roleDetailOverlay && !roleDetailOverlay.hidden) {
        closeRoleDetail();
    }
});

// ==========================================================================
// COUPONS / PROMOTIONS MANAGEMENT (Part 9)
//
// Full CRUD already existed on the backend (GET/POST/PATCH/DELETE
// /admin/coupons under permission:coupons.manage) - no backend changes were
// needed for this phase. used_count is server-managed (only incremented at
// checkout) and is never sent from this form. Coupon has no SoftDeletes, so
// destroy() is a real hard delete - confirmed clearly before calling it.
// ==========================================================================

const couponSearchInput = document.getElementById('couponSearchInput');
const couponTypeFilter = document.getElementById('couponTypeFilter');
const couponStatusFilter = document.getElementById('couponStatusFilter');
const couponsTableBody = document.getElementById('couponsTableBody');
const couponsCount = document.getElementById('couponsCount');
const couponsActionError = document.getElementById('couponsActionError');
const addCouponBtn = document.getElementById('addCouponBtn');

let adminCouponsCache = null; // null = never successfully loaded yet
let adminCouponsLoading = false;

function showCouponsActionError(message) {
    if (!couponsActionError) return;
    couponsActionError.textContent = message;
    couponsActionError.hidden = false;
}

function hideCouponsActionError() {
    if (!couponsActionError) return;
    couponsActionError.hidden = true;
}

function setCouponsToolbarEnabled(enabled) {
    if (couponSearchInput) couponSearchInput.disabled = !enabled;
    if (couponTypeFilter) couponTypeFilter.disabled = !enabled;
    if (couponStatusFilter) couponStatusFilter.disabled = !enabled;
}

function renderCouponsTableMessage(text) {
    if (!couponsTableBody) return;
    couponsTableBody.innerHTML = `<tr class="admin-table-message-row"><td colspan="7">${adminEscapeHtml(text)}</td></tr>`;
    if (couponsCount) couponsCount.textContent = '';
}

function renderCouponsTableError(message) {
    if (!couponsTableBody) return;
    couponsTableBody.innerHTML = `
        <tr class="admin-table-message-row is-error">
            <td colspan="7">
                ${adminEscapeHtml(message)}
                <button type="button" class="admin-inline-retry-btn" id="couponsRetryBtn">RETRY</button>
            </td>
        </tr>`;
    if (couponsCount) couponsCount.textContent = '';
    const retryBtn = document.getElementById('couponsRetryBtn');
    if (retryBtn) retryBtn.addEventListener('click', loadCouponsSection);
}

// Same fetch-all-pages-then-cache approach used for admin products/orders/customers.
async function fetchAdminCoupons() {
    const perPage = 100;
    const maxPages = 20;
    let page = 1;
    let lastPage = 1;
    let all = [];

    while (page <= lastPage && page <= maxPages) {
        const response = await adminApiRequest(`/admin/coupons?per_page=${perPage}&page=${page}`);
        const items = Array.isArray(response && response.data) ? response.data : [];
        all = all.concat(items);
        const metaLastPage = Number(response && response.meta && response.meta.last_page);
        lastPage = Number.isFinite(metaLastPage) && metaLastPage > 0 ? metaLastPage : 1;
        page += 1;
    }

    return all;
}

async function loadCouponsSection() {
    if (adminCouponsLoading) return;
    adminCouponsLoading = true;
    hideCouponsActionError();
    setCouponsToolbarEnabled(false);
    renderCouponsTableMessage('Loading coupons…');

    try {
        const coupons = await fetchAdminCoupons();
        adminCouponsCache = coupons;
        setCouponsToolbarEnabled(true);
        renderCouponsTable();
    } catch (error) {
        adminCouponsCache = null;
        const message = error && error.status === 403
            ? 'You do not have permission to view coupons.'
            : (error && error.message ? error.message : 'Could not load coupons. Please try again.');
        renderCouponsTableError(message);
    } finally {
        adminCouponsLoading = false;
    }
}

function isCouponExpired(coupon) {
    if (!coupon.expires_at) return false;
    const date = new Date(coupon.expires_at);
    return !Number.isNaN(date.getTime()) && date.getTime() < Date.now();
}

// is_active and expiry are both real backend fields, but there is no single
// combined "status" field - derive one client-side the same way products
// derive a "Sold Out" status from stock.
function getCouponStatusInfo(coupon) {
    if (!coupon.is_active) return { key: 'inactive', label: 'Inactive' };
    if (isCouponExpired(coupon)) return { key: 'expired', label: 'Expired' };
    return { key: 'active', label: 'Active' };
}

function getFilteredCoupons() {
    if (!Array.isArray(adminCouponsCache)) return [];
    const query = ((couponSearchInput && couponSearchInput.value) || '').trim().toLowerCase();
    const typeFilter = couponTypeFilter ? couponTypeFilter.value : '';
    const statusFilter = couponStatusFilter ? couponStatusFilter.value : '';

    return adminCouponsCache.filter(coupon => {
        if (query && !String(coupon.code || '').toLowerCase().includes(query)) return false;
        if (typeFilter && coupon.type !== typeFilter) return false;
        if (statusFilter && getCouponStatusInfo(coupon).key !== statusFilter) return false;
        return true;
    });
}

function formatCouponValue(coupon) {
    const num = Number(coupon.value);
    if (!Number.isFinite(num)) return '—';
    return coupon.type === 'percent' ? `${num}%` : adminFormatPrice(num);
}

function formatCouponDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function renderCouponRow(coupon) {
    const code = adminEscapeHtml(coupon.code || '—');
    const type = coupon.type === 'percent' ? 'Percent' : 'Fixed';
    const value = formatCouponValue(coupon);
    const usageLimit = coupon.usage_limit != null ? coupon.usage_limit : '\u221e';
    const usage = `${adminEscapeHtml(String(coupon.used_count != null ? coupon.used_count : 0))} / ${adminEscapeHtml(String(usageLimit))}`;
    const statusInfo = getCouponStatusInfo(coupon);
    const expires = coupon.expires_at ? formatCouponDate(coupon.expires_at) : 'No expiry';
    const toggleLabel = coupon.is_active ? 'Deactivate' : 'Activate';

    return `
        <tr data-coupon-id="${coupon.id}">
            <td>${code}</td>
            <td>${type}</td>
            <td>${value}</td>
            <td>${usage}</td>
            <td><span class="admin-pill admin-pill-${statusInfo.key}">${statusInfo.label}</span></td>
            <td>${expires}</td>
            <td>
                <div class="admin-row-actions">
                    <button type="button" class="admin-action-btn" data-action="edit" data-coupon-id="${coupon.id}">Edit</button>
                    <button type="button" class="admin-action-btn admin-action-toggle" data-action="toggle-active" data-coupon-id="${coupon.id}">${toggleLabel}</button>
                    <button type="button" class="admin-action-btn admin-action-danger" data-action="delete" data-coupon-id="${coupon.id}">Delete</button>
                </div>
            </td>
        </tr>
    `;
}

function wireCouponRowActions() {
    if (!couponsTableBody) return;
    couponsTableBody.querySelectorAll('[data-action="toggle-active"]').forEach(btn => {
        btn.addEventListener('click', () => handleToggleCouponActive(btn.dataset.couponId, btn));
    });
    couponsTableBody.querySelectorAll('[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', () => handleDeleteCoupon(btn.dataset.couponId, btn));
    });
    couponsTableBody.querySelectorAll('[data-action="edit"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const coupon = adminCouponsCache && adminCouponsCache.find(c => String(c.id) === String(btn.dataset.couponId));
            if (coupon) openCouponForm('edit', coupon);
        });
    });
}

function renderCouponsTable() {
    if (!couponsTableBody) return;

    if (!Array.isArray(adminCouponsCache) || adminCouponsCache.length === 0) {
        renderCouponsTableMessage('No coupons yet.');
        return;
    }

    const filtered = getFilteredCoupons();

    if (filtered.length === 0) {
        couponsTableBody.innerHTML = `
            <tr class="admin-table-message-row">
                <td colspan="7">
                    No coupons match your search/filter.
                    <button type="button" class="admin-inline-retry-btn" id="couponsClearFiltersBtn">CLEAR FILTERS</button>
                </td>
            </tr>`;
        if (couponsCount) couponsCount.textContent = '';
        const clearBtn = document.getElementById('couponsClearFiltersBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (couponSearchInput) couponSearchInput.value = '';
                if (couponTypeFilter) couponTypeFilter.value = '';
                if (couponStatusFilter) couponStatusFilter.value = '';
                renderCouponsTable();
            });
        }
        return;
    }

    couponsTableBody.innerHTML = filtered.map(renderCouponRow).join('');
    wireCouponRowActions();

    if (couponsCount) {
        const total = adminCouponsCache.length;
        couponsCount.textContent = filtered.length === total
            ? `${total} coupon${total === 1 ? '' : 's'}`
            : `${filtered.length} of ${total} coupons`;
    }
}

if (couponSearchInput) couponSearchInput.addEventListener('input', renderCouponsTable);
if (couponTypeFilter) couponTypeFilter.addEventListener('change', renderCouponsTable);
if (couponStatusFilter) couponStatusFilter.addEventListener('change', renderCouponsTable);

// Toggling is_active is a real, safe, reversible update the backend
// supports directly (UpdateCouponRequest treats it as sometimes|boolean).
async function handleToggleCouponActive(couponId, btn) {
    const coupon = adminCouponsCache && adminCouponsCache.find(c => String(c.id) === String(couponId));
    if (!coupon) return;

    hideCouponsActionError();
    const nextActive = !coupon.is_active;
    const originalLabel = btn ? btn.textContent : '';
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Saving…';
    }

    try {
        const response = await adminApiRequest(`/admin/coupons/${couponId}`, {
            method: 'PATCH',
            body: { is_active: nextActive }
        });
        const updated = (response && response.data) || null;
        if (updated) {
            Object.assign(coupon, updated);
        } else {
            coupon.is_active = nextActive;
        }
        renderCouponsTable();
    } catch (error) {
        console.warn('AFIFI Admin: could not update coupon status.', error);
        showCouponsActionError(error && error.message ? error.message : 'Could not update coupon status. Please try again.');
        if (btn) {
            btn.disabled = false;
            btn.textContent = originalLabel;
        }
    }
}

// Coupon has no SoftDeletes - destroy() is a real, irreversible delete.
async function handleDeleteCoupon(couponId, btn) {
    const coupon = adminCouponsCache && adminCouponsCache.find(c => String(c.id) === String(couponId));
    if (!coupon) return;

    const confirmed = window.confirm(`Delete coupon "${coupon.code}"? This cannot be undone.`);
    if (!confirmed) return;

    hideCouponsActionError();
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Deleting…';
    }

    try {
        await adminApiRequest(`/admin/coupons/${couponId}`, { method: 'DELETE' });
        adminCouponsCache = adminCouponsCache.filter(c => String(c.id) !== String(couponId));
        renderCouponsTable();
    } catch (error) {
        console.warn('AFIFI Admin: could not delete coupon.', error);
        showCouponsActionError(error && error.message ? error.message : 'Could not delete coupon. Please try again.');
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Delete';
        }
    }
}

// ---- Coupon create/edit form ----

const couponFormOverlay = document.getElementById('couponFormOverlay');
const couponFormTitle = document.getElementById('couponFormTitle');
const couponFormCloseBtn = document.getElementById('couponFormCloseBtn');
const couponFormCancelBtn = document.getElementById('couponFormCancelBtn');
const couponFormSubmitBtn = document.getElementById('couponFormSubmitBtn');
const couponFormError = document.getElementById('couponFormError');
const couponForm = document.getElementById('couponForm');
const cfCode = document.getElementById('cfCode');
const cfType = document.getElementById('cfType');
const cfValue = document.getElementById('cfValue');
const cfValueHint = document.getElementById('cfValueHint');
const cfMinOrderTotal = document.getElementById('cfMinOrderTotal');
const cfMaxDiscount = document.getElementById('cfMaxDiscount');
const cfUsageLimit = document.getElementById('cfUsageLimit');
const cfStartsAt = document.getElementById('cfStartsAt');
const cfExpiresAt = document.getElementById('cfExpiresAt');
const cfIsActive = document.getElementById('cfIsActive');

let couponFormMode = 'create'; // 'create' | 'edit'
let couponFormCouponId = null;
let couponFormSubmitting = false;

function showCouponFormError(message) {
    if (!couponFormError) return;
    couponFormError.textContent = message;
    couponFormError.hidden = false;
}

function hideCouponFormError() {
    if (!couponFormError) return;
    couponFormError.hidden = true;
}

function setCouponFormBusy(isBusy, label) {
    if (couponFormSubmitBtn) {
        couponFormSubmitBtn.disabled = isBusy;
        couponFormSubmitBtn.textContent = isBusy ? (label || 'Saving…') : 'Save Coupon';
    }
    if (couponFormCancelBtn) couponFormCancelBtn.disabled = isBusy;
    if (couponFormCloseBtn) couponFormCloseBtn.disabled = isBusy;
}

function updateCouponValueHint() {
    if (!cfValueHint || !cfType) return;
    cfValueHint.textContent = cfType.value === 'percent'
        ? 'Percentage off order total (0-100).'
        : 'Fixed amount off order total (EGP).';
}

if (cfType) cfType.addEventListener('change', updateCouponValueHint);

// Converts a stored UTC-ish date string to the local value a
// <input type="datetime-local"> expects (no timezone/seconds).
function toDateTimeLocalValue(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function resetCouponForm() {
    if (couponForm) couponForm.reset();
    if (cfType) cfType.value = 'percent';
    updateCouponValueHint();
    hideCouponFormError();
    setCouponFormBusy(false); // guards against reopening right after a save left the submit button mid-label
}

function populateCouponForm(coupon) {
    if (cfCode) cfCode.value = coupon.code || '';
    if (cfType) cfType.value = coupon.type || 'percent';
    updateCouponValueHint();
    if (cfValue) cfValue.value = coupon.value != null ? coupon.value : '';
    if (cfMinOrderTotal) cfMinOrderTotal.value = coupon.min_order_total != null ? coupon.min_order_total : '';
    if (cfMaxDiscount) cfMaxDiscount.value = coupon.max_discount != null ? coupon.max_discount : '';
    if (cfUsageLimit) cfUsageLimit.value = coupon.usage_limit != null ? coupon.usage_limit : '';
    if (cfStartsAt) cfStartsAt.value = toDateTimeLocalValue(coupon.starts_at);
    if (cfExpiresAt) cfExpiresAt.value = toDateTimeLocalValue(coupon.expires_at);
    if (cfIsActive) cfIsActive.checked = Boolean(coupon.is_active);
}

function closeCouponForm() {
    if (couponFormSubmitting) return;
    if (couponFormOverlay) couponFormOverlay.hidden = true;
}

function openCouponForm(mode, coupon) {
    couponFormMode = mode;
    couponFormCouponId = coupon ? coupon.id : null;
    resetCouponForm();

    if (couponFormTitle) couponFormTitle.textContent = mode === 'edit' ? 'Edit Coupon' : 'Add Coupon';
    if (couponFormOverlay) couponFormOverlay.hidden = false;

    if (mode === 'edit' && coupon) populateCouponForm(coupon);

    if (cfCode) cfCode.focus();
}

if (addCouponBtn) addCouponBtn.addEventListener('click', () => openCouponForm('create', null));
if (couponFormCloseBtn) couponFormCloseBtn.addEventListener('click', closeCouponForm);
if (couponFormCancelBtn) couponFormCancelBtn.addEventListener('click', closeCouponForm);

if (couponFormOverlay) {
    couponFormOverlay.addEventListener('click', (e) => {
        if (e.target === couponFormOverlay) closeCouponForm();
    });
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && couponFormOverlay && !couponFormOverlay.hidden) {
        closeCouponForm();
    }
});

// Mirrors backend validation (StoreCouponRequest/UpdateCouponRequest) so
// obviously-invalid submissions are caught before a round trip, while the
// server remains the source of truth for uniqueness and exact rules.
function validateCouponFormValues(values) {
    const errors = [];
    if (!values.code) errors.push('Code is required.');
    if (!values.type) errors.push('Type is required.');
    if (values.value === '' || !Number.isFinite(Number(values.value)) || Number(values.value) < 0) {
        errors.push('A valid value is required.');
    } else if (values.type === 'percent' && Number(values.value) > 100) {
        errors.push('Percent value cannot exceed 100.');
    }
    if (values.min_order_total !== '' && (!Number.isFinite(Number(values.min_order_total)) || Number(values.min_order_total) < 0)) {
        errors.push('Minimum order total must be a valid non-negative number.');
    }
    if (values.max_discount !== '' && (!Number.isFinite(Number(values.max_discount)) || Number(values.max_discount) < 0)) {
        errors.push('Maximum discount must be a valid non-negative number.');
    }
    if (values.usage_limit !== '' && (!Number.isInteger(Number(values.usage_limit)) || Number(values.usage_limit) < 0)) {
        errors.push('Usage limit must be a valid non-negative whole number.');
    }
    if (values.starts_at && values.expires_at && new Date(values.expires_at) < new Date(values.starts_at)) {
        errors.push('Expiry date must be on or after the start date.');
    }
    return errors;
}

if (couponForm) {
    couponForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (couponFormSubmitting) return;
        hideCouponFormError();

        const values = {
            code: cfCode ? cfCode.value.trim() : '',
            type: cfType ? cfType.value : '',
            value: cfValue ? cfValue.value.trim() : '',
            min_order_total: cfMinOrderTotal ? cfMinOrderTotal.value.trim() : '',
            max_discount: cfMaxDiscount ? cfMaxDiscount.value.trim() : '',
            usage_limit: cfUsageLimit ? cfUsageLimit.value.trim() : '',
            starts_at: cfStartsAt ? cfStartsAt.value : '',
            expires_at: cfExpiresAt ? cfExpiresAt.value : ''
        };

        const errors = validateCouponFormValues(values);
        if (errors.length > 0) {
            showCouponFormError(errors.join(' '));
            return;
        }

        const payload = {
            code: values.code,
            type: values.type,
            value: Number(values.value),
            min_order_total: values.min_order_total !== '' ? Number(values.min_order_total) : null,
            max_discount: values.max_discount !== '' ? Number(values.max_discount) : null,
            usage_limit: values.usage_limit !== '' ? Number(values.usage_limit) : null,
            starts_at: values.starts_at || null,
            expires_at: values.expires_at || null,
            is_active: Boolean(cfIsActive && cfIsActive.checked)
        };

        couponFormSubmitting = true;
        setCouponFormBusy(true, couponFormMode === 'edit' ? 'Saving changes…' : 'Creating coupon…');

        try {
            if (couponFormMode === 'edit') {
                await adminApiRequest(`/admin/coupons/${couponFormCouponId}`, { method: 'PATCH', body: payload });
            } else {
                await adminApiRequest('/admin/coupons', { method: 'POST', body: payload });
            }

            adminCouponsCache = null; // force a fresh reload so the table reflects the save
            couponFormSubmitting = false;
            closeCouponForm();
            await loadCouponsSection();
        } catch (error) {
            couponFormSubmitting = false;
            setCouponFormBusy(false);
            showCouponFormError(error && error.message ? error.message : 'Could not save coupon. Please check the form and try again.');
        }
    });
}

// ==========================================================================
// INVENTORY ADJUSTMENTS MANAGEMENT (Part 10)
//
// Backend previously had InventoryService + an inventory_movements audit
// table with no HTTP endpoints exposing them - ProductVariant.stock could
// only be overwritten to an absolute value via PATCH /admin/product-variants
// with no audit trail. Two minimal endpoints were added to wrap the existing
// service instead of touching stock directly from this UI:
//   GET  /admin/inventory-movements                      (permission:inventory.view)
//   POST /admin/product-variants/{id}/inventory-adjustments (permission:inventory.update)
// The POST body is a signed quantity_delta + optional notes; the backend
// (InventoryService::adjustStock) does the locking, the negative-stock
// guard, and writes the audit row - this file never sets stock directly.
// ==========================================================================

const INVENTORY_MOVEMENT_TYPE_LABELS = {
    adjustment: 'Adjustment',
    restock: 'Restock',
    sale: 'Sale',
    return: 'Return',
    reservation_hold: 'Reservation Hold',
    reservation_release: 'Reservation Release'
};

const inventorySearchInput = document.getElementById('inventorySearchInput');
const inventoryTypeFilter = document.getElementById('inventoryTypeFilter');
const inventoryTableBody = document.getElementById('inventoryTableBody');
const inventoryCount = document.getElementById('inventoryCount');
const inventoryActionError = document.getElementById('inventoryActionError');
const addInventoryAdjustmentBtn = document.getElementById('addInventoryAdjustmentBtn');

let adminInventoryCache = null; // null = never successfully loaded yet
let adminInventoryLoading = false;

function showInventoryActionError(message) {
    if (!inventoryActionError) return;
    inventoryActionError.textContent = message;
    inventoryActionError.hidden = false;
}

function hideInventoryActionError() {
    if (!inventoryActionError) return;
    inventoryActionError.hidden = true;
}

function setInventoryToolbarEnabled(enabled) {
    if (inventorySearchInput) inventorySearchInput.disabled = !enabled;
    if (inventoryTypeFilter) inventoryTypeFilter.disabled = !enabled;
}

function renderInventoryTableMessage(text) {
    if (!inventoryTableBody) return;
    inventoryTableBody.innerHTML = `<tr class="admin-table-message-row"><td colspan="9">${adminEscapeHtml(text)}</td></tr>`;
    if (inventoryCount) inventoryCount.textContent = '';
}

function renderInventoryTableError(message) {
    if (!inventoryTableBody) return;
    inventoryTableBody.innerHTML = `
        <tr class="admin-table-message-row is-error">
            <td colspan="9">
                ${adminEscapeHtml(message)}
                <button type="button" class="admin-inline-retry-btn" id="inventoryRetryBtn">RETRY</button>
            </td>
        </tr>`;
    if (inventoryCount) inventoryCount.textContent = '';
    const retryBtn = document.getElementById('inventoryRetryBtn');
    if (retryBtn) retryBtn.addEventListener('click', loadInventorySection);
}

// Same fetch-all-pages-then-cache approach used for admin products/orders/coupons.
async function fetchAdminInventoryMovements() {
    const perPage = 100;
    const maxPages = 20;
    let page = 1;
    let lastPage = 1;
    let all = [];

    while (page <= lastPage && page <= maxPages) {
        const response = await adminApiRequest(`/admin/inventory-movements?per_page=${perPage}&page=${page}`);
        const items = Array.isArray(response && response.data) ? response.data : [];
        all = all.concat(items);
        const metaLastPage = Number(response && response.meta && response.meta.last_page);
        lastPage = Number.isFinite(metaLastPage) && metaLastPage > 0 ? metaLastPage : 1;
        page += 1;
    }

    return all;
}

async function loadInventorySection() {
    if (adminInventoryLoading) return;
    adminInventoryLoading = true;
    hideInventoryActionError();
    setInventoryToolbarEnabled(false);
    renderInventoryTableMessage('Loading inventory movements…');

    try {
        const movements = await fetchAdminInventoryMovements();
        adminInventoryCache = movements;
        setInventoryToolbarEnabled(true);
        renderInventoryTable();
    } catch (error) {
        adminInventoryCache = null;
        const message = error && error.status === 403
            ? 'You do not have permission to view inventory movements.'
            : (error && error.message ? error.message : 'Could not load inventory movements. Please try again.');
        renderInventoryTableError(message);
    } finally {
        adminInventoryLoading = false;
    }
}

function getFilteredInventoryMovements() {
    if (!Array.isArray(adminInventoryCache)) return [];
    const query = ((inventorySearchInput && inventorySearchInput.value) || '').trim().toLowerCase();
    const typeFilter = inventoryTypeFilter ? inventoryTypeFilter.value : '';

    return adminInventoryCache.filter(movement => {
        if (typeFilter && movement.type !== typeFilter) return false;
        if (query) {
            const variant = movement.product_variant || {};
            const productName = (variant.product && variant.product.name) || '';
            const sku = variant.sku || '';
            if (!productName.toLowerCase().includes(query) && !sku.toLowerCase().includes(query)) return false;
        }
        return true;
    });
}

function formatInventoryDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function getVariantAttributesLabel(variant) {
    if (!variant) return '—';
    const parts = [variant.color, variant.size].filter(Boolean);
    return parts.length > 0 ? parts.join(' / ') : '—';
}

function renderInventoryRow(movement) {
    const variant = movement.product_variant || null;
    const productName = adminEscapeHtml((variant && variant.product && variant.product.name) || '—');
    const sku = adminEscapeHtml((variant && variant.sku) || '—');
    const variantLabel = adminEscapeHtml(getVariantAttributesLabel(variant));
    const typeKey = adminEscapeHtml(movement.type || '');
    const typeLabel = adminEscapeHtml(INVENTORY_MOVEMENT_TYPE_LABELS[movement.type] || movement.type || '—');
    const delta = Number(movement.quantity_delta);
    const deltaClass = delta > 0 ? 'admin-qty-positive' : (delta < 0 ? 'admin-qty-negative' : '');
    const deltaDisplay = Number.isFinite(delta) ? (delta > 0 ? `+${delta}` : String(delta)) : '—';
    const stockBefore = movement.stock_before != null ? adminEscapeHtml(String(movement.stock_before)) : '—';
    const stockAfter = movement.stock_after != null ? adminEscapeHtml(String(movement.stock_after)) : '—';
    const notes = adminEscapeHtml(movement.notes || '—');
    const createdBy = adminEscapeHtml((movement.created_by && movement.created_by.name) || 'System');

    return `
        <tr>
            <td>${adminEscapeHtml(formatInventoryDate(movement.created_at))}</td>
            <td>${productName}</td>
            <td>${sku}${variantLabel !== '—' ? ` <span class="admin-table-muted">(${variantLabel})</span>` : ''}</td>
            <td><span class="admin-pill admin-pill-move-${typeKey}">${typeLabel}</span></td>
            <td class="${deltaClass}">${deltaDisplay}</td>
            <td>${stockBefore}</td>
            <td>${stockAfter}</td>
            <td>${notes}</td>
            <td>${createdBy}</td>
        </tr>
    `;
}

function renderInventoryTable() {
    if (!inventoryTableBody) return;

    if (!Array.isArray(adminInventoryCache) || adminInventoryCache.length === 0) {
        renderInventoryTableMessage('No inventory movements yet.');
        return;
    }

    const filtered = getFilteredInventoryMovements();

    if (filtered.length === 0) {
        inventoryTableBody.innerHTML = `
            <tr class="admin-table-message-row">
                <td colspan="9">
                    No movements match your search/filter.
                    <button type="button" class="admin-inline-retry-btn" id="inventoryClearFiltersBtn">CLEAR FILTERS</button>
                </td>
            </tr>`;
        if (inventoryCount) inventoryCount.textContent = '';
        const clearBtn = document.getElementById('inventoryClearFiltersBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (inventorySearchInput) inventorySearchInput.value = '';
                if (inventoryTypeFilter) inventoryTypeFilter.value = '';
                renderInventoryTable();
            });
        }
        return;
    }

    inventoryTableBody.innerHTML = filtered.map(renderInventoryRow).join('');

    if (inventoryCount) {
        const total = adminInventoryCache.length;
        inventoryCount.textContent = filtered.length === total
            ? `${total} movement${total === 1 ? '' : 's'}`
            : `${filtered.length} of ${total} movements`;
    }
}

if (inventorySearchInput) inventorySearchInput.addEventListener('input', renderInventoryTable);
if (inventoryTypeFilter) inventoryTypeFilter.addEventListener('change', renderInventoryTable);

// ---- Adjustment form ----
// Product/variant options are sourced from the existing admin products
// endpoint (GET /admin/products, already used by the Products section) so
// no new product-listing endpoint is needed. Reuses adminProductsCache when
// already loaded; otherwise fetches it fresh just for this picker.

const inventoryAdjustmentOverlay = document.getElementById('inventoryAdjustmentOverlay');
const inventoryAdjustmentCloseBtn = document.getElementById('inventoryAdjustmentCloseBtn');
const inventoryAdjustmentCancelBtn = document.getElementById('inventoryAdjustmentCancelBtn');
const inventoryAdjustmentSubmitBtn = document.getElementById('inventoryAdjustmentSubmitBtn');
const inventoryAdjustmentFormError = document.getElementById('inventoryAdjustmentFormError');
const inventoryAdjustmentForm = document.getElementById('inventoryAdjustmentForm');
const iaProduct = document.getElementById('iaProduct');
const iaVariant = document.getElementById('iaVariant');
const iaVariantStockHint = document.getElementById('iaVariantStockHint');
const iaQuantityDelta = document.getElementById('iaQuantityDelta');
const iaNotes = document.getElementById('iaNotes');

let inventoryAdjustmentSubmitting = false;
let inventoryAdjustmentProducts = null; // cached list used only for this picker

function showInventoryAdjustmentFormError(message) {
    if (!inventoryAdjustmentFormError) return;
    inventoryAdjustmentFormError.textContent = message;
    inventoryAdjustmentFormError.hidden = false;
}

function hideInventoryAdjustmentFormError() {
    if (!inventoryAdjustmentFormError) return;
    inventoryAdjustmentFormError.hidden = true;
}

function setInventoryAdjustmentFormBusy(isBusy, label) {
    if (inventoryAdjustmentSubmitBtn) {
        inventoryAdjustmentSubmitBtn.disabled = isBusy;
        inventoryAdjustmentSubmitBtn.textContent = isBusy ? (label || 'Saving…') : 'Save Adjustment';
    }
    if (inventoryAdjustmentCancelBtn) inventoryAdjustmentCancelBtn.disabled = isBusy;
    if (inventoryAdjustmentCloseBtn) inventoryAdjustmentCloseBtn.disabled = isBusy;
}

function getVariantOptionLabel(variant) {
    const bits = [variant.sku || `Variant #${variant.id}`];
    const attrs = [variant.color && variant.color.name, variant.size && variant.size.name].filter(Boolean);
    if (attrs.length > 0) bits.push(`(${attrs.join(' / ')})`);
    bits.push(`— Stock: ${variant.stock != null ? variant.stock : '—'}`);
    return bits.join(' ');
}

function populateVariantSelect(productId) {
    if (!iaVariant) return;
    const product = Array.isArray(inventoryAdjustmentProducts)
        ? inventoryAdjustmentProducts.find(p => String(p.id) === String(productId))
        : null;
    const variants = product && Array.isArray(product.variants) ? product.variants : [];

    if (!product || variants.length === 0) {
        iaVariant.innerHTML = '<option value="">No variants available</option>';
        iaVariant.disabled = true;
        if (iaVariantStockHint) iaVariantStockHint.textContent = '';
        return;
    }

    iaVariant.innerHTML = `<option value="">Select a variant…</option>${variants.map(v =>
        `<option value="${v.id}">${adminEscapeHtml(getVariantOptionLabel(v))}</option>`
    ).join('')}`;
    iaVariant.disabled = false;
    if (iaVariantStockHint) iaVariantStockHint.textContent = '';
}

function updateVariantStockHint() {
    if (!iaVariantStockHint || !iaVariant || !iaProduct) return;
    const product = Array.isArray(inventoryAdjustmentProducts)
        ? inventoryAdjustmentProducts.find(p => String(p.id) === String(iaProduct.value))
        : null;
    const variant = product && Array.isArray(product.variants)
        ? product.variants.find(v => String(v.id) === String(iaVariant.value))
        : null;
    iaVariantStockHint.textContent = variant ? `Current stock: ${variant.stock != null ? variant.stock : '—'}` : '';
}

if (iaProduct) {
    iaProduct.addEventListener('change', () => {
        populateVariantSelect(iaProduct.value);
    });
}

if (iaVariant) iaVariant.addEventListener('change', updateVariantStockHint);

function resetInventoryAdjustmentForm() {
    if (inventoryAdjustmentForm) inventoryAdjustmentForm.reset();
    if (iaVariant) {
        iaVariant.innerHTML = '<option value="">Select a product first</option>';
        iaVariant.disabled = true;
    }
    if (iaVariantStockHint) iaVariantStockHint.textContent = '';
    hideInventoryAdjustmentFormError();
    setInventoryAdjustmentFormBusy(false);
}

function closeInventoryAdjustmentForm() {
    if (inventoryAdjustmentSubmitting) return;
    if (inventoryAdjustmentOverlay) inventoryAdjustmentOverlay.hidden = true;
}

async function openInventoryAdjustmentForm() {
    resetInventoryAdjustmentForm();
    if (inventoryAdjustmentOverlay) inventoryAdjustmentOverlay.hidden = false;

    if (iaProduct) {
        iaProduct.disabled = true;
        iaProduct.innerHTML = '<option value="">Loading products…</option>';
    }

    try {
        // Reuse the Products section cache when available to avoid a duplicate
        // fetch; otherwise load it fresh just for this picker.
        inventoryAdjustmentProducts = Array.isArray(adminProductsCache) ? adminProductsCache : await fetchAdminProducts();
        const productsWithVariants = inventoryAdjustmentProducts.filter(p => Array.isArray(p.variants) && p.variants.length > 0);

        if (iaProduct) {
            iaProduct.innerHTML = productsWithVariants.length > 0
                ? `<option value="">Select a product…</option>${productsWithVariants.map(p =>
                    `<option value="${p.id}">${adminEscapeHtml(p.name || `Product #${p.id}`)}</option>`
                ).join('')}`
                : '<option value="">No products with variants found</option>';
            iaProduct.disabled = false;
        }
    } catch (error) {
        inventoryAdjustmentProducts = null;
        if (iaProduct) iaProduct.innerHTML = '<option value="">Could not load products</option>';
        showInventoryAdjustmentFormError(
            error && error.status === 403
                ? 'You do not have permission to view products for selection.'
                : 'Could not load products. Please try again.'
        );
    }
}

if (addInventoryAdjustmentBtn) addInventoryAdjustmentBtn.addEventListener('click', openInventoryAdjustmentForm);
if (inventoryAdjustmentCloseBtn) inventoryAdjustmentCloseBtn.addEventListener('click', closeInventoryAdjustmentForm);
if (inventoryAdjustmentCancelBtn) inventoryAdjustmentCancelBtn.addEventListener('click', closeInventoryAdjustmentForm);

if (inventoryAdjustmentOverlay) {
    inventoryAdjustmentOverlay.addEventListener('click', (e) => {
        if (e.target === inventoryAdjustmentOverlay) closeInventoryAdjustmentForm();
    });
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && inventoryAdjustmentOverlay && !inventoryAdjustmentOverlay.hidden) {
        closeInventoryAdjustmentForm();
    }
});

if (inventoryAdjustmentForm) {
    inventoryAdjustmentForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (inventoryAdjustmentSubmitting) return;
        hideInventoryAdjustmentFormError();

        const variantId = iaVariant ? iaVariant.value : '';
        const deltaRaw = iaQuantityDelta ? iaQuantityDelta.value.trim() : '';
        const notes = iaNotes ? iaNotes.value.trim() : '';

        if (!variantId) {
            showInventoryAdjustmentFormError('Please select a product variant.');
            return;
        }
        const delta = Number(deltaRaw);
        if (deltaRaw === '' || !Number.isInteger(delta) || delta === 0) {
            showInventoryAdjustmentFormError('Quantity change must be a non-zero whole number.');
            return;
        }

        const payload = {
            quantity_delta: delta,
            notes: notes || null
        };

        inventoryAdjustmentSubmitting = true;
        setInventoryAdjustmentFormBusy(true, 'Saving…');

        try {
            await adminApiRequest(`/admin/product-variants/${variantId}/inventory-adjustments`, {
                method: 'POST',
                body: payload
            });

            adminInventoryCache = null; // force a fresh reload so the ledger reflects the new movement
            adminProductsCache = null; // stock changed - invalidate so Products section refetches next visit
            inventoryAdjustmentSubmitting = false;
            closeInventoryAdjustmentForm();
            await loadInventorySection();
        } catch (error) {
            inventoryAdjustmentSubmitting = false;
            setInventoryAdjustmentFormBusy(false);
            showInventoryAdjustmentFormError(error && error.message ? error.message : 'Could not save adjustment. Please check the form and try again.');
        }
    });
}

// ==========================================================================
// CONTACT MESSAGES MANAGEMENT (Part 11)
//
// Backend had model/migration/resource/form-requests but no controller,
// routes, or permissions. Minimal admin endpoints were added:
//   GET    /admin/contact-messages              (permission:contact.view)
//   GET    /admin/contact-messages/{id}         (permission:contact.view)
//   PATCH  /admin/contact-messages/{id}/status  (permission:contact.manage)
//   DELETE /admin/contact-messages/{id}         (permission:contact.manage)
// Status enum: new | read | replied (no separate unread boolean; "new" = unread).
// No phone column on the model - UI shows "Not provided" in detail only.
// No archive/soft-delete - destroy() is a real hard delete.
// ==========================================================================

const MESSAGE_STATUS_LABELS = {
    new: 'New',
    read: 'Read',
    replied: 'Replied'
};

const messageSearchInput = document.getElementById('messageSearchInput');
const messageStatusFilter = document.getElementById('messageStatusFilter');
const messagesTableBody = document.getElementById('messagesTableBody');
const messagesCount = document.getElementById('messagesCount');
const messagesActionError = document.getElementById('messagesActionError');
const messageDetailOverlay = document.getElementById('messageDetailOverlay');
const messageDetailTitle = document.getElementById('messageDetailTitle');
const messageDetailBody = document.getElementById('messageDetailBody');
const messageDetailCloseBtn = document.getElementById('messageDetailCloseBtn');

let adminMessagesCache = null; // null = never successfully loaded yet
let adminMessagesLoading = false;
let messageStatusUpdating = false;
let messageDeleteSubmitting = false;

function showMessagesActionError(message) {
    if (!messagesActionError) return;
    messagesActionError.textContent = message;
    messagesActionError.hidden = false;
}

function hideMessagesActionError() {
    if (!messagesActionError) return;
    messagesActionError.hidden = true;
}

function setMessagesToolbarEnabled(enabled) {
    if (messageSearchInput) messageSearchInput.disabled = !enabled;
    if (messageStatusFilter) messageStatusFilter.disabled = !enabled;
}

function renderMessagesTableMessage(text) {
    if (!messagesTableBody) return;
    messagesTableBody.innerHTML = `<tr class="admin-table-message-row"><td colspan="6">${adminEscapeHtml(text)}</td></tr>`;
    if (messagesCount) messagesCount.textContent = '';
}

function renderMessagesTableError(message) {
    if (!messagesTableBody) return;
    messagesTableBody.innerHTML = `
        <tr class="admin-table-message-row is-error">
            <td colspan="6">
                ${adminEscapeHtml(message)}
                <button type="button" class="admin-inline-retry-btn" id="messagesRetryBtn">RETRY</button>
            </td>
        </tr>`;
    if (messagesCount) messagesCount.textContent = '';
    const retryBtn = document.getElementById('messagesRetryBtn');
    if (retryBtn) retryBtn.addEventListener('click', loadMessagesSection);
}

async function fetchAdminContactMessages() {
    const perPage = 100;
    const maxPages = 20;
    let page = 1;
    let lastPage = 1;
    let all = [];

    while (page <= lastPage && page <= maxPages) {
        const response = await adminApiRequest(`/admin/contact-messages?per_page=${perPage}&page=${page}`);
        const items = Array.isArray(response && response.data) ? response.data : [];
        all = all.concat(items);
        const metaLastPage = Number(response && response.meta && response.meta.last_page);
        lastPage = Number.isFinite(metaLastPage) && metaLastPage > 0 ? metaLastPage : 1;
        page += 1;
    }

    return all;
}

async function loadMessagesSection() {
    if (adminMessagesLoading) return;
    adminMessagesLoading = true;
    hideMessagesActionError();
    setMessagesToolbarEnabled(false);
    renderMessagesTableMessage('Loading messages…');

    try {
        const messages = await fetchAdminContactMessages();
        adminMessagesCache = messages;
        setMessagesToolbarEnabled(true);
        renderMessagesTable();
    } catch (error) {
        adminMessagesCache = null;
        const message = error && error.status === 403
            ? 'You do not have permission to view contact messages.'
            : (error && error.message ? error.message : 'Could not load messages. Please try again.');
        renderMessagesTableError(message);
    } finally {
        adminMessagesLoading = false;
    }
}

function getMessageStatusInfo(message) {
    const key = message.status || 'new';
    return {
        key,
        label: MESSAGE_STATUS_LABELS[key] || key
    };
}

function renderMessageStatusPill(status) {
    const info = getMessageStatusInfo({ status });
    return `<span class="admin-pill admin-pill-msg-${adminEscapeHtml(info.key)}">${adminEscapeHtml(info.label)}</span>`;
}

function formatMessageDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function getFilteredMessages() {
    if (!Array.isArray(adminMessagesCache)) return [];
    const query = ((messageSearchInput && messageSearchInput.value) || '').trim().toLowerCase();
    const statusFilter = messageStatusFilter ? messageStatusFilter.value : '';

    return adminMessagesCache.filter(message => {
        if (statusFilter && message.status !== statusFilter) return false;
        if (query) {
            const nameMatch = (message.name || '').toLowerCase().includes(query);
            const emailMatch = (message.email || '').toLowerCase().includes(query);
            const subjectMatch = (message.subject || '').toLowerCase().includes(query);
            if (!nameMatch && !emailMatch && !subjectMatch) return false;
        }
        return true;
    });
}

function renderMessageRow(message) {
    const name = adminEscapeHtml(message.name || '—');
    const email = adminEscapeHtml(message.email || '—');
    const subject = adminEscapeHtml(message.subject || 'No subject');
    const statusInfo = getMessageStatusInfo(message);
    const date = adminEscapeHtml(formatMessageDate(message.created_at));

    return `
        <tr data-message-id="${message.id}">
            <td>${name}</td>
            <td>${email}</td>
            <td>${subject}</td>
            <td><span class="admin-pill admin-pill-msg-${statusInfo.key}">${adminEscapeHtml(statusInfo.label)}</span></td>
            <td>${date}</td>
            <td>
                <div class="admin-row-actions">
                    <button type="button" class="admin-action-btn" data-action="view" data-message-id="${message.id}">View</button>
                    <button type="button" class="admin-action-btn admin-action-danger" data-action="delete" data-message-id="${message.id}">Delete</button>
                </div>
            </td>
        </tr>
    `;
}

function wireMessageRowActions() {
    if (!messagesTableBody) return;
    messagesTableBody.querySelectorAll('[data-action="view"]').forEach(btn => {
        btn.addEventListener('click', () => openMessageDetail(btn.dataset.messageId));
    });
    messagesTableBody.querySelectorAll('[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', () => handleDeleteMessage(btn.dataset.messageId, btn));
    });
}

function renderMessagesTable() {
    if (!messagesTableBody) return;

    if (!Array.isArray(adminMessagesCache) || adminMessagesCache.length === 0) {
        renderMessagesTableMessage('No contact messages yet.');
        return;
    }

    const filtered = getFilteredMessages();

    if (filtered.length === 0) {
        messagesTableBody.innerHTML = `
            <tr class="admin-table-message-row">
                <td colspan="6">
                    No messages match your search/filter.
                    <button type="button" class="admin-inline-retry-btn" id="messagesClearFiltersBtn">CLEAR FILTERS</button>
                </td>
            </tr>`;
        if (messagesCount) messagesCount.textContent = '';
        const clearBtn = document.getElementById('messagesClearFiltersBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (messageSearchInput) messageSearchInput.value = '';
                if (messageStatusFilter) messageStatusFilter.value = '';
                renderMessagesTable();
            });
        }
        return;
    }

    messagesTableBody.innerHTML = filtered.map(renderMessageRow).join('');
    wireMessageRowActions();

    if (messagesCount) {
        const total = adminMessagesCache.length;
        messagesCount.textContent = filtered.length === total
            ? `${total} message${total === 1 ? '' : 's'}`
            : `${filtered.length} of ${total} messages`;
    }
}

if (messageSearchInput) messageSearchInput.addEventListener('input', renderMessagesTable);
if (messageStatusFilter) messageStatusFilter.addEventListener('change', renderMessagesTable);

function renderMessageDetailContent(message) {
    const statusInfo = getMessageStatusInfo(message);
    const canMarkNew = message.status !== 'new';
    const canMarkRead = message.status !== 'read';
    const canMarkReplied = message.status !== 'replied';

    return `
        <div class="admin-order-overview">
            ${renderMessageStatusPill(message.status)}
            <span class="admin-table-muted">Received ${adminEscapeHtml(formatMessageDate(message.created_at))}</span>
        </div>

        <div class="admin-form-section" style="margin-top:16px; padding-top:0; border-top:none;">
            <dl class="admin-detail-block">
                <dt>Name</dt><dd>${adminEscapeHtml(message.name || '—')}</dd>
                <dt>Email</dt><dd>${adminEscapeHtml(message.email || '—')}</dd>
                <dt>Phone</dt><dd class="admin-table-muted">Not provided</dd>
                <dt>Subject</dt><dd>${adminEscapeHtml(message.subject || 'No subject')}</dd>
            </dl>
        </div>

        <div class="admin-form-section">
            <h3>Message</h3>
            <p class="admin-message-body">${adminEscapeHtml(message.message || '—')}</p>
        </div>

        <div class="admin-form-section">
            <h3>Status Actions</h3>
            <div class="admin-error-banner" id="messageDetailError" hidden></div>
            <div class="admin-form-success" id="messageDetailSuccess" hidden></div>
            <div class="admin-row-actions">
                ${canMarkRead ? `<button type="button" class="admin-action-btn" data-detail-action="status" data-status="read">Mark as Read</button>` : ''}
                ${canMarkNew ? `<button type="button" class="admin-action-btn" data-detail-action="status" data-status="new">Mark as New</button>` : ''}
                ${canMarkReplied ? `<button type="button" class="admin-action-btn" data-detail-action="status" data-status="replied">Mark as Replied</button>` : ''}
                <button type="button" class="admin-action-btn admin-action-danger" data-detail-action="delete">Delete Message</button>
            </div>
            <p class="admin-field-hint" style="margin-top:8px;">Status is stored as <code>new</code>, <code>read</code>, or <code>replied</code>. There is no archive endpoint — delete permanently removes the message.</p>
        </div>
    `;
}

function showMessageDetailError(message) {
    const el = document.getElementById('messageDetailError');
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    const successEl = document.getElementById('messageDetailSuccess');
    if (successEl) successEl.hidden = true;
}

function showMessageDetailSuccess(message) {
    const el = document.getElementById('messageDetailSuccess');
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    const errorEl = document.getElementById('messageDetailError');
    if (errorEl) errorEl.hidden = true;
}

function hideMessageDetailBanners() {
    const errorEl = document.getElementById('messageDetailError');
    const successEl = document.getElementById('messageDetailSuccess');
    if (errorEl) errorEl.hidden = true;
    if (successEl) successEl.hidden = true;
}

function wireMessageDetailActions(messageId) {
    if (!messageDetailBody) return;

    messageDetailBody.querySelectorAll('[data-detail-action="status"]').forEach(btn => {
        btn.addEventListener('click', () => handleUpdateMessageStatus(messageId, btn.dataset.status, btn));
    });

    const deleteBtn = messageDetailBody.querySelector('[data-detail-action="delete"]');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => handleDeleteMessage(messageId, deleteBtn, true));
    }
}

function closeMessageDetail() {
    if (messageDetailOverlay) messageDetailOverlay.hidden = true;
}

async function openMessageDetail(messageId) {
    if (messageDetailTitle) messageDetailTitle.textContent = 'Message Details';
    if (messageDetailBody) messageDetailBody.innerHTML = '<p class="admin-table-muted">Loading message…</p>';
    if (messageDetailOverlay) messageDetailOverlay.hidden = false;

    try {
        const response = await adminApiRequest(`/admin/contact-messages/${messageId}`);
        const message = response && response.data;
        if (!message) throw new Error('Message not found.');

        const titleBits = [message.name, message.subject].filter(Boolean);
        if (messageDetailTitle) {
            messageDetailTitle.textContent = titleBits.length > 0 ? titleBits.join(' — ') : 'Message Details';
        }
        if (messageDetailBody) {
            messageDetailBody.innerHTML = renderMessageDetailContent(message);
            wireMessageDetailActions(messageId);
        }
    } catch (error) {
        const isForbidden = error && error.status === 403;
        if (messageDetailBody) {
            messageDetailBody.innerHTML = `<p class="admin-error-banner">${adminEscapeHtml(
                isForbidden
                    ? 'You do not have permission to view this message.'
                    : (error && error.message ? error.message : 'Could not load message details. Please try again.')
            )}</p>`;
        }
    }
}

async function handleUpdateMessageStatus(messageId, status, btn) {
    if (messageStatusUpdating) return;
    hideMessagesActionError();
    hideMessageDetailBanners();

    const originalLabel = btn ? btn.textContent : '';
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Saving…';
    }
    messageStatusUpdating = true;

    try {
        const response = await adminApiRequest(`/admin/contact-messages/${messageId}/status`, {
            method: 'PATCH',
            body: { status }
        });
        const updated = (response && response.data) || null;
        if (updated && Array.isArray(adminMessagesCache)) {
            const index = adminMessagesCache.findIndex(m => String(m.id) === String(messageId));
            if (index >= 0) adminMessagesCache[index] = updated;
            else adminMessagesCache.unshift(updated);
        } else {
            adminMessagesCache = null;
        }

        renderMessagesTable();
        if (messageDetailBody && updated) {
            messageDetailBody.innerHTML = renderMessageDetailContent(updated);
            wireMessageDetailActions(messageId);
            showMessageDetailSuccess(`Status updated to ${MESSAGE_STATUS_LABELS[status] || status}.`);
        }
    } catch (error) {
        const message = error && error.status === 403
            ? 'You do not have permission to update message status.'
            : (error && error.message ? error.message : 'Could not update message status. Please try again.');
        if (messageDetailOverlay && !messageDetailOverlay.hidden) {
            showMessageDetailError(message);
        } else {
            showMessagesActionError(message);
        }
        if (btn) {
            btn.disabled = false;
            btn.textContent = originalLabel;
        }
    } finally {
        messageStatusUpdating = false;
    }
}

async function handleDeleteMessage(messageId, btn, fromDetail) {
    if (messageDeleteSubmitting) return;

    const cached = adminMessagesCache && adminMessagesCache.find(m => String(m.id) === String(messageId));
    const label = cached ? (cached.subject || cached.name || `Message #${messageId}`) : `Message #${messageId}`;
    const confirmed = window.confirm(`Delete "${label}"? This cannot be undone.`);
    if (!confirmed) return;

    hideMessagesActionError();
    hideMessageDetailBanners();

    const originalLabel = btn ? btn.textContent : '';
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Deleting…';
    }
    messageDeleteSubmitting = true;

    try {
        await adminApiRequest(`/admin/contact-messages/${messageId}`, { method: 'DELETE' });

        if (Array.isArray(adminMessagesCache)) {
            adminMessagesCache = adminMessagesCache.filter(m => String(m.id) !== String(messageId));
        } else {
            adminMessagesCache = null;
        }

        if (fromDetail) closeMessageDetail();
        renderMessagesTable();
    } catch (error) {
        const message = error && error.status === 403
            ? 'You do not have permission to delete contact messages.'
            : (error && error.message ? error.message : 'Could not delete message. Please try again.');
        if (fromDetail && messageDetailOverlay && !messageDetailOverlay.hidden) {
            showMessageDetailError(message);
        } else {
            showMessagesActionError(message);
        }
        if (btn) {
            btn.disabled = false;
            btn.textContent = originalLabel;
        }
    } finally {
        messageDeleteSubmitting = false;
    }
}

if (messageDetailCloseBtn) messageDetailCloseBtn.addEventListener('click', closeMessageDetail);
if (messageDetailOverlay) {
    messageDetailOverlay.addEventListener('click', (e) => {
        if (e.target === messageDetailOverlay) closeMessageDetail();
    });
}
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && messageDetailOverlay && !messageDetailOverlay.hidden) {
        closeMessageDetail();
    }
});

// ==========================================================================
// MEDIA LIBRARY MANAGEMENT (Part 12)
//
// Full admin CRUD already existed on the backend under permission:cms.manage:
//   GET    /admin/media
//   GET    /admin/media/{id}
//   POST   /admin/media          (metadata only — no file bytes)
//   PUT/PATCH /admin/media/{id}
//   DELETE /admin/media/{id}     (soft delete via MediaService)
// There is no multipart upload endpoint — POST accepts JSON metadata after a
// file is already on disk. Upload UI is intentionally omitted here.
// Public URLs are built client-side: {origin}/storage/{path}
// ==========================================================================

const mediaSearchInput = document.getElementById('mediaSearchInput');
const mediaTypeFilter = document.getElementById('mediaTypeFilter');
const mediaGrid = document.getElementById('mediaGrid');
const mediaCount = document.getElementById('mediaCount');
const mediaActionError = document.getElementById('mediaActionError');
const mediaActionSuccess = document.getElementById('mediaActionSuccess');

let adminMediaCache = null; // null = never successfully loaded yet
let adminMediaLoading = false;
let mediaDeleteSubmitting = false;

function showMediaActionError(message) {
    if (!mediaActionError) return;
    mediaActionError.textContent = message;
    mediaActionError.hidden = false;
    if (mediaActionSuccess) mediaActionSuccess.hidden = true;
}

function hideMediaActionError() {
    if (!mediaActionError) return;
    mediaActionError.hidden = true;
}

function showMediaActionSuccess(message) {
    if (!mediaActionSuccess) return;
    mediaActionSuccess.textContent = message;
    mediaActionSuccess.hidden = false;
    if (mediaActionError) mediaActionError.hidden = true;
}

function hideMediaActionSuccess() {
    if (!mediaActionSuccess) return;
    mediaActionSuccess.hidden = true;
}

function setMediaToolbarEnabled(enabled) {
    if (mediaSearchInput) mediaSearchInput.disabled = !enabled;
    if (mediaTypeFilter) mediaTypeFilter.disabled = !enabled;
}

function renderMediaGridMessage(text, isError) {
    if (!mediaGrid) return;
    const className = isError ? 'admin-table-muted admin-media-message is-error' : 'admin-table-muted admin-media-message';
    mediaGrid.innerHTML = `<p class="${className}">${adminEscapeHtml(text)}</p>`;
    if (mediaCount) mediaCount.textContent = '';
}

function renderMediaGridError(message) {
    if (!mediaGrid) return;
    mediaGrid.innerHTML = `
        <p class="admin-table-muted admin-media-message is-error">
            ${adminEscapeHtml(message)}
            <button type="button" class="admin-inline-retry-btn" id="mediaRetryBtn">RETRY</button>
        </p>`;
    if (mediaCount) mediaCount.textContent = '';
    const retryBtn = document.getElementById('mediaRetryBtn');
    if (retryBtn) retryBtn.addEventListener('click', loadMediaSection);
}

async function fetchAdminMedia() {
    const perPage = 100;
    const maxPages = 20;
    let page = 1;
    let lastPage = 1;
    let all = [];

    while (page <= lastPage && page <= maxPages) {
        const response = await adminApiRequest(`/admin/media?per_page=${perPage}&page=${page}`);
        const items = Array.isArray(response && response.data) ? response.data : [];
        all = all.concat(items);
        const metaLastPage = Number(response && response.meta && response.meta.last_page);
        lastPage = Number.isFinite(metaLastPage) && metaLastPage > 0 ? metaLastPage : 1;
        page += 1;
    }

    return all;
}

async function loadMediaSection() {
    if (adminMediaLoading) return;
    adminMediaLoading = true;
    hideMediaActionError();
    hideMediaActionSuccess();
    setMediaToolbarEnabled(false);
    renderMediaGridMessage('Loading media…');

    try {
        const mediaItems = await fetchAdminMedia();
        adminMediaCache = mediaItems;
        setMediaToolbarEnabled(true);
        renderMediaGrid();
    } catch (error) {
        adminMediaCache = null;
        const message = error && error.status === 403
            ? 'You do not have permission to view the media library.'
            : (error && error.message ? error.message : 'Could not load media. Please try again.');
        renderMediaGridError(message);
    } finally {
        adminMediaLoading = false;
    }
}

function isImageMedia(item) {
    return typeof item.mime_type === 'string' && item.mime_type.startsWith('image/');
}

function formatMediaSize(bytes) {
    const num = Number(bytes);
    if (!Number.isFinite(num) || num < 0) return '—';
    if (num < 1024) return `${num} B`;
    if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
    return `${(num / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMediaDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function getMediaPublicUrl(item) {
    if (!item || item.disk !== 'public' || !item.path) return '';
    return adminResolveMediaUrl(item.path);
}

function getMediaFileExtension(item) {
    const name = item.filename || item.path || '';
    const parts = String(name).split('.');
    return parts.length > 1 ? parts.pop().toUpperCase() : 'FILE';
}

function getFilteredMedia() {
    if (!Array.isArray(adminMediaCache)) return [];
    const query = ((mediaSearchInput && mediaSearchInput.value) || '').trim().toLowerCase();
    const typeFilter = mediaTypeFilter ? mediaTypeFilter.value : '';

    return adminMediaCache.filter(item => {
        if (typeFilter === 'image' && !isImageMedia(item)) return false;
        if (typeFilter === 'other' && isImageMedia(item)) return false;
        if (query) {
            const filenameMatch = (item.filename || '').toLowerCase().includes(query);
            const pathMatch = (item.path || '').toLowerCase().includes(query);
            const titleMatch = (item.title || '').toLowerCase().includes(query);
            if (!filenameMatch && !pathMatch && !titleMatch) return false;
        }
        return true;
    });
}

function renderMediaPreview(item) {
    const url = getMediaPublicUrl(item);
    if (isImageMedia(item) && url) {
        const alt = adminEscapeHtml(item.alt_text || item.title || item.filename || 'Media preview');
        return `<img src="${adminEscapeHtml(url)}" alt="${alt}" loading="lazy" onerror="this.onerror=null;this.src='images/AFIFI_BRANDS_VECTOR.svg'">`;
    }
    return `<span class="admin-media-file-icon" aria-hidden="true">${adminEscapeHtml(getMediaFileExtension(item))}</span>`;
}

function renderMediaCard(item) {
    const filename = adminEscapeHtml(item.filename || item.title || `Media #${item.id}`);
    const mime = adminEscapeHtml(item.mime_type || '—');
    const size = adminEscapeHtml(formatMediaSize(item.size_bytes));
    const disk = adminEscapeHtml(item.disk || '—');
    const path = adminEscapeHtml(item.path || '—');
    const date = adminEscapeHtml(formatMediaDate(item.created_at));
    const dimensions = (item.width && item.height)
        ? adminEscapeHtml(`${item.width}×${item.height}`)
        : '—';

    return `
        <article class="admin-media-card" data-media-id="${item.id}">
            <div class="admin-media-preview">${renderMediaPreview(item)}</div>
            <div class="admin-media-body">
                <div class="admin-media-filename" title="${filename}">${filename}</div>
                <div class="admin-media-meta">${mime} · ${size}${dimensions !== '—' ? ` · ${dimensions}` : ''}</div>
                <div class="admin-media-meta">${disk} / ${path}</div>
                <div class="admin-media-meta">${date}</div>
                <div class="admin-row-actions">
                    <button type="button" class="admin-action-btn" data-action="open" data-media-id="${item.id}">Open</button>
                    <button type="button" class="admin-action-btn" data-action="copy" data-media-id="${item.id}">Copy URL</button>
                    <button type="button" class="admin-action-btn admin-action-danger" data-action="delete" data-media-id="${item.id}">Delete</button>
                </div>
            </div>
        </article>
    `;
}

function wireMediaCardActions() {
    if (!mediaGrid) return;

    mediaGrid.querySelectorAll('[data-action="open"]').forEach(btn => {
        btn.addEventListener('click', () => handleOpenMedia(btn.dataset.mediaId));
    });
    mediaGrid.querySelectorAll('[data-action="copy"]').forEach(btn => {
        btn.addEventListener('click', () => handleCopyMediaUrl(btn.dataset.mediaId, btn));
    });
    mediaGrid.querySelectorAll('[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', () => handleDeleteMedia(btn.dataset.mediaId, btn));
    });
}

function renderMediaGrid() {
    if (!mediaGrid) return;

    if (!Array.isArray(adminMediaCache) || adminMediaCache.length === 0) {
        renderMediaGridMessage('No media files registered yet.');
        return;
    }

    const filtered = getFilteredMedia();

    if (filtered.length === 0) {
        mediaGrid.innerHTML = `
            <p class="admin-table-muted admin-media-message">
                No media matches your search/filter.
                <button type="button" class="admin-inline-retry-btn" id="mediaClearFiltersBtn">CLEAR FILTERS</button>
            </p>`;
        if (mediaCount) mediaCount.textContent = '';
        const clearBtn = document.getElementById('mediaClearFiltersBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (mediaSearchInput) mediaSearchInput.value = '';
                if (mediaTypeFilter) mediaTypeFilter.value = '';
                renderMediaGrid();
            });
        }
        return;
    }

    mediaGrid.innerHTML = filtered.map(renderMediaCard).join('');
    wireMediaCardActions();

    if (mediaCount) {
        const total = adminMediaCache.length;
        mediaCount.textContent = filtered.length === total
            ? `${total} file${total === 1 ? '' : 's'}`
            : `${filtered.length} of ${total} files`;
    }
}

if (mediaSearchInput) mediaSearchInput.addEventListener('input', renderMediaGrid);
if (mediaTypeFilter) mediaTypeFilter.addEventListener('change', renderMediaGrid);

function handleOpenMedia(mediaId) {
    const item = adminMediaCache && adminMediaCache.find(m => String(m.id) === String(mediaId));
    if (!item) return;

    const url = getMediaPublicUrl(item);
    if (!url) {
        showMediaActionError('This file is not on the public disk — no safe URL to open.');
        return;
    }

    hideMediaActionError();
    window.open(url, '_blank', 'noopener,noreferrer');
}

async function handleCopyMediaUrl(mediaId, btn) {
    const item = adminMediaCache && adminMediaCache.find(m => String(m.id) === String(mediaId));
    if (!item) return;

    const url = getMediaPublicUrl(item);
    if (!url) {
        showMediaActionError('This file is not on the public disk — no safe URL to copy.');
        return;
    }

    hideMediaActionError();
    const originalLabel = btn ? btn.textContent : '';

    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(url);
        } else {
            const textarea = document.createElement('textarea');
            textarea.value = url;
            textarea.setAttribute('readonly', '');
            textarea.style.position = 'absolute';
            textarea.style.left = '-9999px';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
        }
        showMediaActionSuccess('URL copied to clipboard.');
        if (btn) {
            btn.textContent = 'Copied!';
            setTimeout(() => { if (btn) btn.textContent = originalLabel; }, 1500);
        }
    } catch (error) {
        showMediaActionError('Could not copy URL. Please copy it manually from the Open action.');
    }
}

async function handleDeleteMedia(mediaId, btn) {
    if (mediaDeleteSubmitting) return;

    const item = adminMediaCache && adminMediaCache.find(m => String(m.id) === String(mediaId));
    const label = item ? (item.filename || item.path || `Media #${mediaId}`) : `Media #${mediaId}`;
    const confirmed = window.confirm(`Remove "${label}" from the media library? The database record will be soft-deleted; the physical file is not removed automatically.`);
    if (!confirmed) return;

    hideMediaActionError();
    hideMediaActionSuccess();

    const originalLabel = btn ? btn.textContent : '';
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Deleting…';
    }
    mediaDeleteSubmitting = true;

    try {
        await adminApiRequest(`/admin/media/${mediaId}`, { method: 'DELETE' });

        if (Array.isArray(adminMediaCache)) {
            adminMediaCache = adminMediaCache.filter(m => String(m.id) !== String(mediaId));
        } else {
            adminMediaCache = null;
        }

        renderMediaGrid();
        showMediaActionSuccess('Media removed from library.');
    } catch (error) {
        const message = error && error.status === 403
            ? 'You do not have permission to delete media.'
            : (error && error.message ? error.message : 'Could not delete media. Please try again.');
        showMediaActionError(message);
        if (btn) {
            btn.disabled = false;
            btn.textContent = originalLabel;
        }
    } finally {
        mediaDeleteSubmitting = false;
    }
}

// ========== INIT ==========
initAdminAuth();
