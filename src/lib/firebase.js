/**
 * firebase.js – Firebase initialization for The Compass
 * -------------------------------------------------------
 * כדי להפעיל: מלא את הפרטים מה-Firebase Console שלך.
 *
 * איך מוצאים את הפרטים:
 * 1. Firebase Console → Project Settings (גלגל השיניים) ⚙️
 * 2. "Your apps" → בחר את ה-web app שלך
 * 3. העתק את ה-firebaseConfig שרשום שם
 *
 * ⚠️ חשוב: ערכי PLACEHOLDER צריכים להיות מוחלפים בערכים אמיתיים!
 */

import { initializeApp } from 'firebase/app';
import { initializeFirestore } from 'firebase/firestore';

// ─── Firebase Config — פרויקט finnsi-3a75d ────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyBy7Rwwng-vpgE9Vjg3U0WgBgXOTZQFsv4",
  authDomain:        "finnsi-3a75d.firebaseapp.com",
  projectId:         "finnsi-3a75d",
  storageBucket:     "finnsi-3a75d.firebasestorage.app",
  messagingSenderId: "927963068698",
  appId:             "1:927963068698:web:67d710d1f86ad7d2c6d4a3",
  measurementId:     "G-JS8RFEKS0S",
};
// ──────────────────────────────────────────────────────────────

// בדיקה אוטומטית שה-config מולא
const CONFIG_FILLED = !Object.values(firebaseConfig).some(v => v.startsWith('REPLACE_WITH'));

let app = null;
let db  = null;

if (CONFIG_FILLED) {
  try {
    app = initializeApp(firebaseConfig);
    db  = initializeFirestore(app, {
      ignoreUndefinedProperties: true,  // מונע שגיאות כאשר שדות undefined נשלחים ל-Firestore
      // שם מסד הנתונים הוא "default" (ללא סוגריים) — לא "(default)"!
      // ה-SDK ברירת מחדל מחפש "(default)" אבל Firebase יצר אותו בשם "default"
    }, 'default'); // ← חובה: ID מפורש של מסד הנתונים
    console.log('✅ Firebase connected:', firebaseConfig.projectId);
  } catch (e) {
    console.error('❌ Firebase init failed:', e.message);
  }
} else {
  console.warn('⚠️ Firebase config לא הוזן. פועל ב-localStorage fallback mode.');
}

/**
 * isFirebaseReady() → bool
 * השתמש בזה בכל מקום לפני גישה ל-Firestore.
 */
export const isFirebaseReady = () => !!db;

export { db };
export default app;

// ══════════════════════════════════════════════════════════════
//  DATA MODEL — Firestore Structure
// ══════════════════════════════════════════════════════════════
//
// /families/{familyId}/               ← "mizrahi" (ID קבוע)
//   name: "משפחת מזרחי"
//   members: ["ציון","זיו","הראל","ליאם"]
//   createdAt: Timestamp
//
//   /assets/{assetId}                 ← ID אוטומטי מ-Firestore
//     owner:           "ציון"
//     type:            "פנסיה"
//     institution:     "הראל"
//     amount:          450000
//     category:        "pension"
//     monthlyDeposit:  3200
//     feeFromDeposit:  1.5
//     feeFromBalance:  0.25
//     annualReturn:    8.2
//     isMSTY:          false
//     sharesCount:     0
//     investmentTrack: "מחקה S&P 500"   ← חדש!
//     lastUpdated:     Timestamp
//     source:          "manual" | "pdf"
//
//   /snapshots/{snapshotId}           ← ID: "{assetId}_{ym}"
//     assetId:     "..."
//     ym:          "2025-04"
//     balance:     450000
//     deposit:     3200
//     return:      2100              ← תשואה מחושבת
//     recordedAt:  Timestamp
//
//   /settings/global                  ← מסמך יחיד
//     mstyDivPerShare:  2.5
//     lastSyncAt:       Timestamp
//
// ══════════════════════════════════════════════════════════════
