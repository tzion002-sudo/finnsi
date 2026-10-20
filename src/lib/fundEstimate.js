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

export const GEMELNET_ELIGIBLE_TRACKS = [13245, 13246, 13342, 13343, 11327, 15738, 15739,
  456,    // כלל השתלמות כללי (זיו, חשבון 9968410) — אומת מול דוח כלל 30/06/2026
  13887]; // 13887 = פנסיה (מנורה) — מגיע מפנסיה-נט, לא מגמל-נט; אותו pipeline (fund_returns)

export function isGemelnetEligible(asset) {
  return !!asset?.trackCode && GEMELNET_ELIGIBLE_TRACKS.includes(asset.trackCode);
}

/**
 * מחשב יתרה משוערת לנכס בודד: גלגול קדימה של יתרת הדוח לפי תשואות רשמיות.
 * לכל חודש: יתרה × (1+תשואה) × (1 − דמי ניהול מצבירה/12) + הפקדות × (1 − דמי ניהול מהפקדה).
 * התשואה בגמל-נט/פנסיה-נט היא לפני דמי ניהול — לכן מנכים feeFromBalance.
 * חודש הדוח עצמו נכלל באופן יחסי לימים שנותרו בו (דוח ב-17.04 → 13/30 מאפריל).
 * @param {{reportBalance:number, reportDate:string, employeeDeposit?:number, employerDeposit?:number,
 *          severanceDeposit?:number, feeFromBalance?:number, feeFromDeposit?:number}} asset
 * @param {{monthly: Array<{ym:string, pct:number}>}} fundReturnsDoc
 * @returns {{estimatedBalance:number, throughYm:string, monthsApplied:number} | null}
 */
export function estimateBalance(asset, fundReturnsDoc) {
  if (!asset?.reportBalance || !asset?.reportDate) return null;
  const monthly = fundReturnsDoc?.monthly;
  if (!Array.isArray(monthly) || monthly.length === 0) return null;

  const reportYm = asset.reportDate.slice(0, 7); // "YYYY-MM-DD" → "YYYY-MM"
  const [y, mo, d] = asset.reportDate.split("-").map(Number);
  const daysInMonth = new Date(y, mo, 0).getDate();
  const firstFraction = Math.max(0, (daysInMonth - d) / daysInMonth); // סוף חודש → 0

  const relevant = monthly
    .filter(m => Number.isFinite(m?.pct) && (m?.ym > reportYm || (m?.ym === reportYm && firstFraction > 0)))
    .sort((a, b) => a.ym.localeCompare(b.ym));
  if (relevant.length === 0) return null;

  const deposits = (asset.employeeDeposit || 0) + (asset.employerDeposit || 0) + (asset.severanceDeposit || 0);
  const netDeposit = deposits * (1 - (asset.feeFromDeposit || 0) / 100);
  const monthlyFee = (asset.feeFromBalance || 0) / 100 / 12;

  let balance = asset.reportBalance;
  for (const m of relevant) {
    const f = m.ym === reportYm ? firstFraction : 1;
    balance = balance * Math.pow((1 + m.pct / 100) * (1 - monthlyFee), f) + netDeposit * f;
  }

  return {
    estimatedBalance: Math.round(balance * 100) / 100,
    throughYm: relevant[relevant.length - 1].ym,
    monthsApplied: relevant.length,
  };
}
