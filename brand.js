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
    hamburger.addEventListener('click', (e) => {
        e.stopPropagation();
        hamburger.classList.toggle('active');
        navMenu.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
        if (!navMenu.contains(e.target) && !hamburger.contains(e.target)) {
            hamburger.classList.remove('active');
            navMenu.classList.remove('open');
        }
    });

    navMenu.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
            hamburger.classList.remove('active');
            navMenu.classList.remove('open');
        });
    });
}

// ========== SCROLL TO TOP BUTTON ==========
const scrollTopBtn = document.getElementById('scrollTop');

if (scrollTopBtn) {
    window.addEventListener('scroll', () => {
        if (window.scrollY > 300) {
            scrollTopBtn.classList.add('visible');
        } else {
            scrollTopBtn.classList.remove('visible');
        }
    });

    scrollTopBtn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

document.documentElement.style.scrollBehavior = 'smooth';

// ========== PRODUCT PAGE: THUMBNAIL SWITCHING ==========
function changeImage(thumb) {
    const mainImg = document.getElementById('mainProductImg');
    if (mainImg) {
        mainImg.src = thumb.src;
        document.querySelectorAll('.thumb').forEach(t => t.classList.remove('active-thumb'));
        thumb.classList.add('active-thumb');
    }
}

// ========== PRODUCT PAGE: SIZE SELECTOR ==========
document.querySelectorAll('.size-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    });
});

// ========== PRODUCT PAGE: COLOR SELECTOR ==========
document.querySelectorAll('.color-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
        document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
    });
});

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
const shopCards = shopGrid ? Array.from(shopGrid.querySelectorAll('.product-card')) : [];
const sortSelect = document.querySelector('.sort-select');
const shopCount = document.getElementById('shopCount');
let activeFilter = 'all';

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
}

document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeFilter = btn.dataset.filter || 'all';
        updateShopGrid();
    });
});

if (sortSelect) {
    sortSelect.addEventListener('change', updateShopGrid);
}

updateShopGrid();

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
    addToCartBtn.addEventListener('click', () => {
        addCartItem(addToCartBtn.dataset.name || 'AFIFI PRODUCT', Number(addToCartBtn.dataset.price) || 0);
        addToCartBtn.textContent = 'ADDED TO CART';
        addToCartBtn.style.background = '#2ecc71';
        addToCartBtn.style.color = '#fff';
        setTimeout(() => {
            addToCartBtn.textContent = 'ADD TO CART';
            addToCartBtn.style.background = '';
            addToCartBtn.style.color = '';
        }, 2000);
    });
}

// ========== CART AND WHATSAPP ORDERING ==========
const whatsappNumber = '201109960670';
let cartItems = JSON.parse(localStorage.getItem('afifiCart') || '[]');

function saveCart() {
    localStorage.setItem('afifiCart', JSON.stringify(cartItems));
}

function addCartItem(name, price) {
    const existing = cartItems.find(item => item.name === name && item.price === price);
    if (existing) {
        existing.qty += 1;
    } else {
        cartItems.push({ name, price, qty: 1 });
    }
    saveCart();
    renderCart();
}

function buildWhatsAppMessage() {
    if (cartItems.length === 0) {
        return 'Hello AFIFI, I want to ask about your products.';
    }

    const lines = cartItems.map(item => `- ${item.name} x${item.qty} = ${item.price * item.qty} EGP`);
    const total = cartItems.reduce((sum, item) => sum + item.price * item.qty, 0);
    return `Hello AFIFI, I want to place this order:\n${lines.join('\n')}\nTotal: ${total} EGP`;
}

function renderCart() {
    const itemsWrap = document.querySelector('.cart-items');
    const totalWrap = document.querySelector('.cart-total strong:last-child');
    const checkoutLink = document.querySelector('.cart-checkout');
    if (!itemsWrap || !totalWrap || !checkoutLink) return;

    if (cartItems.length === 0) {
        itemsWrap.innerHTML = '<p class="cart-empty">Your cart is empty.</p>';
    } else {
        itemsWrap.innerHTML = cartItems.map((item, index) => `
            <div class="cart-item">
                <div>
                    <strong>${item.name}</strong>
                    <span>${item.qty} x ${item.price} EGP</span>
                </div>
                <button class="cart-remove" data-index="${index}" aria-label="Remove ${item.name}">&times;</button>
            </div>
        `).join('');
    }

    const total = cartItems.reduce((sum, item) => sum + item.price * item.qty, 0);
    totalWrap.textContent = `${total} EGP`;
    checkoutLink.href = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(buildWhatsAppMessage())}`;
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
        cartItems.splice(Number(removeBtn.dataset.index), 1);
        saveCart();
        renderCart();
    });

    document.querySelectorAll('img[alt="Cart"]').forEach(icon => {
        const link = icon.closest('a');
        if (!link) return;
        link.addEventListener('click', (event) => {
            event.preventDefault();
            panel.classList.add('open');
            renderCart();
        });
    });

    renderCart();
}

createCartPanel();

const whatsappFloat = document.createElement('a');
whatsappFloat.className = 'whatsapp-float';
whatsappFloat.href = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent('Hello AFIFI, I want to ask about your products.')}`;
whatsappFloat.target = '_blank';
whatsappFloat.textContent = 'WHATSAPP';
document.body.appendChild(whatsappFloat);

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
