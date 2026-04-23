#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
//  HaMatzpan · Daily Scanner  –  V2.4.1
//  Node.js standalone — ללא CORS, כותב ל-Firestore + JSON backup
//  הרצה: node scripts/daily-scanner.js
//         או: run-scanner.bat
//
//  ארכיטקטורה:
//    Scanner (מקומי) → Firestore REST API → market_data/latest
//    App (Netlify)   ← subscribeToMarketData() ← Firestore
// ═══════════════════════════════════════════════════════════════

import https from "https";
import fs    from "fs";
import path  from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT    = path.join(__dirname, "..", "public", "daily_scan.json");
const TODAY     = new Date().toISOString().slice(0, 10);
const NOW_ISO   = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Jerusalem" }).replace(" ", "T") + "+03:00";
const IS_THURSDAY = new Date().getDay() === 4;

// ── Firebase config (זהה ל-src/lib/firebase.js) ────────────────
const FIREBASE = {
  projectId: "finnsi-3a75d",
  apiKey:    "AIzaSyBy7Rwwng-vpgE9Vjg3U0WgBgXOTZQFsv4",
};
const GOOGLE_API = 'https://firestore.googleapis.com/v1';
const FIRESTORE_BASE = `${GOOGLE_API}/projects/${FIREBASE.projectId}/databases/default/documents`;
// ══════════════════════════════════════════════════════════════
//  HTTP helpers
// ══════════════════════════════════════════════════════════════
function httpsRequest(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method:  options.method || "GET",
      headers: { "Content-Type": "application/json", "User-Agent": "HaMatzpan-Scanner/2.4.1", ...(options.headers || {}) },
      timeout: options.timeout || 10000,
    }, res => {
      let data = "";
      res.on("data", c => (data += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function yahooPrice(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
  try {
    const { body } = await httpsRequest(url);
    const meta = body?.chart?.result?.[0]?.meta;
    if (meta?.regularMarketPrice != null) {
      const prev = meta.chartPreviousClose ?? meta.previousClose ?? null;
      const cur  = parseFloat(meta.regularMarketPrice.toFixed(4));
      const chg  = prev ? parseFloat(((cur - prev) / prev * 100).toFixed(2)) : null;
      return { price: cur, changePct: chg, currency: meta.currency || "USD", source: "Yahoo Finance" };
    }
  } catch {}
  return { price: null, changePct: null, currency: null, source: "unavailable" };
}

async function yahooDividend(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1mo&events=div`;
  try {
    const { body } = await httpsRequest(url);
    const divs = body?.chart?.result?.[0]?.events?.dividends;
    if (divs) {
      const latest = Object.values(divs).sort((a, b) => b.date - a.date)[0];
      if (latest) {
        const exDate  = new Date(latest.date * 1000).toISOString().slice(0, 10);
        const payDate = new Date((latest.date + 86400) * 1000).toISOString().slice(0, 10);
        return { amount: +latest.amount.toFixed(4), exDate, payDate, status: "confirmed", source: "Yahoo Finance" };
      }
    }
  } catch {}
  return null;
}

// ══════════════════════════════════════════════════════════════
//  Firestore REST API — ממיר JS object לפורמט wire
// ══════════════════════════════════════════════════════════════
function toFsValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === "boolean")          return { booleanValue: val };
  if (typeof val === "number") {
    return Number.isInteger(val)
      ? { integerValue: String(val) }
      : { doubleValue: val };
  }
  if (typeof val === "string")  return { stringValue: val };
  if (Array.isArray(val))       return { arrayValue: { values: val.map(toFsValue) } };
  if (typeof val === "object") {
    const fields = {};
    for (const [k, v] of Object.entries(val)) fields[k] = toFsValue(v);
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function toFsDoc(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) fields[k] = toFsValue(v);
  return { fields };
}

async function writeToFirestore(payload) {
  const url = `${FIRESTORE_BASE}/market_data/latest?key=${FIREBASE.apiKey}`;
  try {
    const { status, body } = await httpsRequest(url, { method: "PATCH" }, toFsDoc(payload));
    if (status === 200) {
      console.log("  ✅ Firestore market_data/latest עודכן");
      return true;
    } else {
      console.warn(`  ⚠ Firestore שגיאה ${status}:`, body?.error?.message || JSON.stringify(body).slice(0, 120));
      return false;
    }
  } catch (e) {
    console.warn("  ⚠ Firestore כתיבה נכשלה:", e.message);
    return false;
  }
}

// ══════════════════════════════════════════════════════════════
//  Main
// ══════════════════════════════════════════════════════════════
(async () => {
  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║  HaMatzpan Daily Scanner  V2.4.1            ║");
  console.log(`║  ${new Date().toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })}                    ║`);
  console.log("╚══════════════════════════════════════════════╝\n");

  const warnings = [];

  // ── שלב 1: מחירים חיים ──────────────────────────────────────
  console.log("📡 שולף מחירים מ-Yahoo Finance...");
  const [msty, mstr, ibit, fx, sp500, nasdaq] = await Promise.all([
    yahooPrice("MSTY"),
    yahooPrice("MSTR"),
    yahooPrice("IBIT"),
    yahooPrice("ILS=X"),
    yahooPrice("1183441.TA"),
    yahooPrice("1159243.TA"),
  ]);

  console.log(`  MSTY   ${msty.price  != null ? `$${msty.price} (${msty.changePct >= 0 ? "+" : ""}${msty.changePct}%)` : "לא זמין"}`);
  console.log(`  MSTR   ${mstr.price  != null ? `$${mstr.price} (${mstr.changePct >= 0 ? "+" : ""}${mstr.changePct}%)` : "לא זמין"}`);
  console.log(`  IBIT   ${ibit.price  != null ? `$${ibit.price}` : "לא זמין"}`);
  console.log(`  FX     ${fx.price    != null ? `₪${fx.price}` : "לא זמין"}`);
  console.log(`  SP500  ${sp500.price != null ? `₪${sp500.price}` : "לא זמין"} (1183441.TA)`);
  console.log(`  NASDAQ ${nasdaq.price!= null ? `₪${nasdaq.price}` : "לא זמין"} (1159243.TA)`);

  if (!msty.price)   warnings.push("MSTY price: לא נמשך מ-Yahoo Finance");
  if (!mstr.price)   warnings.push("MSTR price: לא נמשך מ-Yahoo Finance");
  if (!fx.price)     warnings.push("USD/ILS: לא נמשך מ-Yahoo Finance");
  if (!sp500.price)  warnings.push("SP500 (.TA): לא נמשך מ-Yahoo Finance");
  if (!nasdaq.price) warnings.push("Nasdaq (.TA): לא נמשך מ-Yahoo Finance");

  // ── שלב 2: דיבידנד MSTY (יום חמישי) ─────────────────────────
  let nextDividend = null;
  if (IS_THURSDAY) {
    console.log("\n📅 יום חמישי — בודק דיבידנד MSTY...");
    nextDividend = await yahooDividend("MSTY");
    if (nextDividend) {
      console.log(`  ✅ דיבידנד: $${nextDividend.amount} · ex: ${nextDividend.exDate} · pay: ${nextDividend.payDate}`);
    } else {
      console.log("  ⚠ דיבידנד לא נמצא — null");
      warnings.push("MSTY dividend: לא נמצא ביום חמישי — בדוק yieldmaxetfs.com/our-etfs/msty/ ידנית");
    }
  } else {
    // קרא דיבידנד אחרון מהקובץ הקיים
    try {
      const prev = JSON.parse(fs.readFileSync(OUTPUT, "utf-8"));
      nextDividend = prev?.msty?.nextDividend ?? null;
      if (nextDividend) console.log(`\n  📋 דיבידנד נשמר מסריקה קודמת: $${nextDividend.amount}`);
    } catch {}
    if (!nextDividend) {
      nextDividend = { amount: null, exDate: null, payDate: null, status: "estimate" };
    }
  }

  // ── שלב 3: קרנות פנסיה / השתלמות ────────────────────────────
  // gemelnet.co.il דורש auth — נתונים אלה יכנסו ידנית מה-PDF uploader
  console.log("\n📋 נתוני פנסיה: יש לעדכן ידנית מ-gemelnet.co.il (דורש auth)");
  warnings.push("pension/studyFunds: gemelnet.co.il דורש login — השתמש ב-PDF uploader של המצפן לעדכון ידני");

  // ── שלב 4: בנה payload ───────────────────────────────────────
  const payload = {
    timestamp:   NOW_ISO,
    date:        TODAY,
    status:      "ok",
    version:     1,
    scannedBy:   "node-scanner-v2.4.1",
    msty: {
      price:       msty.price,
      changePct:   msty.changePct,
      priceSource: msty.source,
      nextDividend,
    },
    mstr: {
      price:       mstr.price,
      changePct:   mstr.changePct,
      priceSource: mstr.source,
    },
    ibit: {
      price:       ibit.price,
      changePct:   ibit.changePct,
      priceSource: ibit.source,
      currency:    "USD",
    },
    sp500: {
      price:       sp500.price,
      changePct:   sp500.changePct,
      priceSource: sp500.source,
      paperCode:   "01183441",
    },
    nasdaq: {
      price:       nasdaq.price,
      changePct:   nasdaq.changePct,
      priceSource: nasdaq.source,
      paperCode:   "01159243",
    },
    fx:          { usdIls: fx.price, changePct: fx.changePct, source: fx.source },
    pension:     { menora168: { monthlyReturn: null, ytd: null, asOf: TODAY } },
    studyFunds:  { meitav13245: { monthlyReturn: null, ytd: null, asOf: TODAY } },
    news:        [],
    warnings,
  };

  // ── שלב 5: כתוב ל-Firestore ──────────────────────────────────
  console.log("\n🔥 כותב ל-Firestore market_data/latest...");
  const fsOk = await writeToFirestore(payload);

  // ── שלב 6: כתוב JSON backup (גיבוי מקומי) ───────────────────
  try {
    fs.writeFileSync(OUTPUT, JSON.stringify(payload, null, 2), "utf-8");
    console.log(`  💾 JSON backup: ${OUTPUT}`);
  } catch (e) {
    console.warn("  ⚠ לא ניתן לכתוב JSON:", e.message);
  }

  // ── סיכום ────────────────────────────────────────────────────
  console.log("\n── סיכום ─────────────────────────────────────────────────");
  console.log(`  Firestore: ${fsOk ? "✅ עודכן" : "❌ נכשל (JSON בלבד)"}`);
  console.log(`  MSTY:  ${msty.price  != null ? `$${msty.price}` : "N/A"}`);
  console.log(`  MSTR:  ${mstr.price  != null ? `$${mstr.price}` : "N/A"}`);
  console.log(`  IBIT:  ${ibit.price  != null ? `$${ibit.price}` : "N/A"}`);
  console.log(`  FX:    ${fx.price    != null ? `₪${fx.price}/דולר` : "N/A"}`);
  console.log(`  SP500: ${sp500.price != null ? `₪${sp500.price}` : "N/A"}`);
  console.log(`  NASDAQ:${nasdaq.price!= null ? `₪${nasdaq.price}` : "N/A"}`);
  if (nextDividend?.amount) {
    console.log(`  דיבידנד MSTY: $${nextDividend.amount} (${nextDividend.status}) · ex: ${nextDividend.exDate}`);
  }
  if (warnings.length) {
    console.log("\n── אזהרות ───────────────────────────────────────────────");
    warnings.forEach(w => console.log(`  ⚠ ${w}`));
  }
  console.log("\n══════════════════════════════════════════════════════════\n");
})();
