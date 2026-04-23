/**
 * gemelnetParser.js — מנתח קבצי CSV/XLSX של גמל-נט
 * ────────────────────────────────────────────────────────
 * מקור: http://gemelnet.cma.gov.il/
 * פורמט קובץ צפוי: CSV או XLSX עם כותרות בעברית
 *
 * עמודות מרכזיות (שמות נפוצים):
 *   - "מספר קופה" / "מספר מסלול" / "מזהה מסלול" → trackCode
 *   - "שם קופה" / "שם מסלול"
 *   - "תשואה נומינלית ברוטו לחודש" / "תשואה חודשית" → monthlyReturn
 *   - "תשואה מצטברת מתחילת שנה" / "YTD" → ytdReturn
 *   - "דמי ניהול מהצבירה" / "דמי ניהול ממצבר"
 *   - "דמי ניהול מהפקדה"
 *
 * שימוש:
 *   const text = await file.text();                     // CSV
 *   const rows = parseGemelNetCSV(text);                // [{trackCode, monthlyReturn, ytdReturn, ...}]
 *   const update = applyGemelnetToAssets(assets, rows); // מעדכן את היתרות
 */

// ────────── קריאת CSV בסיסית (ללא תלות) ──────────
export function parseCSV(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (!lines.length) return [];
  // Gemel-Net מפיק לפעמים עם פסיקים או טאבים
  const firstLine = lines[0];
  const sep = firstLine.includes('\t') ? '\t' : ',';
  const headers = splitCSVLine(firstLine, sep);
  return lines.slice(1).map(line => {
    const vals = splitCSVLine(line, sep);
    const row = {};
    headers.forEach((h, i) => { row[h.trim()] = (vals[i] ?? '').trim(); });
    return row;
  });
}

/** מפצל שורת CSV עם תמיכה בציטוטים */
function splitCSVLine(line, sep) {
  const out = [];
  let cur = '', inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQuote = !inQuote; continue; }
    if (c === sep && !inQuote) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

// ────────── זיהוי עמודות לפי שם (fuzzy) ──────────
function findKey(row, patterns) {
  const keys = Object.keys(row);
  for (const pat of patterns) {
    const k = keys.find(x => x.includes(pat));
    if (k) return k;
  }
  return null;
}

const TRACK_COL_PATTERNS  = ['מספר קופה', 'מספר מסלול', 'מזהה מסלול', 'מסלול', 'קופה'];
const NAME_COL_PATTERNS   = ['שם קופה', 'שם מסלול', 'שם'];
const MONTHLY_PATTERNS    = ['נומינלית ברוטו לחודש', 'תשואה חודשית', 'תשואה לחודש', 'חודש'];
const YTD_PATTERNS        = ['מתחילת שנה', 'YTD', 'מצטברת'];
const FEE_BAL_PATTERNS    = ['דמי ניהול מהצבירה', 'דמי ניהול מצבירה', 'מצבירה'];
const FEE_DEP_PATTERNS    = ['דמי ניהול מהפקדה', 'דמי ניהול מהפקדות', 'מהפקדה'];

/** מנקה ערך מספרי ישראלי ("12.34%" / "1,234.56" / "−0.5") */
function toNum(s) {
  if (s == null || s === '') return null;
  const clean = String(s).replace(/[%,\s]/g, '').replace(/[−‒–]/g, '-');
  const n = parseFloat(clean);
  return Number.isFinite(n) ? n : null;
}

/** פירוס שורות CSV של גמל-נט לפורמט סטנדרטי */
export function parseGemelNetCSV(text) {
  const rows = parseCSV(text);
  if (!rows.length) return [];

  const sample = rows[0];
  const trackKey   = findKey(sample, TRACK_COL_PATTERNS);
  const nameKey    = findKey(sample, NAME_COL_PATTERNS);
  const monthlyKey = findKey(sample, MONTHLY_PATTERNS);
  const ytdKey     = findKey(sample, YTD_PATTERNS);
  const feeBalKey  = findKey(sample, FEE_BAL_PATTERNS);
  const feeDepKey  = findKey(sample, FEE_DEP_PATTERNS);

  if (!trackKey) {
    console.warn('Gemel-Net parser: לא נמצאה עמודת trackCode. עמודות שזוהו:', Object.keys(sample));
    return [];
  }

  return rows.map(r => ({
    trackCode:       parseInt(toNum(r[trackKey])),
    fundName:        nameKey ? r[nameKey] : '',
    monthlyReturn:   monthlyKey ? toNum(r[monthlyKey]) : null, // באחוזים
    ytdReturn:       ytdKey     ? toNum(r[ytdKey])     : null,
    feeFromBalance:  feeBalKey  ? toNum(r[feeBalKey])  : null,
    feeFromDeposit:  feeDepKey  ? toNum(r[feeDepKey])  : null,
    _raw: r,
  })).filter(r => !isNaN(r.trackCode));
}

// ────────── מיפוי ל-assets קיימים ──────────
/**
 * @param {Array} assets - מערך הנכסים במערכת
 * @param {Array} gemelnetRows - תוצאה של parseGemelNetCSV
 * @returns {Array} - נכסים מעודכנים (לא מחליף — מחזיר עותק)
 *
 * פעולת החישוב:
 *   newBalance = oldBalance × (1 + monthlyReturn/100) + monthlyDeposits
 *
 * אם יש ytdReturn → נשמר ב-`ytdReturnFromGemelnet` להצגה.
 */
export function applyGemelnetToAssets(assets, gemelnetRows, options = {}) {
  const { updateDate = new Date().toISOString().slice(0, 10) } = options;
  const byTrack = new Map(gemelnetRows.map(r => [r.trackCode, r]));

  return assets.map(a => {
    if (!a.trackCode) return a;
    const g = byTrack.get(a.trackCode);
    if (!g) return a;

    const ret    = (g.monthlyReturn || 0) / 100;
    const growth = (a.reportBalance || 0) * ret;
    const monthly = (a.employeeDeposit || 0) + (a.employerDeposit || 0) + (a.severanceDeposit || 0);
    const newBalance = (a.reportBalance || 0) + growth + monthly;

    return {
      ...a,
      reportBalance: Math.round(newBalance * 100) / 100,
      amount:        Math.round(newBalance * 100) / 100,
      reportDate:    updateDate,
      checkDate:     updateDate,
      ytdReturnFromGemelnet: g.ytdReturn,
      monthlyReturnFromGemelnet: g.monthlyReturn,
      source:        'gemelnet',
      _gemelnetApplied: { monthlyReturn: g.monthlyReturn, ytdReturn: g.ytdReturn, growth, deposit: monthly, date: updateDate },
    };
  });
}

/** סיכום תוצאות עדכון — לדיאלוג אישור */
export function gemelnetSummary(assets, gemelnetRows) {
  const byTrack = new Map(gemelnetRows.map(r => [r.trackCode, r]));
  const matched = [];
  const unmatched = [];
  assets.forEach(a => {
    if (!a.trackCode) return;
    const g = byTrack.get(a.trackCode);
    if (g) {
      const ret = (g.monthlyReturn || 0) / 100;
      const growth = (a.reportBalance || 0) * ret;
      matched.push({
        trackCode:    a.trackCode,
        type:         a.type,
        owner:        a.owner,
        oldBalance:   a.reportBalance,
        monthlyReturn: g.monthlyReturn,
        ytdReturn:    g.ytdReturn,
        growth,
        newBalance:   (a.reportBalance || 0) + growth + ((a.employeeDeposit||0) + (a.employerDeposit||0) + (a.severanceDeposit||0)),
      });
    }
  });
  gemelnetRows.forEach(r => {
    if (!assets.find(a => a.trackCode === r.trackCode)) unmatched.push(r);
  });
  return { matched, unmatched, totalRows: gemelnetRows.length };
}

// ────────── עזר: קישור והוראות ──────────
export const GEMELNET_URL     = 'http://gemelnet.cma.gov.il/';
export const GEMELNET_URL_NEW = 'https://gemelnetmain.cma.gov.il/';
export const GEMELNET_INSTRUCTIONS = `
1. היכנס ל-${GEMELNET_URL_NEW}
2. בתפריט בחר: "תשואות והחזקות" → "הורדת תשואות לקובץ"
3. הורד את הקובץ החודשי (CSV)
4. חזור לאפליקציה ולחץ "העלאת נתוני גמל-נט"
`.trim();
