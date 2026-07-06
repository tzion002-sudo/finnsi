// ═══════════════════════════════════════════════════════════════
//  dividendSync.test.js — V3.0
//  תרחישי הרגרסיה של באג הכפילויות V2.9.1 + כללי המועצה.
// ═══════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import { reconcileDividends, isMatch } from "./dividendSync.js";

const srv = (exDate, amount, extra = {}) => ({ exDate, amount, status: "confirmed", source: "YieldMax ETFs", ...extra });
const loc = (date, amount, extra = {}) => ({ date, amount, verified: false, status: "confirmed", ...extra });

describe("reconcileDividends — תרחישי V2.9.1", () => {
  it("(א) הוספה כפולה: הרצה חוזרת על אותו קלט לא מוסיפה כלום (אידמפוטנטיות)", () => {
    const server = [srv("2026-06-25", 0.1883), srv("2026-07-02", 0.1549)];
    const first = reconcileDividends(server, [loc("2026-06-18", 0.2286)], []);
    expect(first.added).toHaveLength(2);

    const second = reconcileDividends(server, first.merged, []);
    expect(second.changed).toBe(false);
    expect(second.merged).toHaveLength(first.merged.length);
  });

  it("(ב) מחיקה ידנית + סריקה חוזרת: tombstone מנצח — הדיבידנד לא קם לתחייה", () => {
    const server = [srv("2026-06-25", 0.1883)];
    const tombstones = [{ exDate: "2026-06-25", amount: 0.1883 }];
    const r = reconcileDividends(server, [loc("2026-06-18", 0.2286)], tombstones);
    expect(r.changed).toBe(false);
    expect(r.merged.some(d => d.date === "2026-06-25")).toBe(false);
  });

  it("(ג) תיקון תאריך רטרואקטיבי (±2 ימים, אותו סכום): עדכון במקום כפילות", () => {
    const local = [loc("2026-06-24", 0.1883)]; // המקור תיקן ל-25.6
    const server = [srv("2026-06-25", 0.1883)];
    const r = reconcileDividends(server, local, []);
    expect(r.added).toHaveLength(0);
    expect(r.updated).toHaveLength(1);
    expect(r.merged).toHaveLength(1);
    expect(r.merged[0].date).toBe("2026-06-25");
  });

  it("(ג-2) tombstone תופס גם תיקון תאריך רטרואקטיבי", () => {
    const tombstones = [{ exDate: "2026-06-24", amount: 0.1883 }]; // נמחק לפי התאריך הישן
    const server = [srv("2026-06-25", 0.1883)];                    // המקור תיקן תאריך
    const r = reconcileDividends(server, [], tombstones);
    expect(r.merged.some(d => d.amount === 0.1883)).toBe(false);
  });

  it("(ד) תיקון סכום באותו תאריך: מתעדכן, לא מוכפל", () => {
    const local = [loc("2026-06-25", 0.19)];
    const server = [srv("2026-06-25", 0.1883)];
    const r = reconcileDividends(server, local, []);
    expect(r.added).toHaveLength(0);
    expect(r.merged).toHaveLength(1);
    expect(r.merged[0].amount).toBe(0.1883);
    expect(r.merged[0].source).toBe("auto_sync");
  });

  it("(ה) עריכה ידנית (verified) מנצחת את השרת", () => {
    const local = [loc("2026-06-25", 0.20, { verified: true, note: "תוקן ידנית מול הברוקר" })];
    const server = [srv("2026-06-25", 0.1883)];
    const r = reconcileDividends(server, local, []);
    expect(r.changed).toBe(false);
    expect(r.merged[0].amount).toBe(0.20);
    expect(r.merged[0].note).toBe("תוקן ידנית מול הברוקר");
  });
});

describe("reconcileDividends — רצפת תאריך והיסטוריה", () => {
  it("לא מציף היסטוריה מלפני תחילת ההחזקה (רצפה = הדיבידנד הלוקאלי המוקדם)", () => {
    const local = [loc("2025-06-13", 2.02)]; // תחילת ההחזקה
    const server = [
      srv("2024-05-10", 2.5), // לפני ההחזקה — לא ייכנס
      srv("2025-06-13", 2.02),
      srv("2026-06-25", 0.1883),
    ];
    const r = reconcileDividends(server, local, []);
    expect(r.merged.some(d => d.date === "2024-05-10")).toBe(false);
    expect(r.merged.some(d => d.date === "2026-06-25")).toBe(true);
  });

  it("רשימה לוקאלית ריקה: משתמש ב-fallbackMinDate", () => {
    const server = [srv("2024-05-10", 2.5), srv("2026-06-25", 0.1883)];
    const r = reconcileDividends(server, [], [], { fallbackMinDate: "2025-06-01" });
    expect(r.merged).toHaveLength(1);
    expect(r.merged[0].date).toBe("2026-06-25");
  });

  it("shareBasis נקבע לפי תאריך הפיצול (2025-12-08)", () => {
    const server = [srv("2025-11-28", 1.5), srv("2026-06-25", 0.1883)];
    const r = reconcileDividends(server, [loc("2025-06-13", 2.02)], []);
    expect(r.merged.find(d => d.date === "2025-11-28").shareBasis).toBe("pre");
    expect(r.merged.find(d => d.date === "2026-06-25").shareBasis).toBe("post");
  });

  it("קלט פגום לא מפיל: null/undefined/רשומות חסרות", () => {
    const r = reconcileDividends(
      [null, {}, srv("2026-06-25", 0.1883)],
      null,
      undefined,
    );
    expect(r.merged).toHaveLength(1);
  });
});

describe("isMatch — התאמה גמישה", () => {
  it("תאריך זהה תמיד תואם, גם בסכום שונה", () => {
    expect(isMatch("2026-06-25", 0.1883, "2026-06-25", 0.5)).toBe(true);
  });
  it("תאריך קרוב (≤2 ימים) תואם רק עם אותו סכום", () => {
    expect(isMatch("2026-06-25", 0.1883, "2026-06-24", 0.1883)).toBe(true);
    expect(isMatch("2026-06-25", 0.1883, "2026-06-24", 0.2)).toBe(false);
  });
  it("מעבר ל-2 ימים לא תואם", () => {
    expect(isMatch("2026-06-25", 0.1883, "2026-06-21", 0.1883)).toBe(false);
  });
});
