#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
//  HaMatzpan · Daily Scanner  –  V2.5.0
//  Node.js standalone — ללא CORS, כותב ל-Firestore + JSON backup
//  הרצה: node scripts/daily-scanner.js
//         או: run-scanner.bat
//
//  V2.5.0 — Historical Memory + Daily Change + Scanner Status
//    • כותב ל-market_history/{YYYY-MM-DD} — זיכרון היסטורי
//    • מחשב dailyChangePercent לכל נכס לעומת אתמול
//    • מעדכן scanner_status/latest עם lastRun + status + summary
//
//  ארכיטקטורה:
//    Scanner (מקומי) → Firestore REST API → market_data/latest
//                                         → market_history/{date}
//                                         → scanner_status/latest
//    App (Netlify)   ← subscribeToMarketData() ← Firestore
// ═══════════════════════════════════════════════════════════════

import https from "https";
import fs    from "fs";
import path  from "path";
import { fileURLToPath } from "url";

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT      = path.join(__dirname, "..", "public", "daily_scan.json");
const TODAY       = new Date().toISOString().slice(0, 10);
const YESTERDAY   = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const NOW_ISO     = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Jerusalem" }).replace(" ", "T") + "+03:00";
const IS_THURSDAY = new Date().getDay() === 4;

// ── Firebase config (זהה ל-src/lib/firebase.js) ────────────────
const FIREBASE = {
  projectId: "finnsi-3a75d",
  apiKey:    "AIzaSyBy7Rwwng-vpgE9Vjg3U0WgBgXOTZQFsv4",
};
const GOOGLE_API      = "https://firestore.googleapis.com/v1";
const FIRESTORE_BASE  = `${GOOGLE_API}/projects/${FIREBASE.projectId}/databases/default/documents`;

// ══════════════════════════════════════════════════════════════
//  HTTP helpers
// ══════════════════════════════════════════════════════════════
function httpsRequest(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method:  options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        "User-Agent":   "HaMatzpan-Scanner/2.5.0",
        ...(options.headers || {}),
      },
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

/** Reads a single Firestore document. Returns JS object or null. */
async function readFromFirestore(collectionPath, docId) {
  const url = `${FIRESTORE_BASE}/${collectionPath}/${docId}?key=${FIREBASE.apiKey}`;
  try {
    const { status, body } = await httpsRequest(url);
    if (status === 200 && body?.fields) {
      // פענוח wire-format → JS
      const decode = (fsVal) => {
        if (fsVal.nullValue  !== undefined) return null;
        if (fsVal.booleanValue !== undefined) return fsVal.booleanValue;
        if (fsVal.integerValue !== undefined) return Number(fsVal.integerValue);
        if (fsVal.doubleValue  !== undefined) return fsVal.doubleValue;
        if (fsVal.stringValue  !== undefined) return fsVal.stringValue;
        if (fsVal.arrayValue)  return (fsVal.arrayValue.values || []).map(decode);
        if (fsVal.mapValue) {
          const result = {};
          for (const [k, v] of Object.entries(fsVal.mapValue.fields || {})) result[k] = decode(v);
          return result;
        }
        return null;
      };
      const result = {};
      for (const [k, v] of Object.entries(body.fields)) result[k] = decode(v);
      return result;
    }
  } catch {}
  return null;
}

/** כותב payload ל-market_data/latest */
async function writeToFirestore(payload) {
  const url = `${FIRESTORE_BASE}/market_data/latest?key=${FIREBASE.apiKey}`;
  try {
    const { status, body } = await httpsRequest(url, { method: "PATCH" }, toFsDoc(payload));
    if (status === 200) {
      console.log("  ✅ Firestore market_data/latest עודכן");
      return true;
    }
    console.warn(`  ⚠ Firestore שגיאה ${status}:`, body?.error?.message || JSON.stringify(body).slice(0, 120));
    return false;
  } catch (e) {
    console.warn("  ⚠ Firestore כתיבה נכשלה:", e.message);
    return false;
  }
}

/** V2.5.0 — כותב snapshot יומי ל-market_history/{date} */
async function writeToFirestoreHistory(date, payload) {
  const url = `${FIRESTORE_BASE}/market_history/${date}?key=${FIREBASE.apiKey}`;
  try {
    // שמור רק שדות מחיר (חסוך storage — ללא news/pension)
    const slim = {
      date,
      timestamp: payload.timestamp,
      msty:   { price: payload.msty?.price,   changePct: payload.msty?.changePct },
      mstr:   { price: payload.mstr?.price,   changePct: payload.mstr?.changePct },
      ibit:   { price: payload.ibit?.price,   changePct: payload.ibit?.changePct },
      fx:     { usdIls: payload.fx?.usdIls,   changePct: payload.fx?.changePct  },
      sp500:  { price: payload.sp500?.price,  changePct: payload.sp500?.changePct },
      nasdaq: { price: payload.nasdaq?.price, changePct: payload.nasdaq?.changePct },
    };
    const { status, body } = await httpsRequest(url, { method: "PATCH" }, toFsDoc(slim));
    if (status === 200) {
      console.log(`  ✅ Firestore market_history/${date} נשמר`);
      return true;
    }
    console.warn(`  ⚠ history שגיאה ${status}:`, body?.error?.message || "");
    return false;
  } catch (e) {
    console.warn("  ⚠ history כתיבה נכשלה:", e.message);
    return false;
  }
}

/** V2.5.0 — מעדכן scanner_status/latest עם סטטוס + משפט סיכום */
async function writeScannerStatus(status, summary, details = {}) {
  const url = `${FIRESTORE_BASE}/scanner_status/latest?key=${FIREBASE.apiKey}`;
  const doc = {
    lastRun: NOW_ISO,
    date:    TODAY,
    status,            // "success" | "partial" | "error"
    summary,           // משפט קצר בעברית
    ...details,
  };
  try {
    const { status: httpStatus, body } = await httpsRequest(url, { method: "PATCH" }, toFsDoc(doc));
    if (httpStatus === 200) {
      console.log("  ✅ Firestore scanner_status/latest עודכן");
      return true;
    }
    console.warn(`  ⚠ scanner_status שגיאה ${httpStatus}:`, body?.error?.message || "");
    return false;
  } catch (e) {
    console.warn("  ⚠ scanner_status כתיבה נכשלה:", e.message);
    return false;
  }
}

/** V2.5.0 — מחשב שינוי יומי לנכס ביחס למחיר אתמול */
function calcDailyChange(todayPrice, yesterdayPrice) {
  if (todayPrice == null || yesterdayPrice == null || yesterdayPrice === 0) return null;
  return parseFloat(((todayPrice - yesterdayPrice) / yesterdayPrice * 100).toFixed(2));
}

/** V2.5.0 — בונה משפט סיכום יומי בעברית */
function buildSummary(msty, mstr, fx, sp500) {
  const parts = [];

  if (fx?.dailyChangePct != null) {
    parts.push(fx.dailyChangePct < 0
      ? `הדולר נחלש ב-${Math.abs(fx.dailyChangePct).toFixed(2)}%`
      : `הדולר התחזק ב-${fx.dailyChangePct.toFixed(2)}%`);
  }
  if (msty?.price != null) {
    const chg = msty.changePct ?? msty.dailyChangePct;
    if (chg != null) {
      parts.push(chg >= 0
        ? `MSTY עלה ב-${Math.abs(chg).toFixed(2)}%`
        : `MSTY ירד ב-${Math.abs(chg).toFixed(2)}%`);
    }
  }
  if (mstr?.price != null) {
    const chg = mstr.changePct ?? mstr.dailyChangePct;
    if (chg != null) {
      parts.push(chg >= 0
        ? `MSTR בעלייה של ${Math.abs(chg).toFixed(2)}%`
        : `MSTR בירידה של ${Math.abs(chg).toFixed(2)}%`);
    }
  }
  if (sp500?.price != null && sp500?.dailyChangePct != null) {
    parts.push(sp500.dailyChangePct >= 0
      ? `S&P500 ת"א בירוק`
      : `S&P500 ת"א באדום`);
  }

  if (!parts.length) return "הסריקה הושלמה — אין נתוני שוק זמינים כרגע";
  return parts.join(" · ");
}

// ══════════════════════════════════════════════════════════════
//  Main
// ══════════════════════════════════════════════════════════════
(async () => {
  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║  HaMatzpan Daily Scanner  V2.5.0            ║");
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
    try {
      const prev = JSON.parse(fs.readFileSync(OUTPUT, "utf-8"));
      nextDividend = prev?.msty?.nextDividend ?? null;
      if (nextDividend) console.log(`\n  📋 דיבידנד נשמר מסריקה קודמת: $${nextDividend.amount}`);
    } catch {}
    if (!nextDividend) {
      nextDividend = { amount: null, exDate: null, payDate: null, status: "estimate" };
    }
  }

  // ── שלב 3: V2.5.0 — שליפת נתוני אתמול לחישוב שינוי יומי ─────
  console.log(`\n📊 V2.5.0 — שולף היסטוריה (${YESTERDAY})...`);
  const yesterday = await readFromFirestore("market_history", YESTERDAY);
  if (yesterday) {
    console.log("  ✅ נתוני אתמול נטענו מ-Firestore");
  } else {
    console.log("  ℹ נתוני אתמול לא זמינים (ראשון פעם, או יום ראשון)");
  }

  // ── חישוב dailyChangePct לעומת אתמול ──────────────────────────
  const yMSTY   = yesterday?.msty?.price;
  const yMSTR   = yesterday?.mstr?.price;
  const yIBIT   = yesterday?.ibit?.price;
  const yFX     = yesterday?.fx?.usdIls;
  const ySP500  = yesterday?.sp500?.price;
  const yNASDAQ = yesterday?.nasdaq?.price;

  const mstyDailyChg   = calcDailyChange(msty.price,   yMSTY)   ?? msty.changePct;
  const mstrDailyChg   = calcDailyChange(mstr.price,   yMSTR)   ?? mstr.changePct;
  const ibitDailyChg   = calcDailyChange(ibit.price,   yIBIT)   ?? ibit.changePct;
  const fxDailyChg     = calcDailyChange(fx.price,     yFX)     ?? fx.changePct;
  const sp500DailyChg  = calcDailyChange(sp500.price,  ySP500)  ?? sp500.changePct;
  const nasdaqDailyChg = calcDailyChange(nasdaq.price, yNASDAQ) ?? nasdaq.changePct;

  if (yesterday) {
    console.log(`  MSTY   שינוי יומי: ${mstyDailyChg != null ? `${mstyDailyChg >= 0 ? "+" : ""}${mstyDailyChg}%` : "N/A"}`);
    console.log(`  MSTR   שינוי יומי: ${mstrDailyChg != null ? `${mstrDailyChg >= 0 ? "+" : ""}${mstrDailyChg}%` : "N/A"}`);
    console.log(`  FX     שינוי יומי: ${fxDailyChg   != null ? `${fxDailyChg   >= 0 ? "+" : ""}${fxDailyChg}%`   : "N/A"}`);
  }

  // ── שלב 4: קרנות פנסיה / השתלמות ────────────────────────────
  console.log("\n📋 נתוני פנסיה: יש לעדכן ידנית מ-gemelnet.co.il (דורש auth)");
  warnings.push("pension/studyFunds: gemelnet.co.il דורש login — השתמש ב-PDF uploader של המצפן לעדכון ידני");

  // ── שלב 5: בנה payload ───────────────────────────────────────
  const payload = {
    timestamp:   NOW_ISO,
    date:        TODAY,
    status:      "ok",
    version:     1,
    scannedBy:   "node-scanner-v2.5.0",
    msty: {
      price:          msty.price,
      changePct:      msty.changePct,
      dailyChangePct: mstyDailyChg,
      priceSource:    msty.source,
      nextDividend,
    },
    mstr: {
      price:          mstr.price,
      changePct:      mstr.changePct,
      dailyChangePct: mstrDailyChg,
      priceSource:    mstr.source,
    },
    ibit: {
      price:          ibit.price,
      changePct:      ibit.changePct,
      dailyChangePct: ibitDailyChg,
      priceSource:    ibit.source,
      currency:       "USD",
    },
    sp500: {
      price:          sp500.price,
      changePct:      sp500.changePct,
      dailyChangePct: sp500DailyChg,
      priceSource:    sp500.source,
      paperCode:      "01183441",
    },
    nasdaq: {
      price:          nasdaq.price,
      changePct:      nasdaq.changePct,
      dailyChangePct: nasdaqDailyChg,
      priceSource:    nasdaq.source,
      paperCode:      "01159243",
    },
    fx: {
      usdIls:         fx.price,
      changePct:      fx.changePct,
      dailyChangePct: fxDailyChg,
      source:         fx.source,
    },
    pension:     { menora168: { monthlyReturn: null, ytd: null, asOf: TODAY } },
    studyFunds:  { meitav13245: { monthlyReturn: null, ytd: null, asOf: TODAY } },
    news:        [],
    warnings,
  };

  // ── שלב 6: כתוב ל-Firestore market_data/latest ───────────────
  console.log("\n🔥 כותב ל-Firestore market_data/latest...");
  const fsOk = await writeToFirestore(payload);

  // ── שלב 7: V2.5.0 — כתוב היסטוריה ל-market_history/{date} ──
  console.log(`\n📚 V2.5.0 — כותב היסטוריה ל-market_history/${TODAY}...`);
  await writeToFirestoreHistory(TODAY, payload);

  // ── שלב 8: V2.5.0 — עדכן scanner_status ─────────────────────
  console.log("\n🚦 V2.5.0 — מעדכן scanner_status/latest...");
  const anyPrice = msty.price || mstr.price || fx.price;
  const scanStatus = anyPrice ? "success" : "partial";
  const summary = buildSummary(
    { ...msty, dailyChangePct: mstyDailyChg },
    { ...mstr, dailyChangePct: mstrDailyChg },
    { price: fx.price, dailyChangePct: fxDailyChg },
    { price: sp500.price, dailyChangePct: sp500DailyChg }
  );
  await writeScannerStatus(scanStatus, summary, {
    mstyPrice:  msty.price,
    mstrPrice:  mstr.price,
    usdIls:     fx.price,
    mstyChange: mstyDailyChg,
    mstrChange: mstrDailyChg,
    fxChange:   fxDailyChg,
  });
  console.log(`  📝 סיכום: "${summary}"`);

  // ── שלב 9: כתוב JSON backup (גיבוי מקומי) ───────────────────
  try {
    fs.writeFileSync(OUTPUT, JSON.stringify(payload, null, 2), "utf-8");
    console.log(`\n  💾 JSON backup: ${OUTPUT}`);
  } catch (e) {
    console.warn("  ⚠ לא ניתן לכתוב JSON:", e.message);
  }

  // ── סיכום ────────────────────────────────────────────────────
  console.log("\n── סיכום V2.5.0 ─────────────────────────────────────────");
  console.log(`  Firestore latest:  ${fsOk ? "✅ עודכן" : "❌ נכשל (JSON בלבד)"}`);
  console.log(`  MSTY:  ${msty.price  != null ? `$${msty.price}  (יומי: ${mstyDailyChg != null ? (mstyDailyChg >= 0 ? "+" : "") + mstyDailyChg + "%" : "N/A"})` : "N/A"}`);
  console.log(`  MSTR:  ${mstr.price  != null ? `$${mstr.price}  (יומי: ${mstrDailyChg != null ? (mstrDailyChg >= 0 ? "+" : "") + mstrDailyChg + "%" : "N/A"})` : "N/A"}`);
  console.log(`  IBIT:  ${ibit.price  != null ? `$${ibit.price}` : "N/A"}`);
  console.log(`  FX:    ${fx.price    != null ? `₪${fx.price}/$ (יומי: ${fxDailyChg != null ? (fxDailyChg >= 0 ? "+" : "") + fxDailyChg + "%" : "N/A"})` : "N/A"}`);
  console.log(`  SP500: ${sp500.price != null ? `₪${sp500.price}` : "N/A"}`);
  console.log(`  NASDAQ:${nasdaq.price!= null ? `₪${nasdaq.price}` : "N/A"}`);
  if (nextDividend?.amount) {
    console.log(`  דיבידנד MSTY: $${nextDividend.amount} (${nextDividend.status}) · ex: ${nextDividend.exDate}`);
  }
  console.log(`  סטטוס: ${scanStatus} · "${summary}"`);
  if (warnings.length) {
    console.log("\n── אזהרות ───────────────────────────────────────────────");
    warnings.forEach(w => console.log(`  ⚠ ${w}`));
  }
  console.log("\n══════════════════════════════════════════════════════════\n");
})();
