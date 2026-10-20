// ═══════════════════════════════════════════════════════════════
//  netWorth.js — V3.1 · חישוב שווי נטו (פונקציות טהורות)
//
//  מקור אחד לכל הסכומים בכרטיסי הסיכום. לכל נכס נבחר הערך המדויק ביותר:
//    market   — MSTY: מניות × מחיר × שער
//    estimate — קופה ב-allowlist: יתרת דוח מגולגלת קדימה (estimateBalance)
//    official — יתרת הדוח כמו שהיא
// ═══════════════════════════════════════════════════════════════
import { estimateBalance, isGemelnetEligible } from "./fundEstimate.js";

/**
 * קרן נאמנות (קרן כספית): יתרה = יתרת הדוח × מחיר היום / מחיר ביום הדוח.
 * העוגן תקף רק אם הסורק חישב אותו לאותו reportDate (אחרי העלאת דוח חדש — ממתינים לסריקה).
 * @param {{price:number, priceAtReport:number, reportDate:string, asOf:string}} fp — market_data/latest.funds[id]
 */
export function fundPriceValue(asset, fp) {
  if (!asset?.reportBalance || !fp?.price || !fp?.priceAtReport || fp.reportDate !== asset.reportDate) return null;
  return { value: Math.round(asset.reportBalance * fp.price / fp.priceAtReport * 100) / 100, kind: "market", asOf: fp.asOf };
}

/**
 * @param {object} asset
 * @param {{mstyPrice?:number, fx?:number, fundReturnsByTrack?:object, fundPrices?:object}} ctx
 * @returns {{value:number, kind:"market"|"estimate"|"official", asOf:string|null}}
 */
export function assetValue(asset, ctx = {}) {
  if (asset?.isMSTY) {
    return { value: (asset.sharesCount || 0) * (ctx.mstyPrice || 0) * (ctx.fx || 0), kind: "market", asOf: null };
  }
  const fp = fundPriceValue(asset, ctx.fundPrices?.[asset?.trackCode]);
  if (fp) return fp;
  if (isGemelnetEligible(asset)) {
    const est = estimateBalance(asset, ctx.fundReturnsByTrack?.[asset.trackCode]);
    if (est) return { value: est.estimatedBalance, kind: "estimate", asOf: est.throughYm };
  }
  return { value: asset?.reportBalance || 0, kind: "official", asOf: asset?.reportDate || null };
}

/**
 * יתרת הלוואה מחושבת (שפיצר) = ערך נוכחי של התשלומים שנותרו עד endDate.
 * לא דורס את currentBalance הידני — משמש לבקרה (סטייה בין ידני למחושב).
 * הלוואת בלון/גרייס (התשלום מכסה רק ריבית, הקרן נפרעת בסוף) — אין לוח שפיצר → null.
 * @returns {number|null} null כשחסרים נתונים או כשזו הלוואת בלון
 */
export function loanBalance(loan, asOf = new Date()) {
  const M = loan?.monthlyPayment, end = loan?.endDate ? new Date(loan.endDate) : null;
  if (!M || !end || isNaN(end)) return null;
  const r = (loan.interestRate || 0) / 100 / 12;
  if (r > 0 && loan.currentBalance && M <= loan.currentBalance * r * 1.1) return null; // בלון
  const now = new Date(asOf);
  const n = Math.max(0, (end.getFullYear() - now.getFullYear()) * 12 + (end.getMonth() - now.getMonth()));
  const pv = r > 0 ? M * (1 - Math.pow(1 + r, -n)) / r : M * n;
  return Math.round(pv);
}

/** סכומים לכרטיסי הסיכום. total = הערך המדויק ביותר; officialTotal = לפי דוחות בלבד. */
export function computeTotals(assets = [], loans = [], ctx = {}) {
  let total = 0, officialTotal = 0, estimatedCount = 0, oldestYm = null;
  const byOwner = {}, byCat = {};
  for (const a of assets) {
    const v = assetValue(a, ctx);
    total += v.value;
    officialTotal += a.isMSTY ? v.value : (a.reportBalance || 0);
    if (v.kind === "estimate") {
      estimatedCount++;
      if (!oldestYm || v.asOf < oldestYm) oldestYm = v.asOf;
    }
    byOwner[a.owner] = (byOwner[a.owner] || 0) + v.value;
    byCat[a.category] = (byCat[a.category] || 0) + v.value;
  }
  // ההלוואות: היתרה הידנית היא מקור האמת (ההלוואה נגד הפנסיה שימשה לקניית MSTY)
  const loansBalance = loans.reduce((s, l) => s + (l.currentBalance || 0), 0);
  return { total, officialTotal, estimatedCount, oldestYm, byOwner, byCat, loansBalance, netWorth: total - loansBalance };
}

/** שער יציג לתאריך: אותו יום, או יום המסחר האחרון לפניו (סופ"ש/חג). null אם אין. */
export function rateOn(fxByDate, date) {
  if (!fxByDate || !date) return null;
  if (fxByDate[date] != null) return fxByDate[date];
  const prev = Object.keys(fxByDate).filter(d => d < date).sort().at(-1);
  return prev ? fxByDate[prev] : null;
}

/**
 * כיול: כמה האומדן טעה מול דוח רשמי חדש. מחושב לפני שהיתרה החדשה דורסת את הישנה.
 * משווה רק כשיש תשואות רשמיות עד חודש הדוח החדש (סוף חודש) או עד החודש שלפניו.
 * @returns {{pct:number, estimated:number, actual:number, date:string} | null}
 */
export function estimateDeviation(asset, fundReturnsDoc, actualBalance, actualDate) {
  if (!actualBalance || !actualDate || !asset?.reportDate || actualDate <= asset.reportDate) return null;
  const [y, m, d] = actualDate.split("-").map(Number);
  const endYm = actualDate.slice(0, 7);
  const lastFullYm = d === new Date(y, m, 0).getDate() ? endYm
    : `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}`;
  const monthly = (fundReturnsDoc?.monthly || []).filter(r => r.ym <= lastFullYm);
  const est = estimateBalance(asset, { monthly });
  if (!est || est.throughYm < lastFullYm) return null; // חסרים חודשים — השוואה לא הוגנת
  return {
    pct: Math.round((est.estimatedBalance - actualBalance) / actualBalance * 10000) / 100,
    estimated: est.estimatedBalance, actual: actualBalance, date: actualDate,
  };
}

/** צילום יומי של שווי נטו: מעדכן/מוסיף את רשומת היום, שומר עד max ימים. מחזיר null אם אין שינוי. */
export function upsertDailySnapshot(history = [], entry, max = 730) {
  const last = history.at(-1);
  if (last?.date === entry.date && Math.abs(last.netWorth - entry.netWorth) < 1) return null;
  const next = last?.date === entry.date ? [...history.slice(0, -1), entry] : [...history, entry];
  return next.slice(-max);
}

/** קפיצות חשודות בין ימים עוקבים (ברירת מחדל: מעל 5%) */
export function findJumps(history = [], threshold = 0.05) {
  const jumps = [];
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1].netWorth, cur = history[i].netWorth;
    if (prev && Math.abs(cur / prev - 1) > threshold) jumps.push({ date: history[i].date, from: prev, to: cur, pct: Math.round((cur / prev - 1) * 1000) / 10 });
  }
  return jumps;
}
