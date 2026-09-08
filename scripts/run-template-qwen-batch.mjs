import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const comfyUrl = process.env.COMFYUI_URL || "http://127.0.0.1:8188";
const workflowPath = path.join(root, "llm_qwen3vl_text_gen.json");
const imageDir = path.join(root, "templates");
const outputDir = path.join(root, "generated-prompts");
const workflowTemplate = JSON.parse(await readFile(workflowPath, "utf8"));
await mkdir(outputDir, { recursive: true });

function extractText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractText).join("");
  if (!value || typeof value !== "object") return "";
  return Object.values(value).map(extractText).join("");
}

async function uploadImage(filePath) {
  const data = new FormData();
  data.append("image", new Blob([await readFile(filePath)]), path.basename(filePath));
  const response = await fetch(`${comfyUrl}/upload/image`, { method: "POST", body: data });
  if (!response.ok) throw new Error(`image upload failed (${response.status})`);
  return (await response.json()).name;
}

async function runWorkflow(imageName) {
  const workflow = structuredClone(workflowTemplate);
  workflow["8"].inputs.image = imageName;
  const queued = await fetch(`${comfyUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: `template-batch-${Date.now()}` })
  });
  if (!queued.ok) throw new Error(`queue failed (${queued.status})`);
  const { prompt_id: promptId } = await queued.json();
  for (let attempt = 0; attempt < 240; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 500));
    const historyResponse = await fetch(`${comfyUrl}/history/${promptId}`);
    if (!historyResponse.ok) throw new Error(`history failed (${historyResponse.status})`);
    const history = await historyResponse.json();
    const result = history[promptId];
    if (result?.status?.status_str === "error") throw new Error("ComfyUI workflow error");
    if (result?.outputs) return extractText(result.outputs["7"] || result.outputs);
  }
  throw new Error("workflow timed out");
}

const files = (await readdir(imageDir))
  .filter(name => /^template-\d{2}\.(jpg|jpeg|png|webp)$/i.test(name))
  .sort();
const manifest = { workflow: "Qwen3.5 exact user prompt", temperature: 0.5, maxLength: 600, results: [] };
for (const file of files) {
  const number = file.match(/\d+/)[0];
  const startedAt = Date.now();
  process.stdout.write(`Template ${number}: uploading and analyzing...\n`);
  try {
    const imageName = await uploadImage(path.join(imageDir, file));
    const rawText = await runWorkflow(imageName);
    const outputPath = path.join(outputDir, `template-${number}.txt`);
    await writeFile(outputPath, rawText, "utf8");
    manifest.results.push({ template: Number(number), image: file, status: "passed", elapsedMs: Date.now() - startedAt, output: `template-${number}.txt`, characters: rawText.length });
    process.stdout.write(`Template ${number}: saved ${rawText.length} characters.\n`);
  } catch (error) {
    manifest.results.push({ template: Number(number), image: file, status: "failed", elapsedMs: Date.now() - startedAt, error: error.message });
    process.stdout.write(`Template ${number}: FAILED — ${error.message}\n`);
  }
}
await writeFile(path.join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
process.stdout.write(`Completed ${manifest.results.filter(result => result.status === "passed").length}/${files.length} templates.\n`);
