#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
//  HaMatzpan · Daily Scanner  –  V2.8.0
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

const TODAY       = new Date().toISOString().slice(0, 10);
const YESTERDAY   = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const NOW_ISO     = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Jerusalem" }).replace(" ", "T") + "+03:00";
const IS_THURSDAY = new Date().getDay() === 4;
const TAX_RATE    = 0.25; // מס רווחי הון ישראלי

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
  const url = "https://www.yieldmaxetfs.com/our-etfs/msty/";
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
      if (cells.length >= 3) {
        // נסה למצוא ex-date + amount
        const exDateStr = cells.find(c => dateRegex.test(c) && !c.includes("$"));
        const amountStr = cells.find(c => amountRegex.test(c));
        if (exDateStr && amountStr) {
          const dm = dateRegex.exec(exDateStr);
          const am = amountRegex.exec(amountStr);
          if (dm && am) {
            const exDate = `${dm[3]}-${String(dm[1]).padStart(2,"0")}-${String(dm[2]).padStart(2,"0")}`;
            const amount = parseFloat(am[1]);
            if (amount > 0 && amount < 5) { // sanity check: MSTY divs are $0.1–$4
              const payDateStr = cells.find(c => dateRegex.test(c) && c !== exDateStr);
              let payDate = exDate; // fallback
              if (payDateStr) {
                const pm = dateRegex.exec(payDateStr);
                if (pm) payDate = `${pm[3]}-${String(pm[1]).padStart(2,"0")}-${String(pm[2]).padStart(2,"0")}`;
              }
              dividends.push({ amount, exDate, payDate, status: "confirmed", source: "YieldMax ETFs" });
            }
          }
        }
      }
    }

    if (dividends.length === 0) return null;

    // מיין לפי תאריך יורד (הכי חדש ראשון)
    dividends.sort((a, b) => b.exDate.localeCompare(a.exDate));
    const latest = dividends[0];

    // ── חלץ הכרזות חשובות (announcements/press-releases) ──
    const announcements = [];
    const announcementRegex = /<(?:h[1-4]|p|li|div)[^>]*>([\s\S]{20,300}?)<\/(?:h[1-4]|p|li|div)>/gi;
    const keywords = /distribution|announce|dividend|special|yield|fund|nav|earnings/i;
    let annoMatch;
    while ((annoMatch = announcementRegex.exec(html)) !== null && announcements.length < 5) {
      const text = cleanHTML(annoMatch[1]);
      if (keywords.test(text) && text.length > 30 && text.length < 200) {
        announcements.push({ title: text, source: "YieldMax ETFs", pubDate: TODAY, ticker: "MSTY" });
      }
    }

    console.log(`  ✅ yieldmaxetfs.com: ${dividends.length} דיבידנדים | ${announcements.length} הכרזות`);
    return { ...latest, recent: dividends, announcements };
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

// ── News fetch — Yahoo Finance RSS (V2.8.0: כולל description כסיכום) ──────
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
      // V2.8.0: שלוף description (= כמה משפטים ראשונים של הכתבה) כסיכום
      const descRaw = (m[1].match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) || m[1].match(/<description>([\s\S]*?)<\/description>/))?.[1] || "";
      const summary = clean(descRaw).slice(0, 200) || null;
      if (title) items.push({ title, url: link, pubDate, summary });
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

/** קריאת מסמך יחיד מ-Firestore */
async function fsRead(collectionPath, docId) {
  const url = `${FIRESTORE_BASE}/${collectionPath}/${docId}?key=${FIREBASE.apiKey}`;
  try {
    const { status, body } = await httpsRequest(url);
    if (status === 200 && body?.fields) {
      const decode = (v) => {
        if (v.nullValue    !== undefined) return null;
        if (v.booleanValue !== undefined) return v.booleanValue;
        if (v.integerValue !== undefined) return Number(v.integerValue);
        if (v.doubleValue  !== undefined) return v.doubleValue;
        if (v.stringValue  !== undefined) return v.stringValue;
        if (v.arrayValue)  return (v.arrayValue.values || []).map(decode);
        if (v.mapValue) {
          const r = {};
          for (const [k, fv] of Object.entries(v.mapValue.fields || {})) r[k] = decode(fv);
          return r;
        }
        return null;
      };
      const r = {};
      for (const [k, v] of Object.entries(body.fields)) r[k] = decode(v);
      return r;
    }
  } catch {}
  return null;
}

/** כתיבה/עדכון מסמך ב-Firestore (PATCH+merge) */
async function fsWrite(collectionPath, docId, payload, label = "") {
  const url = `${FIRESTORE_BASE}/${collectionPath}/${docId}?key=${FIREBASE.apiKey}`;
  try {
    const { status, body } = await httpsRequest(url, { method: "PATCH" }, toFsDoc(payload));
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
//  Main
// ══════════════════════════════════════════════════════════════
(async () => {
  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║  HaMatzpan Daily Scanner  V2.8.0 — Precision║");
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

  // ══ שלב 2: ניירות אקסלנס ת"א (עם fallback + המרה לשקל) ═══
  console.log("\n📡 שולף ניירות אקסלנס ת\"א (1183441 · 1159243)...");
  const [rawSp500, rawNasdaq] = await Promise.all([
    yahooPrice("1183441.TA", "^GSPC"),
    yahooPrice("1159243.TA", "^IXIC"),
  ]);

  // V2.5.2: אם ה-.TA חסום והשתמשנו ב-fallback US → נכפל ב-FX לקבל שקלים
  const applyFxConversion = (raw, fxRate) => {
    if (!raw.isFallback || raw.currency === "ILS" || !fxRate) return raw;
    const ilsPrice = raw.price != null ? parseFloat((raw.price * fxRate).toFixed(2)) : null;
    return { ...raw, price: ilsPrice, currency: "ILS",
             source: `${raw.source} × FX₪ (${raw.fallbackTicker})` };
  };
  const sp500  = applyFxConversion(rawSp500,  fx.price);
  const nasdaq = applyFxConversion(rawNasdaq, fx.price);

  // לוג מחירים
  const p = (o, label, sym) => console.log(`  ${label.padEnd(8)} ${o.price != null ? `${sym}${o.price} (${o.changePct != null ? (o.changePct >= 0 ? "+" : "") + o.changePct + "%" : "—"}) ${o.isFallback ? `[fallback: ${o.fallbackTicker}]` : ""}` : "לא זמין"}`);
  p(msty,   "MSTY",   "$"); p(mstr,   "MSTR",   "$"); p(ibit,   "IBIT",   "$");
  p(fx,     "FX",     "₪"); p(sp500,  "S&P500", "₪"); p(nasdaq, "NASDAQ", "₪");

  if (!msty.price)   warnings.push("MSTY: לא זמין");
  if (!mstr.price)   warnings.push("MSTR: לא זמין");
  if (!fx.price)     warnings.push("USD/ILS: לא זמין");
  if (!sp500.price)  warnings.push("נייר 1183441 (S&P500 אקסלנס): חסום" + (sp500.isFallback ? " → נעשה שימוש ב-^GSPC×FX" : ""));
  if (!nasdaq.price) warnings.push("נייר 1159243 (נאסד\"ק אקסלנס): חסום" + (nasdaq.isFallback ? " → נעשה שימוש ב-^IXIC×FX" : ""));

  // ══ שלב 3: דיבידנד MSTY (V2.7.0: yieldmaxetfs.com ראשוני, Yahoo fallback) ══
  console.log("\n📅 שולף דיבידנדי MSTY מ-yieldmaxetfs.com (מקור ראשוני)...");
  let nextDividend = null;
  let recentDividends = [];
  let mstyAnnouncements = [];

  // מקור ראשוני: yieldmaxetfs.com
  const ymResult = await yieldmaxDividend();
  if (ymResult && ymResult.recent?.length > 0) {
    nextDividend   = { amount: ymResult.amount, exDate: ymResult.exDate, payDate: ymResult.payDate, status: ymResult.status, source: ymResult.source };
    recentDividends = ymResult.recent;
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
      console.log(`  ✅ Yahoo: $${nextDividend.amount} · ${recentDividends.length} דיבידנדים ב-6 חודשים`);
      recentDividends.slice(0, 8).forEach(d => console.log(`     • ${d.exDate} → $${d.amount}`));
    } else {
      // Fallback ראשוני: Firestore
      const prev = await fsRead("market_data", "latest");
      nextDividend   = prev?.msty?.nextDividend ?? { amount: null, exDate: null, payDate: null, status: "estimate" };
      recentDividends = prev?.msty?.recentDividends || [];
      if (nextDividend?.amount) console.log(`  📋 fallback מ-Firestore: $${nextDividend.amount}`);
      else                       warnings.push("MSTY dividend: לא נמצא — בדוק yieldmaxetfs.com ידנית");
    }
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

  // ══ שלב 5: היסטוריה — יומי לעומת אתמול ═══════════════════
  console.log(`\n📊 שולף היסטוריה (${YESTERDAY})...`);
  const yesterday = await fsRead("market_history", YESTERDAY);
  if (yesterday) console.log("  ✅ נתוני אתמול נטענו");
  else console.log("  ℹ אין היסטוריה אתמול (ראשון פעם)");

  const dailyChg = {
    msty:   calcDailyChange(msty.price,   yesterday?.msty?.price)   ?? msty.changePct,
    mstr:   calcDailyChange(mstr.price,   yesterday?.mstr?.price)   ?? mstr.changePct,
    ibit:   calcDailyChange(ibit.price,   yesterday?.ibit?.price)   ?? ibit.changePct,
    fx:     calcDailyChange(fx.price,     yesterday?.fx?.usdIls)    ?? fx.changePct,
    sp500:  calcDailyChange(sp500.price,  yesterday?.sp500?.price)  ?? sp500.changePct,
    nasdaq: calcDailyChange(nasdaq.price, yesterday?.nasdaq?.price) ?? nasdaq.changePct,
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

  const allNews = [
    // הכרזות MSTY מ-yieldmaxetfs.com (מקור ראשי — distribution, NAV, announcements)
    ...mstyAnnouncements.map(n => ({ ...n, ticker: "MSTY", source: "YieldMax ETFs" })),
    // חדשות Yahoo RSS עם summary מה-description
    ...mstyNews.map(n => ({ ...n, ticker: "MSTY", source: "Yahoo Finance" })),
    ...mstrNews.map(n => ({ ...n, ticker: "MSTR", source: "Yahoo Finance" })),
    ...ibitNews.map(n => ({ ...n, ticker: "IBIT", source: "Yahoo Finance" })),
  ]
  .filter((n, idx, arr) => arr.findIndex(x => x.title === n.title) === idx) // הסר כפילויות
  .map(n => ({
    title:      n.title,
    source:     n.source || "Yahoo Finance",
    sourceHe:   heSourceLabel[n.ticker] || n.ticker,  // V2.8.0: תווית עברית
    url:        n.url || "",
    pubDate:    n.pubDate || TODAY,
    ticker:     n.ticker || "MSTY",
    summary:    n.summary || null,   // V2.8.0: שורה מסכמת מה-description
  }));
  console.log(`  ✅ נמצאו ${allNews.length} כותרות: ${mstyAnnouncements.length} הכרזות MSTY + ${mstyNews.length} MSTY + ${mstrNews.length} MSTR + ${ibitNews.length} IBIT`);

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
    // V2.5.2: Excellence papers — ILS (כולל המרה אם היה fallback)
    sp500: {
      price:          sp500.price,
      changePct:      sp500.changePct,
      dailyChangePct: dailyChg.sp500,
      priceSource:    sp500.source,
      paperCode:      "01183441",
      isFallback:     sp500.isFallback,
    },
    nasdaq: {
      price:          nasdaq.price,
      changePct:      nasdaq.changePct,
      dailyChangePct: dailyChg.nasdaq,
      priceSource:    nasdaq.source,
      paperCode:      "01159243",
      isFallback:     nasdaq.isFallback,
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

  // ══ סיכום ══════════════════════════════════════════════════
  console.log("\n── סיכום V2.8.0 Precision Focus ─────────────────────────");
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
