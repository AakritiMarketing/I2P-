// Imports every image + prompt from ADD_TEMPLATES_HERE into the website library.
// Pairing: photo.jpg + photo.txt (same name). Optional first lines in the .txt:
//   Title: My Template Name
//   Category: product | portrait | fashion | editorial | cinematic | fantasy
// A sub-folder named after a category also sets it. A templates.csv with
// columns file,title,category,prompt can replace the .txt files.
// Published originals are moved to ADD_TEMPLATES_HERE/_published/<date>/.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resize big photos so the website stays fast (1600px long edge, JPEG ~85%).
let sharp = null;
try { sharp = (await import('sharp')).default; } catch { console.log('Note: image resizing is off (run "npm install" once to enable it). Images are copied as-is.'); }
const MAX_EDGE = 1600;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inbox = path.join(root, 'ADD_TEMPLATES_HERE');
const manifestPath = path.join(root, 'image-library', 'manifest.json');
const imagesDir = path.join(root, 'image-library', 'images');
const promptsDir = path.join(root, 'generated-prompts', 'library');
const IMAGE_RE = /\.(jpe?g|png|webp|gif|avif)$/i;
const CATEGORIES = {
  product: 'Product Showcase', portrait: 'Portraits & Headshots', fashion: 'Fashion & Streetwear',
  editorial: 'Magazine Covers & Posters', cinematic: 'Cinematic & Moody', fantasy: '3D, Fantasy & Surreal'
};

const baseName = f => path.basename(f, path.extname(f)).toLowerCase();
const titleFromName = f => baseName(f).replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, c => c.toUpperCase()).slice(0, 60) || 'Untitled Template';
function normCategory(value) {
  const v = String(value || '').toLowerCase().trim();
  if (!v) return '';
  if (CATEGORIES[v]) return v;
  const hit = Object.entries(CATEGORIES).find(([k, label]) => label.toLowerCase() === v || v.includes(k));
  if (hit) return hit[0];
  if (/product|commercial|skincare/.test(v)) return 'product';
  if (/portrait|headshot/.test(v)) return 'portrait';
  if (/fashion|street/.test(v)) return 'fashion';
  if (/magazine|cover|poster|editorial/.test(v)) return 'editorial';
  if (/cinematic|moody|neon/.test(v)) return 'cinematic';
  if (/3d|fantasy|surreal|cartoon/.test(v)) return 'fantasy';
  return '';
}
function parsePromptText(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  let title = '', category = '';
  while (lines.length) {
    const m = lines[0].match(/^\s*(title|name|category)\s*:\s*(.*)$/i);
    if (!m) break;
    if (m[1].toLowerCase() === 'category') category = normCategory(m[2]); else title = m[2].trim();
    lines.shift();
  }
  return { title, category, prompt: lines.join('\n').trim() };
}
function parseCsv(text) {
  const rows = []; let row = [], field = '', quoted = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; } else if (ch === '"') quoted = false; else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i += 1; row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const head = (rows.shift() || []).map(h => h.trim().toLowerCase());
  const col = n => head.findIndex(h => h === n || h.startsWith(n));
  const [fi, ti, ci, pi] = ['file', 'title', 'category', 'prompt'].map(col);
  return rows.filter(r => r.some(Boolean)).map(r => ({ file: r[fi] || '', title: r[ti] || '', category: normCategory(r[ci]), prompt: (r[pi] || '').trim() }));
}
async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full)); else out.push(full);
  }
  return out;
}

await fs.mkdir(inbox, { recursive: true });
const files = await walk(inbox);
const texts = new Map(), csv = new Map();
for (const f of files) {
  if (/\.txt$/i.test(f) && !/readme/i.test(path.basename(f))) texts.set(baseName(f), { ...parsePromptText(await fs.readFile(f, 'utf8')), file: f });
  if (/\.csv$/i.test(f)) parseCsv(await fs.readFile(f, 'utf8')).forEach(r => csv.set(baseName(r.file), r));
}
const images = files.filter(f => IMAGE_RE.test(f));
if (!images.length) { console.log('No images found in ADD_TEMPLATES_HERE. Nothing to publish.'); process.exit(2); }

const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
let next = manifest.images.reduce((max, r) => Math.max(max, Number(String(r.id || '').match(/(\d+)$/)?.[1] || 0)), Number(manifest.lastId) || 0) + 1;
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const doneDir = path.join(inbox, '_published', stamp);
const skipped = []; let added = 0;
await fs.mkdir(imagesDir, { recursive: true }); await fs.mkdir(promptsDir, { recursive: true });

for (const img of images) {
  const key = baseName(img);
  const t = texts.get(key) || {}, c = csv.get(key) || {};
  const folderCat = normCategory(path.basename(path.dirname(img)));
  const prompt = c.prompt || t.prompt || '';
  const category = c.category || t.category || folderCat;
  if (!prompt) { skipped.push(`${path.relative(inbox, img)} — no prompt (add ${key}.txt)`); continue; }
  if (!category) { skipped.push(`${path.relative(inbox, img)} — no category (put it in a category folder or add "Category:" to the .txt)`); continue; }
  const id = `library-${String(next).padStart(3, '0')}`; next += 1;
  let ext = path.extname(img).toLowerCase().replace('.jpeg', '.jpg');
  if (sharp && ext !== '.gif') ext = '.jpg';
  const file = `${id}${ext}`, promptFile = `generated-prompts/library/${id}.txt`;
  if (sharp && ext === '.jpg') {
    await sharp(img).rotate().resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality: 85, mozjpeg: true }).toFile(path.join(imagesDir, file));
  } else {
    await fs.copyFile(img, path.join(imagesDir, file));
  }
  await fs.writeFile(path.join(root, promptFile), prompt + '\n', 'utf8');
  manifest.images.push({ id, file, status: 'analyzed', category, title: c.title || t.title || titleFromName(img), promptFile, addedAt: new Date().toISOString() });
  await fs.mkdir(doneDir, { recursive: true });
  await fs.rename(img, path.join(doneDir, path.basename(img))).catch(() => {});
  if (t.file) await fs.rename(t.file, path.join(doneDir, path.basename(t.file))).catch(() => {});
  added += 1;
}
manifest.lastId = next - 1;
await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(`Added ${added} template(s) to the library.`);
if (skipped.length) console.log(`\nSkipped ${skipped.length} (left in the folder):\n  ` + skipped.join('\n  '));
process.exit(added ? 0 : 3);
