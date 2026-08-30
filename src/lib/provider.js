/**
 * One chat client, several providers.
 *
 * Almost every model API worth using speaks the OpenAI chat-completions shape,
 * so that is the default and Kimi, DeepSeek, Groq, OpenRouter, Together and a
 * local llama server all work through it unchanged. Anthropic has its own
 * shape and gets a small adapter. Chrome's on-device model is handled
 * separately in localModel.js because it is not an HTTP API at all.
 *
 * Nothing here ever writes a key anywhere but chrome.storage.local, and keys
 * are excluded from profile export.
 */
(function (root) {
  'use strict';
  const NA = (root.NA = root.NA || {});

  const PROVIDERS = {
    moonshot: {
      label: 'Kimi (Moonshot)',
      kind: 'openai',
      baseUrl: 'https://api.moonshot.ai/v1',
      defaultModel: 'kimi-k2.6',
      keyHint: 'sk-…',
      console: 'https://platform.moonshot.ai'
    },
    anthropic: {
      label: 'Anthropic',
      kind: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      defaultModel: 'claude-haiku-4-5-20251001',
      keyHint: 'sk-ant-…',
      console: 'https://console.anthropic.com'
    },
    openai: {
      label: 'OpenAI',
      kind: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      defaultModel: 'gpt-4o-mini',
      keyHint: 'sk-…',
      console: 'https://platform.openai.com'
    },
    deepseek: {
      label: 'DeepSeek',
      kind: 'openai',
      baseUrl: 'https://api.deepseek.com/v1',
      defaultModel: 'deepseek-chat',
      keyHint: 'sk-…',
      console: 'https://platform.deepseek.com'
    },
    groq: {
      label: 'Groq',
      kind: 'openai',
      baseUrl: 'https://api.groq.com/openai/v1',
      defaultModel: 'llama-3.3-70b-versatile',
      keyHint: 'gsk_…',
      console: 'https://console.groq.com'
    },
    openrouter: {
      label: 'OpenRouter',
      kind: 'openai',
      baseUrl: 'https://openrouter.ai/api/v1',
      defaultModel: 'anthropic/claude-3.5-haiku',
      keyHint: 'sk-or-…',
      console: 'https://openrouter.ai'
    },
    custom: {
      label: 'Anything OpenAI-compatible',
      kind: 'openai',
      baseUrl: '',
      defaultModel: '',
      keyHint: '',
      console: ''
    }
  };

  function describe(id) {
    return PROVIDERS[id] || PROVIDERS.custom;
  }

  function resolve(settings) {
    const spec = describe(settings.provider || 'moonshot');
    return {
      kind: spec.kind,
      baseUrl: (settings.baseUrl || spec.baseUrl || '').replace(/\/+$/, ''),
      model: settings.model || spec.defaultModel,
      apiKey: settings.apiKey || '',
      label: spec.label
    };
  }

  /**
   * Turns a provider error into something a nurse can act on. "429" and a wall
   * of JSON is not actionable; "your account has no credit" is.
   */
  function explain(status, bodyText, cfg) {
    let detail = bodyText;
    try {
      const parsed = JSON.parse(bodyText);
      detail = (parsed.error && (parsed.error.message || parsed.error.type)) ||
               parsed.message || bodyText;
    } catch (e) { /* keep raw */ }

    const lower = String(detail).toLowerCase();
    if (/insufficient balance|exceeded_current_quota|quota|billing|recharge|credit/.test(lower)) {
      return `${cfg.label} has refused the request because the account is out of credit. ` +
             `Add funds and it will work again. (${detail})`;
    }
    if (status === 401 || status === 403 || /invalid api key|unauthorized|authentication/.test(lower)) {
      return `${cfg.label} rejected the API key. Check it was pasted in full. (${detail})`;
    }
    if (status === 404 && /model/.test(lower)) {
      return `${cfg.label} does not have a model called "${cfg.model}". Change it in Settings. (${detail})`;
    }
    if (status === 429) {
      return `${cfg.label} is rate limiting. Wait a moment and try again. (${detail})`;
    }
    return `${cfg.label} returned ${status}: ${detail}`;
  }

  /**
   * Sends one request and returns the assistant's text. `json` asks the
   * provider for a JSON object where it supports that, which materially
   * improves reliability on smaller models.
   */
  async function chat(settings, opts) {
    const cfg = resolve(settings);
    if (!cfg.apiKey) throw new Error('No API key saved. Open NurseApply settings and paste one in.');
    if (!cfg.baseUrl) throw new Error('No API address configured for this provider.');
    if (!cfg.model) throw new Error('No model name configured for this provider.');

    const request = cfg.kind === 'anthropic'
      ? anthropicRequest(cfg, opts)
      : openaiRequest(cfg, opts);

    let res;
    try {
      res = await fetch(request.url, {
        method: 'POST', headers: request.headers, body: JSON.stringify(request.body)
      });
    } catch (e) {
      throw new Error(`Could not reach ${cfg.label}. Check the connection. (${e.message})`);
    }

    const text = await res.text();
    if (!res.ok) throw new Error(explain(res.status, text, cfg));

    let parsed;
    try { parsed = JSON.parse(text); }
    catch (e) { throw new Error(`${cfg.label} returned something that was not JSON.`); }

    return cfg.kind === 'anthropic' ? anthropicText(parsed) : openaiText(parsed);
  }

  function openaiRequest(cfg, opts) {
    const body = {
      model: cfg.model,
      temperature: opts.temperature === undefined ? 0.1 : opts.temperature,
      max_tokens: opts.maxTokens || 2000,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user }
      ]
    };
    if (opts.json) body.response_format = { type: 'json_object' };
    return {
      url: cfg.baseUrl + '/chat/completions',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + cfg.apiKey },
      body
    };
  }

  function openaiText(parsed) {
    const choice = (parsed.choices || [])[0];
    return (choice && choice.message && choice.message.content) || '';
  }

  function anthropicRequest(cfg, opts) {
    return {
      url: cfg.baseUrl + '/messages',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: {
        model: cfg.model,
        max_tokens: opts.maxTokens || 2000,
        temperature: opts.temperature === undefined ? 0.1 : opts.temperature,
        system: opts.system,
        messages: [{ role: 'user', content: opts.user }]
      }
    };
  }

  function anthropicText(parsed) {
    const block = (parsed.content || []).find((b) => b.type === 'text');
    return block ? block.text : '';
  }

  /** Cheap round trip so Settings can tell the user whether it works. */
  async function test(settings) {
    const reply = await chat(settings, {
      system: 'You answer with one word.',
      user: 'Reply with the single word: ready',
      maxTokens: 16, json: false
    });
    return String(reply || '').trim().slice(0, 40);
  }

  NA.provider = { PROVIDERS, describe, resolve, chat, test, explain };
})(typeof self !== 'undefined' ? self : this);
