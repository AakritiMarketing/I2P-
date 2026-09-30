// Analyses an uploaded image with the Google Gemini API (free tier works) and
// returns the same JSON shape the website already uses for the Qwen analyser.
// The API key is read from .env on the PC and never reaches the browser.

const DEFAULT_MODELS = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite'];

const INSTRUCTIONS = `You are an elite prompt engineer for AI image generators (ChatGPT, Gemini, Midjourney).
Study the attached image and write a prompt that lets someone recreate it with THEIR OWN photo.

Return ONLY valid JSON with exactly these keys:
{
  "full_prompt": string,
  "negative_constraints": string,
  "scene": {
    "mood": string, "time_of_day": string, "visual_style": string, "aspect_ratio": string,
    "lighting": string, "camera_angle": string, "camera_height": string, "shot_type": string,
    "lens_impression": string, "composition": string, "depth_of_field": string, "focus_plane": string,
    "exposure": string, "white_balance": string, "color_palette": string, "textures": string,
    "environment": string, "weather": string
  },
  "characters": [ { "name": "Person 01", "appearance": string, "clothing": string, "pose": string, "position": string } ],
  "objects": [string],
  "background": string
}

Rules for "full_prompt" (120-220 words, plain English, one paragraph):
- If the image shows a person, START with: "Use my uploaded photo as the face reference: keep my exact face, facial features, skin tone and hairline unchanged and fully recognizable." Then describe the person as "me"/"I" and never describe their face, age, ethnicity or gender.
- If the main subject is a product with no person, START with: "Use my uploaded product photo as the hero product: keep its exact shape, packaging, label text, logo and colors unchanged." Then describe the product by shape and colour.
- If it is a poster/infographic with no person or product, describe it fully, including all visible text in quotes.
- Replace real brand names, magazine names, celebrity names and copyrighted characters with placeholders like [YOUR BRAND], [MAGAZINE NAME], [YOUR NAME], or a generic description.
- Cover pose, outfit, props, setting, lighting, camera/lens, colours and mood so the result matches the original closely.
- End with the frame shape, e.g. "Vertical 4:5."
"aspect_ratio" must be one of: "3:4", "4:5", "2:3", "9:16", "1:1", "16:9", "4:3".
"characters" is an empty array when no person is visible.`;

export async function analyzeWithGemini(imageBuffer, mimeType, { apiKey, model } = {}) {
  if (!apiKey) throw new Error('No Gemini API key configured.');
  const startedAt = Date.now();
  const models = model ? [model, ...DEFAULT_MODELS.filter(m => m !== model)] : DEFAULT_MODELS;
  const body = {
    contents: [{ role: 'user', parts: [
      { inline_data: { mime_type: mimeType || 'image/jpeg', data: imageBuffer.toString('base64') } },
      { text: INSTRUCTIONS }
    ] }],
    generationConfig: { temperature: 0.4, responseMimeType: 'application/json', maxOutputTokens: 4096 }
  };
  let lastError;
  for (const name of models) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(name)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90000)
    });
    const payload = await res.json().catch(() => ({}));
    if (res.status === 404 || res.status === 400 && /model/i.test(payload?.error?.message || '')) { lastError = new Error(`Gemini model ${name} not available`); continue; }
    if (!res.ok) {
      const error = new Error(`Gemini: ${payload?.error?.message || res.status}`);
      error.status = res.status;
      throw error;
    }
    const text = (payload.candidates?.[0]?.content?.parts || []).map(part => part.text || '').join('');
    const start = text.indexOf('{'), end = text.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('Gemini returned no analysis.');
    const raw = JSON.parse(text.slice(start, end + 1));
    const fullPrompt = String(raw.full_prompt || '').trim();
    if (fullPrompt.split(/\s+/).length < 40) throw new Error('Gemini returned a prompt that was too short.');
    const { width, height } = imageSize(imageBuffer);
    const scene = raw.scene || {};
    scene.width = width; scene.height = height;
    scene.ratio = scene.aspect_ratio;
    return {
      ...normalizeAnalysis({ ...raw, scene }),
      engine: 'gemini',
      diagnostics: {
        engine: `Google ${name}`,
        elapsedMs: Date.now() - startedAt,
        promptCharacters: fullPrompt.length,
        promptWords: fullPrompt.split(/\s+/).filter(Boolean).length,
        rawText: text
      }
    };
  }
  throw lastError || new Error('No Gemini model available.');
}

// Reads width/height from PNG, JPEG, GIF or WebP headers (0 if unknown).
export function imageSize(buf) {
  try {
    if (buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (buf.toString('ascii', 0, 3) === 'GIF') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      const kind = buf.toString('ascii', 12, 16);
      if (kind === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
      if (kind === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i < buf.length) {
        if (buf[i] !== 0xff) { i += 1; continue; }
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
        i += 2 + len;
      }
    }
  } catch {}
  return { width: 0, height: 0 };
}

// Same mapping the website's Qwen analyser uses (kept in sync with server.js).
export function normalizeAnalysis(analysis) {
  const scene = analysis.scene || {};
  const pick = (value, choices, fallback) => {
    const source = String(value || '').toLowerCase();
    const rules = [
      ['night', 'Night'], ['blue hour', 'Blue hour'], ['twilight', 'Blue hour'], ['morning', 'Early morning'], ['dawn', 'Early morning'],
      ['midday', 'Midday'], ['noon', 'Midday'], ['afternoon', 'Late afternoon'], ['golden', 'Golden hour glow'], ['neon', 'Neon night lighting'],
      ['moody', 'Moody cinematic light'], ['dramatic', 'Moody cinematic light'], ['cinematic', 'Moody cinematic light'], ['studio', 'Bright studio light'], ['bright', 'Bright studio light'],
      ['documentary', 'Documentary'], ['snapshot', 'Documentary'], ['candid', 'Documentary'], ['editorial', 'Editorial fashion'], ['fashion', 'Editorial fashion'],
      ['analog', 'Analog film'], ['film', 'Analog film'], ['fine art', 'Fine art portrait'], ['photoreal', 'Photorealistic'], ['realistic', 'Photorealistic'],
      ['4:5', 'Portrait · 4:5'], ['3:4', 'Portrait · 4:5'], ['2:3', 'Portrait · 4:5'], ['9:16', 'Portrait · 4:5'], ['16:9', 'Landscape · 16:9'], ['4:3', 'Landscape · 16:9'], ['1:1', 'Square · 1:1']
    ];
    for (const [needle, choice] of rules) if (source.includes(needle) && choices.includes(choice)) return choice;
    return fallback;
  };
  return {
    scene: {
      mood: pick(scene.mood || scene.lighting, ['Natural, soft daylight', 'Golden hour glow', 'Moody cinematic light', 'Bright studio light', 'Neon night lighting'], 'Natural, soft daylight'),
      time: pick(scene.time || scene.time_of_day, ['Late afternoon', 'Early morning', 'Midday', 'Blue hour', 'Night'], 'Late afternoon'),
      style: pick(scene.style || scene.visual_style, ['Photorealistic', 'Editorial fashion', 'Analog film', 'Documentary', 'Fine art portrait'], 'Photorealistic'),
      ratio: pick(scene.ratio || scene.aspect_ratio, ['Keep original ratio', 'Portrait · 4:5', 'Landscape · 16:9', 'Square · 1:1'], 'Keep original ratio'),
      width: scene.width || 0,
      height: scene.height || 0
    },
    characters: (analysis.characters || []).map((character, index) => ({
      name: character.name || `Person ${String(index + 1).padStart(2, '0')}`,
      description: [character.appearance, character.clothing, character.pose, character.position].filter(Boolean).join(' · ')
    })),
    objects: Array.isArray(analysis.objects) ? analysis.objects : [],
    background: analysis.background || '',
    fullPrompt: analysis.full_prompt || analysis.fullPrompt || '',
    negativeConstraints: analysis.negative_constraints || analysis.negativeConstraints || '',
    details: {
      lighting: scene.lighting || '', cameraAngle: scene.camera_angle || '', cameraHeight: scene.camera_height || '',
      shotType: scene.shot_type || '', lensImpression: scene.lens_impression || '', composition: scene.composition || '',
      depthOfField: scene.depth_of_field || '', focusPlane: scene.focus_plane || '', exposure: scene.exposure || '',
      whiteBalance: scene.white_balance || '', colorPalette: scene.color_palette || '', textures: scene.textures || '',
      environment: scene.environment || '', weather: scene.weather || ''
    }
  };
}
