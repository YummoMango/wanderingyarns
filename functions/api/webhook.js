// Cloudflare Pages Function: POST /api/webhook
// Receives Stripe webhook events. On checkout.session.completed,
// decrements stock in Supabase for each item purchased.

const SUPABASE_URL = "https://kaessaqzirsxkhetdjib.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImthZXNzYXF6aXJzeGtoZXRkamliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0NTgxNjYsImV4cCI6MjA5NTAzNDE2Nn0.3WKkytULqu1lMOw8bKqgHl_sCypcgk-zbFC-Q4PZsM4";

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.STRIPE_WEBHOOK_SECRET) {
    console.error("STRIPE_WEBHOOK_SECRET env var is not set");
    return new Response("Webhook secret not configured", { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  // Get the raw body — verification depends on byte-for-byte exact text.
  const rawBody = await request.text();

  // Verify the signature came from Stripe (not a malicious actor).
  const verified = await verifyStripeSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  if (!verified) {
    console.warn("Invalid Stripe webhook signature");
    return new Response("Invalid signature", { status: 401 });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // We only care about successful checkout completions for stock decrement.
  if (event.type !== "checkout.session.completed") {
    return new Response("Event type ignored", { status: 200 });
  }

  const session = event.data.object;
  const cartMetaRaw = session.metadata?.cart_items;
  if (!cartMetaRaw) {
    console.warn("No cart_items metadata in session", session.id);
    return new Response("OK (no cart metadata)", { status: 200 });
  }

  let cartItems;
  try {
    cartItems = JSON.parse(cartMetaRaw);
  } catch {
    console.error("Could not parse cart_items metadata:", cartMetaRaw);
    return new Response("Invalid metadata", { status: 200 });
  }

  // Decrement stock for each item purchased
  for (const item of cartItems) {
    try {
      await decrementStock(item.k, item.q);
    } catch (err) {
      console.error(`Failed to decrement stock for ${item.k}:`, err);
      // Don't fail the whole webhook — Stripe will retry if we return non-2xx,
      // and a partial failure is better than a full retry that double-decrements.
    }
  }

  return new Response("OK", { status: 200 });
}

async function decrementStock(variantKey, qty) {
  // Get current stock entry
  const getRes = await fetch(
    `${SUPABASE_URL}/rest/v1/stock?variant_key=eq.${encodeURIComponent(variantKey)}&select=stock,available`,
    {
      headers: {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`
      }
    }
  );
  if (!getRes.ok) {
    throw new Error(`Supabase fetch failed: ${getRes.status}`);
  }
  const rows = await getRes.json();

  // If no entry exists, the item is "unlimited" (made-to-order). Nothing to decrement.
  if (rows.length === 0) return;

  const current = rows[0].stock;
  // null stock = unlimited; only decrement if it's a real number
  if (typeof current !== "number") return;

  const newStock = Math.max(0, current - qty);
  // If we just hit 0, also flip available=false so the item disappears from the storefront
  const newAvailable = newStock > 0 ? rows[0].available !== false : false;

  const patchRes = await fetch(
    `${SUPABASE_URL}/rest/v1/stock?variant_key=eq.${encodeURIComponent(variantKey)}`,
    {
      method: "PATCH",
      headers: {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
      },
      body: JSON.stringify({ stock: newStock, available: newAvailable })
    }
  );
  if (!patchRes.ok) {
    throw new Error(`Supabase patch failed: ${patchRes.status}`);
  }
}

// Verify the Stripe-Signature header (HMAC-SHA256 of `timestamp.body`).
// See https://docs.stripe.com/webhooks/signatures for the algorithm.
async function verifyStripeSignature(payload, header, secret) {
  // Header looks like: t=1492774577,v1=5257a869e7...,v1=fdcb...
  const parts = header.split(",").map(p => p.trim().split("="));
  const timestamp = parts.find(p => p[0] === "t")?.[1];
  const v1Sigs = parts.filter(p => p[0] === "v1").map(p => p[1]);

  if (!timestamp || v1Sigs.length === 0) return false;

  // Reject events older than 5 minutes (replay protection)
  const ageSeconds = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  if (isNaN(ageSeconds) || ageSeconds > 300 || ageSeconds < -300) {
    console.warn(`Webhook timestamp too far from current time: ${ageSeconds}s`);
    return false;
  }

  const signedPayload = `${timestamp}.${payload}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBytes = await crypto.subtle.sign("HMAC", key, encoder.encode(signedPayload));
  const computed = bytesToHex(new Uint8Array(sigBytes));

  // Constant-time compare (avoid leaking via timing side channel)
  return v1Sigs.some(s => safeEqual(s, computed));
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
