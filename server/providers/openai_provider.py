import json
import uuid
from typing import Any, Dict, List
try:
    import httpx
except ImportError:  # pragma: no cover
    httpx = None  # type: ignore

from ..config import settings
from .base import BaseLLMProvider, ProviderResponse


def _convert_tools_to_openai(tools: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out = []
    for t in tools:
        fn = t.get("function", t)
        out.append(
            {
                "type": "function",
                "function": {
                    "name": fn["name"],
                    "description": fn.get("description", ""),
                    "parameters": fn.get("parameters", {"type": "object", "properties": {}}),
                },
            }
        )
    return out


def _convert_messages_to_openai(
    messages: List[Dict[str, Any]], system_prompt: str
) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    if system_prompt:
        out.append({"role": "system", "content": system_prompt})
    for msg in messages:
        role = msg.get("role", "user")
        if role == "tool":
            out.append(
                {
                    "role": "tool",
                    "tool_call_id": msg.get("tool_call_id", "call_default"),
                    "name": msg.get("name", "tool"),
                    "content": (
                        msg["content"]
                        if isinstance(msg.get("content"), str)
                        else json.dumps(msg.get("content", {}), ensure_ascii=False)
                    ),
                }
            )
        elif role == "assistant" and msg.get("tool_calls"):
            tcs = []
            for tc in msg["tool_calls"]:
                tcs.append(
                    {
                        "id": tc.get("id", f"call_{uuid.uuid4().hex[:8]}"),
                        "type": "function",
                        "function": {
                            "name": tc.get("name"),
                            "arguments": json.dumps(tc.get("arguments", {}), ensure_ascii=False),
                        },
                    }
                )
            out.append(
                {
                    "role": "assistant",
                    "content": msg.get("content") or None,
                    "tool_calls": tcs,
                }
            )
        else:
            out.append({"role": role, "content": str(msg.get("content", ""))})
    return out


class OpenAIProvider(BaseLLMProvider):
    provider_name = "openai"

    def is_configured(self) -> bool:
        return bool(settings.openai_api_key)

    async def generate(
        self,
        messages: List[Dict[str, Any]],
        tools: List[Dict[str, Any]],
        system_prompt: str,
        model_name: str,
        temperature: float = 0.2,
    ) -> ProviderResponse:
        if not self.is_configured():
            raise RuntimeError("OPENAI_API_KEY not configured")

        payload: Dict[str, Any] = {
            "model": model_name,
            "messages": _convert_messages_to_openai(messages, system_prompt),
            "temperature": temperature,
            "max_tokens": 450,
        }
        if tools:
            payload["tools"] = _convert_tools_to_openai(tools)
            payload["tool_choice"] = "auto"

        headers = {
            "Authorization": f"Bearer {settings.openai_api_key}",
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers=headers,
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()

        choice = (data.get("choices") or [{}])[0].get("message", {})
        text = (choice.get("content") or "").strip()
        tool_calls: List[Dict[str, Any]] = []
        for tc in choice.get("tool_calls") or []:
            fn = tc.get("function", {})
            raw_args = fn.get("arguments", "{}")
            try:
                args = json.loads(raw_args) if isinstance(raw_args, str) else (raw_args or {})
            except ValueError:
                args = {}
            tool_calls.append(
                {
                    "id": tc.get("id", f"call_{uuid.uuid4().hex[:8]}"),
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
