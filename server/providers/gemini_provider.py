import json
import uuid
from typing import Any, Dict, List
try:
    import httpx
except ImportError:  # pragma: no cover
    httpx = None  # type: ignore

from ..config import settings
from .base import BaseLLMProvider, ProviderResponse


GEMINI_MODEL_MAP = {
    "gemini-2.5-flash": "gemini-3.5-flash-lite",
    "gemini-2.5-pro": "gemini-3.5-flash",
}


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
            raw_content = msg.get("content", "")
            if isinstance(raw_content, str):
                try:
                    parsed_res = json.loads(raw_content)
                except ValueError:
                    parsed_res = {"result": raw_content}
            else:
                parsed_res = raw_content
            if not isinstance(parsed_res, dict):
                parsed_res = {"result": parsed_res}
            fn_part = {
                "functionResponse": {
                    "name": msg.get("name", "tool"),
                    "response": parsed_res,
                }
            }
            if (
                contents
                and contents[-1].get("role") == "user"
                and contents[-1].get("parts")
                and "functionResponse" in contents[-1]["parts"][0]
            ):
                contents[-1]["parts"].append(fn_part)
            else:
                contents.append({"role": "user", "parts": [fn_part]})
        elif role == "assistant":
            parts: List[Dict[str, Any]] = []
            if msg.get("content"):
                parts.append({"text": str(msg["content"])})
            for tc in msg.get("tool_calls", []) or []:
                fc_part: Dict[str, Any] = {
                    "functionCall": {
                        "name": tc.get("name"),
                        "args": tc.get("arguments", {}),
                    }
                }
                if tc.get("thoughtSignature"):
                    fc_part["thoughtSignature"] = tc["thoughtSignature"]
                parts.append(fc_part)
            if parts:
                contents.append({"role": "model", "parts": parts})
        else:
            contents.append({"role": "user", "parts": [{"text": str(msg.get("content", ""))}]})
    return contents


class GeminiProvider(BaseLLMProvider):
    provider_name = "gemini"

    def __init__(self) -> None:
        self._client: httpx.AsyncClient | None = None

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=12.0)
        return self._client

    def is_configured(self) -> bool:
        return bool(settings.gemini_api_key)

    async def generate(
        self,
        messages: List[Dict[str, Any]],
        tools: List[Dict[str, Any]],
        system_prompt: str,
        model_name: str,
        temperature: float = 0.45,
    ) -> ProviderResponse:
        if not self.is_configured():
            raise RuntimeError("GEMINI_API_KEY not configured")

        actual_model = GEMINI_MODEL_MAP.get(model_name, model_name)
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{actual_model}:generateContent?key={settings.gemini_api_key}"
        )
        gen_cfg: Dict[str, Any] = {
            "temperature": temperature,
            "maxOutputTokens": 260,
        }
        if "lite" not in actual_model:
            gen_cfg["thinkingConfig"] = {"thinkingBudget": 0}

        payload: Dict[str, Any] = {
            "contents": _convert_messages_to_gemini(messages),
            "generationConfig": gen_cfg,
        }
        if system_prompt:
            payload["systemInstruction"] = {"parts": [{"text": system_prompt}]}
        if tools:
            payload["tools"] = _convert_tools_to_gemini(tools)

        client = self._get_client()
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
                    tc_item: Dict[str, Any] = {
                        "id": f"call_{uuid.uuid4().hex[:8]}",
                        "name": fc.get("name", ""),
                        "arguments": args or {},
                    }
                    if "thoughtSignature" in part:
                        tc_item["thoughtSignature"] = part["thoughtSignature"]
                    tool_calls.append(tc_item)

        return ProviderResponse(
            text=" ".join(text_parts).strip(),
            tool_calls=tool_calls,
            provider=self.provider_name,
            model_name=actual_model,
            raw=data,
        )
