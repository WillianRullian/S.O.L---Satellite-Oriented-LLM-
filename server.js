const http = require("http");
const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");
const { ElevenLabsClient } = require("@elevenlabs/elevenlabs-js");
const SOLPrompts = require("./agent/prompts.js");

// Load .env and .env.local automatically if present
for (const envFile of [".env", ".env.local"]) {
  const fullPath = path.join(__dirname, envFile);
  if (fs.existsSync(fullPath)) {
    const content = fs.readFileSync(fullPath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "").trim();
      }
    }
  }
}

const PORT = Number(process.env.PORT) || 3000;
const DEFAULT_VOICE_ID = "cgSgspJ2msm6clMCkdW9"; // Jessica - Young, Playful, Bright, Warm
const client = process.env.ELEVENLABS_API_KEY ? new ElevenLabsClient() : null;
const providerCooldownUntil = {};

function loadModelsRegistry() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "models.json"), "utf8"));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 5e5) reject(new Error("Payload too large"));
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function normText(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function detectPromptInjection(text) {
  const n = normText(text);
  return /(ignore\s+(todas\s+as\s+|as\s+)?(regras|instrucoes|ordens|diretrizes)|ignore\s+(all\s+|previous\s+)?(instructions|rules)|esqueca\s+(tudo|suas\s+regras)|system\s*prompt|modo\s+desenvolvedor|jailbreak)/.test(n);
}

function detectPesticideRequest(text) {
  const n = normText(text);
  return /(\b(glifosato|paraquat|atrazina|2,4-d|clorpirifos|fipronil|acefato|carbofurano|malation|cipermetrina|deltametrina)\b|(dosagem|dose|receita|quantos\s+ml|quantos\s+litros).*(agrotoxico|veneno|defensivo|herbicida|inseticida|fungicida)|(agrotoxico|veneno|defensivo\s+quimico|herbicida|inseticida).*(dosagem|dose|receita|por\s+hectare))/.test(n);
}

async function callOllama(messages, tools, systemPrompt, modelName) {
  const baseUrl = (process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/$/, "");
  const oaMessages = [];
  if (systemPrompt) oaMessages.push({ role: "system", content: systemPrompt });
  for (const m of messages || []) {
    if (m.role === "tool") {
      oaMessages.push({
        role: "tool",
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content || {}),
      });
    } else if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      oaMessages.push({
        role: "assistant",
        content: m.content || "",
        tool_calls: m.tool_calls.map((tc) => ({
          function: {
            name: tc.name,
            arguments: typeof tc.arguments === "object" ? tc.arguments : JSON.parse(tc.arguments || "{}"),
          },
        })),
      });
    } else {
      oaMessages.push({ role: m.role || "user", content: String(m.content || "") });
    }
  }
  const payload = {
    model: modelName || "llama3.1:8b",
    messages: oaMessages,
    stream: false,
    options: { temperature: 0.2 },
  };
  if (Array.isArray(tools) && tools.length) payload.tools = tools;

  const r = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`Ollama HTTP ${r.status}`);
  const data = await r.json();
  const msg = data.message || {};
  const toolCalls = (msg.tool_calls || []).map((tc, i) => ({
    id: `call_ollama_${Date.now()}_${i}`,
    name: tc.function?.name || "",
    arguments: tc.function?.arguments || {},
  }));
  return { text: (msg.content || "").trim(), tool_calls: toolCalls, provider: "ollama", model_name: payload.model };
}

async function callOpenAI(messages, tools, systemPrompt, modelName) {
  const key = (process.env.OPENAI_API_KEY || "").trim();
  if (!key) throw new Error("OPENAI_API_KEY missing");
  const oaMessages = [];
  if (systemPrompt) oaMessages.push({ role: "system", content: systemPrompt });
  for (const m of messages || []) {
    if (m.role === "tool") {
      oaMessages.push({
        role: "tool",
        tool_call_id: m.tool_call_id || "call_0",
        name: m.name || "tool",
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content || {}),
      });
    } else if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      oaMessages.push({
        role: "assistant",
        content: m.content || null,
        tool_calls: m.tool_calls.map((tc, i) => ({
          id: tc.id || `call_${i}`,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments || {}) },
        })),
      });
    } else {
      oaMessages.push({ role: m.role || "user", content: String(m.content || "") });
    }
  }
  const payload = { model: modelName, messages: oaMessages, temperature: 0.2, max_tokens: 450 };
  if (Array.isArray(tools) && tools.length) payload.tools = tools;
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`OpenAI HTTP ${r.status}`);
  const data = await r.json();
  const choice = data.choices?.[0]?.message || {};
  const toolCalls = (choice.tool_calls || []).map((tc) => ({
    id: tc.id,
    name: tc.function?.name || "",
    arguments: JSON.parse(tc.function?.arguments || "{}"),
  }));
  return { text: (choice.content || "").trim(), tool_calls: toolCalls, provider: "openai", model_name: modelName };
}

const GEMINI_MODEL_MAP = {
  "gemini-2.5-flash": "gemini-3.5-flash-lite",
  "gemini-2.5-pro": "gemini-3.5-flash",
};

async function callGemini(messages, tools, systemPrompt, modelName) {
  const key = (process.env.GEMINI_API_KEY || "").trim();
  if (!key) throw new Error("GEMINI_API_KEY missing");
  const actualModel = GEMINI_MODEL_MAP[modelName] || modelName;
  const contents = [];
  for (const m of messages || []) {
    if (m.role === "tool") {
      let parsedRes = m.content;
      if (typeof parsedRes === "string") {
        try {
          parsedRes = JSON.parse(parsedRes);
        } catch {
          parsedRes = { result: parsedRes };
        }
      }
      if (!parsedRes || typeof parsedRes !== "object" || Array.isArray(parsedRes)) {
        parsedRes = { result: parsedRes };
      }
      const fnPart = {
        functionResponse: { name: m.name || "tool", response: parsedRes },
      };
      const prev = contents[contents.length - 1];
      if (prev && prev.role === "user" && prev.parts?.[0]?.functionResponse) {
        prev.parts.push(fnPart);
      } else {
        contents.push({ role: "user", parts: [fnPart] });
      }
    } else if (m.role === "assistant") {
      const parts = [];
      if (m.content) parts.push({ text: String(m.content) });
      for (const tc of m.tool_calls || []) {
        const fcPart = { functionCall: { name: tc.name, args: tc.arguments || {} } };
        if (tc.thoughtSignature) fcPart.thoughtSignature = tc.thoughtSignature;
        parts.push(fcPart);
      }
      if (parts.length) contents.push({ role: "model", parts });
    } else {
      contents.push({ role: "user", parts: [{ text: String(m.content || "") }] });
    }
  }
  const genCfg = { temperature: 0.2, maxOutputTokens: 350 };
  if (!actualModel.includes("lite")) {
    genCfg.thinkingConfig = { thinkingBudget: 0 };
  }
  const payload = {
    contents,
    generationConfig: genCfg,
  };
  if (systemPrompt) payload.systemInstruction = { parts: [{ text: systemPrompt }] };
  if (Array.isArray(tools) && tools.length) {
    payload.tools = [{ functionDeclarations: tools.map((t) => t.function || t) }];
  }
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${actualModel}:generateContent?key=${key}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
  );
  if (!r.ok) throw new Error(`Gemini HTTP ${r.status}`);
  const data = await r.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  const textParts = [];
  const toolCalls = [];
  parts.forEach((p, i) => {
    if (p.text) textParts.push(p.text);
    if (p.functionCall) {
      const tcItem = {
        id: `call_gemini_${Date.now()}_${i}`,
        name: p.functionCall.name,
        arguments: p.functionCall.args || {},
      };
      if (p.thoughtSignature) tcItem.thoughtSignature = p.thoughtSignature;
      toolCalls.push(tcItem);
    }
  });
  return { text: textParts.join(" ").trim(), tool_calls: toolCalls, provider: "gemini", model_name: actualModel };
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsedUrl.pathname;

  if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
    const html = fs.readFileSync(path.join(__dirname, "index.html"));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(html);
  }

  if (req.method === "GET" && (pathname === "/models.json" || pathname === "/api/models")) {
    const modelsJson = fs.readFileSync(path.join(__dirname, "models.json"));
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(modelsJson);
  }

  if (req.method === "GET" && pathname.startsWith("/agent/")) {
    const safeRel = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
    const filePath = path.join(__dirname, safeRel);
    const agentDir = path.join(__dirname, "agent");
    if (filePath.startsWith(agentDir) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
      return res.end(fs.readFileSync(filePath));
    }
  }

  if (req.method === "GET" && pathname === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({
        ok: true,
        elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
        agent: true,
        default_model: process.env.SOL_MODEL || "auto",
      })
    );
  }

  if (req.method === "POST" && pathname === "/api/agent/chat") {
    try {
      const body = await readJson(req);
      const userInput = body.raw_transcript || body.transcript || "";

      if (detectPromptInjection(userInput)) {
        const chunks = [
          "Eu sou a S.O.L., sua parceira no campo, e sigo regras firmes de segurança para cuidar da sua lavoura.",
          "Me conte o tamanho da sua área, o que você planta ou sua dúvida sobre a roça que a gente resolve juntos!",
        ];
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: true, fallback: false, text: chunks.join(" "), chunks, tool_calls: [], guardrail: "prompt_injection_blocked" }));
      }

      if (detectPesticideRequest(userInput)) {
        const chunks = [
          "Eu não posso indicar receitas nem dosagens de agrotóxicos ou defensivos químicos por segurança.",
          "Para qualquer aplicação química, consulte sempre o técnico agrícola da sua região e peça o receituário agronômico.",
        ];
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: true, fallback: false, text: chunks.join(" "), chunks, tool_calls: [], guardrail: "pesticide_dosage_blocked" }));
      }

      const registry = loadModelsRegistry();
      const byId = Object.fromEntries((registry.models || []).map((m) => [m.id, m]));
      const requested = (parsedUrl.searchParams.get("model") || body.model || process.env.SOL_MODEL || "auto").trim();
      const order = [];
      if (requested && requested !== "auto" && byId[requested]) order.push(requested);
      order.push("gemini-flash", "gemini-pro", "openai-mini", "openai-flagship", "ollama-local");
      const uniqueIds = [...new Set(order)].filter((id) => byId[id]);

      const sysPrompt = `${SOLPrompts.SYSTEM_PROMPT}\n\n${body.system_prompt || ""}`;
      let resp = null;
      let chosenMeta = null;
      const now = Date.now();

      for (const id of uniqueIds) {
        const entry = byId[id];
        if ((providerCooldownUntil[entry.provider] || 0) > now && uniqueIds.length > 1) {
          continue;
        }
        try {
          if (entry.provider === "gemini") {
            resp = await callGemini(body.messages, body.tools, sysPrompt, entry.model_name);
          } else if (entry.provider === "openai") {
            resp = await callOpenAI(body.messages, body.tools, sysPrompt, entry.model_name);
          } else if (entry.provider === "ollama") {
            resp = await callOllama(body.messages, body.tools, sysPrompt, entry.model_name);
          }
          if (resp) {
            delete providerCooldownUntil[entry.provider];
            chosenMeta = { selected_model_id: id, provider: entry.provider, model_name: resp.model_name || entry.model_name };
            break;
          }
        } catch (e) {
          providerCooldownUntil[entry.provider] = Date.now() + 120000;
        }
      }

      if (!resp) {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: false, fallback: true, reason: "no_provider_available" }));
      }

      const chunks = resp.text ? SOLPrompts.splitSpeechChunks(resp.text, 200) : [];
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({
          ok: true,
          fallback: false,
          text: chunks.join(" "),
          chunks,
          tool_calls: resp.tool_calls || [],
          meta: chosenMeta,
        })
      );
    } catch (err) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, fallback: true, reason: err.message }));
    }
  }

  if (req.method === "POST" && pathname === "/api/tts") {
    if (!client) {
      res.writeHead(503, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "ELEVENLABS_API_KEY not configured" }));
    }
    try {
      const { text, voiceId, previousText, nextText } = await readJson(req);
      if (!text || typeof text !== "string") {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "Missing text" }));
      }
      const opts = {
        text,
        modelId: "eleven_v4",
        outputFormat: "mp3_44100_128",
        voiceSettings: {
          stability: 0.4,
          similarityBoost: 0.75,
        },
      };
      if (previousText) opts.previousText = previousText;
      if (nextText) opts.nextText = nextText;

      const audio = await client.textToSpeech.convert(voiceId || DEFAULT_VOICE_ID, opts);
      res.writeHead(200, {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      });
      Readable.fromWeb(audio).pipe(res);
    } catch (err) {
      console.error("TTS error:", err.statusCode || "", err.message || err);
      res.writeHead(err.statusCode || 500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message || "TTS failed" }));
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`S.O.L. server running at http://localhost:${PORT}`);
});
