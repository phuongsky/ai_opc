import {
  parseFileBuffer,
  sanitizeExtractedText,
  isLegitimateText,
} from '../modules/memory/serverFileParser';

async function runTests() {
  console.log('=== TEST SERVER FILE PARSER & SANITIZATION ===');

  // 1. Test Garbage & Replacement Character Sanitization
  const corruptedSample = '\uFFFD\uFFFD\uFFFD.4\uFFFD 9\uFFFD\uFFFD rtvu\uFFFDtxy\uFFFDzzzz :>A>\uFFFD}>+T:Ai }\uFFFDAt\uFFFD}\uFFDAw wrN\uFFFD>\uFFFDsrrN\uFFFD>';
  console.log('1. Checking corrupted binary string legitimacy:');
  const isLegit = isLegitimateText(corruptedSample);
  console.log('   Is legitimate text?', isLegit);
  if (isLegit) {
    throw new Error('Corrupted binary junk was falsely recognized as legitimate text!');
  }

  // 2. Test PDF Buffer Parsing
  const minimalPdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>
endobj
4 0 obj
<< /Length 58 >>
stream
BT
/F1 12 Tf
100 700 Td
(Bang gia dich vu AI-OPC 2026 - Goi Enterprise) Tj
ET
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000280 00000 n 
trailer
<< /Size 5 /Root 1 0 R >>
startxref
388
%%EOF`;

  const pdfResult = await parseFileBuffer('bang_gia_dich_vu_2026.pdf', Buffer.from(minimalPdf, 'utf-8'));
  console.log('2. PDF parsing result:');
  console.log('   Title:', pdfResult.title);
  console.log('   Content:', JSON.stringify(pdfResult.content));
  console.log('   File type:', pdfResult.fileType);
  if (!pdfResult.content.includes('Bang gia dich vu AI-OPC 2026')) {
    throw new Error('PDF parser failed to extract expected text!');
  }

  // 3. Test CSV Parsing
  const csvBuffer = Buffer.from('Dich vu,Gia,Ghi chu\nTu van AI,10000000,10 gio/thang\nTrien khai,30000000,Tron goi', 'utf-8');
  const csvResult = await parseFileBuffer('bang_gia_csv.csv', csvBuffer);
  console.log('3. CSV parsing result:\n', csvResult.content);
  if (!csvResult.content.includes('| Dich vu | Gia | Ghi chu |')) {
    throw new Error('CSV parsing failed to produce valid markdown table');
  }

  // 4. Test Text Sanitization
  const rawWithJunk = 'Xin chào các Founder!\uFFFD\u0000\x07 Đây là hướng dẫn vận hành công ty.\n\n-- 1 of 1 --\n\nNội dung chính xác.';
  const cleaned = sanitizeExtractedText(rawWithJunk);
  console.log('4. Sanitized text preview:\n', cleaned);
  if (cleaned.includes('\uFFFD') || cleaned.includes('\u0000') || cleaned.includes('-- 1 of 1 --')) {
    throw new Error('Sanitization failed to remove junk artifacts!');
  }

  console.log('=== ALL SERVER PARSER & SANITIZATION TESTS PASSED 100% ===');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
