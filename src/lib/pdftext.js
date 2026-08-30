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

    // Detect a two-column layout: a vertical gutter that almost no item crosses.
    const columns = detectColumns(placed, viewportWidth);

    const lines = [];
    columns.forEach((col) => {
      const inCol = placed.filter((p) => p.x >= col.from && p.x < col.to);
      if (!inCol.length) return;

      // Cluster by y with a tolerance, rather than bucketing y into fixed
      // slots. A heading set in 15pt and body text set in 10pt do not share a
      // bucket size, and rounding each item by its own height made a large
      // heading sort as though it were somewhere else on the page entirely.
      const sorted = inCol.slice().sort((a, b) => b.y - a.y);
      const grouped = [];
      let row = [sorted[0]];
      let rowY = sorted[0].y;
      for (let i = 1; i < sorted.length; i++) {
        const item = sorted[i];
        const tolerance = Math.max(2, Math.min(item.h, row[0].h) * 0.5);
        if (Math.abs(item.y - rowY) <= tolerance) {
          row.push(item);
          rowY = (rowY * (row.length - 1) + item.y) / row.length;
        } else {
          grouped.push(row);
          row = [item];
          rowY = item.y;
        }
      }
      grouped.push(row);

      grouped
        .forEach((row) => {
          row.sort((a, b) => a.x - b.x);
          let text = '';
          let prev = null;
          row.forEach((p) => {
            if (prev) {
              const gap = p.x - (prev.x + prev.w);
              if (gap > prev.h * 0.28 && !/\s$/.test(text) && !/^\s/.test(p.text)) text += ' ';
            }
            text += p.text;
            prev = p;
          });
          const clean = text.replace(/\s+/g, ' ').trim();
          if (clean) lines.push({ text: clean, column: col.index, y: row[0].y });
        });
    });
    return lines;
  }

  /**
   * Returns one or two column ranges. Two only when there is a clear gutter and
   * both sides carry a real share of the content, which avoids splitting a
   * single-column resume that happens to have a right-aligned date margin.
   */
  function detectColumns(placed, width) {
    const single = [{ index: 0, from: -Infinity, to: Infinity }];
    if (!width || placed.length < 40) return single;

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
    if (bestLen < 3) return single;

    const gutter = ((bestStart + bestLen / 2) / 40) * width;
    const left = placed.filter((p) => p.x < gutter).length;
    const right = placed.length - left;
    if (left < placed.length * 0.2 || right < placed.length * 0.2) return single;

    return [
      { index: 0, from: -Infinity, to: gutter },
      { index: 1, from: gutter, to: Infinity }
    ];
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

  NA.pdftext = { extractText, itemsToLines, detectColumns, loadPdfjs };
})(typeof self !== 'undefined' ? self : this);
