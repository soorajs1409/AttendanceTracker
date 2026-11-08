const zlib = require('node:zlib');

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Precomputed CRC32 table for creating valid PKZIP (.xlsx) archives.
 */
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Extracts all files from a ZIP buffer (such as an .xlsx file) into a Map<filename, Buffer>.
 */
function unzipBuffer(zipBuf) {
  const files = new Map();

  // Locate End of Central Directory (EOCD) signature 0x06054b50
  let eocdOffset = -1;
  const minEocdSearch = Math.max(0, zipBuf.length - 65557);
  for (let i = zipBuf.length - 22; i >= minEocdSearch; i -= 1) {
    if (zipBuf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error('Invalid ZIP/XLSX archive: Central directory not found');
  }

  const totalEntries = zipBuf.readUInt16LE(eocdOffset + 10);
  const cdOffset = zipBuf.readUInt32LE(eocdOffset + 16);

  let ptr = cdOffset;
  for (let idx = 0; idx < totalEntries && ptr < zipBuf.length; idx += 1) {
    const sig = zipBuf.readUInt32LE(ptr);
    if (sig !== 0x02014b50) break;

    const compressionMethod = zipBuf.readUInt16LE(ptr + 10);
    const compressedSize = zipBuf.readUInt32LE(ptr + 20);
    const fileNameLen = zipBuf.readUInt16LE(ptr + 28);
    const extraLen = zipBuf.readUInt16LE(ptr + 30);
    const commentLen = zipBuf.readUInt16LE(ptr + 32);
    const localHeaderOffset = zipBuf.readUInt32LE(ptr + 42);

    const fileName = zipBuf
      .subarray(ptr + 46, ptr + 46 + fileNameLen)
      .toString('utf8');

    ptr += 46 + fileNameLen + extraLen + commentLen;

    if (fileName.endsWith('/')) continue;

    if (
      localHeaderOffset + 30 > zipBuf.length ||
      zipBuf.readUInt32LE(localHeaderOffset) !== 0x04034b50
    ) {
      continue;
    }

    const localNameLen = zipBuf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = zipBuf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const compressedSlice = zipBuf.subarray(
      dataStart,
      dataStart + compressedSize
    );

    if (compressionMethod === 0) {
      files.set(fileName, Buffer.from(compressedSlice));
    } else if (compressionMethod === 8) {
      files.set(fileName, zlib.inflateRawSync(compressedSlice));
    }
  }

  return files;
}

/**
 * Packs a Map or Array of { name, data: Buffer | string } into a valid ZIP Buffer (.xlsx).
 */
function createZipBuffer(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const rawBuf = Buffer.isBuffer(entry.data)
      ? entry.data
      : Buffer.from(String(entry.data), 'utf8');
    const compressed = zlib.deflateRawSync(rawBuf);
    const crc = crc32(rawBuf);

    // Local file header (30 bytes + filename)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version needed (2.0)
    localHeader.writeUInt16LE(0, 6); // general purpose bit flag
    localHeader.writeUInt16LE(8, 8); // compression method: deflate
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0x21, 12); // mod date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(rawBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra field length

    localParts.push(localHeader, nameBuf, compressed);

    // Central directory header (46 bytes + filename)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0, 8); // flags
    centralHeader.writeUInt16LE(8, 10); // compression method: deflate
    centralHeader.writeUInt16LE(0, 12); // mod time
    centralHeader.writeUInt16LE(0x21, 14); // mod date
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(rawBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(0, 38); // external attrs
    centralHeader.writeUInt32LE(offset, 42); // local header offset

    centralParts.push(centralHeader, nameBuf);
    offset += 30 + nameBuf.length + compressed.length;
  }

  const centralDirBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirBuf, eocd]);
}

function decodeXmlEntities(str) {
  if (!str) return '';
  return String(str)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function escapeXml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Converts Excel column letters ('A', 'B', ..., 'Z', 'AA') to 0-based index.
 */
function colLettersToIndex(letters) {
  let col = 0;
  for (let i = 0; i < letters.length; i += 1) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  return col - 1;
}

/**
 * Converts 0-based column index to Excel column letters ('A', 'B', ..., 'AA').
 */
function indexToColLetters(index) {
  let n = index + 1;
  let str = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    str = String.fromCharCode(65 + rem) + str;
    n = Math.floor((n - 1) / 26);
  }
  return str;
}

/**
 * Converts an Excel serial date number (e.g. 46023) to 'YYYY-MM-DD'.
 */
function excelSerialToDateStr(serial) {
  const days = Math.floor(serial);
  // Excel's 1900 leap-year bug epoch: Dec 30, 1899 UTC
  const utcMs = Date.UTC(1899, 11, 30) + days * 86400000;
  const d = new Date(utcMs);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Converts an Excel fractional day (0 <= frac < 1) to 'HH:MM:SS'.
 */
function excelFractionToTimeStr(val) {
  const frac = val - Math.floor(val);
  const totalSeconds = Math.round(frac * 86400);
  const hours = Math.floor(totalSeconds / 3600) % 24;
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Parses an .xlsx ZIP archive into an array of { name, rows: string[][] }.
 */
function parseXlsxBuffer(buf) {
  const files = unzipBuffer(buf);

  // 1. Shared Strings
  const sharedStrings = [];
  const ssXml = files.get('xl/sharedStrings.xml')?.toString('utf8') || '';
  if (ssXml) {
    const siMatches = ssXml.match(/<si\b[^>]*?(?:\/>|>[\s\S]*?<\/si>)/g) || [];
    for (const si of siMatches) {
      const tMatches = si.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g) || [];
      const text = tMatches
        .map((t) => decodeXmlEntities(t.replace(/<[^>]+>/g, '')))
        .join('');
      sharedStrings.push(text);
    }
  }

  // 2. Styles (identify date & time style indices)
  const customNumFmts = new Map();
  const styleKinds = []; // 'date' | 'time' | 'number'
  const stylesXml = files.get('xl/styles.xml')?.toString('utf8') || '';
  if (stylesXml) {
    const fmtMatches = stylesXml.match(/<numFmt\b[^>]*>/g) || [];
    for (const tag of fmtMatches) {
      const idMatch = tag.match(/\bnumFmtId="(\d+)"/);
      const codeMatch = tag.match(/\bformatCode="([^"]*)"/);
      if (idMatch && codeMatch) {
        customNumFmts.set(
          Number(idMatch[1]),
          decodeXmlEntities(codeMatch[1]).toLowerCase()
        );
      }
    }

    const cellXfsBlock = stylesXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
    if (cellXfsBlock) {
      const xfTags = cellXfsBlock[1].match(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g) || [];
      for (const xf of xfTags) {
        const idMatch = xf.match(/\bnumFmtId="(\d+)"/);
        const fmtId = idMatch ? Number(idMatch[1]) : 0;
        let kind = 'number';
        if (
          (fmtId >= 14 && fmtId <= 17) ||
          fmtId === 22 ||
          (fmtId >= 27 && fmtId <= 36)
        ) {
          kind = 'date';
        } else if (
          (fmtId >= 18 && fmtId <= 21) ||
          (fmtId >= 45 && fmtId <= 47)
        ) {
          kind = 'time';
        } else if (customNumFmts.has(fmtId)) {
          const code = customNumFmts.get(fmtId).replace(/\[[^\]]*\]/g, '');
          if (/[h].*:[m]|[m].*:[s]/.test(code) && !/[y]/.test(code)) {
            kind = 'time';
          } else if (/[y]{2,4}|[d]{1,2}[-/][m]{1,3}|[m]{1,3}[-/][d]{1,2}/.test(code)) {
            kind = 'date';
          }
        }
        styleKinds.push(kind);
      }
    }
  }

  // 3. Workbook sheet list & relationships
  const relMap = new Map();
  const relsXml = files.get('xl/_rels/workbook.xml.rels')?.toString('utf8') || '';
  if (relsXml) {
    const relTags = relsXml.match(/<Relationship\b[^>]*>/g) || [];
    for (const tag of relTags) {
      const idM = tag.match(/\bId="([^"]+)"/);
      const targetM = tag.match(/\bTarget="([^"]+)"/);
      if (idM && targetM) {
        let target = targetM[1].replace(/^\/+/, '');
        if (!target.startsWith('xl/')) {
          target = `xl/${target}`;
        }
        relMap.set(idM[1], target);
      }
    }
  }

  const sheetDefs = [];
  const wbXml = files.get('xl/workbook.xml')?.toString('utf8') || '';
  if (wbXml) {
    const sheetTags = wbXml.match(/<sheet\b[^>]*>/g) || [];
    for (const tag of sheetTags) {
      const nameM = tag.match(/\bname="([^"]+)"/);
      const rIdM = tag.match(/\br:id="([^"]+)"/);
      const name = nameM ? decodeXmlEntities(nameM[1]) : 'Sheet';
      const pathInZip = rIdM ? relMap.get(rIdM[1]) : null;
      if (pathInZip && files.has(pathInZip)) {
        sheetDefs.push({ name, path: pathInZip });
      }
    }
  }

  if (sheetDefs.length === 0) {
    for (const key of files.keys()) {
      if (/^xl\/worksheets\/sheet\d+\.xml$/i.test(key)) {
        sheetDefs.push({ name: key.split('/').pop().replace('.xml', ''), path: key });
      }
    }
  }

  // 4. Parse each worksheet XML into 2D rows
  const sheets = [];
  for (const def of sheetDefs) {
    const xml = files.get(def.path).toString('utf8');
    const rows = [];
    const rowMatches = xml.match(/<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g) || [];

    for (const rowXml of rowMatches) {
      const rowAttrMatch = rowXml.match(/<row\b[^>]*\br="(\d+)"/);
      const rowIndex = rowAttrMatch ? Number(rowAttrMatch[1]) - 1 : rows.length;
      while (rows.length <= rowIndex) {
        rows.push([]);
      }
      const currentRow = rows[rowIndex];

      const cellMatches =
        rowXml.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || [];
      let nextColIdx = 0;

      for (const cellXml of cellMatches) {
        const refMatch = cellXml.match(/\br="([A-Z]+)\d+"/);
        const colIdx = refMatch
          ? colLettersToIndex(refMatch[1])
          : nextColIdx;
        nextColIdx = colIdx + 1;

        while (currentRow.length <= colIdx) {
          currentRow.push('');
        }

        const typeMatch = cellXml.match(/\bt="([^"]+)"/);
        const styleMatch = cellXml.match(/\bs="(\d+)"/);
        const cellType = typeMatch ? typeMatch[1] : 'n';
        const styleIdx = styleMatch ? Number(styleMatch[1]) : -1;
        const styleKind = styleIdx >= 0 ? styleKinds[styleIdx] : 'number';

        let val = '';
        if (cellType === 'inlineStr') {
          const tMatches = cellXml.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g) || [];
          val = tMatches
            .map((t) => decodeXmlEntities(t.replace(/<[^>]+>/g, '')))
            .join('');
        } else {
          const vMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/);
          const rawV = vMatch ? decodeXmlEntities(vMatch[1].trim()) : '';

          if (cellType === 's') {
            const ssIdx = Number(rawV);
            val =
              !Number.isNaN(ssIdx) && sharedStrings[ssIdx] !== undefined
                ? sharedStrings[ssIdx]
                : rawV;
          } else if (cellType === 'str' || cellType === 'd') {
            val = rawV;
          } else if (cellType === 'b') {
            val = rawV === '1' ? 'TRUE' : 'FALSE';
          } else if (rawV !== '') {
            const num = Number(rawV);
            if (!Number.isNaN(num)) {
              if (styleKind === 'date' && num > 20000 && num < 80000) {
                val = excelSerialToDateStr(num) || rawV;
              } else if (styleKind === 'time' && num >= 0 && num < 2) {
                val = excelFractionToTimeStr(num);
              } else {
                val = rawV;
              }
            } else {
              val = rawV;
            }
          }
        }

        currentRow[colIdx] = String(val).trim();
      }
    }

    sheets.push({ name: def.name, rows });
  }

  return sheets;
}

/**
 * Parses CSV or TSV text into a 2D array of strings.
 */
function parseCsvText(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const clean = String(text || '').replace(/^\uFEFF/, '');

  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    const next = clean[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field.trim());
      field = '';
    } else if (ch === '\r' && next === '\n') {
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = '';
      i += 1;
    } else if (ch === '\n' || ch === '\r') {
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    rows.push(row);
  }

  return [{ name: 'Sheet1', rows }];
}

/**
 * Normalizes a cell string or serial number into 'YYYY-MM-DD' if it represents a valid calendar date.
 */
function normalizeDateValue(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // 1. Standard YYYY-MM-DD or YYYY/MM/DD (with optional ISO time suffix)
  const isoMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s].*)?$/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    if (y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // 2. DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmyMatch) {
    let p1 = Number(dmyMatch[1]);
    let p2 = Number(dmyMatch[2]);
    const y = Number(dmyMatch[3]);
    const m = p1 > 12 ? p2 : p2 > 12 ? p1 : p2;
    const d = p1 > 12 ? p1 : p2 > 12 ? p2 : p1;
    if (y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // 3. Raw Excel serial integer (e.g. 45300..48000)
  if (/^\d{5}(?:\.0+)?$/.test(s)) {
    const serial = Number(s);
    if (serial >= 36526 && serial <= 73050) {
      return excelSerialToDateStr(serial);
    }
  }

  return null;
}

/**
 * Normalizes a cell string or Excel fractional serial into 'HH:MM:SS' if it represents a time.
 */
function normalizeTimeValue(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // 1. HH:MM or HH:MM:SS (with optional AM/PM)
  const timeMatch = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?$/i);
  if (timeMatch) {
    let h = Number(timeMatch[1]);
    const m = Number(timeMatch[2]);
    const sec = timeMatch[3] ? Number(timeMatch[3]) : 0;
    const ampm = timeMatch[4] ? timeMatch[4].toUpperCase() : null;
    if (ampm === 'PM' && h < 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59 && sec >= 0 && sec <= 59) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    }
  }

  // 2. Excel fractional time serial (e.g. 0.5 -> 12:00:00, 0.9166667 -> 22:00:00)
  if (/^0\.\d+$/.test(s)) {
    const num = Number(s);
    if (num >= 0 && num < 1) {
      return excelFractionToTimeStr(num);
    }
  }

  return null;
}

function isAffirmativeFlag(raw) {
  if (!raw) return false;
  const s = String(raw).trim().toLowerCase();
  return s === 'yes' || s === 'y' || s === 'true' || s === '1';
}

/**
 * Classifies a Description / Status cell from an attendance sheet into:
 * { status: 'WFO' | 'WFH' | 'LEAVE' | 'HOLIDAY' | null, notes: string | null }
 */
function classifyDescription(raw) {
  if (!raw) return { status: null, notes: null };
  const text = String(raw).trim();
  if (!text) return { status: null, notes: null };

  // WFO patterns: "WFO", "WFO (RGA)", "WFO - ...", "Office"
  if (/^wfo\b/i.test(text) || /^work\s+from\s+office\b/i.test(text)) {
    const extra = text
      .replace(/^wfo(?:\s*\([^)]*\))?\s*[-:]?\s*/i, '')
      .trim();
    return { status: 'WFO', notes: extra || null };
  }

  // WFH patterns: "WFH", "WFH(Remote)", "WFH - ...", "Remote"
  if (/^wfh\b/i.test(text) || /^work\s+from\s+home\b/i.test(text)) {
    const extra = text
      .replace(/^wfh(?:\s*\([^)]*\))?\s*[-:]?\s*/i, '')
      .trim();
    return { status: 'WFH', notes: extra || null };
  }

  // Leave patterns: "Leave", "Leaves", "Sick Leave", "Casual Leave", "PTO"
  if (
    /^leave\b/i.test(text) ||
    /\b(?:sick|casual|paid|annual|personal)\s+leave\b/i.test(text) ||
    /^pto\b/i.test(text)
  ) {
    const extra = text.replace(/^leave\s*[-:]?\s*/i, '').trim();
    return { status: 'LEAVE', notes: extra || null };
  }

  // Public Holiday patterns: "PH", "PH - Worked on...", "Public Holiday", "Holiday"
  if (
    /^ph\b/i.test(text) ||
    /^public\s+holiday\b/i.test(text) ||
    /^holiday\b/i.test(text)
  ) {
    const extra = text
      .replace(/^(?:ph|public\s+holiday|holiday)\s*[-:]?\s*/i, '')
      .trim();
    return { status: 'HOLIDAY', notes: extra || null };
  }

  // Unmarked / note-only placeholder label from exported All Logged Days tab
  if (/^on[\s-]*call\s*\/\s*note$/i.test(text)) {
    return { status: null, notes: null };
  }

  // Any other description (e.g. weekend on-call CR description like "CR implementation - CHG0095532")
  return { status: null, notes: text };
}

/**
 * Dynamically scrapes attendance records, holiday reference tables, and monthly off-dates
 * from any parsed spreadsheet (.xlsx or .csv).
 */
function scrapeAttendanceFromSheets(sheets) {
  const holidaysByExactDate = new Map(); // 'YYYY-MM-DD' -> 'Holiday Name'
  const holidaysByMonthDay = new Map(); // 'MM-DD' -> 'Holiday Name'
  const referenceOffDates = new Set(); // 'YYYY-MM-DD' listed under month columns in top reference block
  const recordsByDate = new Map(); // 'YYYY-MM-DD' -> record object

  // Pass 1: Extract Holiday Reference Catalog & Monthly Off-Dates Grid across all sheets
  for (const sheet of sheets) {
    const rows = sheet.rows || [];

    for (let r = 0; r < rows.length; r += 1) {
      const row = rows[r] || [];
      const lowerCells = row.map((c) => String(c || '').trim().toLowerCase());

      // 1A. Detect "Date | Name" Holiday Reference table header
      for (let c = 0; c < lowerCells.length - 1; c += 1) {
        if (
          lowerCells[c] === 'date' &&
          (lowerCells[c + 1] === 'name' ||
            lowerCells[c + 1] === 'holiday' ||
            lowerCells[c + 1] === 'holiday name' ||
            lowerCells[c + 1] === 'occasion')
        ) {
          for (let subR = r + 1; subR < rows.length; subR += 1) {
            const subRow = rows[subR] || [];
            const dStr = normalizeDateValue(subRow[c]);
            const hName = String(subRow[c + 1] || '').trim();
            if (!dStr || !hName) {
              if (!subRow[c] && !subRow[c + 1]) break;
              continue;
            }
            holidaysByExactDate.set(dStr, hName);
            holidaysByMonthDay.set(dStr.slice(5, 10), hName);
          }
        }
      }

      // 1B. Detect row with month column headers (e.g. "Holidays | January | February | ...")
      const monthCols = [];
      for (let c = 0; c < lowerCells.length; c += 1) {
        if (MONTH_NAMES.includes(lowerCells[c])) {
          monthCols.push(c);
        }
      }
      if (monthCols.length >= 2) {
        for (let subR = r + 1; subR < rows.length; subR += 1) {
          const subRow = rows[subR] || [];
          // Stop if we hit a daily log table header
          const subLower = subRow.map((x) => String(x || '').trim().toLowerCase());
          if (subLower.includes('date') && (subLower.includes('login') || subLower.includes('description'))) {
            break;
          }
          let foundDateInRow = false;
          for (const mCol of monthCols) {
            const dStr = normalizeDateValue(subRow[mCol]);
            if (dStr) {
              referenceOffDates.add(dStr);
              foundDateInRow = true;
            }
          }
          if (!foundDateInRow && subR > r + 2) {
            // Check if row is completely empty
            if (subRow.every((cell) => !String(cell || '').trim())) break;
          }
        }
      }
    }
  }

  // Pass 2: Extract Daily Attendance Log Tables across all sheets
  for (const sheet of sheets) {
    const rows = sheet.rows || [];
    let activeCols = null;

    for (let r = 0; r < rows.length; r += 1) {
      const row = rows[r] || [];
      const lowerCells = row.map((c) => String(c || '').trim().toLowerCase());

      // Check if this row is a table header row
      const dateIdx = lowerCells.findIndex((c) => c === 'date');
      const hasLogColumns =
        dateIdx !== -1 &&
        lowerCells.some((c) =>
          [
            'day',
            'login',
            'check in',
            'check-in',
            'checkin',
            'logout',
            'check out',
            'check-out',
            'description',
            'status',
            'category',
            'nsa',
            'on call',
            'on-call',
            'oncall',
          ].includes(c)
        );

      if (hasLogColumns) {
        const findCol = (names) =>
          lowerCells.findIndex((c, idx) => idx > dateIdx && names.includes(c));

        const loginCol = findCol(['login', 'check in', 'check-in', 'checkin', 'in time', 'arrival']);
        const logoutCol = findCol(['logout', 'check out', 'check-out', 'checkout', 'out time', 'departure']);
        const descCol = findCol(['description', 'status', 'category', 'attendance', 'work mode']);
        const notesCol = findCol(['description / notes', 'notes', 'note', 'comment', 'comments']);
        const nsaCol = findCol(['nsa', 'night shift', 'night shift allowance']);
        const onCallCol = findCol(['on call', 'on-call', 'oncall']);
        const remarksCol = findCol(['remarks', 'remark', 'allowance status']);

        activeCols = {
          dateCol: dateIdx,
          dayCol: findCol(['day', 'weekday']),
          loginCol,
          logoutCol,
          descCol,
          notesCol: notesCol !== descCol ? notesCol : -1,
          nsaCol,
          onCallCol,
          remarksCol:
            remarksCol !== -1
              ? remarksCol
              : onCallCol !== -1
                ? onCallCol + 1
                : -1,
        };
        continue;
      }

      if (!activeCols) continue;

      const dateStr = normalizeDateValue(row[activeCols.dateCol]);
      if (!dateStr) continue;

      const rawLogin =
        activeCols.loginCol !== -1 ? String(row[activeCols.loginCol] || '').trim() : '';
      const rawLogout =
        activeCols.logoutCol !== -1 ? String(row[activeCols.logoutCol] || '').trim() : '';
      const rawDesc =
        activeCols.descCol !== -1 ? String(row[activeCols.descCol] || '').trim() : '';
      const rawExtraNotes =
        activeCols.notesCol !== -1 ? String(row[activeCols.notesCol] || '').trim() : '';
      const rawNsa =
        activeCols.nsaCol !== -1 ? String(row[activeCols.nsaCol] || '').trim() : '';
      const rawOnCall =
        activeCols.onCallCol !== -1 ? String(row[activeCols.onCallCol] || '').trim() : '';
      const rawRemarks =
        activeCols.remarksCol !== -1 ? String(row[activeCols.remarksCol] || '').trim() : '';

      let checkInTime = normalizeTimeValue(rawLogin);
      let checkOutTime = normalizeTimeValue(rawLogout);

      // Handle shifted cells where a weekday name was typed into Login and the time into Logout (e.g. 2026-11-06)
      if (!checkInTime && checkOutTime && /^(mon|tue|wed|thu|fri|sat|sun)/i.test(rawLogin)) {
        checkInTime = checkOutTime;
        checkOutTime = null;
      }

      const { status: parsedStatus, notes: parsedNotes } = classifyDescription(rawDesc);
      const combinedNotes = rawExtraNotes || parsedNotes || null;
      const nsa = isAffirmativeFlag(rawNsa) ? 1 : 0;
      const onCall = isAffirmativeFlag(rawOnCall) ? 1 : 0;

      // Guard against picking up side-table headers in remarksCol
      let remarks = null;
      if (
        rawRemarks &&
        !/^(wfo|wfh|public\s+holiday|leave|no\s+of)/i.test(rawRemarks)
      ) {
        remarks = rawRemarks;
      }

      recordsByDate.set(dateStr, {
        date: dateStr,
        status: parsedStatus,
        check_in_time: checkInTime,
        check_out_time: checkOutTime,
        nsa,
        on_call: onCall,
        notes: combinedNotes,
        remarks,
      });
    }
  }

  // Determine which months actually have logged activity (and the latest logged date in each month)
  const maxActiveDateByMonth = new Map();
  for (const [dateStr, rec] of recordsByDate.entries()) {
    const hasActivity =
      rec.status !== null ||
      rec.check_in_time !== null ||
      rec.check_out_time !== null ||
      rec.nsa === 1 ||
      rec.on_call === 1 ||
      Boolean(rec.notes);
    if (hasActivity) {
      const m = dateStr.slice(0, 7);
      const prevMax = maxActiveDateByMonth.get(m);
      if (!prevMax || dateStr > prevMax) {
        maxActiveDateByMonth.set(m, dateStr);
      }
    }
  }

  // Pass 3: Cross-reference Holidays & filter out completely empty rows
  const finalRecords = [];
  for (const [dateStr, rec] of recordsByDate.entries()) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dow = new Date(y, m - 1, d).getDay();
    const isWeekday = dow !== 0 && dow !== 6;
    const monthKey = dateStr.slice(0, 7);
    const monthDay = dateStr.slice(5, 10);
    const maxActiveDate = maxActiveDateByMonth.get(monthKey);

    // If a weekday was left blank in the daily table, check if it is listed in the sheet's
    // monthly off-dates grid & holiday catalog (e.g. 2026-01-15 Makara Sankranti, 2026-11-10)
    if (
      isWeekday &&
      rec.status === null &&
      !rec.check_in_time &&
      !rec.check_out_time &&
      !rec.notes &&
      maxActiveDate &&
      (referenceOffDates.has(dateStr) || holidaysByExactDate.has(dateStr))
    ) {
      rec.status = 'HOLIDAY';
    }

    // Enrich HOLIDAY records with the holiday name from the reference table if notes is empty
    if (rec.status === 'HOLIDAY' && !rec.notes) {
      const holidayName =
        holidaysByExactDate.get(dateStr) || holidaysByMonthDay.get(monthDay);
      if (holidayName) {
        rec.notes = holidayName;
      }
    }

    const isMeaningful =
      rec.status !== null ||
      rec.check_in_time !== null ||
      rec.check_out_time !== null ||
      rec.nsa === 1 ||
      rec.on_call === 1 ||
      Boolean(rec.notes) ||
      Boolean(rec.remarks);

    if (isMeaningful) {
      finalRecords.push(rec);
    }
  }

  finalRecords.sort((a, b) => a.date.localeCompare(b.date));

  const holidaysList = [];
  for (const [date, name] of holidaysByExactDate.entries()) {
    holidaysList.push({ date, name });
  }
  holidaysList.sort((a, b) => a.date.localeCompare(b.date));

  const monthsDetected = Array.from(
    new Set(finalRecords.map((r) => r.date.slice(0, 7)))
  ).sort();

  return {
    records: finalRecords,
    holidays: holidaysList,
    months: monthsDetected,
  };
}

/**
 * Parses a buffer or string (either .xlsx binary or .csv text) and scrapes attendance data.
 */
function parseAndScrapeSpreadsheet(inputBufferOrString) {
  const buf = Buffer.isBuffer(inputBufferOrString)
    ? inputBufferOrString
    : Buffer.from(String(inputBufferOrString), 'utf8');

  let sheets;
  if (
    buf.length >= 4 &&
    buf[0] === 0x50 &&
    buf[1] === 0x4b &&
    buf[2] === 0x03 &&
    buf[3] === 0x04
  ) {
    sheets = parseXlsxBuffer(buf);
  } else {
    sheets = parseCsvText(buf.toString('utf8'));
  }

  return scrapeAttendanceFromSheets(sheets);
}

/**
 * Builds an XML worksheet string from a 2D array of cell definitions.
 * Each cell in `rows[r][c]` can be a primitive (string/number) or { v, t: 's'|'n', s: styleIndex }.
 */
function buildWorksheetXml(rows, colWidths = []) {
  let colsXml = '';
  if (colWidths.length > 0) {
    const colItems = colWidths
      .map(
        (w, idx) =>
          `<col min="${idx + 1}" max="${idx + 1}" width="${w}" customWidth="1"/>`
      )
      .join('');
    colsXml = `<cols>${colItems}</cols>`;
  }

  const rowStrings = [];
  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r];
    if (!row || row.length === 0) continue;
    const cellStrings = [];

    for (let c = 0; c < row.length; c += 1) {
      const cell = row[c];
      if (cell === null || cell === undefined || cell === '') continue;

      const ref = `${indexToColLetters(c)}${r + 1}`;
      const isObj = typeof cell === 'object';
      const rawVal = isObj ? cell.v : cell;
      if (rawVal === null || rawVal === undefined || rawVal === '') continue;

      const styleAttr =
        isObj && typeof cell.s === 'number' ? ` s="${cell.s}"` : '';
      const isNumber =
        (isObj && cell.t === 'n') ||
        (!isObj && typeof rawVal === 'number' && !Number.isNaN(rawVal));

      if (isNumber) {
        cellStrings.push(`<c r="${ref}"${styleAttr}><v>${rawVal}</v></c>`);
      } else {
        cellStrings.push(
          `<c r="${ref}" t="inlineStr"${styleAttr}><is><t>${escapeXml(
            rawVal
          )}</t></is></c>`
        );
      }
    }

    if (cellStrings.length > 0) {
      rowStrings.push(`<row r="${r + 1}">${cellStrings.join('')}</row>`);
    }
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${colsXml}
  <sheetData>${rowStrings.join('')}</sheetData>
</worksheet>`;
}

/**
 * Generates a detailed, multi-sheet .xlsx Excel workbook from the database records.
 *
 * Styles defined in xl/styles.xml:
 * - s=0: Default normal cell
 * - s=1: Bold dark header cell (dark fill, white text)
 * - s=2: Subheader / section header (bold, light slate fill)
 * - s=3: Metric value bold
 * - s=4: WFO badge cell (soft blue)
 * - s=5: WFH badge cell (soft emerald)
 * - s=6: LEAVE badge cell (soft rose)
 * - s=7: HOLIDAY badge cell (soft violet)
 */
function generateAttendanceWorkbook({
  records = [],
  holidays = [],
  months = [],
}) {
  const recordByDate = new Map();
  for (const r of records) {
    recordByDate.set(r.date, r);
  }

  let activeMonths = [...months];
  if (activeMonths.length === 0) {
    const set = new Set(records.map((r) => r.date.slice(0, 7)));
    if (set.size === 0) {
      set.add(new Date().toISOString().slice(0, 7));
    }
    activeMonths = Array.from(set).sort();
  }

  // Compute per-month statistics
  const monthSummaries = activeMonths.map((mStr) => {
    const [y, m] = mStr.split('-').map(Number);
    const calendarDays = new Date(y, m, 0).getDate();
    const monthLabel = new Date(y, m - 1, 1).toLocaleDateString('en-US', {
      month: 'long',
    });

    let weekendDays = 0;
    let weekdayLeave = 0;
    let weekdayHoliday = 0;
    let wfo = 0;
    let wfh = 0;
    let leave = 0;
    let holiday = 0;
    let nsa = 0;
    let onCall = 0;
    const offDates = [];

    for (let d = 1; d <= calendarDays; d += 1) {
      const dateStr = `${mStr}-${String(d).padStart(2, '0')}`;
      const dow = new Date(y, m - 1, d).getDay();
      const rec = recordByDate.get(dateStr);

      if (dow === 0 || dow === 6) {
        weekendDays += 1;
        offDates.push(dateStr);
      } else if (rec?.status === 'LEAVE') {
        weekdayLeave += 1;
        offDates.push(dateStr);
      } else if (rec?.status === 'HOLIDAY') {
        weekdayHoliday += 1;
        offDates.push(dateStr);
      }

      if (rec) {
        if (rec.status === 'WFO') wfo += 1;
        else if (rec.status === 'WFH') wfh += 1;
        else if (rec.status === 'LEAVE') leave += 1;
        else if (rec.status === 'HOLIDAY') holiday += 1;

        if (rec.nsa) nsa += 1;
        if (rec.on_call) onCall += 1;
      }
    }

    const weekdays = calendarDays - weekendDays;
    const workingDays = Math.max(0, weekdays - weekdayLeave - weekdayHoliday);
    const wfoPct = workingDays ? Math.round((wfo / workingDays) * 10000) / 100 : 0;
    const wfhPct = workingDays ? Math.round((wfh / workingDays) * 10000) / 100 : 0;
    const phPct = workingDays
      ? Math.round((holiday / workingDays) * 10000) / 100
      : 0;
    const leavePct = workingDays
      ? Math.round((leave / workingDays) * 10000) / 100
      : 0;

    return {
      month: mStr,
      monthLabel,
      year: y,
      monthNum: m,
      calendarDays,
      weekendDays,
      weekdays,
      workingDays,
      wfo,
      wfh,
      leave,
      holiday,
      wfoPct,
      wfhPct,
      phPct,
      leavePct,
      nsa,
      onCall,
      offDates,
    };
  });

  // =========================================================================
  // SHEET 1: Index (Holiday Reference, Monthly Off-Dates Grid & Executive Summary)
  // =========================================================================
  const indexRows = [];

  const topHeaderRow = ['', '', '', { v: 'Holidays', s: 2 }];
  for (const ms of monthSummaries) {
    topHeaderRow.push({ v: ms.monthLabel, s: 2 });
  }
  indexRows.push([]);
  indexRows.push(topHeaderRow);

  const subHeaderRow = [{ v: 'Date', s: 1 }, { v: 'Name', s: 1 }, ''];
  indexRows.push(subHeaderRow);

  const maxOffRows = Math.max(
    holidays.length,
    ...monthSummaries.map((ms) => ms.offDates.length),
    1
  );
  for (let i = 0; i < maxOffRows; i += 1) {
    const r = [];
    if (holidays[i]) {
      r[0] = holidays[i].date;
      r[1] = holidays[i].name;
    }
    for (let mIdx = 0; mIdx < monthSummaries.length; mIdx += 1) {
      const offDate = monthSummaries[mIdx].offDates[i];
      if (offDate) {
        r[4 + mIdx] = offDate;
      }
    }
    indexRows.push(r);
  }

  indexRows.push([]);
  indexRows.push([
    { v: 'Month', s: 1 },
    { v: 'Calendar Days', s: 1 },
    { v: 'Weekends (Sat/Sun)', s: 1 },
    { v: 'Public Holidays', s: 1 },
    { v: 'Leaves', s: 1 },
    { v: 'Total Working Days', s: 1 },
    { v: 'WFO Days', s: 1 },
    { v: 'WFO %', s: 1 },
    { v: 'WFH Days', s: 1 },
    { v: 'WFH %', s: 1 },
    { v: 'NSA Days', s: 1 },
    { v: 'On Call Days', s: 1 },
  ]);

  for (const ms of monthSummaries) {
    indexRows.push([
      `${ms.monthLabel} ${ms.year}`,
      { v: ms.calendarDays, t: 'n' },
      { v: ms.weekendDays, t: 'n' },
      { v: ms.holiday, t: 'n' },
      { v: ms.leave, t: 'n' },
      { v: ms.workingDays, t: 'n', s: 3 },
      { v: ms.wfo, t: 'n', s: 4 },
      { v: ms.wfoPct, t: 'n' },
      { v: ms.wfh, t: 'n', s: 5 },
      { v: ms.wfhPct, t: 'n' },
      { v: ms.nsa, t: 'n' },
      { v: ms.onCall, t: 'n' },
    ]);
  }

  // =========================================================================
  // MONTHLY SHEETS: One Sheet Per Month (e.g. Jan2026, Feb2026, ...)
  // =========================================================================
  const allSheets = [
    {
      name: 'Index',
      rows: indexRows,
      widths: [16, 26, 14, 14, 14, 16, 14, 12, 14, 12, 12, 14, 14, 14, 14],
    },
  ];

  for (const ms of monthSummaries) {
    const mRows = [[]];
    const headerRow = [];
    headerRow[1] = { v: 'Date', s: 1 };
    headerRow[2] = { v: 'Day', s: 1 };
    headerRow[3] = { v: 'Login', s: 1 };
    headerRow[4] = { v: 'Logout', s: 1 };
    headerRow[5] = { v: 'Description', s: 1 };
    headerRow[7] = { v: 'NSA', s: 1 };
    headerRow[8] = { v: 'ON Call', s: 1 };
    headerRow[11] = { v: ms.monthLabel, s: 2 };
    headerRow[16] = { v: 'No of Working Days', s: 2 };
    headerRow[19] = `${ms.year}-01-01`;
    headerRow[20] = { v: ms.workingDays, t: 'n', s: 3 };
    mRows.push(headerRow);

    for (let d = 1; d <= ms.calendarDays; d += 1) {
      const dateStr = `${ms.month}-${String(d).padStart(2, '0')}`;
      const dow = new Date(ms.year, ms.monthNum - 1, d).getDay();
      const dayName = WEEKDAY_SHORT[dow];
      const rec = recordByDate.get(dateStr);

      let descText = '';
      let descStyle = 0;
      if (rec) {
        if (rec.status === 'WFO') {
          descText = rec.notes ? `WFO - ${rec.notes}` : 'WFO';
          descStyle = 4;
        } else if (rec.status === 'WFH') {
          descText = rec.notes ? `WFH - ${rec.notes}` : 'WFH';
          descStyle = 5;
        } else if (rec.status === 'LEAVE') {
          descText = rec.notes ? `Leave - ${rec.notes}` : 'Leave';
          descStyle = 6;
        } else if (rec.status === 'HOLIDAY') {
          descText = rec.notes ? `PH - ${rec.notes}` : 'PH';
          descStyle = 7;
        } else if (rec.notes) {
          descText = rec.notes;
        }
      }

      const dRow = [];
      dRow[1] = dateStr;
      dRow[2] = dayName;
      dRow[3] = rec?.check_in_time || '';
      dRow[4] = rec?.check_out_time || '';
      dRow[5] = descText ? { v: descText, s: descStyle } : '';
      dRow[7] = rec?.nsa ? 'Yes' : '';
      dRow[8] = rec?.on_call ? 'Yes' : '';
      dRow[9] = rec?.remarks || '';

      // Side Summary Table on rows 1..4 of each month block
      if (d === 1) {
        dRow[11] = { v: 'WFO (RGA)', s: 2 };
        dRow[12] = { v: ms.wfo, t: 'n', s: 3 };
        dRow[13] = { v: ms.wfoPct, t: 'n' };
      } else if (d === 2) {
        dRow[11] = { v: 'WFH(Remote)', s: 2 };
        dRow[12] = { v: ms.wfh, t: 'n', s: 3 };
        dRow[13] = { v: ms.wfhPct, t: 'n' };
      } else if (d === 3) {
        dRow[11] = { v: 'Public Holiday', s: 2 };
        dRow[12] = { v: ms.holiday, t: 'n', s: 3 };
        dRow[13] = { v: ms.phPct, t: 'n' };
      } else if (d === 4) {
        dRow[11] = { v: 'Leave', s: 2 };
        dRow[12] = { v: ms.leave, t: 'n', s: 3 };
        dRow[13] = { v: ms.leavePct, t: 'n' };
      }

      mRows.push(dRow);
    }

    // Monthly NSA & ON Call Totals row
    const totalRow = [];
    totalRow[7] = { v: ms.nsa, t: 'n', s: 3 };
    totalRow[8] = { v: ms.onCall, t: 'n', s: 3 };
    mRows.push(totalRow);

    const shortMonth = ms.monthLabel.slice(0, 3);
    allSheets.push({
      name: `${shortMonth}${ms.year}`,
      rows: mRows,
      widths: [6, 14, 8, 11, 11, 32, 4, 8, 9, 10, 4, 18, 10, 12],
    });
  }

  // Flat sortable log of all recorded days
  const flatRows = [
    [
      { v: 'Date', s: 1 },
      { v: 'Day', s: 1 },
      { v: 'Category', s: 1 },
      { v: 'Login', s: 1 },
      { v: 'Logout', s: 1 },
      { v: 'NSA', s: 1 },
      { v: 'On Call', s: 1 },
      { v: 'Description / Notes', s: 1 },
      { v: 'Remarks', s: 1 },
      { v: 'Source', s: 1 },
    ],
  ];
  const sortedRecords = [...records].sort((a, b) =>
    a.date.localeCompare(b.date)
  );
  for (const r of sortedRecords) {
    const [y, m, d] = r.date.split('-').map(Number);
    const dayName = WEEKDAY_SHORT[new Date(y, m - 1, d).getDay()];
    flatRows.push([
      r.date,
      dayName,
      r.status === 'HOLIDAY' ? 'Public Holiday' : r.status || 'On Call / Note',
      r.check_in_time || '',
      r.check_out_time || '',
      r.nsa ? 'Yes' : 'No',
      r.on_call ? 'Yes' : 'No',
      r.notes || '',
      r.remarks || '',
      r.trigger_type || 'MANUAL',
    ]);
  }
  allSheets.push({
    name: 'All Logged Days',
    rows: flatRows,
    widths: [14, 8, 16, 12, 12, 8, 10, 34, 14, 12],
  });

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="7">
    <font><sz val="10"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF1D4ED8"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF047857"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FFBE123C"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF6D28D9"/><name val="Calibri"/></font>
  </fonts>
  <fills count="8">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0F172A"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEFF6FF"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFECFDF5"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF1F2"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF5F3FF"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFE2E8F0"/></left>
      <right style="thin"><color rgb="FFE2E8F0"/></right>
      <top style="thin"><color rgb="FFE2E8F0"/></top>
      <bottom style="thin"><color rgb="FFE2E8F0"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="8">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="4" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="5" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="6" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
  </cellXfs>
</styleSheet>`;

  const sheetOverrides = allSheets
    .map(
      (_, idx) =>
        `  <Override PartName="/xl/worksheets/sheet${idx + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )
    .join('\n');

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheetOverrides}
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const wbSheetTags = allSheets
    .map(
      (s, idx) =>
        `    <sheet name="${escapeXml(s.name)}" sheetId="${idx + 1}" r:id="rId${idx + 1}"/>`
    )
    .join('\n');

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
${wbSheetTags}
  </sheets>
</workbook>`;

  const wbRelTags = allSheets
    .map(
      (_, idx) =>
        `  <Relationship Id="rId${idx + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${idx + 1}.xml"/>`
    )
    .join('\n');

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${wbRelTags}
  <Relationship Id="rId${allSheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const zipEntries = [
    { name: '[Content_Types].xml', data: contentTypesXml },
    { name: '_rels/.rels', data: rootRelsXml },
    { name: 'xl/workbook.xml', data: workbookXml },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRelsXml },
    { name: 'xl/styles.xml', data: stylesXml },
    ...allSheets.map((s, idx) => ({
      name: `xl/worksheets/sheet${idx + 1}.xml`,
      data: buildWorksheetXml(s.rows, s.widths),
    })),
  ];

  return createZipBuffer(zipEntries);
}

module.exports = {
  parseXlsxBuffer,
  parseCsvText,
  scrapeAttendanceFromSheets,
  parseAndScrapeSpreadsheet,
  generateAttendanceWorkbook,
};
