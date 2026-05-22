/* WanderingYarns - app.js */

const PRODUCTS_URL = "data/products.json";
const CART_KEY = "wanderingyarns_cart";
const REVIEWS_KEY = "wanderingyarns_reviews";
const STOCK_KEY = "wanderingyarns_stock";

/* ---------- Stock Overrides (set via admin panel) ---------- */
function getStockOverrides() {
  try {
    const raw = localStorage.getItem(STOCK_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function applyStockOverrides(products) {
  const overrides = getStockOverrides();
  return products.map(p => {
    const o = overrides[p.id];
    if (!o) return p;
    const updated = { ...p };
    if (o.available !== undefined) updated.available = o.available;
    if (o.stock !== undefined && o.stock !== null) updated.stock = o.stock;
    if (o.variants && updated.variants) {
      updated.variants = updated.variants.map(v => {
        const vo = o.variants[v.id];
        if (!vo) return v;
        return {
          ...v,
          available: vo.available !== undefined ? vo.available : v.available,
          stock: vo.stock !== undefined && vo.stock !== null ? vo.stock : v.stock
        };
      });
    }
    return updated;
  });
}

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

/* ---------- Stars ---------- */
function renderStars(rating) {
  let html = "";
  for (let i = 1; i <= 5; i++) {
    if (rating >= i) html += `<span class="star full">★</span>`;
    else if (rating >= i - 0.5) html += `<span class="star half">★</span>`;
    else html += `<span class="star empty">★</span>`;
  }
  return html;
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

/* ---------- Product Loading ---------- */
async function loadProducts() {
  const res = await fetch(PRODUCTS_URL);
  if (!res.ok) throw new Error("Could not load products.json");
  return await res.json();
}

/* ---------- Render a single product card ---------- */
function buildProductCard(product, cart) {
  const isAvailable = product.available !== false;
  const minPrice = product.variants
    ? Math.min(...product.variants.filter(v => v.price).map(v => v.price))
    : null;
  const priceDisplay = minPrice
    ? `<span class="price-from">From </span>${formatMoney(minPrice)}`
    : formatMoney(product.price);
  const avgRating = allReviews.length
    ? (allReviews.reduce((s, r) => s + r.rating, 0) / allReviews.length).toFixed(1)
    : null;
  const starsHtml = avgRating
    ? `<div class="card-stars">${renderStars(parseFloat(avgRating))} <span class="card-review-count">(${allReviews.length})</span></div>`
    : "";

  const inCartQty = Number(cart[product.id]?.qty ?? 0);
  const card = document.createElement("article");
  card.className = "product-card" + (!isAvailable ? " out-of-stock" : "");

  card.innerHTML = `
    <a class="product-media" href="product.html?id=${product.id}" aria-label="View ${product.name} details">
      <img src="${product.image}" alt="${product.name}" loading="lazy">
      ${!isAvailable ? `<div class="oos-overlay">Out of Stock</div>` : ""}
    </a>
    <div class="product-body">
      <div class="product-title">
        <h3><a href="product.html?id=${product.id}" class="product-name-link">${product.name}</a></h3>
        <div class="price">${priceDisplay}</div>
      </div>
      ${starsHtml}
      <p class="product-desc">${product.description}</p>
      <div class="product-meta">
        <span class="pill">${product.category === "crochet" ? "Crochet" : "Souvenir"}</span>
        ${product.variants ? `<span class="pill pill-accent">${product.variants.length} designs</span>` : ""}
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
  return card;
}

/* ---------- Shop Page - Two Grids ---------- */
function renderShopGrids(products) {
  const crochetGrid = $("#crochetGrid");
  const souvenirGrid = $("#souvenirGrid");
  if (!crochetGrid && !souvenirGrid) return;

  const cart = getCart();
  const crochetProducts = products.filter(p => p.category === "crochet");
  const souvenirProducts = products.filter(p => p.category === "souvenir");

  if (crochetGrid) {
    crochetGrid.innerHTML = "";
    if (crochetProducts.length === 0) {
      $("#crochetEmpty")?.classList.remove("hidden");
    } else {
      $("#crochetEmpty")?.classList.add("hidden");
      crochetProducts.forEach(p => crochetGrid.appendChild(buildProductCard(p, cart)));
    }
  }

  if (souvenirGrid) {
    souvenirGrid.innerHTML = "";
    if (souvenirProducts.length === 0) {
      $("#souvenirEmpty")?.classList.remove("hidden");
    } else {
      $("#souvenirEmpty")?.classList.add("hidden");
      souvenirProducts.forEach(p => souvenirGrid.appendChild(buildProductCard(p, cart)));
    }
  }

  // Wire up qty steppers
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
        <div class="cart-item-controls">
          <button class="qty-btn" type="button" data-dec="${id}">−</button>
          <span class="qty">${qty}</span>
          <button class="qty-btn" type="button" data-inc="${id}">+</button>
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
    const rawProducts = await loadProducts();
    const products = applyStockOverrides(rawProducts);

    // Shop page (two grids)
    if ($("#crochetGrid") || $("#souvenirGrid")) {
      renderShopGrids(products);
    }

    // Cart page
    if ($("#cartItems")) {
      setupCartPage(products);
    }

  } catch (err) {
    console.error(err);
    const crochetEl = $("#crochetGrid");
    const souvenirEl = $("#souvenirGrid");
    const cartEl = $("#cartItems");
    if (crochetEl) crochetEl.innerHTML = "<p>Could not load products.</p>";
    if (souvenirEl) souvenirEl.innerHTML = "<p>Could not load products.</p>";
    if (cartEl) cartEl.innerHTML = "<p>Make sure Live Server is running and products.json is available.</p>";
  }
});
