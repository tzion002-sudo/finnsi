/**
 * firestoreService.js – Firestore CRUD + Real-time Sync  V2.4.1
 * Project: finnsi-3a75d  |  Database: (default)
 *
 * כל פעולות הנתונים של המצפן — קריאה, כתיבה, מחיקה, האזנה.
 * אם Firebase לא מוגדר, כל הפונקציות עובדות על localStorage כ-fallback.
 *
 * V2.4.1 fixes:
 *  • saveAsset()              — setDoc+merge במקום updateDoc (מונע data-loss על Netlify)
 *  • saveMonthlySnapshot()    — setDoc+merge במקום updateDoc
 *  • subscribeToMarketData()  — real-time listener ל-market_data/latest
 *  • getMarketData()          — one-shot read ל-SmartScan button
 *  • saveMarketData()         — כתיבת market data מהדפדפן
 *  • seedAssetsIfEmpty()      — זריעת SEED לאוסף ריק (first-launch)
 */
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc,
  deleteDoc, onSnapshot, serverTimestamp,
  writeBatch, query, where,
} from 'firebase/firestore';
import { db, isFirebaseReady } from './firebase';

// ── Constants ────────────────────────────────────────────────────────────────
const FAMILY_ID   = 'mizrahi';
const STORAGE_KEY = 'compass_v2';

// ── Ref helpers ──────────────────────────────────────────────────────────────
const familyRef     = ()            => doc(db, 'families', FAMILY_ID);
const assetsCol     = ()            => collection(db, 'families', FAMILY_ID, 'assets');
const assetRef      = (id)          => doc(db, 'families', FAMILY_ID, 'assets', id);
const snapshotsCol  = ()            => collection(db, 'families', FAMILY_ID, 'snapshots');
const snapshotRef   = (assetId, ym) => doc(db, 'families', FAMILY_ID, 'snapshots', `${assetId}_${ym}`);
const settingsRef   = ()            => doc(db, 'families', FAMILY_ID, 'settings', 'global');
const marketDataRef = ()            => doc(db, 'market_data', 'latest');

// ── LocalStorage fallback helpers ────────────────────────────────────────────
function lsLoad(key, def) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; }
  catch { return def; }
}
function lsSave(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// ════════════════════════════════════════════════════════════════════════════
//  FAMILY
// ════════════════════════════════════════════════════════════════════════════

/**
 * Ensures the family document exists in Firestore.
 */
export async function initFamily() {
  if (!isFirebaseReady()) return false;
  try {
    const snap = await getDoc(familyRef());
    if (!snap.exists()) {
      await setDoc(familyRef(), {
        name:      'משפחת מזרחי',
        createdAt: serverTimestamp(),
      });
    }
    return true;
  } catch (e) {
    console.error('initFamily:', e);
    return false;
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  ASSETS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Real-time listener for all assets in the family.
 * Returns an unsubscribe function.
 */
export function subscribeToAssets(onAssetsUpdate, onError) {
  if (!isFirebaseReady()) {
    const saved = lsLoad(STORAGE_KEY, null);
    if (saved?.assets) onAssetsUpdate(saved.assets);
    return () => {};
  }
  return onSnapshot(
    assetsCol(),
    snapshot => {
      const assets = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      onAssetsUpdate(assets);
    },
    err => {
      console.error('subscribeToAssets:', err);
      if (onError) onError(err);
    }
  );
}

/**
 * Save (create or update) a single asset.
 * Uses setDoc+merge so it works even if the doc doesn't exist yet.
 */
export async function saveAsset(asset) {
  if (!isFirebaseReady()) {
    const saved = lsLoad(STORAGE_KEY, { assets: [] });
    const idx   = saved.assets.findIndex(a => a.id === asset.id);
    if (idx >= 0) saved.assets[idx] = asset; else saved.assets.push(asset);
    lsSave(STORAGE_KEY, saved);
    return;
  }
  const { id, ...payload } = asset;
  payload.updatedAt = serverTimestamp();
  await setDoc(assetRef(id), payload, { merge: true });
}

/**
 * Delete a single asset document.
 */
export async function deleteAsset(id) {
  if (!isFirebaseReady()) {
    const saved = lsLoad(STORAGE_KEY, { assets: [] });
    saved.assets = saved.assets.filter(a => a.id !== id);
    lsSave(STORAGE_KEY, saved);
    return;
  }
  await deleteDoc(assetRef(id));
}

// ════════════════════════════════════════════════════════════════════════════
//  MONTHLY SNAPSHOTS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Save a monthly balance snapshot for a specific asset.
 * Uses setDoc+merge — safe to call multiple times for the same month.
 */
export async function saveMonthlySnapshot(assetId, ym, balance, deposit = 0) {
  if (!isFirebaseReady()) return;
  await setDoc(
    snapshotRef(assetId, ym),
    {
      assetId,
      ym,
      balance,
      deposit,
      savedAt: serverTimestamp(),
    },
    { merge: true }
  );
  // Also update lastAutoDepositYM on the asset itself
  await setDoc(assetRef(assetId), { lastAutoDepositYM: ym }, { merge: true });
}

/**
 * Batch-save multiple monthly snapshots at once.
 * updates: [{ assetId, ym, balance, deposit }]
 */
export async function saveMonthlyBatch(updates) {
  if (!isFirebaseReady() || !updates?.length) return;
  const batch = writeBatch(db);
  for (const { assetId, ym, balance, deposit = 0 } of updates) {
    batch.set(
      snapshotRef(assetId, ym),
      { assetId, ym, balance, deposit, savedAt: serverTimestamp() },
      { merge: true }
    );
  }
  await batch.commit();
}

// ════════════════════════════════════════════════════════════════════════════
//  SETTINGS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Fetch the global settings document.
 * Returns null if not found or Firebase not ready.
 */
export async function getSettings() {
  if (!isFirebaseReady()) return null;
  try {
    const snap = await getDoc(settingsRef());
    return snap.exists() ? snap.data() : null;
  } catch (e) {
    console.error('getSettings:', e);
    return null;
  }
}

/**
 * Save (merge) the global settings document.
 */
export async function saveSettings(settings) {
  if (!isFirebaseReady()) {
    lsSave('compass_settings', settings);
    return;
  }
  await setDoc(settingsRef(), { ...settings, updatedAt: serverTimestamp() }, { merge: true });
}

// ════════════════════════════════════════════════════════════════════════════
//  MIGRATION
// ════════════════════════════════════════════════════════════════════════════

/**
 * One-time migration: lift localStorage data into Firestore.
 */
export async function migrateFromLocalStorage() {
  if (!isFirebaseReady()) return false;
  const saved = lsLoad(STORAGE_KEY, null);
  if (!saved?.assets?.length) return false;

  const snap = await getDocs(assetsCol());
  if (!snap.empty) return false; // already migrated

  const batch = writeBatch(db);
  for (const asset of saved.assets) {
    const { id, ...data } = asset;
    batch.set(assetRef(id), { ...data, migratedAt: serverTimestamp() });
  }
  await batch.commit();
  console.log(`✅ Migrated ${saved.assets.length} assets from localStorage to Firestore`);
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
//  MARKET DATA  (V2.4.1 — scanner → Firestore → app)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Real-time listener for market_data/latest written by the Node scanner.
 * Returns an unsubscribe function.
 */
export function subscribeToMarketData(onData, onError) {
  if (!isFirebaseReady()) return () => {};
  return onSnapshot(
    marketDataRef(),
    snap => {
      if (snap.exists()) onData(snap.data());
    },
    err => {
      console.error('subscribeToMarketData:', err);
      if (onError) onError(err);
    }
  );
}

/**
 * One-time fetch of market_data/latest.
 * Returns the data object or null.
 */
export async function getMarketData() {
  if (!isFirebaseReady()) return null;
  try {
    const snap = await getDoc(marketDataRef());
    return snap.exists() ? snap.data() : null;
  } catch (e) {
    console.error('getMarketData:', e);
    return null;
  }
}

/**
 * Write market data directly from the browser (fallback / manual trigger).
 * The Node scanner is the primary writer; this is a convenience override.
 */
export async function saveMarketData(data) {
  if (!isFirebaseReady()) return false;
  try {
    await setDoc(
      marketDataRef(),
      { ...data, updatedAt: serverTimestamp() },
      { merge: true }
    );
    return true;
  } catch (e) {
    console.error('saveMarketData:', e);
    return false;
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  SEED  (V2.4.1 — first-launch population)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Seeds the assets collection if it is empty.
 * Safe to call on every app startup — no-op when data already exists.
 * seedArray: [{ id, ...assetFields }]
 */
export async function seedAssetsIfEmpty(seedArray) {
  if (!isFirebaseReady() || !seedArray?.length) return false;
  try {
    const snap = await getDocs(assetsCol());
    if (!snap.empty) return false; // already has data

    const batch = writeBatch(db);
    for (const asset of seedArray) {
      const { id, ...data } = asset;
      batch.set(assetRef(id), { ...data, seededAt: serverTimestamp() });
    }
    await batch.commit();
    console.log(`✅ Seeded ${seedArray.length} assets to Firestore`);
    return true;
  } catch (e) {
    console.error('seedAssetsIfEmpty:', e);
    return false;
  }
}
