import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { saveAsset, subscribeToAssets, initFamily, getSettings, saveSettings, deleteAsset,
         subscribeToMarketData, getMarketData, seedAssetsIfEmpty,
         subscribeToSettings } from './lib/firestoreService';
import { isFirebaseReady } from './lib/firebase';
import * as XLSX from "xlsx";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line, Legend,
} from "recharts";
import {
  TrendingUp, Users, DollarSign, LayoutDashboard, Wifi,
  Calendar, Upload, Download, AlertCircle, CheckCircle2,
  Target, X, Save, FileSpreadsheet, ExternalLink, Bell, ArrowUp, ArrowDown,
  Activity, Database, FileText, CreditCard, PiggyBank, Plus, Trash2, Home, Car,
  ChevronDown, ChevronRight, Radio, Sparkles, Search,
} from "lucide-react";

// ══════════════════════════════════════════════════════════════
//  "המצפן" – HaMatzpan V2.6.1
//  V2.6.1 — Firestore-First Live Market · Save Timeout · Dividend Backfill
//  • useLiveMarket עובר ל-Firestore-first (Yahoo CORS חסום מהדפדפן)
//  • subscribeToMarketData מזין live prices ב-real-time
//  • handleManualSaveAll: 10s timeout + הצגת שגיאה אמיתית + ספירת נכסים
//  • Backfill דיבידנדים: scanner מחזיר 3 חודשים, app ממזג ל-mstyDividends
//  V2.6.0 — Phone↔Computer Sync · Manual Save Button · Autonomous Scanner
//  Firebase: finnsi-3a75d
// ══════════════════════════════════════════════════════════════
const APP_VERSION = "V2.6.1";

// ──────────── Persistence helpers (localStorage) ────────────
const LS_PREFIX = "hamatzpan:v1:";
const lsLoad = (key, fallback) => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return fallback;
    const raw = window.localStorage.getItem(LS_PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
};
const lsSave = (key, value) => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  } catch {}
};
const lsClearAll = () => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    Object.keys(window.localStorage).forEach(k => {
      if (k.startsWith(LS_PREFIX)) window.localStorage.removeItem(k);
    });
  } catch {}
};

const OWNERS = ["ציון", "זיו", "הראל", "ליאם"];
const OWNER_COLOR = { "ציון":"#6366f1","זיו":"#a855f7","הראל":"#ec4899","ליאם":"#f59e0b" };
const CAT_COLOR = {
  pension:"#6366f1", study_fund:"#a855f7", dividend:"#f59e0b",
  long_term:"#10b981", medium_term:"#3b82f6", children:"#ec4899", money_market:"#14b8a6",
  excellence_long:"#22c55e", excellence_trade:"#f97316",
};
const CAT_LABEL = {
  pension:"פנסיה", study_fund:"קרן השתלמות", dividend:"דיבידנדים",
  long_term:"גמל להשקעה", medium_term:"ני\"ע", children:"חיסכון ילדים", money_market:"קרן כספית",
  excellence_long:"אקסלנס · Long Term", excellence_trade:"אקסלנס · Trade Journal",
};

// V2.2.0 — Forbidden rows (defensive cleanup of Firestore leftovers)
// Any asset matching {owner, typeContains} is purged on boot.
const ZOMBIE_ASSETS = [
  { owner: "זיו", typeContains: "תגמולים מניות סחיר" },
];

// ══════════════════════════════════════════════════════════════
//  V2.2.1 · ASSET_POLICY — Code-owned overlay on top of Firestore
//  Fields listed here are APPLIED AFTER Firestore merge, so that
//  code-owned metadata (permanent notes, policy labels) cannot be
//  lost if a Firestore doc is created without them.
//  Rule: DB > code for user-editable data (balances, trades, deposits);
//        code > DB for policy fields (permanentNote, institution labels).
// ══════════════════════════════════════════════════════════════
const ASSET_POLICY = {
  "7b": { permanentNote: "⚠️ הלוואה פעילה: 60,589 ₪" },
};

/** Applies policy overrides on top of an asset list (pure function) */
const applyAssetPolicy = (list) =>
  Array.isArray(list)
    ? list.map(a => (a && ASSET_POLICY[a.id]) ? { ...a, ...ASSET_POLICY[a.id] } : a)
    : list;

const TRACK_COLOR = {
  13887:"#6366f1", 13245:"#a855f7", 13246:"#10b981", 5127790:"#14b8a6",
  15003:"#f59e0b", 11327:"#ec4899", 13342:"#8b5cf6", 13343:"#06b6d4",
  // V2.0.1 — קודים חדשים מהקובץ המצורף
  15725:"#7c3aed",  // מנורה מבטחים תגמולים מניות סחיר — זיו
  15738:"#db2777",  // אומגה קרן השתלמות מניות סחיר — הראל
  15739:"#0ea5e9",  // אומגה קרן השתלמות עוקב מדד s&p 500 — ליאם
};

const GEMELNET_URL = "https://gemelnetmain.cma.gov.il/";

const HEBREW_MONTHS = ["ינו","פבר","מרץ","אפר","מאי","יוני","יולי","אוג","ספט","אוק","נוב","דצמ"];

// ── נקודות אמת Clean Slate 2026-04-17 ─────────────────────────
const SEED = [
  { id:"1", owner:"ציון", type:"קרן פנסיה", institution:"מנורה מבטחים", accountNumber:"168", category:"pension", trackCode:13887, reportBalance:668562, reportDate:"2026-04-17", checkDate:"2026-04-17", employeeDeposit:1748, employerDeposit:1873, severanceDeposit:1498, feeFromDeposit:1.39, feeFromBalance:0.11, pensionLoan:{ amount:50000, startDate:"2025-07-01", termYears:7, monthlyPayment:670, purpose:"רכישת MSTY", linkedAssetId:"5" }, source:"manual_truth" },
  { id:"2", owner:"ציון", type:"קרן השתלמות", institution:"מיטב דש", accountNumber:"033-233-584678", category:"study_fund", trackCode:13245, reportBalance:235247, reportDate:"2026-04-17", checkDate:"2026-04-17", employeeDeposit:0, employerDeposit:0, severanceDeposit:0, feeFromDeposit:0, feeFromBalance:0.54, loanBalance:84828.16, source:"manual_truth" },
  { id:"3", owner:"ציון", type:"קופת גמל (2 חשבונות)", institution:"מיטב דש", accountNumber:"032-244-374167 + 032-253-324817", category:"long_term", trackCode:13246, reportBalance:56151, reportDate:"2026-04-17", checkDate:"2026-04-17", employeeDeposit:0, employerDeposit:0, severanceDeposit:0, feeFromDeposit:0.04, feeFromBalance:0.53, source:"manual_truth" },
  { id:"4", owner:"ציון", type:"קרן השתלמות (לא פעילה ×2)", institution:"כלל", accountNumber:"9971160 + 10231396", category:"study_fund", trackCode:13342, reportBalance:11616.41, reportDate:"2025-12-31", checkDate:"2025-12-31", employeeDeposit:0, employerDeposit:0, severanceDeposit:0, feeFromDeposit:0, feeFromBalance:0.68, source:"annual_report_2025" },
  { id:"10", owner:"ציון", type:"קרן כספית – מגמת ריבית", institution:"הראל", accountNumber:"5127790", category:"money_market", trackCode:5127790, reportBalance:85351, reportDate:"2026-04-17", checkDate:"2026-04-17", employeeDeposit:0, employerDeposit:0, severanceDeposit:0, feeFromDeposit:0, feeFromBalance:0, inceptionReturn:2.42, source:"manual_truth" },
  { id:"5", owner:"ציון", type:"MSTY – דיבידנדים", institution:"אקסלנס", category:"dividend", trackCode:null, reportBalance:0, reportDate:"2026-04-18", checkDate:"2026-04-18", employeeDeposit:0, employerDeposit:0, severanceDeposit:0, isMSTY:true, sharesCount:118, originalShares:590, purchasePrice:23.45, purchaseDate:"2025-05-20", conversionDate:"2025-05-19", purchaseTotalUSD:13835.50, loanAmountILS:50000, loanStartFXRate:3.50, monthlyLoanPaymentILS:670, reverseSplitDate:"2025-12-08", reverseSplitRatio:5, source:"manual_truth" },
  { id:"6", owner:"זיו", type:"קרן פנסיה", institution:"מנורה מבטחים", accountNumber:"168", category:"pension", trackCode:13887, reportBalance:441646.40, reportDate:"2025-12-31", checkDate:"2025-12-31", employeeDeposit:1008, employerDeposit:1080, severanceDeposit:864, feeFromDeposit:1.39, feeFromBalance:0.11, source:"annual_report_2025" },
  { id:"7", owner:"זיו", type:"קופת גמל לחיסכון", institution:"כלל", accountNumber:"9969312", category:"long_term", trackCode:13343, reportBalance:40658.46, reportDate:"2025-12-31", checkDate:"2025-12-31", employeeDeposit:0, employerDeposit:0, severanceDeposit:0, feeFromDeposit:0, feeFromBalance:0.68, source:"annual_report_2025" },
  { id:"7b", owner:"זיו", type:"קרן השתלמות – תמר", institution:"כלל", accountNumber:"9968410", category:"study_fund", trackCode:15003, reportBalance:161420, reportDate:"2026-04-17", checkDate:"2026-04-17", employeeDeposit:355, employerDeposit:1065, severanceDeposit:0, feeFromDeposit:0.01, feeFromBalance:0.68, studyLoan:{ active:true, amount:60589, locked:true }, permanentNote:"⚠️ הלוואה פעילה: 60,589 ₪", source:"manual_truth" },
  { id:"8", owner:"הראל", type:"חיסכון לכל ילד", institution:"אלטשולר שחם", accountNumber:"40096434", category:"children", trackCode:11327, reportBalance:14536, reportDate:"2025-12-31", checkDate:"2025-12-31", employeeDeposit:57, employerDeposit:57, severanceDeposit:0, feeFromDeposit:0, feeFromBalance:0.23, source:"annual_report_2025" },
  { id:"9", owner:"ליאם", type:"חיסכון לכל ילד", institution:"אלטשולר שחם", accountNumber:"41898339", category:"children", trackCode:11327, reportBalance:9719, reportDate:"2025-12-31", checkDate:"2025-12-31", employeeDeposit:57, employerDeposit:57, severanceDeposit:0, feeFromDeposit:0, feeFromBalance:0.23, source:"annual_report_2025" },
  // ── V2.0.1 — קופות חדשות שזוהו בקובץ הגמל-נט 02/2025-02/2026 ──
  // V2.1.7: id:"11" (זיו תגמולים מניות סחיר, 0₪) — הוסר לפי הוראת המשתמש (קופה לא קיימת)
  { id:"12", owner:"הראל",  type:"השתלמות מניות סחיר (אומגה)",     institution:"אומגה",        accountNumber:"15738", category:"study_fund", trackCode:15738, reportBalance:0, reportDate:"2026-02-28", checkDate:"2026-02-28", employeeDeposit:0, employerDeposit:0, severanceDeposit:0, feeFromDeposit:0, feeFromBalance:0, source:"gemelnet" },
  { id:"13", owner:"ליאם",  type:"השתלמות עוקב S&P 500 (אומגה)",   institution:"אומגה",        accountNumber:"15739", category:"study_fund", trackCode:15739, reportBalance:0, reportDate:"2026-02-28", checkDate:"2026-02-28", employeeDeposit:0, employerDeposit:0, severanceDeposit:0, feeFromDeposit:0, feeFromBalance:0, source:"gemelnet" },
];

// ══════════════════════════════════════════════════════════════
//  MSTY — היסטוריית דיבידנדים (יוני 2025 → אפריל 2026)
//  נתוני אמת שסופקו על-ידי המשתמש + אימות קרוס מול YieldMax/Seeking Alpha
//  ⚠️ MSTY עברה ב-08/12/2025 reverse split 1:5 → 590 מניות נהיו 118.
//  shareBasis: "pre" לפני הפיצול (590 מניות), "post" אחרי (118 מניות).
// ══════════════════════════════════════════════════════════════
const MSTY_REVERSE_SPLIT_DATE = "2025-12-08";
const MSTY_REVERSE_SPLIT_RATIO = 5; // 1:5

// נתוני שוק נוכחיים (19/04/2026, מסופקים ע"י המשתמש)
// V2.1.8: ערכים אלה משמשים כ-fallback בלבד — האמת נטענת מ-daily_scan.json (Golden Sources)
const MSTY_DEFAULTS = {
  currentPrice: 25.90,   // USD (19/04/2026) — Golden Source: TradingView / Yahoo Finance
  currentFX:    2.9677,  // ILS per USD (19/04/2026) — Golden Source: Investing.com / בנק ישראל
  taxRate:      0.25,    // מס רווחי-הון/דיבידנדים
};

// היסטוריית חלוקות — נתוני אמת מלאים (truth-verified)
// Pre-split: שולמו על 590 מניות
// Post-split: שולמו על 118 מניות
const MSTY_DIVIDENDS_SEED = [
  // ── יוני 2025 (חודשי, pre-split) ─ רכישה ב-20/05/2025 ──
  { date:"2025-06-10", amount:1.478,  verified:true, shareBasis:"pre", note:"דיבידנד חודשי ראשון" },
  // ── יולי 2025 (חודשי, pre-split) ──
  { date:"2025-07-07", amount:1.238,  verified:true, shareBasis:"pre" },
  // ── אוגוסט 2025 (חודשי, pre-split) ──
  { date:"2025-08-07", amount:1.18,   verified:true, shareBasis:"pre", note:"~$1.18" },
  // ── ספטמבר 2025 (חודשי, pre-split) — מחיר מניה $15.37 ──
  { date:"2025-09-26", amount:1.01,   verified:true, shareBasis:"pre", note:"מחיר מניה $15.37" },
  // ── אוקטובר 2025 (מעבר לחלוקה שבועית, pre-split) ──
  { date:"2025-10-03", amount:0.6074, verified:true, shareBasis:"pre", note:"מעבר לחלוקה שבועית" },
  { date:"2025-10-17", amount:0.212,  verified:true, shareBasis:"pre" },
  { date:"2025-10-31", amount:0.1924, verified:true, shareBasis:"pre" },
  // ── נובמבר 2025 (שבועי, pre-split, 590 מניות) ──
  { date:"2025-11-07", amount:0.169,  verified:true, shareBasis:"pre" },
  { date:"2025-11-14", amount:0.162,  verified:true, shareBasis:"pre" },
  { date:"2025-11-21", amount:0.1475, verified:true, shareBasis:"pre" },
  { date:"2025-11-28", amount:0.1352, verified:true, shareBasis:"pre" },
  // ── דצמבר 2025 — 05/12 pre-split, שאר post-split (split ב-08/12) ──
  { date:"2025-12-05", amount:0.1388, verified:true, shareBasis:"pre",  note:"אחרונה לפני ה-reverse split" },
  { date:"2025-12-12", amount:0.5859, verified:true, shareBasis:"post", note:"ראשונה אחרי split 1:5 → 118 מניות" },
  { date:"2025-12-19", amount:0.3869, verified:true, shareBasis:"post" },
  { date:"2025-12-26", amount:0.5106, verified:true, shareBasis:"post" },
  // ── ינואר 2026 (5 חלוקות שבועיות, post-split) ──
  { date:"2026-01-02", amount:0.409,  verified:true, shareBasis:"post" },
  { date:"2026-01-09", amount:0.374,  verified:true, shareBasis:"post" },
  { date:"2026-01-16", amount:0.414,  verified:true, shareBasis:"post" },
  { date:"2026-01-23", amount:0.430,  verified:true, shareBasis:"post" },
  { date:"2026-01-30", amount:0.373,  verified:true, shareBasis:"post" },
  // ── פברואר 2026 (4 חלוקות, post-split) ──
  { date:"2026-02-06", amount:0.308,  verified:true, shareBasis:"post" },
  { date:"2026-02-13", amount:0.298,  verified:true, shareBasis:"post" },
  { date:"2026-02-20", amount:0.361,  verified:true, shareBasis:"post" },
  { date:"2026-02-27", amount:0.302,  verified:true, shareBasis:"post" },
  // ── מרץ 2026 (4 חלוקות, post-split) ──
  { date:"2026-03-06", amount:0.35,   verified:true, shareBasis:"post" },
  { date:"2026-03-13", amount:0.385,  verified:true, shareBasis:"post" },
  { date:"2026-03-20", amount:0.438,  verified:true, shareBasis:"post" },
  { date:"2026-03-27", amount:0.345,  verified:true, shareBasis:"post" },
  // ── אפריל 2026 (ידוע מ-web scan 18/04/2026) ──
  { date:"2026-04-16", amount:0.31,   verified:true, shareBasis:"post", note:"Web-verified 18/04/2026 · YieldMax distribution schedule" },
  { date:"2026-04-23", amount:0.521,  verified:true, shareBasis:"post", note:"Web-verified 23/04/2026 · confirmed by user" },
];

// ══════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════
const fmt = n => `₪${Math.round(n || 0).toLocaleString("he-IL")}`;
const fmtPct = n => `${n >= 0 ? "+" : ""}${(n || 0).toFixed(2)}%`;
const fmtDate = iso => {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth()+1).padStart(2, "0")}.${d.getFullYear()}`;
};
const daysBetween = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000));
const today = () => new Date().toISOString().slice(0, 10);

/** Israeli/Gemel-Net number parser — מטפל ב-$ prefix, (), -, -%, thousand separators, RTL marks */
function toNum(s) {
  if (s == null || s === "") return null;
  let str = String(s).trim();
  if (!str) return null;
  // Gemel-Net placeholder for missing data: "- - -", "— — —", "N/A"
  if (/^[\s\-–—]*-[\s\-–—]*$/.test(str) || /^N\/?A$/i.test(str)) return null;
  // Parentheses negatives: (123.45) → -123.45  (Israeli Excel format)
  const parenNeg = /^\(\s*(.+?)\s*\)$/.test(str);
  if (parenNeg) str = str.replace(/^\(\s*|\s*\)$/g, "");
  // Strip RTL/LTR marks, currency, percent, $, spaces, commas (thousand separator), Hebrew letters
  str = str
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")  // bidi marks
    .replace(/[$₪€£%,\s]/g, "")                                  // currency + separators + whitespace
    .replace(/[\u05d0-\u05ea]/g, "")                            // strip Hebrew letters
    .replace(/[−‒–—]/g, "-");                                    // normalize minus variants
  if (!str || str === "-" || str === ".") return null;
  const n = parseFloat(str);
  if (!Number.isFinite(n)) return null;
  return parenNeg ? -n : n;
}

// ══════════════════════════════════════════════════════════════
//  MULTI-FORMAT PARSER (CSV / XLSX / PDF)
// ══════════════════════════════════════════════════════════════

/** מזהה סוג קובץ לפי סיומת */
function detectFileType(filename) {
  const ext = filename.toLowerCase().split(".").pop();
  if (["csv", "txt"].includes(ext)) return "csv";
  if (["xlsx", "xls", "xlsm"].includes(ext)) return "xlsx";
  if (ext === "pdf") return "pdf";
  return "unknown";
}

/** מפצל שורת CSV עם תמיכה בציטוטים */
function splitLine(line, sep) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { q = !q; continue; }
    if (c === sep && !q) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur); return out;
}

/** CSV → rows של אובייקטים */
function parseCSVText(text) {
  const lines = text.replace(/\r/g, "").split("\n").filter(l => l.trim());
  if (!lines.length) return { headers: [], rows: [] };
  const sep = lines[0].includes("\t") ? "\t" : ",";
  const headers = splitLine(lines[0], sep).map(h => h.trim());
  const rows = lines.slice(1).map(line => {
    const vals = splitLine(line, sep);
    const row = {};
    headers.forEach((h, i) => { row[h] = (vals[i] ?? "").trim(); });
    return row;
  });
  return { headers, rows };
}

/** מילות מפתח לניקוד שורת כותרת */
const HEADER_KEYWORDS = [
  "קופה","מסלול","תשואה","שם","דמי","ניהול","מזהה","מספר","קוד",
  "נכסים","צבירה","יתרת","מצטברת","תקופת","נזילות","שנתית","שארפ",
  "הפקדות","הפקדה","חודש","חודשית","שנה","שנתי","ברוטו","נטו",
];

/** נורמליזציה של שם כותרת — מסיר ירידות שורה ורווחים כפולים */
function normalizeHeader(s) {
  return String(s || "").replace(/\s+/g, " ").replace(/\n/g, " ").trim();
}

/** ניקוד שורה כמועמדת לכותרת — כמה מילות מפתח נמצאו */
function headerScore(row) {
  if (!row || !row.length) return 0;
  let score = 0;
  for (const cell of row) {
    const s = String(cell || "");
    if (!s.trim()) continue;
    for (const kw of HEADER_KEYWORDS) {
      if (s.includes(kw)) { score++; break; }
    }
  }
  return score;
}

/** XLSX → rows — עם ניקוד שורת כותרת וזיהוי דו-שורתי */
function parseXLSXBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true, codepage: 65001, WTF: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { headers: [], rows: [], debug: ["no sheet"] };

  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false, blankrows: false });
  if (!aoa.length) return { headers: [], rows: [], debug: ["empty sheet"] };

  // סורק עד 40 שורות ראשונות למציאת שורת הכותרת
  const scanUpTo = Math.min(aoa.length, 40);
  let bestIdx = 0, bestScore = 0;
  for (let i = 0; i < scanUpTo; i++) {
    const score = headerScore(aoa[i]);
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }
  if (bestScore < 2) {
    // אין שורה טובה — fallback: שורה ראשונה לא-ריקה
    bestIdx = aoa.findIndex(r => r && r.some(c => c != null && String(c).trim()));
    if (bestIdx < 0) bestIdx = 0;
  }

  // מיזוג שורת כותרת ראשית + sub-header
  // forward-fill רק לעמודות sub שאין להן main משלהן (header spanning)
  const mainRow = (aoa[bestIdx] || []).map(normalizeHeader);
  const subRow  = (aoa[bestIdx + 1] || []).map(normalizeHeader);
  const maxCols = Math.max(mainRow.length, subRow.length);
  const filled = new Array(maxCols).fill("");
  let lastMain = "";

  for (let i = 0; i < maxCols; i++) {
    const m = mainRow[i] || "";
    const s = subRow[i]  || "";
    if (m) {
      lastMain = m;
      filled[i] = s ? `${m} | ${s}` : m;
    } else if (s) {
      // yes forward-fill: sub מעיד על המשך של כותרת spanning
      filled[i] = lastMain ? `${lastMain} | ${s}` : s;
    } else {
      // אין main ואין sub — סוף span, reset
      filled[i] = "";
      lastMain = "";
    }
  }

  // disambiguate duplicates by appending #N so multiple columns with same text don't collide
  const seen = {};
  const uniqueHeaders = filled.map(h => {
    if (!h) return "";
    const base = h;
    seen[base] = (seen[base] || 0) + 1;
    return seen[base] === 1 ? base : `${base} #${seen[base]}`;
  });

  // שורות הנתונים: bestIdx + 2, ודלג על ריקות — סנן גם שורות summary/footer
  const dataStart = bestIdx + 2;
  const rows = [];
  for (let r = dataStart; r < aoa.length; r++) {
    const raw = aoa[r];
    if (!raw || !raw.some(c => c != null && String(c).trim())) continue;
    const obj = { __rowIndex: r };
    uniqueHeaders.forEach((h, i) => {
      if (!h) return;
      const v = raw[i];
      obj[h] = v != null ? String(v).trim() : "";
    });
    rows.push(obj);
  }

  return {
    headers: uniqueHeaders.filter(Boolean),
    rows,
    debug: [`headerRow=${bestIdx}`, `score=${bestScore}`, `dataRows=${rows.length}`, `cols=${uniqueHeaders.filter(Boolean).length}`],
  };
}

/** חיפוש כותרת לפי מילות מפתח — כל pattern יכול להיות מחרוזת או מערך-AND של מילים שחייבות להופיע יחד */
function findKey(headers, patterns) {
  for (const pat of patterns) {
    if (typeof pat === "string") {
      const k = headers.find(h => h && h.includes(pat));
      if (k) return k;
    } else if (Array.isArray(pat)) {
      // חייבות להופיע כולן
      const k = headers.find(h => h && pat.every(p => h.includes(p)));
      if (k) return k;
    }
  }
  return null;
}

/** מחלץ את כל העמודות החודשיות — מנסה לזהות תאריכים/שמות חודשים בכותרות */
function extractMonthlyColumns(headers) {
  const months = [];
  headers.forEach(h => {
    if (!h) return;
    // דפוס "פבר 2025" / "פברואר 2025" / "02/2025" / "2025-02"
    const monthNameMatch = h.match(/(ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר|ינו|פבר|אפר|אוג|ספט|אוק|נוב|דצמ).*?(\d{4})/);
    if (monthNameMatch) {
      const monthMap = {ינואר:1,פברואר:2,מרץ:3,אפריל:4,מאי:5,יוני:6,יולי:7,אוגוסט:8,ספטמבר:9,אוקטובר:10,נובמבר:11,דצמבר:12,ינו:1,פבר:2,אפר:4,אוג:8,ספט:9,אוק:10,נוב:11,דצמ:12};
      const m = monthMap[monthNameMatch[1]];
      const y = parseInt(monthNameMatch[2]);
      if (m && y) months.push({ header: h, year: y, month: m, iso: `${y}-${String(m).padStart(2, "0")}` });
      return;
    }
    const isoMatch = h.match(/^(\d{4})[-/](\d{1,2})$/);
    if (isoMatch) {
      months.push({ header: h, year: parseInt(isoMatch[1]), month: parseInt(isoMatch[2]), iso: `${isoMatch[1]}-${String(isoMatch[2]).padStart(2, "0")}` });
    }
  });
  return months.sort((a, b) => a.iso.localeCompare(b.iso));
}

/** פירוס סופי: מזהה עמודות בגישה חכמה — עובד גם על "סיכום פעילות" וגם על "תשואות חודשיות" */
function parseGemelnet({ headers, rows }) {
  if (!rows.length) return { rows: [], monthlyColumns: [], error: "no_data_rows", headers };

  // זיהוי עמודות — סדר הדפוסים מהספציפי לכללי
  const trackKey = findKey(headers, [
    "מספר קופה", "מספר מסלול", "מזהה מסלול", "קוד קופה", "מזהה קופה",
    ["קוד", "קופה"], ["מספר", "מסלול"], ["מספר", "קופה"],
    "מזהה", "מספר",  // fallback — השם הכי כללי בקבצי גמל-נט עם multi-header
  ]);
  const nameKey    = findKey(headers, ["שם מסלול", "שם קופה", "שם"]);
  const balanceKey = findKey(headers, [
    ["יתרת", "נכסים"], "יתרת נכסים", "יתרה", "צבירה",
  ]);
  const monthlyKey = findKey(headers, [
    "נומינלית ברוטו לחודש", "תשואה חודשית", "לחודש", "חודש אחרון",
  ]);
  const ytdKey     = findKey(headers, ["מתחילת שנה", "YTD", "מצטברת מתחילת"]);
  // "מצטברת לתקופת הדוח" — תשואה מצטברת לתקופה הנבחרת (לרוב 12 חודשים)
  const periodKey  = findKey(headers, [
    ["מצטברת", "תקופת"], "מצטברת לתקופת", "מצטברת לתקופה", "תקופת הדוח",
  ]);
  const avg5yKey   = findKey(headers, [["ממוצעת", "5"], ["שנתית", "5"]]);
  const avg3yKey   = findKey(headers, [["ממוצעת", "3"], ["שנתית", "3"]]);
  const periodLabel = findKey(headers, [["תקופת", "דיווח"], "תקופת דיווח"]);
  const feeBalKey  = findKey(headers, [
    ["דמי ניהול", "נכסים"], "דמי ניהול מהצבירה", "מהצבירה", "מצבירה",
  ]);
  const feeDepKey  = findKey(headers, [
    ["דמי ניהול", "הפקדות"], ["דמי ניהול", "הפקדה"], "דמי ניהול מהפקדה", "מהפקדות", "מהפקדה",
  ]);

  const monthlyColumns = extractMonthlyColumns(headers);

  if (!trackKey) {
    return { rows: [], monthlyColumns: [], error: "missing_track_column", headers };
  }

  const parsed = rows.map(r => {
    // סדרת תשואות חודשית (אם יש בקובץ — למקרה של קובץ "תשואות חודשיות")
    const series = monthlyColumns.map(m => ({
      iso: m.iso, year: m.year, month: m.month,
      value: toNum(r[m.header]),
    })).filter(s => s.value != null);

    const trackRaw  = toNum(r[trackKey]);
    const trackCode = trackRaw != null ? parseInt(trackRaw) : null;
    // התשואה ה"עיקרית" שתוצג: חודשית > תקופת דוח > YTD > חודש אחרון בסדרה
    const periodReturn = periodKey ? toNum(r[periodKey]) : null;
    const ytdReturn    = ytdKey    ? toNum(r[ytdKey])    : null;
    const monthlyReturn = monthlyKey
      ? toNum(r[monthlyKey])
      : (series.length ? series[series.length-1].value : null);

    return {
      trackCode,
      fundName:      nameKey      ? r[nameKey]      : "",
      fundBalance:   balanceKey   ? toNum(r[balanceKey]) : null, // AUM של הקופה במיליוני ₪
      monthlyReturn,                                             // %
      ytdReturn,                                                 // %
      periodReturn,                                              // %  — מצטברת לתקופת הדוח
      period:        periodLabel  ? r[periodLabel]  : null,      // "02/26-02/25"
      avg3y:         avg3yKey     ? toNum(r[avg3yKey]) : null,
      avg5y:         avg5yKey     ? toNum(r[avg5yKey]) : null,
      feeFromBalance: feeBalKey   ? toNum(r[feeBalKey]) : null,
      feeFromDeposit: feeDepKey   ? toNum(r[feeDepKey]) : null,
      monthlySeries: series,
      _raw: r,
    };
  }).filter(r => r.trackCode != null && !isNaN(r.trackCode) && r.trackCode > 0);

  return {
    rows: parsed,
    monthlyColumns,
    headers,
    detectedColumns: {
      track: trackKey, name: nameKey, balance: balanceKey,
      monthly: monthlyKey, ytd: ytdKey, period: periodKey,
      avg3y: avg3yKey, avg5y: avg5yKey, feeBal: feeBalKey, feeDep: feeDepKey,
    },
  };
}

/** מחיל על נכסים — תומך בשני סוגי קבצים: חודשי (monthlyReturn) וסיכום-תקופה (periodReturn) */
function applyGemelnet(assets, gemelRows, updateDate = today()) {
  const map = new Map(gemelRows.map(r => [r.trackCode, r]));
  let matched = 0;
  const next = assets.map(a => {
    if (!a.trackCode) return a;
    const g = map.get(a.trackCode);
    if (!g) return a;
    matched++;
    // סדר העדיפויות: monthlyReturn > periodReturn > ytdReturn
    const effectiveReturn = g.monthlyReturn ?? g.periodReturn ?? g.ytdReturn ?? 0;
    const ret = (effectiveReturn || 0) / 100;
    const growth = (a.reportBalance || 0) * ret;
    const monthly = (a.employeeDeposit||0) + (a.employerDeposit||0) + (a.severanceDeposit||0);
    const newBal = (a.reportBalance || 0) + growth + monthly;
    return {
      ...a,
      reportBalance: Math.round(newBal * 100) / 100,
      reportDate: updateDate, checkDate: updateDate,
      ytdReturnFromGemelnet:     g.ytdReturn,
      monthlyReturnFromGemelnet: g.monthlyReturn,
      periodReturnFromGemelnet:  g.periodReturn,
      avg3yFromGemelnet:         g.avg3y,
      avg5yFromGemelnet:         g.avg5y,
      periodLabel:               g.period,
      monthlySeries:             g.monthlySeries || [],
      source: "gemelnet",
    };
  });
  return { assets: next, matched, total: gemelRows.length };
}

// ── Interpolation: משלים חודשים חסרים בין נקודות ──
function interpolateSeries(series) {
  if (!series.length) return [];
  const sorted = [...series].sort((a,b) => a.iso.localeCompare(b.iso));
  const out = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    out.push(sorted[i]);
    const [y1, m1] = sorted[i].iso.split("-").map(Number);
    const [y2, m2] = sorted[i+1].iso.split("-").map(Number);
    const gap = (y2 - y1) * 12 + (m2 - m1);
    for (let j = 1; j < gap; j++) {
      const ym = y1 * 12 + m1 - 1 + j;
      const yy = Math.floor(ym / 12), mm = (ym % 12) + 1;
      const t = j / gap;
      out.push({
        iso: `${yy}-${String(mm).padStart(2,"0")}`,
        year: yy, month: mm,
        value: sorted[i].value + (sorted[i+1].value - sorted[i].value) * t,
        interpolated: true,
      });
    }
  }
  out.push(sorted[sorted.length-1]);
  return out;
}

// ── רמזור ──
function confidence(checkDate) {
  const days = daysBetween(checkDate, new Date());
  if (days <= 30) return { color:"#10b981", label:"עדכני", days };
  if (days <= 90) return { color:"#f59e0b", label:"חלקי", days };
  return            { color:"#ef4444", label:"ישן", days };
}

// ══════════════════════════════════════════════════════════════
//  UI COMPONENTS
// ══════════════════════════════════════════════════════════════
const StatCard = ({ label, value, sub, color = "text-emerald-400", icon }) => (
  <div className="bg-slate-800/70 border border-slate-700 rounded-2xl p-5">
    {icon && <div className="mb-2 text-slate-400">{icon}</div>}
    <p className="text-slate-400 text-xs mb-1">{label}</p>
    <p className={`text-2xl font-bold ${color}`}>{value}</p>
    {sub && <p className="text-slate-500 text-xs mt-1">{sub}</p>}
  </div>
);

const ConfidenceDot = ({ checkDate }) => {
  const c = confidence(checkDate);
  return (
    <span title={`${c.label} · עודכן לפני ${c.days} ימים`} className="inline-flex items-center gap-1.5">
      <span className="relative flex h-2.5 w-2.5">
        <span className="animate-pulse absolute inline-flex h-full w-full rounded-full opacity-60" style={{background:c.color}}/>
        <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{background:c.color}}/>
      </span>
      <span className="text-[11px] text-slate-400">{c.label}</span>
    </span>
  );
};

const SourceBadge = ({ source, confirmed }) => {
  const map = {
    gemelnet:      { bg:"bg-emerald-900/40", text:"text-emerald-300", label:"גמל-נט", icon:<FileSpreadsheet size={10}/> },
    pdf_report:    { bg:"bg-sky-900/40",     text:"text-sky-300",     label:"דוח PDF",  icon:<FileText size={10}/> },
    manual_truth:  { bg:"bg-indigo-900/40",  text:"text-indigo-300",  label:"עדכון ידני", icon:<Target size={10}/> },
    manual:        { bg:"bg-slate-700",      text:"text-slate-300",   label:"ידני", icon:<Target size={10}/> },
    annual_report_2025: { bg:"bg-amber-900/40", text:"text-amber-300", label:"דוח שנתי", icon:<Calendar size={10}/> },
  };
  const m = map[source] || map.manual;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${m.bg} ${m.text}`}>
      {m.icon} {m.label}
      {/* V2.1.7: אייקון מסמך קטן אם נתון אושר מדוח רשמי */}
      {confirmed && <FileText size={9} className="text-sky-300" title="אושר מדוח רשמי PDF"/>}
    </span>
  );
};

const AssetRow = ({ a, onSpotCheck }) => {
  const hasGemel = a.monthlyReturnFromGemelnet != null;
  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-4 sm:p-4 hover:border-slate-600 transition-colors shadow-sm hover:shadow-md">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{background:OWNER_COLOR[a.owner]+"33", color:OWNER_COLOR[a.owner]}}>{a.owner}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">{CAT_LABEL[a.category]}</span>
            {a.trackCode && <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-900/40 text-indigo-300 font-mono">#{a.trackCode}</span>}
            <SourceBadge source={a.source} confirmed={a._reportConfirmed}/>
            {/* V2.1.8 — ManualLock badge בולט בשורת הבאדג'ים */}
            {a._manualLock && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-600/30 border border-indigo-400/60 text-indigo-200 shadow shadow-indigo-500/20"
                title="ננעל ידנית — מוגן מפני דריסת סריקה אוטומטית">
                🔒 ננעל ידנית
              </span>
            )}
            <ConfidenceDot checkDate={a.checkDate}/>
          </div>
          <h3 className="font-semibold text-slate-100 text-sm truncate">{a.type}</h3>
          <p className="text-xs text-slate-400">{a.institution} {a.accountNumber ? `· ${a.accountNumber}` : ""}</p>
        </div>
        <div className="text-left flex-shrink-0">
          <p className="text-2xl sm:text-xl font-bold text-white leading-tight">{fmt(a.reportBalance)}</p>
          <p className="text-[10px] text-slate-500">עודכן: {fmtDate(a.reportDate)}</p>
        </div>
      </div>
      {hasGemel && (
        <div className="grid grid-cols-2 gap-2 text-xs border-t border-slate-700/50 pt-2 mb-2">
          <div>
            <span className="text-slate-500 text-[10px]">תשואה חודשית (גמל-נט)</span>
            <p className={`font-mono ${a.monthlyReturnFromGemelnet >= 0 ? "text-emerald-400" : "text-rose-400"} flex items-center gap-1`}>
              {a.monthlyReturnFromGemelnet >= 0 ? <ArrowUp size={10}/> : <ArrowDown size={10}/>}
              {fmtPct(a.monthlyReturnFromGemelnet)}
            </p>
          </div>
          <div>
            <span className="text-slate-500 text-[10px]">YTD מתחילת שנה</span>
            <p className={`font-mono ${a.ytdReturnFromGemelnet >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {a.ytdReturnFromGemelnet != null ? fmtPct(a.ytdReturnFromGemelnet) : "—"}
            </p>
          </div>
        </div>
      )}
      {a.loanBalance && (
        <div className="text-[11px] bg-rose-900/20 border border-rose-800/40 rounded px-2 py-1 mb-2 text-rose-300">
          ⚠️ הלוואה פעילה: {fmt(a.loanBalance)}
        </div>
      )}
      {/* V2.1.7 — Yellow Loan Badges: pensionLoan (ציון מנורה) + studyLoan (זיו תמר) */}
      {a.pensionLoan && (
        <div className="flex items-center gap-1.5 text-[11px] bg-amber-900/25 border border-amber-600/50 rounded-lg px-2.5 py-1.5 mb-2 text-amber-200 font-semibold">
          <AlertCircle size={12} className="text-amber-400 flex-shrink-0"/>
          ⚠️ הלוואה פעילה נגד פנסיה — ₪{a.pensionLoan.amount?.toLocaleString("he-IL")} · {a.pensionLoan.monthlyPayment} ₪/חודש · מטרה: {a.pensionLoan.purpose}
        </div>
      )}
      {/* V2.2.1 — permanentNote is a code-owned policy field, displayed independently */}
      {a.permanentNote ? (
        <div className="flex items-center gap-1.5 text-[11px] bg-amber-900/25 border border-amber-600/50 rounded-lg px-2.5 py-1.5 mb-2 text-amber-200 font-semibold">
          <AlertCircle size={12} className="text-amber-400 flex-shrink-0"/>
          {a.permanentNote}
        </div>
      ) : a.studyLoan?.active && (
        <div className="flex items-center gap-1.5 text-[11px] bg-amber-900/25 border border-amber-600/50 rounded-lg px-2.5 py-1.5 mb-2 text-amber-200 font-semibold">
          <AlertCircle size={12} className="text-amber-400 flex-shrink-0"/>
          ⚠️ הלוואה פעילה: {(a.studyLoan.amount || 0).toLocaleString("he-IL")} ₪
        </div>
      )}
      {/* ManualLock: מוצג בשורת הבאדג'ים — ראה AssetRow badge row (V2.1.8) */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-700/30">
        <p className="text-[10px] text-slate-500">
          דמי ניהול: {a.feeFromDeposit}% מהפקדה · {a.feeFromBalance}% מצבירה
        </p>
        <button onClick={() => onSpotCheck(a)} className="text-xs sm:text-[11px] bg-indigo-600/20 hover:bg-indigo-600/40 active:bg-indigo-600/60 text-indigo-300 px-3 py-1.5 sm:px-2.5 sm:py-1 rounded-lg flex items-center gap-1.5 touch-manipulation">
          <Target size={12}/> עדכון נקודתי
        </button>
      </div>
    </div>
  );
};

const SpotCheckModal = ({ asset, onClose, onSave }) => {
  const [balance, setBalance] = useState(asset?.reportBalance || 0);
  const [date, setDate] = useState(today());
  if (!asset) return null;
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2"><Target size={18} className="text-indigo-400"/> עדכון נקודתי</h3>
            <p className="text-xs text-slate-400 mt-1">{asset.owner} · {asset.type}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={18}/></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-400">יתרה נוכחית (₪)</label>
            <input type="number" value={balance} onChange={e => setBalance(parseFloat(e.target.value) || 0)}
              className="w-full mt-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-lg font-mono"/>
          </div>
          <div>
            <label className="text-xs text-slate-400">תאריך בדיקה</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="w-full mt-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white"/>
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2 rounded-lg text-sm">ביטול</button>
          <button onClick={() => onSave(asset.id, balance, date)} className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white py-2 rounded-lg text-sm flex items-center justify-center gap-1.5">
            <Save size={14}/> עדכן
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Success Modal: סיכום מורחב + אישור ל-Firestore ──
const SuccessModal = ({ result, onClose, onConfirmFirestore }) => {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  if (!result) return null;

  const totalBefore = result.preview.reduce((s, p) => s + p.oldBalance, 0);
  const totalAfter  = result.preview.reduce((s, p) => s + p.newBalance, 0);
  const totalDiff   = totalAfter - totalBefore;

  const handleConfirm = async () => {
    setSaving(true);
    try {
      await onConfirmFirestore();
      setSaved(true);
      setTimeout(onClose, 1500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-5">
          <div className="flex items-start gap-3">
            <div className="bg-emerald-500/20 p-2 rounded-lg"><CheckCircle2 size={24} className="text-emerald-400"/></div>
            <div>
              <h3 className="text-xl font-bold text-white">הקובץ עובד בהצלחה</h3>
              <p className="text-sm text-slate-400 mt-0.5">
                {result.matched} קופות זוהו מתוך {result.total} שורות · פורמט: {result.format.toUpperCase()}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={20}/></button>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="bg-slate-900/50 rounded-lg p-3">
            <p className="text-xs text-slate-500">סכום קודם</p>
            <p className="text-lg font-mono text-slate-200">{fmt(totalBefore)}</p>
          </div>
          <div className="bg-slate-900/50 rounded-lg p-3">
            <p className="text-xs text-slate-500">סכום חדש</p>
            <p className="text-lg font-mono text-white">{fmt(totalAfter)}</p>
          </div>
          <div className={`${totalDiff >= 0 ? "bg-emerald-900/30" : "bg-rose-900/30"} rounded-lg p-3`}>
            <p className="text-xs text-slate-500">שינוי כולל</p>
            <p className={`text-lg font-mono ${totalDiff >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {totalDiff >= 0 ? "+" : ""}{fmt(totalDiff)}
            </p>
          </div>
        </div>

        <div className="space-y-2 mb-5">
          <h4 className="text-sm font-semibold text-slate-200 mb-2">פירוט לפי קופה:</h4>
          {result.preview.map((p, i) => {
            const diff = p.newBalance - p.oldBalance;
            return (
              <div key={i} className="bg-slate-900/40 border border-slate-700 rounded-lg p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-100">
                      <span className="inline-block w-2 h-2 rounded-full ml-2" style={{background:OWNER_COLOR[p.owner]}}/>
                      {p.owner} · {p.type}
                      <span className="text-indigo-300 font-mono text-xs mr-2">#{p.trackCode}</span>
                    </p>
                    <div className="flex items-center gap-3 mt-1 text-xs flex-wrap">
                      {p.monthlyReturn != null ? (
                        <span className="text-slate-500">חודשית: <span className={p.monthlyReturn >= 0 ? "text-emerald-400 font-mono" : "text-rose-400 font-mono"}>{fmtPct(p.monthlyReturn)}</span></span>
                      ) : null}
                      {p.periodReturn != null ? (
                        <span className="text-slate-500">מצטברת {p.period ? `(${p.period})` : ""}: <span className={p.periodReturn >= 0 ? "text-emerald-400 font-mono" : "text-rose-400 font-mono"}>{fmtPct(p.periodReturn)}</span></span>
                      ) : null}
                      {p.ytdReturn != null ? (
                        <span className="text-slate-500">YTD: <span className={p.ytdReturn >= 0 ? "text-emerald-400 font-mono" : "text-rose-400 font-mono"}>{fmtPct(p.ytdReturn)}</span></span>
                      ) : null}
                      {p.avg3y != null ? (
                        <span className="text-slate-500">3Y: <span className={p.avg3y >= 0 ? "text-sky-300 font-mono" : "text-rose-300 font-mono"}>{fmtPct(p.avg3y)}</span></span>
                      ) : null}
                      {p.avg5y != null ? (
                        <span className="text-slate-500">5Y: <span className={p.avg5y >= 0 ? "text-sky-300 font-mono" : "text-rose-300 font-mono"}>{fmtPct(p.avg5y)}</span></span>
                      ) : null}
                    </div>
                  </div>
                  <div className="text-left flex-shrink-0">
                    <p className="text-xs text-slate-500 font-mono">{fmt(p.oldBalance)}</p>
                    <p className="text-xs text-slate-500">↓</p>
                    <p className="text-sm text-white font-mono">{fmt(p.newBalance)}</p>
                    <p className={`text-xs font-mono ${diff >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {diff >= 0 ? "+" : ""}{fmt(diff)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
          {result.unmatched?.length > 0 && (
            <div className="bg-amber-900/20 border border-amber-700/40 rounded-lg p-3 text-xs text-amber-200">
              <AlertCircle size={12} className="inline ml-1"/>
              {result.unmatched.length} שורות בקובץ לא תואמות לקופה במערכת (trackCode: {result.unmatched.slice(0,5).map(u => u.trackCode).join(", ")}{result.unmatched.length > 5 ? "..." : ""})
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-3 border-t border-slate-700">
          <button onClick={onClose} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2.5 rounded-lg text-sm">סגור (ללא שמירה)</button>
          <button
            onClick={handleConfirm}
            disabled={saving || saved}
            className={`flex-1 py-2.5 rounded-lg text-sm flex items-center justify-center gap-1.5 ${
              saved ? "bg-emerald-600 text-white" : saving ? "bg-slate-600 text-slate-300" : "bg-emerald-600 hover:bg-emerald-500 text-white"
            }`}>
            {saved ? <><CheckCircle2 size={14}/> נשמר!</> : saving ? <><Activity size={14} className="animate-spin"/> שומר...</> : <><Database size={14}/> אשר עדכון ל-Firestore</>}
          </button>
        </div>
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════
//  PERFORMANCE TAB — גרף ביצועים היסטורי
// ══════════════════════════════════════════════════════════════
const PerformanceTab = ({ assets }) => {
  const tracksWithSeries = assets.filter(a => a.monthlySeries?.length);

  const chartData = useMemo(() => {
    if (!tracksWithSeries.length) return [];
    const allMonths = new Set();
    tracksWithSeries.forEach(a => {
      interpolateSeries(a.monthlySeries).forEach(s => allMonths.add(s.iso));
    });
    const sortedMonths = [...allMonths].sort();
    return sortedMonths.map(iso => {
      const [y, m] = iso.split("-");
      const point = { month: `${HEBREW_MONTHS[parseInt(m)-1]} ${y.slice(2)}`, iso };
      tracksWithSeries.forEach(a => {
        const interp = interpolateSeries(a.monthlySeries);
        const hit = interp.find(s => s.iso === iso);
        if (hit) point[`#${a.trackCode}`] = hit.value;
      });
      return point;
    });
  }, [tracksWithSeries]);

  const cumulativeData = useMemo(() => {
    if (!chartData.length) return [];
    return chartData.map((row, i) => {
      const cum = { month: row.month, iso: row.iso };
      tracksWithSeries.forEach(a => {
        const key = `#${a.trackCode}`;
        const monthly = row[key];
        if (monthly == null) return;
        const prev = i > 0 ? cumulativeData_helper(chartData.slice(0, i+1), key) : monthly;
        cum[key] = prev;
      });
      return cum;
    });
  }, [chartData, tracksWithSeries]);

  if (!tracksWithSeries.length) {
    return (
      <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-10 text-center">
        <FileSpreadsheet size={48} className="mx-auto text-slate-600 mb-3"/>
        <h3 className="text-lg font-semibold text-slate-300 mb-2">אין עדיין נתוני ביצועים</h3>
        <p className="text-sm text-slate-500 mb-4">
          העלה קובץ גמל-נט כדי לראות גרף תשואות חודשי לאורך השנה האחרונה.
        </p>
        <p className="text-xs text-slate-600">
          הגרף יבנה אוטומטית עבור כל קופה שיש לה נתוני סדרה חודשית מהקובץ.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-bold text-slate-100 mb-1 flex items-center gap-2">
          <TrendingUp size={18} className="text-emerald-400"/>
          תשואות חודשיות — מקור: גמל-נט
        </h2>
        <p className="text-xs text-slate-500">השלמת חודשים חסרים באמצעות Interpolation ליניארי</p>
      </div>

      <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-5 mb-4">
        <h3 className="text-sm font-semibold text-slate-200 mb-3">תשואה חודשית (%)</h3>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155"/>
            <XAxis dataKey="month" stroke="#94a3b8" fontSize={10}/>
            <YAxis stroke="#94a3b8" fontSize={10} tickFormatter={v => `${v}%`}/>
            <Tooltip
              contentStyle={{background:"#1e293b", border:"1px solid #334155"}}
              formatter={(v, n) => [fmtPct(v), n]}
            />
            <Legend wrapperStyle={{fontSize:11}}/>
            {tracksWithSeries.map(a => (
              <Line
                key={a.trackCode}
                type="monotone"
                dataKey={`#${a.trackCode}`}
                name={`${a.owner} · ${a.type} (${a.trackCode})`}
                stroke={TRACK_COLOR[a.trackCode] || "#a3a3a3"}
                strokeWidth={2}
                dot={{r:3}}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {tracksWithSeries.map(a => {
          const series = a.monthlySeries;
          const cumulative = series.reduce((s, x) => (1 + s) * (1 + x.value/100) - 1, 0) * 100;
          const best = Math.max(...series.map(s => s.value));
          const worst = Math.min(...series.map(s => s.value));
          return (
            <div key={a.id} className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 rounded-full" style={{background: TRACK_COLOR[a.trackCode] || "#a3a3a3"}}/>
                <h4 className="text-sm font-semibold text-slate-200 truncate">{a.owner} · #{a.trackCode}</h4>
              </div>
              <p className="text-xs text-slate-500 mb-3 truncate">{a.type}</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-[10px] text-slate-500">12M מצטבר</p>
                  <p className={`text-sm font-mono ${cumulative >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmtPct(cumulative)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500">חודש טוב</p>
                  <p className="text-sm font-mono text-emerald-400">{fmtPct(best)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500">חודש רע</p>
                  <p className="text-sm font-mono text-rose-400">{fmtPct(worst)}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
// helper למצטבר בתוך useMemo
function cumulativeData_helper(rows, key) {
  let acc = 0;
  rows.forEach(r => { if (r[key] != null) acc = (1 + acc/100) * (1 + r[key]/100) * 100 - 100; });
  return acc;
}

// ══════════════════════════════════════════════════════════════
//  LOANS TAB — ניהול הלוואות עם טבלה עריכה
// ══════════════════════════════════════════════════════════════
const DEFAULT_LOANS = [
  { id:"ln1", name:"הלוואה מול השתלמות (מיטב)", icon:"credit", originalAmount:100000, currentBalance:84828, interestRate:4.5, monthlyPayment:1650, endDate:"2029-06-01", againstAsset:"קרן השתלמות מיטב · ציון" },
  { id:"ln2", name:"הלוואה מול פנסיה — לרכישת MSTY", icon:"credit", originalAmount:50000, currentBalance:50000 - (670 * 10), interestRate:4.2, monthlyPayment:670, endDate:"2032-07-01", againstAsset:"קרן פנסיה מנורה · ציון", linkedMSTY:true },
];

/** מחשב כמה חודשים נותרו עד endDate */
function monthsRemaining(endDate) {
  if (!endDate) return null;
  const end = new Date(endDate);
  const now = new Date();
  if (isNaN(end)) return null;
  const months = (end.getFullYear() - now.getFullYear()) * 12 + (end.getMonth() - now.getMonth());
  return Math.max(0, months);
}

/** אייקון לפי שם ההלוואה */
function loanIcon(name) {
  const s = (name || "").toLowerCase();
  if (s.includes("משכנתא") || s.includes("דירה") || s.includes("home")) return <Home size={14}/>;
  if (s.includes("רכב") || s.includes("car") || s.includes("אוטו")) return <Car size={14}/>;
  return <CreditCard size={14}/>;
}

const LoansTab = ({ loans, setLoans }) => {
  const addLoan = () => {
    const id = "ln" + Date.now();
    setLoans([...loans, { id, name:"הלוואה חדשה", originalAmount:0, currentBalance:0, interestRate:0, monthlyPayment:0, endDate: today() }]);
  };
  const updateLoan = (id, field, value) => {
    setLoans(loans.map(l => l.id === id ? { ...l, [field]: field === "name" || field === "endDate" ? value : (toNum(value) ?? 0) } : l));
  };
  const deleteLoan = (id) => setLoans(loans.filter(l => l.id !== id));

  const totals = useMemo(() => {
    const totalOriginal = loans.reduce((s, l) => s + (l.originalAmount || 0), 0);
    const totalBalance  = loans.reduce((s, l) => s + (l.currentBalance  || 0), 0);
    const totalMonthly  = loans.reduce((s, l) => s + (l.monthlyPayment  || 0), 0);
    const paidOff       = totalOriginal > 0 ? ((totalOriginal - totalBalance) / totalOriginal) * 100 : 0;
    return { totalOriginal, totalBalance, totalMonthly, paidOff };
  }, [loans]);

  return (
    <div>
      {/* כותרת */}
      <div className="mb-6 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-slate-100 mb-1 flex items-center gap-2">
            <CreditCard size={18} className="text-rose-400"/>
            ניהול הלוואות
          </h2>
          <p className="text-xs text-slate-500">ניהול ידני · {loans.length} הלוואות פעילות</p>
        </div>
        <button onClick={addLoan} className="flex items-center gap-1.5 text-sm bg-rose-600 hover:bg-rose-500 text-white px-3 py-1.5 rounded-lg">
          <Plus size={14}/> הוסף הלוואה
        </button>
      </div>

      {/* כרטיסי סיכום — צבעי אדום/כתום */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className="bg-gradient-to-br from-rose-900/40 to-rose-950/60 border border-rose-700/50 rounded-xl p-4">
          <div className="flex items-center gap-1.5 text-xs text-rose-300 mb-1"><CreditCard size={12}/> סך יתרה</div>
          <p className="text-xl font-bold text-rose-200 font-mono">{fmt(totals.totalBalance)}</p>
        </div>
        <div className="bg-gradient-to-br from-orange-900/40 to-orange-950/60 border border-orange-700/50 rounded-xl p-4">
          <div className="flex items-center gap-1.5 text-xs text-orange-300 mb-1"><Calendar size={12}/> החזר חודשי</div>
          <p className="text-xl font-bold text-orange-200 font-mono">{fmt(totals.totalMonthly)}</p>
        </div>
        <div className="bg-gradient-to-br from-amber-900/40 to-amber-950/60 border border-amber-700/50 rounded-xl p-4">
          <div className="flex items-center gap-1.5 text-xs text-amber-300 mb-1"><DollarSign size={12}/> סכום מקורי</div>
          <p className="text-xl font-bold text-amber-200 font-mono">{fmt(totals.totalOriginal)}</p>
        </div>
        <div className="bg-gradient-to-br from-emerald-900/30 to-emerald-950/50 border border-emerald-700/40 rounded-xl p-4">
          <div className="flex items-center gap-1.5 text-xs text-emerald-300 mb-1"><CheckCircle2 size={12}/> הוחזר עד כה</div>
          <p className="text-xl font-bold text-emerald-200 font-mono">{totals.paidOff.toFixed(1)}%</p>
        </div>
      </div>

      {/* טבלה עריכה */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-rose-950/30 border-b border-rose-800/30">
              <tr className="text-right text-xs text-rose-200 uppercase">
                <th className="p-3 font-semibold">שם ההלוואה</th>
                <th className="p-3 font-semibold">סכום מקורי</th>
                <th className="p-3 font-semibold">יתרה נוכחית</th>
                <th className="p-3 font-semibold">ריבית (%)</th>
                <th className="p-3 font-semibold">החזר חודשי</th>
                <th className="p-3 font-semibold">תאריך סיום</th>
                <th className="p-3 font-semibold">נותרו</th>
                <th className="p-3 font-semibold w-10"></th>
              </tr>
            </thead>
            <tbody>
              {loans.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-500 text-sm">
                    אין הלוואות. לחץ "הוסף הלוואה" להתחלה.
                  </td>
                </tr>
              )}
              {loans.map((l, idx) => {
                const remaining = monthsRemaining(l.endDate);
                const progress = l.originalAmount > 0 ? ((l.originalAmount - l.currentBalance) / l.originalAmount) * 100 : 0;
                return (
                  <tr key={l.id} className={`border-b border-slate-700/40 hover:bg-slate-800/50 ${idx % 2 === 0 ? "bg-slate-900/20" : ""}`}>
                    <td className="p-2">
                      <div className="flex items-center gap-2">
                        <span className="text-rose-400">{loanIcon(l.name)}</span>
                        <input type="text" value={l.name}
                          onChange={e => updateLoan(l.id, "name", e.target.value)}
                          className="bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-slate-100 text-sm w-full focus:border-rose-500 focus:outline-none"/>
                      </div>
                    </td>
                    <td className="p-2">
                      <input type="number" value={l.originalAmount}
                        onChange={e => updateLoan(l.id, "originalAmount", e.target.value)}
                        className="bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-amber-200 font-mono text-sm w-28 focus:border-rose-500 focus:outline-none"/>
                    </td>
                    <td className="p-2">
                      <div className="flex flex-col gap-1">
                        <input type="number" value={l.currentBalance}
                          onChange={e => updateLoan(l.id, "currentBalance", e.target.value)}
                          className="bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-rose-200 font-mono text-sm w-28 focus:border-rose-500 focus:outline-none"/>
                        <div className="h-1 bg-slate-800 rounded overflow-hidden">
                          <div className="h-full bg-emerald-500" style={{width:`${Math.min(100, progress)}%`}}/>
                        </div>
                      </div>
                    </td>
                    <td className="p-2">
                      <input type="number" step="0.01" value={l.interestRate}
                        onChange={e => updateLoan(l.id, "interestRate", e.target.value)}
                        className="bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-orange-200 font-mono text-sm w-20 focus:border-rose-500 focus:outline-none"/>
                    </td>
                    <td className="p-2">
                      <input type="number" value={l.monthlyPayment}
                        onChange={e => updateLoan(l.id, "monthlyPayment", e.target.value)}
                        className="bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-orange-200 font-mono text-sm w-24 focus:border-rose-500 focus:outline-none"/>
                    </td>
                    <td className="p-2">
                      <input type="date" value={l.endDate || ""}
                        onChange={e => updateLoan(l.id, "endDate", e.target.value)}
                        className="bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-slate-200 text-sm focus:border-rose-500 focus:outline-none"/>
                    </td>
                    <td className="p-2 text-center">
                      {remaining != null ? (
                        <span className={`inline-block font-mono text-xs px-2 py-0.5 rounded-full ${
                          remaining <= 12 ? "bg-emerald-900/40 text-emerald-300" :
                          remaining <= 36 ? "bg-amber-900/40 text-amber-300" :
                          "bg-rose-900/40 text-rose-300"
                        }`}>
                          {remaining} חודשים
                        </span>
                      ) : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="p-2 text-center">
                      <button onClick={() => deleteLoan(l.id)} className="text-slate-500 hover:text-rose-400">
                        <Trash2 size={14}/>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {/* שורת סיכום — סך ההחזר החודשי הכולל */}
            {loans.length > 0 && (
              <tfoot>
                <tr className="bg-gradient-to-r from-rose-950/50 via-orange-950/50 to-amber-950/50 border-t-2 border-rose-700/60">
                  <td className="p-3 font-bold text-rose-200 text-sm">סיכום · {loans.length} הלוואות</td>
                  <td className="p-3 font-mono text-amber-300 font-bold">{fmt(totals.totalOriginal)}</td>
                  <td className="p-3 font-mono text-rose-300 font-bold">{fmt(totals.totalBalance)}</td>
                  <td className="p-3 text-slate-500 text-xs">ממוצע משוקלל</td>
                  <td className="p-3 font-mono text-orange-300 font-bold text-base">{fmt(totals.totalMonthly)} <span className="text-xs font-normal opacity-70">/ חודש</span></td>
                  <td className="p-3 text-slate-500 text-xs" colSpan={3}>
                    סך צבירת ריבית עתידית משוערת — {fmt(totals.totalMonthly * (loans.reduce((s,l) => s + (monthsRemaining(l.endDate) || 0), 0) / Math.max(1, loans.length)))}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <p className="text-xs text-slate-500 mt-3 flex items-center gap-1.5">
        <AlertCircle size={12}/> ההחזר החודשי מוזן ידנית. בעתיד: חישוב אוטומטי לפי נוסחת לוח סילוקין (יתרה × ריבית / (1 - (1+ריבית)^-חודשים)).
      </p>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════
//  SAVINGS TAB — מעקב חסכונות חודשי
// ══════════════════════════════════════════════════════════════
const DEFAULT_SAVINGS = [
  { id:"sv1", ym:"2025-01", amount:3000, notes:"תחילת מעקב" },
  { id:"sv2", ym:"2025-06", amount:5000, notes:"בונוס חצי שנתי" },
  { id:"sv3", ym:"2025-12", amount:8000, notes:"בונוס שנתי מהעבודה" },
];

/** YM ל-תצוגה עברית */
function ymToHebrew(ym) {
  if (!ym) return "";
  const [y, m] = ym.split("-");
  return `${HEBREW_MONTHS[parseInt(m)-1]} ${y}`;
}

const SavingsTab = ({ savings, setSavings }) => {
  const [newRow, setNewRow] = useState({ ym: new Date().toISOString().slice(0,7), amount: "", notes: "" });

  const addSaving = () => {
    if (!newRow.ym || !newRow.amount) return;
    const id = "sv" + Date.now();
    setSavings([...savings, { id, ym: newRow.ym, amount: toNum(newRow.amount) ?? 0, notes: newRow.notes || "" }]);
    setNewRow({ ym: new Date().toISOString().slice(0,7), amount: "", notes: "" });
  };
  const updateSaving = (id, field, value) => {
    setSavings(savings.map(s => s.id === id ? { ...s, [field]: field === "amount" ? (toNum(value) ?? 0) : value } : s));
  };
  const deleteSaving = (id) => setSavings(savings.filter(s => s.id !== id));

  // V2.1.8 — ascending for stats/chart, descending for display (LIFO)
  const sorted = useMemo(() => [...savings].sort((a, b) => a.ym.localeCompare(b.ym)), [savings]);
  const displaySorted = useMemo(() => [...sorted].reverse(), [sorted]);

  const stats = useMemo(() => {
    const total      = sorted.reduce((s, x) => s + (x.amount || 0), 0);
    const count      = sorted.length;
    const avg        = count > 0 ? total / count : 0;
    const first      = sorted[0]?.ym;
    const last       = sorted[sorted.length - 1]?.ym;
    const maxMonth   = sorted.reduce((m, x) => x.amount > (m?.amount || 0) ? x : m, null);
    return { total, count, avg, first, last, maxMonth };
  }, [sorted]);

  // Build cumulative series for mini-chart
  const chartData = useMemo(() => {
    let cum = 0;
    return sorted.map(s => {
      cum += s.amount || 0;
      return { month: ymToHebrew(s.ym), amount: s.amount, cumulative: cum };
    });
  }, [sorted]);

  return (
    <div>
      {/* כותרת */}
      <div className="mb-6 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-slate-100 mb-1 flex items-center gap-2">
            <PiggyBank size={18} className="text-emerald-400"/>
            מעקב חסכונות חודשי
          </h2>
          <p className="text-xs text-slate-500">
            {stats.count > 0 ? (
              <>מ-<span className="text-emerald-300">{ymToHebrew(stats.first)}</span> עד <span className="text-emerald-300">{ymToHebrew(stats.last)}</span> · {stats.count} חודשים</>
            ) : (
              <>עדיין לא הוזנו רשומות</>
            )}
          </p>
        </div>
      </div>

      {/* כרטיסי סיכום — צבעי ירוק/כחול */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className="bg-gradient-to-br from-emerald-900/40 to-emerald-950/60 border border-emerald-700/50 rounded-xl p-4">
          <div className="flex items-center gap-1.5 text-xs text-emerald-300 mb-1"><PiggyBank size={12}/> סך חסכונות מצטבר</div>
          <p className="text-xl font-bold text-emerald-200 font-mono">{fmt(stats.total)}</p>
        </div>
        <div className="bg-gradient-to-br from-blue-900/40 to-blue-950/60 border border-blue-700/50 rounded-xl p-4">
          <div className="flex items-center gap-1.5 text-xs text-blue-300 mb-1"><Calendar size={12}/> ממוצע חודשי</div>
          <p className="text-xl font-bold text-blue-200 font-mono">{fmt(stats.avg)}</p>
        </div>
        <div className="bg-gradient-to-br from-cyan-900/40 to-cyan-950/60 border border-cyan-700/50 rounded-xl p-4">
          <div className="flex items-center gap-1.5 text-xs text-cyan-300 mb-1"><Target size={12}/> חודש שיא</div>
          <p className="text-xl font-bold text-cyan-200 font-mono">{stats.maxMonth ? fmt(stats.maxMonth.amount) : "—"}</p>
          <p className="text-[10px] text-cyan-400/70 mt-0.5">{stats.maxMonth ? ymToHebrew(stats.maxMonth.ym) : ""}</p>
        </div>
        <div className="bg-gradient-to-br from-teal-900/40 to-teal-950/60 border border-teal-700/50 rounded-xl p-4">
          <div className="flex items-center gap-1.5 text-xs text-teal-300 mb-1"><Activity size={12}/> חודשים פעילים</div>
          <p className="text-xl font-bold text-teal-200 font-mono">{stats.count}</p>
        </div>
      </div>

      {/* Mini Chart — מגמת חיסכון */}
      {chartData.length > 1 && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-5 mb-5">
          <h3 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
            <TrendingUp size={14} className="text-emerald-400"/>
            מגמת חיסכון מצטבר
          </h3>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData} margin={{top:5, right:10, left:0, bottom:5}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155"/>
              <XAxis dataKey="month" stroke="#94a3b8" fontSize={10}/>
              <YAxis stroke="#94a3b8" fontSize={10} tickFormatter={v => `₪${(v/1000).toFixed(0)}K`}/>
              <Tooltip
                contentStyle={{background:"#1e293b", border:"1px solid #334155"}}
                formatter={(v, n) => [fmt(v), n === "cumulative" ? "מצטבר" : "הפקדה"]}
              />
              <Line type="monotone" dataKey="cumulative" stroke="#10b981" strokeWidth={2.5} dot={{r:3, fill:"#10b981"}} name="מצטבר"/>
              <Line type="monotone" dataKey="amount" stroke="#3b82f6" strokeWidth={1.5} dot={{r:2}} strokeDasharray="4 2" name="הפקדה חודשית"/>
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* טופס הוספה מהיר */}
      <div className="bg-emerald-950/20 border border-emerald-800/40 rounded-xl p-4 mb-4">
        <h3 className="text-sm font-semibold text-emerald-200 mb-3 flex items-center gap-2">
          <Plus size={14}/> הוספת רשומה חדשה (ה-5 לחודש)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <input type="month" value={newRow.ym}
            onChange={e => setNewRow({...newRow, ym: e.target.value})}
            className="bg-slate-900/60 border border-slate-700 rounded px-3 py-2 text-slate-100 text-sm focus:border-emerald-500 focus:outline-none"/>
          <input type="number" placeholder="סכום (₪)" value={newRow.amount}
            onChange={e => setNewRow({...newRow, amount: e.target.value})}
            className="bg-slate-900/60 border border-slate-700 rounded px-3 py-2 text-emerald-200 font-mono text-sm focus:border-emerald-500 focus:outline-none"/>
          <input type="text" placeholder="הערות (בונוס, הפקדה מיוחדת...)" value={newRow.notes}
            onChange={e => setNewRow({...newRow, notes: e.target.value})}
            className="bg-slate-900/60 border border-slate-700 rounded px-3 py-2 text-slate-100 text-sm focus:border-emerald-500 focus:outline-none"/>
          <button onClick={addSaving} disabled={!newRow.ym || !newRow.amount}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded px-3 py-2 text-sm flex items-center justify-center gap-1.5">
            <Save size={14}/> שמור
          </button>
        </div>
      </div>

      {/* טבלת רשומות */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-emerald-950/30 border-b border-emerald-800/30">
              <tr className="text-right text-xs text-emerald-200 uppercase">
                <th className="p-3 font-semibold">חודש / שנה</th>
                <th className="p-3 font-semibold">סכום הפקדה</th>
                <th className="p-3 font-semibold">מצטבר</th>
                <th className="p-3 font-semibold">הערות</th>
                <th className="p-3 font-semibold w-10"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-500 text-sm">
                    אין רשומות חיסכון. הוסף דרך הטופס למעלה.
                  </td>
                </tr>
              )}
              {(() => {
                // V2.1.8 — LIFO: חדש ביותר ראשון; runningTotal מחושב מסדר עולה ומוצג בעמודה
                const totalsMap = {};
                let run = 0;
                sorted.forEach(s => { run += s.amount || 0; totalsMap[s.id] = run; });
                return displaySorted.map((s, idx) => {
                  const runningTotal = totalsMap[s.id] || 0;
                  return (
                    <tr key={s.id} className={`border-b border-slate-700/40 hover:bg-slate-800/50 ${idx % 2 === 0 ? "bg-slate-900/20" : ""}`}>
                      <td className="p-2">
                        <input type="month" value={s.ym}
                          onChange={e => updateSaving(s.id, "ym", e.target.value)}
                          className="bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-slate-100 text-sm focus:border-emerald-500 focus:outline-none"/>
                      </td>
                      <td className="p-2">
                        <input type="number" value={s.amount}
                          onChange={e => updateSaving(s.id, "amount", e.target.value)}
                          className="bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-emerald-200 font-mono text-sm w-28 focus:border-emerald-500 focus:outline-none"/>
                      </td>
                      <td className="p-2 font-mono text-blue-300 text-sm">{fmt(runningTotal)}</td>
                      <td className="p-2">
                        <input type="text" value={s.notes || ""}
                          onChange={e => updateSaving(s.id, "notes", e.target.value)}
                          placeholder="—"
                          className="bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-slate-200 text-sm w-full focus:border-emerald-500 focus:outline-none"/>
                      </td>
                      <td className="p-2 text-center">
                        <button onClick={() => deleteSaving(s.id)} className="text-slate-500 hover:text-rose-400">
                          <Trash2 size={14}/>
                        </button>
                      </td>
                    </tr>
                  );
                });
              })()}
            </tbody>
            {/* שורת סיכום */}
            {sorted.length > 0 && (
              <tfoot>
                <tr className="bg-gradient-to-r from-emerald-950/50 via-teal-950/50 to-blue-950/50 border-t-2 border-emerald-700/60">
                  <td className="p-3 font-bold text-emerald-200 text-sm">סיכום</td>
                  <td className="p-3 font-mono text-emerald-300 font-bold">{fmt(stats.total / stats.count)}<span className="text-xs font-normal opacity-70"> ממוצע</span></td>
                  <td className="p-3 font-mono text-blue-300 font-bold text-base">{fmt(stats.total)}</td>
                  <td className="p-3 text-xs text-slate-400" colSpan={2}>
                    {stats.first && stats.last ? `מ-${ymToHebrew(stats.first)} עד ${ymToHebrew(stats.last)}` : ""}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════
//  MSTY TAB — סוכן ניהול השקעה אקטיבי
// ══════════════════════════════════════════════════════════════
const fmtUSD = n => `$${(n || 0).toLocaleString("en-US", { minimumFractionDigits:2, maximumFractionDigits:2 })}`;

/** עבור רשומת דיבידנד, כמה מניות החזקנו באותו זמן */
function sharesAtDate(iso, originalShares, splitDate, splitRatio) {
  return new Date(iso) < new Date(splitDate)
    ? originalShares
    : Math.floor(originalShares / splitRatio);
}

/** חישוב יתרת הלוואת MSTY — הלוואה לינארית 50,000 ₪, 670 ₪ לחודש */
function loanBalanceAt(iso, loanAmount, monthlyPayment, startDate) {
  const months = Math.max(0,
    (new Date(iso).getFullYear() - new Date(startDate).getFullYear()) * 12 +
    (new Date(iso).getMonth() - new Date(startDate).getMonth())
  );
  return Math.max(0, loanAmount - months * monthlyPayment);
}

/** קומפוננטת אקורדיון — קיבוץ חלוקות לפי חודש + dropdown שבועי */
const MonthlyAccordion = ({ enriched, dividends, taxRate, fx, loanMonthly, updateAmount, toggleVerified, deleteDiv, confirmEstimate, summary }) => {
  const [openMonth, setOpenMonth] = useState(null);

  const byMonth = useMemo(() => {
    const map = new Map();
    enriched.forEach(d => {
      const key = d.date.slice(0, 7); // YYYY-MM
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(d);
    });
    // להפוך ל-array ולהוסיף agg לכל חודש — רק אישורים (ללא צפי עתידי) נכללים ב-sum
    const arr = Array.from(map.entries()).map(([ym, items]) => {
      const confirmedOnly = items.filter(d => !d.isEstimate);
      const gross     = confirmedOnly.reduce((s,d) => s + d.grossUSD, 0);
      const net       = confirmedOnly.reduce((s,d) => s + d.netUSD, 0);
      const tax       = gross - net;
      const netILS    = net * fx;
      const coverage  = netILS / loanMonthly;
      const hasEstimates = items.some(d => d.isEstimate);
      const [y, m]    = ym.split("-").map(Number);
      const monthName = HEBREW_MONTHS[m-1] + " " + y;
      return { ym, monthName, items, gross, net, tax, netILS, coverage, hasEstimates };
    });
    // V2.1.8 — LIFO: החודש החדש ביותר (אפריל 2026) מופיע ראשון
    arr.sort((a,b) => b.ym.localeCompare(a.ym));
    return arr;
  }, [enriched, fx, loanMonthly]);

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between p-3 border-b border-slate-700">
        <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
          <Calendar size={14}/> היסטוריית חלוקות לפי חודש · {byMonth.length} חודשים · {enriched.length} חלוקות
        </h3>
        <span className="text-xs text-slate-400">לחץ על חודש להצגת פירוט שבועי</span>
      </div>
      <div className="divide-y divide-slate-700/50">
        {byMonth.map(m => {
          const isOpen = openMonth === m.ym;
          const covered = m.coverage >= 1;
          return (
            <div key={m.ym}>
              {/* שורה חודשית ראשית */}
              <button
                onClick={() => setOpenMonth(isOpen ? null : m.ym)}
                className={`w-full text-right px-3 py-3 flex items-center gap-3 hover:bg-slate-900/40 transition-colors ${isOpen ? "bg-slate-900/30" : ""}`}
              >
                <div className="w-5 text-slate-400">
                  {isOpen ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}
                </div>
                <div className="flex-1 grid grid-cols-2 md:grid-cols-5 gap-2 items-center text-xs">
                  <div>
                    <div className="text-slate-100 font-bold text-sm">{m.monthName}</div>
                    <div className="text-[10px] text-slate-500">{m.items.length} חלוקות</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400">ברוטו USD</div>
                    <div className="text-slate-200 font-mono">{fmtUSD(m.gross)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400">נטו USD (×{((1-taxRate)*100).toFixed(0)}%)</div>
                    <div className="text-emerald-300 font-mono">{fmtUSD(m.net)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400">נטו ₪</div>
                    <div className="text-emerald-400 font-mono font-bold">{fmt(m.netILS)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400">כיסוי ₪670</div>
                    <div className={`font-mono font-bold ${covered ? "text-emerald-400" : "text-amber-400"}`}>
                      {covered ? "✅ " : "⚠️ "}{(m.coverage * 100).toFixed(0)}%
                    </div>
                  </div>
                </div>
              </button>

              {/* פירוט שבועי — dropdown */}
              {isOpen && (
                <div className="bg-slate-950/40 px-3 pb-3">
                  <table className="w-full text-xs mt-1">
                    <thead className="text-slate-500">
                      <tr>
                        <th className="px-2 py-1.5 text-right">תאריך</th>
                        <th className="px-2 py-1.5 text-right">$/מניה</th>
                        <th className="px-2 py-1.5 text-right">מניות</th>
                        <th className="px-2 py-1.5 text-right">ברוטו USD</th>
                        <th className="px-2 py-1.5 text-right">מס 25%</th>
                        <th className="px-2 py-1.5 text-right">נטו USD</th>
                        <th className="px-2 py-1.5 text-right">נטו ₪</th>
                        <th className="px-2 py-1.5 text-center">אומת</th>
                        <th className="px-2 py-1.5"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* V2.1.8 — LIFO: החלוקה האחרונה בחודש ראשונה */}
                      {[...m.items].reverse().map((d, rowIdx) => {
                        const origIdx = dividends.findIndex(x => x.date === d.date && x.amount === d.amount);
                        const rowBg = d.isEstimate
                          ? "bg-amber-900/20 border-amber-700/40"
                          : (d.shareBasis === "pre" ? "bg-purple-900/10" : "");
                        return (
                          <tr key={`${d.date}-${rowIdx}`} className={`border-t border-slate-700/30 ${rowBg}`}>
                            <td className="px-2 py-1 text-slate-200">
                              {fmtDate(d.date)}
                              {d.isEstimate && (
                                <span className="ms-1.5 inline-block text-[8px] font-bold bg-amber-500/20 border border-amber-400/60 text-amber-300 px-1.5 py-0.5 rounded uppercase tracking-wide">
                                  צפי
                                </span>
                              )}
                            </td>
                            <td className="px-2 py-1">
                              <input type="number" step="0.0001" value={d.amount} onChange={e => updateAmount(origIdx, e.target.value)}
                                className="bg-transparent text-amber-300 w-20 outline-none border-b border-transparent hover:border-amber-500/50 focus:border-amber-400"/>
                            </td>
                            <td className="px-2 py-1 text-slate-300">{d.shares}<span className="text-[9px] text-slate-500"> ({d.shareBasis})</span></td>
                            <td className={`px-2 py-1 font-mono ${d.isEstimate ? "text-amber-300/60 italic" : "text-slate-300"}`}>{fmtUSD(d.grossUSD)}</td>
                            <td className={`px-2 py-1 font-mono ${d.isEstimate ? "text-amber-300/60 italic" : "text-rose-300"}`}>{fmtUSD(d.taxUSD)}</td>
                            <td className={`px-2 py-1 font-mono font-semibold ${d.isEstimate ? "text-amber-300/60 italic" : "text-emerald-300"}`}>{fmtUSD(d.netUSD)}</td>
                            <td className={`px-2 py-1 font-mono font-bold ${d.isEstimate ? "text-amber-300/60 italic" : "text-emerald-400"}`}>{fmt(d.netILS)}</td>
                            <td className="px-2 py-1 text-center">
                              {d.isEstimate ? (
                                <button
                                  onClick={() => confirmEstimate && confirmEstimate(origIdx)}
                                  title="אישור ידני — העבר ל'מאושר' ותכלל ב-ROI"
                                  className="text-[9px] bg-emerald-600 hover:bg-emerald-500 text-white px-1.5 py-0.5 rounded font-bold"
                                >
                                  אשר
                                </button>
                              ) : (
                                <button onClick={() => toggleVerified(origIdx)} title={d.verified ? "אומת" : "לא אומת"}>
                                  {d.verified
                                    ? <CheckCircle2 size={13} className="text-emerald-400"/>
                                    : <AlertCircle  size={13} className="text-amber-400"/>}
                                </button>
                              )}
                            </td>
                            <td className="px-2 py-1 text-center">
                              <button onClick={() => deleteDiv(origIdx)} className="text-rose-400 hover:text-rose-300">
                                <Trash2 size={11}/>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {d_notes_for_month(m.items)}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {/* סיכום גדול בתחתית */}
      <div className="bg-gradient-to-r from-emerald-900/30 to-slate-900/50 border-t-2 border-emerald-700/40 p-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <div>
          <div className="text-[10px] text-slate-400">סה"כ חלוקות</div>
          <div className="text-slate-100 font-bold">{enriched.length}</div>
        </div>
        <div>
          <div className="text-[10px] text-slate-400">ברוטו כולל</div>
          <div className="text-slate-200 font-bold">{fmtUSD(summary.totalGross)}</div>
        </div>
        <div>
          <div className="text-[10px] text-slate-400">נטו כולל USD</div>
          <div className="text-emerald-300 font-bold">{fmtUSD(summary.totalNet)}</div>
        </div>
        <div>
          <div className="text-[10px] text-slate-400">נטו כולל ₪</div>
          <div className="text-emerald-400 font-bold text-base">{fmt(summary.totalNetILS)}</div>
        </div>
      </div>
    </div>
  );
};

/** הערות חודשיות — הצגת note ייחודי אם קיים */
function d_notes_for_month(items) {
  const notes = items.filter(i => i.note).map(i => `${fmtDate(i.date)}: ${i.note}`);
  if (!notes.length) return null;
  return (
    <div className="mt-2 px-2 text-[10px] text-slate-500 leading-relaxed">
      📌 {notes.join(" · ")}
    </div>
  );
}

const MSTYTab = ({ msty, dividends, setDividends, fx, setFx, currentPrice, setCurrentPrice }) => {
  const [newDivDate, setNewDivDate] = useState("");
  const [newDivAmount, setNewDivAmount] = useState("");
  const [taxRate, setTaxRate] = useState(msty?.taxRate ?? 0.25);

  const loanStart   = msty?.purchaseDate || "2025-07-15";
  const loanAmount  = msty?.loanAmountILS || 50000;
  const loanMonthly = msty?.monthlyLoanPaymentILS || 670;
  const purchasePrc = msty?.purchasePrice || 23.5;
  const originalSh  = msty?.originalShares || 590;
  const splitDate   = msty?.reverseSplitDate || MSTY_REVERSE_SPLIT_DATE;
  const splitRatio  = msty?.reverseSplitRatio || MSTY_REVERSE_SPLIT_RATIO;
  const sharesNow   = msty?.sharesCount || Math.floor(originalSh / splitRatio);

  /** V2.1.6 — בודק אם דיבידנד הוא תחזית עתידית (estimate) שטרם אושר */
  const isFutureEstimate = (d) => {
    if (d.status !== "estimate") return false;
    const today = new Date(); today.setHours(0,0,0,0);
    const dt = new Date(d.date); dt.setHours(0,0,0,0);
    return dt > today;
  };

  /** נבנה שורת חישוב לכל חלוקה עם מטא-דטה מלא.
   *  דיבידנדי "צפי" עתידיים מסומנים ב-isEstimate:true ואינם נצברים ב-cumGross/cumNet — כדי למנוע "הזיות" ב-ROI. */
  const enriched = useMemo(() => {
    const sorted = [...dividends].sort((a,b) => new Date(a.date) - new Date(b.date));
    let cumGross = 0, cumNet = 0;
    return sorted.map(d => {
      const shares = sharesAtDate(d.date, originalSh, splitDate, splitRatio);
      const grossUSD = d.amount * shares;
      const taxUSD = grossUSD * taxRate;
      const netUSD = grossUSD - taxUSD;
      const netILS = netUSD * fx;
      const estimate = isFutureEstimate(d);
      if (!estimate) { cumGross += grossUSD; cumNet += netUSD; }
      return {
        ...d,
        isEstimate: estimate,
        shares, grossUSD, taxUSD, netUSD, netILS,
        cumGross, cumNet, cumNetILS: cumNet * fx,
      };
    });
  }, [dividends, fx, taxRate, originalSh, splitDate, splitRatio]);

  /** חישובי סיכום — רק על דיבידנדים מאושרים (ללא צפי עתידי) */
  const summary = useMemo(() => {
    const confirmed = enriched.filter(d => !d.isEstimate);
    const totalGross = confirmed.reduce((s,d) => s + d.grossUSD, 0);
    const totalNet   = confirmed.reduce((s,d) => s + d.netUSD, 0);
    const totalNetILS = totalNet * fx;
    const estimatesCount = enriched.length - confirmed.length;
    const estimatesNetUSD = enriched.filter(d => d.isEstimate).reduce((s,d) => s + d.netUSD, 0);
    const monthsElapsed = Math.max(1,
      (new Date().getFullYear() - new Date(loanStart).getFullYear()) * 12 +
      (new Date().getMonth() - new Date(loanStart).getMonth())
    );
    const totalLoanPaid = monthsElapsed * loanMonthly;
    const loanRemaining = Math.max(0, loanAmount - totalLoanPaid);
    const avgMonthlyNetILS = totalNetILS / monthsElapsed;
    const coverageRatio = avgMonthlyNetILS / loanMonthly;
    const initialInvestUSD = originalSh * purchasePrc;
    const initialInvestILS = initialInvestUSD * (msty?.loanStartFXRate || 3.7);
    const currentMarketUSD = sharesNow * currentPrice;
    const currentMarketILS = currentMarketUSD * fx;
    const unrealizedPL_ILS = currentMarketILS - initialInvestILS;
    const totalReturnILS = unrealizedPL_ILS + totalNetILS;
    return {
      totalGross, totalNet, totalNetILS,
      monthsElapsed, totalLoanPaid, loanRemaining,
      avgMonthlyNetILS, coverageRatio,
      initialInvestUSD, initialInvestILS,
      currentMarketUSD, currentMarketILS,
      unrealizedPL_ILS, totalReturnILS,
      estimatesCount, estimatesNetUSD, estimatesNetILS: estimatesNetUSD * fx,
    };
  }, [enriched, fx, currentPrice, sharesNow, originalSh, purchasePrc, loanAmount, loanMonthly, loanStart, msty]);

  /** נתונים לגרף: חלוקות מצטברות (נטו) מול יתרת הלוואה */
  const chartData = useMemo(() => {
    return enriched.map(d => ({
      date: d.date.slice(5),
      cumNetILS: Math.round(d.cumNetILS),
      loanBal: Math.round(loanBalanceAt(d.date, loanAmount, loanMonthly, loanStart)),
      weeklyNetILS: Math.round(d.netILS),
    }));
  }, [enriched, loanAmount, loanMonthly, loanStart]);

  /** נתוני Break-even */
  const breakEven = useMemo(() => {
    // חודשים עד שהחלוקות המצטברות הנטו יעברו את סך ההלוואה (50,000 ₪)
    if (summary.avgMonthlyNetILS <= 0) return { months: Infinity, date: null, feasible: false };
    const remainingToCover = loanAmount - summary.totalNetILS;
    if (remainingToCover <= 0) return { months: 0, date: today(), feasible: true, already: true };
    const monthsNeeded = Math.ceil(remainingToCover / summary.avgMonthlyNetILS);
    const dt = new Date();
    dt.setMonth(dt.getMonth() + monthsNeeded);
    return { months: monthsNeeded, date: dt.toISOString().slice(0,10), feasible: monthsNeeded < 240 };
  }, [summary, loanAmount]);

  const addDividend = () => {
    if (!newDivDate || !newDivAmount) return;
    const amt = parseFloat(newDivAmount);
    if (!Number.isFinite(amt)) return;
    const basis = new Date(newDivDate) < new Date(splitDate) ? "pre" : "post";
    // V2.1.6 — תאריך עתידי → status:"estimate" (לא ייכלל ב-ROI עד שיאושר ידנית או שיעבור התאריך)
    const isFuture = new Date(newDivDate) > new Date();
    setDividends([...dividends, {
      date: newDivDate, amount: amt,
      verified: !isFuture,
      status: isFuture ? "estimate" : "confirmed",
      shareBasis: basis,
      note: isFuture ? "צפי — הוסף ידנית" : "נוסף ידנית",
    }]);
    setNewDivDate(""); setNewDivAmount("");
  };
  const deleteDiv = idx => setDividends(dividends.filter((_,i) => i !== idx));
  const toggleVerified = idx => setDividends(dividends.map((d,i) => i === idx ? { ...d, verified: !d.verified } : d));
  const updateAmount = (idx, val) => setDividends(dividends.map((d,i) => i === idx ? { ...d, amount: parseFloat(val) || 0 } : d));
  const confirmEstimate = idx => setDividends(dividends.map((d,i) => i === idx ? { ...d, status: "confirmed", verified: true, note: (d.note || "") + " · אושר ידנית" } : d));

  return (
    <div className="space-y-5">
      {/* כותרת + פרמטרים */}
      <div className="bg-gradient-to-br from-amber-900/20 to-orange-900/20 border border-amber-700/40 rounded-2xl p-5">
        <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
          <div>
            <h2 className="text-xl font-bold text-amber-200 flex items-center gap-2">
              <DollarSign size={20}/> MSTY — סוכן ניהול השקעה
            </h2>
            <p className="text-xs text-amber-300/70 mt-1">
              רכישה 20/05/2025: 590 @ ${msty?.purchasePrice || 23.45} = ${(msty?.purchaseTotalUSD || 13835.5).toLocaleString()} · שער המרה {msty?.loanStartFXRate || 3.5} · ← {sharesNow} אחרי reverse split 1:{splitRatio} ({fmtDate(splitDate)}) · הלוואה ₪50,000, החזר 670 ₪/חודש
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <label className="bg-slate-900/50 border border-slate-700 rounded-lg p-2">
            <span className="text-[10px] text-slate-400 block">מחיר נוכחי (USD)</span>
            <input type="number" step="0.01" value={currentPrice} onChange={e => setCurrentPrice(parseFloat(e.target.value) || 0)}
              className="bg-transparent text-amber-200 font-bold w-full text-sm outline-none"/>
          </label>
          <label className="bg-slate-900/50 border border-slate-700 rounded-lg p-2">
            <span className="text-[10px] text-slate-400 block">שער USD/ILS</span>
            <input type="number" step="0.01" value={fx} onChange={e => setFx(parseFloat(e.target.value) || 0)}
              className="bg-transparent text-amber-200 font-bold w-full text-sm outline-none"/>
          </label>
          <label className="bg-slate-900/50 border border-slate-700 rounded-lg p-2">
            <span className="text-[10px] text-slate-400 block">מס רווחי הון</span>
            <input type="number" step="0.01" value={taxRate} onChange={e => setTaxRate(parseFloat(e.target.value) || 0)}
              className="bg-transparent text-amber-200 font-bold w-full text-sm outline-none"/>
          </label>
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-2">
            <span className="text-[10px] text-slate-400 block">שווי שוק נוכחי</span>
            <span className="text-amber-200 font-bold text-sm">{fmtUSD(summary.currentMarketUSD)} · {fmt(summary.currentMarketILS)}</span>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-slate-800/50 border border-emerald-700/40 rounded-xl p-4">
          <p className="text-[11px] text-slate-400">סך חלוקות נטו</p>
          <p className="text-xl font-bold text-emerald-400">{fmt(summary.totalNetILS)}</p>
          <p className="text-[10px] text-slate-500">{fmtUSD(summary.totalNet)} אחרי מס {(taxRate*100).toFixed(0)}%</p>
        </div>
        <div className="bg-slate-800/50 border border-rose-700/40 rounded-xl p-4">
          <p className="text-[11px] text-slate-400">יתרת הלוואה</p>
          <p className="text-xl font-bold text-rose-400">{fmt(summary.loanRemaining)}</p>
          <p className="text-[10px] text-slate-500">שולמו {fmt(summary.totalLoanPaid)} ב-{summary.monthsElapsed} חודשים</p>
        </div>
        <div className="bg-slate-800/50 border border-sky-700/40 rounded-xl p-4">
          <p className="text-[11px] text-slate-400">ממוצע חודשי נטו</p>
          <p className="text-xl font-bold text-sky-400">{fmt(summary.avgMonthlyNetILS)}</p>
          <p className={`text-[10px] font-semibold ${summary.coverageRatio >= 1 ? "text-emerald-400" : "text-amber-400"}`}>
            כיסוי החזר: {(summary.coverageRatio * 100).toFixed(0)}%
          </p>
        </div>
        <div className={`bg-slate-800/50 border rounded-xl p-4 ${summary.totalReturnILS >= 0 ? "border-emerald-700/40" : "border-rose-700/40"}`}>
          <p className="text-[11px] text-slate-400">תשואה כוללת (שווי+חלוקות)</p>
          <p className={`text-xl font-bold ${summary.totalReturnILS >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
            {summary.totalReturnILS >= 0 ? "+" : ""}{fmt(summary.totalReturnILS)}
          </p>
          <p className="text-[10px] text-slate-500">
            {((summary.totalReturnILS / summary.initialInvestILS) * 100).toFixed(1)}% מההשקעה הראשונית
          </p>
        </div>
      </div>

      {/* ROI Cashflow Panel — דיבידנדים כהכנסה מול החזרי הלוואה כהוצאה */}
      {(() => {
        const cashflowDelta = summary.totalNetILS - summary.totalLoanPaid;
        const netEquity     = summary.currentMarketILS + summary.totalNetILS - summary.loanRemaining;
        const positive      = cashflowDelta >= 0;
        const equityPos     = netEquity >= 0;
        return (
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 border-2 border-amber-500/40 rounded-2xl p-5 shadow-lg shadow-amber-500/10">
            <div className="flex items-start gap-3 mb-4">
              <DollarSign size={22} className="text-amber-300"/>
              <div className="flex-1">
                <h3 className="font-bold text-amber-100 text-base">ROI · רווחיות מול החזר הלוואה</h3>
                <p className="text-[11px] text-amber-300/70 mt-0.5">
                  ה-50,000 ₪ שהולוו מול הפנסיה של ציון שימשו במלואם לרכישת 590 MSTY במאי 2025.
                  מטרת ההשקעה: לכסות את החזר ההלוואה (670 ₪/חודש) מתוך הדיבידנדים.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="bg-emerald-900/30 border border-emerald-700/40 rounded-lg p-3">
                <p className="text-[10px] text-emerald-300/80">הכנסה · דיבידנדים (נטו)</p>
                <p className="text-lg font-bold text-emerald-300 font-mono">+{fmt(summary.totalNetILS)}</p>
                <p className="text-[9px] text-emerald-400/60">{summary.monthsElapsed} חודשים · {fmt(summary.avgMonthlyNetILS)}/חודש</p>
              </div>
              <div className="bg-rose-900/30 border border-rose-700/40 rounded-lg p-3">
                <p className="text-[10px] text-rose-300/80">הוצאה · החזרי הלוואה</p>
                <p className="text-lg font-bold text-rose-300 font-mono">-{fmt(summary.totalLoanPaid)}</p>
                <p className="text-[9px] text-rose-400/60">{summary.monthsElapsed} × {fmt(loanMonthly)}/חודש</p>
              </div>
              <div className={`border rounded-lg p-3 ${positive ? "bg-sky-900/30 border-sky-700/40" : "bg-amber-900/30 border-amber-700/40"}`}>
                <p className={`text-[10px] ${positive ? "text-sky-300/80" : "text-amber-300/80"}`}>תזרים נטו עד היום</p>
                <p className={`text-lg font-bold font-mono ${positive ? "text-sky-300" : "text-amber-300"}`}>
                  {positive ? "+" : ""}{fmt(cashflowDelta)}
                </p>
                <p className="text-[9px] text-slate-500">דיבידנדים − החזרים</p>
              </div>
              <div className={`border rounded-lg p-3 ${equityPos ? "bg-violet-900/30 border-violet-700/40" : "bg-rose-900/30 border-rose-700/40"}`}>
                <p className={`text-[10px] ${equityPos ? "text-violet-300/80" : "text-rose-300/80"}`}>הון נטו בפוזיציה</p>
                <p className={`text-lg font-bold font-mono ${equityPos ? "text-violet-300" : "text-rose-300"}`}>
                  {equityPos ? "+" : ""}{fmt(netEquity)}
                </p>
                <p className="text-[9px] text-slate-500">שווי שוק + דיבידנדים − יתרת הלוואה</p>
              </div>
            </div>

            {/* משוואה ויזואלית */}
            <div className="bg-slate-950/50 border border-slate-700/40 rounded-lg p-3 font-mono text-[11px]">
              <div className="flex items-center justify-between gap-2 text-slate-400 mb-1">
                <span>מאזן ההשקעה</span>
                <span className="text-[10px] text-slate-500">כל הערכים בש"ח</span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap text-slate-200">
                <span className="text-violet-300 font-bold">{fmt(netEquity)}</span>
                <span className="text-slate-500">=</span>
                <span className="text-sky-300">{fmt(summary.currentMarketILS)}</span>
                <span className="text-[9px] text-slate-500">(שווי שוק {sharesNow}×${currentPrice})</span>
                <span className="text-slate-500">+</span>
                <span className="text-emerald-300">{fmt(summary.totalNetILS)}</span>
                <span className="text-[9px] text-slate-500">(דיבידנדים נטו)</span>
                <span className="text-slate-500">−</span>
                <span className="text-rose-300">{fmt(summary.loanRemaining)}</span>
                <span className="text-[9px] text-slate-500">(יתרת הלוואה)</span>
              </div>
            </div>

            {/* Status indicator */}
            <div className={`mt-3 rounded-lg p-3 border ${
              summary.coverageRatio >= 1
                ? "bg-emerald-900/20 border-emerald-700/40"
                : summary.coverageRatio >= 0.7
                  ? "bg-amber-900/20 border-amber-700/40"
                  : "bg-rose-900/20 border-rose-700/40"
            }`}>
              <p className={`text-xs font-semibold ${
                summary.coverageRatio >= 1 ? "text-emerald-300"
                : summary.coverageRatio >= 0.7 ? "text-amber-300"
                : "text-rose-300"
              }`}>
                {summary.coverageRatio >= 1
                  ? `✅ הדיבידנדים מכסים ${(summary.coverageRatio*100).toFixed(0)}% מהחזר החודשי — המטרה הושגה.`
                  : summary.coverageRatio >= 0.7
                    ? `⚠️ הדיבידנדים מכסים ${(summary.coverageRatio*100).toFixed(0)}% מהחזר החודשי — נדרש ${fmt(loanMonthly - summary.avgMonthlyNetILS)}/חודש מהונך העצמי.`
                    : `🔴 הדיבידנדים מכסים רק ${(summary.coverageRatio*100).toFixed(0)}% מהחזר — רוב ההחזר מגיע מההון העצמי.`}
              </p>
            </div>
          </div>
        );
      })()}

      {/* Estimates Panel — צפי דיבידנדים עתידיים (לא נכללים ב-ROI) */}
      {summary.estimatesCount > 0 && (
        <div className="bg-amber-900/20 border-2 border-amber-600/40 border-dashed rounded-2xl p-4">
          <div className="flex items-start gap-3">
            <AlertCircle size={20} className="text-amber-400 flex-shrink-0 mt-0.5"/>
            <div className="flex-1">
              <h3 className="font-bold text-amber-200 text-sm">
                🔮 {summary.estimatesCount} דיבידנד{summary.estimatesCount > 1 ? "ים" : ""} בצפי — לא נכלל{summary.estimatesCount > 1 ? "ים" : ""} ב-ROI
              </h3>
              <p className="text-[11px] text-amber-300/80 mt-1 leading-relaxed">
                תחזיות לסכומים עתידיים שהתגלו בסריקה או הוזנו ידנית. סה״כ פוטנציאל: {fmtUSD(summary.estimatesNetUSD)} נטו (≈ {fmt(summary.estimatesNetILS)}).
                <br/>
                <span className="text-amber-400 font-semibold">הם יוזרקו ל-ROI אוטומטית ברגע שיעבור התאריך, או כשתלחץ "אשר" בטבלה.</span>
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {enriched.filter(d => d.isEstimate).map((d, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 bg-amber-950/50 border border-amber-700/50 text-amber-200 text-[10px] font-mono px-2 py-1 rounded">
                    {d.date} · ${d.amount.toFixed(4)} · נטו ≈ {fmt(d.netILS)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Break-even Panel */}
      <div className={`rounded-2xl p-5 border ${breakEven.feasible ? "bg-emerald-900/20 border-emerald-700/40" : "bg-amber-900/20 border-amber-700/40"}`}>
        <div className="flex items-start gap-3">
          <Target size={22} className={breakEven.feasible ? "text-emerald-400" : "text-amber-400"}/>
          <div className="flex-1">
            <h3 className="font-bold text-slate-100">נקודת Break-even — החזר מלא של ההלוואה מתוך חלוקות נטו</h3>
            {breakEven.already ? (
              <p className="text-emerald-300 text-sm mt-1">
                🎉 כבר חצית את ה-break-even! סך החלוקות הנטו ({fmt(summary.totalNetILS)}) עלה על סכום ההלוואה ({fmt(loanAmount)}).
              </p>
            ) : breakEven.feasible ? (
              <p className="text-emerald-300 text-sm mt-1">
                בקצב הנוכחי ({fmt(summary.avgMonthlyNetILS)}/חודש נטו), תכסה את יתרת {fmt(loanAmount - summary.totalNetILS)} בעוד {" "}
                <strong>{breakEven.months} חודשים</strong> · בערך ב-{fmtDate(breakEven.date)}.
              </p>
            ) : (
              <p className="text-amber-300 text-sm mt-1">
                אזהרה: הקצב הנוכחי ({fmt(summary.avgMonthlyNetILS)}/חודש) נמוך מדי — {breakEven.months} חודשים ≈ {(breakEven.months/12).toFixed(1)} שנים.
                שקול להגדיל החזר או להעריך מחדש את ההשקעה.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* גרף: חלוקות מצטברות נטו מול יתרת הלוואה */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-5">
        <h3 className="text-sm font-bold text-slate-100 mb-3 flex items-center gap-2">
          <TrendingUp size={16} className="text-emerald-400"/> חלוקות מצטברות (נטו, ₪) מול יתרת הלוואה
        </h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155"/>
            <XAxis dataKey="date" stroke="#94a3b8" fontSize={10}/>
            <YAxis stroke="#94a3b8" fontSize={10} tickFormatter={v => `₪${(v/1000).toFixed(0)}K`}/>
            <Tooltip formatter={v => fmt(v)} contentStyle={{background:"#1e293b", border:"1px solid #334155"}}/>
            <Legend wrapperStyle={{fontSize:11}}/>
            <Line type="monotone" dataKey="cumNetILS"  stroke="#10b981" strokeWidth={2.5} name="חלוקות מצטברות נטו" dot={false}/>
            <Line type="monotone" dataKey="loanBal"    stroke="#f43f5e" strokeWidth={2.5} name="יתרת הלוואה"        dot={false}/>
            <Line type="monotone" dataKey="weeklyNetILS" stroke="#06b6d4" strokeWidth={1.5} name="חלוקה נטו ₪"     dot={{r:2}} strokeDasharray="3 3"/>
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* הוספת דיבידנד חדש */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-4">
        <h3 className="text-sm font-bold text-slate-200 mb-3 flex items-center gap-2"><Plus size={14}/> הוספת חלוקה שבועית/חודשית</h3>
        <div className="flex gap-2 flex-wrap items-end">
          <label className="flex flex-col">
            <span className="text-[10px] text-slate-400">תאריך</span>
            <input type="date" value={newDivDate} onChange={e => setNewDivDate(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100"/>
          </label>
          <label className="flex flex-col">
            <span className="text-[10px] text-slate-400">סכום למניה (USD)</span>
            <input type="number" step="0.0001" value={newDivAmount} onChange={e => setNewDivAmount(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100 w-28"/>
          </label>
          <button onClick={addDividend} disabled={!newDivDate || !newDivAmount}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white text-sm px-3 py-1.5 rounded flex items-center gap-1">
            <Plus size={14}/> הוסף
          </button>
        </div>
      </div>

      {/* טבלת אקורדיון חודשית */}
      <MonthlyAccordion
        enriched={enriched}
        dividends={dividends}
        taxRate={taxRate}
        fx={fx}
        loanMonthly={loanMonthly}
        updateAmount={updateAmount}
        toggleVerified={toggleVerified}
        deleteDiv={deleteDiv}
        confirmEstimate={confirmEstimate}
        summary={summary}
      />

      {/* הערה על ניטור יומי */}
      <div className="bg-indigo-900/20 border border-indigo-700/40 rounded-xl p-4 text-xs text-indigo-200">
        <p className="font-bold mb-1">💡 ניטור יומי של MSTY/MSTR</p>
        <p className="text-indigo-300/80 leading-relaxed">
          המערכת לא רצה ברקע 24/7 — אני מגיב רק כשאתה שולח הודעה. כדי לקבל התראות שוטפות:
          (א) השתמש ב-<strong>Scheduled Task</strong> דרך Cowork (ראה מדריך בסוף); (ב) בקר בדשבורד בתחילת כל שבוע ואעדכן את הדיבידנד האחרון; (ג) הפעל התראות push של YieldMax.
        </p>
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════
//  SMART SCAN — אייקון רדאר פועם + Progress Bar + Toast
// ══════════════════════════════════════════════════════════════
const SCAN_LABELS = [
  "🔗 מתחבר למסלולי פנסיה...",
  "📊 בודק תשואות בקרנות השתלמות...",
  "💰 סורק דיבידנדים של MSTY...",
  "📰 מחפש ידיעות על MSTR...",
  "🏦 סורק קרנות כספיות...",
  "💱 מעדכן שערי USD/ILS...",
  "🧮 מחשב ביצועים חודשיים...",
  "✨ מסכם ממצאים...",
];

const SmartScanButton = ({ currentPrice, currentFX, onApply, onScanComplete }) => {
  const [scanning, setScanning]   = useState(false);
  const [progress, setProgress]   = useState(0);
  const [label, setLabel]         = useState("");
  const [toast, setToast]         = useState(null);

  // V2.1.7 — NO FAKE DATA: קורא daily_scan.json שנוצר ע"י הסוכן המתוזמן
  // אין jitter, אין Math.random(). אם ערך null — רושמים "לא נמצאו נתונים עדכניים"
  const runScan = () => {
    if (scanning) return;
    setScanning(true);
    setProgress(0);
    setLabel(SCAN_LABELS[0]);
    let tick = 0;
    let scanData = null;

    // שלב 1: קריאת נתוני שוק — Firestore ראשון, fallback ל-daily_scan.json (V2.4.1)
    const fetchPromise = (async () => {
      try {
        // נסה Firestore תחילה (עובד ב-Netlify + נייד)
        const fsData = await getMarketData();
        if (fsData) { scanData = fsData; return; }
      } catch { /* Firestore לא זמין */ }
      try {
        // Fallback: קובץ JSON מקומי (פיתוח בלבד)
        const res = await fetch("/daily_scan.json", { cache: "no-store" });
        if (res.ok) scanData = await res.json();
      } catch { /* קובץ לא קיים — ימשיך ב-null */ }
    })();

    const interval = setInterval(() => {
      tick++;
      const p = Math.min(100, tick * 2);
      setProgress(p);
      const idx = Math.min(SCAN_LABELS.length - 1, Math.floor((p / 100) * SCAN_LABELS.length));
      setLabel(SCAN_LABELS[idx]);
      if (p >= 100) {
        clearInterval(interval);
        fetchPromise.then(() => {
          const sd = scanData;
          const warnings = [];

          // V2.1.8 — Golden Sources: ערכים מ-daily_scan.json בלבד (TradingView/Yahoo/Investing.com/YieldMaxETFs)
          const newMstyPrice = sd?.msty?.price ?? null;
          const newFX        = sd?.fx?.usdIls ?? null;
          const nd           = sd?.msty?.nextDividend;
          // דיבידנד: הצג רק אם status="confirmed" (מ-YieldMaxETFs.com). אחרת — "ממתין לפרסום"
          const newDividend  = (nd?.amount != null && nd?.exDate)
            ? { date: nd.exDate, amount: nd.amount, payDate: nd.payDate || null,
                status: nd.status === "confirmed" ? "confirmed" : "estimate" }
            : null;
          const mstrPrice    = sd?.mstr?.price ?? null;
          const mstrChange   = sd?.mstr?.changePct != null ? `${sd.mstr.changePct >= 0 ? "+" : ""}${sd.mstr.changePct}%` : null;
          const menoraMthly  = sd?.pension?.menora168?.monthlyReturn ?? null;
          const menoraYtd    = sd?.pension?.menora168?.ytd ?? null;

          // אזהרות בעברית על נתונים חסרים
          if (newMstyPrice == null) warnings.push("מחיר MSTY לא נמצא — יש לעדכן ידנית מ-TradingView / Yahoo Finance");
          if (newFX == null)        warnings.push("שער USD/ILS לא נמצא — יש לבדוק ב-Investing.com / בנק ישראל");
          if (mstrPrice == null)    warnings.push("מחיר MSTR לא נמצא — יש לעדכן ידנית מ-TradingView");
          if (menoraYtd == null)    warnings.push("תשואת פנסיה מנורה (track 168) לא זמינה — בדוק ב-Funder / Gemelnet");
          if (newDividend?.status === "estimate") warnings.push("דיבידנד MSTY בצפי בלבד — טרם אושר רשמית ב-YieldMaxETFs.com");
          // תרגום אזהרות טכניות מהסריקה לעברית
          if (sd?.warnings?.length) warnings.push(...sd.warnings.map(w => `📋 ${translateWarning(w)}`));

          const findings = {
            timestamp: sd?.timestamp || new Date().toISOString(),
            msty: {
              previousPrice: currentPrice,
              newPrice: newMstyPrice,
              previousFX: currentFX,
              newFX: newFX,
              newDividend,
            },
            mstr: {
              price: mstrPrice,
              change: mstrChange || (mstrPrice == null ? "לא נמצאו נתונים עדכניים" : null),
            },
            menora: { newYtd: menoraYtd, monthlyReturn: menoraMthly, track: "168" },
            news: sd?.news || [],
          };

          setTimeout(() => {
            setScanning(false);
            const changes = onApply ? onApply(findings) : [];
            const allMessages = [...changes, ...warnings];
            setToast({
              type: "success",
              title: changes.length > 0 ? "✨ סריקה הושלמה · עדכונים הוזרקו" : "סריקה הושלמה · אין שינויים",
              body: sd == null
                ? "⚠️ לא נמצא קובץ daily_scan.json — הפעל את הסריקה המתוזמנת דרך Cowork."
                : changes.length > 0
                  ? `${changes.length} עדכונים הוזרקו. ${warnings.length > 0 ? `${warnings.length} נתונים חסרים.` : ""}`
                  : "כל הנתונים כבר מעודכנים. לא נדרשו שינויים.",
              details: findings,
              changes: allMessages,
            });
            onScanComplete?.(findings);
          }, 300);
        });
      }
    }, 80);
  };

  return (
    <>
      {/* כפתור רדאר פועם */}
      <button onClick={runScan} disabled={scanning}
        className={`relative group flex items-center gap-2 text-sm font-semibold px-3 py-1.5 rounded-lg border transition-all ${
          scanning
            ? "bg-cyan-950 border-cyan-500 text-cyan-200 cursor-wait"
            : "bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 border-cyan-400 text-white shadow-lg shadow-cyan-500/30"
        }`}
        title="Smart Scan — סריקה אקטיבית של כל הנתונים">
        <span className="relative w-5 h-5 flex items-center justify-center">
          {/* טבעות הרדאר הפועמות */}
          <span className={`absolute inset-0 rounded-full border-2 border-cyan-300 ${scanning ? "animate-ping" : "animate-pulse"}`}/>
          <span className={`absolute inset-1 rounded-full border border-cyan-200/60 ${scanning ? "animate-ping" : ""}`} style={{animationDelay:"300ms"}}/>
          <span className="absolute inset-2 rounded-full bg-cyan-300"/>
          {/* נקודה מרכזית */}
          <Radio size={10} className="relative text-white drop-shadow" strokeWidth={3}/>
        </span>
        <span>{scanning ? "סורק..." : "Smart Scan"}</span>
        {scanning && <Sparkles size={12} className="animate-spin text-cyan-200"/>}
      </button>

      {/* Progress Bar Overlay */}
      {scanning && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 border-2 border-cyan-500/50 rounded-2xl p-6 max-w-md w-full shadow-2xl shadow-cyan-500/20">
            <div className="flex items-center gap-3 mb-4">
              <div className="relative w-12 h-12 flex items-center justify-center">
                <span className="absolute inset-0 rounded-full border-2 border-cyan-400 animate-ping"/>
                <span className="absolute inset-2 rounded-full border border-cyan-300/60 animate-ping" style={{animationDelay:"300ms"}}/>
                <span className="absolute inset-4 rounded-full bg-cyan-300 animate-pulse"/>
                <Search size={20} className="relative text-cyan-100 animate-pulse"/>
              </div>
              <div>
                <h3 className="text-cyan-100 font-bold text-lg">Smart Scan פעיל</h3>
                <p className="text-cyan-300/70 text-xs">סוכן אוטונומי סורק את מאגרי האמת</p>
              </div>
            </div>
            <div className="mb-3">
              <p className="text-cyan-200 text-sm font-medium min-h-[1.5rem] transition-opacity">{label}</p>
            </div>
            <div className="h-3 bg-slate-950 border border-slate-700 rounded-full overflow-hidden mb-2">
              <div className="h-full bg-gradient-to-r from-cyan-500 via-blue-500 to-violet-500 transition-all duration-75"
                   style={{width:`${progress}%`, boxShadow:"0 0 12px rgba(6,182,212,0.8)"}}/>
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>{progress.toFixed(0)}%</span>
              <span>{progress < 100 ? "בעבודה..." : "מסיים..."}</span>
            </div>
          </div>
        </div>
      )}

      {/* Toast סיום */}
      {toast && <ScanToast toast={toast} onClose={() => setToast(null)}/>}
    </>
  );
};

const ScanToast = ({ toast, onClose }) => {
  // V2.1.5 — ❌ ללא auto-dismiss! המודל נשאר פתוח עד שהמשתמש לוחץ "סגור".
  if (!toast) return null;
  const d = toast.details || {};
  const changes = toast.changes || [];
  return (
    <div
      className="fixed inset-0 z-[60] bg-slate-950/70 backdrop-blur-sm flex items-start justify-center p-4 pt-10 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative bg-gradient-to-br from-emerald-950 via-slate-900 to-cyan-950 border-2 border-emerald-500/60 rounded-2xl p-5 shadow-2xl shadow-emerald-500/30 max-w-xl w-full animate-in slide-in-from-top duration-300"
        onClick={e => e.stopPropagation()}
      >
        {/* X בכפתור פינה */}
        <button
          onClick={onClose}
          aria-label="סגור"
          className="absolute top-3 left-3 w-8 h-8 rounded-full bg-slate-800/80 hover:bg-rose-600 border border-slate-600 hover:border-rose-400 text-slate-300 hover:text-white flex items-center justify-center transition-colors"
        >
          <X size={16}/>
        </button>

        <div className="flex items-start gap-3 pr-8">
          <div className="flex-shrink-0 w-11 h-11 rounded-full bg-emerald-500/20 border border-emerald-400 flex items-center justify-center">
            <CheckCircle2 size={22} className="text-emerald-300"/>
          </div>
          <div className="flex-1">
            <h3 className="text-emerald-100 font-bold text-base">{toast.title}</h3>
            <p className="text-emerald-200/90 text-sm mt-1">{toast.body}</p>

            {/* ═══ Diff של עדכונים שהוחלו ═══ */}
            {changes.length > 0 && (
              <div className="mt-3 bg-slate-950/60 border border-emerald-600/50 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles size={12} className="text-emerald-300"/>
                  <span className="text-[11px] text-emerald-300 font-semibold">{changes.length} שינויים הוחלו אוטומטית בדשבורד</span>
                </div>
                <ul className="space-y-1.5">
                  {changes.map((c, i) => (
                    <li key={i} className="text-[11px] text-emerald-100 bg-emerald-900/30 border border-emerald-700/30 rounded px-2 py-1.5 font-mono leading-relaxed">
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* ═══ ממצאים גולמיים (4 כרטיסים) ═══ */}
            {d.msty && (
              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                <div className="bg-slate-950/50 border border-cyan-700/40 rounded p-2">
                  <div className="text-[9px] text-cyan-400 uppercase tracking-wide">MSTY מחיר</div>
                  <div className="text-cyan-100 font-mono font-bold">
                    ${d.msty.newPrice}
                    {d.msty.previousPrice != null && d.msty.newPrice !== d.msty.previousPrice && (
                      <span className="text-[9px] text-slate-400 ms-1">(היה ${d.msty.previousPrice})</span>
                    )}
                  </div>
                </div>
                <div className="bg-slate-950/50 border border-violet-700/40 rounded p-2">
                  <div className="text-[9px] text-violet-400 uppercase tracking-wide">USD/ILS</div>
                  <div className="text-violet-100 font-mono font-bold">
                    {d.msty.newFX}
                    {d.msty.previousFX != null && d.msty.newFX !== d.msty.previousFX && (
                      <span className="text-[9px] text-slate-400 ms-1">(היה {d.msty.previousFX})</span>
                    )}
                  </div>
                </div>
                <div className="bg-slate-950/50 border border-amber-700/40 rounded p-2">
                  <div className="text-[9px] text-amber-400 uppercase tracking-wide">MSTR</div>
                  <div className="text-amber-100 font-mono font-bold">${d.mstr?.price} <span className="text-[9px] text-amber-300/70">{d.mstr?.change}</span></div>
                </div>
                <div className="bg-slate-950/50 border border-indigo-700/40 rounded p-2">
                  <div className="text-[9px] text-indigo-400 uppercase tracking-wide">פנסיה מנורה</div>
                  <div className="text-indigo-100 font-mono font-bold">YTD +{d.menora?.newYtd}%</div>
                </div>
                {d.msty.newDividend && (
                  <div className="col-span-2 bg-emerald-950/50 border border-emerald-700/50 rounded p-2">
                    <div className="text-[9px] text-emerald-400 uppercase tracking-wide">דיבידנד הבא (זוהה)</div>
                    <div className="text-emerald-100 font-mono font-bold">
                      ${d.msty.newDividend.amount} · ex-date {d.msty.newDividend.date} · pay {d.msty.newDividend.payDate}
                    </div>
                  </div>
                )}
              </div>
            )}

            <p className="mt-3 text-[10px] text-emerald-300/60 leading-relaxed">
              💾 נתונים נשמרו ב-localStorage · יישארו גם לאחר רענון הדף.
              <br/>⏰ סריקה: {new Date(toast.details?.timestamp || Date.now()).toLocaleString("he-IL")}
            </p>

            <div className="mt-4 flex justify-end">
              <button
                onClick={onClose}
                className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold px-4 py-2 rounded-lg shadow-md shadow-emerald-500/20 transition-colors"
              >
                <CheckCircle2 size={14}/> סגור
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════
//  MorningBriefModal — V2.1.8
//  קופץ בבוקר אם יש סריקה מתוזמנת שטרם אושרה
//  Golden Sources: TradingView/Yahoo Finance · Investing.com/בנק ישראל · YieldMaxETFs.com בלבד
// ══════════════════════════════════════════════════════════════

// V2.1.8 — מתרגם אזהרות טכניות לעברית ידידותית
const translateWarning = (w) => {
  const rules = [
    [/price conflict/i,             "נמצאה סתירה בנתוני המחיר — השתמש בנתון שמקורו TradingView/Yahoo Finance"],
    [/blocked by.*proxy/i,          "הגישה לאתר נחסמה ע\"י הרשת — יש לעדכן את הנתון ידנית"],
    [/egress.*block/i,              "הגישה לאתר נחסמה — יש לעדכן את הנתון ידנית"],
    [/unavailable/i,                "הנתון אינו זמין כרגע — יש לעדכן ידנית"],
    [/conflicting.*mstr/i,          "סתירה בנתוני MSTR — השתמש בנתון מ-TradingView בלבד"],
    [/menora.*unavailable/i,        "תשואת מנורה 168 אינה זמינה — יש לבדוק ב-Funder/Gemelnet"],
    [/meitav.*unavailable/i,        "תשואת מיטב 13245 אינה זמינה — יש לבדוק ב-Gemelnet"],
    [/mid.market/i,                 "השער הוא שוק פתוח (mid-market) — עשוי להיות שונה מהשער הרשמי של בנק ישראל"],
    [/sunday|שבת|weekend/i,         "שוק סגור (סוף שבוע) — מחיר אחרון הוא סגירת יום חמישי"],
    [/yieldmaxetfs\.com.*block/i,   "YieldMaxETFs.com נחסם — לא ניתן לאמת דיבידנד רשמי. בדוק ידנית בכתובת: yieldmaxetfs.com/our-etfs/msty/"],
    [/secondary source/i,           "המידע הגיע ממקור משני — יש לאמת מול YieldMaxETFs.com"],
    [/estimate.*dividend/i,         "דיבידנד בצפי בלבד — טרם פורסם רשמית ב-YieldMaxETFs.com"],
  ];
  for (const [pattern, replacement] of rules) {
    if (pattern.test(w)) return replacement;
  }
  return w; // החזר כמות-שהוא אם אין תרגום
};

const GOLDEN_SOURCES_NOTE = "מקורות מאושרים: מחירים מ-TradingView / Yahoo Finance · מט\"ח מ-Investing.com / בנק ישראל · דיבידנד מ-YieldMaxETFs.com בלבד";

const MorningBriefModal = ({ brief, onApply, onDismiss }) => {
  if (!brief) return null;
  const { date, timestamp, msty, mstr, fx, pension, studyFunds, news, warnings } = brief;
  const whenStr = timestamp ? new Date(timestamp).toLocaleString("he-IL", { dateStyle: "full", timeStyle: "short" }) : date;
  return (
    <div className="fixed inset-0 z-[70] bg-slate-950/80 backdrop-blur-md flex items-start justify-center p-4 pt-8 overflow-y-auto">
      <div
        className="relative bg-gradient-to-br from-indigo-950 via-slate-900 to-purple-950 border-2 border-indigo-500/60 rounded-2xl p-6 shadow-2xl shadow-indigo-500/40 max-w-2xl w-full animate-in fade-in slide-in-from-top duration-500"
        onClick={e => e.stopPropagation()}
      >
        {/* כותרת */}
        <div className="flex items-start gap-3 mb-4">
          <div className="flex-shrink-0 w-14 h-14 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/40">
            <span className="text-3xl">☀️</span>
          </div>
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-indigo-100">בוקר טוב, ציון</h2>
            <p className="text-xs text-indigo-300/80 mt-1">
              הנה ממצאי הסריקה האוטומטית · {whenStr}
            </p>
          </div>
          <button
            onClick={onDismiss}
            aria-label="סגור ללא אישור"
            className="w-9 h-9 rounded-full bg-slate-800/80 hover:bg-rose-700 border border-slate-600 text-slate-300 hover:text-white flex items-center justify-center transition-colors"
          >
            <X size={16}/>
          </button>
        </div>

        {/* V2.1.8 — אזהרות מתורגמות לעברית מלאה */}
        {Array.isArray(warnings) && warnings.length > 0 && (
          <div className="bg-amber-900/30 border border-amber-600/40 rounded-lg p-2 mb-3">
            <p className="text-[10px] text-amber-300 font-semibold mb-1">⚠️ הערות על איכות הנתונים:</p>
            <ul className="text-[11px] text-amber-200 space-y-0.5">
              {warnings.map((w, i) => <li key={i}>• {translateWarning(w)}</li>)}
            </ul>
          </div>
        )}
        {/* V2.1.8 — Golden Sources badge */}
        <div className="bg-slate-900/60 border border-slate-700/50 rounded-lg px-2.5 py-1.5 mb-3 flex items-center gap-1.5">
          <CheckCircle2 size={10} className="text-emerald-400 flex-shrink-0"/>
          <span className="text-[10px] text-slate-400">{GOLDEN_SOURCES_NOTE}</span>
        </div>

        {/* MSTY / FX / MSTR */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-3">
          {msty?.price != null && (
            <div className="bg-slate-950/60 border border-cyan-700/50 rounded-lg p-3">
              <div className="text-[9px] text-cyan-400 uppercase tracking-wide">MSTY מחיר</div>
              <div className="text-xl text-cyan-100 font-mono font-bold">${msty.price}</div>
              <div className="text-[9px] text-slate-500 mt-0.5">{msty.priceSource || "—"}</div>
            </div>
          )}
          {mstr?.price != null && (
            <div className="bg-slate-950/60 border border-amber-700/50 rounded-lg p-3">
              <div className="text-[9px] text-amber-400 uppercase tracking-wide">MSTR</div>
              <div className="text-xl text-amber-100 font-mono font-bold">${mstr.price}</div>
              <div className={`text-[10px] font-mono mt-0.5 ${(mstr.changePct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {mstr.changePct != null ? `${mstr.changePct >= 0 ? "+" : ""}${mstr.changePct}%` : ""}
              </div>
            </div>
          )}
          {fx?.usdIls != null && (
            <div className="bg-slate-950/60 border border-violet-700/50 rounded-lg p-3">
              <div className="text-[9px] text-violet-400 uppercase tracking-wide">USD/ILS</div>
              <div className="text-xl text-violet-100 font-mono font-bold">{fx.usdIls}</div>
              <div className="text-[9px] text-slate-500 mt-0.5">{fx.source || "—"}</div>
            </div>
          )}
        </div>

        {/* דיבידנד הבא (צפי) */}
        {msty?.nextDividend && (msty.nextDividend.amount != null || msty.nextDividend.exDate) && (
          <div className={`rounded-lg p-3 mb-3 border-2 ${
            msty.nextDividend.status === "confirmed"
              ? "bg-emerald-900/30 border-emerald-600/50"
              : "bg-amber-900/30 border-amber-600/50 border-dashed"
          }`}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">{msty.nextDividend.status === "confirmed" ? "💰" : "🔮"}</span>
              <span className={`text-xs font-bold ${msty.nextDividend.status === "confirmed" ? "text-emerald-200" : "text-amber-200"}`}>
                דיבידנד הבא — {msty.nextDividend.status === "confirmed" ? "מאושר" : "צפי"}
              </span>
              {msty.nextDividend.status !== "confirmed" && (
                <span className="text-[9px] font-bold bg-amber-500/20 border border-amber-400/60 text-amber-300 px-1.5 py-0.5 rounded uppercase tracking-wide">
                  Estimate
                </span>
              )}
            </div>
            <div className="font-mono text-sm text-slate-100">
              {msty.nextDividend.amount != null
                ? `$${msty.nextDividend.amount}/מניה`
                : <span className="text-amber-300 italic">ממתין לפרסום ב-YieldMaxETFs.com</span>}
              {msty.nextDividend.exDate && ` · ex-date ${msty.nextDividend.exDate}`}
              {msty.nextDividend.payDate && ` · pay ${msty.nextDividend.payDate}`}
            </div>
            <p className="text-[10px] text-slate-400 mt-1">
              {msty.nextDividend.status === "confirmed"
                ? "✅ אושר רשמית ב-YieldMaxETFs.com — ייכלל בחישוב ה-ROI לאחר תאריך ה-ex."
                : "⏳ צפי בלבד — לא ייכלל ב-ROI עד שיפורסם רשמית ב-YieldMaxETFs.com ויאושר ידנית בטבלה."}
            </p>
          </div>
        )}

        {/* עדכוני תשואה — פנסיה וקרנות השתלמות */}
        {(pension || studyFunds) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3">
            {pension?.menora168 && (
              <div className="bg-slate-950/60 border border-indigo-700/50 rounded-lg p-3">
                <div className="text-[10px] text-indigo-400 font-semibold mb-1">📊 פנסיה מנורה (ציון · track 168)</div>
                <div className="font-mono text-sm text-indigo-100">
                  חודשי: {pension.menora168.monthlyReturn != null ? `${pension.menora168.monthlyReturn >= 0 ? "+" : ""}${pension.menora168.monthlyReturn}%` : "—"}
                  <span className="text-slate-500 mx-2">·</span>
                  YTD: {pension.menora168.ytd != null ? `${pension.menora168.ytd >= 0 ? "+" : ""}${pension.menora168.ytd}%` : "—"}
                </div>
              </div>
            )}
            {studyFunds?.meitav13245 && (
              <div className="bg-slate-950/60 border border-purple-700/50 rounded-lg p-3">
                <div className="text-[10px] text-purple-400 font-semibold mb-1">📈 השתלמות מיטב (track 13245)</div>
                <div className="font-mono text-sm text-purple-100">
                  חודשי: {studyFunds.meitav13245.monthlyReturn != null ? `${studyFunds.meitav13245.monthlyReturn >= 0 ? "+" : ""}${studyFunds.meitav13245.monthlyReturn}%` : "—"}
                  <span className="text-slate-500 mx-2">·</span>
                  YTD: {studyFunds.meitav13245.ytd != null ? `${studyFunds.meitav13245.ytd >= 0 ? "+" : ""}${studyFunds.meitav13245.ytd}%` : "—"}
                </div>
              </div>
            )}
          </div>
        )}

        {/* חדשות */}
        {Array.isArray(news) && news.length > 0 && (
          <div className="bg-slate-950/40 border border-slate-700/50 rounded-lg p-3 mb-4">
            <p className="text-xs font-bold text-slate-200 mb-2 flex items-center gap-1.5">
              <FileText size={12} className="text-sky-400"/> ידיעות חדשותיות ({news.length})
            </p>
            <ul className="space-y-2">
              {news.slice(0, 5).map((n, i) => (
                <li key={i} className="text-[11px] border-r-2 border-sky-500/50 pr-2">
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block text-[8px] font-bold bg-sky-500/20 border border-sky-400/50 text-sky-300 px-1.5 py-0.5 rounded uppercase tracking-wide">
                      {n.ticker || "news"}
                    </span>
                    {n.url ? (
                      <a href={n.url} target="_blank" rel="noreferrer" className="text-sky-200 hover:text-sky-100 font-semibold hover:underline">
                        {n.title}
                      </a>
                    ) : (
                      <span className="text-sky-200 font-semibold">{n.title}</span>
                    )}
                  </div>
                  <p className="text-slate-400 leading-snug mt-0.5">{n.summary}</p>
                  {n.source && <p className="text-[9px] text-slate-500 mt-0.5">מקור: {n.source}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* כפתורי פעולה */}
        <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-700/50">
          <button
            onClick={onDismiss}
            className="text-sm text-slate-400 hover:text-slate-200 px-3 py-2"
          >
            הצג מאוחר יותר
          </button>
          <button
            onClick={onApply}
            className="flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white text-sm font-bold px-5 py-2.5 rounded-lg shadow-lg shadow-emerald-500/30 border border-emerald-400/40"
          >
            <CheckCircle2 size={16}/> אשר עדכון נתונים
          </button>
        </div>
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════
//  SaveToast — V2.1.6 · הודעת שמירה זעירה לאחר עריכה ידנית
// ══════════════════════════════════════════════════════════════
const SaveToast = ({ message, onDone }) => {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => onDone?.(), 1800);
    return () => clearTimeout(t);
  }, [message, onDone]);
  if (!message) return null;
  return (
    <div className="fixed bottom-6 right-6 z-[80] bg-gradient-to-r from-emerald-700 to-emerald-600 border border-emerald-400/60 text-white text-xs font-semibold px-3 py-2 rounded-lg shadow-xl shadow-emerald-500/30 animate-in slide-in-from-bottom-4 fade-in duration-200">
      <span className="flex items-center gap-1.5">
        <CheckCircle2 size={13}/> {message}
      </span>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════
//  חישוב ריבית דריבית — לתצוגת חיסכון ילדים
// ══════════════════════════════════════════════════════════════
function compoundInterest(principal, monthlyDeposit, annualRate, years) {
  const r = annualRate / 100 / 12;
  const n = years * 12;
  const fv = principal * Math.pow(1 + r, n) + monthlyDeposit * ((Math.pow(1 + r, n) - 1) / (r || 1));
  return Math.round(fv);
}

const CompoundProjection = ({ asset }) => {
  const monthly = (asset.employeeDeposit || 0) + (asset.employerDeposit || 0);
  const rate = 6; // הנחה: 6% שנתי
  const points = [3, 5, 10, 15, 18].map(yrs => ({
    yrs,
    value: compoundInterest(asset.reportBalance || 0, monthly, rate, yrs),
  }));
  return (
    <div className="mt-2 bg-slate-900/40 border border-slate-700/50 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <TrendingUp size={12} className="text-emerald-400"/>
        <span className="text-[11px] font-semibold text-slate-300">תחזית ריבית דריבית · {rate}% שנתי · {fmt(monthly)}/חודש</span>
      </div>
      <div className="grid grid-cols-5 gap-1">
        {points.map(p => (
          <div key={p.yrs} className="bg-slate-950/50 border border-slate-700/40 rounded p-1.5 text-center">
            <div className="text-[9px] text-slate-400">+{p.yrs}ש</div>
            <div className="text-[11px] text-emerald-300 font-bold font-mono">{fmt(p.value)}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════
//  V2.1.9 · LIVE MARKET ENGINE
//  Golden Sources: Yahoo Finance (IBIT, MSTY, ILS=X)
//  TA tracks: 1183441 (S&P500), 1159243 (Nasdaq) — via Yahoo .TA suffix
//  ⚠️ No manual lock applied to auto-tracked assets — dynamic NAV
// ══════════════════════════════════════════════════════════════

// V2.5.1 — fallback: אם .TA חסום, נסה מדד US בסיסי (יחס זהה, מועיל לחישוב NAV)
const LIVE_TRACKS = [
  { id:"IBIT",   ticker:"IBIT",       label:"Bitcoin ETF (IBIT)", currency:"USD", flag:"₿" },
  { id:"MSTY",   ticker:"MSTY",       label:"MSTY",               currency:"USD", flag:"📈" },
  { id:"SP500",  ticker:"1183441.TA", fallback:"^GSPC",           label:"אקסלנס S&P 500 (1183441)",  currency:"ILS", flag:"🇺🇸" },
  { id:"NASDAQ", ticker:"1159243.TA", fallback:"^IXIC",           label:"אקסלנס נאסד\"ק (1159243)",   currency:"ILS", flag:"💻" },
  { id:"FX",     ticker:"ILS=X",      label:"USD/ILS",            currency:"FX",  flag:"💱" },
];

// מיפוי: id → שדה ב-lastScan (לנתון אחרון ידוע במקרה של חסימה)
const STALE_KEY = {
  IBIT:   d => d?.ibit?.price,
  MSTY:   d => d?.msty?.price,
  SP500:  d => d?.sp500?.price,
  NASDAQ: d => d?.nasdaq?.price,
  FX:     d => d?.fx?.usdIls,
};

/** מנסה Yahoo Finance ישירות; אם נחסם — proxy → fallback ticker
 *  V2.5.1: regularMarketPrice → postMarketPrice → preMarketPrice
 */
async function fetchYahooPrice(ticker, fallbackTicker = null) {
  const yf = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`;
  const endpoints = [
    yf,
    `https://corsproxy.io/?${encodeURIComponent(yf)}`,
    `https://api.allorigins.win/get?url=${encodeURIComponent(yf)}`,
  ];
  for (const url of endpoints) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, { cache: "no-store", signal: controller.signal });
      clearTimeout(tid);
      if (!res.ok) continue;
      let json = await res.json();
      if (typeof json.contents === "string") json = JSON.parse(json.contents);
      const meta = json?.chart?.result?.[0]?.meta;
      // V2.5.1: שוק פתוח → regularMarketPrice, שוק סגור → postMarketPrice, טרום-מסחר → preMarketPrice
      const raw = meta?.regularMarketPrice ?? meta?.postMarketPrice ?? meta?.preMarketPrice;
      if (raw != null) {
        return { price: parseFloat(raw.toFixed(4)), source: "Yahoo Finance", currency: meta.currency || "USD" };
      }
    } catch { /* try next */ }
  }
  // fallback: נסה ticker חלופי (למשל ^GSPC במקום 1183441.TA)
  if (fallbackTicker && fallbackTicker !== ticker) {
    const res = await fetchYahooPrice(fallbackTicker, null);
    if (res.price != null) return { ...res, isFallback: true };
  }
  return { price: null, source: "חסום" };
}

/** V2.6.1 · Hook: Firestore-First Live Market
 *  עדיפות #1: market_data/latest (real-time subscribe — הסקנר כותב 08:00 כל בוקר)
 *  עדיפות #2: Yahoo ישירות מהדפדפן (CORS-proxied; חסום ברוב המקרים, אבל נשאר כניסיון)
 *  למה? Yahoo Finance חוסם CORS אגרסיבית מהדפדפן ולכן fetchYahooPrice נכשל לעיתים קרובות.
 *  הסקנר רץ ב-Node ב-Cowork (אין CORS) ויש לו תמיד גישה — אז אנחנו מסתמכים עליו כמקור אמת.
 */
function useLiveMarket() {
  const [prices, setPrices]       = useState({});
  const [fetchedAt, setFetchedAt] = useState(null);
  const [fetching, setFetching]   = useState(false);
  const [source, setSource]       = useState("idle"); // 'firestore' | 'yahoo' | 'mixed' | 'idle'

  // ── מיפוי מ-market_data/latest ל-mapping של LIVE_TRACKS ──
  const fromFirestore = useCallback((md) => {
    if (!md) return null;
    const fxRate = md.fx?.usdIls;
    return {
      MSTY:   md.msty?.price   != null ? { price: md.msty.price,   currency: "USD", label: "MSTY",                    flag: "📈", ticker: "MSTY",       source: md.msty.priceSource   || "Firestore (scanner)" } : null,
      MSTR:   md.mstr?.price   != null ? { price: md.mstr.price,   currency: "USD", label: "MSTR",                    flag: "🟧", ticker: "MSTR",       source: md.mstr.priceSource   || "Firestore (scanner)" } : null,
      IBIT:   md.ibit?.price   != null ? { price: md.ibit.price,   currency: "USD", label: "Bitcoin ETF (IBIT)",      flag: "₿",  ticker: "IBIT",       source: md.ibit.priceSource   || "Firestore (scanner)" } : null,
      SP500:  md.sp500?.price  != null ? { price: md.sp500.price,  currency: "ILS", label: "אקסלנס S&P 500 (1183441)", flag: "🇺🇸", ticker: "1183441.TA", source: md.sp500.priceSource  || "Firestore (scanner)" } : null,
      NASDAQ: md.nasdaq?.price != null ? { price: md.nasdaq.price, currency: "ILS", label: "אקסלנס נאסד\"ק (1159243)", flag: "💻", ticker: "1159243.TA", source: md.nasdaq.priceSource || "Firestore (scanner)" } : null,
      FX:     fxRate           != null ? { price: fxRate,          currency: "FX",  label: "USD/ILS",                 flag: "💱", ticker: "ILS=X",      source: md.fx.source          || "Firestore (scanner)" } : null,
    };
  }, []);

  // ── Real-time subscribe ל-Firestore market_data/latest ──
  useEffect(() => {
    if (!isFirebaseReady()) return;
    const unsub = subscribeToMarketData((md) => {
      const mapped = fromFirestore(md);
      if (!mapped) return;
      // מיזוג: שמור על מחירים שהגיעו מ-Yahoo אם הם טריים יותר
      setPrices(prev => {
        const merged = { ...prev };
        for (const [k, v] of Object.entries(mapped)) {
          if (v && (!prev[k]?.price || prev[k]?._stale)) merged[k] = v;
        }
        return merged;
      });
      setFetchedAt(md.timestamp || new Date().toISOString());
      setSource(prev => prev === "yahoo" ? "mixed" : "firestore");
    });
    return () => { try { unsub?.(); } catch {} };
  }, [fromFirestore]);

  // ── Yahoo Finance refresh (best-effort; ייכשל לעיתים קרובות בגלל CORS) ──
  const doFetch = useCallback(async () => {
    if (fetching) return;
    setFetching(true);
    const results = {};
    await Promise.allSettled(
      LIVE_TRACKS.map(async (t) => {
        const { price, source: src, currency, isFallback } = await fetchYahooPrice(t.ticker, t.fallback || null);
        if (price != null) {
          results[t.id] = { price, source: src, currency: currency || t.currency, label: t.label, flag: t.flag, ticker: t.ticker, isFallback: !!isFallback };
        }
      })
    );
    // FX conversion: Israeli papers fallback to USD → multiply by USD/ILS
    const fxRate = results.FX?.price;
    for (const id of ["SP500", "NASDAQ"]) {
      const r = results[id];
      if (r?.isFallback && r.price != null && r.currency !== "ILS" && fxRate) {
        results[id] = { ...r, price: parseFloat((r.price * fxRate).toFixed(2)), currency: "ILS", source: `${r.source} × FX₪` };
      }
    }
    // Yahoo הצליח? מחק את ה-_stale מ-Firestore values, הוסף מה שהתקבל
    if (Object.keys(results).length > 0) {
      setPrices(prev => ({ ...prev, ...results }));
      setFetchedAt(new Date().toISOString());
      setSource(prev => prev === "firestore" ? "mixed" : "yahoo");
    } else {
      // Yahoo נכשל לחלוטין — סמן את ה-Firestore values כ-stale רק אם עברו מעל 4 שעות
      // (הסקנר רץ 08:00, אם השעה אחרי 13:00 הנתון מתחיל להיות ישן)
      console.warn("Yahoo browser fetch failed — relying on Firestore market_data/latest");
    }
    setFetching(false);
  }, [fetching]);

  // ── רענון פעם בכניסה + רענון אוטומטי כל 30 דק' (במקום פעם ב-09:00) ──
  useEffect(() => {
    doFetch();
    const interval = setInterval(doFetch, 30 * 60 * 1000); // 30min
    return () => clearInterval(interval);
  }, []); // eslint-disable-line

  return { prices, fetchedAt, fetching, source, refresh: doFetch };
}

/** LiveMarketBar — רצועת מחירים בזמן אמת בראש הדשבורד
 *  V2.5.1: כשמחיר חי לא זמין, מציג מחיר אחרון ידוע (staleData) עם אייקון 🕐
 */
const LiveMarketBar = ({ prices, fetchedAt, fetching, onRefresh, staleData }) => {
  const timeStr = fetchedAt
    ? new Date(fetchedAt).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })
    : null;

  const tracks = LIVE_TRACKS.map(t => ({ ...t, ...(prices[t.id] || {}) }));

  return (
    <div className="flex items-center gap-2 bg-slate-900/60 border border-slate-700/50 rounded-xl px-3 py-2 mb-4 overflow-x-auto scrollbar-hide flex-wrap">
      <div className="flex items-center gap-1.5 text-[10px] text-slate-400 flex-shrink-0">
        <Activity size={10} className={fetching ? "animate-spin text-cyan-400" : "text-emerald-400"}/>
        <span className="font-semibold">{fetching ? "מעדכן..." : timeStr ? `עודכן ${timeStr}` : "—"}</span>
      </div>
      {tracks.map(t => {
        const livePrice  = t.price;
        const stalePrice = livePrice == null ? (STALE_KEY[t.id]?.(staleData) ?? null) : null;
        const displayPrice = livePrice ?? stalePrice;
        const isStale    = livePrice == null && stalePrice != null;
        const isFallback = livePrice != null && t.isFallback;

        return (
          <div key={t.id} className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 flex-shrink-0 border ${
            isStale    ? "bg-slate-800/30 border-slate-600/30" :
            isFallback ? "bg-slate-800/50 border-amber-700/30" :
                         "bg-slate-800/50 border-slate-700/40"
          }`}>
            <span className="text-[11px]">{t.flag}</span>
            <span className="text-[10px] text-slate-400">{t.label}</span>
            {displayPrice != null ? (
              <span className={`text-[11px] font-mono font-bold ${isStale ? "text-slate-400" : "text-emerald-300"}`}>
                {t.currency === "USD" ? `$${displayPrice}` : `₪${displayPrice}`}
              </span>
            ) : null}
            {isStale && (
              <span className="text-[9px] text-slate-500" title="נתון מהסריקה האחרונה — לא עדכני כרגע">🕐</span>
            )}
            {isFallback && (
              <span className="text-[9px] text-amber-500" title="מדד US (fallback)">~</span>
            )}
            {displayPrice == null && (
              <span className="text-[10px] text-slate-600 italic">N/A</span>
            )}
          </div>
        );
      })}
      <button
        onClick={onRefresh}
        disabled={fetching}
        className="flex items-center gap-1 text-[10px] bg-cyan-900/30 border border-cyan-700/40 text-cyan-300 hover:text-cyan-100 px-2 py-1 rounded-lg transition-colors flex-shrink-0"
        title="רענן מחירים עכשיו"
      >
        <Radio size={9}/> רענן
      </button>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════
//  DOCUMENTS TAB — V2.1.7 · מחסן דוחות רבעוניים
//  PDF upload → זיהוי תאריך + יתרה → עדכון קופה עם source:"pdf_report"
// ══════════════════════════════════════════════════════════════
const DocumentsTab = ({ documents, setDocuments, assets, setAssets, setSaveToast }) => {
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const docFileRef = useRef();

  /** ─── Quarterly Report Scanner ─── */
  const handleDocUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanning(true);
    setScanResult(null);

    try {
      // קריאת קובץ כ-text (PDF plain-text extraction)
      const text = await file.text();
      const fileName = file.name;
      const uploadedAt = new Date().toISOString();

      // ─── חיפוש תאריך דוח ───
      const dateMatch = text.match(/(\d{2})[./](\d{2})[./](20\d{2})/);
      const reportDate = dateMatch
        ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`
        : new Date().toISOString().slice(0, 10);

      // ─── חיפוש יתרה כספית ─── (מחפש דפוסים נפוצים בדוחות ישראלים)
      const balancePatterns = [
        /סה[""]כ\s+צבירה[:\s]+([0-9,]+)/,
        /יתרה\s+(?:לתאריך[:\s]+)?[0-9./]+[:\s]+([0-9,]+)/,
        /Total\s+Balance[:\s]+([0-9,]+)/,
        /([0-9]{3,3},[0-9]{3}(?:\.[0-9]{2})?)/,
      ];
      let balanceStr = null;
      for (const pat of balancePatterns) {
        const m = text.match(pat);
        if (m) { balanceStr = m[1]; break; }
      }
      const balance = balanceStr ? parseFloat(balanceStr.replace(/,/g, "")) : null;

      // ─── זיהוי חברה ─── מתוך שם הקובץ / טקסט
      const COMPANY_MAP = {
        מנורה: "מנורה מבטחים", מבטחים: "מנורה מבטחים",
        מיטב: "מיטב דש", meitav: "מיטב דש",
        כלל: "כלל", menora: "מנורה מבטחים",
        אלטשולר: "אלטשולר שחם", הראל: "הראל",
        אומגה: "אומגה",
      };
      let detectedInstitution = null;
      for (const [kw, name] of Object.entries(COMPANY_MAP)) {
        if (fileName.includes(kw) || text.includes(kw)) { detectedInstitution = name; break; }
      }

      // ─── מציאת קופה תואמת במערכת ───
      const matchedAsset = assets.find(a =>
        detectedInstitution && a.institution === detectedInstitution &&
        balance != null && Math.abs(a.reportBalance - balance) / Math.max(a.reportBalance, 1) < 0.5
      ) || assets.find(a => detectedInstitution && a.institution === detectedInstitution);

      const docEntry = {
        id: `doc_${Date.now()}`,
        fileName,
        uploadedAt,
        reportDate,
        balance,
        institution: detectedInstitution,
        matchedAssetId: matchedAsset?.id || null,
        matchedAssetName: matchedAsset ? `${matchedAsset.owner} · ${matchedAsset.type}` : null,
        status: "pending",
        source: "pdf_report",
      };

      setScanResult(docEntry);
    } catch (err) {
      setScanResult({ error: `שגיאה בסריקה: ${err.message}` });
    } finally {
      setScanning(false);
      e.target.value = "";
    }
  };

  /** מחיל את ממצאי הסריקה — מעדכן קופה ב-assets ושומר doc ───── */
  const applyDocScan = () => {
    if (!scanResult || scanResult.error) return;
    const doc = { ...scanResult, status: "confirmed" };

    // עדכן קופה אם זוהתה + יש יתרה
    if (doc.matchedAssetId && doc.balance != null) {
      setAssets(prev => prev.map(a => a.id !== doc.matchedAssetId ? a : {
        ...a,
        reportBalance: doc.balance,
        reportDate: doc.reportDate,
        checkDate: doc.reportDate,
        source: "pdf_report",
        _reportConfirmed: true,   // V2.1.7: אייקון מסמך בטבלה
      }));
      setSaveToast(`📄 דוח קבלנה! יתרה ${fmt(doc.balance)} הוחלה ל-${doc.matchedAssetName} ✅`);
    } else {
      setSaveToast("📄 דוח נשמר במחסן — לא זוהתה קופה תואמת ב-100%");
    }

    setDocuments(prev => [doc, ...prev]);
    setScanResult(null);
  };

  const deleteDoc = (id) => setDocuments(prev => prev.filter(d => d.id !== id));

  return (
    <div className="space-y-5">
      {/* כותרת */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2"><FileText size={18} className="text-sky-400"/> מחסן דוחות</h2>
          <p className="text-xs text-slate-400 mt-0.5">העלה דוחות PDF רבעוניים — המערכת תזהה יתרה וחברה ותעדכן את הקופה אוטומטית</p>
        </div>
        <button
          onClick={() => docFileRef.current?.click()}
          disabled={scanning}
          className="flex items-center gap-2 bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 text-white text-sm font-semibold px-4 py-2 rounded-xl shadow transition-colors"
        >
          {scanning ? <><Activity size={14} className="animate-spin"/> סורק...</> : <><Upload size={14}/> העלאת דוח PDF</>}
        </button>
        <input ref={docFileRef} type="file" accept=".pdf,.txt" onChange={handleDocUpload} className="hidden"/>
      </div>

      {/* תוצאת סריקה */}
      {scanResult && !scanResult.error && (
        <div className="bg-sky-900/20 border border-sky-600/50 rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-sky-400"/>
            <h3 className="text-sky-100 font-bold text-sm">תוצאת סריקת דוח</h3>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="bg-slate-900/50 rounded-lg p-2">
              <div className="text-slate-400">חברה שזוהתה</div>
              <div className="text-white font-semibold">{scanResult.institution || "לא זוהה"}</div>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-2">
              <div className="text-slate-400">תאריך דוח</div>
              <div className="text-white font-semibold">{fmtDate(scanResult.reportDate)}</div>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-2">
              <div className="text-slate-400">יתרה שזוהתה</div>
              <div className="text-emerald-300 font-bold font-mono">{scanResult.balance != null ? fmt(scanResult.balance) : "לא זוהתה"}</div>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-2">
              <div className="text-slate-400">קופה תואמת</div>
              <div className="text-indigo-300 font-semibold">{scanResult.matchedAssetName || "לא זוהתה — תעדכן ידנית"}</div>
            </div>
          </div>
          {scanResult.matchedAssetId && scanResult.balance != null && (
            <div className="bg-emerald-900/20 border border-emerald-700/40 rounded-lg p-2 text-xs text-emerald-200">
              ✅ זיהוי מוצלח! לחץ "אשר ועדכן" כדי להחיל את היתרה ולסמן את הנתון כ-Confirmed מדוח רשמי.
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button onClick={() => setScanResult(null)} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white text-sm py-2 rounded-lg">בטל</button>
            <button onClick={applyDocScan} className="flex-1 bg-sky-600 hover:bg-sky-500 text-white text-sm font-bold py-2 rounded-lg flex items-center justify-center gap-1.5">
              <CheckCircle2 size={14}/> אשר ועדכן קופה
            </button>
          </div>
        </div>
      )}
      {scanResult?.error && (
        <div className="bg-rose-900/20 border border-rose-700/40 rounded-xl p-3 text-xs text-rose-300">{scanResult.error}</div>
      )}

      {/* רשימת דוחות */}
      {documents.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <FileText size={40} className="mx-auto mb-3 opacity-30"/>
          <p className="text-sm">עדיין לא הועלו דוחות</p>
          <p className="text-xs mt-1">העלה דוח PDF רבעוני מחברת ביטוח ישראלית לניתוח אוטומטי</p>
        </div>
      ) : (
        <div className="space-y-3">
          <h3 className="text-xs text-slate-400 font-semibold uppercase tracking-wider">{documents.length} דוחות שמורים</h3>
          {documents.map(doc => (
            <div key={doc.id} className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 flex items-start gap-3">
              <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-sky-900/40 border border-sky-700/40 flex items-center justify-center">
                <FileText size={16} className="text-sky-300"/>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-sm font-semibold text-slate-100 truncate">{doc.fileName}</span>
                  {doc.status === "confirmed" && (
                    <span className="inline-flex items-center gap-1 text-[10px] bg-emerald-900/40 border border-emerald-700/40 text-emerald-300 px-1.5 py-0.5 rounded">
                      <CheckCircle2 size={9}/> Confirmed
                    </span>
                  )}
                </div>
                <div className="flex gap-3 text-[11px] text-slate-400 flex-wrap">
                  {doc.institution && <span>🏦 {doc.institution}</span>}
                  {doc.reportDate && <span>📅 {fmtDate(doc.reportDate)}</span>}
                  {doc.balance != null && <span className="text-emerald-300 font-mono">💰 {fmt(doc.balance)}</span>}
                  {doc.matchedAssetName && <span className="text-indigo-300">🔗 {doc.matchedAssetName}</span>}
                </div>
              </div>
              <button onClick={() => deleteDoc(doc.id)} className="text-slate-500 hover:text-rose-400 transition-colors flex-shrink-0">
                <Trash2 size={14}/>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════
//  V2.2.0 · EXCELLENCE TAB — Long Term + Trade Journal
//  Long Term: פסיביים (S&P 500, Nasdaq, Bitcoin) · NAV חי + תשואה מצטברת
//  Trade Journal: יומן מסחר אקטיבי עם עריכה inline + שמירה מיידית ב-Firestore
// ══════════════════════════════════════════════════════════════
const EXCELLENCE_LONG_TEMPLATE = [
  { id:"sp500",   label:"S&P 500",   ticker:"SP500",  currency:"ILS", color:"#22c55e", liveKey:"SP500",  note:"תל-אביב 1183441 · הצמדה כפולה למדד/FX" },
  { id:"nasdaq",  label:"Nasdaq",    ticker:"NASDAQ", currency:"ILS", color:"#3b82f6", liveKey:"NASDAQ", note:"תל-אביב 1159243" },
  { id:"bitcoin", label:"Bitcoin",   ticker:"IBIT",   currency:"USD", color:"#f59e0b", liveKey:"IBIT",   note:"iShares Bitcoin Trust ETF" },
];

/** Long-Term allocation (all zero by default — user will provide data later) */
const DEFAULT_EXCELLENCE_LONG = EXCELLENCE_LONG_TEMPLATE.map(t => ({
  id: t.id,
  qty: 0,
  avgEntry: 0,       // average cost per unit
  investedILS: 0,    // total invested amount in ILS
}));

/** Trade Journal — 3 empty rows so user can see the schema at a glance */
const DEFAULT_TRADE_JOURNAL = [
  { id:"tj-1", ticker:"", qty:0, entryPrice:0, exitPrice:0, pnlUSD:0, notes:"", status:"open",  date:"" },
  { id:"tj-2", ticker:"", qty:0, entryPrice:0, exitPrice:0, pnlUSD:0, notes:"", status:"open",  date:"" },
  { id:"tj-3", ticker:"", qty:0, entryPrice:0, exitPrice:0, pnlUSD:0, notes:"", status:"open",  date:"" },
];

const computePnL = (row) => {
  const q = parseFloat(row.qty) || 0;
  const e = parseFloat(row.entryPrice) || 0;
  const x = parseFloat(row.exitPrice) || 0;
  return +((x - e) * q).toFixed(2);
};

// V2.4.0 — ExcellenceLongRow: כרטיס מידע מלא בשקלים, נוסחת תשואה מדויקת
const ExcellenceLongRow = ({ holding, live, fx }) => {
  const def      = EXCELLENCE_LONG_TEMPLATE.find(t => t.id === holding.id) || {};
  const fxRate   = fx || 3.6;
  const priceNow = live?.price ?? null;
  const hasLive  = priceNow != null && holding.qty > 0;

  // ── שווי שוק בשקלים (תמיד ILS) ──
  let marketValueILS = 0;
  if (hasLive) {
    marketValueILS = def.currency === "USD"
      ? priceNow * holding.qty * fxRate
      : priceNow * holding.qty;
  } else {
    marketValueILS = holding.investedILS || 0;
  }

  const invested  = holding.investedILS || 0;
  const pnlILS    = invested > 0 ? marketValueILS - invested : 0;
  // נוסחה מדויקת: (שווי נוכחי / עלות) − 1
  const returnPct = invested > 0 ? ((marketValueILS / invested) - 1) * 100 : 0;

  const pnlColor    = pnlILS > 0 ? "text-emerald-400" : pnlILS < 0 ? "text-rose-400" : "text-slate-400";
  const borderHover = pnlILS > 0 ? "hover:border-emerald-500/60" : pnlILS < 0 ? "hover:border-rose-500/60" : "hover:border-slate-500/40";
  const borderBase  = pnlILS > 0 ? "border-emerald-800/40" : pnlILS < 0 ? "border-rose-800/40" : "border-slate-700/60";

  // תצוגת מחיר שוק
  const currentPriceDisplay = priceNow != null
    ? (def.currency === "USD" ? `$${priceNow}` : `₪${priceNow.toLocaleString("he-IL")}`)
    : "—";
  const buyPriceDisplay = holding.avgEntry > 0
    ? (def.currency === "USD" ? `$${holding.avgEntry}` : `₪${holding.avgEntry}`)
    : "—";

  return (
    <div className={`bg-slate-900/50 border ${borderBase} ${borderHover} rounded-xl p-4 transition-colors`}>
      {/* כותרת */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: def.color }}/>
          <span className="font-bold text-slate-100 text-sm">{def.label}</span>
          <span className="text-[10px] font-mono text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">{def.ticker}</span>
        </div>
        <div className="text-left">
          <div className="text-[11px] font-mono font-bold text-emerald-300">{currentPriceDisplay}</div>
          {def.currency === "USD" && priceNow && (
            <div className="text-[9px] text-slate-500">≈ ₪{(priceNow * fxRate).toLocaleString("he-IL", { maximumFractionDigits: 0 })}</div>
          )}
          {!hasLive && invested > 0 && (
            <div className="text-[9px] text-amber-500">ללא מחיר חי</div>
          )}
        </div>
      </div>

      {/* 4 מדדים */}
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="bg-slate-800/60 rounded-lg p-2.5">
          <div className="text-[10px] text-slate-500 mb-0.5">מחיר קנייה</div>
          <div className="font-mono text-slate-200 font-semibold">{buyPriceDisplay}</div>
        </div>
        <div className="bg-slate-800/60 rounded-lg p-2.5">
          <div className="text-[10px] text-slate-500 mb-0.5">שווי שוק (₪)</div>
          <div className="font-mono text-slate-100 font-bold">{fmt(marketValueILS)}</div>
        </div>
        <div className="bg-slate-800/60 rounded-lg p-2.5">
          <div className="text-[10px] text-slate-500 mb-0.5">רווח / הפסד (₪)</div>
          <div className={`font-mono font-bold ${pnlColor}`}>
            {invested > 0 ? `${pnlILS >= 0 ? "+" : ""}${fmt(pnlILS)}` : "—"}
          </div>
        </div>
        <div className="bg-slate-800/60 rounded-lg p-2.5">
          <div className="text-[10px] text-slate-500 mb-0.5">תשואה %</div>
          <div className={`font-mono font-bold ${pnlColor}`}>
            {invested > 0 ? `${returnPct >= 0 ? "+" : ""}${returnPct.toFixed(2)}%` : "—"}
          </div>
        </div>
      </div>

      {def.note && <p className="text-[9px] text-slate-600 mt-2 leading-tight">{def.note}</p>}
    </div>
  );
};

const TradeJournalRow = ({ row, onChange, onDelete }) => {
  const update = (k, v) => onChange({ ...row, [k]: v, pnlUSD: computePnL({ ...row, [k]: v }) });
  const input = (k, type="text") => (
    <input
      type={type}
      value={row[k] ?? ""}
      onChange={(e) => update(k, type === "number" ? parseFloat(e.target.value) || 0 : e.target.value)}
      className="w-full bg-slate-800/80 border border-slate-700/70 rounded px-2 py-1 text-[11px] font-mono text-slate-100 focus:outline-none focus:border-emerald-500/60"
    />
  );
  return (
    <tr className="border-b border-slate-700/30 hover:bg-slate-800/40 transition-colors">
      <td className="p-1.5 w-20">{input("ticker")}</td>
      <td className="p-1.5 w-16">{input("qty", "number")}</td>
      <td className="p-1.5 w-20">{input("entryPrice", "number")}</td>
      <td className="p-1.5 w-20">{input("exitPrice", "number")}</td>
      <td className="p-1.5 w-24">
        <span className={`inline-block w-full text-center font-mono text-[11px] px-1 py-1 rounded ${
          row.pnlUSD > 0 ? "text-emerald-300 bg-emerald-900/20" :
          row.pnlUSD < 0 ? "text-rose-300 bg-rose-900/20" :
          "text-slate-500 bg-slate-800/40"
        }`}>
          ${row.pnlUSD ?? 0}
        </span>
      </td>
      <td className="p-1.5">{input("notes")}</td>
      <td className="p-1.5 w-10 text-center">
        <button onClick={onDelete} className="text-slate-500 hover:text-rose-400 transition-colors" title="מחק שורה">
          <Trash2 size={12}/>
        </button>
      </td>
    </tr>
  );
};

// V2.4.0 — ExcellenceTab: Total Equity · Doughnut · Line Chart · כרטיסי מידע מלאים
const ExcellenceTab = ({ longTerm, setLongTerm, tradeJournal, setTradeJournal, liveMarket, fx }) => {
  const fxRate = fx || 3.6;

  // ── חישוב ערכים לכל אחזקה ──
  const enriched = longTerm.map(h => {
    const def      = EXCELLENCE_LONG_TEMPLATE.find(t => t.id === h.id) || {};
    const live     = liveMarket[def.liveKey];
    const priceNow = live?.price ?? null;
    let marketValueILS = 0;
    if (priceNow != null && h.qty > 0) {
      marketValueILS = def.currency === "USD"
        ? priceNow * h.qty * fxRate
        : priceNow * h.qty;
    } else {
      marketValueILS = h.investedILS || 0;
    }
    return { ...h, def, live, priceNow, marketValueILS, invested: h.investedILS || 0 };
  });

  const totalInvested = enriched.reduce((s, h) => s + h.invested,        0);
  const totalMarket   = enriched.reduce((s, h) => s + h.marketValueILS,  0);
  const totalPnlILS   = totalMarket - totalInvested;
  const totalReturn   = totalInvested > 0 ? ((totalMarket / totalInvested) - 1) * 100 : 0;

  // ── Doughnut data ──
  const pieData = enriched
    .filter(h => h.marketValueILS > 0)
    .map(h => ({ name: h.def.label, value: Math.round(h.marketValueILS), color: h.def.color }));

  // ── Line chart: 30 נקודות (interpolation מהשקעה → שווי נוכחי) ──
  const lineData = Array.from({ length: 30 }, (_, i) => {
    const t = i / 29;
    const val = Math.round(totalInvested + (totalMarket - totalInvested) * t);
    return {
      day:   i === 0 ? "30d-" : i === 29 ? "היום" : `${29 - i}d-`,
      value: val,
    };
  });

  // ── Trade Journal helpers ──
  const addTradeRow     = () => setTradeJournal(prev => [...prev,
    { id:`tj-${Date.now()}`, ticker:"", qty:0, entryPrice:0, exitPrice:0, pnlUSD:0, notes:"", status:"open", date:today() }]);
  const updateTradeRow  = (id, next) => setTradeJournal(prev => prev.map(r => r.id === id ? next : r));
  const deleteTradeRow  = (id)       => setTradeJournal(prev => prev.filter(r => r.id !== id));
  const updateHolding   = (id, field, value) =>
    setLongTerm(prev => prev.map(h => h.id === id ? { ...h, [field]: parseFloat(value) || 0 } : h));

  const journalTotals = tradeJournal.reduce((acc, r) => {
    acc.count++; acc.pnl += parseFloat(r.pnlUSD) || 0; return acc;
  }, { count: 0, pnl: 0 });

  const pnlColor = totalPnlILS > 0 ? "text-emerald-400" : totalPnlILS < 0 ? "text-rose-400" : "text-slate-400";

  return (
    <div className="space-y-6">

      {/* ══ Total Equity Banner ══════════════════════════════════════════ */}
      <section className="bg-gradient-to-l from-emerald-950/40 to-slate-800/60 border border-emerald-700/30 rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-[11px] text-slate-400 mb-1 flex items-center gap-1.5">
              <Sparkles size={12} className="text-emerald-400"/> Excellence · Long Term · סה"כ הון עצמי
            </div>
            <div className="text-3xl font-black font-mono text-slate-100">{fmt(totalMarket)}</div>
            <div className="flex items-center gap-3 mt-1 text-[12px]">
              <span className="text-slate-400">הושקע: <span className="font-mono text-slate-200">{fmt(totalInvested)}</span></span>
              <span className={`font-mono font-bold ${pnlColor}`}>
                {totalPnlILS >= 0 ? "+" : ""}{fmt(totalPnlILS)} ({totalReturn >= 0 ? "+" : ""}{totalReturn.toFixed(2)}%)
              </span>
            </div>
          </div>
          <div className="flex gap-4 text-[11px] text-slate-400">
            {enriched.map(h => (
              <div key={h.id} className="text-center">
                <div className="w-2 h-2 rounded-full mx-auto mb-1" style={{ background: h.def.color }}/>
                <div className="font-mono text-slate-200 font-semibold">{h.def.label}</div>
                <div className="font-mono text-[10px]">{fmt(h.marketValueILS)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ גרפים ════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Doughnut — התפלגות נכסים */}
        <section className="bg-slate-800/50 border border-slate-700 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Target size={15} className="text-emerald-400"/>
            <h3 className="text-sm font-bold text-slate-100">התפלגות נכסים</h3>
            <span className="text-[10px] text-slate-500">S&amp;P · Nasdaq · Crypto</span>
          </div>
          {pieData.length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width={160} height={160}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={72}
                    dataKey="value" paddingAngle={3}>
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} stroke="rgba(15,23,42,0.6)" strokeWidth={2}/>
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => [`₪${v.toLocaleString("he-IL")}`, ""]}
                    contentStyle={{ background:"#1e293b", border:"1px solid #334155", borderRadius:8, fontSize:11 }}/>
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2 flex-1">
                {pieData.map((d, i) => (
                  <div key={i} className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: d.color }}/>
                      <span className="text-slate-300">{d.name}</span>
                    </div>
                    <div className="font-mono text-slate-200">
                      {totalMarket > 0 ? ((d.value / totalMarket) * 100).toFixed(1) : 0}%
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-36 text-slate-500 text-[12px] italic">
              הזן נתוני אחזקות כדי לראות את ההתפלגות
            </div>
          )}
        </section>

        {/* Line Chart — שווי תיק 30 יום */}
        <section className="bg-slate-800/50 border border-slate-700 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={15} className="text-blue-400"/>
            <h3 className="text-sm font-bold text-slate-100">התקדמות שווי התיק</h3>
            <span className="text-[10px] text-slate-500 bg-amber-900/30 border border-amber-700/40 text-amber-400 px-1.5 py-0.5 rounded">
              משוער — מיום הפעלה
            </span>
          </div>
          {totalInvested > 0 ? (
            <ResponsiveContainer width="100%" height={150}>
              <LineChart data={lineData} margin={{ top:5, right:5, left:0, bottom:5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/>
                <XAxis dataKey="day" tick={{ fontSize:9, fill:"#64748b" }}
                  tickFormatter={(v, i) => (i === 0 || i === 14 || i === 29) ? v : ""} interval={0}/>
                <YAxis tick={{ fontSize:9, fill:"#64748b" }}
                  tickFormatter={v => `₪${(v/1000).toFixed(0)}K`} width={52}/>
                <Tooltip formatter={v => [`₪${v.toLocaleString("he-IL")}`, "שווי"]}
                  contentStyle={{ background:"#1e293b", border:"1px solid #334155", borderRadius:8, fontSize:11 }}/>
                <Line type="monotone" dataKey="value" stroke="#22c55e" strokeWidth={2}
                  dot={false} activeDot={{ r:4, fill:"#22c55e" }}/>
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-36 text-slate-500 text-[12px] italic">
              הזן נתוני אחזקות כדי לראות את גרף ההתקדמות
            </div>
          )}
        </section>
      </div>

      {/* ══ Excellence · Long Term — כרטיסי אחזקות ════════════════════ */}
      <section className="bg-slate-800/50 border border-slate-700 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles size={18} className="text-emerald-400"/>
          <h2 className="text-lg font-bold text-slate-100">Excellence · Long Term</h2>
          <span className="text-[10px] bg-emerald-900/30 border border-emerald-700/40 text-emerald-300 px-2 py-0.5 rounded-full">פסיבי · כל ערכים בשקלים</span>
        </div>

        {/* כרטיסי אחזקות */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          {longTerm.map(h => (
            <ExcellenceLongRow
              key={h.id}
              holding={h}
              live={liveMarket[EXCELLENCE_LONG_TEMPLATE.find(t => t.id === h.id)?.liveKey]}
              fx={fx}
            />
          ))}
        </div>

        {/* עריכה inline */}
        <div className="bg-slate-900/40 border border-slate-700/50 rounded-xl p-3">
          <p className="text-[11px] font-semibold text-slate-300 mb-2">✏️ עריכת אחזקות (נשמר אוטומטית ב-Firestore)</p>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-slate-500 border-b border-slate-700/50">
                <th className="text-right p-1.5 font-medium">נכס</th>
                <th className="text-right p-1.5 font-medium">כמות</th>
                <th className="text-right p-1.5 font-medium">עלות ממוצעת</th>
                <th className="text-right p-1.5 font-medium">סה"כ הושקע (₪)</th>
              </tr>
            </thead>
            <tbody>
              {longTerm.map(h => {
                const def = EXCELLENCE_LONG_TEMPLATE.find(t => t.id === h.id) || {};
                return (
                  <tr key={h.id} className="border-b border-slate-700/20">
                    <td className="p-1.5 text-slate-200 font-semibold">
                      <span className="inline-block w-2 h-2 rounded-full ml-1.5" style={{ background: def.color }}/>
                      {def.label}
                    </td>
                    <td className="p-1.5">
                      <input type="number" value={h.qty ?? 0}
                        onChange={e => updateHolding(h.id, "qty", e.target.value)}
                        className="w-20 bg-slate-800/80 border border-slate-700/70 rounded px-2 py-1 font-mono text-slate-100 focus:outline-none focus:border-emerald-500/60"/>
                    </td>
                    <td className="p-1.5">
                      <input type="number" value={h.avgEntry ?? 0}
                        onChange={e => updateHolding(h.id, "avgEntry", e.target.value)}
                        className="w-24 bg-slate-800/80 border border-slate-700/70 rounded px-2 py-1 font-mono text-slate-100 focus:outline-none focus:border-emerald-500/60"/>
                    </td>
                    <td className="p-1.5">
                      <input type="number" value={h.investedILS ?? 0}
                        onChange={e => updateHolding(h.id, "investedILS", e.target.value)}
                        className="w-28 bg-slate-800/80 border border-slate-700/70 rounded px-2 py-1 font-mono text-slate-100 focus:outline-none focus:border-emerald-500/60"/>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ══ Excellence · Trade Journal ══════════════════════════════════ */}
      <section className="bg-slate-800/50 border border-slate-700 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Activity size={18} className="text-orange-400"/>
            <h2 className="text-lg font-bold text-slate-100">Excellence · Trade Journal</h2>
            <span className="text-[10px] bg-orange-900/30 border border-orange-700/40 text-orange-300 px-2 py-0.5 rounded-full">מסחר אקטיבי · עסקאות סיבוב</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-slate-400">
              עסקאות: <span className="font-mono text-slate-200 font-bold">{journalTotals.count}</span> ·
              סה"כ P/L: <span className={`font-mono font-bold ${journalTotals.pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                ${journalTotals.pnl.toFixed(2)}
              </span>
            </span>
            <button onClick={addTradeRow}
              className="flex items-center gap-1 text-[11px] bg-orange-900/30 hover:bg-orange-800/50 border border-orange-600/50 text-orange-200 px-3 py-1.5 rounded-lg transition-colors">
              <Plus size={12}/> הוסף עסקה
            </button>
          </div>
        </div>
        <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">
          יומן עסקאות סיבוב. כל שינוי נשמר מיידית ב-Firestore · רווח/הפסד מחושב אוטומטית:
          <code className="text-slate-300 mx-1">(שער יציאה − שער כניסה) × כמות</code>
        </p>
        <div className="overflow-x-auto bg-slate-900/40 border border-slate-700/50 rounded-xl">
          <table className="w-full text-[11px]">
            <thead className="bg-slate-900/60">
              <tr className="text-slate-400 border-b border-slate-700/60">
                <th className="text-right p-2 font-semibold">סימול</th>
                <th className="text-right p-2 font-semibold">כמות</th>
                <th className="text-right p-2 font-semibold">שער כניסה</th>
                <th className="text-right p-2 font-semibold">שער יציאה</th>
                <th className="text-right p-2 font-semibold">רווח/הפסד ($)</th>
                <th className="text-right p-2 font-semibold">שיפור / שימור</th>
                <th className="w-10"/>
              </tr>
            </thead>
            <tbody>
              {tradeJournal.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-slate-500 italic">
                    אין עסקאות ביומן · לחץ "הוסף עסקה" להתחלה
                  </td>
                </tr>
              ) : tradeJournal.map(r => (
                <TradeJournalRow key={r.id} row={r}
                  onChange={(next) => updateTradeRow(r.id, next)}
                  onDelete={() => deleteTradeRow(r.id)}/>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════
//  MAIN
// ══════════════════════════════════════════════════════════════
export default function HaMatzpanGemelnet() {
  // ═══ V2.1.5 · State עם טעינת localStorage ═══
  // V2.2.1 — apply ASSET_POLICY on initial load so policy fields (permanentNote) exist from boot
  // V2.5.2 — Zero LocalStorage: assets init מ-SEED ישיר; הנתון האמיתי יגיע מ-subscribeToAssets
  const [assets, setAssets]               = useState(() => applyAssetPolicy(SEED));
  // V2.6.0 — Cloud-synced state (היה localStorage בלבד, גורם הסנכרון השבור)
  const [loans, setLoans]                 = useState(DEFAULT_LOANS);
  const [savings, setSavings]             = useState(DEFAULT_SAVINGS);
  const [mstyDividends, setMstyDividends] = useState(MSTY_DIVIDENDS_SEED);
  const [mstyFX, setMstyFX]               = useState(MSTY_DEFAULTS.currentFX);
  const [mstyPrice, setMstyPrice]         = useState(MSTY_DEFAULTS.currentPrice);
  const [lastScan, setLastScan]           = useState(null);
  const [spotAsset, setSpotAsset]     = useState(null);
  const [uploadResult, setUploadResult] = useState(null);
  const [lastSyncDate, setLastSyncDate] = useState(null);
  const [tab, setTab]                 = useState("dashboard");
  const [familyFilter, setFamilyFilter] = useState("all"); // all|ציון|זיו|הראל|ליאם
  const [scanFindings, setScanFindings] = useState(null);
  const [uploadError, setUploadError]   = useState(null);
  const [uploading, setUploading]       = useState(false);
  const [morningBrief, setMorningBrief] = useState(null); // daily_scan.json shape
  const [saveToast, setSaveToast]       = useState(null);
  const [missedScanBanner, setMissedScanBanner] = useState(false);
  const [documents, setDocuments]       = useState([]);
  // V2.2.0 — Excellence sub-portfolios
  const [excellenceLongTerm, setExcellenceLongTerm] = useState(DEFAULT_EXCELLENCE_LONG);
  const [excellenceTradeJournal, setExcellenceTradeJournal] = useState(DEFAULT_TRADE_JOURNAL);
  // V2.6.0 — Manual save toast
  const [manualSaveStatus, setManualSaveStatus] = useState("idle"); // idle|saving|saved|error
  // V2.1.9 — Cloud Sync status
  const [cloudSyncStatus, setCloudSyncStatus] = useState("idle"); // idle|syncing|synced|local|error
  const [cloudSyncAt, setCloudSyncAt]   = useState(null);
  // (V2.5.0 components removed in V2.5.1)
  const fileRef = useRef();
  const hydratedRef = useRef(false);
  const suppressSaveToastRef = useRef(false);

  // V2.1.9 — Live Market Prices hook (IBIT, MSTY, SP500, Nasdaq, FX)
  const { prices: liveMarket, fetchedAt: marketFetchedAt, fetching: marketFetching, refresh: refreshMarket } = useLiveMarket();

  // V2.1.9 — עדכון אוטומטי של מחיר MSTY + שער USD/ILS מ-LiveMarket (אם אין _manualLock)
  // V2.5.2 — Firestore-Only: עדכון מחיר MSTY + FX ב-state בלבד (ללא lsSave)
  useEffect(() => {
    if (!liveMarket.MSTY?.price) return;
    setMstyPrice(prev => {
      if (Math.abs(liveMarket.MSTY.price - prev) > 0.01) {
        return liveMarket.MSTY.price;
      }
      return prev;
    });
  }, [liveMarket.MSTY?.price]);

  useEffect(() => {
    if (!liveMarket.FX?.price) return;
    setMstyFX(prev => {
      if (Math.abs(liveMarket.FX.price - prev) > 0.001) {
        return liveMarket.FX.price;
      }
      return prev;
    });
  }, [liveMarket.FX?.price]);

  // ═══ V2.1.9 · Cloud Sync — Firestore עם עדיפות על localStorage ═══
  useEffect(() => {
    setCloudSyncStatus("syncing");
    let unsub;
    try {
      unsub = subscribeToAssets(
        (cloudAssets) => {
          if (cloudAssets && cloudAssets.length > 0) {
            // ענן > localStorage — דרוס רק אם הנתון לא ננעל ידנית כאן
            setAssets(prev => {
              const localLocks = new Set(prev.filter(a => a._manualLock).map(a => a.id));
              const rawMerged = cloudAssets.map(ca => localLocks.has(ca.id)
                ? (prev.find(p => p.id === ca.id) || ca)   // שמור נעילה מקומית
                : ca
              );
              // V2.2.1 — apply code-owned policy overlay on top of Firestore data
              // V2.5.2 — Firestore-Only: אין כתיבה ל-localStorage
              const merged = applyAssetPolicy(rawMerged);
              return merged;
            });
            setCloudSyncStatus("synced");
            setCloudSyncAt(new Date().toISOString());
          } else {
            // V2.4.1 — ענן ריק: זרוע SEED ל-Firestore כדי שיהיה זמין בכל מכשיר
            setCloudSyncStatus("local");
            const currentSeed = applyAssetPolicy(SEED);
            seedAssetsIfEmpty(currentSeed)
              .then(seeded => {
                if (seeded) console.log('✅ SEED assets seeded to Firestore');
              })
              .catch(e => console.warn('seed failed:', e));
          }
        },
        () => setCloudSyncStatus("error")
      );
      initFamily().catch(() => {});
    } catch {
      setCloudSyncStatus("error");
    }
    return () => { try { unsub?.(); } catch {} };
  }, []); // רק ב-mount

  // V2.5.2 — Persistence: הוסרה כתיבת localStorage לחלוטין.
  // • assets ← Firestore via subscribeToAssets (real-time)
  // • Excellence ← Firestore via saveSettings (debounced, 400ms)
  // • mstyPrice / mstyFX ← LiveMarket hook (in-memory only)

  // ═══ V2.6.0 · Firestore real-time sync for ALL family-wide settings ═══
  // (loans, savings, dividends, mstyPrice, mstyFX, documents, excellence)
  // השינוי הזה תיקן את הבאג הקריטי של "שמירה בטלפון לא מגיעה למחשב"
  const settingsHydratedRef = useRef(false);
  const cloudUpdateRef     = useRef(false); // V2.6.0: מסמן שינוי שמגיע מ-onSnapshot כדי לדכא auto-save חוזר
  useEffect(() => {
    const unsub = subscribeToSettings(
      (s) => {
        if (!s) return;
        // העדכון מגיע מ-cloud (לא עריכה ידנית) — דכא את ה-save-toast והאוטו-שמירה
        suppressSaveToastRef.current = true;
        cloudUpdateRef.current = true;
        if (Array.isArray(s.loans))                  setLoans(s.loans);
        if (Array.isArray(s.savings))                setSavings(s.savings);
        if (Array.isArray(s.mstyDividends))          setMstyDividends(s.mstyDividends);
        if (Array.isArray(s.documents))              setDocuments(s.documents);
        if (typeof s.mstyPrice === "number")         setMstyPrice(s.mstyPrice);
        if (typeof s.mstyFX === "number")            setMstyFX(s.mstyFX);
        if (Array.isArray(s.excellenceLongTerm))     setExcellenceLongTerm(s.excellenceLongTerm);
        if (Array.isArray(s.excellenceTradeJournal)) setExcellenceTradeJournal(s.excellenceTradeJournal);
        settingsHydratedRef.current = true;
      },
      (err) => console.warn("subscribeToSettings failed:", err)
    );
    // Failsafe: if no settings doc exists at all, mark hydrated after 2s so writes can begin
    const tFallback = setTimeout(() => { settingsHydratedRef.current = true; }, 2000);
    return () => { try { unsub?.(); } catch {} clearTimeout(tFallback); };
  }, []);

  // Debounced auto-save: כל שינוי במצבים האלה נשמר ב-Firestore אחרי 600ms.
  // settingsHydratedRef מבטיח שלא נדרוס נתוני cloud עם defaults לפני שטענו.
  // cloudUpdateRef מונע לולאת echo: שינוי שמגיע מ-onSnapshot לא ייכתב חזרה.
  useEffect(() => {
    if (!settingsHydratedRef.current) return;
    if (cloudUpdateRef.current) {
      cloudUpdateRef.current = false;
      return;
    }
    const t = setTimeout(() => {
      saveSettings({
        loans, savings, mstyDividends, documents,
        mstyPrice, mstyFX,
        excellenceLongTerm, excellenceTradeJournal,
      }).catch(err => console.warn("auto-saveSettings failed:", err));
    }, 600);
    return () => clearTimeout(t);
  }, [loans, savings, mstyDividends, documents, mstyPrice, mstyFX, excellenceLongTerm, excellenceTradeJournal]);

  // ═══ V2.6.1 · Manual "Save All" — עם timeout + error visibility ═══
  // למה timeout? אם Firestore לא מחובר/חסום, await תקוע לנצח. עם timeout 10s
  // המשתמש מקבל פידבק ברור במקום ספינר אינסופי.
  const handleManualSaveAll = useCallback(async () => {
    setManualSaveStatus("saving");
    const SAVE_TIMEOUT_MS = 10000;
    const withTimeout = (promise, label) =>
      Promise.race([
        promise,
        new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout (${label})`)), SAVE_TIMEOUT_MS)),
      ]);

    if (!isFirebaseReady()) {
      setManualSaveStatus("error");
      setSaveToast("❌ Firebase לא מחובר — אין יכולת לשמור ב-cloud");
      setTimeout(() => setManualSaveStatus("idle"), 3500);
      return;
    }

    try {
      // V2.6.1 — דאמפ documents אם הוא גדול מדי (Firestore doc limit = 1MB)
      const docsSize = JSON.stringify(documents || []).length;
      const safeDocs = docsSize > 700000 ? documents.map(d => ({ ...d, _content: undefined })) : documents;

      // 1) Settings doc
      await withTimeout(saveSettings({
        loans, savings, mstyDividends,
        documents: safeDocs,
        mstyPrice, mstyFX,
        excellenceLongTerm, excellenceTradeJournal,
      }), "settings");

      // 2) Assets — saveAsset לכל אחד; allSettled לא מתעלם מכשלים
      const assetResults = await withTimeout(
        Promise.allSettled(assets.map(a => saveAsset(a))),
        "assets"
      );
      const failed = assetResults.filter(r => r.status === "rejected");
      if (failed.length > 0) {
        const firstErr = failed[0].reason?.message || "unknown";
        throw new Error(`${failed.length} נכסים נכשלו: ${firstErr}`);
      }

      const now = new Date();
      const hh  = String(now.getHours()).padStart(2, "0");
      const mm  = String(now.getMinutes()).padStart(2, "0");
      setManualSaveStatus("saved");
      setSaveToast(`💾 נשמר ל-cloud בשעה ${hh}:${mm} (${assets.length} נכסים + הגדרות)`);
      setCloudSyncStatus("synced");
      setCloudSyncAt(now.toISOString());
      setTimeout(() => setManualSaveStatus("idle"), 2500);
    } catch (err) {
      console.error("Manual save failed:", err);
      setManualSaveStatus("error");
      const msg = err?.message || "שגיאה לא ידועה";
      setSaveToast(`❌ שמירה נכשלה: ${msg}`);
      setTimeout(() => setManualSaveStatus("idle"), 5000);
    }
  }, [loans, savings, mstyDividends, documents, mstyPrice, mstyFX, excellenceLongTerm, excellenceTradeJournal, assets]);

  // ═══ V2.2.0 · Zombie asset cleanup (defensive: Firestore leftovers) ═══
  // Purges rows matching ZOMBIE_ASSETS (e.g. Ziv "תגמולים מניות סחיר") — one-shot per session.
  const zombieCleanedRef = useRef(false);
  useEffect(() => {
    if (zombieCleanedRef.current) return;
    if (cloudSyncStatus !== "synced") return;
    const toKill = assets.filter(a =>
      ZOMBIE_ASSETS.some(z => a.owner === z.owner && String(a.type || "").includes(z.typeContains))
    );
    if (toKill.length === 0) { zombieCleanedRef.current = true; return; }
    zombieCleanedRef.current = true;
    (async () => {
      try {
        await Promise.allSettled(toKill.map(a => deleteAsset(a.id)));
        setAssets(prev => prev.filter(a => !toKill.some(k => k.id === a.id)));
        setSaveToast(`🧹 נוקה: ${toKill.map(a => `${a.owner} · ${a.type}`).join(", ")}`);
      } catch (err) {
        console.warn("Zombie cleanup failed:", err);
      }
    })();
  }, [cloudSyncStatus, assets]);

  // ═══ V2.4.1 · Auto-scan banner: אם אחרי 09:00 ולא רצה סריקה היום ═══
  useEffect(() => {
    const now      = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const hour     = now.getHours();
    const ackKey   = `morning_ack_${todayStr}`;
    if (hour < 9 || lsLoad(ackKey, false)) return;
    // Firestore: בדוק אם market_data/latest הוא של היום
    getMarketData()
      .then(data => { if (!data || data.date !== todayStr) setMissedScanBanner(true); })
      .catch(() => {
        // fallback: daily_scan.json
        fetch("/daily_scan.json", { cache: "no-store" })
          .then(r => r.ok ? r.json() : null)
          .then(data => { if (!data || data.date !== todayStr) setMissedScanBanner(true); })
          .catch(() => setMissedScanBanner(true));
      });
  }, []);

  // ═══ V2.1.6 · Save-Toast — מציג הודעה קטנה בכל עריכה ידנית ═══
  useEffect(() => {
    if (!hydratedRef.current) {
      hydratedRef.current = true;
      return; // דילוג על mount ראשוני
    }
    if (suppressSaveToastRef.current) {
      suppressSaveToastRef.current = false;
      return; // דילוג כשהשינוי מגיע מ-applyScanFindings
    }
    setSaveToast("הנתון נשמר בזיכרון המערכת ✅");
  }, [assets, loans, savings, mstyDividends, mstyPrice, mstyFX, excellenceLongTerm, excellenceTradeJournal]);

  // ═══ V2.4.1 · Morning Brief — Firestore subscription (עובד ב-Netlify + נייד) ═══
  // V2.6.1: גם מבצע backfill אוטומטי של recentDividends → mstyDividends
  useEffect(() => {
    const handleData = (data) => {
      if (!data?.date) return;

      // ── V2.6.1 · Backfill: מיזוג כל דיבידנדי אפריל לתוך mstyDividends ──
      const recent = data?.msty?.recentDividends;
      if (Array.isArray(recent) && recent.length > 0) {
        suppressSaveToastRef.current = true;
        setMstyDividends(prev => {
          const existing = new Set((prev || []).map(d => d.date));
          const splitDate = "2025-12-08";
          const additions = recent
            .filter(r => !existing.has(r.exDate))
            .map(r => ({
              date:        r.exDate,
              amount:      r.amount,
              verified:    r.status === "confirmed",
              status:      r.status || "confirmed",
              shareBasis:  new Date(r.exDate) < new Date(splitDate) ? "pre" : "post",
              source:      "scanner_backfill",
              note:        "נוסף אוטומטית מסקנר Firestore (היסטוריית 3 חודשים)",
            }));
          if (additions.length === 0) return prev;
          console.log(`✅ Backfill: נוספו ${additions.length} דיבידנדים מהסקנר`);
          return [...prev, ...additions];
        });
      }

      // הצגת המודל עצמה (לא להציג אם המשתמש כבר אישר היום)
      const ackKey = `morning_ack_${data.date}`;
      if (lsLoad(ackKey, false)) return;
      setMorningBrief(data);
    };

    // Firestore: real-time subscription ל-market_data/latest
    if (isFirebaseReady()) {
      const unsub = subscribeToMarketData(handleData);
      return () => unsub();
    }

    // Fallback: קובץ JSON מקומי (פיתוח local בלבד)
    let aborted = false;
    fetch("/daily_scan.json", { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (!aborted) handleData(data); })
      .catch(() => {});
    return () => { aborted = true; };
  }, []); // eslint-disable-line

  /** ממפה את מבנה daily_scan.json למבנה findings של applyScanFindings */
  const briefToFindings = (b) => ({
    timestamp: b.timestamp || new Date().toISOString(),
    msty: {
      previousPrice: mstyPrice,
      newPrice: b.msty?.price ?? null,
      previousFX: mstyFX,
      newFX: b.fx?.usdIls ?? null,
      newDividend: b.msty?.nextDividend && b.msty.nextDividend.amount != null && b.msty.nextDividend.exDate
        ? {
            date: b.msty.nextDividend.exDate,
            amount: b.msty.nextDividend.amount,
            payDate: b.msty.nextDividend.payDate,
            status: b.msty.nextDividend.status || "estimate",
          }
        : null,
    },
    mstr: b.mstr || {},
    menora: b.pension?.menora168 ? { newYtd: b.pension.menora168.ytd, monthlyReturn: b.pension.menora168.monthlyReturn } : {},
    studyFunds: b.studyFunds || {},
    news: b.news || [],
  });

  const applyMorningBrief = () => {
    if (!morningBrief) return;
    const findings = briefToFindings(morningBrief);
    applyScanFindings(findings);
    lsSave(`morning_ack_${morningBrief.date}`, true);
    setMorningBrief(null);
  };

  const dismissMorningBrief = () => {
    // לא מסמן כ"אושר" — ה-brief יחזור ברענון, אלא אם תלחץ "אשר"
    setMorningBrief(null);
  };

  // ═══ V2.1.7 · Backup Export — ייצוא JSON מלא של כל הנתונים ═══
  const exportBackup = () => {
    const payload = {
      app: "HaMatzpan",
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      data: { assets, loans, savings, mstyDividends, mstyPrice, mstyFX, lastScan },
    };
    try {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `hamatzpan_backup_${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSaveToast("גיבוי JSON יוצא והורד ✅");
    } catch (e) {
      setSaveToast("שגיאה בייצוא הגיבוי");
    }
  };

  // ═══ V2.1.7 · Import Backup — ייבוא JSON גיבוי ושחזור מלא ═══
  const importFileRef = useRef();
  const handleImportBackup = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const payload = JSON.parse(ev.target.result);
        if (!payload?.data) throw new Error("מבנה קובץ שגוי — חסר שדה data");
        const d = payload.data;
        // V2.5.2 — Firestore-Only: state בלבד (ללא lsSave)
        if (d.assets?.length)            { setAssets(d.assets); }
        if (d.loans?.length)             { setLoans(d.loans); }
        if (d.savings?.length)           { setSavings(d.savings); }
        if (d.mstyDividends?.length)     { setMstyDividends(d.mstyDividends); }
        if (d.mstyPrice != null)         { setMstyPrice(d.mstyPrice); }
        if (d.mstyFX != null)            { setMstyFX(d.mstyFX); }
        if (d.lastScan != null)          { setLastScan(d.lastScan); }
        setSaveToast(`✅ גיבוי שוחזר בהצלחה מ-${payload.exportedAt?.slice(0,10) || "קובץ"}`);
      } catch (err) {
        setSaveToast(`❌ שגיאה בייבוא: ${err.message}`);
      } finally {
        e.target.value = "";
      }
    };
    reader.readAsText(file);
  };

  // ═══ Live-Sync — הזרקת ממצאי סריקה ישירות לסטייט ═══
  const applyScanFindings = (findings) => {
    suppressSaveToastRef.current = true; // השינויים באים מסריקה, לא מעריכה ידנית
    const changes = [];
    // 1) מחיר MSTY
    if (findings?.msty?.newPrice != null) {
      const prev = mstyPrice;
      if (Math.abs(findings.msty.newPrice - prev) > 0.001) {
        setMstyPrice(findings.msty.newPrice);
        const delta = findings.msty.newPrice - prev;
        changes.push(`📈 מחיר MSTY עודכן ל-$${findings.msty.newPrice} (היה $${prev} · ${delta >= 0 ? "+" : ""}${delta.toFixed(2)})`);
      }
    }
    // 2) שער USD/ILS
    if (findings?.msty?.newFX != null) {
      const prev = mstyFX;
      if (Math.abs(findings.msty.newFX - prev) > 0.001) {
        setMstyFX(findings.msty.newFX);
        changes.push(`💱 שער USD/ILS עודכן ל-${findings.msty.newFX} (היה ${prev})`);
      }
    }
    // 3) דיבידנד חדש (רק אם עוד לא קיים) — מסומן כ"צפי" אם עתידי
    if (findings?.msty?.newDividend) {
      const nd = findings.msty.newDividend;
      const exists = mstyDividends.some(x => x.date === nd.date);
      if (!exists) {
        const splitDate = "2025-12-08";
        const basis = new Date(nd.date) < new Date(splitDate) ? "pre" : "post";
        const isFuture = new Date(nd.date) > new Date();
        // אם הסריקה סימנה במפורש "confirmed" — נסמוך על זה; אחרת לפי תאריך
        const status = nd.status || (isFuture ? "estimate" : "confirmed");
        setMstyDividends(prev => [
          ...prev,
          {
            date: nd.date, amount: nd.amount,
            verified: status === "confirmed",
            status,
            shareBasis: basis,
            source: "smart_scan",
            note: status === "estimate" ? "צפי — מסריקה אוטומטית (לא ייכלל ב-ROI עד אישור)" : "נוסף אוטומטית מסריקה"
          }
        ]);
        changes.push(status === "estimate"
          ? `🔮 צפי דיבידנד חדש: ${nd.date} @ $${nd.amount}/מניה (לא ייכלל ב-ROI עד שיאושר)`
          : `💰 דיבידנד מאושר חדש: ${nd.date} @ $${nd.amount}/מניה`);
      }
    }
    // 4) עדכון תשואת פנסיה מנורה (נכס id:"1" של ציון) — V2.1.7: מדלג אם _manualLock פעיל
    if (findings?.menora?.newYtd != null) {
      setAssets(prev => prev.map(a => {
        if (a.id !== "1") return a;
        if (a._manualLock) { changes.push(`🔒 פנסיה מנורה ננעלה ידנית — YTD מהסריקה (${findings.menora.newYtd}%) לא הוחל`); return a; }
        return { ...a, latestReturn: findings.menora.newYtd, latestReturnDate: findings.timestamp.slice(0,10) };
      }));
      const wasLocked = (assets.find(a => a.id==="1")?._manualLock);
      if (!wasLocked) changes.push(`📊 תשואת פנסיה מנורה (ציון) עודכנה ל-${findings.menora.newYtd}% YTD`);
    }
    // 5) רישום סריקה אחרונה
    setLastScan({ timestamp: findings.timestamp, count: changes.length });
    return changes;
  };

  const handleResetStorage = () => {
    if (typeof window !== "undefined" && window.confirm("אתה בטוח? כל הנתונים המקומיים יימחקו והאפליקציה תחזור להגדרות ברירת מחדל.")) {
      lsClearAll();
      window.location.reload();
    }
  };

  const totals = useMemo(() => {
    let total = 0, byOwner = {}, byCat = {};
    assets.forEach(a => {
      // עבור MSTY — חשב שווי שוק חי (מחיר × מניות × שער) במקום reportBalance (0)
      let val = a.reportBalance || 0;
      if (a.isMSTY) {
        const shares = a.sharesCount || 0;
        val = shares * (mstyPrice || 0) * (mstyFX || 0);
      }
      total += val;
      byOwner[a.owner] = (byOwner[a.owner] || 0) + val;
      byCat[a.category] = (byCat[a.category] || 0) + val;
    });
    // סה"כ חובות (יתרת הלוואות פתוחות) — ההלוואה נגד הפנסיה של ציון שימשה לקניית MSTY
    const loansBalance = loans.reduce((s, l) => s + (l.currentBalance || 0), 0);
    // שווי נטו = סה"כ נכסים (כולל MSTY בשווי שוק) פחות יתרת הלוואות
    const netWorth = total - loansBalance;
    return { total, byOwner, byCat, loansBalance, netWorth };
  }, [assets, loans, mstyPrice, mstyFX]);

  const handleFileUpload = async (e) => {
    setUploadError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fileType = detectFileType(file.name);
      let parsed;
      if (fileType === "csv") {
        const text = await file.text();
        parsed = parseGemelnet(parseCSVText(text));
      } else if (fileType === "xlsx") {
        const buffer = await file.arrayBuffer();
        parsed = parseGemelnet(parseXLSXBuffer(buffer));
      } else if (fileType === "pdf") {
        setUploadError(`זיהוי PDF: הפרסר המלא רץ בגרסת production (App.jsx) באמצעות pdfjs-dist.
השתמש באפליקציה המותקנת להעלאת דוחות PDF של חברות הביטוח.`);
        setUploading(false);
        e.target.value = "";
        return;
      } else {
        setUploadError(`סוג קובץ לא נתמך: ${file.name}. נתמכים: CSV, XLSX, PDF.`);
        setUploading(false);
        e.target.value = "";
        return;
      }

      if (parsed.error) {
        setUploadError(`שגיאה בעיבוד: לא זוהתה עמודת "מספר קופה" בקובץ. כותרות שזוהו: ${parsed.headers?.slice(0,8).join(" | ")}`);
        setUploading(false);
        e.target.value = "";
        return;
      }
      if (!parsed.rows.length) {
        setUploadError("הקובץ נקרא בהצלחה אבל לא נמצאו נתוני קופה בפורמט המצופה.");
        setUploading(false);
        e.target.value = "";
        return;
      }

      // Build preview
      const map = new Map(parsed.rows.map(r => [r.trackCode, r]));
      const preview = []; let matched = 0;
      const matchedTrackCodes = new Set();
      assets.forEach(a => {
        if (!a.trackCode) return;
        const g = map.get(a.trackCode);
        if (!g) return;
        matched++;
        matchedTrackCodes.add(a.trackCode);
        // בחירת התשואה האפקטיבית לפי זמינות
        const effectiveReturn = g.monthlyReturn ?? g.periodReturn ?? g.ytdReturn ?? 0;
        const ret = (effectiveReturn || 0) / 100;
        const growth = (a.reportBalance || 0) * ret;
        const monthly = (a.employeeDeposit||0) + (a.employerDeposit||0) + (a.severanceDeposit||0);
        preview.push({
          assetId: a.id, trackCode: a.trackCode, owner: a.owner, type: a.type,
          monthlyReturn: g.monthlyReturn, ytdReturn: g.ytdReturn,
          periodReturn: g.periodReturn, period: g.period,
          avg3y: g.avg3y, avg5y: g.avg5y,
          effectiveReturn,
          oldBalance: a.reportBalance, newBalance: (a.reportBalance || 0) + growth + monthly,
        });
      });
      const unmatched = parsed.rows.filter(r => !matchedTrackCodes.has(r.trackCode));
      setUploadResult({
        preview, matched, total: parsed.rows.length,
        rows: parsed.rows, unmatched,
        format: fileType,
        monthlyColumns: parsed.monthlyColumns,
      });
    } catch (err) {
      console.error(err);
      setUploadError(`שגיאת עיבוד: ${err.message}`);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const confirmFirestore = async () => {
    if (!uploadResult) return;
    const { assets: next } = applyGemelnet(assets, uploadResult.rows);
    setAssets(next);
    setLastSyncDate(today());
    // V2.1.9 — כתיבה אמיתית ל-Firestore (saveAsset לכל נכס שהשתנה)
    setCloudSyncStatus("syncing");
    try {
      await Promise.allSettled(next.map(a => saveAsset(a)));
      setCloudSyncStatus("synced");
      setCloudSyncAt(new Date().toISOString());
    } catch (err) {
      console.warn("confirmFirestore: partial Firestore write error:", err);
      setCloudSyncStatus("error");
    }
  };

  // V2.1.9 — Super-Persistence + Firestore Immediate Save
  const handleSpotCheck = (id, balance, date) => {
    const baseAsset = assets.find(a => a.id === id) || {};
    const updated = { ...baseAsset, id, reportBalance: balance, reportDate: date, checkDate: date, source: "manual_truth", _manualLock: true };
    setAssets(prev => prev.map(a => a.id === id ? updated : a));
    setSpotAsset(null);
    setSaveToast("🔒 הנתון ננעל ונשמר בענן ✅");
    // שמירה מיידית ל-Firestore
    saveAsset(updated).then(() => {
      setCloudSyncStatus("synced");
      setCloudSyncAt(new Date().toISOString());
    }).catch(err => {
      console.warn("Firestore save failed, localStorage OK:", err);
    });
  };

  const ownerData = OWNERS.map(o => ({ name:o, value:totals.byOwner[o]||0, color:OWNER_COLOR[o] })).filter(x => x.value > 0);
  const catData = Object.entries(totals.byCat).map(([k,v]) => ({ name:CAT_LABEL[k]||k, value:v, color:CAT_COLOR[k]||"#666" })).filter(x => x.value > 0);
  const showReminder = new Date().getDate() >= 16 && lastSyncDate !== today();

  return (
    <div dir="rtl" className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8" style={{fontFamily:"system-ui, -apple-system, Segoe UI, sans-serif"}}>
      {/* HEADER */}
      <header className="mb-6 flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
              המצפן · HaMatzpan
            </h1>
            <span className="inline-flex items-center gap-1 text-xs md:text-sm font-bold bg-gradient-to-r from-indigo-500 to-purple-600 text-white px-3 py-1 rounded-full shadow-lg shadow-indigo-500/30 border border-indigo-400/40 tracking-wider">
              {APP_VERSION}
            </span>
          </div>
          <p className="text-slate-400 text-sm mt-1">דשבורד ניהול הון משפחתי · גמל-נט · הלוואות · חסכונות</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* V2.6.0 — Manual Save All button (visible feedback for phone↔computer sync) */}
          <button
            onClick={handleManualSaveAll}
            disabled={manualSaveStatus === "saving"}
            title="כתיבה מיידית של כל המצב ל-Firestore (assets + loans + savings + dividends)"
            className={`flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-full border shadow-md transition-all ${
              manualSaveStatus === "saved"   ? "bg-emerald-600 border-emerald-400 text-white shadow-emerald-500/40 scale-105" :
              manualSaveStatus === "saving"  ? "bg-cyan-700 border-cyan-500 text-cyan-100 cursor-wait" :
              manualSaveStatus === "error"   ? "bg-rose-700 border-rose-500 text-white" :
                                               "bg-gradient-to-r from-emerald-600 to-teal-600 border-emerald-400/60 text-white hover:from-emerald-500 hover:to-teal-500 shadow-emerald-500/30"
            }`}
          >
            {manualSaveStatus === "saving" ? <Activity size={13} className="animate-spin"/> :
             manualSaveStatus === "saved"  ? <CheckCircle2 size={13}/> :
             manualSaveStatus === "error"  ? <AlertCircle size={13}/> :
                                             <Save size={13}/>}
            {manualSaveStatus === "saving" ? "שומר..." :
             manualSaveStatus === "saved"  ? "נשמר ✅" :
             manualSaveStatus === "error"  ? "נכשל ❌" :
                                             "💾 שמור הכל"}
          </button>
          <SmartScanButton
            currentPrice={mstyPrice}
            currentFX={mstyFX}
            onApply={applyScanFindings}
            onScanComplete={setScanFindings}
          />
          {lastScan && (
            <span className="flex items-center gap-1.5 text-[10px] bg-slate-800/60 border border-slate-600/40 text-slate-300 px-2 py-1.5 rounded-full" title="סריקה אחרונה">
              <Sparkles size={10} className="text-emerald-400"/>
              {new Date(lastScan.timestamp).toLocaleString("he-IL", { hour:"2-digit", minute:"2-digit", day:"2-digit", month:"2-digit" })}
            </span>
          )}
          {/* V2.1.9 — Cloud Sync Status Badge */}
          <span className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border ${
            cloudSyncStatus === "synced"  ? "bg-emerald-900/30 border-emerald-700/40 text-emerald-300" :
            cloudSyncStatus === "syncing" ? "bg-cyan-900/30 border-cyan-700/40 text-cyan-300" :
            cloudSyncStatus === "error"   ? "bg-rose-900/30 border-rose-700/40 text-rose-300" :
            cloudSyncStatus === "local"   ? "bg-amber-900/30 border-amber-700/40 text-amber-300" :
                                            "bg-slate-800/60 border-slate-600/40 text-slate-400"
          }`} title={cloudSyncAt ? `סנכרון ל-Firestore: ${new Date(cloudSyncAt).toLocaleTimeString("he-IL",{hour:"2-digit",minute:"2-digit"})}` : "Firestore · finnsi-3a75d"}>
            {cloudSyncStatus === "syncing" ? <Activity size={11} className="animate-spin"/> :
             cloudSyncStatus === "synced"  ? <CheckCircle2 size={11}/> :
             cloudSyncStatus === "error"   ? <AlertCircle size={11}/> :
             cloudSyncStatus === "local"   ? <Database size={11}/> :
                                             <Wifi size={11}/>}
            {cloudSyncStatus === "synced"  ? "ענן ✅" :
             cloudSyncStatus === "syncing" ? "מסנכרן..." :
             cloudSyncStatus === "error"   ? "שגיאת ענן" :
             cloudSyncStatus === "local"   ? "מקומי" :
                                             "Firestore"}
          </span>
          <button
            onClick={handleResetStorage}
            className="flex items-center gap-1 text-[10px] bg-slate-800/60 hover:bg-rose-900/50 border border-slate-600/40 hover:border-rose-600/60 text-slate-400 hover:text-rose-200 px-2 py-1.5 rounded-full transition-colors"
            title="איפוס נתונים מקומיים (localStorage)"
          >
            <Database size={10}/> איפוס
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className={`flex items-center gap-1.5 text-sm ${uploading ? "bg-slate-600" : "bg-emerald-600 hover:bg-emerald-500"} text-white px-3 py-1.5 rounded-lg shadow`}>
            {uploading ? <><Activity size={14} className="animate-spin"/> מעבד...</> : <><Upload size={14}/> עדכון נתונים (Excel/PDF)</>}
          </button>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.xlsm,.pdf,.txt" onChange={handleFileUpload} className="hidden"/>
          <a href={GEMELNET_URL} target="_blank" rel="noreferrer"
            className="flex items-center gap-1.5 text-sm bg-slate-700 hover:bg-slate-600 text-slate-100 px-3 py-1.5 rounded-lg">
            <ExternalLink size={14}/> גמל-נט
          </a>
        </div>
      </header>

      {/* ERROR BANNER */}
      {uploadError && (
        <div className="bg-rose-900/30 border border-rose-700/50 rounded-xl p-4 mb-5 flex items-start gap-3">
          <AlertCircle size={20} className="text-rose-400 mt-0.5 flex-shrink-0"/>
          <div className="flex-1">
            <p className="text-rose-200 font-semibold">שגיאה בעיבוד הקובץ</p>
            <p className="text-rose-300/80 text-sm mt-1 whitespace-pre-line">{uploadError}</p>
          </div>
          <button onClick={() => setUploadError(null)} className="text-rose-300 hover:text-white"><X size={18}/></button>
        </div>
      )}

      {/* REMINDER */}
      {showReminder && (
        <div className="bg-amber-900/30 border border-amber-600/50 rounded-xl p-4 mb-5 flex items-start gap-3">
          <Bell size={20} className="text-amber-400 mt-0.5 animate-pulse"/>
          <div className="flex-1">
            <p className="text-amber-200 font-semibold">תזכורת חודשית — גמל-נט</p>
            <p className="text-amber-300/80 text-sm mt-1">ציון, הגיע הזמן לעדכן נתוני גמל-נט.</p>
            <div className="flex gap-2 mt-2">
              <a href={GEMELNET_URL} target="_blank" rel="noreferrer" className="text-xs bg-amber-600 hover:bg-amber-500 text-white px-3 py-1 rounded flex items-center gap-1">
                <Download size={11}/> פתח גמל-נט
              </a>
            </div>
          </div>
        </div>
      )}

      {/* TABS */}
      <div className="flex items-center gap-1 mb-5 border-b border-slate-700 overflow-x-auto">
        {[
          { key:"dashboard",   label:"דשבורד",      icon:<LayoutDashboard size={14}/>, color:"border-indigo-500" },
          { key:"performance", label:"ביצועים",     icon:<TrendingUp size={14}/>,      color:"border-emerald-500" },
          { key:"excellence",  label:"אקסלנס",      icon:<Sparkles size={14}/>,        color:"border-green-500",   badge: (excellenceTradeJournal?.length || null) },
          { key:"msty",        label:"MSTY",        icon:<DollarSign size={14}/>,      color:"border-amber-500",   badge: mstyDividends.length },
          { key:"loans",       label:"הלוואות",     icon:<CreditCard size={14}/>,      color:"border-rose-500",    badge: loans.length },
          { key:"savings",     label:"חסכונות",     icon:<PiggyBank size={14}/>,       color:"border-teal-500",    badge: savings.length },
          { key:"documents",   label:"מחסן דוחות",  icon:<FileText size={14}/>,        color:"border-sky-500",     badge: documents.length || null },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap ${
              tab === t.key ? `bg-slate-800 text-white border-b-2 ${t.color}` : "text-slate-400 hover:text-slate-200"
            }`}>
            {t.icon} {t.label}
            {t.badge != null && t.badge > 0 && (
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                tab === t.key ? "bg-slate-700 text-slate-200" : "bg-slate-800 text-slate-500"
              }`}>{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "dashboard" && (
        <>
          {/* V2.5.1 — Live Market Price Bar (staleData מ-lastScan כ-fallback לחסום) */}
          <LiveMarketBar
            prices={liveMarket}
            fetchedAt={marketFetchedAt}
            fetching={marketFetching}
            onRefresh={refreshMarket}
            staleData={lastScan}
          />

          <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <StatCard
              label="הון נטו (Net Worth)"
              value={fmt(totals.netWorth)}
              color={totals.netWorth >= 0 ? "text-emerald-400" : "text-rose-400"}
              icon={<DollarSign size={16}/>}
              sub={`נכסים ${fmt(totals.total)} − חוב ${fmt(totals.loansBalance)}`}
            />
            <StatCard
              label="סך נכסים (כולל MSTY שוק)"
              value={fmt(totals.total)}
              color="text-sky-300"
              icon={<TrendingUp size={16}/>}
              sub={lastSyncDate ? `סונכרן: ${fmtDate(lastSyncDate)}` : "המתנה לסנכרון"}
            />
            <StatCard
              label="יתרת הלוואות"
              value={fmt(totals.loansBalance)}
              color="text-rose-300"
              icon={<CreditCard size={16}/>}
              sub={`${loans.length} הלוואות · מתוכן ${loans.filter(l=>l.linkedMSTY).length} לרכישת MSTY`}
            />
            <StatCard
              label="חסכונות ילדים"
              value={fmt((totals.byOwner["הראל"]||0) + (totals.byOwner["ליאם"]||0))}
              color="text-pink-300"
              icon={<PiggyBank size={16}/>}
              sub="נפרד לחלוטין מ-MSTY / הלוואות"
            />
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-5">
              <h3 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2"><Users size={14}/> פילוח לפי בעלים</h3>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={ownerData}
                    dataKey="value"
                    nameKey="name"
                    cx="38%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={80}
                    paddingAngle={2}
                    stroke="#0f172a"
                    strokeWidth={2}
                  >
                    {ownerData.map((e,i) => <Cell key={i} fill={e.color}/>)}
                  </Pie>
                  <Tooltip
                    formatter={v => fmt(v)}
                    contentStyle={{background:"#1e293b", border:"1px solid #334155", borderRadius:8}}
                    itemStyle={{color:"#e2e8f0"}}
                  />
                  <Legend
                    layout="vertical"
                    align="right"
                    verticalAlign="middle"
                    iconType="circle"
                    wrapperStyle={{ fontSize:11, color:"#cbd5e1", paddingLeft:12 }}
                    formatter={(value, entry) => (
                      <span style={{color:"#e2e8f0", marginInlineStart:4}}>
                        {value} <span style={{color:"#94a3b8", fontSize:10}}>· {fmt(entry.payload.value)}</span>
                      </span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-5">
              <h3 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2"><LayoutDashboard size={14}/> פילוח לפי סוג</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={catData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155"/>
                  <XAxis dataKey="name" stroke="#94a3b8" fontSize={11}/>
                  <YAxis stroke="#94a3b8" fontSize={11} tickFormatter={v => `₪${(v/1000).toFixed(0)}K`}/>
                  <Tooltip formatter={v => fmt(v)} contentStyle={{background:"#1e293b", border:"1px solid #334155"}}/>
                  <Bar dataKey="value" radius={[6,6,0,0]}>
                    {catData.map((e,i) => <Cell key={i} fill={e.color}/>)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                <TrendingUp size={18} className="text-emerald-400"/>
                {(familyFilter === "all" ? assets : assets.filter(a => a.owner === familyFilter)).length} קופות
              </h2>
              <div className="flex items-center gap-3 text-[11px] text-slate-400">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500"/> עדכני</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500"/> חלקי</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500"/> ישן</span>
              </div>
            </div>

            {/* Family Dashboard · 5 כרטיסים */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-5">
              {[
                { key:"all",   label:"כולם",  color:"#10b981", count:assets.length,                               value: totals.total },
                { key:"ציון",  label:"ציון",  color:OWNER_COLOR["ציון"],  count:assets.filter(a=>a.owner==="ציון").length,  value: totals.byOwner["ציון"] || 0 },
                { key:"זיו",   label:"זיו",   color:OWNER_COLOR["זיו"],   count:assets.filter(a=>a.owner==="זיו").length,   value: totals.byOwner["זיו"]  || 0 },
                { key:"הראל", label:"הראל", color:OWNER_COLOR["הראל"], count:assets.filter(a=>a.owner==="הראל").length, value: totals.byOwner["הראל"]|| 0 },
                { key:"ליאם", label:"ליאם", color:OWNER_COLOR["ליאם"], count:assets.filter(a=>a.owner==="ליאם").length, value: totals.byOwner["ליאם"]|| 0 },
              ].map(card => {
                const active = familyFilter === card.key;
                return (
                  <button
                    key={card.key}
                    onClick={() => setFamilyFilter(card.key)}
                    className={`relative rounded-xl border p-3 text-right transition-all ${
                      active
                        ? "bg-slate-800 shadow-lg scale-[1.02]"
                        : "bg-slate-900/40 border-slate-700 hover:bg-slate-800/60"
                    }`}
                    style={active ? { borderColor: card.color, boxShadow: `0 0 0 2px ${card.color}55` } : {}}
                    title={`סנן ל${card.label}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: card.color }}/>
                      <span className="text-[10px] text-slate-400">{card.count} קופות</span>
                    </div>
                    <div className="text-sm font-bold" style={{ color: active ? card.color : "#e2e8f0" }}>{card.label}</div>
                    <div className="text-[11px] font-mono text-slate-300 mt-0.5">{fmt(card.value)}</div>
                  </button>
                );
              })}
            </div>

            {OWNERS.filter(o => familyFilter === "all" || familyFilter === o).map(owner => {
              const list = assets.filter(a => a.owner === owner);
              if (!list.length) return null;
              const isKid = owner === "הראל" || owner === "ליאם";
              return (
                <div key={owner} className="mb-5">
                  <h3 className="text-sm font-bold mb-2 flex items-center gap-2" style={{color:OWNER_COLOR[owner]}}>
                    <div className="w-2 h-2 rounded-full" style={{background:OWNER_COLOR[owner]}}/>
                    {owner} · {fmt(totals.byOwner[owner] || 0)}
                    {isKid && <span className="text-[10px] font-normal text-slate-400">· כולל תחזית ריבית דריבית</span>}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {list.map(a => (
                      <div key={a.id}>
                        <AssetRow a={a} onSpotCheck={setSpotAsset}/>
                        {isKid && <CompoundProjection asset={a}/>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </section>
        </>
      )}

      {tab === "performance" && <PerformanceTab assets={assets}/>}
      {tab === "excellence"  && <ExcellenceTab
                                  longTerm={excellenceLongTerm}
                                  setLongTerm={setExcellenceLongTerm}
                                  tradeJournal={excellenceTradeJournal}
                                  setTradeJournal={setExcellenceTradeJournal}
                                  liveMarket={liveMarket}
                                  fx={mstyFX}
                                />}
      {tab === "msty"        && <MSTYTab
                                  msty={assets.find(a => a.isMSTY)}
                                  dividends={mstyDividends}
                                  setDividends={setMstyDividends}
                                  fx={mstyFX}
                                  setFx={setMstyFX}
                                  currentPrice={mstyPrice}
                                  setCurrentPrice={setMstyPrice}
                                />}
      {tab === "loans"       && <LoansTab loans={loans} setLoans={setLoans}/>}
      {tab === "savings"     && <SavingsTab savings={savings} setSavings={setSavings}/>}

      {/* V2.1.7 · Documents Tab — מחסן דוחות רבעוניים */}
      {tab === "documents"   && (
        <DocumentsTab
          documents={documents}
          setDocuments={setDocuments}
          assets={assets}
          setAssets={setAssets}
          setSaveToast={setSaveToast}
        />
      )}

      {/* V2.1.7 · Missed Scan Banner — מופיע אם אחרי 09:00 וסריקה לא רצה */}
      {missedScanBanner && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-amber-900/90 border border-amber-600/70 text-amber-100 text-xs font-semibold px-4 py-3 rounded-xl shadow-xl shadow-amber-900/40 backdrop-blur-sm">
          <Bell size={14} className="text-amber-300 animate-pulse flex-shrink-0"/>
          <span>הסריקה היומית טרם רצה היום — לחץ Smart Scan להפעלה ידנית</span>
          <button onClick={() => setMissedScanBanner(false)} className="mr-1 text-amber-300 hover:text-white"><X size={12}/></button>
        </div>
      )}

      <footer className="mt-8 p-4 bg-slate-800/30 border border-slate-700/50 rounded-xl text-xs text-slate-400 leading-relaxed">
        <div className="flex items-start gap-2 mb-3">
          <CheckCircle2 size={14} className="text-emerald-400 flex-shrink-0 mt-0.5"/>
          <div className="flex-1">
            <strong className="text-slate-200">המצפן {APP_VERSION}:</strong> <strong className="text-emerald-300">Phone↔Computer Sync · Manual 💾 Save · Autonomous Morning Scan</strong> · Loans/Savings/Dividends now cloud-synced · Excellence Split · Firestore priority ·
            Golden Sources · ManualLock · מחסן דוחות PDF · <strong className="text-amber-300">סוכן MSTY</strong> · היסטוריה יומית · market_history.
            כל עריכה ידנית נשמרת מיידית ב-Firestore (finnsi-3a75d) · סריקה אוטונומית מתוזמנת ב-09:00 · {new Date().getFullYear()}.
          </div>
        </div>
        <div className="flex items-center justify-between pt-2 border-t border-slate-700/40 gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={exportBackup}
              className="flex items-center gap-1.5 text-[11px] bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 hover:text-white px-3 py-1.5 rounded-lg transition-colors"
              title="הורד קובץ JSON עם כל הנתונים לגיבוי מקומי"
            >
              <Download size={12}/> ייצוא גיבוי (JSON)
            </button>
            {/* V2.1.7 — ייבוא נתונים */}
            <button
              onClick={() => importFileRef.current?.click()}
              className="flex items-center gap-1.5 text-[11px] bg-indigo-900/40 hover:bg-indigo-800/60 border border-indigo-600/50 text-indigo-300 hover:text-indigo-100 px-3 py-1.5 rounded-lg transition-colors"
              title="העלה קובץ גיבוי JSON ושחזר נתונים"
            >
              <Upload size={12}/> ייבוא נתונים
            </button>
            <input ref={importFileRef} type="file" accept=".json" onChange={handleImportBackup} className="hidden"/>
          </div>
          <span className="text-[10px] text-slate-500 text-left">
            מומלץ להוריד גיבוי לפחות פעם בחודש · מונע אובדן נתונים אם הדפדפן יתנקה
          </span>
        </div>
      </footer>

      <SpotCheckModal asset={spotAsset} onClose={() => setSpotAsset(null)} onSave={handleSpotCheck}/>
      <SuccessModal result={uploadResult} onClose={() => setUploadResult(null)} onConfirmFirestore={confirmFirestore}/>

      {/* V2.1.6 · Morning Brief Modal */}
      <MorningBriefModal
        brief={morningBrief}
        onApply={applyMorningBrief}
        onDismiss={dismissMorningBrief}
      />

      {/* V2.1.6 · Save-Toast זעיר */}
      <SaveToast message={saveToast} onDone={() => setSaveToast(null)}/>
    </div>
  );
}