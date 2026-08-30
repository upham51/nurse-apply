/**
 * Minimal .docx text extractor. A .docx is a zip; the text lives in
 * word/document.xml. Rather than ship a zip library we use the browser's own
 * DecompressionStream for the deflate entries, which every Chrome that can run
 * MV3 already has. Extension pages only, not the service worker.
 */
(function (root) {
  'use strict';
  const NA = (root.NA = root.NA || {});

  function readU16(v, o) { return v.getUint16(o, true); }
  function readU32(v, o) { return v.getUint32(o, true); }

  async function inflateRaw(bytes) {
    if (typeof root.DecompressionStream !== 'function') {
      throw new Error('This browser cannot unzip .docx files. Save the resume as PDF instead.');
    }
    const ds = new root.DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** Returns the raw bytes of one entry, found via the central directory. */
  async function readZipEntry(buffer, wantedName) {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    // Locate the end-of-central-directory record (scan back over the comment).
    let eocd = -1;
    for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 66000; i--) {
      if (readU32(view, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd === -1) throw new Error('That file is not a valid .docx archive.');

    const entries = readU16(view, eocd + 10);
    let ptr = readU32(view, eocd + 16);

    for (let i = 0; i < entries; i++) {
      if (readU32(view, ptr) !== 0x02014b50) break;
      const method = readU16(view, ptr + 10);
      const compressedSize = readU32(view, ptr + 20);
      const nameLen = readU16(view, ptr + 28);
      const extraLen = readU16(view, ptr + 30);
      const commentLen = readU16(view, ptr + 32);
      const localOffset = readU32(view, ptr + 42);
      const name = new TextDecoder().decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));

      if (name === wantedName) {
        const lhNameLen = readU16(view, localOffset + 26);
        const lhExtraLen = readU16(view, localOffset + 28);
        const dataStart = localOffset + 30 + lhNameLen + lhExtraLen;
        const raw = bytes.subarray(dataStart, dataStart + compressedSize);
        if (method === 0) return raw;
        if (method === 8) return await inflateRaw(raw);
        throw new Error('Unsupported compression inside the .docx file.');
      }
      ptr += 46 + nameLen + extraLen + commentLen;
    }
    throw new Error('No document body found inside the .docx file.');
  }

  function xmlToText(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) {
      return xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    const lines = [];
    const paras = doc.getElementsByTagName('w:p');
    for (let i = 0; i < paras.length; i++) {
      const runs = paras[i].getElementsByTagName('w:t');
      let line = '';
      for (let j = 0; j < runs.length; j++) line += runs[j].textContent;
      lines.push(line.trim());
    }
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  async function extractText(arrayBuffer) {
    const xmlBytes = await readZipEntry(arrayBuffer, 'word/document.xml');
    return xmlToText(new TextDecoder().decode(xmlBytes));
  }

  NA.docx = { extractText, readZipEntry, xmlToText };
})(typeof self !== 'undefined' ? self : this);
