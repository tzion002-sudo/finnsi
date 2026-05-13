#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
//  HaMatzpan · Fetch Prices  –  V2.9.7
//  סקריפט קל שמביא רק מחירים ושער דולר — ללא מייל, ללא סריקות
//  מופעל on-demand מהדפדפן דרך GitHub API → כותב ל-Firestore
//  Runtime: ~30 שניות
//
//  V2.9.7 שינויים:
//  • הוסף IBIT (iShares Bitcoin Trust)
//  • הוסר fallback ^GSPC×FX / ^IXIC×FX — ערכי מדד × FX אינם
//    מחירי יחידת קרן; עדיף null מאשר ערך שגוי
//  • שער דולר: USDILS=X (ראשי) עם fallback ל-ILS=X
// ═══════════════════════════════════════════════════════════════

import https from "https";

// ── Firebase config ─────────────────────────────────────────────
const FIREBASE = {
  projectId: "finnsi-3a75d",
  apiKey:    "AIzaSyBy7Rwwng-vpgE9Vjg3U0WgBgXOTZQFsv4",
};
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE.projectId}/databases/default/documents`;

// ── HTTP helper ──────────────────────────────────────────────────
function httpsGet(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method:  options.method || "GET",
      headers: { "User-Agent": "Mozilla/5.0", ...options.headers },
      timeout: options.timeout || 10000,
    }, res => {
      let body = "";
      res.on("data", d => body += d);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, body }); }
      });
    });
    req.on("error",   reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

// ── Firestore write (PATCH + updateMask — NEVER replaces whole document) ────
//
// ⚠️  DATA-LOSS PREVENTION:
//   • Uses ?updateMask.fieldPaths=<key> for every top-level field so that
//     fields NOT included in this payload are PRESERVED in Firestore.
//   • Null/undefined fields are silently skipped — a failed price fetch
//     will NOT overwrite the last known-good value in the document.
//   • This is especially critical for market_data/latest: if SP500 fetch
//     fails today, yesterday's confirmed price stays visible in the app.
async function fsWrite(col, docId, payload) {
  const fields = {};
  const writtenKeys = [];

  for (const [k, v] of Object.entries(payload)) {
    // Skip nulls — don't clobber last known-good value
    if (v === null || v === undefined) continue;

    if (typeof v === "number")  fields[k] = { doubleValue: v };
    else if (typeof v === "boolean") fields[k] = { booleanValue: v };
    else if (typeof v === "object" && !Array.isArray(v)) {
      // nested map — only include sub-keys that are non-null
      const inner = {};
      let innerHasData = false;
      for (const [ik, iv] of Object.entries(v)) {
        if (iv == null) continue;
        if (typeof iv === "number")  inner[ik] = { doubleValue: iv };
        else if (typeof iv === "boolean") inner[ik] = { booleanValue: iv };
        else inner[ik] = { stringValue: String(iv) };
        innerHasData = true;
      }
      if (!innerHasData) continue; // skip empty maps (e.g. all-null price object)
      fields[k] = { mapValue: { fields: inner } };
    }
    else fields[k] = { stringValue: String(v) };

    writtenKeys.push(k);
  }

  if (writtenKeys.length === 0) {
    console.log(`  ⚠ fsWrite(${col}/${docId}): nothing to write — all fields null, skipping`);
    return;
  }

  // Build updateMask so only these specific fields are touched
  const maskParams = writtenKeys.map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
  const url = `${FIRESTORE_BASE}/${col}/${docId}?key=${FIREBASE.apiKey}&${maskParams}`;
  await httpsGet(url, {
    method:  "PATCH",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ fields }),
  });
}

// ── Yahoo Finance price ──────────────────────────────────────────
async function yahooPrice(ticker, fallbackTicker = null) {
  try {
    const { body } = await httpsGet(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=2d`
    );
    const meta = body?.chart?.result?.[0]?.meta;
    const raw  = meta?.regularMarketPrice ?? meta?.postMarketPrice ?? meta?.preMarketPrice;
    if (raw != null) {
      const prev = meta.chartPreviousClose ?? meta.previousClose ?? null;
      const cur  = parseFloat(raw.toFixed(4));
      const chg  = prev ? parseFloat(((cur - prev) / prev * 100).toFixed(2)) : null;
      const src  = meta.regularMarketPrice != null ? "Yahoo Finance"
                 : meta.postMarketPrice    != null ? "Yahoo Finance (post-market)"
                 :                                   "Yahoo Finance (pre-market)";
      console.log(`  ✅ ${ticker}: ${meta.currency} ${cur} (${chg > 0 ? "+" : ""}${chg ?? "?"}%)`);
      return { price: cur, changePct: chg, currency: meta.currency || "USD", source: src };
    }
  } catch (e) { console.log(`  ⚠ ${ticker}: ${e.message}`); }

  if (fallbackTicker && fallbackTicker !== ticker) {
    const r = await yahooPrice(fallbackTicker, null);
    if (r.price != null) return { ...r, isFallback: true, fallbackTicker };
  }
  return { price: null, changePct: null, currency: null, source: "unavailable" };
}

// ── TASE price (Israeli securities in ILS) ───────────────────────
async function tasePrice(id) {
  // מקור 1: Yahoo Finance .TA suffix (אגורות → ÷100 = ₪)
  try {
    const { body } = await httpsGet(
      `https://query1.finance.yahoo.com/v8/finance/chart/${id}.TA?interval=1d&range=2d`
    );
    const meta = body?.chart?.result?.[0]?.meta;
    const raw  = meta?.regularMarketPrice ?? meta?.postMarketPrice;
    if (raw != null && raw > 100) {
      const price = parseFloat((raw / 100).toFixed(4));
      console.log(`  ✅ ${id}.TA: ₪${price}`);
      return { price, currency: "ILS", source: "Yahoo Finance (.TA)" };
    }
  } catch {}

  // מקור 2: Stooq (Node — ללא CORS)
  try {
    const { body } = await httpsGet(`https://stooq.com/q/l/?s=${id}.il&f=sd2t2ohlcv&h&e=csv`);
    if (typeof body === "string") {
      const close = parseFloat(body.trim().split("\n")[1]?.split(",")[6]);
      if (!isNaN(close) && close > 0 && close < 10000) {
        console.log(`  ✅ ${id} Stooq: ₪${close}`);
        return { price: close, currency: "ILS", source: "Stooq.com" };
      }
    }
  } catch {}

  console.log(`  ⚠ ${id}: לא נמצא מחיר`);
  return { price: null, currency: "ILS", source: "unavailable" };
}

// ── FX rate (USD → ILS) ──────────────────────────────────────────
// USDILS=X הוא הטיקר הסטנדרטי ב-Yahoo Finance; ILS=X לפעמים מחזיר
// ערך הפוך (ILS/USD ≈ 0.27) או ערך לא תקני — לכן USDILS=X ראשוני.
async function fxUsdIls() {
  // ניסיון 1: USDILS=X
  const r1 = await yahooPrice("USDILS=X");
  if (r1.price != null && r1.price > 2 && r1.price < 10) {
    return { usdIls: r1.price, source: r1.source + " (USDILS=X)" };
  }
  // ניסיון 2: ILS=X (fallback)
  const r2 = await yahooPrice("ILS=X");
  if (r2.price != null && r2.price > 2 && r2.price < 10) {
    return { usdIls: r2.price, source: r2.source + " (ILS=X)" };
  }
  console.log("  ⚠ USD/ILS: לא נמצא שער תקני — שמירה על הערך הקיים");
  return { usdIls: null, source: "unavailable" };
}

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  const now = new Date().toISOString();
  console.log(`\n⚡ [V2.9.7] Fetch Prices — ${now}`);
  console.log("══════════════════════════════════════════");

  const [mstr, msty, fx, sp500, nasdaq, ibit] = await Promise.all([
    yahooPrice("MSTR"),
    yahooPrice("MSTY"),
    fxUsdIls(),
    tasePrice("1183441"),   // קרן מחקה S&P500 בבורסת ת"א (אגורות → ÷100)
    tasePrice("1159243"),   // קרן מחקה Nasdaq בבורסת ת"א (אגורות → ÷100)
    yahooPrice("IBIT"),     // iShares Bitcoin Trust ETF (USD)
  ]);

  const usdIls = fx.usdIls;

  // ⚠️  SP500 / Nasdaq: אין fallback ל-^GSPC×FX / ^IXIC×FX
  //  ערכי המדד (5,800 / 18,000) × FX ≠ מחיר יחידת הקרן (~43₪ / ~4,856₪)
  //  אם ה-TASE fetch נכשל — נשמור null; הערך הקודם יישאר ב-Firestore
  //  (fsWrite מדלג על null כדי לשמר את הערך הידוע האחרון)

  const payload = {
    timestamp:    now,
    updatedBy:    "on-demand",
    mstr:  { price: mstr.price,  changePct: mstr.changePct,  priceSource: mstr.source  },
    msty:  { price: msty.price,  changePct: msty.changePct,  priceSource: msty.source  },
    fx:    { usdIls: usdIls,     source: fx.source },
    sp500: { price: sp500.price,  priceSource: sp500.source,  isFallback: false },
    nasdaq:{ price: nasdaq.price, priceSource: nasdaq.source, isFallback: false },
    ibit:  { price: ibit.price,  changePct: ibit.changePct,  priceSource: ibit.source  },
  };

  await fsWrite("market_data", "latest", payload);
  await fsWrite("scanner_status", "latest", {
    lastRun:   now,
    status:    "ok",
    updatedBy: "on-demand",
  });

  console.log("\n✅ מחירים נשמרו ב-Firestore market_data/latest");
  console.log(`   MSTR: $${mstr.price ?? "N/A"}  |  MSTY: $${msty.price ?? "N/A"}  |  IBIT: $${ibit.price ?? "N/A"}  |  USD/ILS: ₪${usdIls ?? "N/A"}`);
  console.log(`   SP500: ₪${sp500.price ?? "N/A"}  |  Nasdaq: ₪${nasdaq.price ?? "N/A"}`);
}

main().catch(e => { console.error("❌ fetch-prices failed:", e); process.exit(1); });
