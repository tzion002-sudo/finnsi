// ═══════════════════════════════════════════════════════════════
//  dividendSync.js — V3.0 · סנכרון דיבידנדים server-authoritative
//
//  פונקציה טהורה (ללא Firebase, ללא React) — ניתנת לבדיקה ב-vitest.
//  הסקנר כותב את הרשימה המלאה ל-market_data/msty_dividends;
//  ה-Dashboard מריץ reconcileDividends בכל עדכון ומיישם בשקט.
//
//  עקרונות (החלטות מועצת V3.0):
//  • התאמה גמישה: exDate מדויק, או |Δ| ≤ 2 ימים עם אותו סכום —
//    כדי שתיקון תאריך רטרואקטיבי במקור לא ייצור כפילות (באג V2.9.1).
//  • מחיקה ידנית = tombstone. דיבידנד שנמחק לא חוזר לעולם.
//  • עריכה ידנית (verified:true) מנצחת את השרת.
//  • אידמפוטנטי: הרצה חוזרת על אותו קלט לא משנה דבר.
//  • רצפת תאריך: לא מסנכרנים דיבידנדים מלפני תחילת ההחזקה
//    (רשימת השרת מכילה את כל ההיסטוריה של הקרן).
// ═══════════════════════════════════════════════════════════════

const SPLIT_DATE = "2025-12-08"; // reverse split 1:5

const MS_PER_DAY = 86400000;
const AMOUNT_EPSILON = 0.0005;

/** הפרש ימים מוחלט בין שני תאריכי ISO (YYYY-MM-DD) */
function daysApart(a, b) {
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (isNaN(ta) || isNaN(tb)) return Infinity;
  return Math.abs(ta - tb) / MS_PER_DAY;
}

function sameAmount(a, b) {
  return a != null && b != null && Math.abs(a - b) < AMOUNT_EPSILON;
}

/**
 * התאמה בין דיבידנד שרת לרשומה (לוקאלית או tombstone):
 * תאריך זהה, או תאריך קרוב (≤ 2 ימים) עם סכום זהה.
 * @param {string} serverDate  exDate של השרת
 * @param {number} serverAmount
 * @param {string} candDate    תאריך המועמד (date/exDate)
 * @param {number} candAmount
 */
export function isMatch(serverDate, serverAmount, candDate, candAmount) {
  if (!serverDate || !candDate) return false;
  if (serverDate === candDate) return true;
  return daysApart(serverDate, candDate) <= 2 && sameAmount(serverAmount, candAmount);
}

/**
 * מסנכרן את רשימת הדיבידנדים הלוקאלית מול רשימת השרת.
 *
 * @param {Array<{exDate:string, payDate?:string, amount:number, status?:string, source?:string}>} serverList
 *        הרשימה מ-market_data/msty_dividends (מקור האמת)
 * @param {Array<{date:string, amount:number, verified?:boolean, status?:string}>} localList
 *        mstyDividends הנוכחי מה-settings
 * @param {Array<{exDate:string, amount?:number}>} tombstones
 *        settings.deletedDividends — מחיקות ידניות שאסור להחיות
 * @param {{fallbackMinDate?: string}} [options]
 *        רצפת תאריך כשאין רשומות לוקאליות (ברירת מחדל: "2025-06-01")
 * @returns {{merged: Array, added: Array, updated: Array, changed: boolean}}
 */
export function reconcileDividends(serverList, localList, tombstones, options = {}) {
  const server = Array.isArray(serverList) ? serverList : [];
  const local  = Array.isArray(localList)  ? localList  : [];
  const tombs  = Array.isArray(tombstones) ? tombstones : [];
  const fallbackMinDate = options.fallbackMinDate ?? "2025-06-01";

  // רצפת סנכרון: התאריך המוקדם ביותר שקיים לוקאלית, או ברירת המחדל.
  // מונע הצפה של כל ההיסטוריה של הקרן (לפני תחילת ההחזקה).
  const earliestLocal = local.reduce(
    (min, d) => (d?.date && (!min || d.date < min) ? d.date : min), null);
  const minDate = earliestLocal ?? fallbackMinDate;

  const merged  = local.map(d => ({ ...d }));
  const added   = [];
  const updated = [];

  for (const sd of server) {
    if (!sd?.exDate || sd.amount == null) continue;
    if (sd.exDate < minDate) continue;

    // מחיקה ידנית מנצחת — לא מחיים tombstone
    const isDeleted = tombs.some(t => isMatch(sd.exDate, sd.amount, t?.exDate ?? t?.date, t?.amount));
    if (isDeleted) continue;

    const existing = merged.find(d => isMatch(sd.exDate, sd.amount, d?.date, d?.amount));
    if (existing) {
      // עריכה ידנית (verified) מנצחת את השרת
      if (existing.verified === true) continue;
      const wants = {
        date:   sd.exDate,
        amount: sd.amount,
        status: sd.status === "confirmed" ? "confirmed" : (existing.status ?? sd.status ?? "estimate"),
      };
      if (existing.date !== wants.date || !sameAmount(existing.amount, wants.amount) || existing.status !== wants.status) {
        existing.date   = wants.date;
        existing.amount = wants.amount;
        existing.status = wants.status;
        existing.source = "auto_sync";
        updated.push({ ...existing });
      }
      continue;
    }

    // דיבידנד חדש מהשרת
    const status = sd.status === "confirmed" ? "confirmed"
      : new Date(sd.exDate) > new Date() ? "estimate" : "confirmed";
    const entry = {
      date:       sd.exDate,
      amount:     sd.amount,
      verified:   false,
      status,
      shareBasis: sd.exDate < SPLIT_DATE ? "pre" : "post",
      source:     "auto_sync",
      note:       "סנכרון אוטומטי מהסקנר",
    };
    merged.push(entry);
    added.push(entry);
  }

  merged.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  return { merged, added, updated, changed: added.length > 0 || updated.length > 0 };
}
