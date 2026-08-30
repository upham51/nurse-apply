/**
 * Service worker.
 *
 * Owns everything that must not happen inside the page: reading storage,
 * fanning a fill request out to every frame, and the two Anthropic calls
 * (field mapping and resume parsing). Content scripts never hold the API key.
 */
'use strict';

importScripts('/src/schema/profile.js', '/src/lib/storage.js');

const NA = self.NA;
const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

/* ------------------------------------------------------------ api client */

async function callAnthropic(settings, body) {
  if (!settings.apiKey) {
    throw new Error('No Anthropic API key saved yet. Open the NurseApply options page, '
      + 'expand Settings, and paste one into the API key field.');
  }
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': API_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify(body)
  });

  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try { detail = JSON.parse(text).error.message; } catch (e) { /* keep raw */ }
    throw new Error(`Anthropic API ${res.status}: ${detail}`);
  }
  return JSON.parse(text);
}

function firstText(response) {
  const blocks = (response && response.content) || [];
  const block = blocks.find((b) => b.type === 'text');
  return block ? block.text : '';
}

/** Models like to wrap JSON in prose or a fence. Dig it out. */
function extractJson(text) {
  if (!text) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1] : text;
  try { return JSON.parse(candidate); } catch (e) { /* keep digging */ }
  const start = candidate.search(/[[{]/);
  if (start === -1) return null;
  const opener = candidate[start];
  const closer = opener === '[' ? ']' : '}';
  const end = candidate.lastIndexOf(closer);
  if (end <= start) return null;
  try { return JSON.parse(candidate.slice(start, end + 1)); } catch (e) { return null; }
}

/* ------------------------------------------------- tier 3: field mapping */

const MAP_SYSTEM = [
  'You map fields on a job application form to canonical keys.',
  '',
  'You receive only the structure of a form: control type, visible label text,',
  'and the options a dropdown offers. You never receive, and must never ask',
  'for, anything about the applicant.',
  '',
  'Return a JSON array. One object per field you are confident about:',
  '  [{"signature": "<the field signature given to you>", "key": "<canonical key>"}]',
  'Omit any field you are not confident about. Do not invent keys: every key',
  'must come from the allowed list. Do not return prose, only the JSON array.',
  '',
  'Never map a field to a key when the label asks about criminal history,',
  'termination, rehire eligibility, board discipline, federal exclusion,',
  'malpractice, drug screening history, a signature, or a government or',
  'financial identifier. Omit those fields entirely.'
].join('\n');

async function mapFieldsWithModel(settings, payload) {
  const fields = payload.fields.map((f) => ({
    signature: f.signature,
    control: f.kind,
    label: (f.label || '').slice(0, 200),
    required: f.required,
    options: (f.options || []).slice(0, 24)
  }));

  const body = {
    model: settings.mappingModel,
    max_tokens: 2000,
    system: MAP_SYSTEM,
    messages: [{
      role: 'user',
      content: JSON.stringify({
        allowedKeys: payload.allowedKeys,
        fields
      })
    }]
  };

  const res = await callAnthropic(settings, body);
  const parsed = extractJson(firstText(res));
  if (!Array.isArray(parsed)) return {};

  const allowed = new Set(payload.allowedKeys);
  const mapping = {};
  parsed.forEach((row) => {
    if (!row || typeof row.signature !== 'string') return;
    if (!allowed.has(row.key)) return;
    mapping[row.signature] = row.key;
  });
  return mapping;
}

/* --------------------------------------------------- resume -> profile */

const RESUME_SYSTEM = [
  'You convert a nurse resume into a NurseApply profile JSON object.',
  '',
  'Rules:',
  '- Output only JSON. No prose, no code fence.',
  '- Use exactly the keys and enum values given in the schema description.',
  '- Dates: YYYY-MM-DD where a day is stated, YYYY-MM otherwise. Never guess a day.',
  '- Leave a field as an empty string when the resume does not state it.',
  '  Do not infer a license number, an expiration date, an NPI, or any',
  '  immunization record that is not written in the document.',
  '- responsibilities: keep the resume\'s own bullet wording, one per line.',
  '- Do not summarise, embellish, or add achievements the resume does not claim.'
].join('\n');

function schemaDescription() {
  const E = NA.schema.ENUMS;
  return {
    identity: {
      firstName: '', lastName: '', preferredName: '', email: '', phone: '',
      address: { street: '', line2: '', city: '', state: '2-letter', zip: '' }
    },
    nursingCredentials: { npiNumber: '10 digits or ""', nclex: { passDate: 'YYYY-MM', state: '' } },
    licenses: [{
      type: E.licenseType, state: '2-letter', number: '',
      issueDate: 'YYYY-MM-DD', expirationDate: 'YYYY-MM-DD',
      isCompact: 'boolean', isPrimaryState: 'boolean'
    }],
    certifications: [{
      name: E.certName, otherName: '', issuingBody: E.issuingBody,
      issueDate: 'YYYY-MM-DD', expirationDate: 'YYYY-MM-DD'
    }],
    education: [{
      degree: E.degree, major: '', school: '', city: '', state: '',
      graduationDate: 'YYYY-MM', gpa: ''
    }],
    experience: [{
      employer: '', facilityType: E.facilityType, traumaLevel: E.traumaLevel,
      unit: '', bedCount: '', typicalRatio: '', title: '',
      startDate: 'YYYY-MM', endDate: 'YYYY-MM or ""', isCurrent: 'boolean',
      reasonForLeaving: '', responsibilities: ''
    }],
    clinicalSkills: {
      emrSystems: E.emrSystems, procedures: ['freeform'],
      languages: [{ language: '', proficiency: E.proficiency }]
    }
  };
}

/**
 * Accepts either extracted text or a raw PDF. PDFs go up as a document block
 * rather than as text scraped in the page: two-column nursing resumes lose
 * their column order in naive text extraction, and a mangled resume produces a
 * mangled profile.
 */
async function parseResumeWithModel(settings, source) {
  const instruction =
    'Target schema (enum arrays list the only allowed values):\n' +
    JSON.stringify(schemaDescription(), null, 1) +
    '\n\nReturn the filled profile JSON for the resume provided.';

  let content;
  if (source && source.base64 && source.mediaType === 'application/pdf') {
    content = [
      { type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: source.base64 } },
      { type: 'text', text: instruction }
    ];
  } else {
    content = instruction + '\n\nResume text:\n"""\n' +
      String((source && source.text) || '').slice(0, 120000) + '\n"""';
  }

  const body = {
    model: settings.parsingModel,
    max_tokens: 8000,
    system: RESUME_SYSTEM,
    messages: [{ role: 'user', content }]
  };
  const res = await callAnthropic(settings, body);
  const parsed = extractJson(firstText(res));
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('The model did not return usable JSON. Try again or paste the resume text manually.');
  }
  return parsed;
}

/* ----------------------------------------------------------- messaging */

const frameAggregates = new Map();

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (!msg || !msg.type) return;

  const tabId = sender.tab && sender.tab.id;

  switch (msg.type) {
    case 'state:get':
      Promise.all([NA.storage.getProfile(), NA.storage.getSettings()])
        .then(([profile, settings]) => respond({ ok: true, profile, settings }))
        .catch((e) => respond({ ok: false, error: e.message }));
      return true;

    case 'settings:save':
      NA.storage.setSettings(msg.settings)
        .then((settings) => {
          broadcast(tabId, { type: 'na:settingsChanged' });
          respond({ ok: true, settings });
        })
        .catch((e) => respond({ ok: false, error: e.message }));
      return true;

    case 'profile:save':
      NA.storage.setProfile(msg.profile)
        .then(() => respond({ ok: true }))
        .catch((e) => respond({ ok: false, error: e.message }));
      return true;

    case 'fill:broadcast':
      if (tabId !== undefined) {
        chrome.tabs.sendMessage(tabId, { type: 'na:fill' }, () => void chrome.runtime.lastError);
      }
      respond({ ok: true });
      return false;

    case 'frame:result':
      if (tabId !== undefined) {
        chrome.tabs.sendMessage(
          tabId, { type: 'na:aggregate', result: msg.result }, { frameId: 0 },
          () => void chrome.runtime.lastError
        );
      }
      respond({ ok: true });
      return false;

    case 'cache:get':
      NA.storage.getCachedMapping(msg.hostname, msg.fingerprint)
        .then((mapping) => respond({ ok: true, mapping }))
        .catch(() => respond({ ok: false }));
      return true;

    case 'llm:mapFields':
      NA.storage.getSettings()
        .then(async (settings) => {
          if (!settings.enableLlmFallback || !settings.apiKey) {
            return respond({ ok: false, error: 'LLM fallback is off.' });
          }
          try {
            const mapping = await mapFieldsWithModel(settings, msg);
            await NA.storage.setCachedMapping(msg.hostname, msg.fingerprint, mapping);
            respond({ ok: true, mapping });
          } catch (e) {
            respond({ ok: false, error: e.message });
          }
        });
      return true;

    case 'llm:parseResume':
      NA.storage.getSettings()
        .then(async (settings) => {
          try {
            const parsed = await parseResumeWithModel(settings, {
              text: msg.text, base64: msg.base64, mediaType: msg.mediaType
            });
            respond({ ok: true, parsed });
          } catch (e) {
            respond({ ok: false, error: e.message });
          }
        });
      return true;

    case 'llm:test':
      NA.storage.getSettings()
        .then(async (settings) => {
          try {
            const merged = Object.assign({}, settings, msg.override || {});
            const res = await callAnthropic(merged, {
              model: merged.mappingModel,
              max_tokens: 16,
              messages: [{ role: 'user', content: 'Reply with the single word: ready' }]
            });
            respond({ ok: true, text: firstText(res).trim() });
          } catch (e) {
            respond({ ok: false, error: e.message });
          }
        });
      return true;

    case 'tracker:upsert':
      NA.storage.upsertApplication(msg.entry)
        .then((record) => respond({ ok: true, record }))
        .catch((e) => respond({ ok: false, error: e.message }));
      return true;

    case 'stats:bump':
      NA.storage.bumpStats({ filled: msg.filled || 0, skipped: msg.skipped || 0, sessions: 1 })
        .then((stats) => respond({ ok: true, stats }))
        .catch(() => respond({ ok: false }));
      return true;

    default:
      return false;
  }
});

function broadcast(tabId, message) {
  if (tabId === undefined) return;
  chrome.tabs.sendMessage(tabId, message, () => void chrome.runtime.lastError);
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage();
  }
});

self.NurseApplyDebug = { callAnthropic, extractJson, mapFieldsWithModel, frameAggregates };
