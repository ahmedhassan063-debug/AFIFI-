// ========== API CLIENT (Laravel backend integration layer) ==========
// Resolves the API base URL without hardcoding an environment:
// 1) an explicit window.AFIFI_API_BASE_URL override always wins
// 2) local/dev environments (localhost, 127.0.0.1, file://) use the local API port
// 3) anything else (real deployment) defaults to same-origin /api
function resolveApiBaseUrl() {
    if (window.AFIFI_API_BASE_URL) return window.AFIFI_API_BASE_URL;

    const { protocol, hostname, origin } = window.location;
    const isLocalHost = protocol === 'file:' || hostname === 'localhost' || hostname === '127.0.0.1';

    if (isLocalHost) return 'http://127.0.0.1:8000/api';

    return `${origin}/api`;
}

const API_BASE_URL = resolveApiBaseUrl();
const AUTH_TOKEN_KEY = 'afifiAuthToken';

function getAuthToken() {
    return localStorage.getItem(AUTH_TOKEN_KEY);
}

function setAuthToken(token) {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
}

function clearAuthToken() {
    localStorage.removeItem(AUTH_TOKEN_KEY);
}

class ApiError extends Error {
    constructor(message, status, errors) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.errors = errors || null;
    }
}

function apiErrorMessageFor(status) {
    if (status === 401) return 'Unauthenticated. Please log in.';
    if (status === 403) return 'You do not have permission to do this.';
    if (status === 422) return 'Validation failed.';
    if (status >= 500) return 'Server error. Please try again later.';
    return 'Request failed.';
}

async function apiRequest(endpoint, options = {}) {
    const { body, headers, ...rest } = options;
    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
    const hasBody = body !== undefined && body !== null;
    const isPlainObject = hasBody && typeof body === 'object' && !isFormData;

    const finalHeaders = { Accept: 'application/json', ...headers };
    if (hasBody && !isFormData) {
        finalHeaders['Content-Type'] = 'application/json';
    }

    const token = getAuthToken();
    if (token) {
        finalHeaders.Authorization = `Bearer ${token}`;
    }

    const fetchOptions = { ...rest, headers: finalHeaders };
    if (hasBody) {
        fetchOptions.body = isPlainObject ? JSON.stringify(body) : body;
    }

    let response;
    try {
        response = await fetch(`${API_BASE_URL}${endpoint}`, fetchOptions);
    } catch (networkError) {
        throw new ApiError('Network error: could not reach the server.', 0, null);
    }

    let data = null;
    try {
        data = await response.json();
    } catch (parseError) {
        data = null;
    }

    if (!response.ok) {
        const message = (data && data.message) || apiErrorMessageFor(response.status);
        const errors = (data && data.errors) || null;

        if (response.status === 401) {
            handleUnauthenticatedResponse();
        }

        throw new ApiError(message, response.status, errors);
    }

    return data;
}

// Global 401 handler: session expired / token invalid. Clears local auth
// state and drops the cart back to its localStorage-only behavior. Wrapped
// defensively since this can run before later-defined page state exists.
function handleUnauthenticatedResponse() {
    console.warn('AFIFI: unauthenticated (401) - clearing local session state.');
    try {
        clearAuthToken();
        localStorage.removeItem('afifiUser');
        if (typeof apiCartItems !== 'undefined') apiCartItems = [];
        if (typeof apiWishlistItems !== 'undefined') apiWishlistItems = [];
        if (typeof updateAuthUI === 'function') updateAuthUI();
        if (typeof renderCart === 'function') renderCart();
        if (typeof updateWishlistBadge === 'function') updateWishlistBadge();
        if (typeof renderWishlist === 'function') renderWishlist();
    } catch (cleanupError) {
        console.warn('AFIFI: could not fully clear session state after 401.', cleanupError);
    }
}

window.afifiApi = {
    apiRequest,
    getAuthToken,
    setAuthToken,
    clearAuthToken
};

// ========== PUBLIC SETTINGS (Laravel backend integration, step 2) ==========
// Static content stays as-is; settings only override it when the API succeeds.
window.afifiSettings = {};

function settingsArrayToObject(data) {
    if (!Array.isArray(data)) return {};
    return data.reduce((acc, item) => {
        if (item && item.key !== undefined) {
            acc[item.key] = item.value;
        }
        return acc;
    }, {});
}

async function loadPublicSettings() {
    try {
        const response = await window.afifiApi.apiRequest('/settings/public');
        const settings = settingsArrayToObject(response && response.data);

        window.afifiSettings = settings;

        if (settings['seo.default_title'] && !document.querySelector('.product-details-info')) {
            document.title = settings['seo.default_title'];
        }

        if (settings['seo.default_description']) {
            const metaDescription = document.querySelector('meta[name="description"]');
            if (metaDescription) {
                metaDescription.setAttribute('content', settings['seo.default_description']);
            }
        }

        if (settings['site.whatsapp_number']) {
            whatsappNumber = settings['site.whatsapp_number'];
            if (whatsappFloat) {
                whatsappFloat.href = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent('Hello AFIFI, I want to ask about your products.')}`;
            }
        }

        if (settings['store.default_currency']) {
            window.afifiSettings.defaultCurrency = settings['store.default_currency'];
        }

        return settings;
    } catch (error) {
        console.warn('AFIFI: could not load public settings, using static content.', error);
        return null;
    }
}

loadPublicSettings();

// ========== HOMEPAGE PRODUCTS (Laravel backend integration, step 3) ==========
// Static New Arrivals / Best Sellers markup stays as the fallback.
function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

function formatPrice(price, currency) {
    const amount = Number(price);
    const safeAmount = Number.isFinite(amount) ? amount : 0;
    const currencyLabel = currency || (window.afifiSettings && window.afifiSettings.defaultCurrency) || 'EGP';
    return `${safeAmount.toLocaleString('en-US')} ${currencyLabel}`;
}

function resolveMediaUrl(media) {
    if (!media) return '';
    if (media.url) return media.url;
    if (media.path) {
        const base = API_BASE_URL.replace(/\/api\/?$/, '');
        const path = String(media.path).replace(/^\/+/, '');
        return `${base}/storage/${path}`;
    }
    return '';
}

function getProductImages(product) {
    const fallback = 'images/AFIFI_BRANDS_VECTOR.svg';
    const images = product && product.images;
    if (!images) return [fallback];
    if (typeof images === 'string') return [images];
    if (Array.isArray(images) && images.length > 0) {
        const sorted = [...images].sort((a, b) => {
            const aPrimary = a && a.is_primary ? 0 : 1;
            const bPrimary = b && b.is_primary ? 0 : 1;
            if (aPrimary !== bPrimary) return aPrimary - bPrimary;
            return (Number(a && a.display_order) || 0) - (Number(b && b.display_order) || 0);
        });
        const urls = sorted
            .map(img => {
                if (typeof img === 'string') return img;
                if (img && typeof img === 'object') {
                    return img.url || resolveMediaUrl(img.media) || img.path || img.src || '';
                }
                return '';
            })
            .filter(Boolean);
        return urls.length > 0 ? urls : [fallback];
    }
    return [fallback];
}

function getProductImage(product) {
    return getProductImages(product)[0];
}

// Shared, cached, pagination-aware fetch for /catalog/products.
// Concurrent callers share the same in-flight request; results are cached
// for the lifetime of the page so homepage/shop/product/cart code doesn't
// each re-fetch the whole catalog independently.
let catalogProductsCache = null;
let catalogProductsPromise = null;

async function fetchCatalogProducts() {
    if (catalogProductsCache) return catalogProductsCache;
    if (catalogProductsPromise) return catalogProductsPromise;

    const perPage = 100;
    const maxPages = 50; // safety cap against a runaway/misbehaving API

    catalogProductsPromise = (async () => {
        let page = 1;
        let lastPage = 1;
        let allProducts = [];

        while (page <= lastPage && page <= maxPages) {
            const response = await window.afifiApi.apiRequest(`/catalog/products?per_page=${perPage}&page=${page}`);
            const pageProducts = Array.isArray(response && response.data) ? response.data : [];
            allProducts = allProducts.concat(pageProducts);

            const metaLastPage = Number(response && response.meta && response.meta.last_page);
            lastPage = Number.isFinite(metaLastPage) && metaLastPage > 0 ? metaLastPage : 1;
            page += 1;
        }

        return allProducts;
    })();

    try {
        const products = await catalogProductsPromise;
        catalogProductsCache = products;
        return products;
    } finally {
        catalogProductsPromise = null;
    }
}

function getProductPageBase() {
    if (window.location.protocol === 'file:') return 'product.html';
    return /\.html$/i.test(window.location.pathname) ? 'product.html' : 'product';
}

function getProductPageHref(product) {
    if (!product) return '';
    const base = getProductPageBase();
    const slug = product.slug;
    if (slug != null && String(slug).trim() !== '') {
        return `${base}?slug=${encodeURIComponent(slug)}`;
    }
    const id = product.id;
    if (id != null && id !== '') {
        return `${base}?id=${encodeURIComponent(id)}`;
    }
    return '';
}

function upgradeStaticProductLinks() {
    const base = getProductPageBase();
    if (base === 'product.html') return;

    document.querySelectorAll('a[href^="product.html"]').forEach((anchor) => {
        const href = anchor.getAttribute('href');
        if (!href) return;
        anchor.setAttribute('href', href.replace(/^product\.html/, 'product'));
    });
}

function getProductPageIdentifier() {
    const params = new URLSearchParams(window.location.search);
    const slug = params.get('slug');
    if (slug != null && String(slug).trim() !== '') return slug.trim();
    const id = params.get('id');
    if (id != null && String(id).trim() !== '') return id.trim();
    return '';
}

function renderProductCard(product) {
    const identifier = product.slug || product.id;
    const name = product.name || 'AFIFI PRODUCT';
    const safeName = escapeHtml(name);
    const image = getProductImage(product);
    const price = formatPrice(product.base_price);
    const badge = product.badge ? escapeHtml(product.badge) : '';
    const href = getProductPageHref(product);
    const soldOut = isProductFullySoldOut(product);

    const card = document.createElement('div');
    card.className = 'product-card' + (soldOut ? ' product-card--sold-out' : '');
    if (identifier) card.dataset.id = identifier;

    const imageLink = href
        ? `<a href="${href}"><img src="${image}" alt="${safeName}" loading="lazy"></a>`
        : `<img src="${image}" alt="${safeName}" loading="lazy">`;
    const titleLink = href
        ? `<h4><a href="${href}">${safeName}</a></h4>`
        : `<h4>${safeName}</h4>`;
    const soldOutBadge = soldOut ? '<span class="product-badge product-badge-sold-out">SOLD OUT</span>' : '';

    card.innerHTML = `
        <div class="product-img">
            ${badge && !soldOut ? `<span class="product-badge">${badge}</span>` : ''}
            ${soldOutBadge}
            ${imageLink}
            <button class="wishlist" aria-label="Add ${safeName} to wishlist">&hearts;</button>
        </div>
        <div class="product-info">${titleLink}<p>${price}</p></div>
    `;

    return card;
}

async function loadHomepageProducts() {
    const newArrivalsGrid = document.querySelector('.new-arrivals .products-grid');
    const bestSellersTrack = document.querySelector('.best-sellers .carousel-track');

    if (!newArrivalsGrid && !bestSellersTrack) return;

    try {
        const products = await fetchCatalogProducts();

        if (products.length === 0) {
            console.warn('AFIFI: no products returned from API, keeping static homepage content.');
            return;
        }

        const newArrivals = products.filter(p => p.is_new_arrival);
        const bestSellers = products.filter(p => p.is_best_seller);

        if (newArrivalsGrid && newArrivals.length > 0) {
            newArrivalsGrid.innerHTML = '';
            newArrivals.forEach(product => newArrivalsGrid.appendChild(renderProductCard(product)));
            newArrivalsGrid.querySelectorAll('.wishlist').forEach(wireWishlistButton);
        }

        if (bestSellersTrack && bestSellers.length > 0) {
            bestSellersTrack.innerHTML = '';
            bestSellers.forEach(product => bestSellersTrack.appendChild(renderProductCard(product)));
            bestSellersTrack.querySelectorAll('.wishlist').forEach(wireWishlistButton);
        }

        updateWishlistBadge();
    } catch (error) {
        console.warn('AFIFI: could not load homepage products from API, keeping static content.', error);
    }
}

loadHomepageProducts();
upgradeStaticProductLinks();

// ========== HERO FONT GATE ==========
const HERO_FONT_TIMEOUT_MS = 2200;

function initHeroFontGate() {
    const hero = document.querySelector('.hero');
    if (!hero) return;

    let revealed = false;

    function revealHeroFonts() {
        if (revealed) return;
        revealed = true;
        hero.classList.remove('hero-fonts-loading');
        hero.classList.add('hero-fonts-ready');
    }

    if (!hero.classList.contains('hero-fonts-loading')) {
        hero.classList.add('hero-fonts-loading');
    }

    function waitForHeroFonts() {
        if (!document.fonts || typeof document.fonts.load !== 'function') {
            return Promise.resolve();
        }
        return Promise.all([
            document.fonts.load('400 1em "Bebas Neue"'),
            document.fonts.load('500 1em "Montserrat"')
        ]).catch(() => Promise.resolve());
    }

    Promise.race([
        waitForHeroFonts().then(() => (document.fonts.ready || Promise.resolve())),
        new Promise((resolve) => window.setTimeout(resolve, HERO_FONT_TIMEOUT_MS))
    ]).then(revealHeroFonts);
}

initHeroFontGate();

// ========== SHOP PAGE HEADER FONT GATE ==========
const SHOP_FONT_TIMEOUT_MS = 1800;

function initShopFontGate() {
    const header = document.getElementById('shopPageHeader') || document.querySelector('.page-header');
    if (!header || !document.querySelector('.shop-grid')) return;

    let revealed = false;

    function revealShopFonts() {
        if (revealed) return;
        revealed = true;
        header.classList.remove('shop-fonts-loading');
        header.classList.add('shop-fonts-ready');
    }

    if (!header.classList.contains('shop-fonts-loading')) {
        header.classList.add('shop-fonts-loading');
    }

    function waitForShopFonts() {
        if (!document.fonts || typeof document.fonts.load !== 'function') {
            return Promise.resolve();
        }
        return document.fonts.load('400 1em "Bebas Neue"').catch(() => Promise.resolve());
    }

    Promise.race([
        waitForShopFonts().then(() => (document.fonts.ready || Promise.resolve())),
        new Promise((resolve) => window.setTimeout(resolve, SHOP_FONT_TIMEOUT_MS))
    ]).then(revealShopFonts);
}

initShopFontGate();

// ========== HERO SLIDESHOW ==========
const slides = document.querySelectorAll('.slide');
let current = 0;

function hydrateHeroSlide(slideImg) {
    if (!slideImg || slideImg.dataset.loaded === 'true') return;

    const picture = slideImg.closest('picture[data-lazy-slide]');
    if (!picture) return;

    picture.querySelectorAll('source[data-srcset]').forEach((source) => {
        source.srcset = source.dataset.srcset;
        source.removeAttribute('data-srcset');
    });

    if (slideImg.dataset.src) {
        slideImg.src = slideImg.dataset.src;
        slideImg.removeAttribute('data-src');
    }

    slideImg.dataset.loaded = 'true';
}

function preloadHeroSlide(index) {
    const slideImg = slides[index];
    if (slideImg) hydrateHeroSlide(slideImg);
}

function scheduleIdleHeroPreload(index) {
    const run = () => preloadHeroSlide(index);
    if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(run, { timeout: 2500 });
    } else {
        window.setTimeout(run, 1500);
    }
}

if (slides.length > 0) {
    if (slides.length > 1) {
        scheduleIdleHeroPreload(1);
    }

    window.setInterval(() => {
        const next = (current + 1) % slides.length;
        preloadHeroSlide(next);
        slides[current].classList.remove('active');
        current = next;
        slides[current].classList.add('active');
    }, 4000);
}

// ========== BEST SELLERS CAROUSEL ==========
const track = document.querySelector('.carousel-track');
const leftArrow = document.querySelector('.left-arrow');
const rightArrow = document.querySelector('.right-arrow');

if (track && leftArrow && rightArrow) {
    const scrollAmount = 220;
    rightArrow.addEventListener('click', () => {
        track.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    });
    leftArrow.addEventListener('click', () => {
        track.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
    });
}

// ========== NAVBAR SCROLL EFFECT (Homepage) ==========
const navbar = document.querySelector('.navbar');

if (navbar && !navbar.classList.contains('navbar-solid')) {
    window.addEventListener('scroll', () => {
        if (window.scrollY > 80) {
            navbar.style.background = 'rgba(13, 13, 13, 0.95)';
        } else {
            navbar.style.background = 'linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)';
        }
    });
}

// ========== MOBILE HAMBURGER MENU ==========
const hamburger = document.getElementById('hamburger');
const navMenu = document.getElementById('navMenu');

if (hamburger && navMenu) {
    hamburger.setAttribute('aria-expanded', 'false');

    const setMenuOpen = (isOpen) => {
        hamburger.classList.toggle('active', isOpen);
        navMenu.classList.toggle('open', isOpen);
        hamburger.setAttribute('aria-expanded', String(isOpen));
    };

    hamburger.addEventListener('click', (e) => {
        e.stopPropagation();
        setMenuOpen(!navMenu.classList.contains('open'));
    });

    document.addEventListener('click', (e) => {
        if (!navMenu.contains(e.target) && !hamburger.contains(e.target)) {
            setMenuOpen(false);
        }
    });

    navMenu.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => setMenuOpen(false));
    });
}

function getShopPageBase() {
    if (window.location.protocol === 'file:') return 'shop.html';
    return /\.html$/i.test(window.location.pathname) ? 'shop.html' : 'shop';
}

function buildShopSearchUrl(query) {
    const base = getShopPageBase();
    const trimmed = String(query || '').trim();
    if (!trimmed) return base;
    return `${base}?search=${encodeURIComponent(trimmed)}`;
}

document.documentElement.style.scrollBehavior = 'smooth';

const OVERLAY_TRANSITION_MS = 360;
const SUPPORTS_SCROLLBAR_GUTTER = typeof CSS !== 'undefined'
    && typeof CSS.supports === 'function'
    && CSS.supports('scrollbar-gutter', 'stable');

function getScrollbarWidth() {
    return Math.max(0, window.innerWidth - document.documentElement.clientWidth);
}

function isScrollLocked() {
    return document.body.classList.contains('auth-modal-open')
        || document.body.classList.contains('search-open')
        || document.body.classList.contains('drawer-open');
}

function updateScrollLockCompensation() {
    const locked = isScrollLocked();
    const scrollbarWidth = locked ? getScrollbarWidth() : 0;
    const padding = !SUPPORTS_SCROLLBAR_GUTTER && scrollbarWidth > 0 ? `${scrollbarWidth}px` : '';

    document.body.style.paddingRight = padding;
    document.querySelectorAll('.navbar').forEach(el => {
        el.style.paddingRight = padding;
    });
}

function revealOverlay(overlay, bodyClass) {
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    if (bodyClass) document.body.classList.add(bodyClass);
    updateScrollLockCompensation();
    requestAnimationFrame(() => {
        requestAnimationFrame(() => overlay.classList.add('is-open'));
    });
}

function concealOverlay(overlay, bodyClass, afterClose) {
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
    if (bodyClass) document.body.classList.remove(bodyClass);
    updateScrollLockCompensation();

    let finished = false;
    const finish = () => {
        if (finished) return;
        finished = true;
        overlay.hidden = true;
        overlay.removeEventListener('transitionend', onTransitionEnd);
        if (afterClose) afterClose();
    };

    const onTransitionEnd = (event) => {
        if (event.target === overlay) finish();
    };

    overlay.addEventListener('transitionend', onTransitionEnd);
    window.setTimeout(finish, OVERLAY_TRANSITION_MS + 60);
}

let drawerBackdropEl = null;

function getDrawerBackdrop() {
    if (!drawerBackdropEl) {
        drawerBackdropEl = document.createElement('div');
        drawerBackdropEl.className = 'drawer-backdrop';
        drawerBackdropEl.setAttribute('aria-hidden', 'true');
        drawerBackdropEl.addEventListener('click', closeAllDrawers);
        document.body.appendChild(drawerBackdropEl);
    }
    return drawerBackdropEl;
}

function syncDrawerBackdrop() {
    const backdrop = getDrawerBackdrop();
    const hasOpenDrawer = document.querySelector('.cart-panel.open, .wishlist-panel.open');
    backdrop.classList.toggle('is-open', !!hasOpenDrawer);
    backdrop.setAttribute('aria-hidden', hasOpenDrawer ? 'false' : 'true');
    document.body.classList.toggle('drawer-open', !!hasOpenDrawer);
    updateScrollLockCompensation();
}

function openDrawerPanel(panel) {
    document.querySelectorAll('.cart-panel.open, .wishlist-panel.open').forEach(openPanel => {
        if (openPanel !== panel) {
            openPanel.classList.remove('open');
            openPanel.setAttribute('aria-hidden', 'true');
        }
    });
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    syncDrawerBackdrop();
}

function closeDrawerPanel(panel) {
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    syncDrawerBackdrop();
}

function closeAllDrawers() {
    document.querySelectorAll('.cart-panel.open, .wishlist-panel.open').forEach(panel => {
        panel.classList.remove('open');
        panel.setAttribute('aria-hidden', 'true');
    });
    syncDrawerBackdrop();
}

// ========== HEADER SEARCH OVERLAY ==========
function createSearchOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'search-overlay';
    overlay.id = 'searchOverlay';
    overlay.hidden = true;
    overlay.innerHTML = `
        <div class="search-overlay-backdrop" data-search-close></div>
        <div class="search-dropdown" role="dialog" aria-modal="true" aria-labelledby="searchOverlayTitle">
            <button type="button" class="search-overlay-close" aria-label="Close search" data-search-close>&times;</button>
            <h2 id="searchOverlayTitle" class="search-overlay-title">Search Products</h2>
            <form class="search-overlay-form" id="searchOverlayForm">
                <label for="searchOverlayInput" class="visually-hidden">Search products</label>
                <input type="search" id="searchOverlayInput" class="search-overlay-input" placeholder="Search products…" autocomplete="off">
                <button type="submit" class="search-overlay-submit">Search</button>
            </form>
        </div>
    `;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('#searchOverlayInput');
    const form = overlay.querySelector('#searchOverlayForm');

    function closeSearchOverlay() {
        concealOverlay(overlay, 'search-open');
    }

    function openSearchOverlay() {
        revealOverlay(overlay, 'search-open');
        if (input) {
            input.value = '';
            requestAnimationFrame(() => {
                requestAnimationFrame(() => input.focus());
            });
        }
    }

    overlay.querySelectorAll('[data-search-close]').forEach(el => {
        el.addEventListener('click', closeSearchOverlay);
    });

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        const query = input ? input.value.trim() : '';
        if (!query) return;
        window.location.href = buildShopSearchUrl(query);
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && overlay.classList.contains('is-open')) {
            closeSearchOverlay();
        }
    });

    document.querySelectorAll('img[alt="Search"]').forEach(icon => {
        const link = icon.closest('a');
        if (!link || link.dataset.searchReady) return;
        link.dataset.searchReady = 'true';
        link.addEventListener('click', (event) => {
            event.preventDefault();
            const navMenuEl = document.getElementById('navMenu');
            const hamburgerEl = document.getElementById('hamburger');
            if (navMenuEl) navMenuEl.classList.remove('open');
            if (hamburgerEl) {
                hamburgerEl.classList.remove('active');
                hamburgerEl.setAttribute('aria-expanded', 'false');
            }
            openSearchOverlay();
        });
    });

    return { open: openSearchOverlay, close: closeSearchOverlay };
}

createSearchOverlay();

// ========== PRODUCT PAGE: STABLE PRODUCT ID (from ?slug= or ?id=) ==========
const productPageIdentifier = getProductPageIdentifier();
let productPageData = { variants: [] };

// ========== PRODUCT PAGE: THUMBNAIL SWITCHING ==========
const PRODUCT_IMAGE_FALLBACK = 'images/AFIFI_BRANDS_VECTOR.svg';

function preloadProductImage(url) {
    if (!url) return;
    const existing = document.querySelector('link[data-product-image-preload]');
    if (existing) existing.remove();
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = url;
    link.setAttribute('data-product-image-preload', '');
    document.head.appendChild(link);
}

function setMainProductImage(src, alt) {
    const mainImg = document.getElementById('mainProductImg');
    const skeleton = document.querySelector('.product-image-skeleton');
    const mainImageWrap = document.querySelector('.main-image');
    if (!mainImg || !src) return;

    mainImg.alt = alt || 'Product image';

    const showLoaded = () => {
        mainImg.classList.add('is-loaded');
        mainImg.hidden = false;
        if (skeleton) skeleton.hidden = true;
        if (mainImageWrap) mainImageWrap.classList.remove('is-loading-image');
    };

    if (mainImageWrap) mainImageWrap.classList.add('is-loading-image');
    mainImg.classList.remove('is-loaded');
    mainImg.hidden = true;
    if (skeleton) skeleton.hidden = false;

    mainImg.onload = showLoaded;
    mainImg.onerror = () => {
        if (mainImg.src.includes('AFIFI_BRANDS_VECTOR')) {
            showLoaded();
            return;
        }
        mainImg.src = PRODUCT_IMAGE_FALLBACK;
    };

    mainImg.src = src;
    if (mainImg.complete) showLoaded();
}

function changeImage(thumb) {
    const mainImg = document.getElementById('mainProductImg');
    if (!mainImg || !thumb || !thumb.src) return;

    document.querySelectorAll('.thumb').forEach(t => t.classList.remove('active-thumb'));
    thumb.classList.add('active-thumb');

    if (mainImg.src === thumb.src && mainImg.classList.contains('is-loaded')) return;

    setMainProductImage(thumb.src, mainImg.alt);
}

function wireThumbButton(thumbBtn) {
    thumbBtn.addEventListener('click', () => {
        const img = thumbBtn.querySelector('.thumb');
        if (!img) return;
        changeImage(img);
        document.querySelectorAll('.thumb-btn').forEach(b => b.setAttribute('aria-pressed', 'false'));
        thumbBtn.setAttribute('aria-pressed', 'true');
    });
}

document.querySelectorAll('.thumb-btn').forEach(wireThumbButton);

// ========== PRODUCT PAGE: SIZE SELECTOR ==========
function wireSizeButton(btn) {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.size-btn').forEach(b => {
            b.classList.remove('active');
            b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
        updateProductPageStockState();
    });
}

document.querySelectorAll('.size-btn').forEach(wireSizeButton);

// ========== PRODUCT PAGE: COLOR SELECTOR ==========
function wireColorSwatch(swatch) {
    swatch.addEventListener('click', () => {
        document.querySelectorAll('.color-swatch').forEach(s => {
            s.classList.remove('active');
            s.setAttribute('aria-pressed', 'false');
        });
        swatch.classList.add('active');
        swatch.setAttribute('aria-pressed', 'true');
        updateProductPageStockState();
    });
}

document.querySelectorAll('.color-swatch').forEach(wireColorSwatch);

// ========== PRODUCT PAGE: QUANTITY ==========
const qtyMinus = document.getElementById('qtyMinus');
const qtyPlus = document.getElementById('qtyPlus');
const qtyValue = document.getElementById('qtyValue');

if (qtyMinus && qtyPlus && qtyValue) {
    qtyMinus.addEventListener('click', () => {
        const val = parseInt(qtyValue.textContent, 10);
        if (val > 1) qtyValue.textContent = val - 1;
    });
    qtyPlus.addEventListener('click', () => {
        const selectedVariant = typeof getSelectedVariant === 'function' ? getSelectedVariant() : null;
        const maxQty = selectedVariant
            ? getCartItemMaxQuantity({ stock: selectedVariant.stock })
            : CART_MAX_QUANTITY;
        const val = parseInt(qtyValue.textContent, 10);
        if (val < maxQty) qtyValue.textContent = val + 1;
    });
}

document.querySelector('.whatsapp-order')?.addEventListener('click', (event) => {
    const link = event.currentTarget;
    if (link.classList.contains('is-disabled') || link.getAttribute('aria-disabled') === 'true') {
        event.preventDefault();
    }
});

// ========== PRODUCT PAGE: TABS ==========
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        const tab = document.getElementById(btn.dataset.tab);
        if (tab) tab.classList.add('active');
    });
});

// ========== SHOP PAGE: FILTERS AND SORTING ==========
const shopGrid = document.querySelector('.shop-grid');
let shopCards = shopGrid ? Array.from(shopGrid.querySelectorAll('.product-card')) : [];
const sortSelect = document.querySelector('.sort-select');
const shopCount = document.getElementById('shopCount');
const shopEmpty = document.getElementById('shopEmpty');
const shopError = document.getElementById('shopError');
const shopRetryLoad = document.getElementById('shopRetryLoad');
const shopClearFilters = document.getElementById('shopClearFilters');
const shopSearchInput = document.getElementById('shopSearchInput');
const shopSearchForm = document.getElementById('shopSearchForm');
const filterBtns = document.querySelectorAll('.filter-btn');
let activeFilter = 'all';
let activeShopSearch = '';
let shopProductsReady = false;
let shopLoadFailed = false;
let shopLoadErrorLogged = false;
let shopRetryInFlight = false;

const SHOP_SKELETON_COUNT = 8;

// Maps the static filter button values to the real backend category slugs
// they represent. Static fallback cards already use these exact values as
// their data-category, so an exact match is always tried first; this map is
// only consulted for API-rendered cards whose category slug differs
// (e.g. "t-shirts" covers both "men-t-shirts" and "women-t-shirts").
const SHOP_FILTER_CATEGORY_MAP = {
    't-shirts': ['men-t-shirts', 'women-t-shirts'],
    'hoodies': [], // no backend category yet; matches nothing, shows empty state
    'pants': ['men-pants', 'women-pants'],
    'accessories': ['unisex-accessories']
};

function matchesShopFilter(categorySlug, filterValue) {
    if (!filterValue || filterValue === 'all') return true;
    if (categorySlug === filterValue) return true;
    const mapped = SHOP_FILTER_CATEGORY_MAP[filterValue];
    return Array.isArray(mapped) && mapped.includes(categorySlug);
}

function matchesShopSearch(card, query) {
    if (!query) return true;
    const q = String(query).toLowerCase().trim();
    const haystack = [
        card.dataset.search,
        card.dataset.name,
        card.dataset.id,
        card.dataset.category,
        card.textContent
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(q);
}

function setShopLoadingState(isLoading) {
    if (!shopGrid) return;
    shopGrid.classList.toggle('is-loading', isLoading);
    shopGrid.setAttribute('aria-busy', isLoading ? 'true' : 'false');
    if (shopCount && isLoading) {
        shopCount.textContent = 'Loading products...';
    }
    if (shopEmpty && isLoading) {
        shopEmpty.hidden = true;
    }
    if (shopError && isLoading) {
        shopError.hidden = true;
    }
}

function resetShopEmptyCopy() {
    if (!shopEmpty) return;
    const title = shopEmpty.querySelector('.shop-empty-title');
    const text = shopEmpty.querySelector('.shop-empty-text');
    if (title) title.textContent = 'No products found.';
    if (text) text.textContent = 'Try another category or clear filters.';
}

function showShopLoadError() {
    shopLoadFailed = true;
    shopProductsReady = false;
    setShopLoadingState(false);
    shopCards = [];
    if (shopEmpty) shopEmpty.hidden = true;
    if (shopError) {
        shopError.hidden = false;
        shopGrid.appendChild(shopError);
    }
    if (shopCount) shopCount.textContent = '0 products';
}

function hideShopLoadError() {
    shopLoadFailed = false;
    if (shopError) shopError.hidden = true;
}

function restoreShopSkeletonCards() {
    if (!shopGrid) return;
    shopGrid.querySelectorAll('.shop-skeleton-card').forEach(el => el.remove());
    const insertBefore = shopEmpty || shopError || null;
    for (let i = 0; i < SHOP_SKELETON_COUNT; i += 1) {
        const skeleton = document.createElement('div');
        skeleton.className = 'shop-skeleton-card';
        skeleton.setAttribute('aria-hidden', 'true');
        skeleton.innerHTML = '<div class="shop-skeleton-img"></div><div class="shop-skeleton-line"></div><div class="shop-skeleton-line short"></div>';
        if (insertBefore) shopGrid.insertBefore(skeleton, insertBefore);
        else shopGrid.appendChild(skeleton);
    }
}

function setShopRetryUi(isRetrying) {
    if (!shopRetryLoad) return;
    const defaultText = shopRetryLoad.dataset.defaultText || 'Retry';
    shopRetryLoad.disabled = isRetrying;
    shopRetryLoad.setAttribute('aria-disabled', isRetrying ? 'true' : 'false');
    shopRetryLoad.textContent = isRetrying ? 'Retrying...' : defaultText;
    if (shopError) {
        shopError.setAttribute('aria-busy', isRetrying ? 'true' : 'false');
    }
}

if (shopRetryLoad && !shopRetryLoad.dataset.defaultText) {
    shopRetryLoad.dataset.defaultText = shopRetryLoad.textContent.trim() || 'Retry';
}

function setActiveFilter(filterValue) {
    activeFilter = filterValue || 'all';
    filterBtns.forEach(b => {
        const isActive = (b.dataset.filter || 'all') === activeFilter;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-pressed', String(isActive));
    });
    updateShopGrid();
}

function updateShopGrid() {
    if (!shopGrid) return;

    if (shopLoadFailed) {
        if (shopError) {
            shopError.hidden = false;
            shopGrid.appendChild(shopError);
        }
        if (shopEmpty) shopEmpty.hidden = true;
        return;
    }

    if (!shopProductsReady) {
        setShopLoadingState(true);
        if (shopEmpty) shopEmpty.hidden = true;
        if (shopError) shopError.hidden = true;
        return;
    }

    hideShopLoadError();

    const sortedCards = [...shopCards].sort((a, b) => {
        const sortValue = sortSelect ? sortSelect.value : 'newest';
        if (sortValue === 'low-high') return Number(a.dataset.price) - Number(b.dataset.price);
        if (sortValue === 'high-low') return Number(b.dataset.price) - Number(a.dataset.price);
        return Number(a.dataset.order) - Number(b.dataset.order);
    });

    let visibleCount = 0;
    sortedCards.forEach(card => {
        const matchesCategory = matchesShopFilter(card.dataset.category, activeFilter);
        const matchesSearch = matchesShopSearch(card, activeShopSearch);
        const isVisible = matchesCategory && matchesSearch;
        card.style.display = isVisible ? '' : 'none';
        if (isVisible) visibleCount += 1;
        shopGrid.appendChild(card);
    });

    if (shopCount) {
        shopCount.textContent = `${visibleCount} product${visibleCount === 1 ? '' : 's'}`;
    }

    if (shopEmpty) {
        shopEmpty.hidden = visibleCount !== 0;
        if (visibleCount === 0) shopGrid.appendChild(shopEmpty);
    }
}

filterBtns.forEach(btn => {
    btn.addEventListener('click', () => setActiveFilter(btn.dataset.filter || 'all'));
});

if (sortSelect) {
    sortSelect.addEventListener('change', updateShopGrid);
}

if (shopClearFilters) {
    shopClearFilters.addEventListener('click', () => {
        activeShopSearch = '';
        if (shopSearchInput) shopSearchInput.value = '';
        setActiveFilter('all');
        window.history.replaceState(null, '', getShopPageBase());
    });
}

if (shopRetryLoad) {
    shopRetryLoad.addEventListener('click', () => {
        loadShopProducts({ forceRefresh: true });
    });
}

if (shopSearchForm && shopSearchInput) {
    shopSearchForm.addEventListener('submit', (event) => {
        event.preventDefault();
        activeShopSearch = shopSearchInput.value.trim();
        if (activeShopSearch) {
            window.history.replaceState(null, '', buildShopSearchUrl(activeShopSearch));
        } else {
            window.history.replaceState(null, '', getShopPageBase());
        }
        updateShopGrid();
    });

    shopSearchInput.addEventListener('input', () => {
        activeShopSearch = shopSearchInput.value.trim();
        updateShopGrid();
    });
}

function readShopSearchFromUrl() {
    if (!shopGrid) return;
    const params = new URLSearchParams(window.location.search);
    const query = params.get('search');
    if (query != null && String(query).trim() !== '') {
        activeShopSearch = query.trim();
        if (shopSearchInput) shopSearchInput.value = activeShopSearch;
    }
}

function initShopSearchFromUrl() {
    readShopSearchFromUrl();
    updateShopGrid();
}

readShopSearchFromUrl();
setShopLoadingState(true);

function getProductCategorySlug(product) {
    const category = product.category || {};
    const raw = category.slug || category.name || product.gender || product.badge || product.name || '';
    return String(raw).toLowerCase().trim().replace(/[\s_]+/g, '-');
}

async function loadShopProducts(options = {}) {
    if (!shopGrid) return;

    const isRetry = Boolean(options.forceRefresh);
    if (isRetry) {
        if (shopRetryInFlight) return;
        shopRetryInFlight = true;
        setShopRetryUi(true);
        restoreShopSkeletonCards();
    }

    setShopLoadingState(true);
    shopProductsReady = false;
    hideShopLoadError();

    if (isRetry) {
        catalogProductsCache = null;
        catalogProductsPromise = null;
    }

    try {
        const products = await fetchCatalogProducts();

        shopGrid.querySelectorAll('.product-card, .shop-skeleton-card').forEach(el => el.remove());
        shopLoadErrorLogged = false;
        resetShopEmptyCopy();

        if (products.length === 0) {
            console.warn('AFIFI: no products returned from API.');
            shopProductsReady = true;
            setShopLoadingState(false);
            shopCards = [];
            if (shopEmpty) {
                shopEmpty.hidden = false;
                shopGrid.appendChild(shopEmpty);
            }
            if (shopCount) shopCount.textContent = '0 products';
            return;
        }

        products.forEach((product, index) => {
            const card = renderProductCard(product);
            card.dataset.category = getProductCategorySlug(product);
            card.dataset.price = String(Number(product.base_price) || 0);
            card.dataset.order = String(index + 1);
            card.dataset.name = product.name || '';
            card.dataset.search = [product.name, product.slug, product.category && product.category.name]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();
            shopGrid.appendChild(card);
        });

        if (shopEmpty) {
            shopGrid.appendChild(shopEmpty);
        }
        if (shopError) {
            shopGrid.appendChild(shopError);
        }

        shopCards = Array.from(shopGrid.querySelectorAll('.product-card'));
        shopGrid.querySelectorAll('.wishlist').forEach(wireWishlistButton);
        updateWishlistBadge();

        shopProductsReady = true;
        setShopLoadingState(false);
        readShopSearchFromUrl();
        setActiveFilter('all');
    } catch (error) {
        if (!shopLoadErrorLogged) {
            console.warn('AFIFI: could not load shop products from API.', error);
            shopLoadErrorLogged = true;
        }
        shopGrid.querySelectorAll('.product-card, .shop-skeleton-card').forEach(el => el.remove());
        showShopLoadError();
    } finally {
        if (isRetry) {
            setShopRetryUi(false);
            shopRetryInFlight = false;
        }
    }
}

loadShopProducts();

// ========== CONTACT FORM ==========
const contactForm = document.getElementById('contactForm');

if (contactForm) {
    contactForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const btn = contactForm.querySelector('.submit-btn');
        btn.textContent = 'MESSAGE SENT';
        btn.style.background = '#2ecc71';
        btn.style.color = '#fff';
        setTimeout(() => {
            btn.textContent = 'SEND MESSAGE';
            btn.style.background = '';
            btn.style.color = '';
            contactForm.reset();
        }, 2500);
    });
}

// ========== ADD TO CART FEEDBACK ==========
const addToCartBtn = document.querySelector('.add-to-cart');

if (addToCartBtn) {
    addToCartBtn.addEventListener('click', async () => {
        if (addToCartBtn.disabled) return;

        const activeSize = document.querySelector('.size-btn.active');
        const activeColor = document.querySelector('.color-swatch.active');
        const mainImg = document.getElementById('mainProductImg');
        const qtySelector = document.getElementById('qtyValue');
        const cartLiveRegion = document.getElementById('cartLiveRegion');
        const selectedVariant = getSelectedVariant();

        if (!selectedVariant) {
            const message = 'Please select product options before adding to cart.';
            if (cartLiveRegion) cartLiveRegion.textContent = message;
            return;
        }

        if (!isVariantInStock(selectedVariant)) {
            const message = 'Selected option is sold out.';
            if (cartLiveRegion) cartLiveRegion.textContent = message;
            updateProductPageStockState();
            return;
        }

        const name = productPageData.name || addToCartBtn.dataset.name || 'AFIFI PRODUCT';
        const price = (selectedVariant && selectedVariant.price_override) || productPageData.base_price || addToCartBtn.dataset.price || 0;
        const requestedQty = Number(qtySelector ? qtySelector.textContent : 1) || 1;
        const maxQty = getCartItemMaxQuantity({ stock: selectedVariant.stock });

        if (requestedQty > maxQty) {
            const message = maxQty <= 0 ? 'This option is sold out.' : `Only ${maxQty} available in stock.`;
            if (cartLiveRegion) cartLiveRegion.textContent = message;
            return;
        }

        const result = await addCartItem({
            productId: productPageData.id || productPageIdentifier || addToCartBtn.dataset.id || name,
            variantId: selectedVariant ? selectedVariant.id : '',
            name,
            price: Number(price) || 0,
            quantity: requestedQty,
            size: activeSize ? activeSize.textContent.trim() : '',
            color: activeColor ? (activeColor.getAttribute('title') || '') : '',
            image: mainImg ? mainImg.src : '',
            stock: selectedVariant && selectedVariant.stock != null ? Number(selectedVariant.stock) : null
        });

        if (result && result.success === false) {
            const message = result.message || 'Could not add to cart. Please try again.';
            addToCartBtn.textContent = message;
            addToCartBtn.style.background = '#e74c3c';
            addToCartBtn.style.color = '#fff';
            if (cartLiveRegion) cartLiveRegion.textContent = message;
            setTimeout(() => {
                addToCartBtn.textContent = 'ADD TO CART';
                addToCartBtn.style.background = '';
                addToCartBtn.style.color = '';
            }, 2400);
            return;
        }

        addToCartBtn.textContent = 'ADDED TO CART';
        addToCartBtn.style.background = '#2ecc71';
        addToCartBtn.style.color = '#fff';
        if (cartLiveRegion) {
            cartLiveRegion.textContent = `${name} added to cart.`;
        }
        setTimeout(() => {
            addToCartBtn.textContent = 'ADD TO CART';
            addToCartBtn.style.background = '';
            addToCartBtn.style.color = '';
            updateProductPageStockState();
        }, 2000);
    });
}

// ========== PRODUCT DETAILS (Laravel backend integration, step 5) ==========
// Static hardcoded content stays as the fallback; only overridden on a successful match.
const COLOR_NAME_HEX_MAP = {
    black: '#0D0D0D', white: '#F5F5F5', brown: '#8B7355', grey: '#9E9E9E', gray: '#9E9E9E',
    navy: '#1B2A4A', blue: '#2E5AAC', red: '#C0392B', green: '#3B7A3B', beige: '#D8C3A5',
    khaki: '#8B8763', olive: '#6B6B3A', cream: '#F0E6D2'
};

function getColorHex(color) {
    if (color && color.hex_code) return color.hex_code;
    const name = String((color && color.name) || '').toLowerCase().trim();
    return COLOR_NAME_HEX_MAP[name] || '#CCCCCC';
}

function findProductBySlugOrId(products, identifier) {
    if (!identifier) return null;
    return products.find(p => p.slug === identifier || String(p.id) === String(identifier)) || null;
}

function getProductVariants(product) {
    return Array.isArray(product && product.variants) ? product.variants : [];
}

function normalizeStockValue(stock) {
    if (stock == null || stock === '') return null;
    const value = Number(stock);
    return Number.isFinite(value) ? value : null;
}

function isVariantInStock(variant) {
    const stock = normalizeStockValue(variant && variant.stock);
    if (stock === null) return true;
    return stock > 0;
}

function isProductFullySoldOut(product) {
    const variants = getProductVariants(product);
    if (variants.length === 0) return false;
    return variants.every(variant => !isVariantInStock(variant));
}

function getSelectedVariant() {
    const variants = Array.isArray(productPageData.variants) ? productPageData.variants : [];
    if (variants.length === 0) return null;
    if (variants.length === 1) return variants[0];

    const sizeWrapper = document.querySelector('.size-options');
    const colorWrapper = document.querySelector('.color-options');
    const hasSizeOptions = Boolean(
        sizeWrapper
        && sizeWrapper.style.display !== 'none'
        && sizeWrapper.querySelector('.size-btn')
    );
    const hasColorOptions = Boolean(
        colorWrapper
        && colorWrapper.style.display !== 'none'
        && colorWrapper.querySelector('.color-swatch')
    );

    if (!hasSizeOptions && !hasColorOptions) {
        return variants.length === 1 ? variants[0] : null;
    }

    const activeSizeBtn = document.querySelector('.size-btn.active');
    const activeColorSwatch = document.querySelector('.color-swatch.active');
    const sizeId = activeSizeBtn ? activeSizeBtn.dataset.sizeId : '';
    const colorId = activeColorSwatch ? activeColorSwatch.dataset.colorId : '';

    if (hasSizeOptions && !sizeId) return null;
    if (hasColorOptions && !colorId) return null;

    return variants.find(variant => {
        const sizeMatches = !hasSizeOptions || String(variant.size_id) === String(sizeId);
        const colorMatches = !hasColorOptions || String(variant.color_id) === String(colorId);
        return sizeMatches && colorMatches;
    }) || null;
}

function ensureProductStockStatusElement() {
    let statusEl = document.getElementById('productStockStatus');
    if (statusEl) return statusEl;

    statusEl = document.createElement('p');
    statusEl.id = 'productStockStatus';
    statusEl.className = 'product-stock-status';
    statusEl.setAttribute('role', 'status');
    statusEl.setAttribute('aria-live', 'polite');
    statusEl.hidden = true;

    const priceEl = document.querySelector('.product-price');
    if (priceEl) priceEl.insertAdjacentElement('afterend', statusEl);
    else {
        const info = document.querySelector('.product-details-info');
        if (info) info.insertBefore(statusEl, info.querySelector('.color-options'));
    }
    return statusEl;
}

function updateProductPageStockState() {
    if (!document.querySelector('.product-details-info')) return;

    const variants = Array.isArray(productPageData.variants) ? productPageData.variants : [];
    const fullySoldOut = variants.length > 0 && variants.every(variant => !isVariantInStock(variant));
    const selectedVariant = getSelectedVariant();
    const variantSoldOut = Boolean(selectedVariant && !isVariantInStock(selectedVariant));
    const needsSelection = variants.length > 1 && !selectedVariant;
    const maxQty = selectedVariant
        ? getCartItemMaxQuantity({ stock: selectedVariant.stock })
        : (fullySoldOut ? 0 : CART_MAX_QUANTITY);
    const disablePurchase = fullySoldOut || variantSoldOut || needsSelection;

    const statusEl = ensureProductStockStatusElement();
    if (fullySoldOut) {
        statusEl.textContent = 'Sold Out';
        statusEl.className = 'product-stock-status is-sold-out';
        statusEl.hidden = false;
    } else if (needsSelection) {
        statusEl.textContent = 'Select options to check availability';
        statusEl.className = 'product-stock-status';
        statusEl.hidden = false;
    } else if (variantSoldOut) {
        statusEl.textContent = 'Selected option is sold out';
        statusEl.className = 'product-stock-status is-sold-out';
        statusEl.hidden = false;
    } else if (selectedVariant) {
        const stock = normalizeStockValue(selectedVariant.stock);
        if (stock !== null && stock <= 5) {
            statusEl.textContent = stock === 1 ? 'Only 1 left in stock' : `Only ${stock} left in stock`;
            statusEl.className = 'product-stock-status is-low-stock';
            statusEl.hidden = false;
        } else {
            statusEl.hidden = true;
        }
    } else {
        statusEl.hidden = true;
    }

    if (addToCartBtn) {
        addToCartBtn.disabled = disablePurchase;
        if (fullySoldOut || variantSoldOut) {
            addToCartBtn.textContent = 'SOLD OUT';
        } else if (addToCartBtn.textContent === 'SOLD OUT') {
            addToCartBtn.textContent = 'ADD TO CART';
        }
    }

    if (qtyPlus) qtyPlus.disabled = disablePurchase || maxQty <= 1;
    if (qtyMinus) qtyMinus.disabled = disablePurchase;
    if (qtyValue) {
        if (disablePurchase) {
            qtyValue.textContent = '1';
        } else if (maxQty > 0) {
            const val = parseInt(qtyValue.textContent, 10) || 1;
            if (val > maxQty) qtyValue.textContent = String(maxQty);
            if (val < 1) qtyValue.textContent = '1';
        }
    }

    const whatsappOrderLink = document.querySelector('.whatsapp-order');
    if (whatsappOrderLink) {
        whatsappOrderLink.hidden = false;
        whatsappOrderLink.classList.toggle('is-disabled', disablePurchase);
        whatsappOrderLink.setAttribute('aria-disabled', disablePurchase ? 'true' : 'false');
        if (!disablePurchase && productPageData.name) {
            const price = (selectedVariant && selectedVariant.price_override)
                || productPageData.base_price
                || addToCartBtn?.dataset.price
                || 0;
            const message = `Hello AFIFI, I want to order ${productPageData.name} - ${formatPrice(price)}`;
            whatsappOrderLink.href = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;
        }
    }
}

function renderSizeButtons(sizes) {
    const container = document.querySelector('.size-btns');
    if (!container) return;
    const wrapper = container.closest('.size-options');

    if (!Array.isArray(sizes) || sizes.length === 0) {
        // Product has no size variants via API - clear the static fallback
        // buttons instead of leaving stale ones with no data-size-id that
        // could confuse users or interfere with variant matching.
        container.innerHTML = '';
        if (wrapper) wrapper.style.display = 'none';
        updateProductPageStockState();
        return;
    }

    if (wrapper) wrapper.style.display = '';
    container.innerHTML = '';
    sizes.forEach((size, index) => {
        const btn = document.createElement('button');
        btn.className = 'size-btn' + (index === 0 ? ' active' : '');
        btn.setAttribute('aria-pressed', index === 0 ? 'true' : 'false');
        btn.dataset.sizeId = size.id;
        btn.textContent = size.name || size.slug || '';
        container.appendChild(btn);
        wireSizeButton(btn);
    });
    updateProductPageStockState();
}

function renderColorSwatches(colors) {
    const container = document.querySelector('.color-swatches');
    if (!container) return;
    const wrapper = container.closest('.color-options');

    if (!Array.isArray(colors) || colors.length === 0) {
        // Product has no color variants via API - clear the static fallback
        // swatches instead of leaving stale ones with no data-color-id that
        // could confuse users or interfere with variant matching.
        container.innerHTML = '';
        if (wrapper) wrapper.style.display = 'none';
        updateProductPageStockState();
        return;
    }

    if (wrapper) wrapper.style.display = '';
    container.innerHTML = '';
    colors.forEach((color, index) => {
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = 'color-swatch' + (index === 0 ? ' active' : '');
        swatch.style.background = getColorHex(color);
        const name = color.name || color.slug || 'Color';
        swatch.title = name;
        swatch.setAttribute('aria-label', name);
        swatch.setAttribute('aria-pressed', index === 0 ? 'true' : 'false');
        swatch.dataset.colorId = color.id;
        container.appendChild(swatch);
        wireColorSwatch(swatch);
    });
    updateProductPageStockState();
}

function renderThumbnails(images, productName) {
    const container = document.querySelector('.thumbnails');
    if (!container || !Array.isArray(images) || images.length === 0) return;

    container.innerHTML = '';
    images.forEach((src, index) => {
        const thumbBtn = document.createElement('button');
        thumbBtn.type = 'button';
        thumbBtn.className = 'thumb-btn';
        thumbBtn.setAttribute('aria-label', `View image ${index + 1}`);
        thumbBtn.setAttribute('aria-pressed', index === 0 ? 'true' : 'false');

        const img = document.createElement('img');
        img.src = src;
        img.alt = productName ? `${productName} thumbnail ${index + 1}` : `View ${index + 1}`;
        img.className = 'thumb' + (index === 0 ? ' active-thumb' : '');
        img.width = 80;
        img.height = 80;
        img.decoding = 'async';
        img.loading = 'lazy';
        img.onerror = function onThumbError() {
            this.onerror = null;
            this.src = PRODUCT_IMAGE_FALLBACK;
        };

        thumbBtn.appendChild(img);
        container.appendChild(thumbBtn);
        wireThumbButton(thumbBtn);
    });

    if (images[0]) {
        preloadProductImage(images[0]);
        setMainProductImage(images[0], productName || 'Product image');
    }
}

function renderRelatedProducts(currentProduct, allProducts) {
    const container = document.querySelector('.related-grid');
    if (!container) return;

    const related = allProducts
        .filter(p => p.id !== currentProduct.id)
        .filter(p => !currentProduct.category || !p.category || p.category.id === currentProduct.category.id)
        .slice(0, 4);

    if (related.length === 0) return;

    container.innerHTML = '';
    related.forEach(product => container.appendChild(renderProductCard(product)));
    container.querySelectorAll('.wishlist').forEach(wireWishlistButton);
}

function showProductNotFoundState(message) {
    const info = document.querySelector('.product-details-info');
    if (!info) return;

    const detail = document.getElementById('productDetail');
    if (detail) detail.classList.remove('is-loading');

    document.title = 'AFIFI | Product Not Found';

    const breadcrumbCurrent = document.getElementById('productBreadcrumbCurrent')
        || document.querySelector('.breadcrumbs-section > span:last-of-type');
    if (breadcrumbCurrent) breadcrumbCurrent.textContent = 'Product not found';

    const loadingMsg = info.querySelector('.product-loading-message');
    if (loadingMsg) loadingMsg.remove();

    const h1 = info.querySelector('h1');
    if (h1) h1.textContent = 'Product not found';

    const priceEl = info.querySelector('.product-price');
    if (priceEl) priceEl.textContent = '';

    const descEl = info.querySelector('.product-desc');
    if (descEl) {
        descEl.textContent = message || 'This product could not be found. Browse the shop to discover available items.';
    }

    info.querySelectorAll('.color-options, .size-options, .quantity-selector, .add-to-cart, .whatsapp-order, .add-wishlist, .purchase-notes')
        .forEach(el => { el.style.display = 'none'; });

    const gallery = document.querySelector('.product-gallery');
    if (gallery) gallery.style.display = 'none';

    const tabs = document.querySelector('.product-tabs');
    if (tabs) tabs.style.display = 'none';

    const related = document.querySelector('.related-products');
    if (related) related.style.display = 'none';

    const skeleton = document.querySelector('.product-image-skeleton');
    if (skeleton) skeleton.hidden = true;

    if (!info.querySelector('.product-back-link')) {
        const backLink = document.createElement('a');
        backLink.className = 'story-btn product-back-link';
        backLink.href = 'shop.html';
        backLink.textContent = 'BACK TO SHOP \u203a';
        info.appendChild(backLink);
    }
}

function revealProductDetailUI(matched) {
    const detail = document.getElementById('productDetail');
    if (detail) detail.classList.remove('is-loading');

    const loadingMsg = document.querySelector('.product-loading-message');
    if (loadingMsg) loadingMsg.remove();

    const breadcrumbCurrent = document.getElementById('productBreadcrumbCurrent');
    if (breadcrumbCurrent) breadcrumbCurrent.textContent = matched.name;

    const mainImg = document.getElementById('mainProductImg');
    if (mainImg) mainImg.alt = matched.name || 'Product image';

    const addWishlistLink = document.querySelector('.add-wishlist');
    if (addWishlistLink) addWishlistLink.hidden = false;

    const related = document.querySelector('.related-products');
    if (related) related.style.display = '';
}

function updateProductDescriptionTab(matched) {
    const descTab = document.getElementById('desc');
    if (!descTab) return;

    const text = matched.description || matched.short_description || '';
    descTab.innerHTML = '';
    if (text) {
        text.split(/\n{2,}/).map(part => part.trim()).filter(Boolean).forEach(part => {
            const paragraph = document.createElement('p');
            paragraph.textContent = part;
            descTab.appendChild(paragraph);
        });
    } else {
        const paragraph = document.createElement('p');
        paragraph.textContent = 'Product details will be available soon.';
        descTab.appendChild(paragraph);
    }
}

async function loadProductDetails() {
    if (!document.querySelector('.product-details-info')) return;

    if (!productPageIdentifier) {
        showProductNotFoundState('No product was specified. Choose a product from the shop or homepage.');
        return;
    }

    try {
        const products = await fetchCatalogProducts();
        const matched = findProductBySlugOrId(products, productPageIdentifier);

        if (!matched) {
            console.warn(`AFIFI: no product found for "${productPageIdentifier}".`);
            showProductNotFoundState(`We couldn't find a product matching "${productPageIdentifier}".`);
            return;
        }

        productPageData = {
            id: matched.id,
            name: matched.name,
            slug: matched.slug,
            base_price: matched.base_price,
            variants: Array.isArray(matched.variants) ? matched.variants : []
        };

        document.title = `AFIFI | ${matched.name}`;

        const titleEl = document.querySelector('.product-details-info h1');
        const priceEl = document.querySelector('.product-price');
        const descEl = document.querySelector('.product-desc');
        const addWishlistLink = document.querySelector('.add-wishlist');
        const whatsappOrderLink = document.querySelector('.whatsapp-order');

        if (titleEl) titleEl.textContent = matched.name;

        if (matched.badge && titleEl) {
            let badgeEl = document.querySelector('.product-detail-badge');
            if (!badgeEl) {
                badgeEl = document.createElement('span');
                badgeEl.className = 'product-detail-badge';
                titleEl.parentNode.insertBefore(badgeEl, titleEl);
            }
            badgeEl.textContent = matched.badge;
        }

        if (priceEl) {
            priceEl.innerHTML = '';
            priceEl.appendChild(document.createTextNode(formatPrice(matched.base_price)));
            if (matched.compare_at_price && Number(matched.compare_at_price) > Number(matched.base_price)) {
                const compareSpan = document.createElement('span');
                compareSpan.className = 'product-compare-price';
                compareSpan.textContent = formatPrice(matched.compare_at_price);
                priceEl.appendChild(compareSpan);
            }
        }

        if (descEl) {
            descEl.textContent = matched.description || matched.short_description || descEl.textContent;
        }

        if (addToCartBtn) {
            addToCartBtn.dataset.id = matched.slug || matched.id;
            addToCartBtn.dataset.name = matched.name;
            addToCartBtn.dataset.price = matched.base_price;
        }

        if (addWishlistLink) {
            addWishlistLink.setAttribute('aria-label', `Add ${matched.name} to wishlist`);
            addWishlistLink.dataset.id = matched.slug || matched.id;
            if (typeof refreshWishlistActiveState === 'function') {
                refreshWishlistActiveState(addWishlistLink);
            }
        }

        if (whatsappOrderLink) {
            const message = `Hello AFIFI, I want to order ${matched.name} - ${formatPrice(matched.base_price)}`;
            whatsappOrderLink.href = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;
        }

        renderThumbnails(getProductImages(matched), matched.name);

        const sizes = [];
        const sizeIds = new Set();
        const colors = [];
        const colorIds = new Set();
        productPageData.variants.forEach(variant => {
            if (variant.size && !sizeIds.has(variant.size.id)) {
                sizeIds.add(variant.size.id);
                sizes.push(variant.size);
            }
            if (variant.color && !colorIds.has(variant.color.id)) {
                colorIds.add(variant.color.id);
                colors.push(variant.color);
            }
        });

        renderSizeButtons(sizes);
        renderColorSwatches(colors);
        renderRelatedProducts(matched, products);
        revealProductDetailUI(matched);
        updateProductDescriptionTab(matched);
        updateProductPageStockState();
    } catch (error) {
        console.warn('AFIFI: could not load product details from API.', error);
        showProductNotFoundState('Unable to load product details right now. Please try again later.');
    }
}

loadProductDetails();

// ========== NAV ICON BADGES (Cart / Wishlist) ==========
function injectNavExtras() {
    document.querySelectorAll('.icons').forEach(iconsWrap => {
        const cartImg = iconsWrap.querySelector('img[alt="Cart"]');
        const cartLink = cartImg ? cartImg.closest('a') : null;
        if (!cartLink || cartLink.dataset.badgeReady) return;
        cartLink.dataset.badgeReady = 'true';

        const cartBadge = document.createElement('span');
        cartBadge.className = 'nav-badge';
        cartBadge.id = 'cartBadge';
        cartLink.appendChild(cartBadge);

        const wishlistLink = document.createElement('a');
        wishlistLink.href = '#';
        wishlistLink.className = 'wishlist-icon-link';
        wishlistLink.setAttribute('aria-label', 'Wishlist');
        wishlistLink.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#F5F5F5" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7.2-4.5-9.6-9.1C.8 8.4 2.2 4.9 5.6 4.4a5 5 0 0 1 6.4 2 5 5 0 0 1 6.4-2c3.4.5 4.8 4 3.2 7.5C19.2 16.5 12 21 12 21z"/></svg><span class="nav-badge" id="wishlistBadge">0</span>';
        iconsWrap.insertBefore(wishlistLink, cartLink);
    });
}

injectNavExtras();

// ========== AUTH (Laravel backend integration, step 6) ==========
const AUTH_USER_KEY = 'afifiUser';

function getStoredUser() {
    try {
        return JSON.parse(localStorage.getItem(AUTH_USER_KEY) || 'null');
    } catch (error) {
        return null;
    }
}

function setStoredUser(user) {
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user || null));
}

function clearStoredUser() {
    localStorage.removeItem(AUTH_USER_KEY);
}

function isLoggedIn() {
    return Boolean(window.afifiApi.getAuthToken());
}

function getAuthErrorMessage(error) {
    if (error && error.errors && typeof error.errors === 'object') {
        const messages = Object.values(error.errors).flat().filter(Boolean);
        if (messages.length > 0) return messages.join(' ');
    }
    if (error && error.message) return error.message;
    return 'Something went wrong. Please try again.';
}

function updateAuthUI() {
    const loggedIn = isLoggedIn();
    const user = getStoredUser();
    document.querySelectorAll('[data-auth-ready]').forEach(link => {
        link.classList.toggle('logged-in', loggedIn);
        link.setAttribute('aria-label', loggedIn ? `Account${user && user.name ? ': ' + user.name : ''}` : 'Account');
    });
    if (!loggedIn && typeof accountMenu !== 'undefined') {
        accountMenu.close();
    }
}

async function handleLogout() {
    const token = window.afifiApi.getAuthToken();
    if (token) {
        try {
            await window.afifiApi.apiRequest('/auth/logout', { method: 'POST' });
        } catch (error) {
            console.warn('AFIFI: logout request failed, clearing local session anyway.', error);
        }
    }
    window.afifiApi.clearAuthToken();
    clearStoredUser();
    apiCartItems = [];
    apiWishlistItems = [];
    cartItems = readGuestCartFromStorage();
    wishlistItems = readGuestWishlistFromStorage();
    updateAuthUI();
    renderCart();
}

function createAccountMenu() {
    const menu = document.createElement('div');
    menu.className = 'account-menu';
    menu.hidden = true;
    menu.innerHTML = `
        <a href="#" class="account-menu-item" data-action="profile">My Profile</a>
        <a href="#" class="account-menu-item" data-action="orders">My Orders</a>
        <button type="button" class="account-menu-item account-logout" data-action="logout">Logout</button>
    `;
    document.body.appendChild(menu);

    function closeMenu() {
        menu.hidden = true;
    }

    function openMenu(anchor) {
        const rect = anchor.getBoundingClientRect();
        menu.style.top = `${rect.bottom + 8}px`;
        menu.style.right = `${Math.max(window.innerWidth - rect.right, 8)}px`;
        menu.hidden = false;
    }

    menu.addEventListener('click', (e) => {
        const item = e.target.closest('[data-action]');
        if (!item) return;
        e.preventDefault();
        if (item.dataset.action === 'logout') {
            handleLogout();
        }
        closeMenu();
    });

    document.addEventListener('click', (e) => {
        if (!menu.hidden && !menu.contains(e.target) && !e.target.closest('[data-auth-ready]')) {
            closeMenu();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !menu.hidden) closeMenu();
    });

    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', closeMenu, true);

    return {
        close: closeMenu,
        toggle: (anchor) => {
            if (menu.hidden) openMenu(anchor); else closeMenu();
        }
    };
}

const accountMenu = createAccountMenu();

function wireProfileIcon(iconsWrap) {
    const profileImg = iconsWrap.querySelector('img[alt="Profile"]');
    const profileLink = profileImg ? profileImg.closest('a') : null;
    if (!profileLink || profileLink.dataset.authReady) return;
    profileLink.dataset.authReady = 'true';

    profileLink.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isLoggedIn()) {
            accountMenu.toggle(profileLink);
        } else {
            openAuthModal('login');
        }
    });
}

document.querySelectorAll('.icons').forEach(wireProfileIcon);

function createAuthModal() {
    const overlay = document.createElement('div');
    overlay.className = 'auth-modal-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `
        <div class="auth-modal" role="dialog" aria-modal="true" aria-labelledby="authModalTitle">
            <button type="button" class="auth-modal-close" aria-label="Close">&times;</button>
            <h2 id="authModalTitle" class="auth-modal-title">WELCOME TO AFIFI</h2>
            <div class="auth-tabs" role="tablist">
                <button type="button" class="auth-tab active" data-tab="login" id="authTabLogin" role="tab" aria-selected="true">Login</button>
                <button type="button" class="auth-tab" data-tab="register" id="authTabRegister" role="tab" aria-selected="false">Register</button>
            </div>
            <div class="auth-modal-message" id="authModalMessage" role="alert" hidden></div>
            <form class="auth-form active" data-form="login" role="tabpanel" aria-labelledby="authTabLogin" novalidate>
                <label class="auth-label" for="authLoginField">Email or Phone</label>
                <input class="auth-input" type="text" id="authLoginField" name="login" autocomplete="username" required>
                <label class="auth-label" for="authLoginPassword">Password</label>
                <input class="auth-input" type="password" id="authLoginPassword" name="password" autocomplete="current-password" required>
                <button type="submit" class="auth-submit">LOGIN</button>
            </form>
            <form class="auth-form" data-form="register" role="tabpanel" aria-labelledby="authTabRegister" novalidate hidden>
                <label class="auth-label" for="authRegisterName">Name</label>
                <input class="auth-input" type="text" id="authRegisterName" name="name" autocomplete="name" required>
                <label class="auth-label" for="authRegisterEmail">Email (optional)</label>
                <input class="auth-input" type="email" id="authRegisterEmail" name="email" autocomplete="email">
                <label class="auth-label" for="authRegisterPhone">Phone</label>
                <input class="auth-input" type="text" id="authRegisterPhone" name="phone" autocomplete="tel" required>
                <label class="auth-label" for="authRegisterPassword">Password</label>
                <input class="auth-input" type="password" id="authRegisterPassword" name="password" autocomplete="new-password" required>
                <label class="auth-label" for="authRegisterPasswordConfirm">Confirm Password</label>
                <input class="auth-input" type="password" id="authRegisterPasswordConfirm" name="password_confirmation" autocomplete="new-password" required>
                <button type="submit" class="auth-submit">CREATE ACCOUNT</button>
            </form>
        </div>
    `;
    document.body.appendChild(overlay);

    const tabs = overlay.querySelectorAll('.auth-tab');
    const forms = overlay.querySelectorAll('.auth-form');
    const messageBox = overlay.querySelector('#authModalMessage');
    const loginForm = overlay.querySelector('[data-form="login"]');
    const registerForm = overlay.querySelector('[data-form="register"]');
    const closeBtn = overlay.querySelector('.auth-modal-close');

    function showMessage(text, type) {
        messageBox.textContent = text || '';
        messageBox.className = `auth-modal-message${type ? ' ' + type : ''}`;
        messageBox.hidden = !text;
    }

    function switchTab(tabName) {
        tabs.forEach(tab => {
            const active = tab.dataset.tab === tabName;
            tab.classList.toggle('active', active);
            tab.setAttribute('aria-selected', String(active));
        });
        forms.forEach(form => {
            const active = form.dataset.form === tabName;
            form.classList.toggle('active', active);
            form.hidden = !active;
        });
        showMessage('');
        const firstInput = overlay.querySelector(`.auth-form[data-form="${tabName}"] input`);
        if (firstInput) firstInput.focus();
    }

    tabs.forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    function closeModal() {
        concealOverlay(overlay, 'auth-modal-open', () => {
            showMessage('');
            loginForm.reset();
            registerForm.reset();
        });
    }

    function openModal(tabName) {
        revealOverlay(overlay, 'auth-modal-open');
        switchTab(tabName || 'login');
    }

    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay.classList.contains('is-open')) closeModal();
    });

    function setFormLoading(form, isLoading) {
        const btn = form.querySelector('.auth-submit');
        if (!btn) return;
        btn.disabled = isLoading;
        btn.dataset.originalText = btn.dataset.originalText || btn.textContent;
        btn.textContent = isLoading ? 'PLEASE WAIT...' : btn.dataset.originalText;
    }

    async function handleAuthSuccess(data) {
        if (data && data.token) {
            window.afifiApi.setAuthToken(data.token);
        }
        if (data && data.user) {
            setStoredUser(data.user);
        }
        showMessage('Success! Welcome to AFIFI.', 'success');
        updateAuthUI();
        try {
            await mergeGuestCartIntoApiCart();
        } catch (error) {
            console.warn('AFIFI: guest cart merge failed after auth.', error);
            showCartMergeWarning('Some cart items may not have synced. They remain saved on this device.');
            await loadApiCart();
        }
        try {
            await mergeGuestWishlistIntoApiWishlist();
        } catch (error) {
            console.warn('AFIFI: guest wishlist merge failed after auth.', error);
            showWishlistMergeWarning('Some wishlist items may not have synced. They remain saved on this device.');
            await loadApiWishlist();
        }
        setTimeout(closeModal, 900);
    }

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        showMessage('');
        setFormLoading(loginForm, true);
        try {
            const formData = new FormData(loginForm);
            const data = await window.afifiApi.apiRequest('/auth/login', {
                method: 'POST',
                body: {
                    login: formData.get('login'),
                    password: formData.get('password')
                }
            });
            handleAuthSuccess(data);
        } catch (error) {
            showMessage(getAuthErrorMessage(error), 'error');
        } finally {
            setFormLoading(loginForm, false);
        }
    });

    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        showMessage('');
        setFormLoading(registerForm, true);
        try {
            const formData = new FormData(registerForm);
            const email = formData.get('email');
            const data = await window.afifiApi.apiRequest('/auth/register', {
                method: 'POST',
                body: {
                    name: formData.get('name'),
                    email: email ? email : null,
                    phone: formData.get('phone'),
                    password: formData.get('password'),
                    password_confirmation: formData.get('password_confirmation')
                }
            });
            handleAuthSuccess(data);
        } catch (error) {
            showMessage(getAuthErrorMessage(error), 'error');
        } finally {
            setFormLoading(registerForm, false);
        }
    });

    return { open: openModal, close: closeModal };
}

const authModal = createAuthModal();

function openAuthModal(tabName) {
    authModal.open(tabName);
}

updateAuthUI();

// ========== CART AND WHATSAPP ORDERING ==========
let whatsappNumber = '201109960670';
const CART_PLACEHOLDER_IMAGE = 'images/AFIFI_BRANDS_VECTOR.svg';

// Normalizes both legacy items ({ name, price, qty }) and richer items
// ({ id, productId, variantId, name, price, quantity, size, color, image })
// into one consistent shape so older saved carts keep working.
const CART_MAX_QUANTITY = 10;

function normalizeCartItem(raw) {
    const size = raw.size || '';
    const color = raw.color || '';
    const stockValue = raw.stock;
    return {
        id: raw.id || raw.variantId || `${raw.productId || raw.name}-${size}-${color}`,
        productId: raw.productId || raw.name || '',
        variantId: raw.variantId || '',
        name: raw.name || 'AFIFI PRODUCT',
        price: Number(raw.price) || 0,
        quantity: Number(raw.quantity ?? raw.qty ?? 1) || 1,
        size,
        color,
        image: raw.image || '',
        stock: stockValue == null || stockValue === '' ? null : Number(stockValue)
    };
}

function getCartItemMaxQuantity(item) {
    const stock = normalizeStockValue(item && item.stock);
    if (stock === null) return CART_MAX_QUANTITY;
    if (stock <= 0) return 0;
    return Math.min(stock, CART_MAX_QUANTITY);
}

function getLookupVariantDetails(lookupMap, variantId) {
    if (!lookupMap || variantId == null || variantId === '') return null;
    return lookupMap.get(Number(variantId)) || lookupMap.get(String(variantId)) || null;
}

function applyStockToCartItem(item, lookupMap) {
    if (!item || !item.variantId) return item;
    const details = getLookupVariantDetails(lookupMap, item.variantId);
    if (details && details.stock != null) {
        item.stock = Number(details.stock);
    }
    return item;
}

let cartItems = (JSON.parse(localStorage.getItem('afifiCart') || '[]')).map(normalizeCartItem);

// ========== CART: Laravel backend integration (step 7, logged-in users only) ==========
// Logged-out users keep the existing localStorage cart (`cartItems`) untouched.
// Logged-in users are backed by `apiCartItems`, hydrated from GET /cart.
let apiCartItems = [];
let productLookupMapCache = null;

function invalidateCatalogStockCache() {
    catalogProductsCache = null;
    productLookupMapCache = null;
}

function getActiveCartItems() {
    return isLoggedIn() ? apiCartItems : cartItems;
}

async function getProductLookupMap() {
    if (productLookupMapCache) return productLookupMapCache;
    const map = new Map();
    try {
        const products = await fetchCatalogProducts();
        products.forEach(product => {
            const image = getProductImage(product);
            (product.variants || []).forEach(variant => {
                map.set(variant.id, {
                    name: product.name,
                    image,
                    size: variant.size ? variant.size.name : '',
                    color: variant.color ? variant.color.name : '',
                    stock: variant.stock
                });
            });
        });
        productLookupMapCache = map;
    } catch (error) {
        console.warn('AFIFI: could not load product details to enrich cart items.', error);
    }
    return map;
}

function normalizeApiCartItem(item, lookupMap) {
    const variant = item.product_variant || {};
    const details = getLookupVariantDetails(lookupMap, variant.id);
    const stockFromLookup = details && details.stock != null ? Number(details.stock) : null;
    const stockFromVariant = variant.stock != null ? Number(variant.stock) : null;
    return {
        id: `api-${item.id}`,
        apiCartItemId: item.id,
        productId: variant.product_id || '',
        variantId: variant.id || '',
        name: (details && details.name) || variant.sku || 'AFIFI PRODUCT',
        price: Number(item.unit_price_snapshot) || 0,
        quantity: Number(item.quantity) || 1,
        size: (details && details.size) || '',
        color: (details && details.color) || '',
        image: (details && details.image) || '',
        stock: stockFromLookup != null ? stockFromLookup : stockFromVariant
    };
}

async function refreshApiCartFromServer() {
    const response = await window.afifiApi.apiRequest('/cart');
    const cart = response && response.data;
    const items = (cart && cart.items) || [];
    const lookupMap = await getProductLookupMap();
    apiCartItems = items.map(item => normalizeApiCartItem(item, lookupMap));
}

async function loadApiCart() {
    if (!isLoggedIn()) return;
    try {
        await refreshApiCartFromServer();
    } catch (error) {
        console.warn('AFIFI: failed to load cart from server.', error);
        apiCartItems = [];
    }
    renderCart();
}

async function postApiCartItem(variantId, quantity) {
    await window.afifiApi.apiRequest('/cart/items', {
        method: 'POST',
        body: {
            product_variant_id: Number(variantId),
            quantity: Number(quantity) || 1
        }
    });
}

async function putApiCartItemQuantity(cartItemId, quantity) {
    await window.afifiApi.apiRequest(`/cart/items/${cartItemId}`, {
        method: 'PUT',
        body: { quantity: Number(quantity) || 1 }
    });
}

function readGuestCartFromStorage() {
    try {
        const raw = localStorage.getItem('afifiCart');
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.map(normalizeCartItem).filter(item => (Number(item.quantity) || 0) > 0);
    } catch (error) {
        console.warn('AFIFI: could not parse guest cart from localStorage.', error);
        return [];
    }
}

function clearGuestCartStorage() {
    cartItems = [];
    try {
        localStorage.removeItem('afifiCart');
    } catch (error) {
        console.warn('AFIFI: could not clear guest cart from localStorage.', error);
    }
}

function getCartMergeKey(item) {
    if (item && item.variantId) return `variant:${String(item.variantId)}`;
    const size = (item && item.size) || '';
    const color = (item && item.color) || '';
    const productId = (item && item.productId) || '';
    return `product:${productId}|${size}|${color}`;
}

function findApiCartItemByGuestItem(guestItem) {
    if (guestItem.variantId) {
        return apiCartItems.find(item => String(item.variantId) === String(guestItem.variantId)) || null;
    }
    return apiCartItems.find(item =>
        String(item.productId) === String(guestItem.productId) &&
        (item.size || '') === (guestItem.size || '') &&
        (item.color || '') === (guestItem.color || '')
    ) || null;
}

function splitGuestQuantityForMerge(guestItem, existingApiItem) {
    const guestQty = Math.max(1, Number(guestItem.quantity) || 1);
    const existingQty = existingApiItem ? Math.max(0, Number(existingApiItem.quantity) || 0) : 0;
    const maxQty = getCartItemMaxQuantity(existingApiItem || guestItem);

    if (existingApiItem) {
        const targetQty = Math.min(maxQty, existingQty + guestQty);
        const addable = Math.max(0, targetQty - existingQty);
        const leftover = guestQty - addable;
        return { addable, leftover, targetQty };
    }

    const addable = Math.min(maxQty, guestQty);
    const leftover = guestQty - addable;
    return { addable, leftover, targetQty: addable };
}

function showCartMergeWarning(message) {
    if (!message) return;
    const panel = document.querySelector('.cart-panel');
    if (!panel) {
        console.warn('AFIFI cart merge:', message);
        return;
    }
    let banner = panel.querySelector('.cart-merge-warning');
    if (!banner) {
        banner = document.createElement('p');
        banner.className = 'cart-merge-warning';
        banner.setAttribute('role', 'status');
        const itemsWrap = panel.querySelector('.cart-items');
        if (itemsWrap) panel.insertBefore(banner, itemsWrap);
        else panel.appendChild(banner);
    }
    banner.textContent = message;
    banner.hidden = false;
}

function consolidateGuestCartItems(guestItems) {
    const byKey = new Map();
    guestItems.forEach(item => {
        const key = getCartMergeKey(item);
        const existing = byKey.get(key);
        if (existing) {
            existing.quantity = (Number(existing.quantity) || 0) + (Number(item.quantity) || 1);
        } else {
            byKey.set(key, { ...item });
        }
    });
    return Array.from(byKey.values());
}

async function mergeGuestCartIntoApiCart() {
    if (!isLoggedIn()) return { mergedCount: 0, failedItems: [] };

    const guestItems = readGuestCartFromStorage();
    if (guestItems.length === 0) {
        await loadApiCart();
        return { mergedCount: 0, failedItems: [] };
    }

    try {
        await refreshApiCartFromServer();
    } catch (error) {
        console.warn('AFIFI: could not load account cart for guest merge.', error);
        showCartMergeWarning('Could not load your account cart. Guest cart items were kept on this device.');
        renderCart();
        return { mergedCount: 0, failedItems: guestItems };
    }

    const failedItems = [];
    let mergedCount = 0;
    const consolidatedGuestItems = consolidateGuestCartItems(guestItems);

    for (const guestItem of consolidatedGuestItems) {
        if (!guestItem.variantId) {
            failedItems.push({
                ...guestItem,
                mergeError: 'Missing product option. Open the product and add it again while logged in.'
            });
            continue;
        }

        const variantId = Number(guestItem.variantId);
        if (!Number.isFinite(variantId) || variantId <= 0) {
            failedItems.push({ ...guestItem, mergeError: 'Invalid product option.' });
            continue;
        }

        const existingApiItem = findApiCartItemByGuestItem(guestItem);
        const { addable, leftover, targetQty } = splitGuestQuantityForMerge(guestItem, existingApiItem);

        if (addable <= 0) {
            if (leftover > 0) {
                failedItems.push({
                    ...guestItem,
                    quantity: leftover,
                    mergeError: 'Quantity limit reached for this item.'
                });
            }
            continue;
        }

        try {
            if (existingApiItem && existingApiItem.apiCartItemId) {
                await putApiCartItemQuantity(existingApiItem.apiCartItemId, targetQty);
                existingApiItem.quantity = targetQty;
            } else {
                await postApiCartItem(variantId, addable);
                await refreshApiCartFromServer();
            }
            mergedCount += 1;
            if (leftover > 0) {
                failedItems.push({
                    ...guestItem,
                    quantity: leftover,
                    mergeError: 'Quantity limit reached for this item.'
                });
            }
        } catch (error) {
            console.warn('AFIFI: failed to merge guest cart item.', guestItem, error);
            failedItems.push({
                ...guestItem,
                mergeError: getAuthErrorMessage(error)
            });
        }
    }

    try {
        await refreshApiCartFromServer();
    } catch (error) {
        console.warn('AFIFI: failed to refresh cart after guest merge.', error);
    }

    if (failedItems.length === 0) {
        clearGuestCartStorage();
    } else {
        cartItems = failedItems.map(item => {
            const normalized = normalizeCartItem(item);
            return normalized;
        });
        saveCart();
        const failedQty = failedItems.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0);
        showCartMergeWarning(
            `${failedQty} item(s) could not be added to your account cart and remain saved on this device.`
        );
    }

    renderCart();
    return { mergedCount, failedItems };
}

async function addApiCartItem(details) {
    if (!details.variantId) {
        return { success: false, message: 'Please select a product option first.' };
    }

    const lookupMap = await getProductLookupMap();
    const variantDetails = getLookupVariantDetails(lookupMap, details.variantId);
    const stock = variantDetails && variantDetails.stock != null
        ? Number(variantDetails.stock)
        : normalizeStockValue(details.stock);
    const maxQty = getCartItemMaxQuantity({ stock });
    if (maxQty <= 0) {
        return { success: false, message: 'This option is sold out.' };
    }

    const existing = apiCartItems.find(item => String(item.variantId) === String(details.variantId));
    const requestedQty = (existing ? existing.quantity : 0) + (Number(details.quantity) || 1);
    if (requestedQty > maxQty) {
        return { success: false, message: `Only ${maxQty} available in stock.` };
    }

    try {
        await postApiCartItem(details.variantId, details.quantity);
        await refreshApiCartFromServer();
        renderCart();
        return { success: true };
    } catch (error) {
        console.warn('AFIFI: failed to add item to cart via API.', error);
        return { success: false, message: getAuthErrorMessage(error) };
    }
}

async function updateApiCartItemQuantity(cartItemId, quantity, options = {}) {
    const reload = options.reload !== false;
    try {
        await putApiCartItemQuantity(cartItemId, quantity);
        if (reload) {
            await loadApiCart();
        } else {
            const item = apiCartItems.find(cartItem => String(cartItem.apiCartItemId) === String(cartItemId));
            if (item) item.quantity = Number(quantity) || 1;
            renderCart();
        }
        return { success: true };
    } catch (error) {
        console.warn('AFIFI: failed to update cart item quantity via API.', error);
        return { success: false, message: getAuthErrorMessage(error) };
    }
}

async function removeApiCartItem(cartItemId, options = {}) {
    const reload = options.reload !== false;
    try {
        await window.afifiApi.apiRequest(`/cart/items/${cartItemId}`, { method: 'DELETE' });
        if (reload) {
            await loadApiCart();
        } else {
            apiCartItems = apiCartItems.filter(item => String(item.apiCartItemId) !== String(cartItemId));
            renderCart();
        }
    } catch (error) {
        console.warn('AFIFI: failed to remove cart item via API.', error);
    }
}

// Ready for a future "Clear Cart" control; not wired to a button yet to avoid
// changing the existing cart drawer UI.
async function clearApiCart() {
    try {
        await window.afifiApi.apiRequest('/cart', { method: 'DELETE' });
        await loadApiCart();
    } catch (error) {
        console.warn('AFIFI: failed to clear cart via API.', error);
    }
}

function saveCart() {
    localStorage.setItem('afifiCart', JSON.stringify(cartItems));
}

async function changeCartItemQuantity(item, index, delta) {
    const newQuantity = item.quantity + delta;

    if (newQuantity < 1) {
        if (isLoggedIn() && item.apiCartItemId) {
            await removeApiCartItem(item.apiCartItemId, { reload: false });
        } else {
            cartItems.splice(index, 1);
            saveCart();
            renderCart();
        }
        return;
    }

    const maxQuantity = getCartItemMaxQuantity(item);
    if (maxQuantity <= 0 || newQuantity > maxQuantity) return;

    if (isLoggedIn() && item.apiCartItemId) {
        const result = await updateApiCartItemQuantity(item.apiCartItemId, newQuantity, { reload: false });
        if (result && result.success === false) return;
        return;
    }

    if (cartItems[index]) {
        cartItems[index].quantity = newQuantity;
        saveCart();
        renderCart();
    }
}

async function addCartItem(details) {
    const item = normalizeCartItem(details);
    if (!item.variantId) {
        return { success: false, message: 'Please select a product option first.' };
    }

    const maxQty = getCartItemMaxQuantity(item);
    if (maxQty <= 0) {
        return { success: false, message: 'This option is sold out.' };
    }

    if (isLoggedIn()) {
        return addApiCartItem(details);
    }

    const existing = cartItems.find(cartItem => cartItem.id === item.id);
    const requestedQty = (existing ? existing.quantity : 0) + item.quantity;
    if (requestedQty > maxQty) {
        return { success: false, message: `Only ${maxQty} available in stock.` };
    }

    if (existing) {
        existing.quantity = requestedQty;
        existing.stock = item.stock;
    } else {
        cartItems.push(item);
    }
    saveCart();
    renderCart();
    return { success: true };
}

function getCartItemDisplayState(item) {
    const maxQuantity = getCartItemMaxQuantity(item);
    if (maxQuantity <= 0) {
        return {
            maxQuantity: 0,
            unavailable: true,
            warning: 'This item is sold out. Remove it to continue checkout.'
        };
    }
    if (item.quantity > maxQuantity) {
        return {
            maxQuantity,
            unavailable: true,
            warning: `Only ${maxQuantity} left in stock. Reduce quantity to continue checkout.`
        };
    }
    return { maxQuantity, unavailable: false, warning: '' };
}

async function prepareCartDrawer() {
    try {
        invalidateCatalogStockCache();
        if (isLoggedIn()) {
            await refreshApiCartFromServer();
        } else {
            const lookupMap = await getProductLookupMap();
            cartItems.forEach(item => applyStockToCartItem(item, lookupMap));
            saveCart();
        }
    } catch (error) {
        console.warn('AFIFI: could not refresh cart stock.', error);
    }
    renderCart();
}

function buildWhatsAppMessage() {
    const activeItems = getActiveCartItems();
    if (activeItems.length === 0) {
        return 'Hello AFIFI, I want to ask about your products.';
    }

    const lines = activeItems.map(item => {
        const variant = [item.size, item.color].filter(Boolean).join(' / ');
        return `- ${item.name}${variant ? ` (${variant})` : ''} x${item.quantity} = ${item.price * item.quantity} EGP`;
    });
    const total = activeItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
    return `Hello AFIFI, I want to place this order:\n${lines.join('\n')}\nTotal: ${total} EGP`;
}

function renderCart() {
    const itemsWrap = document.querySelector('.cart-items');
    const totalWrap = document.querySelector('.cart-total strong:last-child');
    const checkoutLink = document.querySelector('.cart-checkout');
    if (!itemsWrap || !totalWrap || !checkoutLink) return;

    const activeItems = getActiveCartItems();

    if (activeItems.length === 0) {
        itemsWrap.innerHTML = '<p class="cart-empty">Your cart is empty.</p>';
    } else {
        itemsWrap.innerHTML = activeItems.map((item, index) => {
            const safeName = escapeHtml(item.name);
            const variant = escapeHtml([item.size, item.color].filter(Boolean).join(' / '));
            const lineTotal = item.price * item.quantity;
            const displayState = getCartItemDisplayState(item);
            const maxQuantity = displayState.maxQuantity;
            const minusLabel = item.quantity <= 1
                ? `Remove ${item.name} from cart`
                : `Decrease quantity of ${item.name}`;
            const plusDisabled = displayState.unavailable || item.quantity >= maxQuantity;
            const itemClass = displayState.unavailable ? ' cart-item--unavailable' : '';
            return `
            <div class="cart-item${itemClass}">
                <div class="cart-item-thumb">
                    <img src="${item.image || CART_PLACEHOLDER_IMAGE}" alt="${safeName}" onerror="this.src='${CART_PLACEHOLDER_IMAGE}'">
                </div>
                <div class="cart-item-info">
                    <strong>${safeName}</strong>
                    ${variant ? `<span class="cart-item-variant">${variant}</span>` : ''}
                    ${displayState.warning ? `<span class="cart-item-stock-warning">${escapeHtml(displayState.warning)}</span>` : ''}
                    <div class="cart-item-qty-row">
                        <span class="cart-item-unit-price">${formatPrice(item.price)} each</span>
                        <div class="cart-qty-controls" role="group" aria-label="Quantity for ${safeName}">
                            <button type="button" class="cart-qty-btn cart-qty-minus" data-index="${index}" data-cart-item-id="${item.apiCartItemId || ''}" aria-label="${escapeHtml(minusLabel)}">&minus;</button>
                            <span class="cart-qty-value" aria-live="polite">${item.quantity}</span>
                            <button type="button" class="cart-qty-btn cart-qty-plus" data-index="${index}" data-cart-item-id="${item.apiCartItemId || ''}" aria-label="Increase quantity of ${safeName}"${plusDisabled ? ' disabled' : ''}>+</button>
                        </div>
                    </div>
                    <span class="cart-item-total">Total: ${formatPrice(lineTotal)}</span>
                </div>
                <button type="button" class="cart-remove" data-index="${index}" data-cart-item-id="${item.apiCartItemId || ''}" aria-label="Remove ${safeName}">&times;</button>
            </div>
        `;
        }).join('');
    }

    const total = activeItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
    totalWrap.textContent = `${total} EGP`;

    const hasUnavailableItems = activeItems.some(item => getCartItemDisplayState(item).unavailable);
    const isEmpty = activeItems.length === 0;
    if (isEmpty || hasUnavailableItems) {
        checkoutLink.textContent = hasUnavailableItems ? 'Resolve stock issues to checkout' : 'Cart is empty';
        checkoutLink.href = '#';
        checkoutLink.setAttribute('aria-disabled', 'true');
        checkoutLink.classList.add('is-disabled');
        checkoutLink.removeAttribute('target');
        checkoutLink.removeAttribute('rel');
    } else {
        checkoutLink.textContent = 'SEND ORDER ON WHATSAPP';
        checkoutLink.href = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(buildWhatsAppMessage())}`;
        checkoutLink.setAttribute('aria-disabled', 'false');
        checkoutLink.classList.remove('is-disabled');
        checkoutLink.setAttribute('target', '_blank');
        checkoutLink.setAttribute('rel', 'noopener');
    }

    updateCartBadge();
}

function updateCartBadge() {
    const badge = document.getElementById('cartBadge');
    if (!badge) return;
    const count = getActiveCartItems().reduce((sum, item) => sum + item.quantity, 0);
    badge.textContent = count;
    badge.classList.toggle('show', count > 0);
}

function createCartPanel() {
    const panel = document.createElement('aside');
    panel.className = 'cart-panel';
    panel.setAttribute('aria-hidden', 'true');
    panel.innerHTML = `
        <div class="cart-header">
            <h3>YOUR CART</h3>
            <button class="cart-close" aria-label="Close cart">&times;</button>
        </div>
        <div class="cart-items"></div>
        <div class="cart-footer">
            <div class="cart-total"><strong>Total</strong><strong>0 EGP</strong></div>
            <a class="cart-checkout" href="#" target="_blank">SEND ORDER ON WHATSAPP</a>
        </div>
    `;
    document.body.appendChild(panel);

    panel.querySelector('.cart-close').addEventListener('click', () => closeDrawerPanel(panel));

    const checkoutLink = panel.querySelector('.cart-checkout');
    checkoutLink.addEventListener('click', (event) => {
        const activeItems = getActiveCartItems();
        if (activeItems.length === 0 || activeItems.some(item => getCartItemDisplayState(item).unavailable)) {
            event.preventDefault();
        }
    });

    panel.addEventListener('click', async (event) => {
        const removeBtn = event.target.closest('.cart-remove');
        if (removeBtn) {
            if (isLoggedIn()) {
                if (removeBtn.dataset.cartItemId) {
                    await removeApiCartItem(removeBtn.dataset.cartItemId);
                }
            } else {
                cartItems.splice(Number(removeBtn.dataset.index), 1);
                saveCart();
                renderCart();
            }
            return;
        }

        const minusBtn = event.target.closest('.cart-qty-minus');
        const plusBtn = event.target.closest('.cart-qty-plus');
        if (!minusBtn && !plusBtn) return;

        const controlBtn = minusBtn || plusBtn;
        const index = Number(controlBtn.dataset.index);
        const activeItems = getActiveCartItems();
        const item = activeItems[index];
        if (!item) return;

        await changeCartItemQuantity(item, index, minusBtn ? -1 : 1);
    });

    document.querySelectorAll('img[alt="Cart"]').forEach(icon => {
        const link = icon.closest('a');
        if (!link) return;
        link.addEventListener('click', (event) => {
            event.preventDefault();
            openDrawerPanel(panel);
            void prepareCartDrawer();
        });
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && panel.classList.contains('open')) {
            closeDrawerPanel(panel);
        }
    });

    renderCart();
}

createCartPanel();

if (isLoggedIn()) {
    void mergeGuestCartIntoApiCart();
}

const whatsappFloat = document.createElement('a');
whatsappFloat.className = 'whatsapp-float';
whatsappFloat.href = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent('Hello AFIFI, I want to ask about your products.')}`;
whatsappFloat.target = '_blank';
whatsappFloat.rel = 'noopener';
whatsappFloat.setAttribute('aria-label', 'Chat on WhatsApp');
whatsappFloat.innerHTML = '<svg viewBox="0 0 24 24" fill="#06150B"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.77.46 3.45 1.32 4.94L2 22l5.29-1.39a9.9 9.9 0 0 0 4.75 1.21h.01c5.46 0 9.9-4.45 9.9-9.91C21.96 6.45 17.5 2 12.04 2zm5.8 14.03c-.24.68-1.4 1.32-1.93 1.4-.49.08-1.11.11-1.79-.11-.41-.13-.94-.31-1.62-.6-2.86-1.24-4.72-4.12-4.86-4.31-.14-.19-1.16-1.54-1.16-2.94 0-1.4.73-2.09 1-2.38.27-.29.58-.36.78-.36.19 0 .39 0 .56.01.18.01.42-.07.65.5.24.58.82 2 .89 2.14.07.15.12.32.02.51-.09.19-.14.31-.28.48-.14.17-.29.37-.42.5-.14.14-.28.29-.12.57.16.28.71 1.17 1.53 1.89 1.05.94 1.94 1.23 2.22 1.37.28.14.44.12.6-.07.16-.19.68-.79.87-1.06.19-.27.37-.22.62-.13.25.09 1.6.75 1.87.89.27.14.45.21.52.32.07.12.07.68-.17 1.36z"/></svg>';
document.body.appendChild(whatsappFloat);

// ========== WISHLIST ==========
const WISHLIST_PLACEHOLDER_IMAGE = CART_PLACEHOLDER_IMAGE;
let wishlistItems = JSON.parse(localStorage.getItem('afifiWishlist') || '[]');
let apiWishlistItems = [];

function saveWishlist() {
    localStorage.setItem('afifiWishlist', JSON.stringify(wishlistItems));
}

function getWishlistKey(btn) {
    const card = btn.closest('.product-card');
    const stableId = (card && card.dataset.id) || btn.dataset.id || (!card && productPageIdentifier);
    if (stableId) return stableId;
    const label = btn.getAttribute('aria-label');
    if (label) return label.replace(/^Add /, '').replace(/ to wishlist$/i, '').trim();
    const heading = card ? card.querySelector('h4') : document.querySelector('.product-details-info h1');
    if (heading) return heading.textContent.trim();
    const img = card ? card.querySelector('img') : null;
    return img ? img.alt : 'item';
}

function isWishlistKeyActive(key) {
    if (isLoggedIn()) {
        return apiWishlistItems.some(item => {
            const product = item.product || {};
            return product.slug === key || String(product.id) === String(key);
        });
    }
    return wishlistItems.includes(key);
}

function normalizeApiWishlistItem(item) {
    const product = item.product || {};
    return {
        key: product.slug || String(product.id),
        apiWishlistItemId: item.id,
        productId: product.id,
        name: product.name || 'AFIFI PRODUCT',
        price: Number(product.base_price) || 0,
        image: '',
        href: getProductPageHref(product)
    };
}

async function enrichWishlistDisplayItems(items) {
    if (!Array.isArray(items) || items.length === 0) return [];
    try {
        const products = await fetchCatalogProducts();
        return items.map(item => {
            const product = findProductBySlugOrId(products, item.key)
                || products.find(p => p.id === item.productId);
            if (!product) return item;
            return {
                ...item,
                name: product.name || item.name,
                price: Number(product.base_price) || item.price,
                image: getProductImage(product),
                href: getProductPageHref(product) || item.href
            };
        });
    } catch (error) {
        console.warn('AFIFI: could not enrich wishlist items from catalog.', error);
        return items;
    }
}

async function getWishlistDisplayItems() {
    if (isLoggedIn()) {
        return enrichWishlistDisplayItems(apiWishlistItems.map(normalizeApiWishlistItem));
    }

    try {
        const products = await fetchCatalogProducts();
        const items = wishlistItems.map(key => {
            const product = findProductBySlugOrId(products, key);
            if (product) {
                return {
                    key,
                    apiWishlistItemId: '',
                    productId: product.id,
                    name: product.name || key,
                    price: Number(product.base_price) || 0,
                    image: getProductImage(product),
                    href: getProductPageHref(product)
                };
            }
            return {
                key,
                apiWishlistItemId: '',
                productId: '',
                name: key,
                price: 0,
                image: WISHLIST_PLACEHOLDER_IMAGE,
                href: '#'
            };
        });
        return items;
    } catch (error) {
        console.warn('AFIFI: could not resolve wishlist items from catalog.', error);
        return wishlistItems.map(key => ({
            key,
            apiWishlistItemId: '',
            productId: '',
            name: key,
            price: 0,
            image: WISHLIST_PLACEHOLDER_IMAGE,
            href: '#'
        }));
    }
}

async function refreshApiWishlistFromServer() {
    const response = await window.afifiApi.apiRequest('/wishlist');
    const wishlist = response && response.data;
    const items = (wishlist && wishlist.items) || [];
    apiWishlistItems = Array.isArray(items) ? items : [];
}

async function loadApiWishlist() {
    if (!isLoggedIn()) return;
    try {
        await refreshApiWishlistFromServer();
    } catch (error) {
        console.warn('AFIFI: failed to load wishlist from server.', error);
        apiWishlistItems = [];
    }
    updateWishlistBadge();
    document.querySelectorAll('.wishlist, .add-wishlist').forEach(btn => refreshWishlistActiveState(btn));
    renderWishlist();
}

async function postApiWishlistItem(productId, productVariantId) {
    const body = { product_id: Number(productId) };
    if (productVariantId) body.product_variant_id = Number(productVariantId);
    await window.afifiApi.apiRequest('/wishlist/items', { method: 'POST', body });
}

function readGuestWishlistFromStorage() {
    try {
        const raw = localStorage.getItem('afifiWishlist');
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .map(key => String(key == null ? '' : key).trim())
            .filter(Boolean);
    } catch (error) {
        console.warn('AFIFI: could not parse guest wishlist from localStorage.', error);
        return [];
    }
}

function clearGuestWishlistStorage() {
    wishlistItems = [];
    try {
        localStorage.removeItem('afifiWishlist');
    } catch (error) {
        console.warn('AFIFI: could not clear guest wishlist from localStorage.', error);
    }
}

function isGuestWishlistKeyInApi(key, product) {
    return apiWishlistItems.some(item => {
        const apiProduct = item.product || {};
        if (product) {
            return apiProduct.id === product.id
                || (apiProduct.slug && apiProduct.slug === product.slug);
        }
        return apiProduct.slug === key || String(apiProduct.id) === String(key);
    });
}

function showWishlistMergeWarning(message) {
    if (!message) return;
    const panel = document.querySelector('.wishlist-panel');
    if (!panel) {
        console.warn('AFIFI wishlist merge:', message);
        return;
    }
    let banner = panel.querySelector('.wishlist-merge-warning');
    if (!banner) {
        banner = document.createElement('p');
        banner.className = 'wishlist-merge-warning';
        banner.setAttribute('role', 'status');
        const itemsWrap = panel.querySelector('.wishlist-items');
        if (itemsWrap) panel.insertBefore(banner, itemsWrap);
        else panel.appendChild(banner);
    }
    banner.textContent = message;
    banner.hidden = false;
}

async function mergeGuestWishlistIntoApiWishlist() {
    if (!isLoggedIn()) return { mergedCount: 0, failedKeys: [] };

    const guestKeys = [...new Set(readGuestWishlistFromStorage())];
    if (guestKeys.length === 0) {
        await loadApiWishlist();
        return { mergedCount: 0, failedKeys: [] };
    }

    try {
        await refreshApiWishlistFromServer();
    } catch (error) {
        console.warn('AFIFI: could not load account wishlist for guest merge.', error);
        showWishlistMergeWarning('Could not load your account wishlist. Guest wishlist items were kept on this device.');
        updateWishlistBadge();
        document.querySelectorAll('.wishlist, .add-wishlist').forEach(btn => refreshWishlistActiveState(btn));
        renderWishlist();
        return { mergedCount: 0, failedKeys: guestKeys };
    }

    let products = [];
    try {
        products = await fetchCatalogProducts();
    } catch (error) {
        console.warn('AFIFI: could not resolve guest wishlist products.', error);
        showWishlistMergeWarning('Could not resolve guest wishlist products. Items remain saved on this device.');
        updateWishlistBadge();
        document.querySelectorAll('.wishlist, .add-wishlist').forEach(btn => refreshWishlistActiveState(btn));
        renderWishlist();
        return { mergedCount: 0, failedKeys: guestKeys };
    }

    const failedKeys = [];
    let mergedCount = 0;

    for (const key of guestKeys) {
        const product = findProductBySlugOrId(products, key);
        if (!product) {
            failedKeys.push(key);
            continue;
        }

        if (isGuestWishlistKeyInApi(key, product)) {
            mergedCount += 1;
            continue;
        }

        try {
            await postApiWishlistItem(product.id);
            await refreshApiWishlistFromServer();
            mergedCount += 1;
        } catch (error) {
            console.warn('AFIFI: failed to merge guest wishlist item.', key, error);
            failedKeys.push(key);
        }
    }

    if (failedKeys.length === 0) {
        clearGuestWishlistStorage();
    } else {
        wishlistItems = failedKeys;
        saveWishlist();
        showWishlistMergeWarning(
            `${failedKeys.length} wishlist item(s) could not be added to your account and remain saved on this device.`
        );
    }

    updateWishlistBadge();
    document.querySelectorAll('.wishlist, .add-wishlist').forEach(btn => refreshWishlistActiveState(btn));
    renderWishlist();
    return { mergedCount, failedKeys };
}

async function addApiWishlistItem(productId, productVariantId) {
    try {
        await postApiWishlistItem(productId, productVariantId);
        await loadApiWishlist();
        return { success: true };
    } catch (error) {
        console.warn('AFIFI: failed to add item to wishlist via API.', error);
        return { success: false, message: getAuthErrorMessage(error) };
    }
}

async function removeApiWishlistItem(wishlistItemId) {
    try {
        await window.afifiApi.apiRequest(`/wishlist/items/${wishlistItemId}`, { method: 'DELETE' });
        await loadApiWishlist();
    } catch (error) {
        console.warn('AFIFI: failed to remove wishlist item via API.', error);
    }
}

async function removeWishlistByKey(key, apiWishlistItemId) {
    if (isLoggedIn() && apiWishlistItemId) {
        await removeApiWishlistItem(apiWishlistItemId);
        return;
    }

    const idx = wishlistItems.indexOf(key);
    if (idx > -1) {
        wishlistItems.splice(idx, 1);
        saveWishlist();
        updateWishlistBadge();
        document.querySelectorAll('.wishlist, .add-wishlist').forEach(btn => refreshWishlistActiveState(btn));
        renderWishlist();
    }
}

async function toggleWishlistItem(btn) {
    const key = getWishlistKey(btn);

    if (isLoggedIn()) {
        const products = await fetchCatalogProducts();
        const product = findProductBySlugOrId(products, key);
        if (!product) return;

        const existing = apiWishlistItems.find(item => {
            const p = item.product || {};
            return p.id === product.id || p.slug === product.slug;
        });

        if (existing) {
            await removeApiWishlistItem(existing.id);
            btn.classList.remove('active');
        } else {
            const selectedVariant = typeof getSelectedVariant === 'function' ? getSelectedVariant() : null;
            const result = await addApiWishlistItem(product.id, selectedVariant && selectedVariant.id);
            if (result.success !== false) btn.classList.add('active');
        }
        return;
    }

    const idx = wishlistItems.indexOf(key);
    if (idx > -1) {
        wishlistItems.splice(idx, 1);
        btn.classList.remove('active');
    } else {
        wishlistItems.push(key);
        btn.classList.add('active');
    }
    saveWishlist();
    updateWishlistBadge();
    renderWishlist();
}

function updateWishlistBadge() {
    const badge = document.getElementById('wishlistBadge');
    if (!badge) return;
    const count = isLoggedIn() ? apiWishlistItems.length : wishlistItems.length;
    badge.textContent = count;
    badge.classList.toggle('show', count > 0);
    const wishlistLink = badge.closest('.wishlist-icon-link');
    if (wishlistLink) wishlistLink.classList.toggle('has-items', count > 0);
}

function refreshWishlistActiveState(btn) {
    const key = getWishlistKey(btn);
    btn.classList.toggle('active', isWishlistKeyActive(key));
}

function wireWishlistButton(btn) {
    refreshWishlistActiveState(btn);

    btn.addEventListener('click', async (e) => {
        e.preventDefault();
        await toggleWishlistItem(btn);
    });
}

async function renderWishlist() {
    const itemsWrap = document.querySelector('.wishlist-items');
    if (!itemsWrap) return;

    const items = await getWishlistDisplayItems();

    if (items.length === 0) {
        itemsWrap.innerHTML = '<p class="wishlist-empty">Your wishlist is empty.</p>';
        return;
    }

    itemsWrap.innerHTML = items.map(item => {
        const safeName = escapeHtml(item.name);
        const safeKey = escapeHtml(item.key);
        const href = item.href && item.href !== '#' ? item.href : '#';
        return `
            <div class="wishlist-item">
                <div class="wishlist-item-thumb">
                    <img src="${item.image || WISHLIST_PLACEHOLDER_IMAGE}" alt="${safeName}" onerror="this.src='${WISHLIST_PLACEHOLDER_IMAGE}'">
                </div>
                <div class="wishlist-item-info">
                    <strong>${safeName}</strong>
                    <span class="wishlist-item-price">${formatPrice(item.price)}</span>
                    <div class="wishlist-item-actions">
                        ${href !== '#' ? `<a href="${href}" class="wishlist-view-link">View product</a>` : ''}
                        <button type="button" class="wishlist-remove" data-key="${safeKey}" data-wishlist-item-id="${item.apiWishlistItemId || ''}" aria-label="Remove ${safeName} from wishlist">Remove</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function createWishlistPanel() {
    const panel = document.createElement('aside');
    panel.className = 'wishlist-panel';
    panel.setAttribute('aria-hidden', 'true');
    panel.innerHTML = `
        <div class="wishlist-header">
            <h3>YOUR WISHLIST</h3>
            <button type="button" class="wishlist-close" aria-label="Close wishlist">&times;</button>
        </div>
        <div class="wishlist-items"></div>
    `;
    document.body.appendChild(panel);

    function closeWishlistPanel() {
        closeDrawerPanel(panel);
    }

    function openWishlistPanel() {
        openDrawerPanel(panel);
        if (isLoggedIn()) {
            loadApiWishlist();
        } else {
            renderWishlist();
        }
    }

    panel.querySelector('.wishlist-close').addEventListener('click', closeWishlistPanel);

    panel.addEventListener('click', async (event) => {
        const removeBtn = event.target.closest('.wishlist-remove');
        if (!removeBtn) return;
        await removeWishlistByKey(removeBtn.dataset.key, removeBtn.dataset.wishlistItemId);
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && panel.classList.contains('open')) {
            closeWishlistPanel();
        }
    });

    document.querySelectorAll('.wishlist-icon-link').forEach(link => {
        if (link.dataset.panelReady) return;
        link.dataset.panelReady = 'true';
        link.addEventListener('click', (event) => {
            event.preventDefault();
            const navMenuEl = document.getElementById('navMenu');
            const hamburgerEl = document.getElementById('hamburger');
            if (navMenuEl) navMenuEl.classList.remove('open');
            if (hamburgerEl) {
                hamburgerEl.classList.remove('active');
                hamburgerEl.setAttribute('aria-expanded', 'false');
            }
            openWishlistPanel();
        });
    });

    renderWishlist();
}

document.querySelectorAll('.wishlist, .add-wishlist').forEach(wireWishlistButton);

updateWishlistBadge();
createWishlistPanel();

if (isLoggedIn()) {
    void mergeGuestWishlistIntoApiWishlist();
}

// ========== NEWSLETTER FEEDBACK ==========
document.querySelectorAll('.newsletter-form').forEach(form => {
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const btn = form.querySelector('button');
        const input = form.querySelector('input');
        btn.textContent = 'JOINED';
        input.value = '';
        setTimeout(() => {
            btn.textContent = 'JOIN';
        }, 2200);
    });
});
