import json
import uuid
from typing import Any, Dict, List
try:
    import httpx
except ImportError:  # pragma: no cover
    httpx = None  # type: ignore

from ..config import settings
from .base import BaseLLMProvider, ProviderResponse


def _convert_tools_to_gemini(tools: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not tools:
        return []
    declarations = []
    for t in tools:
        fn = t.get("function", t)
        declarations.append(
            {
                "name": fn["name"],
                "description": fn.get("description", ""),
                "parameters": fn.get("parameters", {"type": "OBJECT", "properties": {}}),
            }
        )
    return [{"functionDeclarations": declarations}]


def _convert_messages_to_gemini(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    contents: List[Dict[str, Any]] = []
    for msg in messages:
        role = msg.get("role", "user")
        if role == "system":
            continue
        if role == "tool":
            contents.append(
                {
                    "role": "user",
                    "parts": [
                        {
                            "functionResponse": {
                                "name": msg.get("name", "tool"),
                                "response": {"result": msg.get("content", "")},
                            }
                        }
                    ],
                }
            )
        elif role == "assistant":
            parts: List[Dict[str, Any]] = []
            if msg.get("content"):
                parts.append({"text": str(msg["content"])})
            for tc in msg.get("tool_calls", []) or []:
                parts.append(
                    {
                        "functionCall": {
                            "name": tc.get("name"),
                            "args": tc.get("arguments", {}),
                        }
                    }
                )
            if parts:
                contents.append({"role": "model", "parts": parts})
        else:
            contents.append({"role": "user", "parts": [{"text": str(msg.get("content", ""))}]})
    return contents


class GeminiProvider(BaseLLMProvider):
    provider_name = "gemini"

    def is_configured(self) -> bool:
        return bool(settings.gemini_api_key)

    async def generate(
        self,
        messages: List[Dict[str, Any]],
        tools: List[Dict[str, Any]],
        system_prompt: str,
        model_name: str,
        temperature: float = 0.2,
    ) -> ProviderResponse:
        if not self.is_configured():
            raise RuntimeError("GEMINI_API_KEY not configured")

        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model_name}:generateContent?key={settings.gemini_api_key}"
        )
        payload: Dict[str, Any] = {
            "contents": _convert_messages_to_gemini(messages),
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": 450,
            },
        }
        if system_prompt:
            payload["systemInstruction"] = {"parts": [{"text": system_prompt}]}
        if tools:
            payload["tools"] = _convert_tools_to_gemini(tools)

        async with httpx.AsyncClient(timeout=6.0) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            data = resp.json()

        text_parts: List[str] = []
        tool_calls: List[Dict[str, Any]] = []
        candidates = data.get("candidates", [])
        if candidates:
            parts = candidates[0].get("content", {}).get("parts", [])
            for part in parts:
                if "text" in part and part["text"]:
                    text_parts.append(part["text"])
                if "functionCall" in part:
                    fc = part["functionCall"]
                    args = fc.get("args", {})
                    if isinstance(args, str):
                        try:
                            args = json.loads(args)
                        except ValueError:
                            args = {}
                    tool_calls.append(
                        {
                            "id": f"call_{uuid.uuid4().hex[:8]}",
                            "name": fc.get("name", ""),
                            "arguments": args or {},
                        }
                    )

        return ProviderResponse(
            text=" ".join(text_parts).strip(),
            tool_calls=tool_calls,
            provider=self.provider_name,
            model_name=model_name,
            raw=data,
        )
