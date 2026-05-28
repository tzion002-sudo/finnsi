import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';

function hebrewRx(str) {
  const chars = [...str].filter(c => !/\s/.test(c));
  return new RegExp(chars.map(c => c.replace(/[.+?^${}()|[\]\\]/g, String.raw`\$&`)).join('\\s*'));
}

function normalizeReversedPercentages(text) {
  return text.replace(
    /%\s+((?:\d\s*){1,3})\.\s*((?:\d\s*){1,3})(?=\s|$)/g,
    (match, decPartRaw, wholePartRaw) => {
      const dec   = decPartRaw.replace(/\s+/g, '').split('').reverse().join('');
      const whole = wholePartRaw.replace(/\s+/g, '').split('').reverse().join('');
      if (!whole || !dec) return match;
      return `${whole}.${dec}%`;
    }
  );
}

async function testPDF(path, label) {
  const data = fs.readFileSync(path);
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(data) }).promise;
  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    fullText += content.items.map(item => item.str).join(' ') + '\n';
  }
  fullText = normalizeReversedPercentages(fullText);

  const fundType =
    hebrewRx('קרן הפנסיה').test(fullText)     ? 'pension' :
    hebrewRx('קרן ההשתלמות').test(fullText)   ? 'study_fund' :
    hebrewRx('קרן השתלמות').test(fullText)    ? 'study_fund' :
    hebrewRx('קופת ההשתלמות').test(fullText)  ? 'study_fund' :
    hebrewRx('קופת השתלמות').test(fullText)   ? 'study_fund' :
    hebrewRx('קופת הגמל').test(fullText)      ? 'gemel' :
    hebrewRx('קופת גמל').test(fullText)       ? 'gemel' : 'unknown';

  const meitavEndRx  = new RegExp('([0-9]{1,3}(?:,[0-9]{3})*)\\s+' + hebrewRx('יתרת הכספים בחשבון ל').source);
  const pensionEndRx = new RegExp('([0-9]{1,3}(?:,[0-9]{3})*)\\s+' + hebrewRx('יתרת הכספים בקרן לתאריך').source);

  const returnRxClalHasht = new RegExp('(-?[0-9]+\\.[0-9]+)%\\s+' + hebrewRx('כלל השתלמות').source);
  const returnRxMenora    = new RegExp('(-?[0-9]+\\.[0-9]+)%\\s+' + hebrewRx('מסלול עוקב מדד').source);
  const returnRxMeitav    = /[0-9.]+%\s+(-?[0-9]+\.[0-9]+)%\s+(?:[^\n]*?)S&P/i;

  const balance = fullText.match(pensionEndRx)?.[1] ?? fullText.match(meitavEndRx)?.[1] ?? 'NOT FOUND';
  const ytd =
    fullText.match(returnRxMenora)?.[1] ??
    fullText.match(returnRxClalHasht)?.[1] ??
    fullText.match(returnRxMeitav)?.[1] ?? 'NOT FOUND';

  console.log(`\n=== ${label} ===`);
  console.log('Fund type:', fundType);
  console.log('Balance:  ', balance);
  console.log('YTD:      ', ytd);
}

await testPDF('C:/Users/tzion/Desktop/חסכונות משפחת לוי/פנסיה ציון.pdf',   'פנסיה ציון (מנורה)');
await testPDF('C:/Users/tzion/Desktop/חסכונות משפחת לוי/March 0.pdf',      'March 0 (מיטב השתלמות)');
await testPDF('C:/Users/tzion/Desktop/חסכונות משפחת לוי/March 0 (1).pdf',  'March 0 (1) (מיטב גמל)');
await testPDF('C:/Users/tzion/Desktop/Report_01_2026.pdf',                  'Report_01_2026 (כלל השתלמות זיו)');
