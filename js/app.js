/* WanderingYarns - app.js */

const PRODUCTS_URL = "data/products.json";
const CART_KEY = "wanderingyarns_cart";
const REVIEWS_KEY = "wanderingyarns_reviews";
const STOCK_KEY = "wanderingyarns_stock";

/* ============================================================
   Supabase Stock Integration
   ============================================================ */
const SUPABASE_URL = "https://kaessaqzirsxkhetdjib.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImthZXNzYXF6aXJzeGtoZXRkamliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0NTgxNjYsImV4cCI6MjA5NTAzNDE2Nn0.3WKkytULqu1lMOw8bKqgHl_sCypcgk-zbFC-Q4PZsM4";

const sbHeaders = {
  "apikey": SUPABASE_ANON_KEY,
  "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
  "Content-Type": "application/json"
};

async function fetchStockFromSupabase() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/stock?select=*`, { headers: sbHeaders });
    if (!res.ok) {
      console.error("Supabase error:", res.status, await res.text());
      return {};
    }
    const rows = await res.json();
    console.log("Supabase stock rows:", rows);
    const stockMap = {};
    rows.forEach(row => {
      stockMap[row.variant_key] = { stock: row.stock, available: row.available };
    });
    return stockMap;
  } catch (err) {
    console.error("Supabase fetch failed:", err);
    return {};
  }
}

function applySupabaseStock(products, stockMap) {
  return products.map(p => {
    const updated = { ...p };
    const productEntry = stockMap[p.id];
    if (productEntry) {
      if (productEntry.available === false) updated.available = false;
      if (typeof productEntry.stock === "number") updated.stock = productEntry.stock;
    }
    if (updated.variants) {
      updated.variants = updated.variants.map(v => {
        const entry = stockMap[`${p.id}__${v.id}`];
        if (!entry) return v;
        return {
          ...v,
          available: entry.available !== undefined ? entry.available : v.available,
          stock: typeof entry.stock === "number" ? entry.stock : v.stock
        };
      });
    }
    return updated;
  });
}

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
  for (const key in cart) total += Number(cart[key]?.qty ?? 0);
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
  const variantPrices = product.variants
    ? product.variants.filter(v => v.price != null).map(v => v.price)
    : [];
  const minPrice = variantPrices.length > 0 ? Math.min(...variantPrices) : null;
  const priceDisplay = minPrice != null
    ? `<span class="price-from">From </span>${formatMoney(minPrice)}`
    : formatMoney(product.price);
  const allReviews = [...(product.reviews || []), ...getReviews(product.id)];
  const avgRating = allReviews.length
    ? (allReviews.reduce((s, r) => s + r.rating, 0) / allReviews.length).toFixed(1)
    : null;
  const starsHtml = avgRating
    ? `<div class="card-stars">${renderStars(parseFloat(avgRating))} <span class="card-review-count">(${allReviews.length})</span></div>`
    : "";

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
        ${isAvailable
          ? `<a class="btn btn-primary btn-small" href="product.html?id=${product.id}">View & Buy</a>`
          : `<span class="oos-label">Currently unavailable</span>`}
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

  for (const cartKey of ids) {
    const entry = cart[cartKey];
    const qty = Number(entry?.qty ?? 0);
    if (!qty || qty < 1) continue;

    // Support both old format (just productId) and new format (productId__variantId)
    const productId = entry.productId || cartKey.split("__")[0];
    const product = findProduct(products, productId);
    if (!product) continue;

    const price = Number(entry.price ?? product.price) || 0;
    const lineTotal = price * qty;
    subtotal += lineTotal;

    const displayName = entry.variantName
      ? `${entry.name || product.name} — ${entry.variantName}`
      : (entry.name || product.name);
    const image = entry.image || product.image;
    const category = entry.category || product.category;

    // Get stock limit from cart entry or product variants
    let stockLimit = entry?.stockLimit ?? null;
    if (stockLimit === null && entry.variantId && product.variants) {
      const v = product.variants.find(v => v.id === entry.variantId);
      stockLimit = v?.stock ?? null;
    } else if (stockLimit === null && typeof product.stock === "number") {
      stockLimit = product.stock;
    }
    const atLimit = stockLimit !== null && qty >= stockLimit;

    const row = document.createElement("div");
    row.className = "cart-item";
    row.innerHTML = `
      <div class="cart-item-media">
        <img src="${image}" alt="${displayName}" loading="lazy">
      </div>
      <div class="cart-item-info">
        <div class="cart-item-top">
          <div>
            <p class="cart-item-name">${displayName}</p>
            <p class="cart-item-meta">${category === "crochet" ? "Crochet item" : "Souvenir"}</p>
          </div>
          <div class="cart-item-price">${formatMoney(price)}</div>
        </div>
        <div class="cart-item-controls">
          <button class="qty-btn" type="button" data-dec="${cartKey}">−</button>
          <span class="qty">${qty}</span>
          <button class="qty-btn" type="button" data-inc="${cartKey}" ${atLimit ? 'disabled style="opacity:0.4;cursor:default;"' : ""}>+</button>
          <button class="remove-btn" type="button" data-remove="${cartKey}">Remove</button>
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
      const key = btn.getAttribute("data-inc");
      const cart = getCart();
      const entry = cart[key];
      const currentQty = Number(entry?.qty ?? 0);
      // Get stock limit
      let limit = entry?.stockLimit ?? null;
      if (limit === null && entry?.variantId) {
        const p = findProduct(products, entry.productId || key.split("__")[0]);
        const v = p?.variants?.find(v => v.id === entry.variantId);
        limit = v?.stock ?? null;
      }
      if (limit !== null && currentQty >= limit) return;
      cart[key] = { ...entry, qty: currentQty + 1 };
      saveCart(cart);
      renderCart(products);
    });
  });

  cartItemsEl.querySelectorAll("[data-dec]").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-dec");
      const cart = getCart();
      const next = Number(cart[key]?.qty ?? 0) - 1;
      if (next <= 0) delete cart[key];
      else cart[key] = { ...cart[key], qty: next };
      saveCart(cart);
      renderCart(products);
    });
  });

  cartItemsEl.querySelectorAll("[data-remove]").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-remove");
      const cart = getCart();
      delete cart[key];
      saveCart(cart);
      renderCart(products);
    });
  });
}

async function setupCartPage(products) {
  const clearBtn = $("#clearCartBtn");
  const checkoutBtn = $("#checkoutBtn");
  if (!clearBtn && !checkoutBtn) return;

  // Apply Supabase stock to products so cart knows real limits
  try {
    const stockMap = await fetchStockFromSupabase();
    products = applySupabaseStock(products, stockMap);
  } catch (e) {
    console.warn("Could not fetch Supabase stock for cart:", e);
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      localStorage.removeItem(CART_KEY);
      updateCartCount();
      renderCart(products);
    });
  }

  if (checkoutBtn) {
    checkoutBtn.addEventListener("click", async () => {
      const cart = getCart();
      const cartKeys = Object.keys(cart);

      if (cartKeys.length === 0) {
        alert("Your cart is empty!");
        return;
      }

      // Build minimal items payload — server validates prices itself from products.json
      const items = cartKeys.map(key => {
        const entry = cart[key];
        return {
          productId: entry.productId || key.split("__")[0],
          variantId: entry.variantId,
          qty: entry.qty,
          image: entry.image
        };
      });

      const originalText = checkoutBtn.textContent;
      checkoutBtn.textContent = "Connecting to checkout…";
      checkoutBtn.disabled = true;

      try {
        const res = await fetch("/api/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items })
        });
        const data = await res.json();
        if (!res.ok || !data.url) {
          throw new Error(data.error || "Could not start checkout");
        }
        // Redirect to Stripe-hosted checkout page
        window.location.href = data.url;
      } catch (err) {
        console.error("Checkout error:", err);
        alert("Sorry, we couldn't start checkout — please try again.\n\n" + (err.message || ""));
        checkoutBtn.textContent = originalText;
        checkoutBtn.disabled = false;
      }
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

    // Try to get stock from Supabase, fall back to localStorage overrides
    let products;
    try {
      const stockMap = await fetchStockFromSupabase();
      products = applySupabaseStock(rawProducts, stockMap);
    } catch {
      products = applyStockOverrides(rawProducts);
    }

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
    if (cartEl) cartEl.innerHTML = "<p>Make sure products.json is available.</p>";
  }
});
