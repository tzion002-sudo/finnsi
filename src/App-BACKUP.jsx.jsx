import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  LineChart, Line, PieChart, Pie, Cell, ResponsiveContainer,
  Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend, AreaChart, Area,
} from 'recharts';
import {
  Upload, RefreshCw, FileText, DollarSign, Users, X, Edit2,
  LayoutDashboard, AlertCircle, Plus, Trash2, Database,
  TrendingUp, TrendingDown, Calendar, Save, CheckCircle, AlertTriangle, Wifi, WifiOff,
} from 'lucide-react';
import { parsePDF } from './lib/pdfParser';
import { isFirebaseReady } from './lib/firebase';
import {
  subscribeToAssets, saveAsset as fsSaveAsset,
  deleteAsset as fsDeleteAsset, saveMonthlyBatch,
  getSettings, saveSettings, initFamily, migrateFromLocalStorage,
} from './lib/firestoreService';

// ══════════════════════════════════════════════════════════════
//  CONSTANTS
// ══════════════════════════════════════════════════════════════
const STORAGE_KEY = 'compass_v2';

const OWNERS    = ['ציון', 'זיו', 'הראל', 'ליאם'];
const CATEGORIES = {
  pension:      'פנסיה',
  study_fund:   'קרן השתלמות',
  dividend:     'תיק דיבידנדים',
  long_term:    'גמל להשקעה (ארוך)',
  medium_term:  'ני"ע (בינוני)',
  children:     'חיסכון ילדים',
  money_market: 'קרן כספית',
};
const CAT_COLOR = {
  pension:     '#6366f1',
  study_fund:  '#a855f7',
  dividend:    '#f59e0b',
  long_term:   '#10b981',
  medium_term: '#3b82f6',
  children:    '#ec4899',
  money_market:'#14b8a6',
};
const OWNER_COLOR = { 'ציון':'#6366f1', 'זיו':'#a855f7', 'הראל':'#ec4899', 'ליאם':'#f59e0b' };

// ── מסלולי השקעה – קודים + מדדי ייחוס ─────────────────────────
// Benchmarks לפי הדוחות השנתיים 2025 ומדדי ייחוס (YTD 2026 משוער):
//   S&P 500 YTD 2026: ~4.2%, Annual 2025 run-rate: ~10.8%
//   ת"א 125 YTD 2026: ~3.8%, Annual 2025: ~9.4%
//   כללי (51% מניות): YTD 2026: ~3.2%, Annual: ~8%
// מספרי המסלולים: מנורה 13887, אלטשולר 11327, מיטב 13245/13246, כלל 15003 (לפי הזנת המשתמש)
export const TRACK_META = {
  13887: { name:'מחקה S&P 500',      institution:'מנורה',        benchmarkYTD:0.042, benchmarkAnnual:0.108, benchmark:'SPX' },
  11327: { name:'סיכון מוגבר',        institution:'אלטשולר שחם',  benchmarkYTD:0.038, benchmarkAnnual:0.094, benchmark:'TA125' },
  13245: { name:'מיטב השתלמות עוקב', institution:'מיטב',         benchmarkYTD:0.042, benchmarkAnnual:0.108, benchmark:'SPX' },
  13246: { name:'מחקה S&P 500 (גמל)', institution:'מיטב',        benchmarkYTD:0.042, benchmarkAnnual:0.108, benchmark:'SPX' },
  15003: { name:'כלל השתלמות כללי',  institution:'כלל',          benchmarkYTD:0.032, benchmarkAnnual:0.085, benchmark:'MIXED' },
  13342: { name:'כלל השתלמות כללי',  institution:'כלל',          benchmarkYTD:0.032, benchmarkAnnual:0.085, benchmark:'MIXED' },
  13343: { name:'כלל גמל לחיסכון',   institution:'כלל',          benchmarkYTD:0.032, benchmarkAnnual:0.085, benchmark:'MIXED' },
  5127790:{ name:'הראל כספית מגמת ריבית', institution:'הראל',     benchmarkYTD:0.015, benchmarkAnnual:0.045, benchmark:'ILS_RATE' },
};
// שער חליפין משוער – YTD 2026
export const FX_YTD_CHANGE = -0.012;

const ISO_TODAY = () => new Date().toISOString().slice(0,10);

// ══════════════════════════════════════════════════════════════
//  INITIAL ASSETS – מעודכן לפי 8 דוחות שנתיים אמיתיים (אפריל 2026)
//  מקור: דוחות מפורטים 2025 של מנורה / מיטב / כלל / אלטשולר
// ══════════════════════════════════════════════════════════════
const INITIAL_ASSETS = [
  // ═════════════════════════════ ציון ═════════════════════════════
  {
    id:'seed_1', owner:'ציון', type:'קרן פנסיה', institution:'מנורה מבטחים',
    accountNumber:'168', category:'pension', trackCode:13887,
    // ✓ Clean Slate 2026-04-17 — נתון אמת ידני (מוסר חישוב Proxy-NAV)
    amount:668562, reportBalance:668562, reportDate: ISO_TODAY(),
    splitEmployee:229468.68, splitEmployer:246001.54, splitSeverance:194250.50,
    employeeDeposit:1748, employerDeposit:1873, severanceDeposit:1498,
    monthlyDeposit:5120,
    feeFromDeposit:1.39, feeFromBalance:0.11,
    feeFromDepositForward:1.75, feeFromBalanceForward:0.05,
    source:'manual_truth', ytdReturnFromGemelnet:null,
    checkDate: ISO_TODAY(), snapshots:[],
  },
  {
    id:'seed_2', owner:'ציון', type:'קרן השתלמות', institution:'מיטב דש',
    accountNumber:'033-233-584678-000', category:'study_fund', trackCode:13245,
    // ✓ Clean Slate 2026-04-17
    amount:235247, reportBalance:235247, reportDate: ISO_TODAY(),
    employeeDeposit:0, employerDeposit:0, severanceDeposit:0, monthlyDeposit:0,
    feeFromDeposit:0, feeFromBalance:0.54,
    investmentTrack:'מיטב השתלמות עוקב S&P 500',
    loanPrincipal:84500, loanBalance:84828.16, loanRate:5.25, loanMaturity:'2030-01-05',
    source:'manual_truth', ytdReturnFromGemelnet:null,
    checkDate: ISO_TODAY(), snapshots:[],
  },
  {
    id:'seed_3', owner:'ציון', type:'קופת גמל (2 חשבונות)', institution:'מיטב דש',
    accountNumber:'032-244-374167 + 032-253-324817', category:'long_term', trackCode:13246,
    // ✓ Clean Slate 2026-04-17
    amount:56151, reportBalance:56151, reportDate: ISO_TODAY(),
    subAccounts:[
      { id:'032-244-374167-000', type:'שכיר',  balance:27300 },
      { id:'032-253-324817-000', type:'עצמאי', balance:28851 },
    ],
    employeeDeposit:0, employerDeposit:0, severanceDeposit:0, monthlyDeposit:0,
    feeFromDeposit:0.04, feeFromBalance:0.53,
    investmentTrack:'מיטב גמל עוקב S&P 500',
    source:'manual_truth', ytdReturnFromGemelnet:null,
    checkDate: ISO_TODAY(), snapshots:[],
  },
  {
    id:'seed_4', owner:'ציון', type:'קרנות השתלמות לא פעילות (2)', institution:'כלל',
    accountNumber:'9971160 + 10231396', category:'study_fund', trackCode:13342,
    amount:11616.41, reportBalance:11616.41, reportDate:'2025-12-31',
    subAccounts:[
      { id:'9971160',  type:'שכיר', balance:9016.06 },
      { id:'10231396', type:'שכיר', balance:2600.36 },
    ],
    employeeDeposit:0, employerDeposit:0, severanceDeposit:0, monthlyDeposit:0,
    feeFromDeposit:0, feeFromBalance:0.68,
    annualReturn:16.77, investmentTrack:'כלל השתלמות כללי',
    checkDate: ISO_TODAY(), snapshots:[],
  },
  // ✨ הראל כספית מגמת ריבית – קרן כספית שקלית (Clean Slate)
  {
    id:'seed_10', owner:'ציון', type:'קרן כספית – מגמת ריבית', institution:'הראל',
    accountNumber:'5127790', category:'money_market', trackCode:5127790,
    amount:85351, reportBalance:85351, reportDate: ISO_TODAY(),
    employeeDeposit:0, employerDeposit:0, severanceDeposit:0, monthlyDeposit:0,
    feeFromDeposit:0, feeFromBalance:0,
    inceptionReturn:2.42,
    investmentTrack:'קרן כספית – מגמת ריבית בנק ישראל',
    source:'manual_truth', ytdReturnFromGemelnet:null,
    checkDate: ISO_TODAY(), snapshots:[],
  },
  // MSTY – ניתן לעדכן ידנית
  {
    id:'seed_5', owner:'ציון', type:'MSTY – תיק דיבידנדים',
    institution:'אקסלנס', amount:0, category:'dividend',
    trackCode:null, reportBalance:0, reportDate: ISO_TODAY(),
    monthlyDeposit:0, isMSTY:true, sharesCount:0,
    checkDate: ISO_TODAY(), snapshots:[],
  },
  // ═════════════════════════════ זיו ═════════════════════════════
  {
    id:'seed_6', owner:'זיו', type:'קרן פנסיה', institution:'מנורה מבטחים',
    accountNumber:'168', category:'pension', trackCode:13887,
    amount:441646.40, reportBalance:441646.40, reportDate:'2025-12-31',
    splitEmployee:149344.57, splitEmployer:160027.20, splitSeverance:132274.62,
    employeeDeposit:1008, employerDeposit:1080, severanceDeposit:864,
    monthlyDeposit:2953, // 35,437.72/12
    feeFromDeposit:1.39, feeFromBalance:0.11,
    feeFromDepositForward:1.75, feeFromBalanceForward:0.05,
    annualReturn:4.25, investmentTrack:'מסלול עוקב מדד S&P 500',
    checkDate: ISO_TODAY(), snapshots:[],
  },
  {
    id:'seed_7', owner:'זיו', type:'קופת גמל לחיסכון', institution:'כלל',
    accountNumber:'9969312', category:'long_term', trackCode:13343,
    amount:40658.46, reportBalance:40658.46, reportDate:'2025-12-31',
    employeeDeposit:0, employerDeposit:0, severanceDeposit:0, monthlyDeposit:0,
    feeFromDeposit:0, feeFromBalance:0.68,
    annualReturn:16.77, investmentTrack:'כלל גמל כללי',
    checkDate: ISO_TODAY(), snapshots:[],
  },
  // ✓ Clean Slate 2026-04-17 — כלל תמר (15003) ₪161,420
  {
    id:'seed_7b', owner:'זיו', type:'קרן השתלמות – תמר', institution:'כלל',
    accountNumber:'9968410', category:'study_fund', trackCode:15003,
    amount:161420, reportBalance:161420, reportDate: ISO_TODAY(),
    splitEmployee:37207.22, splitEmployer:111621.61, splitSeverance:0,
    employeeDeposit:355, employerDeposit:1065, severanceDeposit:0,
    monthlyDeposit:1420,
    feeFromDeposit:0.01, feeFromBalance:0.68,
    investmentTrack:'כלל תמר',
    source:'manual_truth', ytdReturnFromGemelnet:null,
    checkDate: ISO_TODAY(), snapshots:[],
  },
  // ═════════════════════════════ הראל (ילד) ═════════════════════════════
  {
    id:'seed_8', owner:'הראל', type:'חיסכון לכל ילד', institution:'אלטשולר שחם',
    accountNumber:'40096434', category:'children', trackCode:11327,
    amount:14536, reportBalance:14536, reportDate:'2025-12-31',
    employeeDeposit:57, employerDeposit:57, severanceDeposit:0, // 57 ביטוח לאומי + 57 הורה
    monthlyDeposit:114,
    feeFromDeposit:0, feeFromBalance:0.23, investmentExpenses:0.16,
    annualReturn:20.54, investmentTrack:'סיכון מוגבר',
    checkDate: ISO_TODAY(), snapshots:[],
  },
  // ═════════════════════════════ ליאם (ילד) ═════════════════════════════
  {
    id:'seed_9', owner:'ליאם', type:'חיסכון לכל ילד', institution:'אלטשולר שחם',
    accountNumber:'41898339', category:'children', trackCode:11327,
    amount:9719, reportBalance:9719, reportDate:'2025-12-31',
    employeeDeposit:57, employerDeposit:57, severanceDeposit:0,
    monthlyDeposit:114,
    feeFromDeposit:0, feeFromBalance:0.23, investmentExpenses:0.16,
    annualReturn:20.54, investmentTrack:'סיכון מוגבר',
    checkDate: ISO_TODAY(), snapshots:[],
  },
];

// ══════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════
const fmt    = (n) => `₪${Math.round(n).toLocaleString('he-IL')}`;
const fmtPct = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
const fmtPctFrac = (n) => `${n >= 0 ? '+' : ''}${(n*100).toFixed(2)}%`;
const parseDDMM = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getDate()}.${d.getMonth()+1}`;
};
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
// ── Market defaults (מתעדכנים מ-Yahoo Finance כשאפשר) ───────
export const MARKET_DEFAULTS = {
  SPX_OPEN: 5882.40, SPX_NOW: 5882.40 * 1.028,
  TA125_OPEN: 2567.00, TA125_NOW: 2567.00 * 1.041,
  USDILS_OPEN: 3.6480, USDILS_NOW: 3.6480 * 0.992,
  ILS_RATE_ANNUAL: 0.045,
};

/**
 * Proxy-NAV: מחשב את השווי כיום לפי מדד בנצ'מארק × שער מט"ח
 *   SPX     → reportBalance × (SPX_now/SPX_open) × (FX_now/FX_open) + deposits
 *   TA125   → reportBalance × (TA_now/TA_open) + deposits
 *   MIXED   → 60% SPX×FX + 40% ILS_RATE (ריבית חסרת סיכון)
 *   ILS_RATE→ reportBalance × (1 + r*days/365)
 */
const estimateCurrentBalance = (a, market = MARKET_DEFAULTS, refDate = new Date()) => {
  if (!a.trackCode || !a.reportBalance) {
    return { estimated: a.amount || a.reportBalance || 0, isEstimated:false, days:0, growth:0, fxEffect:0, deposits:0, deltaPct:0, rIdx:0, rFx:0 };
  }
  const meta = TRACK_META[a.trackCode];
  if (!meta) return { estimated: a.reportBalance, isEstimated:false, days:0, growth:0, fxEffect:0, deposits:0, deltaPct:0, rIdx:0, rFx:0 };

  const days = daysBetween(a.reportDate, refDate);
  if (days === 0) return { estimated: a.reportBalance, isEstimated:false, days:0, growth:0, fxEffect:0, deposits:0, deltaPct:0, rIdx:0, rFx:0 };

  let indexRatio = 1, fxRatio = 1, rIdx = 0, rFx = 0;
  if (meta.benchmark === 'SPX') {
    rIdx = (market.SPX_NOW / market.SPX_OPEN) - 1;
    rFx  = (market.USDILS_NOW / market.USDILS_OPEN) - 1;
    indexRatio = 1 + rIdx;
    fxRatio    = 1 + rFx;
  } else if (meta.benchmark === 'TA125') {
    rIdx = (market.TA125_NOW / market.TA125_OPEN) - 1;
    indexRatio = 1 + rIdx;
  } else if (meta.benchmark === 'MIXED') {
    const spxComp = (market.SPX_NOW / market.SPX_OPEN) - 1;
    const fxComp  = (market.USDILS_NOW / market.USDILS_OPEN) - 1;
    rIdx = 0.6 * spxComp + 0.4 * (market.ILS_RATE_ANNUAL * days / 365);
    rFx  = 0.3 * fxComp;
    indexRatio = 1 + rIdx;
    fxRatio    = 1 + rFx;
  } else if (meta.benchmark === 'ILS_RATE') {
    rIdx = market.ILS_RATE_ANNUAL * (days / 365);
    indexRatio = 1 + rIdx;
  }

  const afterMarket = a.reportBalance * indexRatio * fxRatio;
  const growth   = afterMarket - a.reportBalance;
  const fxEffect = a.reportBalance * indexRatio * (fxRatio - 1);
  const monthly  = (a.employeeDeposit||0) + (a.employerDeposit||0) + (a.severanceDeposit||0);
  const deposits = monthly * (days / 30);
  const estimated = afterMarket + deposits;

  return {
    estimated, isEstimated:true, days, growth, fxEffect, deposits,
    rIdx, rFx, benchmark: meta.benchmark,
    deltaPct: a.reportBalance ? (estimated - a.reportBalance) / a.reportBalance : 0,
  };
};

/** מושך מחירי שוק חיים מ-Yahoo Finance — נופל ל-defaults אם fetch נכשל */
export async function fetchLiveMarket() {
  try {
    const urls = [
      'https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?interval=1d&range=5d',
      'https://query1.finance.yahoo.com/v8/finance/chart/ILS=X?interval=1d&range=5d',
      'https://query1.finance.yahoo.com/v8/finance/chart/%5ETA125.TA?interval=1d&range=5d',
    ];
    const res = await Promise.all(urls.map(u => fetch(u).then(r => r.json())));
    const price = r => r?.chart?.result?.[0]?.meta?.regularMarketPrice;
    const spx = price(res[0]), fx = price(res[1]), ta = price(res[2]);
    if (spx && fx && ta) {
      return { ...MARKET_DEFAULTS, SPX_NOW: spx, USDILS_NOW: fx, TA125_NOW: ta, _source: 'yahoo_live' };
    }
  } catch (e) {
    console.warn('Live market fetch failed:', e.message);
  }
  return { ...MARKET_DEFAULTS, _source: 'defaults' };
}

/** מחוון רמזור לפי גיל checkDate */
export const confidenceOf = (checkDate, today = new Date()) => {
  const days = daysBetween(checkDate, today);
  if (days <= 30) return { level:'high',   color:'#10b981', label:'עדכני', days };
  if (days <= 90) return { level:'medium', color:'#f59e0b', label:'חלקי',  days };
  return             { level:'low',    color:'#ef4444', label:'ישן',   days };
};

/** מיישם הפקדה חודשית אוטומטית ב-10 לחודש — idempotent */
export const applyScheduledDeposits = (assets, today = new Date()) => {
  const todayYM = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;
  if (today.getDate() < 10) return assets;
  return assets.map(a => {
    const monthly = (a.employeeDeposit||0) + (a.employerDeposit||0) + (a.severanceDeposit||0);
    if (!monthly || a.lastAutoDepositYM === todayYM) return a;
    return {
      ...a,
      reportBalance: (a.reportBalance || 0) + monthly,
      reportDate:    `${todayYM}-10`,
      lastAutoDepositYM: todayYM,
    };
  });
};
const periodReturns = (a) => {
  const meta = TRACK_META[a.trackCode] || { benchmarkAnnual:0.08, benchmarkYTD:0.04 };
  return {
    m1:  meta.benchmarkAnnual / 12,
    m3:  meta.benchmarkAnnual / 4,
    ytd: meta.benchmarkYTD ?? meta.benchmarkAnnual/3,
  };
};
const nowYM  = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; };
const ymLabel = (ym) => {
  const [y,m] = ym.split('-');
  const months = ['ינו','פבר','מרץ','אפר','מאי','יוני','יולי','אוג','ספט','אוק','נוב','דצמ'];
  return `${months[parseInt(m)-1]} ${y}`;
};

// localStorage fallback helpers
const loadLocalAssets = () => {
  try { const s = localStorage.getItem(STORAGE_KEY); if (s) return JSON.parse(s); } catch {}
  return INITIAL_ASSETS;
};
const saveLocalAssets = (assets) => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(assets)); } catch {}
};

// Return calculations
const calcReturn = (asset, ym) => {
  const snaps = asset.snapshots || [];
  const idx   = snaps.findIndex(s => s.ym === ym);
  if (idx < 1) return null;
  const curr = snaps[idx], prev = snaps[idx - 1];
  return curr.balance - prev.balance - (curr.deposit ?? 0);
};
const allReturns = (asset) => {
  const snaps = asset.snapshots || [];
  return snaps.slice(1).map((curr, i) => ({
    ym: curr.ym, label: ymLabel(curr.ym),
    ret: curr.balance - snaps[i].balance - (curr.deposit ?? 0),
    balance: curr.balance,
  }));
};
const ytdReturn   = (asset) => {
  const year = new Date().getFullYear().toString();
  return allReturns(asset).filter(r => r.ym.startsWith(year)).reduce((s,r) => s + r.ret, 0);
};
const totalReturn = (asset) => allReturns(asset).reduce((s,r) => s + r.ret, 0);

// PDF parsing handled by src/lib/pdfParser.js

// ══════════════════════════════════════════════════════════════
//  SUB-COMPONENTS
// ══════════════════════════════════════════════════════════════

// ── Firebase status badge ─────────────────────────────────────
const FirebaseBadge = ({ connected, migrating, onMigrate }) => (
  <div className="flex items-center gap-2">
    {connected ? (
      <span className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-900/30 border border-emerald-700/40 px-2.5 py-1 rounded-full">
        <Wifi size={11}/> Firestore
      </span>
    ) : (
      <div className="flex items-center gap-1.5">
        <span className="flex items-center gap-1.5 text-xs text-amber-400 bg-amber-900/30 border border-amber-700/40 px-2.5 py-1 rounded-full">
          <WifiOff size={11}/> Local
        </span>
        {!connected && (
          <button onClick={onMigrate} disabled={migrating}
            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1">
            <Database size={11}/>
            {migrating ? 'מעביר...' : 'העבר ל-Firebase'}
          </button>
        )}
      </div>
    )}
  </div>
);

// ── Stat Card ─────────────────────────────────────────────────
const StatCard = ({ label, value, color='text-emerald-400', sub, trend, icon }) => (
  <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
    {icon && <div className="mb-2 opacity-60">{icon}</div>}
    <p className="text-slate-400 text-xs mb-1">{label}</p>
    <p className={`text-2xl font-bold ${color}`}>{value}</p>
    {sub   && <p className="text-slate-500 text-xs mt-1">{sub}</p>}
    {trend != null && (
      <p className={`text-xs mt-1 flex items-center gap-1 ${trend >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
        {trend >= 0 ? <TrendingUp size={12}/> : <TrendingDown size={12}/>}
        {fmtPct(trend)} החודש
      </p>
    )}
  </div>
);

// ── Family Wealth Summary (NEW) ───────────────────────────────
const FamilyWealthSummary = ({ assets }) => {
  const total = assets.reduce((s,a) => s + a.amount, 0);

  const byOwner = OWNERS.map(owner => ({
    name:  owner,
    value: assets.filter(a => a.owner === owner).reduce((s,a) => s+a.amount, 0),
    color: OWNER_COLOR[owner],
    pct:   total > 0 ? (assets.filter(a=>a.owner===owner).reduce((s,a)=>s+a.amount,0) / total * 100) : 0,
  }));

  const lastUpdate = assets
    .map(a => a.lastUpdated)
    .filter(Boolean)
    .sort()
    .at(-1);

  return (
    <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-indigo-500/30 rounded-2xl p-6 mb-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-slate-400 text-xs mb-1">הון משפחתי כולל</p>
          <p className="text-4xl font-bold text-white tracking-tight">{fmt(total)}</p>
          {lastUpdate && (
            <p className="text-slate-500 text-xs mt-1">
              עדכון אחרון: {new Date(lastUpdate).toLocaleDateString('he-IL')}
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="text-slate-400 text-xs mb-2">פילוח משפחתי</p>
          <div className="space-y-1.5">
            {byOwner.filter(o => o.value > 0).map(o => (
              <div key={o.name} className="flex items-center gap-2 text-xs justify-end">
                <span className="text-slate-300 font-mono">{fmt(o.value)}</span>
                <span className="text-slate-500">·</span>
                <span className="font-medium" style={{color: o.color}}>{o.name}</span>
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{background: o.color}}/>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Progress bars per owner */}
      <div className="space-y-2 mt-2">
        {byOwner.filter(o => o.value > 0).map(o => (
          <div key={o.name} className="flex items-center gap-3">
            <span className="text-xs text-slate-400 w-8 text-right">{o.name}</span>
            <div className="flex-1 bg-slate-700 rounded-full h-2">
              <div className="h-2 rounded-full transition-all duration-700"
                style={{width: `${o.pct}%`, background: o.color}}/>
            </div>
            <span className="text-xs text-slate-500 w-10 text-left">{o.pct.toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── Edit Modal ────────────────────────────────────────────────
const EditModal = ({ asset, onSave, onDelete, onClose }) => {
  const isNew = !asset.id || asset.id === '';
  const [form, setForm] = useState(asset || {
    owner:'ציון', type:'', institution:'', amount:0,
    category:'pension', monthlyDeposit:0,
    feeFromDeposit:0, feeFromBalance:0, annualReturn:0,
    isMSTY:false, sharesCount:0, investmentTrack:'', snapshots:[],
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    await onSave(form);
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-5">
          <h3 className="font-bold text-lg">{isNew ? 'הוסף קופה חדשה' : 'עריכת קופה'}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-white p-1"><X size={20}/></button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="בן משפחה">
              <select value={form.owner} onChange={e=>set('owner',e.target.value)} className="input-base">
                {OWNERS.map(o=><option key={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="קטגוריה">
              <select value={form.category} onChange={e=>set('category',e.target.value)} className="input-base">
                {Object.entries(CATEGORIES).map(([k,v])=><option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
          </div>

          <Field label="שם הקופה / סוג">
            <input value={form.type} onChange={e=>set('type',e.target.value)}
              className="input-base" placeholder="פנסיה / קרן השתלמות / ..." />
          </Field>
          <Field label="חברה מנהלת">
            <input value={form.institution} onChange={e=>set('institution',e.target.value)}
              className="input-base" placeholder="הראל / מנורה / אלטשולר..." />
          </Field>
          <Field label="מסלול השקעה">
            <input value={form.investmentTrack||''} onChange={e=>set('investmentTrack',e.target.value)}
              className="input-base" placeholder="מחקה S&P 500 / כללי / הלכה..." />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="יתרה נוכחית (₪)">
              <input type="number" value={form.amount} onChange={e=>set('amount',parseFloat(e.target.value)||0)}
                className="input-base" />
            </Field>
            <Field label="הפקדה חודשית (₪)">
              <input type="number" value={form.monthlyDeposit||0} onChange={e=>set('monthlyDeposit',parseFloat(e.target.value)||0)}
                className="input-base" />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="ד.נ. הפקדה (%)">
              <input type="number" step="0.01" value={form.feeFromDeposit||0}
                onChange={e=>set('feeFromDeposit',parseFloat(e.target.value)||0)} className="input-base" />
            </Field>
            <Field label="ד.נ. צבירה (%)">
              <input type="number" step="0.01" value={form.feeFromBalance||0}
                onChange={e=>set('feeFromBalance',parseFloat(e.target.value)||0)} className="input-base" />
            </Field>
            <Field label="תשואה שנתית (%)">
              <input type="number" step="0.1" value={form.annualReturn||0}
                onChange={e=>set('annualReturn',parseFloat(e.target.value)||0)} className="input-base" />
            </Field>
          </div>

          <div className="flex items-center gap-3">
            <input type="checkbox" id="msty" checked={!!form.isMSTY} onChange={e=>set('isMSTY',e.target.checked)}
              className="w-4 h-4 accent-amber-500" />
            <label htmlFor="msty" className="text-sm text-slate-300">קופת MSTY (דיבידנד)</label>
            {form.isMSTY && (
              <Field label="" className="flex-1">
                <input type="number" value={form.sharesCount||0}
                  onChange={e=>set('sharesCount',parseInt(e.target.value)||0)}
                  className="input-base" placeholder="מניות" />
              </Field>
            )}
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={handleSave} disabled={saving}
            className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 transition-colors py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2">
            {saving ? <RefreshCw size={15} className="animate-spin"/> : <Save size={16}/>}
            {saving ? 'שומר...' : 'שמור'}
          </button>
          {!isNew && (
            <button
              onClick={() => { if(window.confirm('למחוק את הקופה הזו?')) onDelete(form.id); }}
              className="bg-red-900/40 hover:bg-red-800/60 border border-red-700/40 transition-colors px-4 py-2.5 rounded-xl text-red-400 text-sm">
              <Trash2 size={16}/>
            </button>
          )}
          <button onClick={onClose}
            className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 transition-colors rounded-xl text-sm">
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Monthly Update Modal ──────────────────────────────────────
const MonthlyUpdateModal = ({ assets, onSave, onClose }) => {
  const ym = nowYM();
  const [balances, setBalances] = useState(() => {
    const init = {};
    assets.filter(a => !a.isMSTY).forEach(a => { init[a.id] = a.amount; });
    return init;
  });
  const [saving, setSaving] = useState(false);

  const calcPreview = (a) => {
    const newBal = parseFloat(balances[a.id]) || 0;
    const snaps  = a.snapshots || [];
    if (snaps.length === 0) return null;
    return newBal - snaps[snaps.length - 1].balance - (a.monthlyDeposit || 0);
  };

  const totalRet = assets.filter(a=>!a.isMSTY).reduce((s,a)=>{
    const r = calcPreview(a); return s + (r ?? 0);
  }, 0);

  const handleSave = async () => {
    setSaving(true);
    await onSave(balances, ym);
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-2">
          <h3 className="font-bold text-lg flex items-center gap-2">
            <Calendar size={20} className="text-indigo-400"/> עדכון חודשי – {ymLabel(ym)}
          </h3>
          <button onClick={onClose} className="text-slate-500 hover:text-white p-1"><X size={20}/></button>
        </div>
        <p className="text-slate-400 text-sm mb-5">
          הכנס <strong>יתרה נוכחית</strong> — התשואה מחושבת אוטומטית ונשמרת ב-{isFirebaseReady() ? 'Firestore ☁️' : 'Local 💾'}
        </p>

        <div className="space-y-3">
          {assets.filter(a => !a.isMSTY).map(a => {
            const ret = calcPreview(a);
            return (
              <div key={a.id} className="bg-slate-700/50 rounded-xl p-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{a.type}</p>
                    <p className="text-xs text-slate-500">{a.institution} · {a.owner}</p>
                  </div>
                  <div className="text-left" style={{direction:'ltr'}}>
                    <div className="flex items-center gap-1">
                      <span className="text-slate-400 text-xs">₪</span>
                      <input type="number" value={balances[a.id] ?? ''}
                        onChange={e => setBalances(b => ({...b, [a.id]: e.target.value}))}
                        className="w-28 bg-slate-900 border border-slate-600 focus:border-indigo-500 rounded-lg px-2 py-1.5 text-sm text-right outline-none"/>
                    </div>
                    {ret !== null && (
                      <p className={`text-xs text-left mt-1 ${ret >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {ret >= 0 ? '+' : ''}{fmt(ret)}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-5 bg-slate-700/30 rounded-xl p-4 flex justify-between items-center">
          <span className="text-slate-300 font-medium">סה"כ תשואה החודש</span>
          <span className={`font-mono font-bold text-xl ${totalRet >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {totalRet >= 0 ? '+' : ''}{fmt(totalRet)}
          </span>
        </div>

        <div className="flex gap-3 mt-4">
          <button onClick={handleSave} disabled={saving}
            className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 transition-colors py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2">
            {saving ? <RefreshCw size={15} className="animate-spin"/> : <Save size={16}/>}
            {saving ? 'שומר בענן...' : 'שמור עדכון'}
          </button>
          <button onClick={onClose}
            className="px-5 py-2.5 bg-slate-700 hover:bg-slate-600 transition-colors rounded-xl text-sm">
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Asset Card ────────────────────────────────────────────────
const AssetCard = ({ asset, onEdit }) => {
  const snaps = asset.snapshots || [];
  const ret = snaps.length < 2 ? null :
    snaps[snaps.length-1].balance - snaps[snaps.length-2].balance - (snaps[snaps.length-1].deposit ?? 0);
  const est = estimateCurrentBalance(asset);
  const displayValue = est.isEstimated ? est.estimated : asset.amount;

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 hover:border-slate-600 transition-all group">
      <div className="flex justify-between items-start">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-1 h-12 rounded-full flex-shrink-0" style={{backgroundColor: CAT_COLOR[asset.category]}}/>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-sm leading-tight truncate">{asset.type}</p>
              {asset.trackCode && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-900/30 border border-indigo-700/40 text-indigo-300 font-mono">
                  #{asset.trackCode}
                </span>
              )}
              {asset.needsData && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-900/30 border border-red-700/40 text-red-300">
                  ממתין לנתונים
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">{asset.institution} · {asset.owner}</p>
            {asset.investmentTrack && (
              <p className="text-xs text-indigo-400/70 mt-0.5 truncate">{asset.investmentTrack}</p>
            )}
            {asset.checkDate && (
              <p className="text-[10px] text-slate-500 mt-0.5">
                📅 נכון לתאריך {parseDDMM(asset.checkDate)}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="text-left">
            <div className="flex items-center gap-1 justify-end">
              <p className="font-mono font-bold text-base">{fmt(displayValue)}</p>
              {est.isEstimated && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-amber-900/40 border border-amber-700/40 text-amber-300 font-bold">
                  משוער
                </span>
              )}
            </div>
            {ret !== null && (
              <p className={`text-xs text-left ${ret >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {ret >= 0 ? '▲' : '▼'} {fmt(Math.abs(ret))}
              </p>
            )}
          </div>
          <button onClick={() => onEdit(asset)}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-500 hover:text-indigo-400 p-1">
            <Edit2 size={15}/>
          </button>
        </div>
      </div>

      {(asset.feeFromDeposit > 0 || asset.feeFromBalance > 0 || asset.annualReturn > 0 || asset.monthlyDeposit > 0) && (
        <div className="mt-2.5 pt-2.5 border-t border-slate-700/60 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {asset.feeFromDeposit > 0 && <span className="text-slate-500">ד.נ. הפקדה: <span className="text-red-400">{asset.feeFromDeposit}%</span></span>}
          {asset.feeFromBalance > 0 && <span className="text-slate-500">ד.נ. צבירה: <span className="text-red-400">{asset.feeFromBalance}%</span></span>}
          {asset.annualReturn   > 0 && <span className="text-slate-500">תשואה: <span className="text-emerald-400">{asset.annualReturn}%</span></span>}
          {asset.monthlyDeposit > 0 && <span className="text-slate-500">הפקדה: <span className="text-indigo-400">{fmt(asset.monthlyDeposit)}/חודש</span></span>}
        </div>
      )}
      {est.isEstimated && (
        <div className="mt-2 pt-2 border-t border-slate-700/60 text-[10px] text-slate-500 flex flex-wrap gap-x-3">
          <span>דוח {fmt(asset.reportBalance)} @ {parseDDMM(asset.reportDate)}</span>
          <span>שיערוך {est.days} ימים</span>
          <span className="text-emerald-400">+{fmt(est.growth)} תשואה</span>
          {est.deposits > 0 && <span className="text-indigo-400">+{fmt(est.deposits)} הפקדות</span>}
        </div>
      )}
      {asset.isMSTY && (
        <div className="mt-2.5 pt-2.5 border-t border-slate-700/60 text-xs text-amber-400">
          🔥 MSTY · {asset.sharesCount} מניות
        </div>
      )}
    </div>
  );
};

// ── Owner Detail Panel – פירוט לבן משפחה ──────────────────────
const OwnerDetailPanel = ({ owner, assets }) => {
  const mine = assets.filter(a => a.owner === owner);
  const total = mine.reduce((s,a) => s + estimateCurrentBalance(a).estimated, 0);
  const totalEmployee = mine.reduce((s,a) => s + (a.employeeDeposit||0), 0);
  const totalEmployer = mine.reduce((s,a) => s + (a.employerDeposit||0), 0);
  const totalSeverance = mine.reduce((s,a) => s + (a.severanceDeposit||0), 0);
  const weightedFee = mine.reduce((s,a) => {
    const w = estimateCurrentBalance(a).estimated;
    return s + (a.feeFromBalance || 0) * w;
  }, 0) / (total || 1);

  return (
    <div className="bg-gradient-to-br from-slate-800 to-slate-900 border rounded-2xl p-5 mb-5"
         style={{borderColor: `${OWNER_COLOR[owner]}50`}}>
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div>
          <p className="text-xs text-slate-400 mb-0.5">פירוט מלא עבור</p>
          <p className="text-2xl font-bold" style={{color: OWNER_COLOR[owner]}}>{owner}</p>
          <div className="flex items-baseline gap-2 mt-1">
            <p className="text-3xl font-bold text-white">{fmt(total)}</p>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/40 border border-amber-700/40 text-amber-300 font-bold">
              משוער
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-slate-900/60 rounded-lg px-3 py-2">
            <p className="text-slate-500 text-[10px]">הפקדת עובד</p>
            <p className="font-mono text-slate-200">{fmt(totalEmployee)}</p>
          </div>
          <div className="bg-slate-900/60 rounded-lg px-3 py-2">
            <p className="text-slate-500 text-[10px]">הפקדת מעסיק</p>
            <p className="font-mono text-slate-200">{fmt(totalEmployer)}</p>
          </div>
          <div className="bg-slate-900/60 rounded-lg px-3 py-2">
            <p className="text-slate-500 text-[10px]">פיצויים</p>
            <p className="font-mono text-slate-200">{fmt(totalSeverance)}</p>
          </div>
          <div className="bg-slate-900/60 rounded-lg px-3 py-2">
            <p className="text-slate-500 text-[10px]">ד"נ משוקלל</p>
            <p className="font-mono text-amber-300">{weightedFee.toFixed(2)}%</p>
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-700 text-slate-400">
              <th className="text-right py-2 px-2 font-medium">קופה</th>
              <th className="text-center py-2 px-2 font-medium">מסלול</th>
              <th className="text-right py-2 px-2 font-medium">יתרה</th>
              <th className="text-center py-2 px-2 font-medium">1ח'</th>
              <th className="text-center py-2 px-2 font-medium">3ח'</th>
              <th className="text-center py-2 px-2 font-medium">YTD</th>
              <th className="text-center py-2 px-2 font-medium">נכון ל-</th>
            </tr>
          </thead>
          <tbody>
            {mine.map(a => {
              const est = estimateCurrentBalance(a);
              const p = periodReturns(a);
              return (
                <tr key={a.id} className="border-b border-slate-700/40 hover:bg-slate-700/20">
                  <td className="py-2 px-2">
                    <div className="font-medium text-slate-200">{a.type}</div>
                    <div className="text-[10px] text-slate-500">{a.institution}</div>
                  </td>
                  <td className="py-2 px-2 text-center font-mono text-indigo-300">{a.trackCode || '—'}</td>
                  <td className="py-2 px-2 text-right font-mono">
                    {fmt(est.estimated)}
                    {est.isEstimated && <span className="mr-1 text-amber-300 text-[9px]">(משוער)</span>}
                  </td>
                  <td className="py-2 px-2 text-center font-mono text-emerald-400">{fmtPctFrac(p.m1)}</td>
                  <td className="py-2 px-2 text-center font-mono text-emerald-400">{fmtPctFrac(p.m3)}</td>
                  <td className="py-2 px-2 text-center font-mono text-emerald-400">{fmtPctFrac(p.ytd)}</td>
                  <td className="py-2 px-2 text-center text-slate-400">{parseDDMM(a.checkDate)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const Field = ({ label, children, className='' }) => (
  <div className={className}>
    {label && <p className="text-xs text-slate-400 mb-1">{label}</p>}
    {children}
  </div>
);

// ══════════════════════════════════════════════════════════════
//  MAIN APP
// ══════════════════════════════════════════════════════════════
export default function App() {
  const [assets, setAssets]               = useState([]);
  const [loading, setLoading]             = useState(true);
  const [activeTab, setActiveTab]         = useState('all');
  const [activeSection, setActiveSection] = useState('dashboard');
  const [mstyDivPerShare, setMstyDivPerShare] = useState(2.5);
  const [editTarget, setEditTarget]       = useState(null);
  const [showMonthly, setShowMonthly]     = useState(false);
  const [showPDFModal, setShowPDFModal]   = useState(false);
  const [isParsing, setIsParsing]         = useState(false);
  const [pdfResult, setPdfResult]         = useState(null);
  const [firebaseOk, setFirebaseOk]       = useState(false);
  const [migrating, setMigrating]         = useState(false);
  const fileInputRef = useRef();

  // ── Init: Firebase or localStorage ──────────────────────────
  useEffect(() => {
    const ready = isFirebaseReady();
    setFirebaseOk(ready);

    if (ready) {
      // Init family doc + real-time listener
      initFamily().catch(console.error);

      const unsub = subscribeToAssets(
        (liveAssets) => {
          setAssets(liveAssets.length > 0 ? liveAssets : INITIAL_ASSETS);
          setLoading(false);
        },
        (err) => {
          console.error('Firestore error, falling back to localStorage:', err);
          setAssets(loadLocalAssets());
          setLoading(false);
        }
      );

      return unsub;   // cleanup on unmount
    } else {
      // localStorage mode
      setAssets(loadLocalAssets());
      setLoading(false);
    }
  }, []);

  // Load settings (mstyDivPerShare)
  useEffect(() => {
    getSettings().then(s => {
      if (s?.mstyDivPerShare) setMstyDivPerShare(s.mstyDivPerShare);
    });
  }, []);

  // Persist to localStorage when not on Firebase
  useEffect(() => {
    if (!firebaseOk && assets.length > 0) saveLocalAssets(assets);
  }, [assets, firebaseOk]);

  // ── Derived values ────────────────────────────────────────
  const filtered       = activeTab === 'all' ? assets : assets.filter(a => a.owner === activeTab);
  const totalAll       = assets.reduce((s,a) => s+a.amount, 0);
  const filteredTot    = filtered.reduce((s,a) => s+a.amount, 0);
  const mstyAsset      = assets.find(a => a.isMSTY);
  const mstyShares     = mstyAsset?.sharesCount ?? 0;
  const mstyGross      = mstyShares * mstyDivPerShare;
  const mstyNet        = mstyGross * 0.75;
  const childTot       = assets.filter(a => a.category==='children').reduce((s,a)=>s+a.amount,0);
  const portfolioMonthlyRet = assets.reduce((s,a) => {
    const r = calcReturn(a, nowYM()); return s + (r ?? 0);
  }, 0);

  const pieData = Object.entries(CATEGORIES).map(([key,name]) => ({
    name, color: CAT_COLOR[key],
    value: assets.filter(a=>a.category===key).reduce((s,a)=>s+a.amount,0),
  })).filter(d=>d.value>0);

  const barData = OWNERS.map(owner => ({
    name: owner,
    value: assets.filter(a=>a.owner===owner).reduce((s,a)=>s+a.amount,0),
    fill: OWNER_COLOR[owner],
  }));

  const allYMs = [...new Set(assets.flatMap(a=>(a.snapshots||[]).map(s=>s.ym)))].sort();
  const historyData = allYMs.map(ym => ({
    label: ymLabel(ym),
    total: assets.reduce((s,a) => {
      const snap = (a.snapshots||[]).find(s=>s.ym===ym);
      return s + (snap ? snap.balance : 0);
    }, 0),
  }));

  // ── CRUD ──────────────────────────────────────────────────
  const saveAsset = async (form) => {
    if (firebaseOk) {
      try {
        const savedId = await fsSaveAsset(form);
        // Firestore listener will update assets automatically
        console.log('Asset saved to Firestore:', savedId);
      } catch (e) {
        console.error('Firestore save failed:', e);
        // Fallback: update local state
        setAssets(prev => form.id
          ? prev.map(a => a.id === form.id ? {...a,...form} : a)
          : [...prev, { ...form, id: String(Date.now()) }]
        );
      }
    } else {
      setAssets(prev => {
        const updated = form.id
          ? prev.map(a => a.id === form.id ? {...a,...form} : a)
          : [...prev, { ...form, id: String(Date.now()), snapshots: [] }];
        return updated;
      });
    }
    setEditTarget(null);
  };

  const deleteAsset = async (id) => {
    if (firebaseOk) {
      try { await fsDeleteAsset(id); }
      catch (e) { console.error('Firestore delete failed:', e); }
    } else {
      setAssets(prev => prev.filter(a => a.id !== id));
    }
    setEditTarget(null);
  };

  // ── Monthly update ────────────────────────────────────────
  const saveMonthlyUpdate = async (balances, ym) => {
    const updates = assets
      .filter(a => !a.isMSTY && balances[a.id] != null)
      .map(a => ({
        assetId: a.id,
        ym,
        balance: parseFloat(balances[a.id]) || a.amount,
        deposit: a.monthlyDeposit || 0,
      }));

    if (firebaseOk) {
      try {
        await saveMonthlyBatch(updates);
        // Firestore listener auto-updates assets
      } catch (e) {
        console.error('Firestore monthly batch failed:', e);
        // localStorage fallback
        _localMonthlyUpdate(balances, ym);
      }
    } else {
      _localMonthlyUpdate(balances, ym);
    }
    setShowMonthly(false);
  };

  const _localMonthlyUpdate = (balances, ym) => {
    setAssets(prev => prev.map(a => {
      if (a.isMSTY || balances[a.id] == null) return a;
      const newBalance = parseFloat(balances[a.id]) || a.amount;
      const snaps = [...(a.snapshots||[])];
      const existIdx = snaps.findIndex(s=>s.ym===ym);
      const snap = { ym, balance: newBalance, deposit: a.monthlyDeposit||0 };
      if (existIdx >= 0) snaps[existIdx] = snap; else snaps.push(snap);
      snaps.sort((x,y)=>x.ym.localeCompare(y.ym));
      // ↓ עדכון checkDate, reportBalance, reportDate – מאפס את השיערוך
      return {
        ...a,
        amount: newBalance,
        reportBalance: newBalance,
        reportDate: ISO_TODAY(),
        checkDate: ISO_TODAY(),
        snapshots: snaps,
      };
    }));
  };

  // ── Migration ─────────────────────────────────────────────
  const handleMigrate = async () => {
    setMigrating(true);
    try {
      const { migrated } = await migrateFromLocalStorage();
      alert(`✅ הועברו ${migrated} קופות ל-Firestore בהצלחה!`);
      setFirebaseOk(true);
    } catch (e) {
      alert('שגיאה בהעברה: ' + e.message);
    }
    setMigrating(false);
  };

  // ── PDF parsing ───────────────────────────────────────────
  const handleFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setIsParsing(true);
    setShowPDFModal(true);
    setPdfResult(null);
    try {
      const result = await parsePDF(file);
      setPdfResult(result);
    } catch(err) {
      setPdfResult({ error: err.message, fileName: file?.name });
    } finally {
      setIsParsing(false);
    }
  }, []);

  const applyPDF = async () => {
    if (!pdfResult?.institution) return;
    const updated = assets.map(a => {
      if (!a.institution?.includes(pdfResult.institution) &&
          !pdfResult.institution?.includes(a.institution?.split(' ')[0])) return a;
      return {
        ...a,
        ...(pdfResult.balance        != null && { amount: pdfResult.balance, reportBalance: pdfResult.balance }),
        ...(pdfResult.reportDate     && { reportDate: pdfResult.reportDate }),
        ...(pdfResult.feeFromDeposit != null && { feeFromDeposit:  pdfResult.feeFromDeposit }),
        ...(pdfResult.feeFromBalance != null && { feeFromBalance:  pdfResult.feeFromBalance }),
        ...(pdfResult.annualReturn   != null && { annualReturn:    pdfResult.annualReturn }),
        checkDate: ISO_TODAY(),
        source: 'pdf',
      };
    });

    if (firebaseOk) {
      // Save each updated asset to Firestore
      for (const a of updated) {
        const orig = assets.find(o => o.id === a.id);
        if (orig && JSON.stringify(orig) !== JSON.stringify(a)) {
          await fsSaveAsset(a).catch(console.error);
        }
      }
    } else {
      setAssets(updated);
    }
    setShowPDFModal(false);
    setPdfResult(null);
  };

  // ── MSTY divPerShare change ───────────────────────────────
  const handleMstyChange = async (val) => {
    setMstyDivPerShare(val);
    await saveSettings({ mstyDivPerShare: val }).catch(console.error);
  };

  // ── Loading screen ────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center" dir="rtl">
        <div className="text-center">
          <div className="bg-indigo-600 w-16 h-16 rounded-2xl flex items-center justify-center font-bold text-2xl mx-auto mb-4">M</div>
          <p className="text-white font-bold text-xl mb-2">המצפן הפיננסי</p>
          <p className="text-slate-400 text-sm mb-4">{firebaseOk ? 'מתחבר ל-Firestore...' : 'טוען נתונים...'}</p>
          <RefreshCw size={24} className="animate-spin text-indigo-400 mx-auto"/>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════
  //  RENDER
  // ════════════════════════════════════════════════════════
  return (
    <div dir="rtl" className="min-h-screen bg-slate-900 text-white" style={{fontFamily:"'Heebo',sans-serif"}}>

      {/* ── TOP NAV ── */}
      <header className="bg-slate-950 border-b border-slate-800 px-6 py-3 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm select-none">M</div>
          <div>
            <h1 className="font-bold text-base leading-none">The <span className="text-indigo-400">Compass</span></h1>
            <p className="text-slate-500 text-xs">המצפן הפיננסי המשפחתי</p>
          </div>
          <FirebaseBadge connected={firebaseOk} migrating={migrating} onMigrate={handleMigrate}/>
        </div>

        <nav className="flex gap-1">
          {[
            { id:'dashboard',   icon:<LayoutDashboard size={15}/>, label:'דאשבורד' },
            { id:'performance', icon:<TrendingUp size={15}/>,      label:'ביצועים' },
            { id:'msty',        icon:<DollarSign size={15}/>,      label:'MSTY' },
            { id:'children',    icon:<Users size={15}/>,           label:'ילדים' },
          ].map(s => (
            <button key={s.id} onClick={() => setActiveSection(s.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                activeSection===s.id ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}>
              {s.icon} {s.label}
            </button>
          ))}
        </nav>

        <div className="flex gap-2">
          <button onClick={() => setShowMonthly(true)}
            className="bg-emerald-700 hover:bg-emerald-600 transition-colors px-3 py-2 rounded-xl flex items-center gap-1.5 text-sm font-medium">
            <Calendar size={15}/> עדכון חודשי
          </button>
          <button onClick={() => fileInputRef.current?.click()}
            className="bg-indigo-600 hover:bg-indigo-500 transition-colors px-3 py-2 rounded-xl flex items-center gap-1.5 text-sm font-medium">
            <Upload size={15}/> העלאת PDF
          </button>
          <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={handleFile}/>
        </div>
      </header>

      {/* ── STATS ROW ── */}
      <div className="px-6 pt-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-6xl mx-auto">
          <StatCard label='סה"כ נכסים' value={fmt(totalAll)} color="text-emerald-400"/>
          <StatCard label="MSTY נטו / חודש" value={fmt(mstyNet)} color="text-amber-400"
            sub={`${mstyShares} מניות × ${fmt(mstyDivPerShare)}`}/>
          <StatCard label="חיסכון ילדים" value={fmt(childTot)} color="text-pink-400"/>
          <StatCard label="תשואה חודש נוכחי" value={fmt(portfolioMonthlyRet)}
            color={portfolioMonthlyRet >= 0 ? 'text-emerald-400' : 'text-red-400'}
            sub={assets.some(a=>(a.snapshots||[]).length>0) ? '' : 'הכנס עדכון חודשי ראשון'}/>
        </div>
      </div>

      {/* ── MAIN CONTENT ── */}
      <main className="px-6 py-5">
        <div className="max-w-6xl mx-auto">

          {/* ════ DASHBOARD ════ */}
          {activeSection === 'dashboard' && (
            <>
              {/* Family Wealth Summary */}
              <FamilyWealthSummary assets={assets} />

              <div className="flex items-center justify-between mb-5">
                <div className="flex gap-2">
                  {['all',...OWNERS].map(tab => (
                    <button key={tab} onClick={() => setActiveTab(tab)}
                      className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-colors ${
                        activeTab===tab ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
                      }`}
                      style={activeTab===tab && tab!=='all' ? {backgroundColor:OWNER_COLOR[tab]} : {}}>
                      {tab==='all'?'הכל':tab}
                    </button>
                  ))}
                </div>
                <button onClick={() => setEditTarget({})}
                  className="flex items-center gap-1.5 text-sm text-indigo-400 hover:text-indigo-300 transition-colors">
                  <Plus size={16}/> הוסף קופה
                </button>
              </div>

              {/* פאנל פירוט למשתמש שנבחר */}
              {activeTab !== 'all' && <OwnerDetailPanel owner={activeTab} assets={assets} />}

              <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
                <div className="lg:col-span-3 space-y-3">
                  {filtered.map(a => <AssetCard key={a.id} asset={a} onEdit={setEditTarget}/>)}
                  {filtered.length===0 && <p className="text-slate-500 text-center py-10">אין נכסים</p>}
                </div>

                <div className="lg:col-span-2 space-y-4">
                  <div className="bg-slate-800 border border-slate-700 rounded-2xl p-4">
                    <p className="text-sm font-semibold text-slate-300 mb-3">פילוח קטגוריה</p>
                    <ResponsiveContainer width="100%" height={190}>
                      <PieChart>
                        <Pie data={pieData} cx="50%" cy="50%" innerRadius={52} outerRadius={82}
                          paddingAngle={3} dataKey="value">
                          {pieData.map((e,i)=><Cell key={i} fill={e.color} strokeWidth={0}/>)}
                        </Pie>
                        <Tooltip formatter={v=>[fmt(v),'']}
                          contentStyle={{background:'#1e293b',border:'1px solid #334155',borderRadius:8,fontSize:12}}/>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="space-y-1.5 mt-1">
                      {pieData.map(d=>(
                        <div key={d.name} className="flex items-center gap-2 text-xs">
                          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{background:d.color}}/>
                          <span className="text-slate-400 flex-1">{d.name}</span>
                          <span className="text-slate-300 font-mono">{fmt(d.value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-slate-800 border border-slate-700 rounded-2xl p-4">
                    <p className="text-sm font-semibold text-slate-300 mb-3">לפי בן משפחה</p>
                    <ResponsiveContainer width="100%" height={150}>
                      <BarChart data={barData} layout="vertical" margin={{left:0,right:8}}>
                        <XAxis type="number" hide/>
                        <YAxis type="category" dataKey="name" tick={{fill:'#94a3b8',fontSize:12}}
                          width={38} axisLine={false} tickLine={false}/>
                        <Tooltip formatter={v=>[fmt(v),'']}
                          contentStyle={{background:'#1e293b',border:'1px solid #334155',borderRadius:8,fontSize:12}}/>
                        <Bar dataKey="value" radius={[0,6,6,0]}>
                          {barData.map((e,i)=><Cell key={i} fill={e.fill}/>)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ════ PERFORMANCE ════ */}
          {activeSection === 'performance' && (
            <div>
              <div className="flex items-center gap-3 mb-6">
                <h2 className="text-2xl font-bold">ביצועים ותשואות</h2>
                {historyData.length === 0 && (
                  <span className="text-xs bg-amber-900/30 border border-amber-700/30 text-amber-400 px-3 py-1 rounded-full">
                    לחץ "עדכון חודשי" כדי להתחיל לעקוב
                  </span>
                )}
              </div>

              {historyData.length > 1 && (
                <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5 mb-5">
                  <p className="text-sm font-semibold text-slate-300 mb-4">שווי תיק לאורך זמן</p>
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={historyData}>
                      <defs>
                        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155"/>
                      <XAxis dataKey="label" tick={{fill:'#94a3b8',fontSize:11}} axisLine={false} tickLine={false}/>
                      <YAxis tick={{fill:'#94a3b8',fontSize:11}} axisLine={false} tickLine={false} tickFormatter={v=>fmt(v)}/>
                      <Tooltip formatter={v=>[fmt(v),'שווי']}
                        contentStyle={{background:'#1e293b',border:'1px solid #334155',borderRadius:8,fontSize:12}}/>
                      <Area type="monotone" dataKey="total" stroke="#6366f1" strokeWidth={2.5}
                        fill="url(#areaGrad)" dot={{fill:'#6366f1',r:4}} activeDot={{r:6}}/>
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}

              <div className="bg-slate-800 border border-slate-700 rounded-2xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700 text-slate-400 text-xs">
                      <th className="text-right py-3 px-4 font-medium">קופה</th>
                      <th className="text-right py-3 px-4 font-medium">יתרה</th>
                      <th className="text-right py-3 px-4 font-medium">תשואה החודש</th>
                      <th className="text-right py-3 px-4 font-medium">מתחילת שנה</th>
                      <th className="text-right py-3 px-4 font-medium">סה"כ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assets.filter(a=>!a.isMSTY).map(a => {
                      const monthly = calcReturn(a, nowYM());
                      const ytd     = ytdReturn(a);
                      const total   = totalReturn(a);
                      const hasData = (a.snapshots||[]).length > 0;
                      return (
                        <tr key={a.id} className="border-b border-slate-700/50 hover:bg-slate-700/20 transition-colors">
                          <td className="py-3 px-4">
                            <p className="font-medium">{a.type}</p>
                            <p className="text-xs text-slate-500">{a.owner} · {a.institution}</p>
                            {a.investmentTrack && <p className="text-xs text-indigo-400/60">{a.investmentTrack}</p>}
                          </td>
                          <td className="py-3 px-4 font-mono">{fmt(a.amount)}</td>
                          <td className={`py-3 px-4 font-mono font-medium ${monthly==null?'text-slate-600':monthly>=0?'text-emerald-400':'text-red-400'}`}>
                            {monthly==null ? '—' : `${monthly>=0?'+':''}${fmt(monthly)}`}
                          </td>
                          <td className={`py-3 px-4 font-mono font-medium ${!hasData?'text-slate-600':ytd>=0?'text-emerald-400':'text-red-400'}`}>
                            {!hasData ? '—' : `${ytd>=0?'+':''}${fmt(ytd)}`}
                          </td>
                          <td className={`py-3 px-4 font-mono font-medium ${!hasData?'text-slate-600':total>=0?'text-emerald-400':'text-red-400'}`}>
                            {!hasData ? '—' : `${total>=0?'+':''}${fmt(total)}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-700/30 font-bold">
                      <td className="py-3 px-4 text-slate-300">סה"כ</td>
                      <td className="py-3 px-4 font-mono">{fmt(totalAll)}</td>
                      <td className={`py-3 px-4 font-mono ${portfolioMonthlyRet>=0?'text-emerald-400':'text-red-400'}`}>
                        {portfolioMonthlyRet!==0 ? `${portfolioMonthlyRet>=0?'+':''}${fmt(portfolioMonthlyRet)}` : '—'}
                      </td>
                      <td className={`py-3 px-4 font-mono ${assets.reduce((s,a)=>s+ytdReturn(a),0)>=0?'text-emerald-400':'text-red-400'}`}>
                        {(()=>{const y=assets.reduce((s,a)=>s+ytdReturn(a),0);return y!==0?`${y>=0?'+':''}${fmt(y)}`:'—';})()}
                      </td>
                      <td className={`py-3 px-4 font-mono ${assets.reduce((s,a)=>s+totalReturn(a),0)>=0?'text-emerald-400':'text-red-400'}`}>
                        {(()=>{const t=assets.reduce((s,a)=>s+totalReturn(a),0);return t!==0?`${t>=0?'+':''}${fmt(t)}`:'—';})()}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* ════ MSTY ════ */}
          {activeSection === 'msty' && (
            <div className="max-w-2xl">
              <h2 className="text-2xl font-bold mb-1">מעקב MSTY</h2>
              <p className="text-slate-400 text-sm mb-6">ניכוי מס רווחי הון 25% אוטומטי</p>
              <div className="grid grid-cols-2 gap-4 mb-5">
                <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
                  <p className="text-slate-400 text-xs mb-2">מספר מניות</p>
                  <input type="number" min="0" value={mstyShares}
                    onChange={e => {
                      const val = parseInt(e.target.value)||0;
                      setAssets(prev=>prev.map(a=>a.isMSTY?{...a,sharesCount:val}:a));
                      if (firebaseOk) {
                        const a = assets.find(x=>x.isMSTY);
                        if (a) fsSaveAsset({...a, sharesCount:val}).catch(console.error);
                      }
                    }}
                    className="text-2xl font-bold bg-transparent text-indigo-400 w-full outline-none"/>
                </div>
                <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
                  <p className="text-slate-400 text-xs mb-2">דיבידנד למניה (₪/חודש)</p>
                  <input type="number" step="0.1" min="0" value={mstyDivPerShare}
                    onChange={e=>handleMstyChange(parseFloat(e.target.value)||0)}
                    className="text-2xl font-bold bg-transparent text-amber-400 w-full outline-none"/>
                </div>
              </div>
              <div className="bg-slate-800 border border-amber-500/30 rounded-2xl p-6 space-y-3">
                <h3 className="font-bold text-amber-400 text-lg mb-3">חישוב הכנסה חודשית</h3>
                {[
                  ['ברוטו', fmt(mstyGross), 'text-white'],
                  ['מס 25%', `− ${fmt(mstyGross*0.25)}`, 'text-red-400'],
                ].map(([l,v,c])=>(
                  <div key={l} className="flex justify-between border-b border-slate-700 py-2.5">
                    <span className="text-slate-300">{l}</span>
                    <span className={`font-mono font-bold ${c}`}>{v}</span>
                  </div>
                ))}
                <div className="flex justify-between items-center bg-slate-700/40 rounded-xl px-4 py-3 mt-1">
                  <span className="font-semibold text-emerald-300">נטו לחודש</span>
                  <span className="font-mono font-bold text-3xl text-emerald-400">{fmt(mstyNet)}</span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-slate-400 text-sm">פרויקציה שנתית</span>
                  <span className="font-mono font-semibold text-indigo-400">{fmt(mstyNet*12)}</span>
                </div>
              </div>
            </div>
          )}

          {/* ════ CHILDREN ════ */}
          {activeSection === 'children' && (
            <div>
              <h2 className="text-2xl font-bold mb-1">חיסכון ילדים</h2>
              <p className="text-slate-400 text-sm mb-6">מעקב חיסכון לכל ילד וקופות גמל להשקעה</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {['הראל','ליאם'].map(child => {
                  const ca = assets.filter(a=>a.owner===child);
                  const ct = ca.reduce((s,a)=>s+a.amount,0);
                  return (
                    <div key={child} className="bg-slate-800 border border-slate-700 rounded-2xl p-6">
                      <div className="flex justify-between items-center mb-4">
                        <h3 className="text-xl font-bold" style={{color:OWNER_COLOR[child]}}>{child}</h3>
                        <span className="text-lg font-bold text-emerald-400">{fmt(ct)}</span>
                      </div>
                      <div className="space-y-2.5">
                        {ca.map(a=>(
                          <div key={a.id} className="flex justify-between items-center bg-slate-700/40 rounded-xl p-3">
                            <div>
                              <p className="font-medium text-sm">{a.type}</p>
                              <p className="text-xs text-slate-500">{a.institution}</p>
                            </div>
                            <div className="text-left">
                              <p className="font-mono font-bold">{fmt(a.amount)}</p>
                              {a.monthlyDeposit>0 && <p className="text-xs text-indigo-400">{fmt(a.monthlyDeposit)}/חודש</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-4 bg-slate-700/20 rounded-xl p-3 text-center">
                        <p className="text-xs text-slate-500">פרויקציה גיל 18 (15 שנים, 6% שנתי)</p>
                        <p className="text-xl font-bold text-emerald-400 mt-1">{fmt(ct*Math.pow(1.06,15))}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      </main>

      {/* ── MODALS ── */}

      {editTarget !== null && (
        <EditModal asset={editTarget} onSave={saveAsset} onDelete={deleteAsset} onClose={() => setEditTarget(null)}/>
      )}

      {showMonthly && (
        <MonthlyUpdateModal assets={assets} onSave={saveMonthlyUpdate} onClose={() => setShowMonthly(false)}/>
      )}

      {/* PDF modal */}
      {showPDFModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-md">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <FileText size={20} className="text-indigo-400"/> ניתוח דוח PDF
              </h3>
              <button onClick={()=>{setShowPDFModal(false);setPdfResult(null);}} className="text-slate-500 hover:text-white p-1"><X size={20}/></button>
            </div>

            {isParsing && (
              <div className="text-center py-10">
                <RefreshCw size={32} className="animate-spin mx-auto text-indigo-400 mb-3"/>
                <p className="text-slate-400">מנתח את הדוח...</p>
                <p className="text-slate-600 text-xs mt-1">pdfjs-dist · מחפש צבירה, דמי ניהול, תשואה</p>
              </div>
            )}

            {!isParsing && pdfResult?.error && (
              <div className="bg-red-900/30 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm flex gap-2">
                <AlertCircle size={16} className="mt-0.5 flex-shrink-0"/>
                {pdfResult.error}
              </div>
            )}

            {!isParsing && pdfResult && !pdfResult.error && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-slate-500 truncate flex-1 ml-2">{pdfResult.fileName}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
                    pdfResult.confidence==='high'   ? 'bg-emerald-900/40 text-emerald-400 border border-emerald-700/40' :
                    pdfResult.confidence==='medium' ? 'bg-amber-900/40 text-amber-400 border border-amber-700/40' :
                                                      'bg-red-900/40 text-red-400 border border-red-700/40'
                  }`}>
                    {pdfResult.confidence==='high' ? '✓ ביטחון גבוה' :
                     pdfResult.confidence==='medium' ? '⚠ ביטחון בינוני' : '✗ ביטחון נמוך'}
                  </span>
                </div>

                <div className="bg-slate-700/50 rounded-xl p-4 space-y-2.5 text-sm">
                  {[
                    ['חברה',         pdfResult.institution,                                          'text-emerald-400 font-bold'],
                    ['סוג דוח',      pdfResult.reportType && pdfResult.reportType !== 'unknown' ? pdfResult.reportType : null, 'text-indigo-400'],
                    ['תאריך',        pdfResult.reportDate,                                           'text-slate-300'],
                    ['יתרה / צבירה', pdfResult.balance!=null ? fmt(pdfResult.balance) : null,       'text-white font-bold text-base'],
                    ['ד.נ. הפקדה',   pdfResult.feeFromDeposit!=null ? `${pdfResult.feeFromDeposit}%` : null, 'text-red-400'],
                    ['ד.נ. צבירה',   pdfResult.feeFromBalance!=null ? `${pdfResult.feeFromBalance}%` : null, 'text-red-400'],
                    ['תשואה שנתית',  pdfResult.annualReturn!=null   ? `${pdfResult.annualReturn}%`  : null, 'text-emerald-400'],
                  ].map(([label,val,cls])=>(
                    <div key={label} className="flex justify-between items-center">
                      <span className="text-slate-400">{label}</span>
                      <span className={val ? cls : 'text-slate-600 italic text-xs'}>{val ?? 'לא נמצא'}</span>
                    </div>
                  ))}
                </div>

                {pdfResult.warnings?.length > 0 && (
                  <div className="bg-amber-900/20 border border-amber-700/30 rounded-xl p-3 space-y-1">
                    {pdfResult.warnings.map((w,i)=>(
                      <div key={i} className="flex gap-2 text-xs text-amber-400">
                        <AlertTriangle size={12} className="mt-0.5 flex-shrink-0"/>
                        {w}
                      </div>
                    ))}
                  </div>
                )}

                {pdfResult.confidence === 'high' && (
                  <div className="flex gap-2 bg-emerald-900/20 border border-emerald-700/30 rounded-xl p-3 text-xs text-emerald-400">
                    <CheckCircle size={12} className="mt-0.5 flex-shrink-0"/>
                    כל השדות המרכזיים זוהו בהצלחה
                  </div>
                )}

                <div className="flex gap-3 pt-1">
                  {pdfResult.institution && (
                    <button onClick={applyPDF}
                      className="flex-1 bg-indigo-600 hover:bg-indigo-500 transition-colors py-2.5 rounded-xl text-sm font-semibold">
                      החל על {pdfResult.institution}
                    </button>
                  )}
                  <button onClick={()=>{setShowPDFModal(false);setPdfResult(null);}}
                    className={`${pdfResult.institution?'':'flex-1'} px-4 bg-slate-700 hover:bg-slate-600 transition-colors py-2.5 rounded-xl text-sm`}>
                    סגור
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        .input-base {
          width: 100%;
          background: #0f172a;
          border: 1px solid #334155;
          border-radius: 8px;
          padding: 8px 10px;
          font-size: 14px;
          color: #f1f5f9;
          outline: none;
          transition: border-color 0.15s;
        }
        .input-base:focus { border-color: #6366f1; }
        .input-base option { background: #1e293b; }
      `}</style>
    </div>
  );
}
