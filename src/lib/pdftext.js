/**
 * Local PDF text extraction using the vendored pdf.js build.
 *
 * Everything happens in this browser. Nothing is uploaded, and no API key is
 * involved. Text items are regrouped into lines by their y coordinate and
 * ordered by x, because pdf.js emits glyph runs in drawing order, which on a
 * two-column resume interleaves the columns into nonsense if you just
 * concatenate them.
 */
(function (root) {
  'use strict';
  const NA = (root.NA = root.NA || {});

  let pdfjsPromise = null;

  function loadPdfjs() {
    if (pdfjsPromise) return pdfjsPromise;
    const base = chrome.runtime.getURL('src/vendor/');
    pdfjsPromise = import(base + 'pdf.min.mjs').then((mod) => {
      const lib = mod.default && mod.default.getDocument ? mod.default : mod;
      lib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs';
      return lib;
    });
    return pdfjsPromise;
  }

  /** Splits a page's items into visual lines, then into columns if needed. */
  function itemsToLines(items, viewportWidth) {
    const placed = items
      .filter((it) => typeof it.str === 'string' && it.str.trim() !== '')
      .map((it) => ({
        text: it.str,
        x: it.transform[4],
        y: it.transform[5],
        w: it.width || 0,
        h: Math.abs(it.transform[3]) || 10
      }));
    if (!placed.length) return [];

    const gutter = detectGutter(placed, viewportWidth);

    // A gutter alone does not mean two columns. A resume with right-aligned
    // dates has one column of prose and a narrow strip of dates that sit on the
    // SAME baselines as the lines they belong to. Splitting that emits every
    // role first and every date afterwards, which is worse than useless. So
    // check whether rows actually span the gutter: if they do, it is one column
    // with right-aligned content and the two sides must stay on the same line.
    let ranges = [{ index: 0, from: -Infinity, to: Infinity }];
    if (gutter !== null) {
      const fullRows = clusterRows(placed);
      const spanning = fullRows.filter((row) =>
        row.some((p) => p.x < gutter) && row.some((p) => p.x >= gutter)).length;
      if (spanning / fullRows.length < 0.15) {
        ranges = [
          { index: 0, from: -Infinity, to: gutter },
          { index: 1, from: gutter, to: Infinity }
        ];
      }
    }

    const lines = [];
    ranges.forEach((col) => {
      const inCol = placed.filter((p) => p.x >= col.from && p.x < col.to);
      if (!inCol.length) return;
      clusterRows(inCol).forEach((row) => {
        const text = joinRow(row);
        if (text) lines.push({ text, column: col.index, y: row[0].y });
      });
    });
    return lines;
  }

  /**
   * Groups items into visual rows by y with a tolerance, top of page first.
   * Tolerance is relative to the smaller of the two glyph heights, because a
   * 15pt heading and 10pt body text do not share a fixed bucket size.
   */
  function clusterRows(items) {
    const sorted = items.slice().sort((a, b) => b.y - a.y);
    const rows = [];
    let row = [sorted[0]];
    let rowY = sorted[0].y;
    for (let i = 1; i < sorted.length; i++) {
      const item = sorted[i];
      const tolerance = Math.max(2, Math.min(item.h, row[0].h) * 0.5);
      if (Math.abs(item.y - rowY) <= tolerance) {
        row.push(item);
        rowY = (rowY * (row.length - 1) + item.y) / row.length;
      } else {
        rows.push(row);
        row = [item];
        rowY = item.y;
      }
    }
    rows.push(row);
    rows.forEach((r) => r.sort((a, b) => a.x - b.x));
    return rows;
  }

  /**
   * Joins one row's glyph runs, inserting a space wherever the horizontal gap
   * is wider than the run's own advance would explain. Two markers are used:
   * a normal space, and a double space for a gap wide enough to be a word
   * break in letter-spaced display type, which the parser relies on to
   * recover "P R O F E S S I O N A L  E X P E R I E N C E".
   */
  function joinRow(row) {
    let text = '';
    let prev = null;
    row.forEach((p) => {
      if (prev) {
        const gap = p.x - (prev.x + prev.w);
        if (gap > prev.h * 0.9) text += '  ';
        else if (gap > prev.h * 0.16 && !/\s$/.test(text) && !/^\s/.test(p.text)) text += ' ';
      }
      text += p.text;
      prev = p;
    });
    return text.replace(/[ \t]{3,}/g, '  ').replace(/^\s+|\s+$/g, '');
  }

  /**
   * Finds a vertical gutter that almost no glyph crosses, or null. Whether that
   * gutter actually separates two columns is decided by the caller, from
   * whether rows span it.
   */
  function detectGutter(placed, width) {
    if (!width || placed.length < 40) return null;

    const buckets = new Array(40).fill(0);
    placed.forEach((p) => {
      const b = Math.floor((p.x / width) * 40);
      if (b >= 0 && b < 40) buckets[b] += 1;
    });

    // Look for an empty run of buckets somewhere in the middle third.
    let bestStart = -1, bestLen = 0, runStart = -1;
    for (let i = 12; i < 28; i++) {
      if (buckets[i] === 0) {
        if (runStart === -1) runStart = i;
        const len = i - runStart + 1;
        if (len > bestLen) { bestLen = len; bestStart = runStart; }
      } else {
        runStart = -1;
      }
    }
    if (bestLen < 3) return null;

    const gutter = ((bestStart + bestLen / 2) / 40) * width;
    const left = placed.filter((p) => p.x < gutter).length;
    if (left < placed.length * 0.1 || left > placed.length * 0.9) return null;
    return gutter;
  }

  /**
   * Extracts the whole document as newline-separated text.
   *
   * The copy is not optional. pdf.js hands the typed array to its worker as a
   * transferable, which detaches the underlying ArrayBuffer in this thread. A
   * caller that still needs those bytes afterwards, to store the file for
   * upload, say, would get "Cannot perform Construct on a detached
   * ArrayBuffer". Copying here keeps that a private detail of this module
   * rather than a trap every caller has to know about.
   */
  async function extractText(arrayBuffer, opts) {
    const pdfjs = await loadPdfjs();
    const bytes = new Uint8Array(arrayBuffer.byteLength);
    bytes.set(new Uint8Array(arrayBuffer));
    const task = pdfjs.getDocument({
      data: bytes,
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true
    });
    const doc = await task.promise;
    const maxPages = Math.min(doc.numPages, (opts && opts.maxPages) || 12);
    const out = [];
    for (let n = 1; n <= maxPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const lines = itemsToLines(content.items, viewport.width);
      lines.forEach((l) => out.push(l.text));
      out.push('');
      page.cleanup();
    }
    try { await doc.destroy(); } catch (e) { /* noop */ }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  NA.pdftext = { extractText, itemsToLines, detectGutter, clusterRows, joinRow, loadPdfjs };
})(typeof self !== 'undefined' ? self : this);
