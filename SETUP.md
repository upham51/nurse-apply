# Installing NurseApply

## 1. Get the files onto your machine

Either clone the repository:

```
git clone https://github.com/upham51/nurse-apply.git
cd nurse-apply
```

or download the zip from https://nurse-apply.pages.dev and unzip it. If you downloaded the packaged
zip, the folder you want is the one containing `manifest.json` directly.

## 2. Load it into Chrome

1. Open `chrome://extensions`
2. Turn on **Developer mode** with the toggle in the top right
3. Click **Load unpacked**
4. Select the folder containing `manifest.json`
5. NurseApply appears in the list and the options page opens automatically on first install

If the options page does not open, click **Details** on the NurseApply card and then
**Extension options**.

Pin it to the toolbar: click the puzzle-piece icon in Chrome's toolbar, then the pin next
to NurseApply. The popup is how you trigger a fill when the floating pill is hidden.

## 3. Build your profile

Two ways.

**Import a resume.** Click **Import resume** on the options page. This needs an Anthropic
API key, entered in the Settings section first. Drop in a PDF, DOCX or TXT. PDFs go to the
API as a document so two-column layouts survive; DOCX is unzipped and read locally. The
model returns a structured profile which populates the form. Nothing is saved until you
press **Save profile**, so read every section first. It will not invent a license number,
an expiration date, an NPI or an immunization record that is not written in the document.

**Type it in.** Work down the accordions. The sections that pay for themselves fastest are
Licensure, Certifications and Work experience, because that is where hospital portals ask
questions no generic autofiller has answers for: trauma level, bed count, typical ratio,
EMR system, unit.

Fields to get right:

1. Mark exactly one license as **primary state of residence**. Compact-license questions read from it.
2. Put your most recent role first in Work experience. Portals asking for "current employer" take the first entry marked current.
3. Phone numbers can be typed however you like; they are normalized on blur, and split into area code and line when a portal asks for the parts separately.
4. Dates are stored ISO and rewritten per form. A portal wanting `MM/YYYY` gets `03/2021`; one wanting an ISO date gets `2021-03-01`.

The panel at the top of the options page lists anything missing or expired. Expired BLS is
the single most common reason a nursing application stalls, so it is checked on every save.

## 4. Optional: the model fallback

In Settings, paste an Anthropic API key and turn on **Use the model for fields the rules
cannot map**. Press **Test API key** to confirm it works.

What gets sent: control type, the visible label text, and the options a dropdown offers.
What does not: anything from your profile. The model replies with a canonical key name,
and the extension resolves that key to a value locally. Answers are cached per form
layout, keyed by hostname plus a fingerprint of the field structure, for thirty days.
A given hospital's template therefore costs one call the first time you see it and nothing
after that. **Clear mapping cache** in Settings forces a re-evaluation if a portal changes
its form.

Leave it off and the extension still works. The heuristic tier covers the standard fields
on all seven supported platforms.

## 5. Use it

Open an application on a supported portal. A pill appears in the bottom right showing
which platform was detected and which step you are on.

1. **Fill step** fills the visible step, including any iframe the form lives in
2. Filled fields get a teal outline; skipped ones get a dashed amber outline
3. **Review skipped (n)** opens the drawer: what was left alone and why, with a "Show me" button that scrolls to each one
4. Freeform questions get a draft in the drawer with an **Insert this** button. Nothing goes into the form until you click it
5. Move to the next step yourself and press **Fill step** again

The pill moves itself out of the way when a Next or Submit button is underneath it.
The `×` hides it until you reload.

## Supported portals

myworkdayjobs.com, myworkdaysite.com, icims.com, taleo.net, successfactors.com,
successfactors.eu, symplr.com, healthcaresource.com, indeed.com, linkedin.com.

The extension has no permission to read any other site. Host permissions are listed
explicitly in the manifest, with no `<all_urls>`.

## Removing everything

**Erase everything** in Settings clears the profile, settings, tracker and cache from this
browser. Removing the extension from `chrome://extensions` does the same.
