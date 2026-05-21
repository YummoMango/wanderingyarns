/* WanderingYarns - app.js */

const PRODUCTS_URL = "data/products.json";
const CART_KEY = "wanderingyarns_cart";
const REVIEWS_KEY = "wanderingyarns_reviews";

/* ---------- Helpers ---------- */
function $(selector) { return document.querySelector(selector); }
function $all(selector) { return Array.from(document.querySelectorAll(selector)); }
function formatMoney(amount) { return `$${Number(amount).toFixed(2)}`; }

/* ---------- Cart Storage ---------- */
function getCart() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" ? parsed : {};
  } catch { return {}; }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartCount();
}

function addToCart(productId, qty = 1) {
  const cart = getCart();
  const currentQty = Number(cart[productId]?.qty ?? 0);
  cart[productId] = { qty: currentQty + qty };
  saveCart(cart);
}

function getCartCount() {
  const cart = getCart();
  let total = 0;
  for (const id in cart) total += Number(cart[id]?.qty ?? 0);
  return total;
}

/* ---------- Reviews Storage ---------- */
function getReviews(productId) {
  try {
    const raw = localStorage.getItem(`${REVIEWS_KEY}_${productId}`);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveReview(productId, review) {
  const reviews = getReviews(productId);
  reviews.unshift(review);
  localStorage.setItem(`${REVIEWS_KEY}_${productId}`, JSON.stringify(reviews));
}

/* ---------- Header / Shared UI ---------- */
function setYear() {
  const yearEl = $("#year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();
}

function updateCartCount() {
  const count = getCartCount();
  $all(".cart-count").forEach(el => { el.textContent = `(${count})`; });
}

function setupNavToggle() {
  const btn = $(".nav-toggle");
  const nav = $(".site-nav");
  if (!btn || !nav) return;
  btn.addEventListener("click", () => {
    const isOpen = nav.classList.toggle("is-open");
    btn.setAttribute("aria-expanded", String(isOpen));
  });
}

/* ---------- Shop Page ---------- */
async function loadProducts() {
  const res = await fetch(PRODUCTS_URL);
  if (!res.ok) throw new Error("Could not load products.json");
  return await res.json();
}

function renderProducts(products, filter = "all") {
  const grid = $("#productGrid");
  const emptyState = $("#emptyState");
  if (!grid) return;

  const visible = filter === "all" ? products : products.filter(p => p.category === filter);
  const cart = getCart();
  grid.innerHTML = "";

  if (visible.length === 0) {
    if (emptyState) emptyState.classList.remove("hidden");
    return;
  } else {
    if (emptyState) emptyState.classList.add("hidden");
  }

  visible.forEach(product => {
    const inCartQty = Number(cart[product.id]?.qty ?? 0);
    const isAvailable = product.available !== false;
    const card = document.createElement("article");
    card.className = "product-card" + (!isAvailable ? " out-of-stock" : "");

    // Build star rating from all reviews
    const allReviews = [...(product.reviews || []), ...getReviews(product.id)];
    const avgRating = allReviews.length
      ? (allReviews.reduce((s, r) => s + r.rating, 0) / allReviews.length).toFixed(1)
      : null;
    const starsHtml = avgRating
      ? `<div class="card-stars">${renderStars(parseFloat(avgRating))} <span class="card-review-count">(${allReviews.length})</span></div>`
      : "";

    card.innerHTML = `
      <a class="product-media" href="product.html?id=${product.id}" aria-label="View ${product.name} details">
        <img src="${product.image}" alt="${product.name}" loading="lazy">
        ${!isAvailable ? `<div class="oos-overlay">Out of Stock</div>` : ""}
      </a>
      <div class="product-body">
        <div class="product-title">
          <h3><a href="product.html?id=${product.id}" class="product-name-link">${product.name}</a></h3>
          <div class="price">${formatMoney(product.price)}</div>
        </div>
        ${starsHtml}
        <p class="product-desc">${product.description}</p>
        <div class="product-meta">
          <span class="pill">${product.category === "crochet" ? "Crochet" : "Souvenir"}</span>
          ${!isAvailable ? `<span class="pill pill-oos">Out of Stock</span>` : ""}
        </div>
        <div class="product-actions">
          ${isAvailable ? `
          <div class="qty-stepper" aria-label="Quantity">
            <button type="button" data-dec-shop="${product.id}" aria-label="Decrease">−</button>
            <span class="qty-display" id="qty-${product.id}">${inCartQty}</span>
            <button type="button" data-inc-shop="${product.id}" aria-label="Increase">+</button>
          </div>
          <a class="btn-small btn-outline" href="cart.html">View Cart</a>
          ` : `<span class="oos-label">Currently unavailable</span>`}
        </div>
      </div>
    `;
    grid.appendChild(card);
  });

  $all("[data-inc-shop]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-inc-shop");
      addToCart(id, 1);
      const display = document.getElementById(`qty-${id}`);
      if (display) display.textContent = Number(getCart()[id]?.qty ?? 0);
    });
  });

  $all("[data-dec-shop]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-dec-shop");
      const cart = getCart();
      const current = Number(cart[id]?.qty ?? 0);
      if (current <= 0) return;
      if (current === 1) delete cart[id];
      else cart[id] = { qty: current - 1 };
      saveCart(cart);
      const display = document.getElementById(`qty-${id}`);
      if (display) display.textContent = Number(getCart()[id]?.qty ?? 0);
    });
  });
}

function setupFilters(products) {
  const buttons = $all(".filter-btn");
  if (buttons.length === 0) return;
  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      buttons.forEach(b => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      renderProducts(products, btn.dataset.filter);
    });
  });
}

/* ---------- Stars helper ---------- */
function renderStars(rating) {
  let html = "";
  for (let i = 1; i <= 5; i++) {
    if (rating >= i) html += `<span class="star full">★</span>`;
    else if (rating >= i - 0.5) html += `<span class="star half">★</span>`;
    else html += `<span class="star empty">★</span>`;
  }
  return html;
}

/* ---------- Cart Page ---------- */
function findProduct(products, id) { return products.find(p => p.id === id); }

function renderCart(products) {
  const cartItemsEl = $("#cartItems");
  const emptyEl = $("#cartEmpty");
  const subtotalEl = $("#subtotal");
  const totalEl = $("#total");
  if (!cartItemsEl) return;

  const cart = getCart();
  const ids = Object.keys(cart);
  cartItemsEl.innerHTML = "";

  if (ids.length === 0) {
    if (emptyEl) emptyEl.classList.remove("hidden");
    if (subtotalEl) subtotalEl.textContent = formatMoney(0);
    if (totalEl) totalEl.textContent = formatMoney(0);
    return;
  }

  if (emptyEl) emptyEl.classList.add("hidden");
  let subtotal = 0;

  for (const id of ids) {
    const qty = Number(cart[id]?.qty ?? 0);
    if (!qty || qty < 1) continue;
    const product = findProduct(products, id);
    if (!product) continue;
    const price = Number(product.price) || 0;
    const lineTotal = price * qty;
    subtotal += lineTotal;

    const row = document.createElement("div");
    row.className = "cart-item";
    row.innerHTML = `
      <div class="cart-item-media">
        <img src="${product.image}" alt="${product.name}" loading="lazy">
      </div>
      <div class="cart-item-info">
        <div class="cart-item-top">
          <div>
            <p class="cart-item-name">${product.name}</p>
            <p class="cart-item-meta">${product.category === "crochet" ? "Crochet item" : "Souvenir"}</p>
          </div>
          <div class="cart-item-price">${formatMoney(price)}</div>
        </div>
        <div class="cart-item-controls" aria-label="Quantity controls">
          <button class="qty-btn" type="button" data-dec="${id}" aria-label="Decrease quantity">−</button>
          <span class="qty" aria-label="Quantity">${qty}</span>
          <button class="qty-btn" type="button" data-inc="${id}" aria-label="Increase quantity">+</button>
          <button class="remove-btn" type="button" data-remove="${id}">Remove</button>
          <span class="line-total">${formatMoney(lineTotal)}</span>
        </div>
      </div>
    `;
    cartItemsEl.appendChild(row);
  }

  if (subtotalEl) subtotalEl.textContent = formatMoney(subtotal);
  if (totalEl) totalEl.textContent = formatMoney(subtotal);

  cartItemsEl.querySelectorAll("[data-inc]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-inc");
      const cart = getCart();
      cart[id] = { qty: Number(cart[id]?.qty ?? 0) + 1 };
      saveCart(cart);
      renderCart(products);
    });
  });

  cartItemsEl.querySelectorAll("[data-dec]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-dec");
      const cart = getCart();
      const next = Number(cart[id]?.qty ?? 0) - 1;
      if (next <= 0) delete cart[id];
      else cart[id] = { qty: next };
      saveCart(cart);
      renderCart(products);
    });
  });

  cartItemsEl.querySelectorAll("[data-remove]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-remove");
      const cart = getCart();
      delete cart[id];
      saveCart(cart);
      renderCart(products);
    });
  });
}

function setupCartPage(products) {
  const clearBtn = $("#clearCartBtn");
  const checkoutBtn = $("#checkoutBtn");
  if (!clearBtn && !checkoutBtn) return;

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      localStorage.removeItem(CART_KEY);
      updateCartCount();
      renderCart(products);
    });
  }

  if (checkoutBtn) {
    checkoutBtn.addEventListener("click", () => {
      alert("Stripe checkout isn't connected yet — we'll wire this up next!");
    });
  }

  renderCart(products);
}

/* ---------- Initialize ---------- */
document.addEventListener("DOMContentLoaded", async () => {
  setYear();
  setupNavToggle();
  updateCartCount();

  try {
    const products = await loadProducts();
    if ($("#productGrid")) { renderProducts(products); setupFilters(products); }
    if ($("#cartItems")) { setupCartPage(products); }
  } catch (err) {
    console.error(err);
    const grid = $("#productGrid");
    const cartEl = $("#cartItems");
    if (grid) grid.innerHTML = "<p>Could not load products.</p>";
    if (cartEl) cartEl.innerHTML = "<p>Make sure Live Server is running and products.json is available.</p>";
  }
});
