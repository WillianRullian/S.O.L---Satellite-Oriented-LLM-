const http = require("http");
const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");
const { ElevenLabsClient } = require("@elevenlabs/elevenlabs-js");

const PORT = Number(process.env.PORT) || 3000;
const DEFAULT_VOICE_ID = "cgSgspJ2msm6clMCkdW9"; // Jessica - Young, Playful, Bright, Warm
const client = process.env.ELEVENLABS_API_KEY ? new ElevenLabsClient() : null;

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1e5) reject(new Error("Payload too large"));
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

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsedUrl.pathname;

  if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
    const html = fs.readFileSync(path.join(__dirname, "index.html"));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(html);
  }

  if (req.method === "GET" && pathname === "/models.json") {
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

  if (req.method === "GET" && pathname === "/api/models") {
    const modelsJson = fs.readFileSync(path.join(__dirname, "models.json"));
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(modelsJson);
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
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: false, fallback: true, reason: "use_fastapi_or_offline_fallback" }));
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
