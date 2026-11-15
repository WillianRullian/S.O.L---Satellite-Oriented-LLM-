import json
import os
from pathlib import Path
from typing import Any, Dict, List

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover
    def load_dotenv(*args: Any, **kwargs: Any) -> bool:
        return False

ROOT_DIR = Path(__file__).resolve().parent.parent

# Load .env.local and .env without overriding already-set environment variables
load_dotenv(ROOT_DIR / ".env.local", override=False)
load_dotenv(ROOT_DIR / ".env", override=False)


def load_models_registry() -> Dict[str, Any]:
    models_path = ROOT_DIR / "models.json"
    with open(models_path, "r", encoding="utf-8") as f:
        return json.load(f)


class Settings:
    @property
    def gemini_api_key(self) -> str:
        return os.getenv("GEMINI_API_KEY", "").strip()

    @property
    def openai_api_key(self) -> str:
        return os.getenv("OPENAI_API_KEY", "").strip()

    @property
    def ollama_base_url(self) -> str:
        return os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").strip().rstrip("/")

    @property
    def elevenlabs_api_key(self) -> str:
        return os.getenv("ELEVENLABS_API_KEY", "").strip()

    @property
    def default_model(self) -> str:
        return os.getenv("SOL_MODEL", os.getenv("SOL_DEFAULT_MODEL", "auto")).strip() or "auto"

    @property
    def port(self) -> int:
        try:
            return int(os.getenv("PORT", "8000"))
        except ValueError:
            return 8000


settings = Settings()
