/**
 * pdfParser.js – The Compass PDF Analysis Engine v3
 * ---------------------------------------------------
 * KEY INSIGHT (discovered from real PDFs):
 *   pdfjs-dist outputs Hebrew RTL PDFs with a SPACE BETWEEN EVERY CHARACTER.
 *   "מנורה מבטחים" → "מ נ ו ר ה מ ב ט ח י ם"
 *   Numbers (e.g. 657,178) and Latin text appear intact.
 *
 * SECOND INSIGHT: RTL order reversal.
 *   In RTL rows, the number appears BEFORE the Hebrew label:
 *   "657,178   י ת ר ת ה כ ס פ י ם ב ק ר ן ל ת א ר י ך 31/03/2026"
 *
 * SOLUTION: hebrewRx() helper builds a regex that matches a Hebrew string
 *   with \s* between characters, so it works with both spaced and non-spaced output.
 *
 * Supported: מנורה מבטחים, מיטב דש, כלל, אלטשולר שחם, הראל, מגדל, פסגות, הפניקס, ילין לפידות
 */

import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

// ══════════════════════════════════════════════════════════════
//  CORE HELPER — match Hebrew regardless of char-spacing
// ══════════════════════════════════════════════════════════════

/**
 * hebrewRx("מנורה מבטחים") → regex matching:
 *   "מנורה מבטחים"         (normal)
 *   "מ נ ו ר ה מ ב ט ח י ם" (pdfjs spaced output)
 *   "מנורהמבטחים"          (no space)
 */
function hebrewRx(str) {
  const chars = [...str].filter(c => !/\s/.test(c)); // strip whitespace
  return new RegExp(
    chars.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*')
  );
}

// ══════════════════════════════════════════════════════════════
//  INSTITUTION DETECTION
// ══════════════════════════════════════════════════════════════

const INSTITUTIONS = [
  { key: 'מנורה',        patterns: ['מנורה מבטחים', 'מנורה פנסיה', 'Menora', 'menoramivt'] },
  { key: 'מיטב דש',      patterns: ['מיטב דש', 'מיטב גמל', 'מיטב השתלמות', 'Meitav'] },
  { key: 'כלל',          patterns: ['כלל תמר', 'כלל השתלמות', 'כלל גמל', 'Clal'] },
  { key: 'אלטשולר שחם',  patterns: ['אלטשולר שחם', 'אלטשולר', 'as-invest'] },
  { key: 'הראל',         patterns: ['הראל ביטוח', 'הראל גמל', 'הראל פנסיה', 'Harel'] },
  { key: 'מגדל',         patterns: ['מגדל ביטוח', 'מגדל גמל', 'Migdal'] },
  { key: 'פסגות',        patterns: ['פסגות גמל', 'פסגות פנסיה', 'Psagot'] },
  { key: 'אקסלנס',       patterns: ['אקסלנס', 'Excellence'] },
  { key: 'ילין לפידות',  patterns: ['ילין לפידות', 'Yelin Lapidot'] },
  { key: 'הפניקס',       patterns: ['הפניקס', 'Phoenix'] },
];

function detectInstitution(text) {
  for (const { key, patterns } of INSTITUTIONS) {
    for (const p of patterns) {
      // Latin / URL patterns: plain includes; Hebrew: flexible regex
      const isHebrew = /[א-ת]/.test(p);
      if (isHebrew ? hebrewRx(p).test(text) : text.includes(p)) return key;
    }
  }
  return null;
}

// ══════════════════════════════════════════════════════════════
//  REPORT TYPE DETECTION
// ══════════════════════════════════════════════════════════════

function detectReportType(text) {
  // as-invest = אלטשולר ילדים
  if (text.includes('as-invest') || hebrewRx('חיסכון לכל ילד').test(text)) return 'children';
  // פנסיה — matches "קרן פנסיה", "קרן הפנסיה", "קרן הפנסיה החדשה", "פנסיה מבטחים"
  if (hebrewRx('קרן הפנסיה').test(text) || hebrewRx('קרן פנסיה').test(text) || hebrewRx('פנסיה מבטחים').test(text)) return 'pension';
  // השתלמות — must check before gemel (otherwise "גמל" in mixed text wins)
  if (hebrewRx('קרן השתלמות').test(text) || hebrewRx('קרן ההשתלמות').test(text) ||
      hebrewRx('קופת ההשתלמות').test(text) || hebrewRx('קופת השתלמות').test(text)) return 'study_fund';
  if (hebrewRx('קופת הגמל').test(text) || hebrewRx('קופת גמל').test(text) || hebrewRx('גמל להשקעה').test(text)) return 'gemel';
  return 'unknown';
}

// ══════════════════════════════════════════════════════════════
//  NUMBER EXTRACTION
// ══════════════════════════════════════════════════════════════

function parseILNumber(str) {
  const clean = str.replace(/,/g, '').replace(/₪/g, '').trim();
  const val = parseFloat(clean);
  return isNaN(val) ? null : val;
}

function extractAllNumbers(text, minVal = 0, maxVal = 100_000_000) {
  return [...text.matchAll(/([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?)/g)]
    .map(m => parseILNumber(m[1]))
    .filter(v => v !== null && v >= minVal && v <= maxVal);
}

// ══════════════════════════════════════════════════════════════
//  BALANCE EXTRACTION
// ══════════════════════════════════════════════════════════════

function extractBalance(text, reportType, institution) {

  // ── A. קרן פנסיה מנורה ──
  // RTL layout: number appears BEFORE the Hebrew label
  // "657,178   י ת ר ת ה כ ס פ י ם ב ק ר ן ל ת א ר י ך 31/03/2026"
  if (reportType === 'pension' && institution?.includes('מנורה')) {
    // End-of-period balance (correct value)
    const endRx = new RegExp(
      '([0-9]{1,3}(?:,[0-9]{3})*)\\s+' + hebrewRx('יתרת הכספים בקרן לתאריך').source
    );
    const mEnd = text.match(endRx);
    if (mEnd) return parseILNumber(mEnd[1]);

    // Fallback: avoid start-of-year balance
    const startRx = new RegExp(
      '([0-9]{1,3}(?:,[0-9]{3})*)\\s+' + hebrewRx('יתרת הכספים בקרן בתחילת').source
    );
    const mStart = text.match(startRx);

    // Look for any balance line that is NOT the start balance
    const lines = text.split('\n');
    for (const line of lines) {
      if (hebrewRx('יתרת הכספים בקרן').test(line)) {
        const nums = extractAllNumbers(line, 100_000, 5_000_000);
        if (nums.length > 0) {
          // Skip if this is the start-of-year figure
          const startVal = mStart ? parseILNumber(mStart[1]) : null;
          const candidate = nums[0];
          if (!startVal || Math.abs(candidate - startVal) > 1000) return candidate;
        }
      }
    }
  }

  // ── B. קרן השתלמות ──
  // "241,394.39   :הכישמל םוכס ליזנ" (reversed) or forward with hebrewRx
  if (reportType === 'study_fund') {
    const patterns = [
      /([0-9]{2,3},[0-9]{3}\.[0-9]{2})\s*:הכישמל\s+םוכס/,
      new RegExp('([0-9]{2,3},[0-9]{3}(?:\\.[0-9]{2})?)\\s+' + hebrewRx('יתרה לניכוי כספים').source),
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m) return parseILNumber(m[1]);
    }
  }

  // ── C. כ"הס (gemel / general total) ──
  const totalPatterns = [
    /([0-9]{1,3}(?:,[0-9]{3})+\.[0-9]{2})\s+[0-9,.]+\s+[0-9,.]+\s+כ"הס/,
    /([0-9]{1,3}(?:,[0-9]{3})+\.[0-9]{2})\s+[0-9,.]+\s+[0-9,.]+\s+ח"שב כ"הס/,
  ];
  for (const p of totalPatterns) {
    const m = text.match(p);
    if (m) { const v = parseILNumber(m[1]); if (v && v > 1000) return v; }
  }

  // ── D. חיסכון לכל ילד (אלטשולר) ──
  if (reportType === 'children') {
    const childRx = new RegExp(
      '([0-9]{1,2},[0-9]{3})\\s+' + hebrewRx('יתרת הכספים בחשבון בסוף השנה').source
    );
    const m = text.match(childRx);
    if (m) return parseILNumber(m[1]);
  }

  // ── E. מיטב גמל / השתלמות — end balance "יתרת הכספים בחשבון ל-" ──
  // "27,374   י ת ר ת ה כ ס פ י ם ב ח ש ב ו ן ל - 31.03.2026"
  // "235,247  י ת ר ת ה כ ס פ י ם ב ח ש ב ו ן ל - 31.03.2026"
  {
    const meitavEndRx = new RegExp(
      '([0-9]{1,3}(?:,[0-9]{3})*)\\s+' + hebrewRx('יתרת הכספים בחשבון ל').source
    );
    const m = text.match(meitavEndRx);
    if (m) return parseILNumber(m[1]);
  }

  // ── F. Fallback (least preferred) ──
  const allNums = extractAllNumbers(text, 5_000, 5_000_000).filter(n => n > 5000);
  if (allNums.length > 0) return Math.round(allNums[0]);

  return null;
}

// ══════════════════════════════════════════════════════════════
//  FEE EXTRACTION
// ══════════════════════════════════════════════════════════════

function extractFees(text) {
  let feeFromDeposit = null;
  let feeFromBalance = null;

  // RTL layout: percentage appears BEFORE the Hebrew label
  // "1.75%   ד מ י נ י ה ו ל מ ה פ ק ד ה"
  // "0.05%   ד מ י נ י ה ו ל מ ח י ס כ ו ן"

  // Fee from deposit (הפקדה)
  const depositPatterns = [
    new RegExp('([0-9]+\\.?[0-9]*)%\\s+' + hebrewRx('דמי ניהול מהפקדה').source),
    /דמי ניהול מהפקדה[^%0-9]{0,30}([0-9]+\.?[0-9]*)%/,
    /([0-9]+\.?[0-9]*)%\s+הדקפהמ לוהינ ימד/,
    /הדקפהמ לוהינ ימד\s+([0-9]+\.?[0-9]*)%/,
  ];
  for (const p of depositPatterns) {
    const m = text.match(p);
    if (m) { const v = parseFloat(m[1]); if (v >= 0 && v < 5) { feeFromDeposit = v; break; } }
  }

  // Fee from savings / accumulation (חיסכון / צבירה)
  const savingsPatterns = [
    new RegExp('([0-9]+\\.?[0-9]*)%\\s+' + hebrewRx('דמי ניהול מחיסכון').source),
    new RegExp('([0-9]+\\.?[0-9]*)%\\s+' + hebrewRx('דמי ניהול מצבירה').source),
    /דמי ניהול מחיסכון[^%0-9]{0,30}([0-9]+\.?[0-9]*)%/,
    /דמי ניהול מצבירה[^%0-9]{0,30}([0-9]+\.?[0-9]*)%/,
    /ד.נ. מצבירה[^%0-9]{0,20}([0-9]+\.?[0-9]*)%/,
    /([0-9]+\.[0-9]+)%\s+ןוכסיחמ לוהינה ימד רועיש/,
    /([0-9]+\.[0-9]+)%\s+ןוכסיחמ לוהינ ימד/,
    /([0-9]+\.[0-9]+)%\s+(?:ןוכסיחמ|הריבצמ)/,
  ];
  for (const p of savingsPatterns) {
    const m = text.match(p);
    if (m) { const v = parseFloat(m[1]); if (v >= 0 && v < 5) { feeFromBalance = v; break; } }
  }

  return { feeFromDeposit, feeFromBalance };
}

// ══════════════════════════════════════════════════════════════
//  RETURN EXTRACTION
// ══════════════════════════════════════════════════════════════

function extractReturn(text) {
  // RTL layout: "-4.04%   מ ס ל ו ל ע ו ק ב מ ד ד   S&P 500"
  const returnPatterns = [
    // מנורה 2026: "-4.04%   מסלול עוקב מדד S&P 500"
    new RegExp('(-?[0-9]+\\.[0-9]+)%\\s+' + hebrewRx('מסלול עוקב מדד').source),
    /מסלול עוקב מדד\s+(-?[0-9]+\.[0-9]+)%/,
    // V2.9.9 — כלל (לאחר normalizeReversedPercentages): "1.34%   כלל השתלמות כללי"
    //          ולקופת גמל "כלל תמר": "-5.90%   כלל תמר עוקב מדד s&p 500"
    new RegExp('(-?[0-9]+\\.[0-9]+)%\\s+' + hebrewRx('כלל השתלמות').source),
    new RegExp('(-?[0-9]+\\.[0-9]+)%\\s+' + hebrewRx('כלל פנסיה').source),
    new RegExp('(-?[0-9]+\\.[0-9]+)%\\s+' + hebrewRx('כלל גמל').source),
    new RegExp('(-?[0-9]+\\.[0-9]+)%\\s+' + hebrewRx('כלל תמר').source),
    // מיטב: "0.54%   -5.57%   מיטב השתלמות עוקב מדד S&P500"
    // Format: [cost%]  [return%]  [fund name]  S&P
    /[0-9.]+%\s+(-?[0-9]+\.[0-9]+)%\s+(?:[^\n]*?)S&P/i,
    // General forward YTD return patterns
    /תשואה מתחילת שנה[^%0-9]{0,20}(-?[0-9]+\.?[0-9]*)%/,
    /תשואה[^%0-9]{0,20}(-?[0-9]+\.?[0-9]*)%/,
    /שיעור תשואה[^%0-9]{0,20}(-?[0-9]+\.?[0-9]*)%/,
    // אלטשולר ילדים
    /([0-9]+\.[0-9]+)%\s+רבגומ ןוכיס/,
    // Generic reversed
    /([0-9]+\.[0-9]+)%\s+(?:תיתנש האושת|האושת)/,
    /([+-]?[0-9]+\.[0-9]+)%\s+(?:יתנש|יתנש האושת)/,
  ];
  for (const p of returnPatterns) {
    const m = text.match(p);
    if (m) { const v = parseFloat(m[1]); if (v > -50 && v < 200) return v; }
  }
  return null;
}

// ══════════════════════════════════════════════════════════════
//  INVESTMENT TRACK EXTRACTION
// ══════════════════════════════════════════════════════════════

function extractInvestmentTrack(text) {
  if (/S&P\s*500/i.test(text) || hebrewRx('מחקה S&P').test(text)) return 'מחקה S&P 500';
  if (hebrewRx('מסלול עוקב מדד').test(text)) return 'מחקה S&P 500';
  if (text.includes('רבגומ ןוכיס') || text.includes('ריבגמ ןוכיס')) return 'ריסק גבוה';
  if (text.includes('יללכ') || hebrewRx('כללי').test(text)) return 'כללי';
  if (text.includes('הלכה') || hebrewRx('הלכה').test(text)) return 'הלכה';
  return null;
}

// ══════════════════════════════════════════════════════════════
//  OWNER DETECTION
// ══════════════════════════════════════════════════════════════

function detectOwner(text) {
  // Hebrew names appear spaced-out: "צ י ו ן ל ו י"
  if (hebrewRx('הראל לוי').test(text) || hebrewRx('לוי הראל').test(text)) return 'הראל';
  if (hebrewRx('ליאם לוי').test(text) || hebrewRx('לוי ליאם').test(text)) return 'ליאם';
  if (hebrewRx('זיו לוי').test(text)  || hebrewRx('לוי זיו').test(text))  return 'זיו';
  if (hebrewRx('ציון לוי').test(text) || hebrewRx('לוי ציון').test(text)) return 'ציון';
  return null;
}

// ══════════════════════════════════════════════════════════════
//  DATE EXTRACTION
// ══════════════════════════════════════════════════════════════

function extractReportDate(text) {
  // Label patterns — the date itself (DD/MM/YYYY or DD.MM.YYYY) is always intact
  const dateRx = '([0-9]{2}[/.]([0-9]{2})[/.]([0-9]{4}))';

  // Forward Hebrew label (spaced or not): "תאריך תקופת הדוח: 31/03/2026"
  const labelPatterns = [
    new RegExp(hebrewRx('תאריך תקופת הדוח').source + '[:\\s]+' + dateRx),
    new RegExp(hebrewRx('תקופת הדוח').source + '[:\\s]+' + dateRx),
    new RegExp(hebrewRx('תאריך הדוח').source + '[:\\s]+' + dateRx),
    // Reversed Hebrew
    /([0-9]{2})\.([0-9]{2})\.([0-9]{4})\s*:חודה (?:ךיראת|תפוקת)/,
    /([0-9]{2})\/([0-9]{2})\/([0-9]{4})\s*:(?:חודה|הדוח)/,
    // Generic fallback
    /([0-9]{2})\.([0-9]{2})\.([0-9]{4})/,
  ];

  for (const p of labelPatterns) {
    const m = text.match(p);
    if (!m) continue;
    // The labeled patterns capture the full date in m[1], then month/year in m[2]/m[3]
    // The simple patterns capture day/month/year in m[1]/m[2]/m[3]
    if (m[1] && m[1].includes('/') && m[1].length === 10) {
      // Full date DD/MM/YYYY in m[1]
      const [day, month, year] = m[1].split('/');
      return `${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`;
    }
    if (m[1] && m[1].includes('.') && m[1].length === 10) {
      const [day, month, year] = m[1].split('.');
      return `${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`;
    }
    // Simple patterns: m[1]=day, m[2]=month, m[3]=year
    if (m[3] && m[3].length === 4) {
      return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
    }
  }
  return null;
}

// ══════════════════════════════════════════════════════════════
//  TEXT EXTRACTION FROM PDF
// ══════════════════════════════════════════════════════════════

/**
 * V2.9.9 — תיקון מספרים-באחוז הפוכים (RTL) בדוחות כלל
 *   "% 4 3 . 1" → "1.34%"
 *   "% 4 3 . 2 1" → "12.34%"
 *   "ן % 2 5 . 0"  → "0.52%"
 * הסיבה: pdfjs קורא תאי טבלה במצב RTL ישראלי בסדר ויזואלי, אז מספרים בתוך
 * תא מימיני למילים עבריות יוצאים הפוכים. שאר ה-PDF-ים (מנורה, מיטב) לא סובלים
 * מזה כי המספרים בתאים נפרדים מספיק.
 */
function normalizeReversedPercentages(text) {
  // צורה הפוכה: "% 4 3 . 1"            (= +1.34%)
  // צורה שלילית: "% 0 9 . 5 -"          (= -5.90%) — המינוס נכתב אחרי הספרות ב-RTL
  return text.replace(
    /%\s+((?:\d\s*){1,3})\.\s*((?:\d\s*){1,3})\s*(-?)(?=\s|$)/g,
    (match, decPartRaw, wholePartRaw, sign) => {
      const dec   = decPartRaw.replace(/\s+/g, '').split('').reverse().join('');
      const whole = wholePartRaw.replace(/\s+/g, '').split('').reverse().join('');
      if (!whole || !dec) return match;
      return `${sign}${whole}.${dec}%`;
    }
  );
}

async function extractTextFromPDF(arrayBuffer) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const maxPages = Math.min(pdf.numPages, 20);

  let fullText = '';
  const pageTexts = [];

  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map(item => item.str).join(' ');
    pageTexts.push(pageText);
    fullText += pageText + '\n';
  }

  // V2.9.9 — נרמל מספרים הפוכים (RTL) לפני שאר העיבוד
  fullText = normalizeReversedPercentages(fullText);

  return { fullText, pageTexts, numPages: pdf.numPages };
}

// ══════════════════════════════════════════════════════════════
//  MAIN PARSER
// ══════════════════════════════════════════════════════════════

export async function parsePDF(file) {
  const fileName = file.name;
  const warnings = [];

  const arrayBuffer = await file.arrayBuffer();
  const { fullText } = await extractTextFromPDF(arrayBuffer);

  if (!fullText.trim()) {
    return {
      institution: null, reportType: null, reportDate: null, owner: null,
      balance: null, feeFromDeposit: null, feeFromBalance: null,
      annualReturn: null, investmentTrack: null,
      rawPreview: '', fileName, confidence: 'low',
      warnings: ['הקובץ ריק או סרוק – לא ניתן לחלץ טקסט. נדרש PDF עם שכבת טקסט.'],
    };
  }

  const institution    = detectInstitution(fullText);
  const reportType     = detectReportType(fullText);
  const reportDate     = extractReportDate(fullText);
  const owner          = detectOwner(fullText);
  const balance        = extractBalance(fullText, reportType, institution);
  const { feeFromDeposit, feeFromBalance } = extractFees(fullText);
  const annualReturn   = extractReturn(fullText);
  const investmentTrack = extractInvestmentTrack(fullText);

  if (!institution)  warnings.push('לא זוהתה חברה מנהלת.');
  if (!balance)      warnings.push('לא נמצאה יתרה/צבירה.');
  if (feeFromDeposit === null && feeFromBalance === null) warnings.push('לא נמצאו דמי ניהול.');

  const fieldsFound = [institution, balance, feeFromDeposit ?? feeFromBalance ?? null].filter(v => v !== null).length;
  const confidence  = fieldsFound >= 3 ? 'high' : fieldsFound >= 2 ? 'medium' : 'low';

  return {
    institution,
    reportType,
    reportDate,
    owner,
    balance,
    feeFromDeposit,
    feeFromBalance,
    annualReturn,
    investmentTrack,
    rawPreview: fullText.slice(0, 500),
    fileName,
    confidence,
    warnings,
  };
}

export async function parsePDFBatch(files) {
  return Promise.all(Array.from(files).map(parsePDF));
}
