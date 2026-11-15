import re
from typing import Any, Dict, List, Optional, Tuple

from .config import load_models_registry, settings
from .guardrails import normalize_text
from .providers import (
    BaseLLMProvider,
    GeminiProvider,
    OllamaProvider,
    OpenAIProvider,
    ProviderResponse,
)

REASONING_KEYWORDS = re.compile(
    r"\b(ndvi|smap|modis|ecostress|landsat|srtm|gpm|evapotranspiracao|deficit|balanco\s+hidrico|"
    r"capacidade\s+de\s+campo|erosao|declividade|nitrogenio|rizobio|rhizobium|fbn|"
    r"por\s+que|como\s+funciona|e\s+se|posso\s+plantar|quando\s+plantar|janela|risco|"
    r"compar|diferenca|explic|analis|diagnost)\b"
)


class ModelRouter:
    def __init__(self, registry: Optional[Dict[str, Any]] = None) -> None:
        self.registry = registry or load_models_registry()
        self.models_by_id: Dict[str, Dict[str, Any]] = {
            m["id"]: m for m in self.registry.get("models", [])
        }
        # Also map by provider model_name for convenience (e.g. ?model=gemini-2.5-flash)
        self.models_by_name: Dict[str, Dict[str, Any]] = {
            m["model_name"]: m for m in self.registry.get("models", [])
        }
        self.providers: Dict[str, BaseLLMProvider] = {
            "gemini": GeminiProvider(),
            "openai": OpenAIProvider(),
            "ollama": OllamaProvider(),
        }

    def resolve_model_entry(self, model_id_or_name: str) -> Optional[Dict[str, Any]]:
        if not model_id_or_name:
            return None
        if model_id_or_name in self.models_by_id:
            return self.models_by_id[model_id_or_name]
        if model_id_or_name in self.models_by_name:
            return self.models_by_name[model_id_or_name]
        return None

    def classify_turn_complexity(
        self, transcript: str, state_context: Optional[Dict[str, Any]] = None
    ) -> str:
        norm = normalize_text(transcript or "")
        if REASONING_KEYWORDS.search(norm):
            return "reasoning"
        # Multi-information turn or question marks / conditional questions
        if "?" in (transcript or "") or len(norm.split()) >= 8:
            return "reasoning"
        if state_context:
            # If all 3 slots are about to complete or already in ready state with open question
            if state_context.get("state") == "ready" and not re.search(
                r"\b(grafic|mostr|escond|fech|ocult|outro|proxim|recome)\b", norm
            ):
                return "reasoning"
        return "fast"

    def build_candidate_chain(
        self,
        requested_model: Optional[str] = None,
        transcript: str = "",
        state_context: Optional[Dict[str, Any]] = None,
    ) -> Tuple[List[Dict[str, Any]], str]:
        """Returns (ordered_list_of_model_entries, complexity_tier)."""
        tier = self.classify_turn_complexity(transcript, state_context)
        choice = (requested_model or "").strip() or settings.default_model or "auto"

        ordered_ids: List[str] = []
        if choice and choice.lower() != "auto":
            entry = self.resolve_model_entry(choice)
            if entry:
                ordered_ids.append(entry["id"])

        policy = self.registry.get("routing_policy", {})
        if tier == "reasoning":
            for key in ("reasoning_turn_default", "reasoning_turn_secondary"):
                mid = policy.get(key)
                if mid and mid not in ordered_ids:
                    ordered_ids.append(mid)
        else:
            for key in ("simple_turn_default", "simple_turn_cloud_fallback"):
                mid = policy.get(key)
                if mid and mid not in ordered_ids:
                    ordered_ids.append(mid)

        for fallback_id in self.registry.get("fallback_chain", []):
            if fallback_id not in ordered_ids:
                ordered_ids.append(fallback_id)

        candidates = [
            self.models_by_id[mid] for mid in ordered_ids if mid in self.models_by_id
        ]
        return candidates, tier

    async def route_and_generate(
        self,
        messages: List[Dict[str, Any]],
        tools: List[Dict[str, Any]],
        system_prompt: str,
        requested_model: Optional[str] = None,
        transcript: str = "",
        state_context: Optional[Dict[str, Any]] = None,
        temperature: float = 0.2,
    ) -> Tuple[Optional[ProviderResponse], Dict[str, Any]]:
        candidates, tier = self.build_candidate_chain(
            requested_model=requested_model,
            transcript=transcript,
            state_context=state_context,
        )
        attempted: List[Dict[str, str]] = []

        for entry in candidates:
            prov_name = entry["provider"]
            provider = self.providers.get(prov_name)
            if not provider or not provider.is_configured():
                attempted.append({"id": entry["id"], "status": "unconfigured"})
                continue
            try:
                resp = await provider.generate(
                    messages=messages,
                    tools=tools,
                    system_prompt=system_prompt,
                    model_name=entry["model_name"],
                    temperature=temperature,
                )
                meta = {
                    "selected_model_id": entry["id"],
                    "provider": prov_name,
                    "model_name": entry["model_name"],
                    "tier": tier,
                    "local": entry.get("local", False),
                    "attempted": attempted + [{"id": entry["id"], "status": "ok"}],
                }
                return resp, meta
            except Exception as exc:
                attempted.append(
                    {"id": entry["id"], "status": f"error: {type(exc).__name__}"}
                )
                continue

        return None, {
            "selected_model_id": None,
            "tier": tier,
            "attempted": attempted,
            "fallback": True,
        }
