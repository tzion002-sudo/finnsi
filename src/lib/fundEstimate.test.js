import { describe, it, expect } from "vitest";
import { estimateBalance, isGemelnetEligible, GEMELNET_ELIGIBLE_TRACKS } from "./fundEstimate.js";

describe("estimateBalance", () => {
  it("מרכיב תשואות חודשיות שאחרי reportDate בלבד", () => {
    const asset = { reportBalance: 1000, reportDate: "2026-03-31" };
    const doc = { monthly: [
      { ym: "2026-01", pct: 5 },  // לפני הדוח — לא נכלל
      { ym: "2026-04", pct: 10 }, // 1000*1.10 = 1100
      { ym: "2026-05", pct: -5 }, // 1100*0.95 = 1045
    ]};
    const r = estimateBalance(asset, doc);
    expect(r.monthsApplied).toBe(2);
    expect(r.estimatedBalance).toBeCloseTo(1045, 2);
    expect(r.throughYm).toBe("2026-05");
  });

  it("מחזיר null כשאין תשואות רלוונטיות אחרי הדוח", () => {
    const asset = { reportBalance: 1000, reportDate: "2026-06-30" };
    const doc = { monthly: [{ ym: "2026-01", pct: 5 }] };
    expect(estimateBalance(asset, doc)).toBeNull();
  });

  it("מחזיר null בלי reportBalance/reportDate", () => {
    expect(estimateBalance({ reportDate: "2026-01-01" }, { monthly: [{ ym: "2026-02", pct: 1 }] })).toBeNull();
    expect(estimateBalance({ reportBalance: 1000 }, { monthly: [{ ym: "2026-02", pct: 1 }] })).toBeNull();
  });

  it("מחזיר null בלי מסמך תשואות", () => {
    expect(estimateBalance({ reportBalance: 1000, reportDate: "2026-01-01" }, null)).toBeNull();
    expect(estimateBalance({ reportBalance: 1000, reportDate: "2026-01-01" }, { monthly: [] })).toBeNull();
  });

  it("מתעלם מרשומות עם pct לא תקין (null/NaN)", () => {
    const asset = { reportBalance: 1000, reportDate: "2026-01-31" };
    const doc = { monthly: [{ ym: "2026-02", pct: null }, { ym: "2026-03", pct: 10 }] };
    const r = estimateBalance(asset, doc);
    expect(r.monthsApplied).toBe(1);
    expect(r.estimatedBalance).toBeCloseTo(1100, 2);
  });
});

describe("isGemelnetEligible", () => {
  it("מאשר רק trackCodes מאומתים", () => {
    expect(isGemelnetEligible({ trackCode: 13245 })).toBe(true);
    expect(isGemelnetEligible({ trackCode: 13887 })).toBe(false); // פנסיה — לא בגמל-נט
    expect(isGemelnetEligible({ trackCode: 5127790 })).toBe(false); // קרן כספית — לא בגמל-נט
    expect(isGemelnetEligible({})).toBe(false);
  });

  it("allowlist תואם בדיוק את 7 המסלולים שאומתו", () => {
    expect(GEMELNET_ELIGIBLE_TRACKS).toHaveLength(7);
  });
});
