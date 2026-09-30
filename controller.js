import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { analyzeWithGemini } from "./lib/gemini-analyze.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const launcher = path.join(root, "START_FRAMEWISE.bat");
const port = Number(process.env.CONTROLLER_PORT || 3001);
const analysisServer = process.env.ANALYSIS_SERVER || "http://127.0.0.1:3000";
let starting = false;

// ---- settings from .env (GEMINI_API_KEY, GEMINI_MODEL, DAILY_LIMIT_PER_VISITOR) ----
function loadEnv() {
  try {
    for (const line of fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}
loadEnv();
const geminiKey = () => process.env.GEMINI_API_KEY || "";
const dailyLimit = Number(process.env.DAILY_LIMIT_PER_VISITOR || 20);
const totalLimit = Number(process.env.DAILY_LIMIT_TOTAL || 1000);
const usage = new Map();
let totals = { day: "", count: 0 };
function allowVisitor(request) {
  const today = new Date().toISOString().slice(0, 10);
  if (totals.day !== today) { totals = { day: today, count: 0 }; usage.clear(); }
  if (totals.count >= totalLimit) return "The site has reached today's analysis limit. Please try again tomorrow.";
  const forwarded = String(request.headers["x-forwarded-for"] || request.headers["tailscale-user-login"] || "").split(",")[0].trim();
  if (forwarded) {
    const count = usage.get(forwarded) || 0;
    if (count >= dailyLimit) return `Daily limit reached (${dailyLimit} analyses per day). Please try again tomorrow.`;
    usage.set(forwarded, count + 1);
  }
  totals.count += 1;
  return "";
}
async function proxyToQwen(contentType, body) {
  const proxied = await fetch(`${analysisServer}/api/analyze-image`, { method: "POST", headers: { "content-type": contentType }, body });
  return { status: proxied.status, type: proxied.headers.get("content-type") || "application/json", body: Buffer.from(await proxied.arrayBuffer()) };
}

const server = http.createServer((request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.url === "/status" && request.method === "GET") return send(response, 200, { starting, gemini: Boolean(geminiKey()) });
  if (request.url === "/api/analyze-image" && request.method === "POST") {
    const chunks = [];
    request.on("data", chunk => chunks.push(chunk));
    let size = 0;
    request.on("data", chunk => { size += chunk.length; if (size > 12 * 1024 * 1024) request.destroy(); });
    request.on("end", async () => {
      const contentType = request.headers["content-type"] || "";
      const body = Buffer.concat(chunks);
      const blocked = allowVisitor(request);
      if (blocked) return send(response, 429, { error: blocked });
      let geminiError = null;
      if (geminiKey()) {
        try {
          const form = await new Request("http://local/upload", { method: "POST", headers: { "content-type": contentType }, body }).formData();
          const file = form.get("image");
          if (!file || typeof file === "string") return send(response, 400, { error: "An image file is required." });
          const analysis = await analyzeWithGemini(Buffer.from(await file.arrayBuffer()), file.type, { apiKey: geminiKey(), model: process.env.GEMINI_MODEL });
          return send(response, 200, analysis);
        } catch (error) {
          geminiError = error;
          console.error(`Gemini analysis failed: ${error.message}`);
        }
      }
      try {
        const result = await proxyToQwen(contentType, body);
        response.writeHead(result.status, { "Content-Type": result.type });
        response.end(result.body);
      } catch (error) {
        send(response, 502, { error: geminiError ? `${geminiError.message} (and the local analyser is offline)` : (error.message || "Analysis server unavailable.") });
      }
    });
    return;
  }
  if (request.url === "/start" && request.method === "POST") {
    if (!starting) {
      starting = true;
      const launch = spawn("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `Set-Location -LiteralPath '${root}'; & '${launcher}'`
      ], { windowsHide: true, stdio: "ignore" });
      launch.once("error", error => console.error(`Unable to start Framewise launcher: ${error.message}`));
      setTimeout(() => { starting = false; }, 60000);
    }
    return send(response, 202, { accepted: true, cooldownSeconds: 60 });
  }
  return send(response, 404, { error: "Not found" });
});

function send(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

server.listen(port, "0.0.0.0", () => console.log(`I2P controller listening on port ${port}`));
