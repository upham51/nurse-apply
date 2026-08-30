# Running the model yourself on Modal

NurseApply's autopilot speaks the OpenAI chat-completions protocol, so it can
point at anything that speaks it back. This deploys an open-weights model on
Modal's GPUs and exposes exactly that protocol, which means you pay for compute
by the second instead of paying a vendor per token, and the extension needs no
change: choose **Anything OpenAI-compatible** in Settings and paste the URL.

## Deploy

```
pip install modal
modal token set --token-id ak-... --token-secret as-...

# The endpoint is public, so give it a key of its own.
modal secret create nurseapply-llm-key NURSEAPPLY_LLM_KEY="$(openssl rand -base64 32)"

modal deploy modal/vllm_server.py
```

Modal prints a URL ending in `.modal.run`. In NurseApply's Settings:

| Field | Value |
| --- | --- |
| Model provider | Anything OpenAI-compatible |
| API address | `https://<your-workspace>--nurseapply-llm-serve.modal.run/v1` |
| API key | the value you put in `nurseapply-llm-key` |
| Model | `nurseapply` |

Press **Test**. The first call is slow, see below.

## Measured, not claimed

Deployed and run against a twenty-field application step, scored field by
field: **18 of 18 correct**, no value outside a dropdown's real options, none
missing, 9.6 seconds for the step. Weights load in about 35 seconds once
cached, and a warm request answers in under half a second.

One thing it gets wrong: arithmetic. Asked for "Total Years of Nursing
Experience" from a start date of March 2019 it answered 4, not 7. That field is
computed by the rule engine, which runs first, so the model never gets it. It is
a good reminder that the rules are not legacy scaffolding to be removed.

## What it costs, honestly

The container scales to zero, so an idle week costs nothing. An A10G is around
a dollar an hour while it is up, and `SCALEDOWN_WINDOW` keeps it warm for ten
minutes after the last request so it does not restart between the steps of one
application. Filling applications is a few seconds of GPU each, so the real
cost is the warm window: roughly ten minutes of GPU per burst of applying.

## The cold start is real

The first request after an idle period waits for the container to boot and the
model to load, which is a minute or two. The weights are cached in a Modal
volume, so only the very first deploy pays the download.

In practice: press **Test** in Settings before you start applying. That wakes it
up, and everything after that is fast.

## Choosing a different model

`MODEL_NAME` at the top of `vllm_server.py`. Qwen2.5-7B-Instruct is the default
because it is reliable at short structured JSON, which is the only thing
autopilot asks for, and it fits one A10G comfortably. A larger model will answer
the odd freeform question better and will need a bigger GPU and a longer boot.

## Verifying it actually works

The autopilot harness can be pointed at any endpoint, so you can measure a real
model against a real four-step application rather than trusting a claim:

```
AUTOPILOT_BASE_URL=https://<...>.modal.run/v1 \
AUTOPILOT_KEY=<your key> \
AUTOPILOT_MODEL=nurseapply \
npm run test:autopilot
```
