import { PDFParse } from 'pdf-parse';

export function generateValidTestPdf(): Buffer {
  const lines = [
    'KEMENTERIAN KETENAGAKERJAAN REPUBLIK INDONESIA',
    'Nomor: B-205/MENKO/PMK/IX/2026',
    'Tanggal: 8 September 2026',
    'Hal: Undangan Rapat Koordinasi Revitalisasi Balai Pelatihan Vokasi',
    'Instansi: Kemenko Bidang PMK',
    'Acara: Rapat Koordinasi Revitalisasi BLK Nasional',
    'PIC: Bpk. Bambang Sutrisno (0812-9988-7766)',
  ];

  let stream = 'BT\n/F1 12 Tf\n50 720 Td\n';
  lines.forEach((line, idx) => {
    if (idx === 0) {
      stream += `(${line}) Tj\n`;
    } else {
      stream += `0 -25 Td\n(${line}) Tj\n`;
    }
  });
  stream += 'ET';

  const pdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
5 0 obj
<< /Length ${Buffer.byteLength(stream)} >>
stream
${stream}
endstream
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000235 00000 n 
0000000305 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
500
%%EOF`;

  return Buffer.from(pdf, 'utf-8');
}

async function test() {
  const buf = generateValidTestPdf();
  const parser = new PDFParse({ data: buf });
  await (parser as any).load();
  const result = await parser.getText();
  console.log('HASIL EKSTRAKSI TEXT DARI VALID PDF:\n');
  console.log(result.text);

  const { aiService } = await import('../services/aiService');
  const extracted = await aiService.extractSuratData(result.text, 'contoh_undangan_resmi.pdf');
  console.log('\nHASIL EKSTRAKSI SURAT:');
  console.log(JSON.stringify(extracted, null, 2));

  const perihal = await aiService.generatePerihalRecommendation({
    subject: extracted.subject,
    asalSurat: extracted.asalSurat,
    event: extracted.event,
    fullText: result.text,
  });
  console.log('\nREKOMENDASI PERIHAL:');
  console.log(perihal);
}

if (require.main === module) {
  test().catch(console.error);
}
