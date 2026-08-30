# NurseApply

Install page: https://nurse-apply.pages.dev

A Chrome extension (Manifest V3) that autofills nursing job applications on hospital
hiring portals. No backend, no accounts, no telemetry. Everything lives in
`chrome.storage.local` on the machine you installed it on.

## What it does and what it refuses to do

It fills forms and stops. It never clicks a submit button, never solves a CAPTCHA,
never navigates a wizard on its own, and never overwrites a field you have already
typed into. You review every screen and press the button yourself.

It also refuses to answer a specific class of question, no matter how confidently the
mapper thinks it knows the answer:

1. Termination, involuntary separation, resignation in lieu of termination, rehire eligibility
2. Criminal history, convictions, pending charges
3. Board discipline: revocation, suspension, surrender, consent orders, restrictions
4. Federal exclusion and sanction questions: OIG, SAM, abuse registries
5. Malpractice claims and National Practitioner Data Bank reports
6. Failed or refused drug screens, diversion, impaired practice
7. Government and financial identifiers: Social Security number, date of birth, driver's license number, bank details
8. Electronic signatures and certification attestations

Every one of those is verified downstream by a credentialing office against the state
board, your prior employer's HR file, and federal exclusion lists. A wrong answer is not
a typo, it is a false statement on an employment application. They go to the "Review
skipped" drawer with the reason, and they wait for you.

## Architecture

```
manifest.json                MV3, explicit host permissions, all_frames content scripts
src/schema/profile.js        the nurse profile shape, validation, date and state formatting
src/lib/storage.js           chrome.storage.local wrapper, tracker, mapping cache, backup
src/lib/docx.js              .docx text extraction using the browser's own DecompressionStream
src/lib/pdftext.js           PDF text extraction with the vendored pdf.js, layout aware
src/lib/resumeParse.js       deterministic nursing resume parser, no model involved
src/vendor/                  pdf.js, vendored because MV3 forbids remote script
src/content/domUtils.js      native-setter writes, ARIA combobox driver, field collection
src/content/knockout.js      the guard described above
src/content/heuristics.js    Tier 2: ~90 label rules covering nursing-specific fields
src/content/adapters/        Tier 1: Workday, iCIMS, Taleo, SuccessFactors, symplr, LinkedIn, Indeed
src/content/mapper.js        resolution, planning and execution
src/content/hud.js           floating status pill and skipped drawer, in a shadow root
src/content/index.js         per-frame orchestrator, MutationObserver, message routing
src/background/              service worker: storage access, frame fan-out, Anthropic calls
src/options/                 profile builder and settings
src/tracker/                 application tracker with CSV export
src/popup/                   toolbar popup
tools/                       integrity check, headless fill harness, packaging
```

### Why writes go through the prototype setter

React, Angular and Oracle ADF all keep their own copy of an input's value. Assigning
`element.value = x` mutates the DOM node without telling the framework, so the next
re-render discards it. Every write in `domUtils.js` calls the native setter taken from
`HTMLInputElement.prototype`, clears React's `_valueTracker`, then dispatches
`keydown`, `input`, `change`, `keyup` and `blur`. `tools/test-fill.mjs` proves this
against a simulated controlled React input, and includes a negative control: a naive
assignment on an identically guarded field, which the simulation must discard.

### Autopilot

The rule engine is exact and free, so it goes first. Autopilot handles what is
left, which on a real application is most of it: the questions each hospital
invents, the dropdowns whose options no rule anticipated, the free-text boxes.
The model is given the remaining fields and the profile and returns a value for
each. With auto-advance on, pressing Next fills the new step as it renders, all
the way to Submit, which is never pressed.

Two invariants are enforced in code rather than trusted to the model:

1. Anything the knockout guard blocks is never sent. The model does not get the
   chance to answer a question about discipline, termination, criminal history
   or exclusions, because those fields are removed before the request is built.
2. For a control with a fixed set of options, a returned value that is not one
   of them is discarded rather than typed.

The key lives in the service worker and is never handed to a content script, so
no website shares a page with it. Any OpenAI-compatible provider works, which
covers Kimi, DeepSeek, Groq, OpenRouter, OpenAI and anything self-hosted;
Anthropic has its own small adapter.

`npm run test:autopilot` fills a four-step, sixty-field nursing application
against a stand-in model that deliberately misbehaves, and asserts both
invariants along with the coverage. Point it at a real provider with
AUTOPILOT_BASE_URL, AUTOPILOT_KEY and AUTOPILOT_MODEL.

### Three ways in, because one is not enough

Rule-based extraction of a free-form document is wrong often enough, and
plausibly enough, that it cannot be the only path. A missing field is harmless;
an employer that reads fine and is actually a duty line is not. So import is
built as three independent routes that back each other up, and none of them
writes to the profile without being shown to you first.

1. **The parser.** Deterministic, local, instant, no key. Described below.
2. **Chrome's on-device model**, where it exists. Chrome 138 and later expose
   `LanguageModel` to extensions: Gemini Nano, running on the machine, no key,
   no account, nothing leaving the device. Used silently to settle which line is
   the employer and which is the title, and never mentioned in the interface,
   because it needs about 22 GB of free disk and a decent GPU or 16 GB of RAM
   and a nurse on an old laptop should not be shown a feature she cannot have.
3. **A handoff to whatever assistant you already use.** One button copies your
   resume text and a finished question to the clipboard and opens ChatGPT,
   Claude or Gemini. You paste, press enter, copy the answer back into a box.
   The reader accepts whatever comes back: fenced, wrapped in an apology, with
   different key names, or the entire chat transcript because you pressed
   select-all. Free tiers are enough and no API key is involved. It works with
   no file at all, so a scanned PDF with no text layer is not a dead end.

### The review step

Every import lands in a review panel, not in the profile. It shows what was
read, and makes the two corrections that actually happen cheap:

1. **One question fixes the whole document.** Resumes keep one layout
   throughout, so when employer and title are the wrong way round they are wrong
   for every job. A single button swaps all of them.
2. **Click a line to assign it.** Each job can show the resume lines it was
   built from, with an Employer and a Title button beside each. The right answer
   is almost always already on screen, so reassigning beats retyping.

### Resume import without a model

Resume parsing runs entirely on your machine and needs no API key. It works because most of
what a nursing application asks for comes from closed vocabularies rather than free prose:
certifications are an eight-item list, EMR systems are an eight-item list, and degrees, units,
license types, facility types and trauma levels are all enumerated. Dates, phone numbers, ZIP
codes, license numbers, bed counts and nurse-to-patient ratios have fixed shapes. That is a
matching problem, not a comprehension problem.

`src/lib/resumeParse.js` handles it: section detection, then per-domain extractors for
identity, licensure, certifications, education, employment and skills. Section headers are
matched with whitespace stripped, so letter-spaced small caps resolve, and again as a line
prefix, because older Word layouts put the label in a left margin where it extracts as
"Experience  Jan 2026 - present  ...". The genuinely ambiguous
part is the employment block, deciding which line is the employer and which is the job title.
Layouts disagree about the order: some put the employer on the date line and the title beneath,
others the reverse, so position is only a tiebreaker and scored keyword lists decide. When the
two scores are close the parser says so in its report rather than picking silently. It never invents a license number, an expiration date or
an NPI that is not written in the document, and an NPI that fails its check digit is rejected
with a reason.

A model is available as an optional second pass that writes only into fields the local parser
left blank. It is never on the critical path.

### Three tiers of mapping

1. **Adapter override.** Keyed on stable platform attributes, for example Workday's
   `data-automation-id="legalNameSection_firstName"`. Adapters are additive: they add
   hints and can never block a fill.
2. **Heuristics.** Weighted regex rules over the resolved label, which is assembled from
   the `<label>` element, `aria-label`, `aria-labelledby`, placeholder, name, id,
   `data-automation-id` and, for radios and checkboxes, the enclosing fieldset legend.
   That last one matters: without it, "Have you ever been convicted of a felony?" reads
   as a field labelled "Yes".
3. **Model fallback.** Off by default. When enabled, NurseApply sends only the structure
   of the form: control type, visible label, and the options a dropdown offers. The model
   returns a canonical key name, never a value. Your name, license number and immunization
   dates never leave the machine. Results are cached per form layout, so one hospital
   template costs one call, once.

### Frames, and which one draws the pill

iCIMS and Taleo host the application inside an iframe, so content scripts declare
`all_frames: true`. Normally the top frame draws the pill. But hospitals routinely put
that iframe on their own careers domain, which the manifest does not match, so the top
frame gets no content script at all. A child frame therefore asks the top frame whether
it has a pill, and draws its own when nothing answers. Without this the iframe was
fill-capable and completely silent, and the page looked dead.

Each frame reports its own running totals repeatedly, so contributions are keyed by
frame and replaced rather than summed. Adding every report made a seven-field form
finish reading "12/14 filled".

### Sites outside the fixed list

Hospital careers pages live on thousands of domains and the manifest cannot list them.
`<all_urls>` is never granted up front. Instead the popup offers to turn NurseApply on
for the site you are looking at: it requests that one origin through
`chrome.permissions.request`, injects immediately with `chrome.scripting.executeScript`
so there is no reload, and registers a dynamic content script so it keeps working on
later visits.

### Nothing in the profile is required

The profile saves in whatever state it is in, and filling works from whatever is there.
The list at the top of the options page is a reminder of what hospital forms tend to ask
for, not a gate. There are no required-field markers and no save is ever refused.

## Setup

See `SETUP.md`. Short version: `chrome://extensions`, turn on Developer mode, "Load
unpacked", pick this folder, then fill in your profile.

## Verifying a change

```
npm run check    # syntax, manifest integrity, safety invariants
npm test         # resume parser, fill harness, options page, and a real PDF end to end
npm run package  # dist/nurseapply-<version>.zip
```

`npm test` needs Playwright's Chromium. `npm install` then `npx playwright install chromium`
if you do not already have one.

## Data and privacy

Nothing is sent anywhere except the Anthropic API, and only when you have entered your
own API key and switched the fallback on. The extension uses `chrome.storage.local`
exclusively, never `chrome.storage.sync`, so license numbers and immunization records do
not replicate to your other machines through a Google account. Profile export
deliberately omits the API key.

## License

MIT. See `LICENSE`.
