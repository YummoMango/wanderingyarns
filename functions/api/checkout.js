// Cloudflare Pages Function: POST /api/checkout
// Creates a Stripe Checkout Session from the customer's cart and returns the URL to redirect to.

const SUPABASE_URL = "https://kaessaqzirsxkhetdjib.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImthZXNzYXF6aXJzeGtoZXRkamliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0NTgxNjYsImV4cCI6MjA5NTAzNDE2Nn0.3WKkytULqu1lMOw8bKqgHl_sCypcgk-zbFC-Q4PZsM4";

export async function onRequestPost(context) {
  const { request, env } = context;

  // Verify the Stripe secret key was provided via env (set in Cloudflare dashboard)
  if (!env.STRIPE_SECRET_KEY) {
    console.error("STRIPE_SECRET_KEY env var is not set");
    return json({ error: "Server configuration error — STRIPE_SECRET_KEY missing." }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) return json({ error: "Cart is empty" }, 400);

  const origin = new URL(request.url).origin;

  // Fetch trusted product catalog from same domain so we never trust client-supplied prices
  let products;
  try {
    const productsRes = await fetch(`${origin}/data/products.json`);
    if (!productsRes.ok) throw new Error("products.json fetch returned " + productsRes.status);
    products = await productsRes.json();
  } catch (err) {
    console.error("Failed to load products.json:", err);
    return json({ error: "Could not load product catalog" }, 500);
  }

  // For each cart item, look up the real price and name from products.json
  const lineItems = [];
  for (const item of items) {
    const product = products.find(p => p.id === item.productId);
    if (!product) {
      return json({ error: `Unknown product: ${item.productId}` }, 400);
    }
    if (product.available === false) {
      return json({ error: `${product.name} is no longer available` }, 400);
    }

    let price = product.price;
    let name = product.name;
    let image = item.image;

    if (item.variantId && product.variants) {
      const variant = product.variants.find(v => v.id === item.variantId);
      if (!variant) {
        return json({ error: `Unknown variant: ${item.variantId}` }, 400);
      }
      if (variant.available === false) {
        return json({ error: `${product.name} (${variant.name}) is no longer available` }, 400);
      }
      price = variant.price != null ? variant.price : product.price;
      name = `${product.name} — ${variant.name}`;
      image = variant.image || image;
    }

    const qty = parseInt(item.qty, 10);
    if (!qty || qty < 1) {
      return json({ error: `Invalid quantity for ${name}` }, 400);
    }

    lineItems.push({ name, price, qty, image, variantKey: item.variantId ? `${item.productId}__${item.variantId}` : item.productId });
  }

  // Pull current stock from Supabase to verify nothing in the cart exceeds available stock.
  // Browser-side stock data can be stale; this is the authoritative check.
  let stockMap = {};
  try {
    const stockRes = await fetch(`${SUPABASE_URL}/rest/v1/stock?select=*`, {
      headers: {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`
      }
    });
    if (stockRes.ok) {
      const rows = await stockRes.json();
      rows.forEach(r => { stockMap[r.variant_key] = r; });
    }
  } catch (err) {
    console.error("Could not fetch stock from Supabase:", err);
    // Don't block checkout if Supabase is briefly unavailable — fall back to products.json availability flags.
  }

  for (const li of lineItems) {
    const entry = stockMap[li.variantKey];
    if (!entry) continue; // No Supabase override means use products.json default (already checked above).
    if (entry.available === false) {
      return json({ error: `${li.name} is no longer available` }, 400);
    }
    if (typeof entry.stock === "number" && entry.stock < li.qty) {
      const left = entry.stock <= 0 ? "none" : `only ${entry.stock}`;
      return json({ error: `Sorry — ${left} left of ${li.name}. Please update your cart.` }, 409);
    }
  }

  // Build URL-encoded body for Stripe API
  const params = new URLSearchParams();
  lineItems.forEach((li, i) => {
    params.append(`line_items[${i}][price_data][currency]`, "usd");
    params.append(`line_items[${i}][price_data][unit_amount]`, Math.round(li.price * 100).toString());
    params.append(`line_items[${i}][price_data][product_data][name]`, li.name);
    if (li.image) {
      const imgUrl = li.image.startsWith("http")
        ? li.image
        : `${origin}/${li.image.replace(/^\//, "")}`;
      params.append(`line_items[${i}][price_data][product_data][images][]`, imgUrl);
    }
    params.append(`line_items[${i}][quantity]`, li.qty.toString());
  });

  params.append("mode", "payment");
  params.append("success_url", `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`);
  params.append("cancel_url", `${origin}/cart.html`);

  // Attach the cart as metadata so the webhook can decrement Supabase stock after payment.
  // Stripe metadata values must be strings, ≤ 500 chars. A typical cart easily fits.
  const cartForMeta = lineItems.map(li => ({
    k: li.variantKey,
    n: li.name,
    q: li.qty
  }));
  params.append("metadata[cart_items]", JSON.stringify(cartForMeta));

  // Collect shipping address — US only for now (adjust as needed)
  params.append("shipping_address_collection[allowed_countries][]", "US");

  // Flat $5 standard shipping rate
  params.append("shipping_options[0][shipping_rate_data][display_name]", "Standard shipping");
  params.append("shipping_options[0][shipping_rate_data][type]", "fixed_amount");
  params.append("shipping_options[0][shipping_rate_data][fixed_amount][amount]", "500");
  params.append("shipping_options[0][shipping_rate_data][fixed_amount][currency]", "usd");

  // Call Stripe
  let session;
  try {
    const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    });
    session = await stripeRes.json();
    if (!stripeRes.ok) {
      console.error("Stripe error:", session);
      return json({ error: session.error?.message || "Could not create checkout session" }, 500);
    }
  } catch (err) {
    console.error("Stripe fetch failed:", err);
    return json({ error: "Could not reach Stripe" }, 500);
  }

  return json({ url: session.url });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
