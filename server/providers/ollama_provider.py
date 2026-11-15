import json
import uuid
from typing import Any, Dict, List
import httpx

from ..config import settings
from .base import BaseLLMProvider, ProviderResponse
from .openai_provider import _convert_messages_to_openai, _convert_tools_to_openai


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
            "messages": _convert_messages_to_openai(messages, system_prompt),
            "stream": False,
            "options": {"temperature": temperature},
        }
        if tools:
            payload["tools"] = _convert_tools_to_openai(tools)

        async with httpx.AsyncClient(timeout=4.0) as client:
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
