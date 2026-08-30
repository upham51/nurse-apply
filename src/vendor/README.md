# Vendored third-party code

`pdf.min.mjs` and `pdf.worker.min.mjs` are the legacy (ES5-target) minified build of
[pdf.js](https://github.com/mozilla/pdf.js) `pdfjs-dist@4.10.38`, Apache-2.0.

They are vendored rather than fetched from a CDN because Manifest V3 forbids remote
script execution, and because resume text extraction has to work with no network at all.

To update: `npm pack pdfjs-dist@<version>`, then copy `package/legacy/build/pdf.min.mjs`
and `package/legacy/build/pdf.worker.min.mjs` here and bump the version above.
