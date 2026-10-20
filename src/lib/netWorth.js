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
 * @param {object} asset
 * @param {{mstyPrice?:number, fx?:number, fundReturnsByTrack?:object}} ctx
 * @returns {{value:number, kind:"market"|"estimate"|"official", asOf:string|null}}
 */
export function assetValue(asset, ctx = {}) {
  if (asset?.isMSTY) {
    return { value: (asset.sharesCount || 0) * (ctx.mstyPrice || 0) * (ctx.fx || 0), kind: "market", asOf: null };
  }
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
