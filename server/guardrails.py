import re
import unicodedata
from typing import Any, Dict, List, Optional, Set, Tuple


def normalize_text(text: str) -> str:
    nfd = unicodedata.normalize("NFD", (text or "").lower())
    return "".join(ch for ch in nfd if unicodedata.category(ch) != "Mn")


# 1. Prompt Injection Detection
INJECTION_PATTERNS = [
    r"ignore\s+(todas\s+as\s+|as\s+)?(regras|instrucoes|ordens|diretrizes)",
    r"ignore\s+(all\s+|previous\s+)?(instructions|rules|prompts)",
    r"esqueca\s+(tudo|suas\s+regras|suas\s+instrucoes|o\s+que\s+foi\s+dito)",
    r"(system\s*prompt|prompt\s+de\s+sistema|modo\s+desenvolvedor|developer\s+mode|jailbreak|dan\s+mode)",
    r"(mude|altere|reescreva)\s+suas\s+(regras|instrucoes|diretrizes)",
    r"a\s+partir\s+de\s+agora\s+voce\s+(nao\s+e|e\s+um)",
    r"finja\s+que\s+(nao\s+tem\s+regras|voce\s+e)",
]


def detect_prompt_injection(user_text: str) -> bool:
    norm = normalize_text(user_text)
    return any(re.search(pat, norm) for pat in INJECTION_PATTERNS)


# 2. Agrochemical / Pesticide Dosage Guardrail
PESTICIDE_PATTERNS = [
    r"\b(glifosato|paraquat|atrazina|2,4-d|clorpirifos|fipronil|acefato|carbofurano|malation|cipermetrina|deltametrina|lambda-cialotrina|imidacloprido|tiametoxam|mancozebe|tebuconazol)\b",
    r"(dosagem|dose|receita|quantos\s+ml|quantos\s+litros|quantas\s+gramas|proporcao\s+de\s+calda).*(agrotoxico|veneno|defensivo|herbicida|inseticida|fungicida|pulveriz)",
    r"(agrotoxico|veneno|defensivo\s+quimico|herbicida|inseticida|fungicida).*(dosagem|dose|receita|quantos\s+ml|quantos\s+litros|por\s+hectare|por\s+bomba)",
]


def detect_pesticide_prescription_request(text: str) -> bool:
    norm = normalize_text(text)
    return any(re.search(pat, norm) for pat in PESTICIDE_PATTERNS)


SAFE_INJECTION_RESPONSE = [
    "Eu sou a S.O.L., sua parceira no campo, e sigo regras firmes de segurança para cuidar da sua lavoura.",
    "Me conte o tamanho da sua área, o que você planta ou sua dúvida sobre a roça que a gente resolve juntos!"
]

SAFE_PESTICIDE_RESPONSE = [
    "Eu não posso indicar receitas nem dosagens de agrotóxicos ou defensivos químicos por segurança.",
    "Para qualquer aplicação química, consulte sempre o técnico agrícola da sua região e peça o receituário agronômico.",
    "Se quiser, posso te mostrar como a rotação de culturas e a cobertura do solo ajudam a quebrar o ciclo das pragas naturalmente!"
]


# 3. Spoken Text Sanitizer & Sentence Splitter (<= 200 chars, no markdown/emojis)
EMOJI_RE = re.compile(
    "["
    "\U0001F300-\U0001F9FF"
    "\U00002600-\U000027BF"
    "\U0001FA00-\U0001FAFF"
    "]+",
    flags=re.UNICODE,
)

PT_NUMBER_WORDS: Dict[str, float] = {
    "zero": 0,
    "meio": 0.5,
    "meia": 0.5,
    "dois": 2,
    "duas": 2,
    "tres": 3,
    "quatro": 4,
    "cinco": 5,
    "seis": 6,
    "sete": 7,
    "oito": 8,
    "nove": 9,
    "dez": 10,
    "onze": 11,
    "doze": 12,
    "treze": 13,
    "quatorze": 14,
    "catorze": 14,
    "quinze": 15,
    "dezesseis": 16,
    "dezessete": 17,
    "dezoito": 18,
    "dezenove": 19,
    "vinte": 20,
    "trinta": 30,
    "quarenta": 40,
    "cinquenta": 50,
    "sessenta": 60,
    "setenta": 70,
    "oitenta": 80,
    "noventa": 90,
    "cem": 100,
    "cento": 100,
    "duzentos": 200,
    "trezentos": 300,
    "quatrocentos": 400,
    "quinhentos": 500,
    "seiscentos": 600,
    "setecentos": 700,
    "oitocentos": 800,
    "novecentos": 900,
    "mil": 1000,
}

UNIT_FOLLOW_RE = re.compile(
    r"\b(um|uma)\s+(hectare|hectares|ha|tarefa|tarefas|metro|metros|alqueire|alqueires|saca|sacas|quilo|quilos|kg|tonelada|toneladas|milimetro|milimetros|mm|grau|graus|mes|meses|dia|dias|por\s+cento)\b"
)


def sanitize_spoken_text(text: str) -> str:
    if not text:
        return ""
    cleaned = EMOJI_RE.sub("", text)
    # Normalize dotted acronyms so sentence splitters and TTS do not break on internal periods
    cleaned = re.sub(r"\bS\.O\.L\.?", "SOL", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\bB\.I\.G\.?", "BIG", cleaned, flags=re.IGNORECASE)
    # Remove markdown formatting characters (*, _, #, `, ~, >, [ ], ( ))
    cleaned = re.sub(r"[*_#`~>|]", "", cleaned)
    cleaned = re.sub(r"^\s*[-•+]\s+", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"^\s*\d+[.)]\s+", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def split_speech_chunks(text: str, max_chars: int = 200) -> List[str]:
    cleaned = sanitize_spoken_text(text)
    if not cleaned:
        return []
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", cleaned) if s.strip()]
    raw_chunks: List[str] = []
    for sent in sentences:
        if len(sent) <= max_chars:
            raw_chunks.append(sent)
        else:
            # Split by commas/semicolons/conjunctions to stay under max_chars
            clauses = [c.strip() for c in re.split(r"(?<=[,;:])\s+", sent) if c.strip()]
            current = ""
            for clause in clauses:
                if not current:
                    current = clause
                elif len(current) + 1 + len(clause) <= max_chars:
                    current = f"{current} {clause}"
                else:
                    if not current.endswith((".", "!", "?")):
                        current += "."
                    raw_chunks.append(current)
                    current = clause
            if current:
                if len(current) <= max_chars:
                    if not current.endswith((".", "!", "?")):
                        current += "."
                    raw_chunks.append(current)
                else:
                    # Hard word-boundary wrap if a single clause exceeds max_chars
                    words = current.split(" ")
                    buf = ""
                    for w in words:
                        if not buf:
                            buf = w
                        elif len(buf) + 1 + len(w) <= max_chars - 1:
                            buf = f"{buf} {w}"
                        else:
                            raw_chunks.append(buf + ".")
                            buf = w
                    if buf:
                        if not buf.endswith((".", "!", "?")):
                            buf += "."
                        raw_chunks.append(buf)

    # Pack consecutive short sentences into chunks up to max_chars to minimize TTS round-trips
    packed: List[str] = []
    for ch in raw_chunks:
        if packed and len(packed[-1]) + 1 + len(ch) <= max_chars:
            packed[-1] = f"{packed[-1]} {ch}"
        else:
            packed.append(ch)
    return packed


# 4. Strict Numeric Grounding Verification
def _collect_numbers_from_data(data: Any, out: Set[float]) -> None:
    if data is None or isinstance(data, bool):
        return
    if isinstance(data, (int, float)):
        val = float(data)
        out.add(round(val, 4))
        out.add(round(val, 2))
        out.add(round(val, 1))
        out.add(float(round(val)))
        out.add(float(int(val)))
        # Also add common unit conversions if area/tons/sacks/percentages
        if 0 < val <= 1:
            out.add(round(val * 100, 1))
            out.add(float(round(val * 100)))
        return
    if isinstance(data, str):
        for m in re.finditer(r"-?\d+(?:[.,]\d+)?", data):
            try:
                num = float(m.group(0).replace(",", "."))
                _collect_numbers_from_data(num, out)
            except ValueError:
                pass
        return
    if isinstance(data, dict):
        for v in data.values():
            _collect_numbers_from_data(v, out)
        return
    if isinstance(data, (list, tuple, set)):
        for item in data:
            _collect_numbers_from_data(item, out)


def extract_allowed_numbers(
    tool_results: Optional[List[Dict[str, Any]]] = None,
    state_context: Optional[Dict[str, Any]] = None,
) -> Set[float]:
    allowed: Set[float] = set()
    if tool_results:
        _collect_numbers_from_data(tool_results, allowed)
    if state_context:
        # Exclude coordinate numbers or internal timestamps unless in analysis/area
        for key in ("area", "area_ha", "area_spoken", "plan", "analysis", "indicators", "strategies"):
            if key in state_context:
                _collect_numbers_from_data(state_context[key], allowed)
    # If analysis data is present, standard domain constants from build() (30 days window, 35°C threshold, 60kg sack) are valid
    has_analysis = bool(
        (state_context and (state_context.get("plan") or state_context.get("analysis")))
        or any(
            isinstance(tr, dict) and tr.get("name") in ("run_analysis", "change_area", "switch_strategy", "set_field")
            for tr in (tool_results or [])
        )
    )
    if has_analysis:
        for const in (30.0, 35.0, 60.0, 100.0):
            allowed.add(const)
    return allowed


def extract_spoken_numbers(text: str) -> List[float]:
    if not text:
        return []
    found: List[float] = []
    # 1. Digit numbers
    for m in re.finditer(r"(?<![a-zA-Z])\d+(?:[.,]\d+)?", text):
        try:
            val = float(m.group(0).replace(",", "."))
            found.append(val)
        except ValueError:
            pass

    # 2. Compound or standalone Portuguese number words
    norm = normalize_text(text)
    for _ in UNIT_FOLLOW_RE.finditer(norm):
        found.append(1.0)

    tokens = re.findall(r"[a-z]+", norm)
    i = 0
    while i < len(tokens):
        w = tokens[i]
        if w in PT_NUMBER_WORDS:
            total = PT_NUMBER_WORDS[w]
            j = i + 1
            while j < len(tokens):
                nxt = tokens[j]
                if nxt == "e" and j + 1 < len(tokens) and tokens[j + 1] in PT_NUMBER_WORDS:
                    val2 = PT_NUMBER_WORDS[tokens[j + 1]]
                    if val2 == 1000:
                        total = (total or 1) * 1000
                    else:
                        total += val2
                    j += 2
                elif nxt in PT_NUMBER_WORDS:
                    val2 = PT_NUMBER_WORDS[nxt]
                    if val2 == 1000:
                        total = (total or 1) * 1000
                    else:
                        total += val2
                    j += 1
                else:
                    break
            found.append(float(total))
            i = j
        else:
            i += 1
    return found


def is_number_allowed(num: float, allowed: Set[float], tolerance: float = 0.15) -> bool:
    if not allowed:
        return False
    for a in allowed:
        if abs(num - a) <= tolerance:
            return True
    return False


def verify_numeric_grounding(
    spoken_text: str,
    allowed_numbers: Set[float],
) -> Tuple[bool, List[float]]:
    """
    Returns (is_valid, ungrounded_numbers).
    Every number in spoken_text must match an entry in allowed_numbers.
    """
    spoken_nums = extract_spoken_numbers(spoken_text)
    if not spoken_nums:
        return True, []
    ungrounded = [n for n in spoken_nums if not is_number_allowed(n, allowed_numbers)]
    return len(ungrounded) == 0, ungrounded
