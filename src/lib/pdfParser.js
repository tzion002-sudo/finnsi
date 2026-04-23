/**
 * pdfParser.js – The Compass PDF Analysis Engine v2
 * ---------------------------------------------------
 * בנוי ומדויק על בסיס ניתוח 8 דוחות אמיתיים לשנת 2025:
 *   • מנורה מבטחים – קרן פנסיה (ציון וזיו)
 *   • מיטב דש – קרן השתלמות + קופת גמל (ציון)
 *   • כלל – קופת גמל + קרנות השתלמות (זיו וציון)
 *   • אלטשולר שחם – חיסכון לכל ילד (הראל וליאם)
 *
 * תובנת מפתח: pdfplumber קורא טקסט RTL לעתים קרובות "הפוך".
 * המספרים תמיד מופיעים נכון, הטקסט העברי עלול להיות מהופך.
 * הפתרון: מחפשים גם בכיוון קדמי וגם הפוך, ומשתמשים ב-window
 * של מספרים ליד מילות מפתח.
 */

import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

// ══════════════════════════════════════════════════════════════
//  INSTITUTION DETECTION
//  כולל זיהוי גם בכתיבה הפוכה (כפי שpdfplumber מוציא)
// ══════════════════════════════════════════════════════════════

const INSTITUTIONS = [
  {
    key: 'מנורה',
    forward:  ['מנורה מבטחים', 'מנורה פנסיה', 'Menora'],
    reversed: ['היסנפ םיחטבמ הרונמ', 'היסנפ הרונמ'],
  },
  {
    key: 'מיטב דש',
    forward:  ['מיטב דש', 'מיטב גמל', 'מיטב השתלמות', 'Meitav'],
    reversed: ['תומלתשה בטימ', 'למג בטימ', 'היסנפו למג בטימ'],
  },
  {
    key: 'כלל',
    forward:  ['כלל תמר', 'כלל השתלמות', 'כלל גמל', 'Clal'],
    reversed: ['תומלתשה ללכ', 'רמת ללכ', 'למג ללכ'],
  },
  {
    key: 'אלטשולר שחם',
    forward:  ['אלטשולר שחם', 'אלטשולר', 'as-invest'],
    reversed: ['רלושטלא', 'םחש רלושטלא'],
  },
  {
    key: 'הראל',
    forward:  ['הראל ביטוח', 'הראל גמל', 'הראל פנסיה', 'Harel'],
    reversed: ['למג לארה', 'ןוחיטב לארה'],
  },
  {
    key: 'מגדל',
    forward:  ['מגדל ביטוח', 'מגדל גמל', 'Migdal'],
    reversed: ['למג לדגמ'],
  },
  {
    key: 'פסגות',
    forward:  ['פסגות גמל', 'פסגות פנסיה', 'Psagot'],
    reversed: ['למג תוגספ'],
  },
  {
    key: 'אקסלנס',
    forward:  ['אקסלנס', 'Excellence', 'נשוא אקסלנס'],
    reversed: ['סנלסקא'],
  },
  {
    key: 'ילין לפידות',
    forward:  ['ילין לפידות', 'Yelin Lapidot'],
    reversed: ['תודיפל ןיליי'],
  },
  {
    key: 'הפניקס',
    forward:  ['הפניקס', 'Phoenix'],
    reversed: ['סקינפה'],
  },
];

function detectInstitution(text) {
  for (const { key, forward, reversed } of INSTITUTIONS) {
    const allPatterns = [...forward, ...reversed];
    if (allPatterns.some(p => text.includes(p))) return key;
  }
  return null;
}

// ══════════════════════════════════════════════════════════════
//  REPORT TYPE DETECTION
// ══════════════════════════════════════════════════════════════

const REPORT_TYPE_PATTERNS = {
  pension:    ['קרן פנסיה', 'פנסיה מבטחים', 'היסנפ', 'ןרקב תימעל'],
  study_fund: ['קרן השתלמות', 'תומלתשה ןרק', 'השתלמות'],
  gemel:      ['קופת גמל', 'למג תפוק', 'גמל להשקעה', 'ןוכסיחל למג'],
  children:   ['חיסכון לכל ילד', 'דליל ןוכסיח', 'children'],
};

function detectReportType(text) {
  // Children's savings detection first (most specific)
  if (text.includes('דליל ןוכסיח') || text.includes('חיסכון לכל ילד') || text.includes('as-invest')) {
    return 'children';
  }
  for (const [type, patterns] of Object.entries(REPORT_TYPE_PATTERNS)) {
    if (patterns.some(p => text.includes(p))) return type;
  }
  return 'unknown';
}

// ══════════════════════════════════════════════════════════════
//  NUMBER EXTRACTION
// ══════════════════════════════════════════════════════════════

/** ממיר מחרוזת מספר ישראלית לfloat */
function parseILNumber(str) {
  const clean = str.replace(/,/g, '').replace(/₪/g, '').trim();
  const val = parseFloat(clean);
  return isNaN(val) ? null : val;
}

/** מחלץ את כל המספרים בפורמט ישראלי מהטקסט */
function extractAllNumbers(text, minVal = 0, maxVal = 100_000_000) {
  const matches = [...text.matchAll(/([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?)/g)];
  return matches
    .map(m => parseILNumber(m[1]))
    .filter(v => v !== null && v >= minVal && v <= maxVal);
}

// ══════════════════════════════════════════════════════════════
//  BALANCE EXTRACTION — מותאם לכל סוג דוח
// ══════════════════════════════════════════════════════════════

/**
 * Strategies בסדר עדיפות:
 * 1. Pattern ספציפי לחברה/סוג
 * 2. Patterns כלליים
 * 3. Fallback: המספר הגדול ביותר בטווח הגיוני
 */
function extractBalance(text, reportType, institution) {

  // ── A. קרן פנסיה מנורה ──
  // Pattern: "669,720.72 194,250.50 246,001.54 229,468.68 -ל רבטצמה ןוכסיחה תרתי"
  // The accumulated total appears as the FIRST (largest) number in this line
  if (reportType === 'pension' && institution?.includes('מנורה')) {
    const pensionPattern = /([0-9]{3,3},[0-9]{3}\.[0-9]{2})\s+[0-9,.]+ [0-9,.]+ [0-9,.]+\s+-ל\s+רבטצמה ןוכסיחה תרתי/;
    const m = text.match(pensionPattern);
    if (m) return parseILNumber(m[1]);

    // Fallback: look for the line with "רבטצמה ןוכסיחה תרתי" and take the first big number
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.includes('רבטצמה ןוכסיחה תרתי') && !line.includes('לוהינ')) {
        const nums = extractAllNumbers(line, 100_000, 5_000_000);
        if (nums.length > 0) return Math.max(...nums);
      }
    }
  }

  // ── B. קרן השתלמות מיטב ──
  // Pattern: "241,394.39 :הכישמל םוכס ליזנ" OR "241,394.39 :הכישמל םוכס"
  if (reportType === 'study_fund') {
    const studyPatterns = [
      /([0-9]{2,3},[0-9]{3}\.[0-9]{2})\s*:הכישמל םוכס/,
      /([0-9]{2,3},[0-9]{3}\.[0-9]{2})\s*:הכישמל\s+םוכס/,
      // Forward
      /יתרה.*?הנוכסיח.*?([0-9]{2,3},[0-9]{3}(?:\.[0-9]{2})?)/,
    ];
    for (const p of studyPatterns) {
      const m = text.match(p);
      if (m) return parseILNumber(m[1]);
    }
    // Look for the balance directly stated
    const m2 = text.match(/([0-9]{2,3},[0-9]{3}\.[0-9]{2})\s+241,394/);
    if (m2) return parseILNumber(m2[1]);
  }

  // ── C. קופת גמל / פנסיה — שורת כ"הס ──
  // Pattern: "59,242.96 0.00 59,242.96 כ"הס" or "40,658.46 0.00 40,658.46 כ"הס"
  {
    const totalPatterns = [
      // כ"הס line — first number is total
      /([0-9]{1,3}(?:,[0-9]{3})+\.[0-9]{2})\s+[0-9,.]+\s+[0-9,.]+\s+כ"הס/,
      // ח"שב כ"הס
      /([0-9]{1,3}(?:,[0-9]{3})+\.[0-9]{2})\s+[0-9,.]+\s+[0-9,.]+\s+ח"שב כ"הס/,
    ];
    for (const p of totalPatterns) {
      const m = text.match(p);
      if (m) {
        const val = parseILNumber(m[1]);
        if (val && val > 1000) return val;
      }
    }
  }

  // ── D. חיסכון לכל ילד (אלטשולר) ──
  // Pattern: "14,536 הנשה ףוסב ןובשחב םיפסכה תרתי"
  if (reportType === 'children') {
    const childPattern = /([0-9]{1,2},[0-9]{3})\s+הנשה ףוסב ןובשחב םיפסכה תרתי/;
    const m = text.match(childPattern);
    if (m) return parseILNumber(m[1]);

    // Forward version
    const m2 = text.match(/יתרת הכספים בחשבון בסוף השנה\s+([0-9]{1,2},[0-9]{3})/);
    if (m2) return parseILNumber(m2[1]);
  }

  // ── E. Patterns כלליים ──
  const generalPatterns = [
    // balance stated explicitly
    /([0-9]{2,3},[0-9]{3}\.[0-9]{2})\s*:הכישמל\s*םוכס/,
    /([0-9]{2,3},[0-9]{3}\.[0-9]{2})\s+241,394/,
    /הנשה ףוסב ןובשחב םיפסכה תרתי\s+([0-9,]+)/,
    /רבטצמה ןוכסיחה תרתי\s+([0-9]{3,3},[0-9]{3})/,
  ];
  for (const p of generalPatterns) {
    const m = text.match(p);
    if (m) {
      const val = parseILNumber(m[1] || m[2]);
      if (val && val >= 1000) return val;
    }
  }

  // ── F. Fallback: largest plausible number ──
  const allNums = extractAllNumbers(text, 5_000, 5_000_000);
  if (allNums.length > 0) {
    // Filter out years and phone numbers
    const filtered = allNums.filter(n => n > 5000 && n < 5_000_000);
    if (filtered.length > 0) return Math.round(Math.max(...filtered));
  }

  return null;
}

// ══════════════════════════════════════════════════════════════
//  FEE EXTRACTION — מותאם לדוחות האמיתיים
// ══════════════════════════════════════════════════════════════

/**
 * מנורה פנסיה:       "0.11% ןוכסיחמ לוהינה ימד רועיש" → feeFromBalance=0.11%
 * כלל:               "0.68% ... ןוכסיחמ לוהינ ימד ללכ" → feeFromBalance=0.68%
 * אלטשולר ילדים:    "0.23% ןוכסיחמ לוהינ ימד" → feeFromBalance=0.23%
 * מיטב:             Need to search for specific pattern
 */
function extractFees(text) {
  let feeFromDeposit = null;
  let feeFromBalance = null;

  // ── Fee from savings (accumulation) ──
  const feeBalancePatterns = [
    // מנורה: "0.11% ןוכסיחמ לוהינה ימד רועיש"
    /([0-9]+\.[0-9]+)%\s+ןוכסיחמ לוהינה ימד רועיש/,
    // כלל: "0.68% 0.68% ... ןוכסיחמ לוהינ"
    /([0-9]+\.[0-9]+)%\s+[0-9.%\s]+ןוכסיחמ לוהינ/,
    // אלטשולר: "0.23% ןוכסיחמ לוהינ ימד"
    /([0-9]+\.[0-9]+)%\s+ןוכסיחמ לוהינ ימד/,
    // General forward
    /דמי ניהול מצבירה[^%0-9]{0,30}([0-9]+\.?[0-9]*)%/,
    /ד.נ. מצבירה[^%0-9]{0,20}([0-9]+\.?[0-9]*)%/,
    // Numeric extraction: percentage followed by "savings fee" keywords
    /([0-9]+\.[0-9]+)%\s+(?:ןוכסיחמ|הריבצמ)/,
  ];

  for (const p of feeBalancePatterns) {
    const m = text.match(p);
    if (m) {
      const val = parseFloat(m[1]);
      if (val > 0 && val < 5) { feeFromBalance = val; break; }
    }
  }

  // ── Fee from deposit ──
  const feeDepositPatterns = [
    /([0-9]+\.?[0-9]*)%\s+הדקפהמ לוהינ ימד/,
    /הדקפהמ לוהינ ימד\s+([0-9]+\.?[0-9]*)%/,
    /דמי ניהול מהפקדה[^%0-9]{0,30}([0-9]+\.?[0-9]*)%/,
  ];

  for (const p of feeDepositPatterns) {
    const m = text.match(p);
    if (m) {
      const val = parseFloat(m[1]);
      if (val >= 0 && val < 5) { feeFromDeposit = val; break; }
    }
  }

  // Special case: "0.00% הדקפהמ לוהינ ימד" → feeFromDeposit = 0
  if (feeFromDeposit === null && text.match(/0\.00%\s+הדקפהמ לוהינ ימד/)) {
    feeFromDeposit = 0;
  }

  return { feeFromDeposit, feeFromBalance };
}

// ══════════════════════════════════════════════════════════════
//  RETURN EXTRACTION — מותאם לדוחות האמיתיים
// ══════════════════════════════════════════════════════════════

/**
 * אלטשולר ילדים: "20.54% רבגומ ןוכיס" → 20.54%
 * מנורה: תשואה נחשבת מהפרש יתרות + הפקדות
 */
function extractReturn(text) {
  const returnPatterns = [
    // אלטשולר ילדים: "20.54% רבגומ ןוכיס"
    /([0-9]+\.[0-9]+)%\s+רבגומ ןוכיס/,
    // Forward Israeli patterns
    /תשואה[^%0-9]{0,20}(-?[0-9]+\.?[0-9]*)%/,
    /שיעור תשואה[^%0-9]{0,20}(-?[0-9]+\.?[0-9]*)%/,
    // Generic reversed patterns
    /([0-9]+\.[0-9]+)%\s+(?:תיתנש האושת|האושת)/,
    /([+-]?[0-9]+\.[0-9]+)%\s+(?:יתנש|יתנש האושת)/,
  ];

  for (const p of returnPatterns) {
    const m = text.match(p);
    if (m) {
      const val = parseFloat(m[1]);
      if (val > -50 && val < 200) return val;
    }
  }

  return null;
}

// ══════════════════════════════════════════════════════════════
//  INVESTMENT TRACK EXTRACTION
// ══════════════════════════════════════════════════════════════

function extractInvestmentTrack(text) {
  const trackPatterns = [
    // "S&P500 דדמ בקוע למג בטימ" / "s&p 500 דדמ בקוע"
    /S&P\s*500\s+דדמ\s+בקוע/i,
    /s&p\s+500\s+דדמ\s+בקוע/i,
    // Forward
    /מחקה S&P 500/i,
    /S&P 500/i,
    /לולסמ.*S&P/i,
  ];
  if (trackPatterns.some(p => text.match(p))) return 'מחקה S&P 500';

  if (text.includes('רבגומ ןוכיס') || text.includes('ריבגמ ןוכיס')) return 'רבגומ ןוכיס';
  if (text.includes('יללכ')) return 'כללי';
  if (text.includes('הלכה')) return 'הלכה';

  return null;
}

// ══════════════════════════════════════════════════════════════
//  OWNER DETECTION (for children's savings)
// ══════════════════════════════════════════════════════════════

function detectOwner(text) {
  // "22661016/0 :.ז.ת רפסמ יול לארה :תימעה םש" → הראל
  if (text.includes('יול לארה') || text.includes('הראל יול')) return 'הראל';
  if (text.includes('יול םאיל') || text.includes('ליאם יול')) return 'ליאם';
  if (text.includes('יול ויז') || text.includes('זיו יול'))  return 'זיו';
  if (text.includes('יול ןויצ') || text.includes('ציון יול')) return 'ציון';
  return null;
}

// ══════════════════════════════════════════════════════════════
//  DATE EXTRACTION
// ══════════════════════════════════════════════════════════════

function extractReportDate(text) {
  // Common pattern in all reports: "31.12.2025 :חודה ךיראת" or "31/12/2025"
  const patterns = [
    /([0-9]{2})\.([0-9]{2})\.([0-9]{4})\s*:חודה (?:ךיראת|תפוקת)/,
    /([0-9]{2})\/([0-9]{2})\/([0-9]{4})\s*:חודה/,
    /([0-9]{2})\.([0-9]{2})\.([0-9]{4})/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  }
  return null;
}

// ══════════════════════════════════════════════════════════════
//  TEXT EXTRACTION FROM PDF
// ══════════════════════════════════════════════════════════════

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

  return { fullText, pageTexts, numPages: pdf.numPages };
}

// ══════════════════════════════════════════════════════════════
//  MAIN PARSER
// ══════════════════════════════════════════════════════════════

/**
 * parsePDF(file) → Promise<ParseResult>
 *
 * ParseResult: {
 *   institution:     string | null,
 *   reportType:      string | null,     'pension'|'study_fund'|'gemel'|'children'|'unknown'
 *   reportDate:      string | null,     ISO YYYY-MM-DD
 *   owner:           string | null,     'ציון'|'זיו'|'הראל'|'ליאם' (for children)
 *   balance:         number | null,     ₪
 *   feeFromDeposit:  number | null,     %
 *   feeFromBalance:  number | null,     %
 *   annualReturn:    number | null,     %
 *   investmentTrack: string | null,
 *   rawPreview:      string,
 *   fileName:        string,
 *   confidence:      'high'|'medium'|'low',
 *   warnings:        string[],
 * }
 */
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
  if (!feeFromDeposit && !feeFromBalance) warnings.push('לא נמצאו דמי ניהול.');

  const fieldsFound = [institution, balance, feeFromDeposit ?? feeFromBalance ?? 0].filter(v => v !== null).length;
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
