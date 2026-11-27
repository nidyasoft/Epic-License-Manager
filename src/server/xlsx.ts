import JSZip from 'jszip';

function xmlEsc(val: string): string {
  return val
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function colLetter(indexZeroBased: number): string {
  let n = indexZeroBased;
  let col = '';
  while (n >= 0) {
    col = String.fromCharCode((n % 26) + 65) + col;
    n = Math.floor(n / 26) - 1;
  }
  return col;
}

/**
 * Generates a genuine OOXML .xlsx spreadsheet buffer using JSZip.
 * Supports full UTF-8 Persian text, RTL sheet view, styled header row, and clean column widths.
 */
export async function buildTrueXlsxBuffer(
  headers: string[],
  rows: string[][],
  rtl = true,
  sheetName = 'EpicLicenses'
): Promise<Buffer> {
  const zip = new JSZip();

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${xmlEsc(sheetName)}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="Tahoma"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Tahoma"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0F4C81"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFE2E8F0"/></left>
      <right style="thin"><color rgb="FFE2E8F0"/></right>
      <top style="thin"><color rgb="FFE2E8F0"/></top>
      <bottom style="thin"><color rgb="FFE2E8F0"/></bottom>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="${rtl ? 'right' : 'left'}" vertical="center"/></xf>
  </cellXfs>
</styleSheet>`;

  const allRows = [headers, ...rows];
  const colsXml = headers
    .map((h, idx) => {
      const maxLen = Math.min(44, Math.max(14, h.length + 6));
      return `<col min="${idx + 1}" max="${idx + 1}" width="${maxLen}" customWidth="1"/>`;
    })
    .join('');

  const sheetRowsXml = allRows
    .map((row, rIdx) => {
      const rowNum = rIdx + 1;
      const styleId = rIdx === 0 ? 1 : 2;
      const cells = row
        .map((val, cIdx) => {
          const ref = `${colLetter(cIdx)}${rowNum}`;
          return `<c r="${ref}" t="inlineStr" s="${styleId}"><is><t xml:space="preserve">${xmlEsc(val ?? '')}</t></is></c>`;
        })
        .join('');
      return `<row r="${rowNum}"${rIdx === 0 ? ' ht="24" customHeight="1"' : ' ht="20" customHeight="1"'}>${cells}</row>`;
    })
    .join('');

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews>
    <sheetView tabSelected="1" rightToLeft="${rtl ? '1' : '0'}" workbookViewId="0"/>
  </sheetViews>
  <cols>${colsXml}</cols>
  <sheetData>${sheetRowsXml}</sheetData>
</worksheet>`;

  zip.file('[Content_Types].xml', contentTypes);
  zip.file('_rels/.rels', rootRels);
  zip.file('xl/_rels/workbook.xml.rels', workbookRels);
  zip.file('xl/workbook.xml', workbookXml);
  zip.file('xl/styles.xml', stylesXml);
  zip.file('xl/worksheets/sheet1.xml', sheetXml);

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/**
 * Generates Excel-friendly CSV with UTF-8 BOM + semicolon separator so Microsoft Excel in Persian/Windows locales separates columns cleanly.
 */
export function buildPersianCsv(headers: string[], rows: string[][]): string {
  const esc = (v: string) => `"${(v ?? '').replace(/"/g, '""')}"`;
  const lines = [headers, ...rows].map((row) => row.map(esc).join(';'));
  return '\uFEFFsep=;\r\n' + lines.join('\r\n');
}
