import express from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const root = path.dirname(fileURLToPath(import.meta.url));
const comfyUrl = process.env.COMFYUI_URL || "http://127.0.0.1:8188";
const workflowPath = path.join(root, "llm_qwen3vl_text_gen.json");

app.use(express.static(root));
app.use((request, response, next) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (request.method === "OPTIONS") return response.sendStatus(204);
  next();
});

app.post("/api/analyze-image", upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "An image file is required." });
  const startedAt = Date.now();
  try {
    const workflow = JSON.parse(await (await import("node:fs/promises")).readFile(workflowPath, "utf8"));
    const uploadData = new FormData();
    uploadData.append("image", new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname);
    const uploaded = await fetch(`${comfyUrl}/upload/image`, { method: "POST", body: uploadData });
    if (!uploaded.ok) throw new Error(`ComfyUI image upload failed (${uploaded.status})`);
    const uploadedImage = await uploaded.json();
    workflow["8"].inputs.image = uploadedImage.name;

    const queued = await fetch(`${comfyUrl}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: "framewise" })
    });
    if (!queued.ok) throw new Error(`ComfyUI queue failed (${queued.status})`);
    const { prompt_id: promptId } = await queued.json();

    let result;
    for (let attempt = 0; attempt < 360; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const historyResponse = await fetch(`${comfyUrl}/history/${promptId}`);
      const history = await historyResponse.json();
      if (history[promptId]?.status?.status_str === "error") {
        throw new Error("ComfyUI reported an analysis error.");
      }
      if (history[promptId]?.outputs) { result = history[promptId]; break; }
    }
    if (!result) throw new Error("ComfyUI analysis timed out.");
    const output = result.outputs?.["7"] || {};
    const text = extractText(output);
    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");
    if (jsonStart < 0 || jsonEnd <= jsonStart) throw new Error("ComfyUI returned no JSON analysis.");
    let analysis;
    try {
      analysis = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    } catch {
      throw new Error("ComfyUI returned malformed JSON. The image analysis was rejected.");
    }
    const fullPrompt = analysis.full_prompt || analysis.fullPrompt || "";
    if (fullPrompt.trim().length < 600) {
      throw new Error("ComfyUI returned an incomplete visual blueprint. Please run the analysis again.");
    }
    return res.json({
      ...normalizeAnalysis(analysis),
      diagnostics: {
        elapsedMs: Date.now() - startedAt,
        promptCharacters: fullPrompt.length,
        promptWords: fullPrompt.trim().split(/\s+/).filter(Boolean).length,
        rawText: text
      }
    });
  } catch (error) {
    return res.status(502).json({ error: error.message || "ComfyUI analysis failed." });
  }

  function extractText(value) {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(extractText).join("");
    if (!value || typeof value !== "object") return "";
    return Object.values(value).map(extractText).join("");
  }
});

function normalizeAnalysis(analysis) {
  const scene = analysis.scene || {};
  const pick = (value, choices, fallback) => {
    const source = value?.toLowerCase?.() || "";
    if (source.includes("night")) return choices.find(choice => choice === "Night") || fallback;
    if (source.includes("blue hour") || source.includes("twilight")) return choices.find(choice => choice === "Blue hour") || fallback;
    if (source.includes("morning") || source.includes("dawn")) return choices.find(choice => choice === "Early morning") || fallback;
    if (source.includes("midday") || source.includes("noon")) return choices.find(choice => choice === "Midday") || fallback;
    if (source.includes("afternoon")) return choices.find(choice => choice === "Late afternoon") || fallback;
    if (source.includes("golden")) return choices.find(choice => choice === "Golden hour glow") || fallback;
    if (source.includes("neon")) return choices.find(choice => choice === "Neon night lighting") || fallback;
    if (source.includes("moody") || source.includes("dramatic")) return choices.find(choice => choice === "Moody cinematic light") || fallback;
    if (source.includes("studio") || source.includes("bright")) return choices.find(choice => choice === "Bright studio light") || fallback;
    if (source.includes("documentary") || source.includes("snapshot") || source.includes("candid")) return choices.find(choice => choice === "Documentary") || fallback;
    if (source.includes("editorial") || source.includes("fashion")) return choices.find(choice => choice === "Editorial fashion") || fallback;
    if (source.includes("analog") || source.includes("film")) return choices.find(choice => choice === "Analog film") || fallback;
    if (source.includes("portrait") || source.includes("photoreal")) return choices.find(choice => choice === "Photorealistic") || fallback;
    if (source.includes("3:4") || source.includes("portrait")) return choices.find(choice => choice === "Portrait · 4:5") || fallback;
    if (source.includes("16:9") || source.includes("wide")) return choices.find(choice => choice === "Landscape · 16:9") || fallback;
    if (source.includes("1:1") || source.includes("square")) return choices.find(choice => choice === "Square · 1:1") || fallback;
    return fallback;
  };
  return {
    scene: {
      mood: pick(scene.mood, ["Natural, soft daylight", "Golden hour glow", "Moody cinematic light", "Bright studio light", "Neon night lighting"], "Natural, soft daylight"),
      time: pick(scene.time || scene.time_of_day, ["Late afternoon", "Early morning", "Midday", "Blue hour", "Night"], "Late afternoon"),
      style: pick(scene.style || scene.visual_style, ["Photorealistic", "Editorial fashion", "Analog film", "Documentary", "Fine art portrait"], "Photorealistic"),
      ratio: pick(scene.ratio || scene.aspect_ratio, ["Keep original ratio", "Portrait · 4:5", "Landscape · 16:9", "Square · 1:1"], "Keep original ratio"),
      width: scene.width || 0,
      height: scene.height || 0
    },
    characters: (analysis.characters || []).map((character, index) => ({
      name: character.name || `Person ${String(index + 1).padStart(2, "0")}`,
      description: [character.appearance, character.clothing, character.pose, character.position].filter(Boolean).join(" · ")
    })),
    objects: Array.isArray(analysis.objects) ? analysis.objects : [],
    background: analysis.background || "",
    fullPrompt: analysis.full_prompt || analysis.fullPrompt || "",
    negativeConstraints: analysis.negative_constraints || analysis.negativeConstraints || "",
    details: {
      lighting: scene.lighting || "",
      cameraAngle: scene.camera_angle || "",
      cameraHeight: scene.camera_height || "",
      shotType: scene.shot_type || "",
      lensImpression: scene.lens_impression || "",
      composition: scene.composition || "",
      depthOfField: scene.depth_of_field || "",
      focusPlane: scene.focus_plane || "",
      exposure: scene.exposure || "",
      whiteBalance: scene.white_balance || "",
      colorPalette: scene.color_palette || "",
      textures: scene.textures || "",
      environment: scene.environment || "",
      weather: scene.weather || ""
    }
  };
}

const port = process.env.PORT || 3000;
const host = process.env.HOST || "127.0.0.1";
app.listen(port, host, () => {
  console.log(`Framewise running at http://${host}:${port}`);
});
