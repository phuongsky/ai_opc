import {
  parseCsvToMarkdown,
  parseJsonToMarkdown,
  formatTitleFromFilename,
  formatFileSize,
} from '@ai-opc/shared';

console.log('=== TEST FILE PARSER SUITE ===');

// 1. Title formatting
const t1 = formatTitleFromFilename('bang_gia_dich_vu_marketing_2026.docx');
console.log('1. Title formatting:', t1);
if (t1 !== 'Bang Gia Dich Vu Marketing 2026') {
  throw new Error(`Unexpected title format: ${t1}`);
}

// 2. File size formatting
console.log('2. File size 2048 bytes:', formatFileSize(2048));
console.log('   File size 1500000 bytes:', formatFileSize(1500000));

// 3. CSV parsing into Markdown table
const csvData = `Tên gói,Đơn giá tháng,Tính năng chính
Gói Cơ Bản,5.000.000 VND,Phân tích thị trường & báo cáo tuần
Gói Nâng Cao,15.000.000 VND,Toàn bộ tính năng + Tự động hóa chiến dịch
Gói Enterprise,50.000.000 VND,Dedicated AI Agent + SLA 99.9%`;

const mdTable = parseCsvToMarkdown(csvData);
console.log('3. CSV -> Markdown Table:\n', mdTable);

if (!mdTable.includes('| Tên gói | Đơn giá tháng | Tính năng chính |')) {
  throw new Error('CSV parser failed to generate valid markdown table header');
}

// 4. JSON parsing into Markdown
const jsonData = JSON.stringify([
  {
    quy_trinh: 'Xử lý hoàn tiền',
    thoi_gian_sla: '24 giờ',
    nguoi_duyet: 'AI-CFO & Founder',
  },
  {
    quy_trinh: 'Triển khai tính năng mới',
    thoi_gian_sla: '48 giờ',
    nguoi_duyet: 'AI-CTO',
  },
]);

const mdJson = parseJsonToMarkdown(jsonData);
console.log('4. JSON -> Markdown:\n', mdJson);

if (!mdJson.includes('Xử lý hoàn tiền') || !mdJson.includes('AI-CFO')) {
  throw new Error('JSON parser failed to extract structured properties');
}

console.log('=== ALL PARSER UNIT TESTS PASSED 100% ===');
