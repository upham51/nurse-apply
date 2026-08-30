"""
An OpenAI-compatible model endpoint for NurseApply, running on Modal.

Why this exists: NurseApply's autopilot speaks the OpenAI chat-completions
protocol, so it can point at anything that does. Rather than pay a vendor per
token, this runs an open-weights model on Modal's GPUs and exposes exactly that
protocol, which means the extension needs no code change at all: pick
"Anything OpenAI-compatible", paste this URL and the key below.

Deploy:      modal deploy modal/vllm_server.py
Then use:    base URL  https://<workspace>--nurseapply-llm-serve.modal.run/v1
             API key   whatever is in the nurseapply-llm-key secret
             model     the value of MODEL_NAME below

Cost shape: the container scales to zero, so an idle day costs nothing, and a
cold start pays for the model load. SCALEDOWN_WINDOW keeps it warm between the
steps of one application, which is when the latency would actually be felt.
"""

import modal

# Qwen2.5 7B Instruct: small enough to load quickly and to fit an A10G, and
# reliable at the one thing autopilot asks for, which is short structured JSON.
MODEL_NAME = "Qwen/Qwen2.5-7B-Instruct"

GPU = "A10G"
SCALEDOWN_WINDOW = 10 * 60      # stay warm ten minutes after the last request
TIMEOUT = 30 * 60

# uv, not pip. pip spent minutes backtracking on transformers and got nowhere;
# uv resolved the same 157 packages in under a second. The versions are pinned
# for the same reason, so a build is a download rather than a solve.
vllm_image = (
    modal.Image.debian_slim(python_version="3.12")
    .uv_pip_install(
        "vllm==0.8.5.post1",
        "torch==2.6.0",
        "transformers==4.51.3",
        "huggingface_hub[hf_transfer]==0.30.2",
    )
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1", "VLLM_USE_V1": "1"})
)

# Weights are cached in a volume so only the first ever boot pays the download.
hf_cache = modal.Volume.from_name("nurseapply-hf-cache", create_if_missing=True)
vllm_cache = modal.Volume.from_name("nurseapply-vllm-cache", create_if_missing=True)

app = modal.App("nurseapply-llm")

# The endpoint is on the public internet, so it is not left unauthenticated:
# vLLM checks this against the Authorization header the extension sends.
api_key = modal.Secret.from_name("nurseapply-llm-key")


@app.function(
    image=vllm_image,
    gpu=GPU,
    scaledown_window=SCALEDOWN_WINDOW,
    timeout=TIMEOUT,
    volumes={"/root/.cache/huggingface": hf_cache, "/root/.cache/vllm": vllm_cache},
    secrets=[api_key],
)
@modal.concurrent(max_inputs=8)
@modal.web_server(port=8000, startup_timeout=15 * 60)
def serve():
    import os
    import subprocess

    subprocess.Popen(
        [
            "vllm", "serve", MODEL_NAME,
            "--served-model-name", MODEL_NAME, "nurseapply",
            "--host", "0.0.0.0",
            "--port", "8000",
            "--api-key", os.environ["NURSEAPPLY_LLM_KEY"],
            # A form step is a short prompt and a short answer. Capping the
            # context keeps the KV cache small enough to boot fast on one GPU.
            "--max-model-len", "8192",
            "--gpu-memory-utilization", "0.90",
            "--disable-log-requests",
            # The extension calls this from its service worker, so the server
            # answers the preflight itself rather than relying on the caller
            # having a matching host permission.
            "--allowed-origins", '["*"]',
            "--allowed-methods", '["*"]',
            "--allowed-headers", '["*"]',
        ]
    )
