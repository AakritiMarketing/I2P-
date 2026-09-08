import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const launcher = path.join(root, "START_FRAMEWISE.bat");
const port = Number(process.env.CONTROLLER_PORT || 3001);
const analysisServer = process.env.ANALYSIS_SERVER || "http://127.0.0.1:3000";
let starting = false;

const server = http.createServer((request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.url === "/status" && request.method === "GET") return send(response, 200, { starting });
  if (request.url === "/api/analyze-image" && request.method === "POST") {
    const chunks = [];
    request.on("data", chunk => chunks.push(chunk));
    request.on("end", async () => {
      try {
        const proxied = await fetch(`${analysisServer}/api/analyze-image`, {
          method: "POST",
          headers: { "content-type": request.headers["content-type"] },
          body: Buffer.concat(chunks)
        });
        response.writeHead(proxied.status, { "Content-Type": proxied.headers.get("content-type") || "application/json" });
        response.end(Buffer.from(await proxied.arrayBuffer()));
      } catch (error) {
        send(response, 502, { error: error.message || "Analysis server unavailable." });
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
