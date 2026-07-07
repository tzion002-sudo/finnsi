// ═══════════════════════════════════════════════════════════════
//  fundEstimate.js — V3.0 · אומדן יתרת קופה בין דוחות PDF
//
//  פונקציה טהורה: מחשבת יתרה משוערת = יתרת ה-PDF האחרונה × תשואות
//  חודשיות מגמל-נט שפורסמו אחריה. זהו ערך תצוגה בלבד — אף פעם לא
//  דורס את reportBalance (השדה הרשמי, המבוסס-PDF, נשאר תמיד המקור הרשמי).
//
//  allowlist מפורש (לא כל trackCode): גמל-נט מכסה רק גמל/השתלמות/
//  חיסכון-ילד — לא פנסיה (פנסיה-נט, מערכת נפרדת) ולא קרן כספית
//  (קרן נאמנות, מערכת נפרדת). אומת ידנית ב-07/2026 מול 7 המסלולים —
//  שמות הקרנות שהתקבלו תואמים בדיוק את המוסדות שלנו.
// ═══════════════════════════════════════════════════════════════

export const GEMELNET_ELIGIBLE_TRACKS = [13245, 13246, 13342, 13343, 11327, 15738, 15739];

export function isGemelnetEligible(asset) {
  return !!asset?.trackCode && GEMELNET_ELIGIBLE_TRACKS.includes(asset.trackCode);
}

/**
 * מחשב יתרה משוערת לנכס בודד מרשימת תשואות חודשיות של גמל-נט.
 * @param {{reportBalance:number, reportDate:string}} asset
 * @param {{monthly: Array<{ym:string, pct:number}>}} fundReturnsDoc
 * @returns {{estimatedBalance:number, throughYm:string, monthsApplied:number} | null}
 */
export function estimateBalance(asset, fundReturnsDoc) {
  if (!asset?.reportBalance || !asset?.reportDate) return null;
  const monthly = fundReturnsDoc?.monthly;
  if (!Array.isArray(monthly) || monthly.length === 0) return null;

  const reportYm = asset.reportDate.slice(0, 7); // "YYYY-MM-DD" → "YYYY-MM"
  const relevant = monthly
    .filter(m => m?.ym > reportYm && Number.isFinite(m?.pct))
    .sort((a, b) => a.ym.localeCompare(b.ym));
  if (relevant.length === 0) return null;

  let balance = asset.reportBalance;
  for (const m of relevant) balance *= 1 + m.pct / 100;

  return {
    estimatedBalance: Math.round(balance * 100) / 100,
    throughYm: relevant[relevant.length - 1].ym,
    monthsApplied: relevant.length,
  };
}
