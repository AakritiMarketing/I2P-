import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const comfyUrl = process.env.COMFYUI_URL || "http://127.0.0.1:8188";
const workflowPath = path.join(root, "llm_qwen3vl_text_gen.json");
const imageDir = path.join(root, "image-library", "images");
const libraryManifestPath = path.join(root, "image-library", "manifest.json");
const outputDir = path.join(root, "generated-prompts", "library");
const readJson = async (filePath) => JSON.parse((await readFile(filePath, "utf8")).replace(/^\uFEFF/, ""));
const workflowTemplate = await readJson(workflowPath);
const libraryManifest = await readJson(libraryManifestPath);

await mkdir(outputDir, { recursive: true });

function extractText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractText).join("");
  if (!value || typeof value !== "object") return "";
  return Object.values(value).map(extractText).join("");
}

function classifyPrompt(prompt) {
  const text = prompt.toLowerCase();
  const rules = [
    ["product-commercial", /\b(product|packaging|bottle|jar|skincare|cosmetic|perfume|advertis|commercial)\b/],
    ["fashion-editorial", /\b(fashion|editorial|runway|outfit|garment|dress|jacket|model|couture|magazine)\b/],
    ["portrait-character", /\b(portrait|subject|face|torso|shoulder|character|person)\b/],
    ["lifestyle-social", /\b(selfie|cafe|lifestyle|ugc|home|bedroom|phone|casual)\b/],
    ["cinematic-scene", /\b(cinematic|film|movie|dramatic scene|story|set design)\b/],
    ["fantasy-surreal", /\b(fantasy|surreal|magical|mythical|dream|creature|impossible)\b/],
    ["architecture-interior", /\b(interior|architecture|room|building|facade|space|lobby)\b/],
    ["nature-landscape", /\b(landscape|mountain|forest|ocean|beach|nature|sky|sunset)\b/],
    ["food-still-life", /\b(food|dish|plate|drink|beverage|still life|ingredient)\b/],
    ["typography-poster", /\b(typography|poster|headline|text|logo|magazine cover|graphic layout)\b/],
  ];
  const matches = rules.filter(([, pattern]) => pattern.test(text)).map(([category]) => category);
  return matches.length ? matches.slice(0, 3) : ["general-photography"];
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
    body: JSON.stringify({ prompt: workflow, client_id: `library-batch-${Date.now()}` }),
  });
  if (!queued.ok) throw new Error(`queue failed (${queued.status})`);
  const { prompt_id: promptId } = await queued.json();
  for (let attempt = 0; attempt < 240; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const historyResponse = await fetch(`${comfyUrl}/history/${promptId}`);
    if (!historyResponse.ok) throw new Error(`history failed (${historyResponse.status})`);
    const history = await historyResponse.json();
    const result = history[promptId];
    if (result?.status?.status_str === "error") throw new Error("ComfyUI workflow error");
    if (result?.outputs) return extractText(result.outputs["7"] || result.outputs);
  }
  throw new Error("workflow timed out");
}

async function saveManifest() {
  await writeFile(libraryManifestPath, `${JSON.stringify(libraryManifest, null, 2)}\n`, "utf8");
}

const pending = libraryManifest.images.filter((record) => record.status === "pending-analysis");
for (const record of pending) {
  const startedAt = Date.now();
  process.stdout.write(`${record.id}: uploading and analyzing...\n`);
  try {
    const imageName = await uploadImage(path.join(imageDir, record.file));
    const rawText = await runWorkflow(imageName);
    const promptFile = `${record.id}.txt`;
    await writeFile(path.join(outputDir, promptFile), rawText, "utf8");
    record.status = "analyzed";
    record.category = classifyPrompt(rawText)[0];
    record.tags = classifyPrompt(rawText).slice(1);
    record.promptFile = `generated-prompts/library/${promptFile}`;
    record.elapsedMs = Date.now() - startedAt;
    record.characters = rawText.length;
    record.error = null;
    await saveManifest();
    process.stdout.write(`${record.id}: saved ${rawText.length} characters (${record.category}).\n`);
  } catch (error) {
    record.status = "failed";
    record.elapsedMs = Date.now() - startedAt;
    record.error = error instanceof Error ? error.message : String(error);
    await saveManifest();
    process.stdout.write(`${record.id}: FAILED - ${record.error}\n`);
  }
}

const complete = libraryManifest.images.filter((record) => record.status === "analyzed").length;
const failed = libraryManifest.images.filter((record) => record.status === "failed").length;
process.stdout.write(`Completed ${complete}/${libraryManifest.newImageCount}; failed ${failed}.\n`);
