from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Dict, List, Optional


@dataclass
class ProviderResponse:
    text: str = ""
    tool_calls: List[Dict[str, Any]] = field(default_factory=list)
    provider: str = ""
    model_name: str = ""
    raw: Optional[Dict[str, Any]] = None


class BaseLLMProvider(ABC):
    provider_name: str = "base"

    @abstractmethod
    def is_configured(self) -> bool:
        """Returns True if the provider has necessary credentials/endpoints configured."""
        raise NotImplementedError

    @abstractmethod
    async def generate(
        self,
        messages: List[Dict[str, Any]],
        tools: List[Dict[str, Any]],
        system_prompt: str,
        model_name: str,
        temperature: float = 0.2,
    ) -> ProviderResponse:
        """Executes a single inference turn and returns text and/or tool calls."""
        raise NotImplementedError

    async def stream(
        self,
        messages: List[Dict[str, Any]],
        tools: List[Dict[str, Any]],
        system_prompt: str,
        model_name: str,
        temperature: float = 0.2,
    ) -> AsyncIterator[Dict[str, Any]]:
        """Yields streaming events: {'type': 'tool_call'|'text_delta'|'done', ...}."""
        resp = await self.generate(
            messages=messages,
            tools=tools,
            system_prompt=system_prompt,
            model_name=model_name,
            temperature=temperature,
        )
        for tc in resp.tool_calls:
            yield {"type": "tool_call", "tool_call": tc}
        if resp.text:
            yield {"type": "text_delta", "delta": resp.text}
        yield {
            "type": "done",
            "text": resp.text,
            "tool_calls": resp.tool_calls,
            "provider": resp.provider or self.provider_name,
            "model_name": resp.model_name or model_name,
        }
