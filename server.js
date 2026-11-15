const http = require("http");
const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");
const { ElevenLabsClient } = require("@elevenlabs/elevenlabs-js");

const PORT = Number(process.env.PORT) || 3000;
const DEFAULT_VOICE_ID = "cgSgspJ2msm6clMCkdW9"; // Jessica - Young, Playful, Bright, Warm
const client = new ElevenLabsClient();

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
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    const html = fs.readFileSync(path.join(__dirname, "index.html"));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(html);
  }

  if (req.method === "GET" && req.url === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY) }));
  }

  if (req.method === "POST" && req.url === "/api/tts") {
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
