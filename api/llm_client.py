"""LLM client for Verity (adapted from Postura's provider-swappable client).

Two providers. The LLM is optional: every caller must fall back to
deterministic logic when `llm_enabled()` is False or when `complete()` raises.

Config (env):
  LLM_PROVIDER        "anthropic" (default) or "openai-compatible"
  ANTHROPIC_API_KEY   enables the Anthropic path
  LLM_BASE_URL        openai-compatible: base URL, e.g. https://api.example.com/v1 (POST {base}/chat/completions)
  LLM_API_KEY         openai-compatible: bearer token (optional for local servers)
  LLM_MODEL           model id; default "claude-sonnet-5" for Anthropic, required for openai-compatible
  LLM_TIMEOUT         default 30 (seconds; CPU inference on a small local model; no retries, so this
                      is the wall-clock cap). LLM_TIMEOUT_S is accepted as an older alias.
"""

from __future__ import annotations

import logging
import os

log = logging.getLogger("verity.llm")

DEFAULT_MODEL = "claude-sonnet-5"


class LLMUnavailable(Exception):
    """Hard-stop failure: missing key, missing SDK, auth, model not found."""


class LLMTransient(Exception):
    """This-call-only failure: rate limit, 5xx, timeout, refusal, empty output."""


def provider() -> str:
    p = (os.environ.get("LLM_PROVIDER") or "anthropic").strip().lower()
    return "openai-compatible" if p in ("openai-compatible", "openai") else "anthropic"


def _api_key() -> str | None:
    key = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    if not key or key.startswith("sk-ant-replace"):
        return None
    return key


def _openai_base_url() -> str | None:
    base = (os.environ.get("LLM_BASE_URL") or "").strip().rstrip("/")
    return base if base.startswith(("https://", "http://")) else None


def llm_enabled() -> bool:
    if provider() == "openai-compatible":
        return _openai_base_url() is not None and bool((os.environ.get("LLM_MODEL") or "").strip())
    return _api_key() is not None


def model_name() -> str:
    return (os.environ.get("LLM_MODEL") or "").strip() or DEFAULT_MODEL


DEFAULT_TIMEOUT_S = 30.0


def _timeout() -> float:
    raw = (os.environ.get("LLM_TIMEOUT") or os.environ.get("LLM_TIMEOUT_S") or "").strip()
    try:
        value = float(raw) if raw else DEFAULT_TIMEOUT_S
    except ValueError:
        return DEFAULT_TIMEOUT_S
    return value if 0 < value <= 300 else DEFAULT_TIMEOUT_S


def complete(system: str, user: str, *, max_tokens: int = 1024, temperature: float | None = None) -> str:
    """One completion with the configured provider. Returns the text."""
    if provider() == "openai-compatible":
        return _complete_openai_compatible(system, user, max_tokens=max_tokens, temperature=temperature)
    return _complete_anthropic(system, user, max_tokens=max_tokens)


def _complete_openai_compatible(system: str, user: str, *, max_tokens: int, temperature: float | None) -> str:
    """POST {LLM_BASE_URL}/chat/completions (OpenAI Chat Completions shape)."""
    import httpx

    base = _openai_base_url()
    if base is None or not llm_enabled():
        raise LLMUnavailable("LLM_BASE_URL / LLM_MODEL not set")
    headers = {"Content-Type": "application/json"}
    key = (os.environ.get("LLM_API_KEY") or "").strip()
    if key:
        headers["Authorization"] = f"Bearer {key}"
    payload = {
        "model": model_name(),
        "max_tokens": max_tokens,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
    }
    if temperature is not None:
        payload["temperature"] = temperature
    try:
        resp = httpx.post(f"{base}/chat/completions", json=payload, headers=headers, timeout=_timeout())
    except httpx.TimeoutException as e:
        raise LLMTransient("openai-compatible timeout") from e
    except httpx.HTTPError as e:
        raise LLMTransient(f"openai-compatible transport: {type(e).__name__}") from e
    if resp.status_code in (401, 403, 404):
        raise LLMUnavailable(f"openai-compatible HTTP {resp.status_code}")
    if resp.status_code >= 400:
        raise LLMTransient(f"openai-compatible HTTP {resp.status_code}")
    try:
        choice = resp.json()["choices"][0]
        text = (choice.get("message") or {}).get("content") or ""
    except (ValueError, KeyError, IndexError, TypeError, AttributeError) as e:
        raise LLMTransient("openai-compatible: unexpected response shape") from e
    if choice.get("finish_reason") == "content_filter":
        raise LLMTransient("model refused")
    text = text.strip() if isinstance(text, str) else ""
    if not text:
        raise LLMTransient("empty response")
    return text


def _complete_anthropic(system: str, user: str, *, max_tokens: int) -> str:
    """Single Messages API call. Returns the concatenated text blocks.
    Sampling params are left at the model defaults (not all Claude models accept `temperature`),
    and the token budget has a floor so effort/thinking can't starve the visible answer."""
    max_tokens = max(max_tokens, 1024)
    api_key = _api_key()
    if api_key is None:
        raise LLMUnavailable("ANTHROPIC_API_KEY not set")
    try:
        from anthropic import (
            Anthropic,
            APIConnectionError,
            APIStatusError,
            APITimeoutError,
            AuthenticationError,
            NotFoundError,
            PermissionDeniedError,
            RateLimitError,
        )
    except ImportError as e:  # pragma: no cover
        raise LLMUnavailable(f"anthropic SDK not installed: {e}") from e

    client = Anthropic(api_key=api_key, timeout=_timeout(), max_retries=0)
    try:
        msg = client.messages.create(
            model=model_name(),
            max_tokens=max_tokens,
            system=system,
            # Short, factual tasks: keep thinking effort low for latency.
            output_config={"effort": "low"},
            messages=[{"role": "user", "content": user}],
        )
    except (AuthenticationError, PermissionDeniedError) as e:
        raise LLMUnavailable(f"anthropic auth failed: {type(e).__name__}") from e
    except NotFoundError as e:
        raise LLMUnavailable(f"anthropic model not found ({model_name()})") from e
    except (RateLimitError, APITimeoutError, APIConnectionError, APIStatusError) as e:
        raise LLMTransient(f"anthropic transient: {type(e).__name__}") from e
    except Exception as e:  # noqa: BLE001
        raise LLMTransient(f"anthropic unexpected: {type(e).__name__}") from e

    if getattr(msg, "stop_reason", None) == "refusal":
        raise LLMTransient("model refused")
    text = "".join(getattr(b, "text", "") for b in msg.content if getattr(b, "type", "") == "text").strip()
    if not text:
        raise LLMTransient("empty response")
    return text
