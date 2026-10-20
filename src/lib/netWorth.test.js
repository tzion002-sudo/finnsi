import { describe, it, expect } from "vitest";
import { estimateBalance } from "./fundEstimate.js";
import { assetValue, loanBalance, computeTotals } from "./netWorth.js";

// תשואות רשמיות מסלול 456 (data.gov.il, נשלף 20.10.2026)
const RET_456 = { monthly: [
  { ym: "2026-04", pct: 4.26 }, { ym: "2026-05", pct: 2.38 }, { ym: "2026-06", pct: -0.57 },
]};
const ZIV_7B = { id: "7b", trackCode: 456, reportBalance: 161420, reportDate: "2026-04-17",
  employeeDeposit: 355, employerDeposit: 1065, severanceDeposit: 0, feeFromDeposit: 0.01, feeFromBalance: 0.68 };

describe("estimateBalance — הפקדות, דמי ניהול, חודש חלקי", () => {
  it("חודש הדוח נכלל יחסית לימים שנותרו", () => {
    const r = estimateBalance({ reportBalance: 1000, reportDate: "2026-04-15" }, { monthly: [{ ym: "2026-04", pct: 10 }] });
    expect(r.monthsApplied).toBe(1);
    expect(r.estimatedBalance).toBeCloseTo(1000 * Math.pow(1.1, 15 / 30), 2);
  });

  it("מוסיף הפקדה חודשית נטו ומנכה דמי ניהול מצבירה", () => {
    const asset = { reportBalance: 1200, reportDate: "2026-03-31", employeeDeposit: 100, feeFromDeposit: 1, feeFromBalance: 12 };
    const r = estimateBalance(asset, { monthly: [{ ym: "2026-04", pct: 0 }] });
    expect(r.estimatedBalance).toBeCloseTo(1200 * 0.99 + 99, 2); // 1% דמי ניהול חודשי + 99 הפקדה נטו
  });

  it("מבחן-אמת: זיו 7b מול דוח כלל 30.06.2026 (168,266 ₪) — סטייה עד 2%", () => {
    const r = estimateBalance(ZIV_7B, RET_456);
    const deviation = (r.estimatedBalance - 168266) / 168266;
    console.log(`  7b: אומדן ${r.estimatedBalance} מול דוח 168266 → סטייה ${(deviation * 100).toFixed(2)}%`);
    expect(Math.abs(deviation)).toBeLessThan(0.02);
  });
});

describe("assetValue", () => {
  it("MSTY לפי שווי שוק", () => {
    expect(assetValue({ isMSTY: true, sharesCount: 118 }, { mstyPrice: 10, fx: 3 })).toEqual({ value: 3540, kind: "market", asOf: null });
  });
  it("קופה מאושרת עם תשואות → אומדן", () => {
    const v = assetValue(ZIV_7B, { fundReturnsByTrack: { 456: RET_456 } });
    expect(v.kind).toBe("estimate");
    expect(v.asOf).toBe("2026-06");
  });
  it("בלי תשואות / לא ב-allowlist → יתרת הדוח", () => {
    expect(assetValue(ZIV_7B, {}).kind).toBe("official");
    expect(assetValue({ trackCode: 5127790, reportBalance: 85351, reportDate: "2026-04-17" }).value).toBe(85351);
  });
});

describe("loanBalance (שפיצר)", () => {
  it("ערך נוכחי של התשלומים שנותרו", () => {
    // 12 תשלומים של 1000 בריבית 0 → 12,000
    expect(loanBalance({ monthlyPayment: 1000, interestRate: 0, endDate: "2027-10-01" }, "2026-10-01")).toBe(12000);
    // ריבית 6% → פחות מ-12,000
    expect(loanBalance({ monthlyPayment: 1000, interestRate: 6, endDate: "2027-10-01" }, "2026-10-01")).toBe(11619);
  });
  it("הלוואת בלון (תשלום ≈ ריבית בלבד) → null", () => {
    // 84,828 ₪ ב-5%: ריבית חודשית ≈ 353 ₪ — תשלום 360 הוא ריבית בלבד (נתון אמיתי מהמערכת)
    expect(loanBalance({ monthlyPayment: 360, interestRate: 5, currentBalance: 84828, endDate: "2030-01-01" }, "2026-10-01")).toBeNull();
  });
  it("null כשחסרים נתונים", () => {
    expect(loanBalance({ endDate: "2030-01-01" })).toBeNull();
    expect(loanBalance({ monthlyPayment: 100 })).toBeNull();
  });
});

describe("computeTotals", () => {
  it("סוכם אומדן, שוק ויתרה רשמית; שווי נטו פחות הלוואות", () => {
    const assets = [
      { ...ZIV_7B, owner: "זיו", category: "study_fund" },
      { isMSTY: true, sharesCount: 100, owner: "ציון", category: "dividend", reportBalance: 0 },
      { reportBalance: 500, owner: "ליאם", category: "children" },
    ];
    const t = computeTotals(assets, [{ currentBalance: 1000 }], { mstyPrice: 10, fx: 3, fundReturnsByTrack: { 456: RET_456 } });
    const est = estimateBalance(ZIV_7B, RET_456).estimatedBalance;
    expect(t.total).toBeCloseTo(est + 3000 + 500, 2);
    expect(t.officialTotal).toBeCloseTo(161420 + 3000 + 500, 2);
    expect(t.estimatedCount).toBe(1);
    expect(t.oldestYm).toBe("2026-06");
    expect(t.netWorth).toBeCloseTo(t.total - 1000, 2);
    expect(t.byOwner["זיו"]).toBeCloseTo(est, 2);
  });
});
