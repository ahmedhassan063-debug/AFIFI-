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

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!navMenu.contains(e.target) && !hamburger.contains(e.target)) {
            hamburger.classList.remove('active');
            navMenu.classList.remove('open');
        }
    });

    // Close menu when clicking a link
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

// ========== SMOOTH SCROLL ==========
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
        let val = parseInt(qtyValue.textContent);
        if (val > 1) qtyValue.textContent = val - 1;
    });
    qtyPlus.addEventListener('click', () => {
        let val = parseInt(qtyValue.textContent);
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

// ========== SHOP PAGE: FILTER BUTTONS ==========
document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    });
});

// ========== CONTACT FORM ==========
const contactForm = document.getElementById('contactForm');

if (contactForm) {
    contactForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const btn = contactForm.querySelector('.submit-btn');
        btn.textContent = 'MESSAGE SENT ✓';
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
        addToCartBtn.textContent = 'ADDED TO CART ✓';
        addToCartBtn.style.background = '#2ecc71';
        addToCartBtn.style.color = '#fff';
        setTimeout(() => {
            addToCartBtn.textContent = 'ADD TO CART';
            addToCartBtn.style.background = '';
            addToCartBtn.style.color = '';
        }, 2000);
    });
}