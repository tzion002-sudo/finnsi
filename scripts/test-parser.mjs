import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';

function hebrewRx(str) {
  const chars = [...str].filter(c => !/\s/.test(c));
  return new RegExp(chars.map(c => c.replace(/[.+?^${}()|[\]\\]/g, String.raw`\$&`)).join('\\s*'));
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

  const fundType = hebrewRx('קופת ההשתלמות').test(fullText) ? 'study_fund' :
                   hebrewRx('קרן הפנסיה').test(fullText) ? 'pension' : 'unknown';

  const returnRx = /[0-9.]+%\s+(-?[0-9]+\.[0-9]+)%\s+(?:[^\n]*?)S&P/i;
  const returnRx2 = new RegExp('(-?[0-9]+\\.[0-9]+)%\\s+' + hebrewRx('מסלול עוקב מדד').source);

  console.log(`\n=== ${label} ===`);
  console.log('Fund type:', fundType);
  console.log('Return (מיטב format):', fullText.match(returnRx)?.[1] ?? 'NOT FOUND');
  console.log('Return (מנורה format):', fullText.match(returnRx2)?.[1] ?? 'NOT FOUND');
}

await testPDF('C:/Users/tzion/Desktop/חסכונות משפחת לוי/March 0.pdf', 'March 0 (מיטב)');
await testPDF('C:/Users/tzion/Desktop/חסכונות משפחת לוי/פנסיה ציון.pdf', 'פנסיה ציון (מנורה)');
