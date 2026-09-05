/**
 * Minimal, dependency-free .xlsx reader.
 *
 * An .xlsx is a ZIP of XML parts; Node ships `zlib` but no unzip, so we walk
 * the central directory ourselves and inflate the two parts we need
 * (sharedStrings + the first worksheet). That keeps `npm install` untouched:
 * the draft kit is regenerated from files on disk, not from a package.
 */
const fs = require('fs');
const zlib = require('zlib');

function unzip(buf) {
    // Locate the End Of Central Directory record (scan back over the comment).
    let eocd = -1;
    for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 0xffff; i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a zip file (no EOCD record)');

    const count = buf.readUInt16LE(eocd + 10);
    let off = buf.readUInt32LE(eocd + 16);
    const files = {};

    for (let n = 0; n < count; n++) {
        if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('bad central directory entry');
        const method = buf.readUInt16LE(off + 10);
        const compSize = buf.readUInt32LE(off + 20);
        const nameLen = buf.readUInt16LE(off + 28);
        const extraLen = buf.readUInt16LE(off + 30);
        const commentLen = buf.readUInt16LE(off + 32);
        const localOff = buf.readUInt32LE(off + 42);
        const name = buf.toString('utf8', off + 46, off + 46 + nameLen);

        // The local header repeats the name/extra with its own lengths.
        const lNameLen = buf.readUInt16LE(localOff + 26);
        const lExtraLen = buf.readUInt16LE(localOff + 28);
        const dataStart = localOff + 30 + lNameLen + lExtraLen;
        const raw = buf.subarray(dataStart, dataStart + compSize);

        files[name] = method === 0 ? raw : zlib.inflateRawSync(raw);
        off += 46 + nameLen + extraLen + commentLen;
    }
    return files;
}

const ENTITIES = { lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeXML(s) {
    return s
        .replace(/&#x([0-9A-Fa-f]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
        .replace(/&(lt|gt|quot|apos);/g, (_, e) => ENTITIES[e])
        .replace(/&amp;/g, '&'); // last, so "&amp;lt;" survives as "&lt;"
}

function textOf(xml) {
    let out = '';
    const re = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let m;
    while ((m = re.exec(xml))) out += m[1];
    return decodeXML(out);
}

function colToIndex(letters) {
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
}

/** Reads the first worksheet of `file` as an array of string arrays (0-based). */
function readSheet(file) {
    const parts = unzip(fs.readFileSync(file));

    const shared = [];
    const ssXml = parts['xl/sharedStrings.xml'];
    if (ssXml) {
        const re = /<si>([\s\S]*?)<\/si>/g;
        let m;
        while ((m = re.exec(ssXml.toString('utf8')))) shared.push(textOf(m[1]));
    }

    const sheetName = Object.keys(parts).find(k => /^xl\/worksheets\/sheet1\.xml$/.test(k));
    if (!sheetName) throw new Error(`${file}: no xl/worksheets/sheet1.xml`);
    const sheet = parts[sheetName].toString('utf8');

    const rows = [];
    const rowRe = /<row[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
    let r;
    while ((r = rowRe.exec(sheet))) {
        const rowIdx = Number(r[1]) - 1;
        const cells = [];
        const cellRe = /<c\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
        let c;
        while ((c = cellRe.exec(r[2]))) {
            const attrs = c[1] || '';
            const body = c[2] || '';
            const ref = (attrs.match(/\br="([A-Z]+)\d+"/) || [])[1];
            const type = (attrs.match(/\bt="([^"]+)"/) || [])[1];
            let value = '';
            if (type === 'inlineStr') {
                value = textOf(body);
            } else {
                const v = body.match(/<v>([\s\S]*?)<\/v>/);
                if (v) value = type === 's' ? (shared[Number(v[1])] ?? '') : decodeXML(v[1]);
            }
            if (ref) cells[colToIndex(ref)] = value;
        }
        rows[rowIdx] = cells;
    }

    // Normalise holes so callers can index freely.
    const width = rows.reduce((w, row) => Math.max(w, row ? row.length : 0), 0);
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i] || [];
        rows[i] = Array.from({ length: width }, (_, j) => (row[j] ?? '').trim());
    }
    return rows;
}

module.exports = { readSheet };
