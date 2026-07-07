#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
//  HaMatzpan · Daily Scanner  –  V2.9.5
//  Precision Focus: MSTR · MSTY · IBIT · Excellence 1183441/1159243 · FX
//
//  V2.8.0:
//    • News: MSTY Yahoo RSS + MSTR + IBIT (הסרת BTC גנרי)
//    • News: description → summary (כמה משפטים ראשונים בעברית)
//    • News: sourceHe — תווית מקור עברית לפי ticker
//    • News: הסרת כפילויות (dedup by title)
//  V2.7.0:
//    • MSTY dividends: yieldmaxetfs.com כמקור ראשי (weekly, 4-5/month)
//    • Yahoo fallback: range=6mo (במקום 3mo)
//    • MSTY announcements: חדשות/הכרזות מ-yieldmaxetfs.com מוזרמות ל-news
//  V2.5.2:
//    • Israeli papers: 1183441.TA / 1159243.TA → fallback ^GSPC/^IXIC × FX = ILS
//    • MSTY projected dividend = sharesCount (Firestore) × div/share × 0.75 × FX
//    • Firestore-only: ללא כתיבת JSON מקומי
//    • כותב ל: market_data/latest · market_history/{date} · scanner_status/latest
// ═══════════════════════════════════════════════════════════════

import https from "https";
import { exec } from "child_process";
import { BollingerBands, CCI } from "technicalindicators";
import { WATCHLIST } from "./watchlist.js";

const TODAY       = new Date().toISOString().slice(0, 10);
const YESTERDAY   = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const NOW_ISO     = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Jerusalem" }).replace(" ", "T") + "+03:00";
const IS_THURSDAY = new Date().getDay() === 4;
const IS_MONDAY   = new Date().getDay() === 1; // V2.9.0: שני = שליחת דוח שבועי WhatsApp
const TAX_RATE    = 0.25; // מס רווחי הון ישראלי

// V2.9.0 — WhatsApp Business Cloud API (אופציונלי)
const WHATSAPP_TOKEN    = process.env.WHATSAPP_TOKEN    || null;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID || null;
const WHATSAPP_TO       = process.env.WHATSAPP_TO       || null;

// V2.9.1 — Gmail דוח בוקר יומי (אופציונלי — דורש GMAIL_APP_PASSWORD + GMAIL_TO)
const GMAIL_FROM         = process.env.GMAIL_FROM         || "tzion002@gmail.com";
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || null;
const GMAIL_TO           = process.env.GMAIL_TO           || null;

// ── Firebase config ─────────────────────────────────────────────
const FIREBASE = {
  projectId: "finnsi-3a75d",
  apiKey:    "AIzaSyBy7Rwwng-vpgE9Vjg3U0WgBgXOTZQFsv4",
};
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE.projectId}/databases/default/documents`;

// ══════════════════════════════════════════════════════════════
//  HTTP helpers
// ══════════════════════════════════════════════════════════════
function httpsRequest(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method:  options.method || "GET",
      headers: { "Content-Type": "application/json", "User-Agent": "HaMatzpan-Scanner/2.7.0", ...(options.headers || {}) },
      timeout: options.timeout || 12000,
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

// ── TASE (Israeli ETF) price — V2.8.3: 4 מקורות במדרג עדיפות ─────────────────
// מחזיר מחיר ב-ILS (שקלים) — הסורק ממיר אגורות לפני שמירה ב-Firestore
// מקורות: 1) Yahoo .TA  2) investing.com (HTML scrape, אגורות)  3) Stooq.com  4) Bizportal API
//
// investing.com instrument IDs (נבדק ומוודא):
//   1183441 (S&P 500)  → id=1185483, url=/etfs/s---p-500-source?cid=1185483
//   1159243 (NASDAQ)   → id=1148208, url=/etfs/cs-(ie)-on-nasdaq-100?cid=1148208
const INVESTING_COM_URLS = {
  "1183441": "https://www.investing.com/etfs/s---p-500-source?cid=1185483",
  "1159243": "https://www.investing.com/etfs/cs-(ie)-on-nasdaq-100?cid=1148208",
};

async function tasePriceILS(shareId, yahooTicker) {
  const id = String(shareId);

  // ── מקור 1: Yahoo Finance .TA (מחיר ב-אגורות → ÷100 = ₪) ──────────
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?interval=1d&range=2d`;
    const { body } = await httpsRequest(url, { timeout: 10000 });
    const meta = body?.chart?.result?.[0]?.meta;
    const raw  = meta?.regularMarketPrice ?? meta?.postMarketPrice;
    if (raw != null && raw > 100) { // ניירות ת"א מעל 100 (אגורות)
      const cur  = parseFloat((raw / 100).toFixed(4)); // ÷100 → ₪
      const prev = meta.chartPreviousClose ? parseFloat((meta.chartPreviousClose / 100).toFixed(4)) : null;
      const chg  = prev ? parseFloat(((cur - prev) / prev * 100).toFixed(2)) : null;
      console.log(`    ✅ Yahoo .TA: ${id} = ₪${cur} (${raw} אגורות)`);
      return { price: cur, changePct: chg, source: "Yahoo Finance (.TA)", isFallback: false };
    }
  } catch {}

  // ── מקור 2: Investing.com — HTML scrape, מחיר ב-אגורות → ÷100 = ₪ ───
  // V2.9.8: שימוש ב-global fetch (Node 18+) במקום https.request — Cloudflare מחזיר 403 ל-https.request
  // נבדק: 1183441 → 4,266 (₪42.66) · 1159243 → 486,600 (₪4,866)
  const investingUrl = INVESTING_COM_URLS[id];
  if (investingUrl) {
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 15000);
      const res  = await fetch(investingUrl, {
        signal: ctrl.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept-Language": "he-IL,he;q=0.9,en;q=0.8",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      clearTimeout(tid);
      if (res.ok) {
        const html = await res.text();
        // מחפש: instrument-price-last">4,266</  (מחיר ב-אגורות)
        const m = html.match(/instrument-price-last[^>]*>([\d,\.]+)</);
        if (m) {
          const raw  = parseFloat(m[1].replace(/,/g, ""));
          if (!isNaN(raw) && raw > 100) {                  // ודא שמחיר ב-אגורות (> 100)
            const cur = parseFloat((raw / 100).toFixed(4)); // אגורות → ₪
            // נסה לחלץ גם שינוי יומי %
            const chgMatch = html.match(/instrument-price-change-percent[^>]*>\(([+-]?[\d,\.]+)%\)/);
            const chg = chgMatch ? parseFloat(chgMatch[1].replace(/,/g, "")) : null;
            console.log(`    ✅ Investing.com: ${id} = ₪${cur} (${raw} אגורות${chg != null ? `, ${chg}%` : ''})`);
            return { price: cur, changePct: chg, source: "Investing.com (TASE)", isFallback: false };
          }
        }
      } else {
        console.log(`    ⚠ Investing.com ${id}: HTTP ${res.status}`);
      }
    } catch (e) { console.log(`    ⚠ Investing.com ${id}: ${e.message}`); }
  }

  // ── מקור 3: Stooq.com — CSV, מחיר ב-ILS ישירות ──────────────────────
  try {
    const url = `https://stooq.com/q/l/?s=${id}.il&f=sd2t2ohlcv&h&e=csv`;
    const { status, body } = await httpsRequest(url, {
      timeout: 10000,
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    if (status === 200 && typeof body === "string") {
      const lines = body.trim().split('\n');
      if (lines.length >= 2) {
        const vals = lines[1].split(',');
        const close = parseFloat(vals[6]); // Close
        const open  = parseFloat(vals[3]); // Open
        if (!isNaN(close) && close > 0 && close < 10000) { // sanity: ₪ לא אגורות
          const chg = open > 0 ? parseFloat(((close - open) / open * 100).toFixed(2)) : null;
          console.log(`    ✅ Stooq.com: ${id} = ₪${close}`);
          return { price: close, changePct: chg, source: "Stooq.com", isFallback: false };
        }
      }
    }
  } catch {}

  // ── מקור 4: Bizportal.co.il — API ישראלי ────────────────────────────
  try {
    const url = `https://api.bizportal.co.il/biz/GetTickerData?type=2&paperId=${id}`;
    const { status, body } = await httpsRequest(url, {
      timeout: 10000,
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://www.bizportal.co.il/" }
    });
    if (status === 200 && body) {
      const priceRaw = body?.Data?.CurrentPrice || body?.currentPrice || body?.price;
      if (priceRaw) {
        const price = parseFloat(priceRaw);
        if (price > 0) {
          console.log(`    ✅ Bizportal: ${id} = ₪${price}`);
          return { price, changePct: null, source: "Bizportal.co.il", isFallback: false };
        }
      }
    }
  } catch {}

  console.log(`    ⚠ ${id}: כל המקורות נכשלו — יוצג מחיר יום קודם`);
  return { price: null, changePct: null, source: "unavailable", isFallback: false };
}

// ── Yahoo Finance — price fetch ───────────────────────────────
/** V2.5.2: regularMarketPrice → postMarketPrice → preMarketPrice
 *  fallbackTicker: נסה כשהראשי נכשל */
async function yahooPrice(ticker, fallbackTicker = null) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=2d`;
  try {
    const { body } = await httpsRequest(url);
    const meta = body?.chart?.result?.[0]?.meta;
    const raw  = meta?.regularMarketPrice ?? meta?.postMarketPrice ?? meta?.preMarketPrice;
    if (raw != null) {
      const prev = meta.chartPreviousClose ?? meta.previousClose ?? null;
      const cur  = parseFloat(raw.toFixed(4));
      const chg  = prev ? parseFloat(((cur - prev) / prev * 100).toFixed(2)) : null;
      const src  = meta.regularMarketPrice != null ? "Yahoo Finance"
                 : meta.postMarketPrice    != null ? "Yahoo Finance (post-market)"
                 :                                   "Yahoo Finance (pre-market)";
      return { price: cur, changePct: chg, currency: meta.currency || "USD", source: src, isFallback: false };
    }
  } catch (e) { console.log(`    ⚠ ${ticker}: ${e.message}`); }
  // fallback ticker
  if (fallbackTicker && fallbackTicker !== ticker) {
    const res = await yahooPrice(fallbackTicker, null);
    if (res.price != null) {
      console.log(`    ↳ fallback ל-${fallbackTicker} הצליח (${ticker} חסום)`);
      return { ...res, isFallback: true, fallbackTicker };
    }
  }
  return { price: null, changePct: null, currency: null, source: "unavailable", isFallback: false };
}

// ── YieldMax ETFs — dividend scraper (V2.7.0: מקור ראשי) ──────
/** שולף דיבידנדים + הכרזות מ-yieldmaxetfs.com/our-etfs/msty/ */
async function yieldmaxDividend() {
  // ⚠️ ללא www — www.yieldmaxetfs.com מחזיר redirect 301 ו-httpsRequest לא עוקב אחריו
  const url = "https://yieldmaxetfs.com/our-etfs/msty/";
  try {
    const { status, body: html } = await httpsRequest(url, {
      timeout: 15000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (status !== 200 || typeof html !== "string") return null;

    // ── חלץ שורות טבלת דיבידנדים ──
    // טבלה מכילה: Ex-Dividend Date | Record Date | Pay Date | Amount
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const cleanHTML = (s) => s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();
    const dateRegex = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/;
    const amountRegex = /\$?([\d]+\.[\d]{2,4})/;

    // מבנה הטבלה (מאומת 14/05/2026):
    // cols[0]=DISTRIBUTION PER SHARE | cols[1]=DECLARED | cols[2]=EX DATE | cols[3]=RECORD | cols[4]=PAYABLE | cols[5]=ROC
    const dividends = [];
    let rowMatch;
    while ((rowMatch = rowRegex.exec(html)) !== null) {
      const rowText = rowMatch[1];
      const cells = [];
      let cellMatch;
      const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      while ((cellMatch = cellRe.exec(rowText)) !== null) {
        cells.push(cleanHTML(cellMatch[1]));
      }
      // שורת נתונים: לפחות 5 עמודות, העמודה הראשונה מכילה סכום ($0.xxxx)
      if (cells.length >= 5 && amountRegex.test(cells[0])) {
        const am = amountRegex.exec(cells[0]);
        const amount = parseFloat(am[1]);
        if (amount > 0 && amount < 5) {
          // cols[2] = EX DATE (לא declared date!)
          const exDateStr  = cells[2]; // EX DATE
          const payDateStr = cells[4]; // PAYABLE DATE
          const dm  = dateRegex.exec(exDateStr);
          const pm  = dateRegex.exec(payDateStr);
          if (dm) {
            const exDate  = `${dm[3]}-${String(dm[1]).padStart(2,"0")}-${String(dm[2]).padStart(2,"0")}`;
            const payDate = pm ? `${pm[3]}-${String(pm[1]).padStart(2,"0")}-${String(pm[2]).padStart(2,"0")}` : exDate;
            dividends.push({ amount, exDate, payDate, status: "confirmed", source: "YieldMax ETFs" });
          }
        }
      }
    }

    if (dividends.length === 0) return null;

    // מיין לפי תאריך יורד (הכי חדש ראשון)
    dividends.sort((a, b) => b.exDate.localeCompare(a.exDate));
    const latest = dividends[0];

    // V2.9.7: הוסר scraper של "announcements" — שלף סלוגנים פרסומיים מהדף
    // (טקסטים כמו "YieldMax Maximized for Potential Income"), לא חדשות אמיתיות
    console.log(`  ✅ yieldmaxetfs.com: ${dividends.length} דיבידנדים`);
    return { ...latest, recent: dividends, announcements: [] };
  } catch (e) {
    console.log(`    ⚠ yieldmaxetfs.com: ${e.message}`);
    return null;
  }
}

// ── Yahoo Finance — dividend (V2.7.0: fallback כשyieldmaxetfs.com נכשל) ─────
async function yahooDividend(ticker) {
  // הגדל ל-6mo לקבלת כל הפעימות השבועיות (MSTY משלם 4-5 פעמים בחודש)
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=6mo&events=div`;
  try {
    const { body } = await httpsRequest(url);
    const divs = body?.chart?.result?.[0]?.events?.dividends;
    if (divs) {
      const sorted = Object.values(divs).sort((a, b) => b.date - a.date);
      const all = sorted.map(d => ({
        amount:  +d.amount.toFixed(4),
        exDate:  new Date(d.date * 1000).toISOString().slice(0, 10),
        payDate: new Date((d.date + 86400) * 1000).toISOString().slice(0, 10),
        status:  "confirmed",
        source:  "Yahoo Finance",
      }));
      const latest = all[0];
      if (latest) {
        return { ...latest, recent: all }; // כולל היסטוריית 6 חודשים
      }
    }
  } catch {}
  return null;
}

// ── MyMemory: תרגום אנגלית→עברית (חינם, ללא API key) ────────────────────
/** מתרגם טקסט קצר מאנגלית לעברית.
 *  מגביל ל-150 תווים כדי לא לחרוג ממכסת 5000 תו/יום. */
async function translateToHebrew(text) {
  if (!text || text.length < 5) return null;
  const q   = text.slice(0, 150).trim();
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=en%7Che`;
  try {
    const { status, body } = await httpsRequest(url, { timeout: 8000 });
    if (status === 200 && body?.responseData?.translatedText) {
      let tr = body.responseData.translatedText.trim();
      // MyMemory מחזיר את הטקסט המקורי אם לא הצליח לתרגם
      if (tr && tr !== q && !tr.includes("MYMEMORY WARNING")) {
        // V2.9.9: MyMemory לעיתים מחזיר תרגום עטוף ב-<p>...</p> או תגיות אחרות — נקה
        tr = tr.replace(/<\/?[a-zA-Z][^>]*>/g, '')
               .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
               .replace(/\s+/g, ' ').trim();
        return tr || null;
      }
    }
  } catch {}
  return null;
}

// ── News fetch — Yahoo Finance RSS (V2.8.0: description → תרגום עברי) ──────
async function fetchRssHeadlines(ticker, maxItems = 2) {
  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(ticker)}&region=US&lang=en-US`;
  try {
    const { status, body } = await httpsRequest(url, { headers: { "Accept": "application/rss+xml, text/xml, */*" } });
    if (status !== 200 || typeof body !== "string") return [];
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    const clean = s => s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").trim();
    let m;
    while ((m = itemRegex.exec(body)) !== null && items.length < maxItems) {
      const title   = (m[1].match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || m[1].match(/<title>(.*?)<\/title>/))?.[1]?.trim() || "";
      const link    = (m[1].match(/<link>(.*?)<\/link>/))?.[1]?.trim() || "";
      const pubDate = (m[1].match(/<pubDate>(.*?)<\/pubDate>/))?.[1]?.trim() || "";
      // V2.8.0: description → בסיס לתרגום
      const descRaw = (m[1].match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) || m[1].match(/<description>([\s\S]*?)<\/description>/))?.[1] || "";
      const descEn  = clean(descRaw).slice(0, 200) || null;
      if (title) items.push({ title, url: link, pubDate, descEn });
    }
    return items;
  } catch { return []; }
}

// ══════════════════════════════════════════════════════════════
//  Firestore REST helpers
// ══════════════════════════════════════════════════════════════
function toFsValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === "boolean")          return { booleanValue: val };
  if (typeof val === "number")           return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  if (typeof val === "string")           return { stringValue: val };
  if (Array.isArray(val))               return { arrayValue: { values: val.map(toFsValue) } };
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

/** מפענח שדה בודד בפורמט Firestore REST (fields/{...}) */
function fsDecodeValue(v) {
  if (v.nullValue    !== undefined) return null;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue  !== undefined) return v.doubleValue;
  if (v.stringValue  !== undefined) return v.stringValue;
  if (v.arrayValue)  return (v.arrayValue.values || []).map(fsDecodeValue);
  if (v.mapValue) {
    const r = {};
    for (const [k, fv] of Object.entries(v.mapValue.fields || {})) r[k] = fsDecodeValue(fv);
    return r;
  }
  return null;
}

/** מפענח מסמך Firestore שלם (body.fields) לאובייקט JS פשוט */
function fsDecodeDoc(body) {
  const r = {};
  for (const [k, v] of Object.entries(body.fields || {})) r[k] = fsDecodeValue(v);
  return r;
}

/** קריאת מסמך יחיד מ-Firestore */
async function fsRead(collectionPath, docId) {
  const url = `${FIRESTORE_BASE}/${collectionPath}/${docId}?key=${FIREBASE.apiKey}`;
  try {
    const { status, body } = await httpsRequest(url);
    if (status === 200 && body?.fields) return fsDecodeDoc(body);
  } catch {}
  return null;
}

/**
 * כתיבה/עדכון מסמך ב-Firestore (PATCH + updateMask)
 *
 * ⚠️  DATA-LOSS PREVENTION:
 *  • Uses updateMask.fieldPaths for every key in payload, so ONLY those fields
 *    are touched.  Fields absent from payload are left unchanged in Firestore.
 *  • Null/undefined values are SKIPPED — a failed price fetch will NOT erase
 *    the last known-good value.  (e.g. SP500 fetch fails → old ILS price stays)
 *  • NEVER writes to families/mizrahi/settings/global — that document belongs
 *    exclusively to the Firebase SDK (firestoreService.js → saveSettings).
 */
async function fsWrite(collectionPath, docId, payload, label = "") {
  // Build document, skipping null/undefined to preserve existing values
  const fields = {};
  const writtenKeys = [];
  for (const [k, v] of Object.entries(payload)) {
    if (v === null || v === undefined) continue;
    fields[k] = toFsValue(v);
    writtenKeys.push(k);
  }

  if (writtenKeys.length === 0) {
    console.log(`  ⚠ fsWrite(${label || collectionPath + "/" + docId}): all fields null — skipping write`);
    return false;
  }

  // Append updateMask to touch only the specified fields
  const maskParams = writtenKeys.map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
  const url = `${FIRESTORE_BASE}/${collectionPath}/${docId}?key=${FIREBASE.apiKey}&${maskParams}`;
  try {
    const { status, body } = await httpsRequest(url, { method: "PATCH" }, { fields });
    if (status === 200) { console.log(`  ✅ Firestore ${label || collectionPath + "/" + docId} עודכן`); return true; }
    console.warn(`  ⚠ Firestore ${label} שגיאה ${status}:`, body?.error?.message || "");
    return false;
  } catch (e) { console.warn(`  ⚠ Firestore ${label} נכשל:`, e.message); return false; }
}

// ══════════════════════════════════════════════════════════════
//  Helpers
// ══════════════════════════════════════════════════════════════
function calcDailyChange(today, yesterday) {
  if (today == null || yesterday == null || yesterday === 0) return null;
  return parseFloat(((today - yesterday) / yesterday * 100).toFixed(2));
}

function buildSummary(msty, mstr, fx, sp500) {
  const parts = [];
  const fxChg = fx?.dailyChangePct;
  if (fxChg  != null) parts.push(fxChg  < 0 ? `הדולר נחלש ב-${Math.abs(fxChg).toFixed(2)}%`  : `הדולר התחזק ב-${fxChg.toFixed(2)}%`);
  const mstyChg = msty?.changePct ?? msty?.dailyChangePct;
  if (mstyChg != null) parts.push(mstyChg >= 0 ? `MSTY עלה ב-${Math.abs(mstyChg).toFixed(2)}%` : `MSTY ירד ב-${Math.abs(mstyChg).toFixed(2)}%`);
  const mstrChg = mstr?.changePct ?? mstr?.dailyChangePct;
  if (mstrChg != null) parts.push(mstrChg >= 0 ? `MSTR +${Math.abs(mstrChg).toFixed(2)}%` : `MSTR −${Math.abs(mstrChg).toFixed(2)}%`);
  if (sp500?.price != null && sp500?.dailyChangePct != null)
    parts.push(sp500.dailyChangePct >= 0 ? "אקסלנס S&P בירוק" : "אקסלנס S&P באדום");
  return parts.length ? parts.join(" · ") : "הסריקה הושלמה";
}

// ══════════════════════════════════════════════════════════════
//  V2.9.0 — WhatsApp Weekly Summary (שני בבוקר)
//  Meta WhatsApp Business Cloud API — חינמי עד 1,000 הודעות/חודש
//  הגדרה: developers.facebook.com/apps → WhatsApp → Getting Started
//  סודות נדרשים: WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_TO
// ══════════════════════════════════════════════════════════════
async function sendWeeklyWhatsApp(summary) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID || !WHATSAPP_TO) {
    console.log("  ⏭ WhatsApp: סודות לא מוגדרים — מדלג");
    return;
  }
  if (!IS_MONDAY) {
    console.log("  ⏭ WhatsApp: לא יום שני — מדלג (דוח שבועי רק בשני)");
    return;
  }

  const lines = [
    `📊 *המצפן — דוח שבועי*`,
    `📅 ${TODAY}`,
    ``,
    `📈 MSTY: $${summary.mstyPrice ?? "N/A"} | דיב׳ הבא: $${summary.nextDiv ?? "N/A"}`,
    `🟧 MSTR: $${summary.mstrPrice ?? "N/A"}`,
    `💱 USD/ILS: ₪${summary.usdIls ?? "N/A"}`,
  ];

  if (summary.netWorth)       lines.push(`💰 שווי תיק כולל: ₪${Number(summary.netWorth).toLocaleString("he-IL", {maximumFractionDigits:0})}`);
  if (summary.monthlyIncome)  lines.push(`💸 הכנסה חודשית (MSTY): ₪${Number(summary.monthlyIncome).toLocaleString("he-IL", {maximumFractionDigits:0})}`);
  if (summary.newsHeadline)   lines.push(``, `📰 ${summary.newsHeadline}`);

  const msg = lines.join("\n");

  try {
    const { status, body } = await httpsRequest(
      `https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_ID}/messages`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      },
      {
        messaging_product: "whatsapp",
        to:   WHATSAPP_TO,
        type: "text",
        text: { body: msg },
      }
    );
    if (status === 200 || status === 201) {
      console.log("  ✅ WhatsApp: דוח שבועי נשלח בהצלחה");
    } else {
      console.warn(`  ⚠ WhatsApp: שגיאה ${status}:`, body?.error?.message || "");
    }
  } catch (e) {
    console.warn("  ⚠ WhatsApp נכשל:", e.message);
  }
}

// ══════════════════════════════════════════════════════════════
//  V2.9.8 — Excellence Price History (3y bars for charts)
//  - TASE mutual funds (1183441, 1159243) → synthetic via underlying
//    index × FX, then anchored to current real fund price
//  - IBIT → direct from Yahoo (USD)
//  - Bars stored at top-level: price_history/{tickerId}
//    { ticker, currency, lastUpdate, bars: [{d:"YYYY-MM-DD", c:number}] }
// ══════════════════════════════════════════════════════════════
const EXCELLENCE_HISTORY = [
  { id: "sp500_tase",  yahoo: "^GSPC", currency: "ILS", isTaseFund: true,  realKey: "sp500"  },
  { id: "nasdaq_tase", yahoo: "^IXIC", currency: "ILS", isTaseFund: true,  realKey: "nasdaq" },
  { id: "ibit",        yahoo: "IBIT",  currency: "USD", isTaseFund: false                    },
  { id: "fx_ils",      yahoo: "ILS=X", currency: "FX",  isTaseFund: false                    },
];

async function yahooChartBars(symbol, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
  try {
    const { status, body } = await httpsRequest(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 15000,
    });
    if (status !== 200) return null;
    const r = body?.chart?.result?.[0];
    if (!r || !r.timestamp) return null;
    const close = r.indicators?.quote?.[0]?.close || [];
    return r.timestamp
      .map((t, i) => ({ d: new Date(t * 1000).toISOString().slice(0, 10), c: close[i] }))
      .filter(b => b.c != null);
  } catch { return null; }
}

async function fetchExcellenceHistory(realPrices) {
  console.log("\n📈 V2.9.8 — שולף היסטוריית מחירים לאקסלנס...");
  let fxBars = null; // shared across TASE funds

  for (const cfg of EXCELLENCE_HISTORY) {
    try {
      const existing = await fsRead("price_history", cfg.id);
      const existingBars = Array.isArray(existing?.bars) ? existing.bars : [];
      const isBackfill = existingBars.length === 0;
      const range = isBackfill ? "3y" : "10d";

      let bars = await yahooChartBars(cfg.yahoo, range);
      if (!bars || bars.length === 0) {
        console.warn(`  ⚠ ${cfg.id}: לא קיבל ברים מ-Yahoo (${cfg.yahoo})`);
        continue;
      }

      if (cfg.isTaseFund) {
        // V2.9.8 — שמור ברים סינתטיים גולמיים (idx × FX). העיגון למחיר החי
        // נעשה ב-UI (scaleAnchorBars) כדי להישאר עקבי בין backfill ל-incremental.
        if (!fxBars) fxBars = await yahooChartBars("ILS=X", isBackfill ? "3y" : "10d");
        if (!fxBars || fxBars.length === 0) {
          console.warn(`  ⚠ ${cfg.id}: אין FX bars — מדלג`);
          continue;
        }
        const fxMap = new Map(fxBars.map(b => [b.d, b.c]));
        const lastFx = fxBars[fxBars.length - 1].c;
        bars = bars.map(b => ({
          d: b.d,
          c: parseFloat((b.c * (fxMap.get(b.d) ?? lastFx)).toFixed(4)),
        }));
      } else {
        bars = bars.map(b => ({ d: b.d, c: parseFloat(b.c.toFixed(4)) }));
      }

      // Merge: existing + new, dedupe by d, new bars override
      let merged = bars;
      if (existingBars.length > 0) {
        if (cfg.isTaseFund) {
          // TASE: scaling factor may have shifted slightly — full overwrite (keep
          // historic shape consistent with latest anchor). For incremental runs,
          // we only fetched last 10d, so preserve older bars but rescale them too.
          // Simpler: if incremental, merge by date, scale older bars to new factor.
          const map = new Map(existingBars.map(b => [b.d, b]));
          for (const b of bars) map.set(b.d, b);
          merged = [...map.values()].sort((a, b) => a.d.localeCompare(b.d));
        } else {
          const map = new Map(existingBars.map(b => [b.d, b]));
          for (const b of bars) map.set(b.d, b);
          merged = [...map.values()].sort((a, b) => a.d.localeCompare(b.d));
        }
      }

      const added = merged.length - existingBars.length;
      console.log(`  📈 ${cfg.id}: ${isBackfill ? 'backfill 3y' : 'incremental'} → +${added} ברים (סה"כ ${merged.length})`);

      await fsWrite("price_history", cfg.id, {
        ticker:     cfg.yahoo,
        currency:   cfg.currency,
        lastUpdate: NOW_ISO,
        bars:       merged,
      }, `price_history/${cfg.id}`);

      await new Promise(r => setTimeout(r, 300)); // rate-limit Yahoo
    } catch (e) {
      console.warn(`  ⚠ ${cfg.id}: ${e.message}`);
    }
  }
}

// ══════════════════════════════════════════════════════════════
//  Main
// ══════════════════════════════════════════════════════════════
(async () => {
  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║  HaMatzpan Daily Scanner  V2.9.0 — Precision║");
  console.log(`║  ${new Date().toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })}                    ║`);
  console.log("╚══════════════════════════════════════════════╝\n");

  const warnings = [];

  // ══ שלב 1: Core Assets — מחירים חיים ══════════════════════
  console.log("📡 שולף מחירים — MSTR · MSTY · IBIT · FX...");
  const [msty, mstr, ibit, fx] = await Promise.all([
    yahooPrice("MSTY"),
    yahooPrice("MSTR"),
    yahooPrice("IBIT"),
    yahooPrice("ILS=X"),
  ]);

  // ══ שלב 2: ניירות אקסלנס ת"א — V2.8.3: 4 מקורות (Yahoo→Investing.com→Stooq→Bizportal) ═
  // מחיר נשמר ב-Firestore ב-ILS (לא אגורות!) — האפליקציה משתמשת ישירות ב-₪
  console.log("\n📡 V2.8.3 — שולף ניירות TASE: 1183441 (S&P) · 1159243 (NASDAQ)...");
  const [rawSp500, rawNasdaq] = await Promise.all([
    tasePriceILS(1183441, "1183441.TA"),  // Invesco S&P 500 TASE
    tasePriceILS(1159243, "1159243.TA"),  // iShares NASDAQ 100 TASE
  ]);

  // לוג מחירים — core assets
  const p = (o, label, sym) => console.log(`  ${label.padEnd(8)} ${o.price != null ? `${sym}${o.price} (${o.changePct != null ? (o.changePct >= 0 ? "+" : "") + o.changePct + "%" : "—"})` : "לא זמין"}`);
  p(msty, "MSTY", "$"); p(mstr, "MSTR", "$"); p(ibit, "IBIT", "$"); p(fx, "FX", "₪");

  // V2.8.3: לוג מחירים TASE — מחיר כבר ב-₪ (tasePriceILS המיר אגורות)
  const pTA = (o, label) => {
    if (o.price != null) console.log(`  ${label.padEnd(8)} ₪${o.price} (${o.source})`);
    else                 console.log(`  ${label.padEnd(8)} לא זמין`);
  };
  pTA(rawSp500,  "1183441"); pTA(rawNasdaq, "1159243");

  if (!msty.price)       warnings.push("MSTY: לא זמין");
  if (!mstr.price)       warnings.push("MSTR: לא זמין");
  if (!fx.price)         warnings.push("USD/ILS: לא זמין");
  if (!rawSp500.price)   warnings.push("נייר 1183441 (S&P500 אקסלנס): חסום — יוצג מחיר יום קודם");
  if (!rawNasdaq.price)  warnings.push("נייר 1159243 (נאסד\"ק אקסלנס): חסום — יוצג מחיר יום קודם");

  // ══ שלב 2.5: V3.0 — תזכורת דוחות קופות ישנים (>100 יום) ══════
  // רץ פעם בשבוע (יום שני) כדי לא להציף את הבאנר/מייל כל בוקר עם אותה תזכורת
  // הערה: כללי האבטחה של Firestore מאפשרים get() לפי מזהה אך חוסמים list() על
  // האוסף — לכן קוראים כל נכס בנפרד לפי המזהים הידועים מה-SEED (Dashboard.jsx).
  if (IS_MONDAY) {
    try {
      const ASSET_IDS = ["1","2","3","4","5","6","7","7b","8","9","10","12","13"];
      const fetched = await Promise.all(ASSET_IDS.map(id => fsRead("families/mizrahi/assets", id)));
      const assetsList = fetched.filter(Boolean);
      const now = Date.now();
      const staleFunds = assetsList.filter(a => {
        if (!a.checkDate || a.isMSTY) return false;
        const days = (now - new Date(a.checkDate).getTime()) / 86400000;
        return days > 100;
      });
      staleFunds.forEach(a => {
        const days = Math.round((now - new Date(a.checkDate).getTime()) / 86400000);
        warnings.push(`📋 ${a.owner} · ${a.type}: דוח אחרון לפני ${days} יום (${a.checkDate}) — כדאי להעלות דוח מעודכן`);
      });
      if (staleFunds.length) console.log(`  📋 ${staleFunds.length} קופות עם דוח ישן מ-100 יום`);
    } catch (e) { console.warn("  ⚠ בדיקת דוחות ישנים נכשלה:", e.message); }
  }

  // ══ שלב 2.6: V3.0 — גמל-נט: תשואות חודשיות אוטומטיות (רק א'-ה', כמו TASE) ══
  // API אמיתי שאומת ידנית מול gemelnet.cma.gov.il (07/2026):
  //   GET tsuot/ui/tsuotHodXML.aspx?dochot=1&sug=3&miTkfDivuach=YYYYMM&adTkfDivuach=YYYYMM&kupot=CSV
  //   Row: ID_KUPA (=trackCode) · TKF_DIVUACH (YYYYMM) · TSUA_NOMINALI_BFOAL (%)
  // הערה קריטית: גמל-נט מכסה רק גמל/השתלמות/חיסכון-ילד — לא פנסיה (פנסיה-נט, מערכת
  // נפרדת) ולא קרן כספית (קרן נאמנות). אומת ידנית מול 7 המסלולים — שמות הקרנות תואמים
  // בדיוק את המוסדות שלנו. לא לנחש trackCode נוסף בלי אימות דומה (סיכון "job ירוק עם
  // נתונים שגויים" שהמועצה הזהירה מפניו) — לכן allowlist מפורש, לא כל trackCode קיים.
  console.log("\n🏦 V3.0 — שולף תשואות גמל-נט חודשיות (7 מסלולים מאומתים)...");
  try {
    const GEMELNET_TRACKS = [13245, 13246, 13342, 13343, 11327, 15738, 15739];
    const now = new Date();
    const endYm   = now.getFullYear() * 100 + (now.getMonth() + 1);          // חודש נוכחי
    const startYm = (() => { const d = new Date(now); d.setMonth(d.getMonth() - 12); return d.getFullYear() * 100 + (d.getMonth() + 1); })();
    const url = `https://gemelnet.cma.gov.il/tsuot/ui/tsuotHodXML.aspx?dochot=1&sug=3&miTkfDivuach=${startYm}&adTkfDivuach=${endYm}&kupot=${GEMELNET_TRACKS.join(",")}`;
    const { status, body: xml } = await httpsRequest(url, { timeout: 15000 });
    if (status === 200 && typeof xml === "string") {
      const rowRegex = /<Row>([\s\S]*?)<\/Row>/gi;
      const byTrack = {};
      let rowMatch, totalRows = 0, rejected = 0;
      while ((rowMatch = rowRegex.exec(xml)) !== null) {
        const chunk = rowMatch[1];
        const get = (tag) => { const m = new RegExp(`<${tag}>([^<]*)<\/${tag}>`).exec(chunk); return m ? m[1] : null; };
        const trackCode = parseInt(get("ID_KUPA"), 10);
        const period    = get("TKF_DIVUACH"); // "202603"
        const pct       = parseFloat(get("TSUA_NOMINALI_BFOAL"));
        if (!trackCode || !period || !/^\d{6}$/.test(period)) continue;
        totalRows++;
        if (!Number.isFinite(pct) || Math.abs(pct) > 15) { rejected++; continue; } // ולידציית-סבירות
        const ym = `${period.slice(0, 4)}-${period.slice(4, 6)}`;
        (byTrack[trackCode] ??= []).push({ ym, pct });
      }
      if (rejected > 0) warnings.push(`fund_returns: ${rejected}/${totalRows} רשומות נפסלו בוולידציה (תשואה מחוץ ל-±15%)`);

      const writes = Object.entries(byTrack).map(([trackCode, monthly]) => {
        monthly.sort((a, b) => a.ym.localeCompare(b.ym));
        return fsWrite("fund_returns", trackCode, {
          trackCode: Number(trackCode), monthly, source: "gemelnet", updatedAt: NOW_ISO,
        }, `fund_returns/${trackCode}`);
      });
      await Promise.all(writes);
      console.log(`  ✅ גמל-נט: ${Object.keys(byTrack).length}/${GEMELNET_TRACKS.length} מסלולים · ${totalRows - rejected} נתוני תשואה`);
      const missing = GEMELNET_TRACKS.filter(t => !byTrack[t]);
      if (missing.length) console.log(`  ℹ אין נתונים החודש עבור מסלולים: ${missing.join(", ")}`);
    } else {
      warnings.push("גמל-נט: הבקשה נכשלה — תשואות לא עודכנו");
    }
  } catch (e) {
    console.warn("  ⚠ גמל-נט נכשל:", e.message);
    warnings.push(`גמל-נט: ${e.message}`);
  }

  // ══ שלב 3: דיבידנד MSTY (V2.7.0: yieldmaxetfs.com ראשוני, Yahoo fallback) ══
  console.log("\n📅 שולף דיבידנדי MSTY מ-yieldmaxetfs.com (מקור ראשוני)...");
  let nextDividend = null;
  let recentDividends = [];
  let mstyAnnouncements = [];
  let dividendSourceUsed = null; // V3.0: "yieldmax" | "yahoo" | "firestore-cache"

  // מקור ראשוני: yieldmaxetfs.com
  const ymResult = await yieldmaxDividend();
  if (ymResult && ymResult.recent?.length > 0) {
    nextDividend   = { amount: ymResult.amount, exDate: ymResult.exDate, payDate: ymResult.payDate, status: ymResult.status, source: ymResult.source };
    recentDividends = ymResult.recent;
    dividendSourceUsed = "yieldmax";
    mstyAnnouncements = ymResult.announcements || [];
    console.log(`  ✅ YieldMax: $${nextDividend.amount} · ex: ${nextDividend.exDate}`);
    console.log(`  📊 סה"כ ${recentDividends.length} דיבידנדים:`);
    recentDividends.slice(0, 8).forEach(d => console.log(`     • ${d.exDate} → $${d.amount}`));
  } else {
    // Fallback: Yahoo Finance 6 חודשים אחורה
    console.log("  ℹ yieldmaxetfs.com נכשל — fallback ל-Yahoo (6mo)...");
    const divResult = await yahooDividend("MSTY");
    if (divResult) {
      nextDividend   = { amount: divResult.amount, exDate: divResult.exDate, payDate: divResult.payDate, status: divResult.status, source: divResult.source };
      recentDividends = divResult.recent || [];
      dividendSourceUsed = "yahoo";
      console.log(`  ✅ Yahoo: $${nextDividend.amount} · ${recentDividends.length} דיבידנדים ב-6 חודשים`);
      recentDividends.slice(0, 8).forEach(d => console.log(`     • ${d.exDate} → $${d.amount}`));
    } else {
      // Fallback ראשוני: Firestore
      const prev = await fsRead("market_data", "latest");
      nextDividend   = prev?.msty?.nextDividend ?? { amount: null, exDate: null, payDate: null, status: "estimate" };
      recentDividends = prev?.msty?.recentDividends || [];
      dividendSourceUsed = "firestore-cache";
      if (nextDividend?.amount) console.log(`  📋 fallback מ-Firestore: $${nextDividend.amount}`);
      else                       warnings.push("MSTY dividend: לא נמצא — בדוק yieldmaxetfs.com ידנית");
    }
  }

  // ══ שלב 3ב: V3.0 — דיבידנדים server-authoritative ══════════
  // כותב את הרשימה המלאה ל-market_data/msty_dividends עם ולידציית-סבירות.
  // ה-Dashboard מסנכרן ממנה אוטומטית (dividendSync.js) — ללא תלות בקליק.
  if (dividendSourceUsed === "yieldmax" || dividendSourceUsed === "yahoo") {
    console.log("\n🗂 V3.0 — כותב רשימת דיבידנדים מלאה (server-authoritative)...");
    const isoDate = /^\d{4}-\d{2}-\d{2}$/;
    const maxFuture = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
    const validated = recentDividends.filter(d =>
      d.amount > 0 && d.amount < 5 &&
      typeof d.exDate === "string" && isoDate.test(d.exDate) &&
      !isNaN(new Date(d.exDate).getTime()) &&
      d.exDate <= maxFuture
    ).map(d => ({
      exDate:  d.exDate,
      payDate: (typeof d.payDate === "string" && isoDate.test(d.payDate)) ? d.payDate : d.exDate,
      amount:  d.amount,
      status:  d.status || "confirmed",
      source:  d.source || dividendSourceUsed,
    }));
    const dropped = recentDividends.length - validated.length;
    if (dropped > 0) warnings.push(`msty_dividends: ${dropped} רשומות נפסלו בוולידציה (סכום/תאריך לא סביר)`);

    // הגנת הצטמקות: אם הרשימה החדשה קטנה מ-50% מהקיימת — לא דורסים
    const prevDoc = await fsRead("market_data", "msty_dividends");
    const prevCount = Array.isArray(prevDoc?.dividends) ? prevDoc.dividends.length : 0;
    if (validated.length === 0) {
      warnings.push("msty_dividends: 0 רשומות תקינות — המסמך הקיים לא נדרס");
      console.log("  ⚠ 0 דיבידנדים תקינים — מדלג על כתיבה");
    } else if (prevCount > 0 && validated.length < prevCount * 0.5) {
      warnings.push(`msty_dividends: הרשימה החדשה (${validated.length}) קטנה מ-50% מהקיימת (${prevCount}) — לא נכתבה, בדוק את המקור`);
      console.log(`  ⚠ הצטמקות חשודה (${validated.length} מול ${prevCount}) — מדלג על כתיבה`);
    } else {
      await fsWrite("market_data", "msty_dividends", {
        dividends:  validated,
        count:      validated.length,
        sourceUsed: dividendSourceUsed,
        updatedAt:  NOW_ISO,
        date:       TODAY,
      }, "market_data/msty_dividends");
    }
  } else {
    console.log("\n🗂 V3.0 — דיבידנדים מ-cache בלבד (מקורות חיים נכשלו) — מסמך msty_dividends לא מתעדכן");
  }

  // ══ שלב 4: V2.5.2 — דיבידנד חזוי (מספר מניות מ-Firestore) ══
  let projectedDividend = null;
  console.log("\n💰 V2.5.2 — מחשב דיבידנד חזוי לפי כמות מניות ב-Firestore...");
  try {
    const mstyAsset = await fsRead("families/mizrahi/assets", "5");
    const shares    = mstyAsset?.sharesCount ?? 118; // ברירת מחדל: 118 מניות
    if (nextDividend?.amount && fx.price && shares > 0) {
      const grossUSD  = parseFloat((shares * nextDividend.amount).toFixed(2));
      const netUSD    = parseFloat((grossUSD * (1 - TAX_RATE)).toFixed(2));
      const netILS    = parseFloat((netUSD * fx.price).toFixed(2));
      projectedDividend = { shares, divPerShare: nextDividend.amount, grossUSD, netUSD, netILS, taxRate: TAX_RATE, fxUsed: fx.price };
      console.log(`  ✅ ${shares} מניות × $${nextDividend.amount} = $${grossUSD} ברוטו → $${netUSD} נטו → ₪${netILS} נטו`);
    } else {
      console.log("  ℹ אין מספיק נתונים לחישוב חזוי");
    }
  } catch (e) { console.warn("  ⚠ שגיאה בקריאת נכס MSTY:", e.message); }

  // ══ שלב 5: היסטוריה — יומי לעומת אתמול + fallback לניירות TASE ═══════════════════
  console.log(`\n📊 שולף היסטוריה (${YESTERDAY})...`);
  const yesterday = await fsRead("market_history", YESTERDAY);
  if (yesterday) console.log("  ✅ נתוני אתמול נטענו");
  else           console.log("  ℹ אין היסטוריה אתמול (ראשון פעם)");

  // V2.8.2: fallback — נתוני יום קודם ב-ILS (כבר מומרים, לא אגורות)
  const sp500_prevPrice  = yesterday?.sp500?.price  ?? null; // כבר ILS
  const nasdaq_prevPrice = yesterday?.nasdaq?.price ?? null; // כבר ILS

  const sp500 = rawSp500.price != null ? rawSp500 : {
    price: sp500_prevPrice, changePct: null, currency: "ILS",
    source: sp500_prevPrice ? `יום קודם (${YESTERDAY})` : "unavailable",
    isFallback: !!sp500_prevPrice, fallbackSource: "previous_day",
  };
  const nasdaq = rawNasdaq.price != null ? rawNasdaq : {
    price: nasdaq_prevPrice, changePct: null, currency: "ILS",
    source: nasdaq_prevPrice ? `יום קודם (${YESTERDAY})` : "unavailable",
    isFallback: !!nasdaq_prevPrice, fallbackSource: "previous_day",
  };

  if (rawSp500.price  == null && sp500_prevPrice)  console.log(`  📋 S&P500: fallback לנתוני ${YESTERDAY} — ₪${sp500_prevPrice.toFixed(2)}`);
  if (rawNasdaq.price == null && nasdaq_prevPrice) console.log(`  📋 NASDAQ: fallback לנתוני ${YESTERDAY} — ₪${nasdaq_prevPrice.toFixed(2)}`);
  if (rawSp500.price  == null && !sp500_prevPrice)  console.log("  ⚠ S&P500: אין נתונים בכלל — יוצג עלות בסיס");
  if (rawNasdaq.price == null && !nasdaq_prevPrice) console.log("  ⚠ NASDAQ: אין נתונים בכלל — יוצג עלות בסיס");

  const dailyChg = {
    msty:   calcDailyChange(msty.price,   yesterday?.msty?.price)   ?? msty.changePct,
    mstr:   calcDailyChange(mstr.price,   yesterday?.mstr?.price)   ?? mstr.changePct,
    ibit:   calcDailyChange(ibit.price,   yesterday?.ibit?.price)   ?? ibit.changePct,
    fx:     calcDailyChange(fx.price,     yesterday?.fx?.usdIls)    ?? fx.changePct,
    // sp500/nasdaq: שינוי יומי רק אם יש מחיר חי (fallback = null כי אין שינוי)
    sp500:  rawSp500.price  != null ? (calcDailyChange(sp500.price,  yesterday?.sp500?.price)  ?? sp500.changePct) : null,
    nasdaq: rawNasdaq.price != null ? (calcDailyChange(nasdaq.price, yesterday?.nasdaq?.price) ?? nasdaq.changePct) : null,
  };

  // ══ שלב 6: V2.8.0 — חדשות רלוונטיות: MSTY · MSTR · YieldMax ══
  // רק נושאים שמעניינים את המשתמש — לא BTC גנרי, לא IBIT כפול
  console.log("\n📰 V2.8.0 — שולף חדשות MSTY · MSTR · YieldMax...");
  const [mstyNews, mstrNews, ibitNews] = await Promise.all([
    fetchRssHeadlines("MSTY",  2),   // MSTY ישירות מYahoo RSS
    fetchRssHeadlines("MSTR",  2),   // MicroStrategy
    fetchRssHeadlines("IBIT",  1),   // Bitcoin ETF (לא BTC גנרי)
  ]);

  // V2.8.0: מקור בעברית לפי ticker
  const heSourceLabel = { MSTY: "YieldMax MSTY", MSTR: "MicroStrategy", IBIT: "Bitcoin ETF", BTC: "Bitcoin" };

  const rawNewsItems = [
    // הכרזות MSTY מ-yieldmaxetfs.com (כבר בעברית חלקית)
    ...mstyAnnouncements.map(n => ({ ...n, ticker: "MSTY", source: "YieldMax ETFs", descEn: n.title })),
    // חדשות Yahoo RSS
    ...mstyNews.map(n => ({ ...n, ticker: "MSTY", source: "Yahoo Finance" })),
    ...mstrNews.map(n => ({ ...n, ticker: "MSTR", source: "Yahoo Finance" })),
    ...ibitNews.map(n => ({ ...n, ticker: "IBIT", source: "Yahoo Finance" })),
  ].filter((n, idx, arr) => arr.findIndex(x => x.title === n.title) === idx); // הסר כפילויות

  // V2.8.0: תרגם כל כותרת + description לעברית (MyMemory, חינם)
  // מתרגמים את description אם קיים, אחרת את הכותרת
  console.log(`  🔤 מתרגם ${rawNewsItems.length} כותרות לעברית...`);
  const allNews = await Promise.all(rawNewsItems.map(async n => {
    const textToTranslate = n.descEn || n.title;
    const summaryHe = await translateToHebrew(textToTranslate);
    return {
      title:     n.title,           // כותרת מקורית באנגלית (לא מוצגת, רק לצורך ה-url)
      summaryHe: summaryHe || null, // V2.8.0: סיכום בעברית — זה מה שיוצג בממשק
      source:    n.source || "Yahoo Finance",
      sourceHe:  heSourceLabel[n.ticker] || n.ticker,
      url:       n.url || "",
      pubDate:   n.pubDate || TODAY,
      ticker:    n.ticker || "MSTY",
    };
  }));
  console.log(`  ✅ ${allNews.length} כותרות: ${mstyAnnouncements.length} הכרזות MSTY + ${mstyNews.length} MSTY + ${mstrNews.length} MSTR + ${ibitNews.length} IBIT | עם תרגום עברי`);

  // ══ שלב 7: בנה payload ════════════════════════════════════
  const payload = {
    timestamp:  NOW_ISO,
    date:       TODAY,
    status:     "ok",
    version:    1,
    scannedBy:  "node-scanner-v2.8.0",
    msty: {
      price:              msty.price,
      changePct:          msty.changePct,
      dailyChangePct:     dailyChg.msty,
      priceSource:        msty.source,
      nextDividend,
      recentDividends,    // V2.6.1 — מערך מלא של 3 חודשים אחרונים (כל פעימות אפריל)
      projectedDividend,  // V2.5.2 — תחזית דיבידנד לפי מניות מ-Firestore
    },
    mstr: {
      price:          mstr.price,
      changePct:      mstr.changePct,
      dailyChangePct: dailyChg.mstr,
      priceSource:    mstr.source,
    },
    ibit: {
      price:          ibit.price,
      changePct:      ibit.changePct,
      dailyChangePct: dailyChg.ibit,
      priceSource:    ibit.source,
      currency:       "USD",
    },
    // V2.8.2: Excellence papers — מחיר ב-₪ (ILS) — tasePriceILS כבר המיר אגורות!
    // isFallback:true + fallbackSource:"previous_day" = מחיר יום קודם ב-₪ (תקין)
    // isFallback:false                                = מחיר חי ב-₪ מהבורסה
    sp500: {
      price:          sp500.price,         // ₪ (ILS) — tasePriceILS המיר אגורות÷100
      changePct:      sp500.changePct,
      dailyChangePct: dailyChg.sp500,
      priceSource:    sp500.source,
      paperCode:      "01183441",
      isFallback:     !!sp500.isFallback,
      fallbackSource: sp500.fallbackSource || null,  // "previous_day" | null
    },
    nasdaq: {
      price:          nasdaq.price,        // ₪ (ILS) — tasePriceILS המיר אגורות÷100
      changePct:      nasdaq.changePct,
      dailyChangePct: dailyChg.nasdaq,
      priceSource:    nasdaq.source,
      paperCode:      "01159243",
      isFallback:     !!nasdaq.isFallback,
      fallbackSource: nasdaq.fallbackSource || null,
    },
    fx: {
      usdIls:         fx.price,
      changePct:      fx.changePct,
      dailyChangePct: dailyChg.fx,
      source:         fx.source,
    },
    news:    allNews,
    warnings,
  };

  // ══ שלב 8: כתוב Firestore ════════════════════════════════
  console.log("\n🔥 כותב ל-Firestore...");
  await Promise.all([
    fsWrite("market_data",    "latest",   payload, "market_data/latest"),
    fsWrite("market_history", TODAY,      {
      date: TODAY, timestamp: NOW_ISO,
      msty:   { price: msty.price,   changePct: dailyChg.msty },
      mstr:   { price: mstr.price,   changePct: dailyChg.mstr },
      ibit:   { price: ibit.price,   changePct: dailyChg.ibit },
      fx:     { usdIls: fx.price,    changePct: dailyChg.fx   },
      sp500:  { price: sp500.price,  changePct: dailyChg.sp500  },
      nasdaq: { price: nasdaq.price, changePct: dailyChg.nasdaq },
    }, `market_history/${TODAY}`),
    fsWrite("scanner_status", "latest", {
      lastRun: NOW_ISO, date: TODAY,
      status:  msty.price || mstr.price ? "success" : "partial",
      summary: buildSummary(
        { ...msty, dailyChangePct: dailyChg.msty },
        { ...mstr, dailyChangePct: dailyChg.mstr },
        { dailyChangePct: dailyChg.fx },
        { price: sp500.price, dailyChangePct: dailyChg.sp500 }
      ),
      mstyPrice: msty.price, mstrPrice: mstr.price,
      ibitPrice: ibit.price, usdIls: fx.price,
      sp500Price: sp500.price, nasdaqPrice: nasdaq.price,
    }, "scanner_status/latest"),
  ]);

  // ══ שלב 8.5: V2.9.8 — היסטוריית מחירים לאקסלנס (3 שנים, גרפים) ══
  try {
    await fetchExcellenceHistory({ sp500: sp500.price, nasdaq: nasdaq.price });
  } catch (e) {
    console.warn("  ⚠ Excellence history נכשל:", e.message);
  }

  // ══ שלב 9: V2.9.3 — סורק תעלות ════════════════════════════
  let channelAlerts = [];
  try {
    channelAlerts = await runChannelScan();
  } catch (e) {
    console.warn("  ⚠ סורק תעלות נכשל:", e.message);
  }

  // ══ שלב 9: V2.9.0 — WhatsApp שבועי (יום שני בלבד) ══════════
  if (IS_MONDAY) {
    console.log("\n📱 V2.9.0 — שולח דוח WhatsApp שבועי (יום שני)...");
    const sharesForWA = projectedDividend?.shares ?? 118;
    const avgDivForWA = nextDividend?.amount ?? 0.55;
    const monthlyIncomeEst = sharesForWA > 0
      ? sharesForWA * avgDivForWA * 4.33 * (fx.price || 3.6)
      : null;
    await sendWeeklyWhatsApp({
      mstyPrice:    msty.price,
      mstrPrice:    mstr.price,
      usdIls:       fx.price,
      nextDiv:      nextDividend?.amount,
      monthlyIncome: monthlyIncomeEst,
      newsHeadline: allNews[0]?.summaryHe || allNews[0]?.title || null,
    });
  }

  // ══ שלב 9: V2.9.2 — Gmail דוח בוקר יומי (ידיעות חדשות בלבד) ══
  console.log("\n📧 V2.9.2 — שולח דוח בוקר במייל...");
  // טעינת ה-URLs שנשלחו בפעם הקודמת
  let prevEmailedUrls = [];
  try {
    const scanStatus = await fsRead("scanner_status", "latest");
    prevEmailedUrls = Array.isArray(scanStatus?.lastEmailedNewsUrls) ? scanStatus.lastEmailedNewsUrls : [];
  } catch { /* אין היסטוריה */ }

  const sentUrls = await sendMorningEmail({
    mstyPrice:       msty.price,
    mstrPrice:       mstr.price,
    usdIls:          fx.price,
    mstyChange:      dailyChg.msty,
    mstrChange:      dailyChg.mstr,
    nextDiv:         nextDividend ? { amount: nextDividend.amount, exDate: nextDividend.exDate } : null,
    projectedILS:    projectedDividend?.netILS ?? null,
    shares:          projectedDividend?.shares ?? 118,
    sp500Price:      sp500.price,
    nasdaqPrice:     nasdaq.price,
    news:            allNews,
    prevEmailedUrls,
    channelAlerts,   // V2.9.3: סורק תעלות
    staleFundWarnings: warnings.filter(w => w.startsWith("📋")), // V3.0: תזכורת דוחות ישנים
  });

  // V2.9.6: שמור את האיחוד המצטבר של כל מה שנשלח (URLs + מפתחות כותרת)
  // שימוש ב-allSentKeys (מוחזר מ-sendMorningEmail) — כולל ישן+חדש, מגבל ל-100
  if (Array.isArray(sentUrls) && sentUrls.length > 0) {
    try {
      await fsWrite("scanner_status", "latest", { lastEmailedNewsUrls: sentUrls }, "scanner_status/latest (news history)");
    } catch (e) { console.warn("  ⚠ שמירת היסטוריית מיילים נכשלה:", e.message); }
  }

  // ══ סיכום ══════════════════════════════════════════════════
  console.log("\n── סיכום V2.9.0 Precision Focus ─────────────────────────");
  console.log(`  MSTY:      $${msty.price ?? "N/A"}  (יומי: ${dailyChg.msty != null ? (dailyChg.msty >= 0 ? "+" : "") + dailyChg.msty + "%" : "N/A"})`);
  console.log(`  MSTR:      $${mstr.price ?? "N/A"}  (יומי: ${dailyChg.mstr != null ? (dailyChg.mstr >= 0 ? "+" : "") + dailyChg.mstr + "%" : "N/A"})`);
  console.log(`  IBIT:      $${ibit.price ?? "N/A"}`);
  console.log(`  FX:        ₪${fx.price   ?? "N/A"}/$`);
  console.log(`  אקסלנס S&P: ₪${sp500.price  ?? "N/A"} ${sp500.isFallback ? "[^GSPC×FX]" : ""}`);
  console.log(`  אקסלנס NASDAQ: ₪${nasdaq.price ?? "N/A"} ${nasdaq.isFallback ? "[^IXIC×FX]" : ""}`);
  if (nextDividend?.amount) console.log(`  MSTY div: $${nextDividend.amount}/מניה → נטו ₪${projectedDividend?.netILS ?? "N/A"}`);
  console.log(`  חדשות:     ${allNews.length} כותרות (MSTR/BTC/IBIT)`);
  if (warnings.length) { console.log("\n── אזהרות ─"); warnings.forEach(w => console.log(`  ⚠ ${w}`)); }
  console.log("\n═════════════════════════════════════════════════════════\n");

  // ══ שלב 9: התראת Windows Toast ══════════════════════════════
  sendWindowsToast(
    "📊 המצפן — סריקת בוקר הושלמה",
    `MSTY: $${msty.price ?? "N/A"} · MSTR: $${mstr.price ?? "N/A"} · ₪${fx.price ?? "N/A"}/$ · ${allNews.length} חדשות`
  );
})();

// ══ V2.9.3 — סורק תעלות: Yahoo History ══════════════════════
// שולף נתוני OHLC של 3 חודשים עבור כל מנייה ברשימה
async function yahooHistory(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=3mo`;
  const res  = await httpsRequest(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  const result = res.body?.chart?.result?.[0];
  if (!result) throw new Error("No data");
  const q = result.indicators.quote[0];
  const combined = (result.timestamp || [])
    .map((t, i) => ({ t, c: q.close[i], h: q.high[i], l: q.low[i] }))
    .filter(r => r.c != null && r.h != null && r.l != null);
  if (combined.length < 21) throw new Error(`רק ${combined.length} נרות`);
  return {
    closes:     combined.map(r => r.c),
    highs:      combined.map(r => r.h),
    lows:       combined.map(r => r.l),
    timestamps: combined.map(r => r.t),
  };
}

// ══ V2.9.4 — Linear Regression Channel ════════════════════════
// מחשב קווי תעלה ישרים (כמו ציור ידני על גרף)
// slope + intercept + 2 סטיות תקן מעל ומתחת = קו עליון/תחתון
function calcLinearRegressionChannel(closes, stdDevMult = 2) {
  const n = closes.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX  += i;
    sumY  += closes[i];
    sumXY += i * closes[i];
    sumX2 += i * i;
  }
  const slope     = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  let sumSqResid  = 0;
  for (let i = 0; i < n; i++) {
    const r = closes[i] - (slope * i + intercept);
    sumSqResid += r * r;
  }
  const stdDev    = Math.sqrt(sumSqResid / n);
  const midLine   = Array.from({ length: n }, (_, i) => slope * i + intercept);
  const upperLine = midLine.map(v => v + stdDevMult * stdDev);
  const lowerLine = midLine.map(v => v - stdDevMult * stdDev);
  return {
    slope, intercept, stdDev,
    midLine, upperLine, lowerLine,
    lrcLower: lowerLine[n - 1],
    lrcUpper: upperLine[n - 1],
    lrcMid:   midLine[n - 1],
  };
}

// ══ V2.9.4 — Chart Generation via QuickChart.io ═══════════════
// מייצר תמונת גרף PNG עם מחיר + BB + תעלת רגרסיה + CCI
// מחזיר URL לתמונה (מוטמע במייל ונשמר ב-Firestore)
async function generateChartUrl(ticker, closes, timestamps, bbArr, lrc, lastCCI) {
  try {
    const n      = closes.length;
    const bbStart = n - bbArr.length; // BB מחשב מנקודה 20

    // תוויות תאריך על ציר X (כל 10 ימים)
    const labels = timestamps.map(t =>
      new Date(t * 1000).toLocaleDateString("he-IL", { month: "short", day: "numeric" })
    );

    const chartConfig = {
      type: "line",
      data: {
        labels,
        datasets: [
          // מחיר סגירה (קו לבן)
          {
            label: ticker,
            data: closes.map(c => +c.toFixed(2)),
            borderColor: "#f1f5f9",
            borderWidth: 2,
            pointRadius: 0,
            fill: false,
            tension: 0.1,
          },
          // BB עליון (ירוק מקווקו)
          {
            label: "BB Upper",
            data: [...Array(bbStart).fill(null), ...bbArr.map(b => +b.upper.toFixed(2))],
            borderColor: "#4ade80",
            borderWidth: 1,
            borderDash: [4, 3],
            pointRadius: 0,
            fill: false,
          },
          // BB תחתון (אדום מקווקו)
          {
            label: "BB Lower",
            data: [...Array(bbStart).fill(null), ...bbArr.map(b => +b.lower.toFixed(2))],
            borderColor: "#f87171",
            borderWidth: 1,
            borderDash: [4, 3],
            pointRadius: 0,
            fill: false,
          },
          // LRC עליון (כחול)
          {
            label: "Channel ↑",
            data: lrc.upperLine.map(v => +v.toFixed(2)),
            borderColor: "#60a5fa",
            borderWidth: 1.5,
            pointRadius: 0,
            fill: false,
          },
          // LRC תחתון (כתום) — קו הסט-אפ
          {
            label: "Channel ↓",
            data: lrc.lowerLine.map(v => +v.toFixed(2)),
            borderColor: "#fb923c",
            borderWidth: 2,
            pointRadius: 0,
            fill: false,
          },
        ],
      },
      options: {
        plugins: {
          legend: { labels: { color: "#94a3b8", font: { size: 10 }, boxWidth: 12 } },
          title:  { display: true, text: `🚨 ${ticker} — תחתית תעלה | CCI: ${lastCCI}`, color: "#fcd34d", font: { size: 13 } },
        },
        scales: {
          x: { ticks: { color: "#64748b", maxTicksLimit: 8, font: { size: 9 } }, grid: { color: "#1e293b" } },
          y: { ticks: { color: "#64748b", font: { size: 9 } },                   grid: { color: "#1e293b" } },
        },
      },
    };

    const res = await httpsRequest(
      "https://quickchart.io/chart/create",
      { method: "POST", headers: { "Content-Type": "application/json" }, timeout: 15000 },
      { chart: chartConfig, width: 620, height: 320, backgroundColor: "#0f172a", format: "png" }
    );
    return res.body?.url || null;
  } catch (e) {
    console.warn(`  ⚠ chart URL generation failed for ${ticker}: ${e.message}`);
    return null;
  }
}

// ══ V2.9.4 — סורק תעלות: Channel Scan ════════════════════════
// בודק כל מנייה: Bollinger Bands (20,2SD) + Linear Regression Channel + CCI (20)
// התראה: CCI < -100 ומחיר בתוך 5% מהקו התחתון (BB OR LRC — מספיק אחד)
async function runChannelScan() {
  console.log(`\n📡 [V2.9.4] סורק תעלות (BB + LRC) — ${WATCHLIST.length} מניות`);
  const alerts = [];

  for (const ticker of WATCHLIST) {
    try {
      const { closes, highs, lows, timestamps } = await yahooHistory(ticker);

      // ── Bollinger Bands (period=20, stdDev=2) ──
      const bbArr   = BollingerBands.calculate({ period: 20, values: closes, stdDev: 2 });
      const lastBB  = bbArr[bbArr.length - 1];

      // ── CCI (period=20) ──
      const cciArr  = CCI.calculate({ period: 20, high: highs, low: lows, close: closes });
      const lastCCI = cciArr[cciArr.length - 1];

      // ── Linear Regression Channel (60 ימים, 2SD) ──
      const lrc      = calcLinearRegressionChannel(closes, 2);

      const lastClose    = closes[closes.length - 1];
      const pctFromBB    = ((lastClose - lastBB.lower)  / lastBB.lower)  * 100;
      const pctFromLRC   = ((lastClose - lrc.lrcLower)  / Math.abs(lrc.lrcLower)) * 100;

      // תנאי CCI (חייב — מחיר בתחתית + oversold)
      const cciOversold  = lastCCI < -100;
      // מנגנון ראשי: BB תחתון
      const bbAlert      = cciOversold && pctFromBB  <= 5;
      // מנגנון משני: LRC תחתון (קו ישר — יתפוס תבניות כמו IREN)
      const lrcAlert     = cciOversold && pctFromLRC <= 5;

      if (bbAlert || lrcAlert) {
        const triggerMethod = bbAlert && lrcAlert ? "BB+LRC" : bbAlert ? "BB" : "LRC";
        const pctFromLower  = bbAlert ? +pctFromBB.toFixed(1) : +pctFromLRC.toFixed(1);

        console.log(`  🚨 ${ticker} [${triggerMethod}]: $${lastClose.toFixed(2)} | BB↓=$${lastBB.lower.toFixed(2)} | LRC↓=$${lrc.lrcLower.toFixed(2)} | CCI=${Math.round(lastCCI)}`);

        // ── יצירת גרף ──
        const chartUrl = await generateChartUrl(ticker, closes, timestamps, bbArr, lrc, Math.round(lastCCI));

        alerts.push({
          ticker,
          close:         +lastClose.toFixed(2),
          lowerBB:       +lastBB.lower.toFixed(2),
          upperBB:       +lastBB.upper.toFixed(2),
          lrcLower:      +lrc.lrcLower.toFixed(2),
          lrcUpper:      +lrc.lrcUpper.toFixed(2),
          cci:           Math.round(lastCCI),
          pctFromLower,
          triggerMethod, // "BB" | "LRC" | "BB+LRC"
          chartUrl,      // URL לגרף PNG מ-QuickChart.io (null אם נכשל)
          scannedAt:     new Date().toISOString(),
        });
      }

      // rate-limit — 300ms בין מניות (כולל קריאת QuickChart)
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.warn(`  ⚠️ ${ticker}: ${e.message}`);
    }
  }

  // שמירה ל-Firestore: scanner_alerts/latest
  await fsWrite("scanner_alerts", "latest", {
    alerts,
    date:      new Date().toISOString(),
    count:     alerts.length,
    scannedAt: new Date().toISOString(),
  }, "scanner_alerts/latest");

  console.log(`✅ סורק תעלות: ${alerts.length} התראות מתוך ${WATCHLIST.length} מניות`);
  return alerts;
}

// ══ Gmail דוח בוקר — V2.9.1 ══════════════════════════════════
// שולח מייל HTML דרך Gmail SMTP עם App Password
// עובד אוטונומית מ-GitHub Actions ללא Claude
async function sendMorningEmail({ mstyPrice, mstrPrice, usdIls, mstyChange, mstrChange,
  nextDiv, projectedILS, shares, sp500Price, nasdaqPrice, news, prevEmailedUrls = [],
  channelAlerts = [], staleFundWarnings = [] }) {
  if (!GMAIL_APP_PASSWORD || !GMAIL_TO) {
    console.log("  ⏭ Gmail: GMAIL_APP_PASSWORD/GMAIL_TO לא מוגדרים — מדלג");
    return null;
  }
  try {
    // nodemailer נטען דינמית (כבר בpackage.json כ-dependency)
    const nodemailer = (await import("nodemailer")).default;
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: GMAIL_FROM, pass: GMAIL_APP_PASSWORD },
    });

    const dateStr = new Date().toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem", weekday:"long", day:"numeric", month:"long", year:"numeric" });
    const mstyChgStr  = mstyChange != null ? `${mstyChange >= 0 ? "▲" : "▼"} ${Math.abs(mstyChange)}%` : "";
    const mstrChgStr  = mstrChange != null ? `${mstrChange >= 0 ? "▲" : "▼"} ${Math.abs(mstrChange)}%` : "";

    // V2.9.6 — סנן ידיעות שכבר נשלחו
    // dedup לפי URL (ידיעות Yahoo) או לפי כותרת (הכרזות YieldMax שאין להן URL)
    // prevEmailedUrls מכיל גם URLs ("https://...") וגם מפתחות כותרת ("title:...")
    const prevKeys = new Set(prevEmailedUrls || []);
    const newNews  = (news || [])
      .filter(n => {
        const key = n.url ? n.url : `title:${n.title}`;
        return !prevKeys.has(key); // הכרזות ללא URL — dedup לפי כותרת
      })
      .slice(0, 5);
    // מפתחות למה שנשלח עכשיו
    const sentKeys = newNews.map(n => n.url ? n.url : `title:${n.title}`).filter(Boolean);
    // ✅ צבור (אל תמחק) — שמור איחוד של ישן + חדש, מגבל ל-100 כדי שלא יגדל לאין סוף
    const allSentKeys = [...new Set([...(prevEmailedUrls || []), ...sentKeys])].slice(-100);

    // V2.9.8: כפתור CTA ברור "קרא בכתבה →" בנפרד מהכותרת
    // Gmail Mobile לפעמים לא מציג text-decoration:underline ב-inline styles —
    // לכן: <u> מפורש + כפתור עם רקע מודגש שמחליף את כל ה-rendering ambiguity
    const newsHtml = newNews.map(n =>
      `<li style="margin-bottom:14px;list-style:none">
        <div style="margin-bottom:4px">
          <b style="color:#64b5f6">[${n.sourceHe || n.ticker}]</b>
          <span style="color:#e2e8f0">${n.summaryHe || n.title}</span>
        </div>
        ${n.url
          ? `<a href="${n.url}" target="_blank" rel="noopener" style="display:inline-block;background:#1d4ed8;color:#ffffff !important;padding:6px 14px;border-radius:6px;text-decoration:none;font-size:12px;font-weight:bold">📖 קרא כתבה מלאה ←</a>`
          : ``}
      </li>`
    ).join("");

    const html = `
<!DOCTYPE html><html dir="rtl" lang="he">
<head><meta charset="UTF-8"><style>
  body{font-family:Arial,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:20px}
  .card{background:#1e293b;border-radius:12px;padding:20px;margin-bottom:16px}
  .title{font-size:22px;font-weight:bold;color:#38bdf8;margin-bottom:4px}
  .sub{color:#94a3b8;font-size:13px}
  .price{font-size:28px;font-weight:bold;color:#f1f5f9}
  .up{color:#4ade80} .dn{color:#f87171}
  table{width:100%;border-collapse:collapse}
  td{padding:8px 12px;border-bottom:1px solid #334155}
  .label{color:#94a3b8} .val{font-weight:bold;text-align:left}
  ul{padding-right:20px;margin:0}
  .footer{color:#475569;font-size:11px;text-align:center;margin-top:20px}
</style></head>
<body>
  <div class="card">
    <div class="title">📊 המצפן — דוח בוקר</div>
    <div class="sub">${dateStr}</div>
  </div>

  <div class="card">
    <table>
      <tr><td class="label">MSTY</td><td class="val">$${mstyPrice ?? "N/A"} <span class="${(mstyChange??0)>=0?'up':'dn'}">${mstyChgStr}</span></td></tr>
      <tr><td class="label">MSTR</td><td class="val">$${mstrPrice ?? "N/A"} <span class="${(mstrChange??0)>=0?'up':'dn'}">${mstrChgStr}</span></td></tr>
      <tr><td class="label">USD/ILS</td><td class="val">₪${usdIls ?? "N/A"}</td></tr>
      ${sp500Price ? `<tr><td class="label">אקסלנס S&P</td><td class="val">₪${sp500Price}</td></tr>` : ""}
      ${nasdaqPrice ? `<tr><td class="label">אקסלנס NASDAQ</td><td class="val">₪${nasdaqPrice}</td></tr>` : ""}
    </table>
  </div>

  ${nextDiv ? `<div class="card">
    <div style="color:#fbbf24;font-weight:bold;margin-bottom:8px">💰 דיבידנד MSTY</div>
    <table>
      <tr><td class="label">סכום</td><td class="val">$${nextDiv.amount}/מניה</td></tr>
      <tr><td class="label">ex-date</td><td class="val">${nextDiv.exDate || ""}</td></tr>
      <tr><td class="label">צפי נטו (${shares} מניות)</td><td class="val">₪${projectedILS ?? "N/A"}</td></tr>
    </table>
  </div>` : ""}

  ${newsHtml ? `<div class="card">
    <div style="color:#a78bfa;font-weight:bold;margin-bottom:8px">📰 חדשות שוק</div>
    <ul>${newsHtml}</ul>
  </div>` : ""}

  ${staleFundWarnings.length > 0 ? `<div class="card">
    <div style="color:#fbbf24;font-weight:bold;margin-bottom:8px">📋 תזכורת — דוחות קופה ישנים (100+ יום)</div>
    <ul style="margin:0;padding-right:18px">
      ${staleFundWarnings.map(w => `<li style="color:#fde68a;margin-bottom:4px">${w.replace(/^📋\s*/, "")}</li>`).join("")}
    </ul>
  </div>` : ""}

  <div class="card">
    <div style="color:#f87171;font-weight:bold;margin-bottom:12px;font-size:16px">🚨 סורק תעלות — מניות בתחתית</div>
    ${channelAlerts.length === 0
      ? `<p style="color:#64748b;margin:0">אין התראות כיום — כל המניות ברשימה רחוקות מתחתית הערוץ 🟢</p>`
      : channelAlerts.map(a => `
          <div style="margin-bottom:20px;padding:12px;background:#0f172a;border-radius:8px;border-right:4px solid #ef4444">
            <div style="margin-bottom:8px">
              🚨 <b style="color:#fcd34d;font-size:15px">${a.ticker}</b>
              <span style="background:#1e293b;color:#94a3b8;font-size:11px;padding:2px 7px;border-radius:4px;margin-right:8px">${a.triggerMethod || "BB"}</span>
            </div>
            <table style="width:100%;border-collapse:collapse;margin-bottom:10px">
              <tr>
                <td style="color:#94a3b8;padding:3px 8px">מחיר סגירה</td>
                <td style="color:#f1f5f9;font-weight:bold;padding:3px 8px">$${a.close}</td>
                <td style="color:#94a3b8;padding:3px 8px">CCI</td>
                <td style="color:#ef4444;font-weight:bold;padding:3px 8px">${a.cci}</td>
              </tr>
              <tr>
                <td style="color:#94a3b8;padding:3px 8px">BB תחתון</td>
                <td style="color:#f87171;padding:3px 8px">$${a.lowerBB}</td>
                <td style="color:#94a3b8;padding:3px 8px">LRC תחתון</td>
                <td style="color:#fb923c;padding:3px 8px">$${a.lrcLower ?? "N/A"}</td>
              </tr>
              <tr>
                <td style="color:#94a3b8;padding:3px 8px">מרחק מתחתית</td>
                <td style="color:#fbbf24;font-weight:bold;padding:3px 8px">${a.pctFromLower}%</td>
              </tr>
            </table>
            ${a.chartUrl
              ? `<img src="${a.chartUrl}" alt="${a.ticker} chart" style="width:100%;max-width:620px;border-radius:6px;display:block">`
              : `<p style="color:#475569;font-size:11px">גרף לא זמין</p>`
            }
          </div>
        `).join("")
    }
    <p style="color:#475569;font-size:11px;margin-top:4px">תנאי: CCI &lt; -100 &amp; מחיר בתוך 5% מ-BB תחתון (20, 2SD) או LRC תחתון (60 ימים)</p>
  </div>

  <div class="footer">המצפן V2.9.4 · HaMatzpan · מופעל אוטומטית ע"י GitHub Actions</div>
</body></html>`;

    // V2.9.6: המייל נשלח תמיד — הוא דוח בוקר של מחירים + דיבידנד, לא רק חדשות
    // (גם ביום שאין כתבות חדשות, המחיר והדיבידנד חשובים)
    await transporter.sendMail({
      from:    `"📊 המצפן" <${GMAIL_FROM}>`,
      to:      GMAIL_TO,
      subject: `📊 המצפן ${dateStr} | MSTY $${mstyPrice ?? "?"} · MSTR $${mstrPrice ?? "?"} · ₪${usdIls ?? "?"}/$`,
      html,
    });
    console.log(`  ✅ Gmail: דוח בוקר נשלח אל ${GMAIL_TO} (${newNews.length} ידיעות חדשות)`);
    return allSentKeys;
  } catch (e) {
    console.warn("  ⚠ Gmail שליחה נכשלה:", e.message);
    return null;
  }
}

// ══ Windows Toast Notification ═══════════════════════════════
function sendWindowsToast(title, message) {
  // מנקה גרשיים כדי למנוע injection לתוך ה-PowerShell
  const safeTitle   = title.replace(/'/g, "''");
  const safeMessage = message.replace(/'/g, "''");

  const ps = `
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime] | Out-Null
    $template = '<toast><visual><binding template="ToastGeneric"><text>${safeTitle}</text><text>${safeMessage}</text></binding></visual></toast>'
    $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
    $xml.LoadXml($template)
    $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('HaMatzpan').Show($toast)
  `;

  exec(`powershell -NoProfile -NonInteractive -Command "${ps.replace(/\n\s*/g, '; ')}"`,
    (err) => {
      if (err) {
        // fallback — BalloonTip (Windows 10 ישן / 11 בלי WinRT)
        const fallback = `
          Add-Type -AssemblyName System.Windows.Forms
          $n = New-Object System.Windows.Forms.NotifyIcon
          $n.Icon = [System.Drawing.SystemIcons]::Information
          $n.Visible = $true
          $n.ShowBalloonTip(8000, '${safeTitle}', '${safeMessage}', 'Info')
          Start-Sleep 9
          $n.Dispose()
        `;
        exec(`powershell -NoProfile -NonInteractive -Command "${fallback.replace(/\n\s*/g, '; ')}"`, () => {});
      }
    }
  );
}
