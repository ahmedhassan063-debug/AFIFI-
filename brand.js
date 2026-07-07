// ========== API CLIENT (Laravel backend integration layer) ==========
// Step 1 of backend integration: reusable fetch wrapper only.
// Nothing on the page calls this automatically yet.
const API_BASE_URL = 'http://127.0.0.1:8000/api';
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
        throw new ApiError(message, response.status, errors);
    }

    return data;
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

        if (settings['seo.default_title']) {
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

function renderProductCard(product) {
    const identifier = product.slug || product.id;
    const name = product.name || 'AFIFI PRODUCT';
    const safeName = escapeHtml(name);
    const image = getProductImage(product);
    const price = formatPrice(product.base_price);
    const badge = product.badge ? escapeHtml(product.badge) : '';
    const href = `product.html?id=${encodeURIComponent(identifier)}`;

    const card = document.createElement('div');
    card.className = 'product-card';
    if (identifier) card.dataset.id = identifier;

    card.innerHTML = `
        <div class="product-img">
            ${badge ? `<span class="product-badge">${badge}</span>` : ''}
            <a href="${href}"><img src="${image}" alt="${safeName}" loading="lazy"></a>
            <button class="wishlist" aria-label="Add ${safeName} to wishlist"></button>
        </div>
        <div class="product-info"><h4><a href="${href}">${safeName}</a></h4><p>${price}</p></div>
    `;

    return card;
}

async function loadHomepageProducts() {
    const newArrivalsGrid = document.querySelector('.new-arrivals .products-grid');
    const bestSellersTrack = document.querySelector('.best-sellers .carousel-track');

    if (!newArrivalsGrid && !bestSellersTrack) return;

    try {
        const response = await window.afifiApi.apiRequest('/catalog/products');
        const products = Array.isArray(response && response.data) ? response.data : [];

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

// ========== HERO SLIDESHOW ==========
const slides = document.querySelectorAll('.slide');
let current = 0;

if (slides.length > 0) {
    setInterval(() => {
        slides[current].classList.remove('active');
        current = (current + 1) % slides.length;
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

document.documentElement.style.scrollBehavior = 'smooth';

// ========== PRODUCT PAGE: STABLE PRODUCT ID (from ?id=) ==========
const productPageId = new URLSearchParams(window.location.search).get('id');
let productPageData = { variants: [] };

// ========== PRODUCT PAGE: THUMBNAIL SWITCHING ==========
function changeImage(thumb) {
    const mainImg = document.getElementById('mainProductImg');
    if (mainImg) {
        mainImg.src = thumb.src;
        document.querySelectorAll('.thumb').forEach(t => t.classList.remove('active-thumb'));
        thumb.classList.add('active-thumb');
    }
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
        const val = parseInt(qtyValue.textContent, 10);
        if (val < 10) qtyValue.textContent = val + 1;
    });
}

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
const shopClearFilters = document.getElementById('shopClearFilters');
const filterBtns = document.querySelectorAll('.filter-btn');
let activeFilter = 'all';

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

    const sortedCards = [...shopCards].sort((a, b) => {
        const sortValue = sortSelect ? sortSelect.value : 'newest';
        if (sortValue === 'low-high') return Number(a.dataset.price) - Number(b.dataset.price);
        if (sortValue === 'high-low') return Number(b.dataset.price) - Number(a.dataset.price);
        return Number(a.dataset.order) - Number(b.dataset.order);
    });

    let visibleCount = 0;
    sortedCards.forEach(card => {
        const isVisible = activeFilter === 'all' || card.dataset.category === activeFilter;
        card.style.display = isVisible ? '' : 'none';
        if (isVisible) visibleCount += 1;
        shopGrid.appendChild(card);
    });

    if (shopCount) {
        shopCount.textContent = `${visibleCount} product${visibleCount === 1 ? '' : 's'}`;
    }

    if (shopEmpty) {
        shopEmpty.hidden = visibleCount !== 0;
    }
}

filterBtns.forEach(btn => {
    btn.addEventListener('click', () => setActiveFilter(btn.dataset.filter || 'all'));
});

if (sortSelect) {
    sortSelect.addEventListener('change', updateShopGrid);
}

if (shopClearFilters) {
    shopClearFilters.addEventListener('click', () => setActiveFilter('all'));
}

updateShopGrid();

function getProductCategorySlug(product) {
    const category = product.category || {};
    const raw = category.slug || category.name || product.gender || product.badge || product.name || '';
    return String(raw).toLowerCase().trim().replace(/[\s_]+/g, '-');
}

async function loadShopProducts() {
    if (!shopGrid) return;

    try {
        const response = await window.afifiApi.apiRequest('/catalog/products');
        const products = Array.isArray(response && response.data) ? response.data : [];

        if (products.length === 0) {
            console.warn('AFIFI: no products returned from API, keeping static shop content.');
            return;
        }

        shopGrid.innerHTML = '';

        products.forEach((product, index) => {
            const card = renderProductCard(product);
            card.dataset.category = getProductCategorySlug(product);
            card.dataset.price = String(Number(product.base_price) || 0);
            card.dataset.order = String(index + 1);
            card.dataset.name = product.name || '';
            shopGrid.appendChild(card);
        });

        if (shopEmpty) {
            shopGrid.appendChild(shopEmpty);
        }

        shopCards = Array.from(shopGrid.querySelectorAll('.product-card'));
        shopGrid.querySelectorAll('.wishlist').forEach(wireWishlistButton);
        updateWishlistBadge();

        setActiveFilter('all');
    } catch (error) {
        console.warn('AFIFI: could not load shop products from API, keeping static content.', error);
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
        const activeSize = document.querySelector('.size-btn.active');
        const activeColor = document.querySelector('.color-swatch.active');
        const mainImg = document.getElementById('mainProductImg');
        const qtySelector = document.getElementById('qtyValue');
        const cartLiveRegion = document.getElementById('cartLiveRegion');
        const selectedVariant = getSelectedVariant();
        const name = productPageData.name || addToCartBtn.dataset.name || 'AFIFI PRODUCT';
        const price = (selectedVariant && selectedVariant.price_override) || productPageData.base_price || addToCartBtn.dataset.price || 0;

        const result = await addCartItem({
            productId: productPageData.id || productPageId || addToCartBtn.dataset.id || name,
            variantId: selectedVariant ? selectedVariant.id : '',
            name,
            price: Number(price) || 0,
            quantity: Number(qtySelector ? qtySelector.textContent : 1) || 1,
            size: activeSize ? activeSize.textContent.trim() : '',
            color: activeColor ? (activeColor.getAttribute('title') || '') : '',
            image: mainImg ? mainImg.src : ''
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

function getSelectedVariant() {
    if (!Array.isArray(productPageData.variants) || productPageData.variants.length === 0) return null;

    const activeSizeBtn = document.querySelector('.size-btn.active');
    const activeColorSwatch = document.querySelector('.color-swatch.active');
    const sizeId = activeSizeBtn ? activeSizeBtn.dataset.sizeId : '';
    const colorId = activeColorSwatch ? activeColorSwatch.dataset.colorId : '';

    return productPageData.variants.find(variant => {
        const sizeMatches = !sizeId || String(variant.size_id) === String(sizeId);
        const colorMatches = !colorId || String(variant.color_id) === String(colorId);
        return sizeMatches && colorMatches;
    }) || null;
}

function renderSizeButtons(sizes) {
    const container = document.querySelector('.size-btns');
    if (!container || !Array.isArray(sizes) || sizes.length === 0) return;

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
}

function renderColorSwatches(colors) {
    const container = document.querySelector('.color-swatches');
    if (!container || !Array.isArray(colors) || colors.length === 0) return;

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
}

function renderThumbnails(images) {
    const container = document.querySelector('.thumbnails');
    const mainImg = document.getElementById('mainProductImg');
    if (!container || !Array.isArray(images) || images.length === 0) return;

    container.innerHTML = '';
    images.forEach((src, index) => {
        const thumbBtn = document.createElement('button');
        thumbBtn.type = 'button';
        thumbBtn.className = 'thumb-btn';
        thumbBtn.setAttribute('aria-label', `View ${index + 1}`);
        thumbBtn.setAttribute('aria-pressed', index === 0 ? 'true' : 'false');

        const img = document.createElement('img');
        img.src = src;
        img.alt = `View ${index + 1}`;
        img.className = 'thumb' + (index === 0 ? ' active-thumb' : '');
        img.loading = 'lazy';

        thumbBtn.appendChild(img);
        container.appendChild(thumbBtn);
        wireThumbButton(thumbBtn);
    });

    if (mainImg && images[0]) {
        mainImg.src = images[0];
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

async function loadProductDetails() {
    if (!productPageId) return;

    try {
        const response = await window.afifiApi.apiRequest('/catalog/products');
        const products = Array.isArray(response && response.data) ? response.data : [];
        const matched = findProductBySlugOrId(products, productPageId);

        if (!matched) {
            console.warn(`AFIFI: no product found for id "${productPageId}", keeping static content.`);
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
        }

        if (whatsappOrderLink) {
            const message = `Hello AFIFI, I want to order ${matched.name} - ${formatPrice(matched.base_price)}`;
            whatsappOrderLink.href = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;
        }

        renderThumbnails(getProductImages(matched));

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
    } catch (error) {
        console.warn('AFIFI: could not load product details from API, keeping static content.', error);
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
        overlay.hidden = true;
        document.body.classList.remove('auth-modal-open');
        showMessage('');
        loginForm.reset();
        registerForm.reset();
    }

    function openModal(tabName) {
        overlay.hidden = false;
        document.body.classList.add('auth-modal-open');
        switchTab(tabName || 'login');
    }

    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !overlay.hidden) closeModal();
    });

    function setFormLoading(form, isLoading) {
        const btn = form.querySelector('.auth-submit');
        if (!btn) return;
        btn.disabled = isLoading;
        btn.dataset.originalText = btn.dataset.originalText || btn.textContent;
        btn.textContent = isLoading ? 'PLEASE WAIT...' : btn.dataset.originalText;
    }

    function handleAuthSuccess(data) {
        if (data && data.token) {
            window.afifiApi.setAuthToken(data.token);
        }
        if (data && data.user) {
            setStoredUser(data.user);
        }
        showMessage('Success! Welcome to AFIFI.', 'success');
        updateAuthUI();
        loadApiCart();
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
function normalizeCartItem(raw) {
    const size = raw.size || '';
    const color = raw.color || '';
    return {
        id: raw.id || raw.variantId || `${raw.productId || raw.name}-${size}-${color}`,
        productId: raw.productId || raw.name || '',
        variantId: raw.variantId || '',
        name: raw.name || 'AFIFI PRODUCT',
        price: Number(raw.price) || 0,
        quantity: Number(raw.quantity ?? raw.qty ?? 1) || 1,
        size,
        color,
        image: raw.image || ''
    };
}

let cartItems = (JSON.parse(localStorage.getItem('afifiCart') || '[]')).map(normalizeCartItem);

// ========== CART: Laravel backend integration (step 7, logged-in users only) ==========
// Logged-out users keep the existing localStorage cart (`cartItems`) untouched.
// Logged-in users are backed by `apiCartItems`, hydrated from GET /cart.
let apiCartItems = [];
let productLookupMapCache = null;

function getActiveCartItems() {
    return isLoggedIn() ? apiCartItems : cartItems;
}

async function getProductLookupMap() {
    if (productLookupMapCache) return productLookupMapCache;
    const map = new Map();
    try {
        const response = await window.afifiApi.apiRequest('/catalog/products');
        const products = Array.isArray(response && response.data) ? response.data : [];
        products.forEach(product => {
            const image = getProductImage(product);
            (product.variants || []).forEach(variant => {
                map.set(variant.id, {
                    name: product.name,
                    image,
                    size: variant.size ? variant.size.name : '',
                    color: variant.color ? variant.color.name : ''
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
    const details = lookupMap.get(variant.id);
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
        image: (details && details.image) || ''
    };
}

async function loadApiCart() {
    if (!isLoggedIn()) return;
    try {
        const response = await window.afifiApi.apiRequest('/cart');
        const cart = response && response.data;
        const items = (cart && cart.items) || [];
        const lookupMap = await getProductLookupMap();
        apiCartItems = items.map(item => normalizeApiCartItem(item, lookupMap));
    } catch (error) {
        console.warn('AFIFI: failed to load cart from server.', error);
        apiCartItems = [];
    }
    renderCart();
}

async function addApiCartItem(details) {
    if (!details.variantId) {
        return { success: false, message: 'Please select a product option first.' };
    }
    try {
        await window.afifiApi.apiRequest('/cart/items', {
            method: 'POST',
            body: {
                product_variant_id: Number(details.variantId),
                quantity: Number(details.quantity) || 1
            }
        });
        await loadApiCart();
        return { success: true };
    } catch (error) {
        console.warn('AFIFI: failed to add item to cart via API.', error);
        return { success: false, message: getAuthErrorMessage(error) };
    }
}

// Ready for future quantity-stepper UI; not wired to a control yet to avoid
// changing the existing cart drawer UI.
async function updateApiCartItemQuantity(cartItemId, quantity) {
    try {
        await window.afifiApi.apiRequest(`/cart/items/${cartItemId}`, {
            method: 'PUT',
            body: { quantity: Number(quantity) || 1 }
        });
        await loadApiCart();
        return { success: true };
    } catch (error) {
        console.warn('AFIFI: failed to update cart item quantity via API.', error);
        return { success: false, message: getAuthErrorMessage(error) };
    }
}

async function removeApiCartItem(cartItemId) {
    try {
        await window.afifiApi.apiRequest(`/cart/items/${cartItemId}`, { method: 'DELETE' });
        await loadApiCart();
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

async function addCartItem(details) {
    if (isLoggedIn()) {
        return addApiCartItem(details);
    }
    const item = normalizeCartItem(details);
    const existing = cartItems.find(cartItem => cartItem.id === item.id);
    if (existing) {
        existing.quantity += item.quantity;
    } else {
        cartItems.push(item);
    }
    saveCart();
    renderCart();
    return { success: true };
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
            const variant = [item.size, item.color].filter(Boolean).join(' / ');
            const lineTotal = item.price * item.quantity;
            return `
            <div class="cart-item">
                <div class="cart-item-thumb">
                    <img src="${item.image || CART_PLACEHOLDER_IMAGE}" alt="${item.name}" onerror="this.src='${CART_PLACEHOLDER_IMAGE}'">
                </div>
                <div class="cart-item-info">
                    <strong>${item.name}</strong>
                    ${variant ? `<span class="cart-item-variant">${variant}</span>` : ''}
                    <span>Qty: ${item.quantity} &times; ${item.price} EGP</span>
                    <span class="cart-item-total">Total: ${lineTotal} EGP</span>
                </div>
                <button class="cart-remove" data-index="${index}" data-cart-item-id="${item.apiCartItemId || ''}" aria-label="Remove ${item.name}">&times;</button>
            </div>
        `;
        }).join('');
    }

    const total = activeItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
    totalWrap.textContent = `${total} EGP`;
    checkoutLink.href = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(buildWhatsAppMessage())}`;

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

    panel.querySelector('.cart-close').addEventListener('click', () => panel.classList.remove('open'));
    panel.addEventListener('click', (event) => {
        const removeBtn = event.target.closest('.cart-remove');
        if (!removeBtn) return;
        if (isLoggedIn()) {
            if (removeBtn.dataset.cartItemId) {
                removeApiCartItem(removeBtn.dataset.cartItemId);
            }
        } else {
            cartItems.splice(Number(removeBtn.dataset.index), 1);
            saveCart();
            renderCart();
        }
    });

    document.querySelectorAll('img[alt="Cart"]').forEach(icon => {
        const link = icon.closest('a');
        if (!link) return;
        link.addEventListener('click', (event) => {
            event.preventDefault();
            panel.classList.add('open');
            if (isLoggedIn()) {
                loadApiCart();
            } else {
                renderCart();
            }
        });
    });

    renderCart();
}

createCartPanel();

if (isLoggedIn()) {
    loadApiCart();
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
let wishlistItems = JSON.parse(localStorage.getItem('afifiWishlist') || '[]');

function saveWishlist() {
    localStorage.setItem('afifiWishlist', JSON.stringify(wishlistItems));
}

function getWishlistKey(btn) {
    const card = btn.closest('.product-card');
    const stableId = (card && card.dataset.id) || btn.dataset.id || (!card && productPageId);
    if (stableId) return stableId;
    const label = btn.getAttribute('aria-label');
    if (label) return label.replace(/^Add /, '').replace(/ to wishlist$/i, '').trim();
    const heading = card ? card.querySelector('h4') : document.querySelector('.product-details-info h1');
    if (heading) return heading.textContent.trim();
    const img = card ? card.querySelector('img') : null;
    return img ? img.alt : 'item';
}

function updateWishlistBadge() {
    const badge = document.getElementById('wishlistBadge');
    if (!badge) return;
    badge.textContent = wishlistItems.length;
    badge.classList.toggle('show', wishlistItems.length > 0);
    const wishlistLink = badge.closest('.wishlist-icon-link');
    if (wishlistLink) wishlistLink.classList.toggle('has-items', wishlistItems.length > 0);
}

function wireWishlistButton(btn) {
    const key = getWishlistKey(btn);
    btn.classList.toggle('active', wishlistItems.includes(key));

    btn.addEventListener('click', (e) => {
        e.preventDefault();
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
    });
}

document.querySelectorAll('.wishlist, .add-wishlist').forEach(wireWishlistButton);

updateWishlistBadge();

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
