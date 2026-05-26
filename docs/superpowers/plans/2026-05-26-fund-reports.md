# Fund Reports V2.9.4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** כאשר המשתמש מעלה PDF רבעוני, המערכת מחלצת אוטומטית יתרה/תשואה/הפקדות, מעדכנת את הקופה המתאימה, ושומרת נקודת היסטוריה — המוצגת כגרף בטאב "חסכונות".

**Architecture:** `pdfParser.js` (קיים, לא נוגעים בו) מחלץ נתונים מה-PDF. `firestoreService.js` מקבל 2 פונקציות חדשות לשמירת היסטוריה וקריאתה. `DocumentsTab` מחובר ל-parser האמיתי עם דיאלוג disambiguation. `SavingsTab` מקבל גרף מסכם + כרטיס מורחב.

**Tech Stack:** React 18, Firestore (firebase/firestore), pdfjs-dist (כבר ב-pdfParser.js), Recharts (LineChart/Line כבר מיובאים)

---

## File Map

| קובץ | פעולה | אחריות |
|------|--------|---------|
| `src/lib/firestoreService.js` | Modify | הוסף `saveFundSnapshot`, `findExistingSnapshot`, `subscribeFundHistory` |
| `src/Dashboard.jsx` — `DocumentsTab` | Modify lines ~2836–2940 | חבר `parsePDF()`, auto-apply, דיאלוג disambiguation |
| `src/Dashboard.jsx` — `SavingsTab` | Modify lines ~1191–1330 | הוסף subscription + גרף מסכם + כרטיס מורחב |
| `src/Dashboard.jsx` — imports | Modify lines 1–10 | הוסף import של `parsePDF`, `saveFundSnapshot`, `findExistingSnapshot`, `subscribeFundHistory` |

---

## Task 1: Firestore — fund_history functions

**Files:**
- Modify: `src/lib/firestoreService.js`

### שלב 1.1: הוסף `orderBy` ל-import של firebase/firestore

פתח `src/lib/firestoreService.js`, שורה 16–20. שנה:
```javascript
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc,
  deleteDoc, onSnapshot, serverTimestamp,
  writeBatch, query, where,
} from 'firebase/firestore';
```
ל:
```javascript
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc,
  deleteDoc, onSnapshot, serverTimestamp,
  writeBatch, query, where, orderBy,
} from 'firebase/firestore';
```

### שלב 1.2: הוסף ref helper + 3 פונקציות — **בסוף הקובץ**, לפני שורת EOF

```javascript
// ════════════════════════════════════════════════════════════════════════════
//  FUND HISTORY — V2.9.4
//  קולקציה: families/mizrahi/fund_history/{autoId}
//  כל מסמך = דוח רבעוני אחד של קופה אחת
// ════════════════════════════════════════════════════════════════════════════

const fundHistoryCol = () => collection(db, 'families', FAMILY_ID, 'fund_history');

/**
 * שומר נקודת היסטוריה חדשה (דוח רבעוני שהועלה).
 * מחזיר את ה-docId שנוצר.
 */
export async function saveFundSnapshot(snapshot) {
  if (!isFirebaseReady()) {
    console.warn('saveFundSnapshot: Firebase not ready, skipping');
    return null;
  }
  const ref = await addDoc(fundHistoryCol(), {
    owner:           snapshot.owner           ?? null,
    fundType:        snapshot.fundType         ?? null,
    institution:     snapshot.institution      ?? null,
    reportDate:      snapshot.reportDate       ?? null,
    balance:         snapshot.balance          ?? null,
    ytdReturn:       snapshot.ytdReturn        ?? null,
    deposited:       snapshot.deposited        ?? null,
    fees:            snapshot.fees             ?? null,
    investmentTrack: snapshot.investmentTrack  ?? null,
    feeFromBalance:  snapshot.feeFromBalance   ?? null,
    feeFromDeposit:  snapshot.feeFromDeposit   ?? null,
    assetId:         snapshot.assetId          ?? null,
    fileName:        snapshot.fileName         ?? null,
    uploadedAt:      new Date().toISOString(),
  });
  return ref.id;
}

/**
 * בודק אם דוח עם אותו owner+fundType+institution+reportDate כבר קיים.
 * מחזיר docId אם קיים, null אם לא.
 */
export async function findExistingSnapshot(owner, fundType, institution, reportDate) {
  if (!isFirebaseReady()) return null;
  const q = query(
    fundHistoryCol(),
    where('owner',       '==', owner),
    where('fundType',    '==', fundType),
    where('institution', '==', institution),
    where('reportDate',  '==', reportDate),
  );
  const snap = await getDocs(q);
  return snap.empty ? null : snap.docs[0].id;
}

/**
 * Real-time listener להיסטוריית קופה.
 * filters: { owner?, fundType?, institution? } — כל שדה אופציונלי.
 * מחזיר unsubscribe function.
 */
export function subscribeFundHistory(filters, onData) {
  if (!isFirebaseReady()) { onData([]); return () => {}; }
  const constraints = [];
  if (filters.owner)       constraints.push(where('owner',       '==', filters.owner));
  if (filters.fundType)    constraints.push(where('fundType',    '==', filters.fundType));
  if (filters.institution) constraints.push(where('institution', '==', filters.institution));
  constraints.push(orderBy('reportDate', 'asc'));
  const q = query(fundHistoryCol(), ...constraints);
  return onSnapshot(q, snap =>
    onData(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  );
}
```

- [ ] **בצע את שינויי שלב 1.1 + 1.2**

- [ ] **בדיקת syntax — הרץ בטרמינל:**
```bash
cd "D:/פרויקט עוזר פיננסי" && npm run build 2>&1 | head -30
```
תוצאה צפויה: build עובר ללא שגיאות TypeScript/syntax.

- [ ] **Commit:**
```bash
git add src/lib/firestoreService.js
git commit -m "feat(V2.9.4): add fund_history Firestore functions

saveFundSnapshot, findExistingSnapshot, subscribeFundHistory.
Uses families/mizrahi/fund_history collection.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Dashboard.jsx — imports

**Files:**
- Modify: `src/Dashboard.jsx` שורות 1–5

### שלב 2.1: הוסף import של parsePDF

בשורה 1 של הקובץ, לאחר שורת ה-React import, הוסף:
```javascript
import { parsePDF } from './lib/pdfParser';
```

### שלב 2.2: עדכן import של firestoreService — הוסף 3 פונקציות חדשות

שורה 2–4 כרגע:
```javascript
import { saveAsset, saveAllAssets, subscribeToAssets, initFamily, getSettings, saveSettings, deleteAsset,
         subscribeToMarketData, getMarketData, seedAssetsIfEmpty,
         subscribeToSettings, subscribeToAlerts } from './lib/firestoreService';
```
שנה ל:
```javascript
import { saveAsset, saveAllAssets, subscribeToAssets, initFamily, getSettings, saveSettings, deleteAsset,
         subscribeToMarketData, getMarketData, seedAssetsIfEmpty,
         subscribeToSettings, subscribeToAlerts,
         saveFundSnapshot, findExistingSnapshot, subscribeFundHistory } from './lib/firestoreService';
```

- [ ] **בצע שינויי שלב 2.1 + 2.2**

- [ ] **בדיקת syntax:**
```bash
npm run build 2>&1 | head -20
```
תוצאה צפויה: ללא שגיאות import.

- [ ] **Commit:**
```bash
git add src/Dashboard.jsx
git commit -m "feat(V2.9.4): add parsePDF + fund history imports to Dashboard

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: DocumentsTab — חיבור pdfParser + auto-apply + disambiguation

**Files:**
- Modify: `src/Dashboard.jsx` — פונקציית `DocumentsTab` (שורות ~2836–2940)

### שלב 3.1: הוסף helper function `matchFundToAsset` — **לפני** `const DocumentsTab`

הוסף את הקוד הבא ממש **לפני** שורת `const DocumentsTab = (`:

```javascript
// ── V2.9.4: פונקציית התאמה — parser result → asset קיים ──────────────────
const FUND_TYPE_TO_HE = {
  pension:    ['פנסיה'],
  study_fund: ['השתלמות', 'קרן השתלמות'],
  gemel:      ['גמל', 'קופת גמל', 'גמל להשקעה', 'גמל לחיסכון'],
  children:   ['ילד', 'חיסכון לכל ילד'],
};

function matchFundToAsset(parsed, assets) {
  // מסנן לפי owner + fundType + institution
  return assets.filter(a => {
    const ownerMatch = parsed.owner
      ? (a.owner === parsed.owner)
      : true;

    const typePatterns = FUND_TYPE_TO_HE[parsed.reportType] || [];
    const typeMatch = parsed.reportType
      ? typePatterns.some(p => a.type?.includes(p))
      : true;

    const instMatch = parsed.institution
      ? (a.institution?.includes(parsed.institution) ||
         parsed.institution?.includes(a.institution))
      : true;

    return ownerMatch && typeMatch && instMatch;
  });
}
```

### שלב 3.2: החלף את כל גוף `handleDocUpload` (שורות ~2843–2914)

**מחק** את הפונקציה הקיימת `handleDocUpload` והחלף ב:

```javascript
const handleDocUpload = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  setScanning(true);
  setScanResult(null);
  e.target.value = "";

  try {
    // ── 1. ניתוח PDF עם pdfParser.js ──────────────────────────
    const parsed = await parsePDF(file);

    // ── 2. בדיקת כפילות ──────────────────────────────────────
    if (parsed.institution && parsed.reportType && parsed.owner && parsed.reportDate) {
      const existingId = await findExistingSnapshot(
        parsed.owner, parsed.reportType, parsed.institution, parsed.reportDate
      );
      if (existingId) {
        setScanResult({
          ...parsed,
          _isDuplicate: true,
          _existingId: existingId,
          status: "duplicate",
        });
        setScanning(false);
        return;
      }
    }

    // ── 3. התאמה לקופה קיימת ──────────────────────────────────
    const matches = matchFundToAsset(parsed, assets);
    setScanResult({
      ...parsed,
      _matches: matches,
      status: matches.length === 1 ? "matched" : matches.length > 1 ? "ambiguous" : "unmatched",
      matchedAssetId:   matches.length === 1 ? matches[0].id   : null,
      matchedAssetName: matches.length === 1
        ? `${matches[0].owner} · ${matches[0].type}`
        : null,
    });
  } catch (err) {
    setScanResult({ error: `שגיאה בסריקה: ${err.message}`, confidence: 'low' });
  } finally {
    setScanning(false);
  }
};
```

### שלב 3.3: החלף את `applyDocScan` (שורות ~2916–2938)

**מחק** את `applyDocScan` הקיימת והחלף ב:

```javascript
// מחיל תוצאת סריקה על קופה נבחרת ושומר היסטוריה
const applyDocScan = async (assetId) => {
  if (!scanResult || scanResult.error) return;
  const assetToUpdate = assets.find(a => a.id === assetId);
  const assetName = assetToUpdate
    ? `${assetToUpdate.owner} · ${assetToUpdate.type}`
    : "לא ידוע";

  // ── שמירת נקודת היסטוריה ──────────────────────────────────
  const snapshotId = await saveFundSnapshot({
    owner:           scanResult.owner,
    fundType:        scanResult.reportType,
    institution:     scanResult.institution,
    reportDate:      scanResult.reportDate,
    balance:         scanResult.balance,
    ytdReturn:       scanResult.annualReturn,
    deposited:       null, // pdfParser לא מחלץ כרגע — שדה עתידי
    fees:            null,
    investmentTrack: scanResult.investmentTrack,
    feeFromBalance:  scanResult.feeFromBalance,
    feeFromDeposit:  scanResult.feeFromDeposit,
    assetId,
    fileName:        scanResult.fileName,
  });

  // ── עדכון יתרה נוכחית ─────────────────────────────────────
  if (assetId && scanResult.balance != null) {
    setAssets(prev => prev.map(a => a.id !== assetId ? a : {
      ...a,
      reportBalance:    scanResult.balance,
      reportDate:       scanResult.reportDate,
      checkDate:        scanResult.reportDate,
      source:           "pdf_report",
      _reportConfirmed: true,
    }));
    await saveAsset({ ...assetToUpdate, reportBalance: scanResult.balance,
      reportDate: scanResult.reportDate, source: "pdf_report" });
    setSaveToast(`📄 ${assetName}: יתרה ${fmt(scanResult.balance)} עודכנה ✅`);
  } else {
    setSaveToast(`📄 דוח נשמר בהיסטוריה — לא זוהתה קופה תואמת`);
  }

  // ── שמירת רשומת ארכיון ────────────────────────────────────
  const archiveEntry = {
    id:           `doc_${Date.now()}`,
    fileName:     scanResult.fileName,
    uploadedAt:   new Date().toISOString(),
    reportDate:   scanResult.reportDate,
    balance:      scanResult.balance,
    institution:  scanResult.institution,
    owner:        scanResult.owner,
    fundType:     scanResult.reportType,
    matchedAssetId:   assetId,
    matchedAssetName: assetName,
    confidence:   scanResult.confidence,
    snapshotId,
    status:       "confirmed",
    source:       "pdf_report",
  };
  setDocuments(prev => [archiveEntry, ...prev]);
  setScanResult(null);
};
```

### שלב 3.4: החלף את ה-JSX של scanResult בתוך `return` של DocumentsTab

מצא את הבלוק `{scanResult && ...}` ב-JSX של DocumentsTab (אחרי כפתור ה-upload) והחלף ב:

```jsx
{/* תוצאת סריקה */}
{scanResult && !scanResult.error && (
  <div className="bg-slate-800/60 border border-sky-700/50 rounded-2xl p-5 space-y-3">
    {/* כותרת */}
    <div className="flex items-center gap-2 text-sm font-semibold text-sky-300">
      <FileText size={15}/>
      {scanResult.institution ?? "חברה לא זוהתה"} · {
        { pension: "פנסיה", study_fund: "השתלמות", gemel: "גמל", children: "חיסכון ילד", unknown: "לא ידוע" }[scanResult.reportType] ?? scanResult.reportType
      } · {scanResult.owner ?? "בעלים לא זוהה"}
    </div>

    {/* נתונים */}
    <div className="grid grid-cols-2 gap-2 text-sm">
      <div><span className="text-slate-400">יתרה:</span> <span className="text-emerald-300 font-bold">{scanResult.balance != null ? fmt(scanResult.balance) : "—"}</span></div>
      <div><span className="text-slate-400">תאריך:</span> <span className="text-slate-200">{scanResult.reportDate ?? "—"}</span></div>
      <div><span className="text-slate-400">תשואה YTD:</span> <span className={scanResult.annualReturn < 0 ? "text-red-400" : "text-green-400"}>{scanResult.annualReturn != null ? `${scanResult.annualReturn}%` : "—"}</span></div>
      <div><span className="text-slate-400">מסלול:</span> <span className="text-slate-200">{scanResult.investmentTrack ?? "—"}</span></div>
    </div>

    {/* אזהרות */}
    {(scanResult.warnings?.length > 0) && (
      <div className="text-xs text-amber-400 space-y-0.5">
        {scanResult.warnings.map((w, i) => <div key={i}>⚠️ {w}</div>)}
      </div>
    )}

    {/* כפול */}
    {scanResult._isDuplicate && (
      <div className="text-amber-400 text-sm">⚠️ דוח זה כבר הועלה. לדרוס?
        <button onClick={() => applyDocScan(scanResult._matches?.[0]?.id ?? null)}
          className="ml-3 bg-amber-600 hover:bg-amber-500 text-white text-xs px-3 py-1 rounded-lg">דרוס ושמור</button>
        <button onClick={() => setScanResult(null)}
          className="ml-2 bg-slate-700 hover:bg-slate-600 text-white text-xs px-3 py-1 rounded-lg">בטל</button>
      </div>
    )}

    {/* התאמה ברורה */}
    {scanResult.status === "matched" && (
      <div className="flex items-center gap-3">
        <span className="text-emerald-400 text-sm">✅ נמצאה קופה תואמת: <b>{scanResult.matchedAssetName}</b></span>
        <button onClick={() => applyDocScan(scanResult.matchedAssetId)}
          className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold px-4 py-1.5 rounded-xl">החל ושמור</button>
        <button onClick={() => setScanResult(null)}
          className="bg-slate-700 hover:bg-slate-600 text-white text-sm px-3 py-1.5 rounded-xl">בטל</button>
      </div>
    )}

    {/* אמביגואי */}
    {scanResult.status === "ambiguous" && (
      <div className="space-y-2">
        <p className="text-amber-400 text-sm">⚠️ נמצאו {scanResult._matches.length} קופות תואמות — בחר:</p>
        {scanResult._matches.map(a => (
          <button key={a.id} onClick={() => applyDocScan(a.id)}
            className="block w-full text-right bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm px-4 py-2 rounded-xl">
            {a.owner} · {a.type} · {a.institution}
          </button>
        ))}
        <button onClick={() => setScanResult(null)}
          className="bg-slate-700 hover:bg-slate-600 text-slate-400 text-sm px-3 py-1.5 rounded-xl">בטל</button>
      </div>
    )}

    {/* לא נמצאה קופה */}
    {scanResult.status === "unmatched" && (
      <div className="flex items-center gap-3">
        <span className="text-slate-400 text-sm">לא נמצאה קופה תואמת — הנתונים יישמרו בהיסטוריה</span>
        <button onClick={() => applyDocScan(null)}
          className="bg-slate-600 hover:bg-slate-500 text-white text-sm px-4 py-1.5 rounded-xl">שמור בהיסטוריה</button>
        <button onClick={() => setScanResult(null)}
          className="bg-slate-700 hover:bg-slate-600 text-slate-400 text-sm px-3 py-1.5 rounded-xl">בטל</button>
      </div>
    )}
  </div>
)}

{/* שגיאת סריקה */}
{scanResult?.error && (
  <div className="bg-red-900/30 border border-red-700/50 rounded-xl p-4 text-red-300 text-sm">
    ❌ {scanResult.error}
    <button onClick={() => setScanResult(null)} className="ml-3 text-red-400 underline text-xs">סגור</button>
  </div>
)}
```

- [ ] **בצע שינויי שלב 3.1–3.4**

- [ ] **בדיקת build:**
```bash
npm run build 2>&1 | head -30
```
תוצאה צפויה: ללא שגיאות.

- [ ] **בדיקה ידנית בדפדפן:**
  1. פתח `http://localhost:5173` (או `npm run dev`)
  2. לך לטאב "מחסן דוחות"
  3. העלה את `D:\חסכונות משפחת לוי\March 0 (1).pdf`
  4. וודא שמוצג: "מנורה מבטחים · פנסיה · ציון · ₪657,178"
  5. לחץ "החל ושמור" ← וודא toast "📄 ציון · קרן פנסיה: יתרה ₪657,178 עודכנה ✅"
  6. פתח Firestore Console → `families/mizrahi/fund_history` ← וודא מסמך חדש

- [ ] **Commit:**
```bash
git add src/Dashboard.jsx
git commit -m "feat(V2.9.4): connect pdfParser.js to DocumentsTab

Auto-apply PDF reports: parsePDF() extraction, duplicate detection,
fund matching, disambiguation dialog, fund_history snapshot write.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: SavingsTab — גרף מסכם + subscription

**Files:**
- Modify: `src/Dashboard.jsx` — `SavingsTab` component (שורות ~1191–1330)

### שלב 4.1: הוסף state + subscription להיסטוריה

בתוך `SavingsTab`, מיד אחרי `const [newRow, setNewRow] = useState(...)`, הוסף:

```javascript
// V2.9.4 — Fund history for charts
const [fundHistory, setFundHistory] = useState([]);
const [historyOwner, setHistoryOwner] = useState('כולם');

useEffect(() => {
  const filters = historyOwner !== 'כולם' ? { owner: historyOwner } : {};
  const unsub = subscribeFundHistory(filters, setFundHistory);
  return unsub;
}, [historyOwner]);
```

### שלב 4.2: הוסף חישוב נתוני גרף מסכם

לאחר `const chartData = useMemo(...)` הקיים, הוסף:

```javascript
// V2.9.4 — Summary chart: סה"כ יתרה לפי רבעון (לבעל נבחר)
const summaryChartData = useMemo(() => {
  // מקבץ לפי reportDate — סוכם כל הקופות
  const byDate = {};
  fundHistory.forEach(snap => {
    if (!snap.reportDate || snap.balance == null) return;
    // תאריך → Q format: "Q1 2026"
    const d = new Date(snap.reportDate);
    const q = `Q${Math.ceil((d.getMonth() + 1) / 3)} ${d.getFullYear()}`;
    byDate[q] = (byDate[q] || 0) + snap.balance;
  });
  return Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([quarter, total]) => ({ quarter, total }));
}, [fundHistory]);

// רשימת בעלים ייחודיים מהיסטוריה
const historyOwners = useMemo(() => {
  const owners = [...new Set(fundHistory.map(s => s.owner).filter(Boolean))];
  return ['כולם', ...owners];
}, [fundHistory]);
```

### שלב 4.3: הוסף גרף מסכם ב-JSX — **לפני** כרטיסי הסיכום הקיימים

מצא בתוך ה-`return` של SavingsTab את `{/* כרטיסי סיכום */}` ולפניו הוסף:

```jsx
{/* V2.9.4 — גרף מסכם קופות רבעוני */}
{summaryChartData.length > 0 && (
  <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-5 mb-5">
    <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
      <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
        <TrendingUp size={14} className="text-teal-400"/> התקדמות קופות לאורך זמן
      </h3>
      <div className="flex gap-1">
        {historyOwners.map(o => (
          <button key={o} onClick={() => setHistoryOwner(o)}
            className={`text-xs px-3 py-1 rounded-full transition-colors ${
              historyOwner === o
                ? 'bg-teal-600 text-white'
                : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
            }`}>{o}</button>
        ))}
      </div>
    </div>
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={summaryChartData}>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155"/>
        <XAxis dataKey="quarter" tick={{ fill: '#94a3b8', fontSize: 11 }}/>
        <YAxis tickFormatter={v => `₪${(v/1000).toFixed(0)}K`} tick={{ fill: '#94a3b8', fontSize: 11 }} width={60}/>
        <Tooltip formatter={(v) => [fmt(v), 'יתרה כוללת']} contentStyle={{ background: '#1e293b', border: '1px solid #334155' }}/>
        <Line type="monotone" dataKey="total" stroke="#14b8a6" strokeWidth={2} dot={{ fill: '#14b8a6', r: 4 }}/>
      </LineChart>
    </ResponsiveContainer>
  </div>
)}
```

- [ ] **בצע שינויי שלב 4.1–4.3**

- [ ] **בדיקת build:**
```bash
npm run build 2>&1 | head -20
```

- [ ] **בדיקה ידנית:**
  1. לאחר שהעלית דוחות ב-Task 3, לך לטאב "חסכונות"
  2. וודא שמוצג גרף קו עם נקודות רבעוניות
  3. לחץ על "ציון" בפילטר — וודא שהגרף מסנן

- [ ] **Commit:**
```bash
git add src/Dashboard.jsx
git commit -m "feat(V2.9.4): add fund history summary chart to SavingsTab

subscribeFundHistory subscription, quarterly LineChart,
owner filter buttons (כולם/ציון/זיו/הראל/ליאם).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: SavingsTab — כרטיס קופה מורחב עם גרף פירוט

**Files:**
- Modify: `src/Dashboard.jsx` — `SavingsTab` JSX (כרטיסי קופות הקיימים)

### שלב 5.1: הוסף state לקופה נבחרת

בתוך SavingsTab, לאחר `const [historyOwner, setHistoryOwner] = useState(...)`, הוסף:

```javascript
const [selectedFundKey, setSelectedFundKey] = useState(null); // "owner|fundType|institution"
```

### שלב 5.2: הוסף נתוני גרף פירוט לקופה נבחרת

לאחר `summaryChartData`, הוסף:

```javascript
// V2.9.4 — Detail chart לקופה נבחרת
const detailChartData = useMemo(() => {
  if (!selectedFundKey) return [];
  const [owner, fundType, institution] = selectedFundKey.split('|');
  return fundHistory
    .filter(s => s.owner === owner && s.fundType === fundType && s.institution === institution)
    .sort((a, b) => a.reportDate?.localeCompare(b.reportDate))
    .map(s => {
      const d = new Date(s.reportDate);
      return {
        quarter:  `Q${Math.ceil((d.getMonth() + 1) / 3)} ${d.getFullYear()}`,
        balance:  s.balance,
        ytd:      s.ytdReturn,
      };
    });
}, [fundHistory, selectedFundKey]);

// מידע הקופה הנבחרת
const selectedFundLatest = useMemo(() => {
  if (!detailChartData.length) return null;
  return detailChartData[detailChartData.length - 1];
}, [detailChartData]);
```

### שלב 5.3: הוסף JSX של כרטיס מורחב — **אחרי** הגרף המסכם ולפני כרטיסי הסיכום

```jsx
{/* V2.9.4 — כרטיס קופה מורחב */}
{selectedFundKey && detailChartData.length > 0 && (
  <div className="bg-slate-800/60 border border-teal-700/50 rounded-2xl p-5 mb-5">
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-sm font-semibold text-teal-300">
        📊 {selectedFundKey.split('|')[2]} · {
          { pension: 'פנסיה', study_fund: 'השתלמות', gemel: 'גמל', children: 'חיסכון ילד' }[selectedFundKey.split('|')[1]]
        } · {selectedFundKey.split('|')[0]}
      </h3>
      <button onClick={() => setSelectedFundKey(null)}
        className="text-slate-500 hover:text-slate-300 text-lg leading-none">×</button>
    </div>

    {/* גרף פירוט */}
    <ResponsiveContainer width="100%" height={160}>
      <LineChart data={detailChartData}>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155"/>
        <XAxis dataKey="quarter" tick={{ fill: '#94a3b8', fontSize: 10 }}/>
        <YAxis tickFormatter={v => `₪${(v/1000).toFixed(0)}K`} tick={{ fill: '#94a3b8', fontSize: 10 }} width={55}/>
        <Tooltip formatter={(v, n) => [n === 'balance' ? fmt(v) : `${v}%`, n === 'balance' ? 'יתרה' : 'תשואה YTD']}
          contentStyle={{ background: '#1e293b', border: '1px solid #334155' }}/>
        <Line type="monotone" dataKey="balance" stroke="#14b8a6" strokeWidth={2} dot={{ fill: '#14b8a6', r: 4 }} name="balance"/>
      </LineChart>
    </ResponsiveContainer>

    {/* נתוני תשואה */}
    {selectedFundLatest?.ytd != null && (
      <div className="mt-3 flex items-center gap-2 text-sm">
        <span className="text-slate-400">תשואה YTD:</span>
        <span className={selectedFundLatest.ytd < 0 ? "text-red-400 font-bold" : "text-green-400 font-bold"}>
          {selectedFundLatest.ytd > 0 ? '+' : ''}{selectedFundLatest.ytd}%
        </span>
        <span className="text-slate-500 text-xs">({detailChartData.length} דוחות בהיסטוריה)</span>
      </div>
    )}
  </div>
)}
```

### שלב 5.4: הוסף לחיצה על כרטיסי קופה — trigger של selectedFundKey

מצא בתוך SavingsTab את המקום שבו מרונדרות קופות (assets cards) — לרוב לולאה `assets.map(...)` עם `onClick`. הוסף לכל כרטיס קופה, ל-`onClick` הקיים **בנוסף** (או כ-handler נפרד):

```javascript
// בתוך onClick של כרטיס קופה a:
const key = `${a.owner}|${
  a.type?.includes('פנסיה') ? 'pension' :
  a.type?.includes('השתלמות') ? 'study_fund' :
  a.type?.includes('גמל') ? 'gemel' :
  a.type?.includes('ילד') ? 'children' : 'unknown'
}|${a.institution}`;
setSelectedFundKey(prev => prev === key ? null : key); // toggle
```

> **הערה:** מצא בקוד את מקום הרינדור של כרטיסי הקופות ב-SavingsTab. אם יש `onClick` קיים — הוסף קוד זה לתוכו. אם אין — הוסף `onClick` חדש.

- [ ] **בצע שינויי שלב 5.1–5.4**

- [ ] **בדיקת build:**
```bash
npm run build 2>&1 | head -20
```

- [ ] **בדיקה ידנית:**
  1. לך לטאב "חסכונות"
  2. לחץ על כרטיס "קרן השתלמות · ציון"
  3. וודא שמופיע כרטיס מורחב עם גרף קו ותשואה YTD
  4. לחץ שוב — וודא שנסגר (toggle)

- [ ] **Commit:**
```bash
git add src/Dashboard.jsx
git commit -m "feat(V2.9.4): add per-fund detail chart with toggle card

Click any fund card → expanded view with historical LineChart and YTD return.
Click again to close.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: גרסה + Firestore index + push

**Files:**
- Modify: `src/Dashboard.jsx` — שורת `APP_VERSION`

### שלב 6.1: עדכן גרסה

מצא:
```javascript
const APP_VERSION = "V2.9.3";
```
שנה ל:
```javascript
const APP_VERSION = "V2.9.4";
```

### שלב 6.2: הוסף Firestore Composite Index

`fund_history` משתמש ב-`where + orderBy` — Firestore דורש index composite.
היכנס ל: https://console.firebase.google.com/project/finnsi-3a75d/firestore/indexes

צור index:
- Collection: `families/mizrahi/fund_history` (subcollection path: `fund_history`)
- Fields: `owner ASC`, `reportDate ASC`
- Fields: `fundType ASC`, `reportDate ASC`
- Fields: `institution ASC`, `reportDate ASC`

> **טיפ:** בפעם הראשונה שתריץ query עם `where + orderBy`, Firestore יציג בconsole קישור ישיר ליצירת ה-index. ניתן לחכות לשגיאה הראשונה ולהשתמש בקישור.

### שלב 6.3: Final build ו-push

- [ ] **בצע שינוי גרסה (שלב 6.1)**

- [ ] **Build סופי:**
```bash
npm run build 2>&1 | tail -10
```
תוצאה צפויה: `✓ built in X.Xs`

- [ ] **Commit + Push:**
```bash
git add src/Dashboard.jsx
git commit -m "feat: release V2.9.4 — fund reports PDF pipeline

• DocumentsTab: pdfParser.js connected, auto-apply, disambiguation dialog
• SavingsTab: fund_history subscription, quarterly LineChart, detail card
• firestoreService: saveFundSnapshot, findExistingSnapshot, subscribeFundHistory
• fund_history Firestore collection under families/mizrahi

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"

git push
```

- [ ] **בדיקת GitHub Actions:**
```
https://github.com/<repo>/actions
```
וודא שה-workflow עבר ירוק.

---

## Self-Review

**Spec coverage:**
- ✅ PDF upload → parsePDF() → extracted data (Task 3)
- ✅ fund_history Firestore collection (Task 1)
- ✅ Match to existing asset + update reportBalance (Task 3)
- ✅ Duplicate detection (Task 3)
- ✅ Disambiguation dialog (Task 3)
- ✅ Unmatched fund → save to history only (Task 3)
- ✅ Summary chart per owner (Task 4)
- ✅ Detail chart per fund (Task 5)
- ✅ מחסן דוחות = archive only (Task 3 — no logic change to archive list)
- ✅ All family members (Tasks 4-5 — owner filter)
- ✅ Version bump (Task 6)

**No placeholders:** כל שלב מכיל קוד מלא. ✅

**Type consistency:**
- `parsePDF()` מחזיר `{ institution, reportType, owner, reportDate, balance, annualReturn, investmentTrack, feeFromBalance, feeFromDeposit, confidence, warnings, fileName }` — בהתאמה לשימוש ב-Task 3.
- `saveFundSnapshot()` מקבל object עם שדות מ-scanResult — בהתאמה.
- `subscribeFundHistory(filters, onData)` — filters משמש ב-Task 4 עם `{ owner }` — בהתאמה.
- `selectedFundKey` format: `"owner|fundType|institution"` — עקבי בין Task 5.1, 5.2, 5.3, 5.4. ✅
