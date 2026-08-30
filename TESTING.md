# Testing NurseApply

## Automated

```
npm run check
```

Parses every JavaScript file, validates the manifest, confirms every file the manifest
references exists, confirms `all_frames` is on, confirms no `<all_urls>` permission, and
confirms no content script calls `form.submit()`.

```
npm test
```

Loads the content-script modules into a synthetic ATS page and asserts the result field by
field. The page includes a controlled React input that discards writes which do not produce
an input event, plus a negative control proving the simulation actually catches a naive
`element.value =` assignment. It also asserts that a field with existing text is left alone,
that the termination and felony radio groups are left unanswered, that the Social Security
field stays blank, that the work authorization question is answered from the profile, and
that a "why do you want to work here" prompt is drafted into the drawer rather than written
into the form.

`npm run test:resume` parses three resumes written in different styles (single column with
all-caps headers, pipe-separated headers with the date on its own line, and a terse layout with
the employer above the date and bare years) and asserts every extracted field. It also asserts
the parser's refusals: no license, certification or NPI is invented when the document does not
state one, an NPI failing its check digit is rejected with a reason, and an empty extraction
explains itself rather than returning silence.

`npm run test:pdf` renders one of those resumes to a real PDF, extracts it with the vendored
pdf.js in a real browser, and parses the result. The page is under a request interceptor that
fails the test if anything leaves the local origin, which is what makes "no network" a checked
claim rather than an assertion.

`npm run test:options` loads the options page against an in-memory `chrome.storage.local` shim and
checks the behaviours that only appear in a browser: that the API key reaches storage the moment it
is typed rather than waiting for Save profile, that clearing the field clears the stored key, that
resume import asks for a key up front instead of failing after a file has been chosen, and that the
attach-without-parsing path is offered.

## Manual, on live portals

Nothing here can substitute for running against a real posting. Platform selectors change,
and the adapters are best-effort hints that fall back to the heuristic tier. What follows is
how to check one.

### Finding a posting

Workday: search `site:myworkdayjobs.com registered nurse` and pick a health system. Providence,
HCA, Tenet, Sutter and Trinity Health all run Workday. The URL looks like
`https://<system>.wd1.myworkdayjobs.com/en-US/<site>/job/<location>/<title>_R-123456`.
You will need an account on that tenant to reach the application form itself; the posting page
alone is not enough.

iCIMS: search `site:icims.com nurse`. The apply flow is often an iframe on the employer's own
domain, which is exactly the case `all_frames` exists for.

Taleo: search `site:taleo.net rn`. Many older systems and staffing agencies still run it.

### What to check on each step

1. **Detection.** The pill shows the right platform name and a step label. If it says "Generic form", the adapter's `matches()` did not fire.
2. **Coverage.** Press Fill step. Compare `filled` against the number of empty fields on screen.
3. **Correctness, not just count.** Read every filled field. A wrong state or a shifted date is worse than a blank.
4. **Dates.** Workday splits dates into three spinbuttons. Confirm month, day and year each landed in the right box rather than the whole string in the month box.
5. **Dropdowns.** State, degree, certifying body and unit are the ones that fail. If a combobox is left blank, open it manually and note the exact option text; the mismatch is usually abbreviation versus full name.
6. **Knockout guard.** Find the screening questions. Every one about termination, rehire, convictions, board discipline, exclusion, malpractice or drug screens must be untouched and listed in the drawer.
7. **No overwrite.** Type something into a field yourself, press Fill step again, confirm it survives.
8. **Nothing submitted.** Confirm the wizard did not advance and no confirmation appeared.
9. **HUD placement.** Confirm the pill is not sitting on top of Next or Submit.

### Inspecting a field that did not fill

Right-click it, Inspect, then in the console:

```js
const el = $0;
NA.dom.labelFor(el)          // what the mapper actually sees
NA.dom.fieldKind(el)         // text, select, combobox, radio, radiogroup, file
NA.dom.optionsFor(el)        // what a dropdown offers
NA.knockout.classify(NA.dom.labelFor(el))   // allow, block, essay or normal
```

If `labelFor` returns something useless, the fix is a label-resolution change in
`domUtils.js` or an adapter override keyed on `data-automation-id`. If it returns a good
label and nothing matched, the fix is a rule in `heuristics.js`. If the value resolved but
the write was rejected, the control needs a `customFill` in that platform's adapter.

To watch the plan without touching the page:

```js
const fields = NA.mapper.scan(NA.adapterRegistry.pick(location, document), document);
NA.mapper.plan(fields, NA.currentProfile, { fillDemographics: true }, NA.adapterRegistry.pick(location, document));
```

### Service worker logs

`chrome://extensions`, NurseApply, click **service worker**. API errors from the model
fallback surface there with the HTTP status and the message from Anthropic.

### Known limits

1. Drag-and-drop-only resume widgets with no underlying `<input type=file>` cannot be driven. They are reported as skipped.
2. Closed shadow roots are unreachable. Open ones are traversed.
3. A portal that renders the next step only after a server round trip needs a moment before Fill step will see the new fields. The MutationObserver resets the count when the layout changes.
4. Adapter selectors are point-in-time. When a platform changes its DOM, Tier 1 degrades to Tier 2 rather than breaking.
