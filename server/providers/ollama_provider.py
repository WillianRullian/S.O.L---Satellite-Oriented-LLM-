import json
import uuid
from typing import Any, Dict, List

try:
    import httpx
except ImportError:  # pragma: no cover
    httpx = None  # type: ignore

from ..config import settings
from .base import BaseLLMProvider, ProviderResponse
from .openai_provider import _convert_tools_to_openai


def _convert_messages_to_ollama(
    messages: List[Dict[str, Any]], system_prompt: str
) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    if system_prompt:
        out.append({"role": "system", "content": system_prompt})
    for msg in messages:
        role = msg.get("role", "user")
        if role == "tool":
            content = msg.get("content", "")
            if not isinstance(content, str):
                content = json.dumps(content, ensure_ascii=False)
            out.append({"role": "tool", "content": content})
        elif role == "assistant" and msg.get("tool_calls"):
            tcs = []
            for tc in msg["tool_calls"]:
                raw_args = tc.get("arguments", {})
                if isinstance(raw_args, str):
                    try:
                        args = json.loads(raw_args)
                    except ValueError:
                        args = {}
                else:
                    args = raw_args or {}
                tcs.append(
                    {
                        "function": {
                            "name": tc.get("name", ""),
                            "arguments": args,
                        }
                    }
                )
            out.append(
                {
                    "role": "assistant",
                    "content": str(msg.get("content") or ""),
                    "tool_calls": tcs,
                }
            )
        else:
            out.append({"role": role, "content": str(msg.get("content") or "")})
    return out


class OllamaProvider(BaseLLMProvider):
    provider_name = "ollama"

    def is_configured(self) -> bool:
        return bool(settings.ollama_base_url)

    async def generate(
        self,
        messages: List[Dict[str, Any]],
        tools: List[Dict[str, Any]],
        system_prompt: str,
        model_name: str,
        temperature: float = 0.2,
    ) -> ProviderResponse:
        url = f"{settings.ollama_base_url}/api/chat"
        payload: Dict[str, Any] = {
            "model": model_name,
            "messages": _convert_messages_to_ollama(messages, system_prompt),
            "stream": False,
            "options": {"temperature": temperature},
        }
        if tools:
            payload["tools"] = _convert_tools_to_openai(tools)

        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(url, json=payload)
            if resp.status_code == 404:
                tags_resp = await client.get(f"{settings.ollama_base_url}/api/tags")
                if tags_resp.status_code == 200:
                    models_list = tags_resp.json().get("models") or []
                    if models_list:
                        fallback_model = (
                            models_list[0].get("name") or models_list[0].get("model")
                        )
                        if fallback_model:
                            payload["model"] = fallback_model
                            model_name = fallback_model
                            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            data = resp.json()

        msg = data.get("message", {})
        text = (msg.get("content") or "").strip()
        tool_calls: List[Dict[str, Any]] = []
        for tc in msg.get("tool_calls") or []:
            fn = tc.get("function", {})
            raw_args = fn.get("arguments", {})
            if isinstance(raw_args, str):
                try:
                    args = json.loads(raw_args)
                except ValueError:
                    args = {}
            else:
                args = raw_args or {}
            tool_calls.append(
                {
                    "id": f"call_{uuid.uuid4().hex[:8]}",
                    "name": fn.get("name", ""),
                    "arguments": args,
                }
            )

        return ProviderResponse(
            text=text,
            tool_calls=tool_calls,
            provider=self.provider_name,
            model_name=model_name,
            raw=data,
        )
