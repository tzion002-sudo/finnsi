import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';

function hebrewRx(str) {
  const chars = [...str].filter(c => !/\s/.test(c));
  // Escape special regex chars
  const escaped = chars.map(c => {
    return c.replace(/[.+?^${}()|[\]\\]/g, String.raw`\$&`);
  });
  return new RegExp(escaped.join('\\s*'));
}

const data = fs.readFileSync('C:/Users/tzion/Desktop/חסכונות משפחת לוי/פנסיה ציון.pdf');
const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(data) }).promise;
let fullText = '';
for (let i = 1; i <= pdf.numPages; i++) {
  const page = await pdf.getPage(i);
  const content = await page.getTextContent();
  fullText += content.items.map(item => item.str).join(' ') + '\n';
}

const dateRx = '([0-9]{2}[/.][0-9]{2}[/.][0-9]{4})';

const endBalRx   = new RegExp('([0-9]{1,3}(?:,[0-9]{3})*)\\s+' + hebrewRx('יתרת הכספים בקרן לתאריך').source);
const startBalRx = new RegExp('([0-9]{1,3}(?:,[0-9]{3})*)\\s+' + hebrewRx('יתרת הכספים בקרן בתחילת').source);
const feeDepRx   = new RegExp('([0-9]+\\.?[0-9]*)%\\s+'        + hebrewRx('דמי ניהול מהפקדה').source);
const feeSavRx   = new RegExp('([0-9]+\\.?[0-9]*)%\\s+'        + hebrewRx('דמי ניהול מחיסכון').source);
const retRx      = new RegExp('(-?[0-9]+\\.[0-9]+)%\\s+'       + hebrewRx('מסלול עוקב מדד').source);
const datePatRx  = new RegExp(hebrewRx('תאריך תקופת הדוח').source + '[:\\s]+' + dateRx);
const instRx     = hebrewRx('מנורה מבטחים');
const ownerRx    = hebrewRx('ציון לוי');

console.log('Institution מנורה:',  instRx.test(fullText));
console.log('Owner ציון לוי:',     ownerRx.test(fullText));
console.log('Date:',               fullText.match(datePatRx)?.[1]  ?? 'NOT FOUND');
console.log('End balance:',        fullText.match(endBalRx)?.[1]   ?? 'NOT FOUND');
console.log('Start balance:',      fullText.match(startBalRx)?.[1] ?? 'NOT FOUND');
console.log('Fee deposit %:',      fullText.match(feeDepRx)?.[1]   ?? 'NOT FOUND');
console.log('Fee savings %:',      fullText.match(feeSavRx)?.[1]   ?? 'NOT FOUND');
console.log('Return %:',           fullText.match(retRx)?.[1]      ?? 'NOT FOUND');
