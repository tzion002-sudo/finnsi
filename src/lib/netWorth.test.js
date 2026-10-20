import { describe, it, expect } from "vitest";
import { estimateBalance } from "./fundEstimate.js";
import { assetValue, loanBalance, computeTotals, fundPriceValue, rateOn, estimateDeviation, upsertDailySnapshot, findJumps } from "./netWorth.js";

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

describe("fundPriceValue (קרן כספית)", () => {
  const mmf = { trackCode: 5127790, reportBalance: 85351, reportDate: "2026-04-17" };
  it("יתרה × מחיר היום / מחיר ביום הדוח (נתוני מאיה אמיתיים)", () => {
    const fp = { price: 11.9002, priceAtReport: 11.6935, reportDate: "2026-04-17", asOf: "2026-10-19" };
    const v = assetValue(mmf, { fundPrices: { 5127790: fp } });
    expect(v.kind).toBe("market");
    expect(v.value).toBeCloseTo(85351 * 11.9002 / 11.6935, 1); // ≈ 86,860
    expect(v.asOf).toBe("2026-10-19");
  });
  it("עוגן של דוח אחר / חסר → null (חוזר ליתרת הדוח)", () => {
    expect(fundPriceValue(mmf, { price: 12, priceAtReport: 11, reportDate: "2026-01-01" })).toBeNull();
    expect(fundPriceValue(mmf, { price: 12, priceAtReport: null, reportDate: "2026-04-17" })).toBeNull();
    expect(assetValue(mmf, {}).kind).toBe("official");
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

describe("rateOn (שער יציג לפי תאריך)", () => {
  const fx = { "2026-10-01": 3.08, "2026-10-02": 3.06, "2026-10-05": 3.059 };
  it("יום מדויק / סופ\"ש → יום המסחר הקודם / לפני ההיסטוריה → null", () => {
    expect(rateOn(fx, "2026-10-02")).toBe(3.06);
    expect(rateOn(fx, "2026-10-04")).toBe(3.06);
    expect(rateOn(fx, "2026-09-01")).toBeNull();
    expect(rateOn(null, "2026-10-02")).toBeNull();
  });
});

describe("estimateDeviation (כיול מול דוח חדש)", () => {
  it("7b: אומדן מול דוח כלל 30.06.2026 → סטייה ~1.35%", () => {
    const dev = estimateDeviation(ZIV_7B, RET_456, 168266, "2026-06-30");
    expect(dev.pct).toBeCloseTo(1.35, 1);
    expect(dev.actual).toBe(168266);
  });
  it("דוח באמצע חודש: משווה עד סוף החודש הקודם", () => {
    const dev = estimateDeviation(ZIV_7B, RET_456, 168000, "2026-06-15");
    expect(dev).not.toBeNull(); // תשואות עד מאי קיימות
  });
  it("null כשאין תשואות עד חודש הדוח / דוח ישן יותר", () => {
    expect(estimateDeviation(ZIV_7B, RET_456, 170000, "2026-09-30")).toBeNull();
    expect(estimateDeviation(ZIV_7B, RET_456, 160000, "2026-03-31")).toBeNull();
  });
});

describe("צילום שווי נטו יומי", () => {
  it("מוסיף יום חדש, מעדכן את אותו יום, מתעלם משינוי זניח", () => {
    const h1 = upsertDailySnapshot([], { date: "2026-10-19", netWorth: 1000 });
    expect(h1).toHaveLength(1);
    const h2 = upsertDailySnapshot(h1, { date: "2026-10-20", netWorth: 1010 });
    expect(h2).toHaveLength(2);
    expect(upsertDailySnapshot(h2, { date: "2026-10-20", netWorth: 1010.4 })).toBeNull();
    expect(upsertDailySnapshot(h2, { date: "2026-10-20", netWorth: 1050 }).at(-1).netWorth).toBe(1050);
    expect(upsertDailySnapshot(h2, { date: "2026-10-21", netWorth: 1 }, 2)).toHaveLength(2);
  });
  it("findJumps מסמן קפיצה מעל 5%", () => {
    const j = findJumps([{ date: "a", netWorth: 1000 }, { date: "b", netWorth: 1030 }, { date: "c", netWorth: 1200 }]);
    expect(j).toEqual([{ date: "c", from: 1030, to: 1200, pct: 16.5 }]);
  });
});
