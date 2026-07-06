#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
//  HaMatzpan · notify-failure.js — V3.0
//  נשלח ע"י GitHub Actions (if: failure()) כשהסריקה היומית קורסת.
//  משתמש באותם סודות Gmail של דוח הבוקר (GMAIL_APP_PASSWORD, GMAIL_TO).
// ═══════════════════════════════════════════════════════════════

const GMAIL_FROM         = process.env.GMAIL_FROM         || "tzion002@gmail.com";
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || null;
const GMAIL_TO           = process.env.GMAIL_TO           || null;
const RUN_URL            = process.env.RUN_URL            || "";

async function main() {
  if (!GMAIL_APP_PASSWORD || !GMAIL_TO) {
    console.log("⏭ Gmail: סודות לא מוגדרים — לא ניתן לשלוח התרעת כשל");
    process.exit(0);
  }
  const nodemailer = (await import("nodemailer")).default;
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_FROM, pass: GMAIL_APP_PASSWORD },
  });

  const dateStr = new Date().toLocaleDateString("he-IL", {
    timeZone: "Asia/Jerusalem", weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  const timeStr = new Date().toLocaleTimeString("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" });

  const html = `<!DOCTYPE html><html dir="rtl" lang="he"><body style="font-family:Arial,sans-serif;background:#fef2f2;padding:20px">
  <div style="max-width:560px;margin:auto;background:#fff;border:2px solid #dc2626;border-radius:12px;padding:24px">
    <h2 style="color:#dc2626;margin-top:0">🚨 המצפן — הסריקה היומית נכשלה</h2>
    <p>הסריקה של <b>${dateStr}</b> (${timeStr}) קרסה ב-GitHub Actions ולא כתבה נתונים ל-Firestore.</p>
    <p>המשמעות: מחירים ודיבידנדים <b>לא עודכנו היום</b>. הדשבורד יציג נתוני יום קודם.</p>
    ${RUN_URL ? `<p><a href="${RUN_URL}" style="color:#2563eb">📋 צפה בלוג הריצה שנכשלה</a></p>` : ""}
    <p style="color:#6b7280;font-size:13px">אם זה קורה יומיים ברצף — בדוק את הלוג או הרץ ידנית: node scripts/daily-scanner.js</p>
    <div style="color:#9ca3af;font-size:12px;margin-top:16px">המצפן V3.0 · התרעת כשל אוטומטית · GitHub Actions</div>
  </div></body></html>`;

  await transporter.sendMail({
    from:    `"🚨 המצפן" <${GMAIL_FROM}>`,
    to:      GMAIL_TO,
    subject: `🚨 המצפן — הסריקה היומית נכשלה (${dateStr})`,
    html,
  });
  console.log(`✅ התרעת כשל נשלחה אל ${GMAIL_TO}`);
}

main().catch(e => { console.error("שליחת התרעת הכשל נכשלה:", e.message); process.exit(0); });
