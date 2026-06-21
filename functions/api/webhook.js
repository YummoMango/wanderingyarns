// Cloudflare Pages Function: POST /api/webhook
// Receives Stripe webhook events. On checkout.session.completed:
//   1. Decrements stock in Supabase for each item purchased
//   2. Sends a warm order confirmation email via Resend

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

  // ── 1. Decrement stock for each item purchased ────────────────────────────
  for (const item of cartItems) {
    try {
      await decrementStock(item.k, item.q);
    } catch (err) {
      console.error(`Failed to decrement stock for ${item.k}:`, err);
      // Don't fail the whole webhook — Stripe will retry if we return non-2xx,
      // and a partial failure is better than a full retry that double-decrements.
    }
  }

  // ── 2. Send confirmation email via Resend ─────────────────────────────────
  const customerEmail = session.customer_details?.email;
  const customerName = session.customer_details?.name || "";

  if (customerEmail && env.RESEND_API_KEY) {
    try {
      // Fetch line items from Stripe so we can show prices in the email
      let lineItems = [];
      if (env.STRIPE_SECRET_KEY) {
        try {
          const liRes = await fetch(
            `https://api.stripe.com/v1/checkout/sessions/${session.id}/line_items?limit=50`,
            {
              headers: { "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}` }
            }
          );
          if (liRes.ok) {
            const liData = await liRes.json();
            lineItems = liData.data || [];
          }
        } catch (err) {
          console.warn("Could not fetch line items from Stripe:", err);
          // Fall back to cart metadata (no prices, but names are there)
        }
      }

      await sendConfirmationEmail({
        apiKey: env.RESEND_API_KEY,
        toEmail: customerEmail,
        toName: customerName,
        sessionId: session.id,
        cartItems,
        lineItems,
        amountTotal: session.amount_total,
        amountShipping: session.total_details?.amount_shipping ?? null,
      });
    } catch (err) {
      console.error("Failed to send confirmation email:", err);
      // Don't return non-2xx — stock was already decremented, email is best-effort
    }
  } else {
    if (!customerEmail) console.warn("No customer email in session — skipping email");
    if (!env.RESEND_API_KEY) console.warn("RESEND_API_KEY not set — skipping email");
  }

  return new Response("OK", { status: 200 });
}

// ─── Stock decrement ──────────────────────────────────────────────────────────

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

// ─── Confirmation email ───────────────────────────────────────────────────────

async function sendConfirmationEmail({ apiKey, toEmail, toName, sessionId, cartItems, lineItems, amountTotal, amountShipping }) {
  const firstName = toName ? toName.split(" ")[0] : "there";
  const total = typeof amountTotal === "number" ? `$${(amountTotal / 100).toFixed(2)}` : "—";
  const shipping = typeof amountShipping === "number" ? `$${(amountShipping / 100).toFixed(2)}` : "Included";
  const shortId = sessionId.replace(/^cs_(live|test)_/, "").slice(0, 12).toUpperCase();

  // Build the items table — prefer Stripe line items (has prices), fall back to cart metadata
  let itemRows = "";
  if (lineItems.length > 0) {
    itemRows = lineItems.map(li => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #f0ebe4;color:#4a3f35;font-size:15px;">
          ${li.description || "Item"}${li.quantity > 1 ? ` <span style="color:#8a7a6d;">× ${li.quantity}</span>` : ""}
        </td>
        <td style="padding:10px 0;border-bottom:1px solid #f0ebe4;text-align:right;font-weight:700;color:#1e1610;font-size:15px;white-space:nowrap;">
          $${(li.amount_total / 100).toFixed(2)}
        </td>
      </tr>`).join("");
  } else {
    itemRows = cartItems.map(ci => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #f0ebe4;color:#4a3f35;font-size:15px;">
          ${ci.n}${ci.q > 1 ? ` <span style="color:#8a7a6d;">× ${ci.q}</span>` : ""}
        </td>
        <td style="padding:10px 0;border-bottom:1px solid #f0ebe4;text-align:right;color:#8a7a6d;font-size:14px;">
          —
        </td>
      </tr>`).join("");
  }

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f8f3ec;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f3ec;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

        <!-- Header -->
        <tr><td style="text-align:center;padding-bottom:28px;">
          <p style="margin:0;font-size:28px;font-weight:900;color:#1e1610;font-family:Georgia,serif;font-style:italic;letter-spacing:-0.5px;">
            🧶 WanderingYarns
          </p>
        </td></tr>

        <!-- Card -->
        <tr><td style="background:white;border-radius:16px;padding:36px 36px 28px;border:1px solid #e4d9cc;box-shadow:0 4px 20px rgba(30,22,16,0.08);">

          <p style="margin:0 0 6px;font-size:13px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#d4726a;">
            Order Confirmed ✓
          </p>
          <h1 style="margin:0 0 18px;font-size:26px;font-weight:900;color:#1e1610;font-family:Georgia,serif;line-height:1.2;">
            Thanks, ${firstName}! Your order is in. 🎉
          </h1>

          <p style="margin:0 0 20px;font-size:15px;color:#4a3f35;line-height:1.7;">
            I got your order and I'm already excited to get it ready for you.
            I'll be in touch once it's on its way — in the meantime, feel free to
            reply to this email if you have any questions at all.
          </p>

          <!-- Order summary -->
          <div style="background:#f8f3ec;border-radius:10px;padding:20px 22px;margin-bottom:22px;border:1px solid #e4d9cc;">
            <p style="margin:0 0 12px;font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#8a7a6d;">
              Order summary · #${shortId}
            </p>
            <table width="100%" cellpadding="0" cellspacing="0">
              ${itemRows}
              <tr>
                <td style="padding-top:12px;font-size:14px;color:#8a7a6d;">Shipping</td>
                <td style="padding-top:12px;text-align:right;font-size:14px;color:#8a7a6d;">${shipping}</td>
              </tr>
              <tr>
                <td style="padding-top:10px;font-size:16px;font-weight:900;color:#1e1610;border-top:2px solid #e4d9cc;">Total</td>
                <td style="padding-top:10px;text-align:right;font-size:16px;font-weight:900;color:#1e1610;border-top:2px solid #e4d9cc;">${total}</td>
              </tr>
            </table>
          </div>

          <p style="margin:0 0 6px;font-size:15px;color:#4a3f35;line-height:1.7;">
            Have a question or want to check in?
          </p>
          <p style="margin:0 0 28px;font-size:15px;color:#4a3f35;line-height:1.7;">
            📧 Just reply to this email or write to
            <a href="mailto:hello@wanderingyarns.com" style="color:#d4726a;text-decoration:none;font-weight:600;">hello@wanderingyarns.com</a>
            — I read every message personally.
          </p>

          <p style="margin:0;font-size:15px;color:#4a3f35;line-height:1.7;">
            Thank you so much for supporting a tiny one-person shop —
            it genuinely means a lot. 🧶
          </p>

          <p style="margin:20px 0 0;font-size:15px;color:#4a3f35;">
            — Edward @ WanderingYarns
          </p>

        </td></tr>

        <!-- Footer -->
        <tr><td style="text-align:center;padding-top:24px;">
          <p style="margin:0;font-size:12px;color:#8a7a6d;line-height:1.7;">
            WanderingYarns · Handmade crochet &amp; travel souvenirs<br>
            <a href="https://wanderingyarns.com" style="color:#d4726a;text-decoration:none;">wanderingyarns.com</a>
            &nbsp;·&nbsp;
            <a href="mailto:hello@wanderingyarns.com" style="color:#d4726a;text-decoration:none;">hello@wanderingyarns.com</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: "WanderingYarns <orders@wanderingyarns.com>",
      to: [toEmail],
      reply_to: "edward.m.chung@gmail.com",
      subject: "Your WanderingYarns order is confirmed! 🧶",
      html
    })
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Resend API ${res.status}: ${errBody}`);
  }

  const result = await res.json();
  console.log("Confirmation email sent:", result.id);
}

// ─── Stripe signature verification ───────────────────────────────────────────

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
