/* I2P admin panel: bulk-add templates (image + prompt) and publish straight to GitHub.
   Opened by clicking the logo 10 times. The PIN/name gate only hides the panel;
   the real protection is the GitHub token, which lives only in the admin's browser. */
(() => {
  const GATE_HASH = 'ec495a19525755744fd86b1e0e8442dd6e76e77799eab207607d235e3011e4eb';
  const CATEGORIES = {
    product: 'Product Showcase',
    portrait: 'Portraits & Headshots',
    fashion: 'Fashion & Streetwear',
    editorial: 'Magazine Covers & Posters',
    cinematic: 'Cinematic & Moody',
    fantasy: '3D, Fantasy & Surreal'
  };
  const DEFAULTS = { owner: 'aakritimarketing', repo: 'I2P-', branch: 'main' };
  const IMAGE_RE = /\.(jpe?g|png|webp|gif|avif)$/i;
  const MANIFEST_PATH = 'image-library/manifest.json';
  const CHUNK = 25;            // templates per GitHub commit
  const MAX_EDGE = 1600;       // images are resized to this long edge before upload
  const store = {
    get(key, fallback = '') { try { return localStorage.getItem('i2p-admin-' + key) ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem('i2p-admin-' + key, value); } catch {} },
    del(key) { try { localStorage.removeItem('i2p-admin-' + key); } catch {} }
  };
  let items = [];
  let busy = false;
  let unlocked = false;
  try { unlocked = sessionStorage.getItem('i2p-admin') === '1'; } catch {}

  /* ---------- styles ---------- */
  const css = `
  .adm-overlay{position:fixed;inset:0;z-index:200;background:rgba(8,4,14,.82);display:flex;align-items:center;justify-content:center;padding:16px}
  .adm-overlay[hidden]{display:none}
  .adm-login{width:min(380px,100%);background:#171022;border:1px solid var(--line);border-radius:16px;padding:24px;color:var(--ink)}
  .adm-login h3{margin:0 0 6px;font-size:19px}.adm-login p{margin:0 0 16px;color:var(--muted);font-size:12px}
  .adm-field{display:block;margin-bottom:12px;font-size:11px;color:var(--muted);font-family:"DM Mono",monospace;letter-spacing:.06em;text-transform:uppercase}
  .adm-field input,.adm-field select,.adm-field textarea{display:block;width:100%;box-sizing:border-box;margin-top:6px;padding:10px 12px;border-radius:8px;border:1px solid var(--line);background:#0e0917;color:var(--ink);font:13px Manrope,system-ui,sans-serif;text-transform:none;letter-spacing:0}
  .adm-row{display:flex;gap:10px;justify-content:flex-end;align-items:center;flex-wrap:wrap}
  .adm-btn{padding:10px 15px;border-radius:8px;border:1px solid var(--line);background:#221634;color:var(--ink);font-weight:800;font-size:12px;cursor:pointer}
  .adm-btn.primary{border:0;background:linear-gradient(135deg,var(--purple),var(--pink));color:#180b25}
  .adm-btn:disabled{opacity:.45;cursor:not-allowed}
  .adm-error{color:#ff8fa3;font-size:12px;min-height:16px;margin:0 0 10px}
  .adm-panel{width:min(1100px,100%);height:min(92vh,900px);display:flex;flex-direction:column;background:#120c1c;border:1px solid var(--line);border-radius:18px;color:var(--ink);overflow:hidden}
  .adm-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 20px;border-bottom:1px solid var(--line)}
  .adm-head h3{margin:0;font-size:18px}.adm-tabs{display:flex;gap:6px;flex-wrap:wrap}
  .adm-tab{padding:8px 12px;border-radius:999px;border:1px solid var(--line);background:transparent;color:var(--muted);font-size:12px;font-weight:700;cursor:pointer}
  .adm-tab.active{color:var(--ink);border-color:var(--pink);background:#2a1244}
  .adm-body{flex:1;overflow:auto;padding:20px}
  .adm-section[hidden]{display:none}
  .adm-drop{border:2px dashed var(--line);border-radius:14px;padding:26px;text-align:center;color:var(--muted);font-size:13px;line-height:1.7}
  .adm-drop.over{border-color:var(--pink);background:rgba(240,171,252,.06)}
  .adm-drop strong{color:var(--ink);font-size:15px}
  .adm-help{color:var(--muted);font-size:12px;line-height:1.7;margin:14px 0}
  .adm-help code{background:#0e0917;padding:1px 6px;border-radius:5px;color:var(--pink)}
  .adm-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:16px 0}
  .adm-toolbar .adm-field{margin:0;min-width:200px}
  .adm-count{color:var(--muted);font-size:12px;margin-left:auto}
  .adm-list{display:grid;gap:10px}
  .adm-item{display:grid;grid-template-columns:84px 1fr auto;gap:12px;align-items:start;padding:10px;border:1px solid var(--line);border-radius:12px;background:#171022}
  .adm-item.bad{border-color:#ff8fa3}.adm-item.done{opacity:.55}
  .adm-item img{width:84px;height:105px;object-fit:cover;border-radius:8px;background:#0e0917}
  .adm-item-fields{display:grid;grid-template-columns:1fr 200px;gap:8px}
  .adm-item-fields textarea{grid-column:1/-1;min-height:64px;resize:vertical}
  .adm-item-fields input,.adm-item-fields select,.adm-item-fields textarea{width:100%;box-sizing:border-box;padding:8px 10px;border-radius:7px;border:1px solid var(--line);background:#0e0917;color:var(--ink);font:12px Manrope,system-ui,sans-serif}
  .adm-state{font:10px "DM Mono",monospace;color:var(--muted);text-align:right;min-width:70px}
  .adm-x{background:transparent;border:0;color:var(--muted);cursor:pointer;font-size:16px}
  .adm-progress{height:8px;border-radius:99px;background:#0e0917;overflow:hidden;margin:10px 0}
  .adm-progress span{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--purple),var(--pink));transition:width .3s}
  .adm-log{font:11px "DM Mono",monospace;color:var(--muted);white-space:pre-wrap;max-height:160px;overflow:auto}
  .adm-ok{color:#8ef0b4}
  @media (max-width:700px){.adm-item{grid-template-columns:64px 1fr}.adm-item img{width:64px;height:80px}.adm-state{grid-column:1/-1;text-align:left}.adm-item-fields{grid-template-columns:1fr}}
  `;
  document.head.insertAdjacentHTML('beforeend', `<style>${css}</style>`);

  /* ---------- markup ---------- */
  const catOptions = Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  document.body.insertAdjacentHTML('beforeend', `
  <div class="adm-overlay" id="admLogin" hidden>
    <form class="adm-login" id="admLoginForm" autocomplete="off">
      <h3>Admin access</h3><p>Enter the admin PIN and the security answer.</p>
      <label class="adm-field">PIN<input id="admPin" type="password" inputmode="numeric" required></label>
      <label class="adm-field">Grandfather's name<input id="admName" type="password" required></label>
      <p class="adm-error" id="admLoginError"></p>
      <div class="adm-row"><button type="button" class="adm-btn" id="admLoginCancel">Cancel</button><button class="adm-btn primary">Unlock</button></div>
    </form>
  </div>
  <div class="adm-overlay" id="admPanel" hidden>
    <div class="adm-panel" role="dialog" aria-modal="true" aria-label="Admin panel">
      <div class="adm-head">
        <h3>I2P Admin</h3>
        <div class="adm-tabs">
          <button class="adm-tab active" data-tab="add">Add templates</button>
          <button class="adm-tab" data-tab="settings">GitHub settings</button>
          <button class="adm-tab" data-tab="pc">PC controller</button>
          <button class="adm-tab" id="admLock">Lock</button>
          <button class="adm-tab" id="admClose">Close ✕</button>
        </div>
      </div>
      <div class="adm-body">
        <section class="adm-section" data-section="add">
          <div class="adm-drop" id="admDrop">
            <strong>Drop images + prompts here</strong><br>
            or <button class="adm-btn" type="button" id="admPickFiles">Choose files</button>
            <button class="adm-btn" type="button" id="admPickFolder">Choose a folder</button>
            <input type="file" id="admFiles" multiple accept="image/*,.txt,.csv" hidden>
            <input type="file" id="admFolder" webkitdirectory multiple hidden>
          </div>
          <div class="adm-help">
            <b>How to pair them:</b> give each prompt the same name as its image — <code>neon-portrait.jpg</code> + <code>neon-portrait.txt</code>.<br>
            <b>Optional first lines in the .txt:</b> <code>Title: Neon Night Portrait</code> and <code>Category: cinematic</code>. Everything after them is the prompt.<br>
            <b>Categories:</b> ${Object.entries(CATEGORIES).map(([k, v]) => `<code>${k}</code> ${v}`).join(' · ')}. A sub-folder named after a category also sets it.<br>
            <b>Big batches:</b> instead of .txt files you can add one <code>templates.csv</code> with columns <code>file,title,category,prompt</code>.
          </div>
          <div class="adm-toolbar">
            <label class="adm-field">Default category<select id="admDefaultCat">${catOptions}</select></label>
            <button class="adm-btn" type="button" id="admApplyCat">Apply to all without a category</button>
            <button class="adm-btn" type="button" id="admClear">Clear list</button>
            <span class="adm-count" id="admCount">No templates added yet</span>
          </div>
          <div class="adm-list" id="admList"></div>
          <div class="adm-progress" hidden id="admProgressWrap"><span id="admProgress"></span></div>
          <div class="adm-log" id="admLog"></div>
          <div class="adm-row" style="margin-top:14px"><button class="adm-btn primary" type="button" id="admPublish" disabled>Publish to website</button></div>
        </section>
        <section class="adm-section" data-section="settings" hidden>
          <p class="adm-help">Publishing writes straight to your GitHub repository, so this device needs a GitHub access token. Create a <b>fine-grained token</b> at github.com → Settings → Developer settings → Fine-grained tokens, give it access to <b>only this repository</b> with <b>Contents: Read and write</b>. The token is saved only in this browser.</p>
          <label class="adm-field">GitHub owner<input id="admOwner"></label>
          <label class="adm-field">Repository<input id="admRepo"></label>
          <label class="adm-field">Branch<input id="admBranch"></label>
          <label class="adm-field">Access token<input id="admToken" type="password" placeholder="github_pat_…"></label>
          <div class="adm-row"><span class="adm-log" id="admSettingsMsg"></span><button class="adm-btn" type="button" id="admForget">Forget token</button><button class="adm-btn" type="button" id="admTest">Test connection</button><button class="adm-btn primary" type="button" id="admSave">Save</button></div>
        </section>
        <section class="adm-section" data-section="pc" hidden>
          <p class="adm-help">Start the AI image-analysis server on your PC (used by "Upload an image" on the website). The PC must be on with the I2P controller running.</p>
          <button class="adm-btn primary" type="button" id="admStartPc">Start PC controller</button>
        </section>
      </div>
    </div>
  </div>`);

  const $a = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- gate ---------- */
  async function sha256(text) {
    const data = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  window.openAdmin = function openAdmin() {
    if (unlocked) return showPanel();
    $a('admLoginError').textContent = '';
    $a('admLoginForm').reset();
    $a('admLogin').hidden = false;
    $a('admPin').focus();
  };
  $a('admLoginCancel').onclick = () => { $a('admLogin').hidden = true; };
  let failures = 0;
  $a('admLoginForm').onsubmit = async event => {
    event.preventDefault();
    if (!window.crypto?.subtle) { $a('admLoginError').textContent = 'Open the site over https to use admin.'; return; }
    const pin = $a('admPin').value.trim();
    const name = $a('admName').value.trim().toLowerCase();
    if (await sha256(`i2p-admin|${pin}|${name}`) === GATE_HASH) {
      unlocked = true; failures = 0;
      try { sessionStorage.setItem('i2p-admin', '1'); } catch {}
      $a('admLogin').hidden = true; showPanel();
    } else {
      failures += 1;
      $a('admLoginError').textContent = failures >= 5 ? 'Too many attempts. Reload the page to try again.' : 'Incorrect details.';
      if (failures >= 5) $a('admLoginForm').querySelector('.primary').disabled = true;
    }
  };

  /* ---------- panel ---------- */
  function showPanel() {
    $a('admOwner').value = store.get('owner', DEFAULTS.owner);
    $a('admRepo').value = store.get('repo', DEFAULTS.repo);
    $a('admBranch').value = store.get('branch', DEFAULTS.branch);
    $a('admToken').value = store.get('token');
    $a('admPanel').hidden = false;
    if (!store.get('token')) switchTab('settings');
  }
  function switchTab(name) {
    document.querySelectorAll('.adm-tab[data-tab]').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.adm-section').forEach(s => { s.hidden = s.dataset.section !== name; });
  }
  document.querySelectorAll('.adm-tab[data-tab]').forEach(t => t.onclick = () => switchTab(t.dataset.tab));
  $a('admClose').onclick = () => { $a('admPanel').hidden = true; };
  $a('admLock').onclick = () => { unlocked = false; try { sessionStorage.removeItem('i2p-admin'); } catch {} $a('admPanel').hidden = true; };
  $a('admStartPc').onclick = () => { $a('admPanel').hidden = true; if (typeof window.showBootModal === 'function') window.showBootModal(); };

  /* ---------- settings ---------- */
  const cfg = () => ({ owner: store.get('owner', DEFAULTS.owner), repo: store.get('repo', DEFAULTS.repo), branch: store.get('branch', DEFAULTS.branch), token: store.get('token') });
  $a('admSave').onclick = () => {
    store.set('owner', $a('admOwner').value.trim()); store.set('repo', $a('admRepo').value.trim());
    store.set('branch', $a('admBranch').value.trim() || 'main'); store.set('token', $a('admToken').value.trim());
    $a('admSettingsMsg').textContent = 'Saved on this device.';
    updateCount();
  };
  $a('admForget').onclick = () => { store.del('token'); $a('admToken').value = ''; $a('admSettingsMsg').textContent = 'Token removed from this device.'; updateCount(); };
  $a('admTest').onclick = async () => {
    $a('admSave').onclick();
    $a('admSettingsMsg').textContent = 'Testing…';
    try {
      const repo = await gh('GET', '');
      $a('admSettingsMsg').innerHTML = repo.permissions?.push === false
        ? 'Connected, but this token cannot write to the repository.'
        : `<span class="adm-ok">Connected to ${esc(repo.full_name)} ✓</span>`;
    } catch (error) { $a('admSettingsMsg').textContent = error.message; }
  };

  /* ---------- GitHub API ---------- */
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function gh(method, path, body, accept) {
    const c = cfg();
    if (!c.token) throw new Error('Add your GitHub token in "GitHub settings" first.');
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const res = await fetch(`https://api.github.com/repos/${c.owner}/${c.repo}${path}`, {
        method,
        headers: { Authorization: `Bearer ${c.token}`, Accept: accept || 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store'
      });
      if (res.ok) return String(accept || '').includes('raw') ? res.text() : res.json();
      if ((res.status === 403 || res.status === 429) && (res.headers.get('retry-after') || res.headers.get('x-ratelimit-remaining') === '0')) {
        const wait = Number(res.headers.get('retry-after')) * 1000 || Math.max(5000, Number(res.headers.get('x-ratelimit-reset')) * 1000 - Date.now());
        log(`GitHub rate limit — waiting ${Math.ceil(wait / 1000)}s…`);
        await sleep(Math.min(wait, 15 * 60 * 1000));
        continue;
      }
      if (res.status >= 500) { await sleep(2000 * (attempt + 1)); continue; }
      let message = `${res.status}`;
      try { message = (await res.json()).message || message; } catch {}
      if (res.status === 401) message = 'GitHub rejected the token (expired or wrong).';
      if (res.status === 404) message = 'Repository not found, or the token has no access to it.';
      throw new Error(`GitHub: ${message}`);
    }
    throw new Error('GitHub kept failing. Try again in a few minutes.');
  }
  const getRaw = path => gh('GET', `/contents/${path}?ref=${encodeURIComponent(cfg().branch)}`, null, 'application/vnd.github.raw+json');

  /* ---------- reading dropped files ---------- */
  const baseName = name => name.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '').toLowerCase();
  const titleFromName = name => baseName(name).replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, c => c.toUpperCase()).slice(0, 60) || 'Untitled Template';
  function normCategory(value) {
    const v = String(value || '').toLowerCase().trim();
    if (!v) return '';
    if (CATEGORIES[v]) return v;
    const hit = Object.entries(CATEGORIES).find(([k, label]) => label.toLowerCase() === v || v.includes(k) || label.toLowerCase().startsWith(v));
    if (hit) return hit[0];
    if (/product|commercial|skincare|ad\b/.test(v)) return 'product';
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
        if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
        else if (ch === '"') quoted = false;
        else field += ch;
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
  async function addFiles(fileList) {
    const files = [...fileList];
    const texts = new Map(); const csvRows = new Map();
    for (const f of files) {
      if (/\.txt$/i.test(f.name)) texts.set(baseName(f.name), parsePromptText(await f.text()));
      if (/\.csv$/i.test(f.name)) parseCsv(await f.text()).forEach(r => csvRows.set(baseName(r.file), r));
    }
    let added = 0;
    for (const f of files) {
      if (!IMAGE_RE.test(f.name) && !(f.type || '').startsWith('image/')) continue;
      const key = baseName(f.name);
      if (items.some(it => it.key === key && it.file.size === f.size)) continue;
      const fromTxt = texts.get(key) || {}; const fromCsv = csvRows.get(key) || {};
      const folder = (f.webkitRelativePath || '').split('/').slice(-2, -1)[0] || '';
      items.push({
        key, file: f, url: URL.createObjectURL(f),
        title: fromCsv.title || fromTxt.title || titleFromName(f.name),
        category: fromCsv.category || fromTxt.category || normCategory(folder) || '',
        prompt: fromCsv.prompt || fromTxt.prompt || '',
        state: 'ready'
      });
      added += 1;
    }
    log(`Added ${added} image${added === 1 ? '' : 's'}.`);
    render();
  }

  /* ---------- list UI ---------- */
  function render() {
    const list = $a('admList');
    list.innerHTML = items.map((it, i) => `
      <div class="adm-item ${!it.prompt.trim() && it.state === 'ready' ? 'bad' : ''} ${it.state === 'published' ? 'done' : ''}" data-i="${i}">
        <img src="${it.url}" alt="" loading="lazy">
        <div class="adm-item-fields">
          <input data-k="title" value="${esc(it.title)}" placeholder="Title">
          <select data-k="category"><option value="">— choose category —</option>${Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}" ${it.category === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <textarea data-k="prompt" placeholder="Paste the prompt for this image…">${esc(it.prompt)}</textarea>
        </div>
        <div><div class="adm-state">${it.state === 'published' ? '<span class="adm-ok">published ✓</span>' : !it.prompt.trim() ? 'needs prompt' : !it.category ? 'needs category' : it.state}</div><button class="adm-x" title="Remove" data-remove="${i}">✕</button></div>
      </div>`).join('');
    updateCount();
  }
  $a('admList').addEventListener('input', event => {
    const row = event.target.closest('.adm-item'); if (!row) return;
    const it = items[row.dataset.i]; it[event.target.dataset.k] = event.target.value;
    const state = row.querySelector('.adm-state');
    if (it.state !== 'published') state.textContent = !it.prompt.trim() ? 'needs prompt' : !it.category ? 'needs category' : 'ready';
    row.classList.toggle('bad', !it.prompt.trim());
    updateCount();
  });
  $a('admList').addEventListener('click', event => {
    const i = event.target.dataset.remove; if (i === undefined) return;
    URL.revokeObjectURL(items[i].url); items.splice(Number(i), 1); render();
  });
  const readyItems = () => items.filter(it => it.state !== 'published' && it.prompt.trim() && it.category);
  function updateCount() {
    const ready = readyItems().length, pending = items.filter(it => it.state !== 'published').length;
    $a('admCount').textContent = items.length ? `${ready} of ${pending} ready to publish` : 'No templates added yet';
    $a('admPublish').disabled = !ready || !cfg().token || busy;
    $a('admPublish').textContent = !cfg().token ? 'Add GitHub token first' : `Publish ${ready || ''} to website`;
  }
  $a('admApplyCat').onclick = () => { const c = $a('admDefaultCat').value; items.forEach(it => { if (!it.category) it.category = c; }); render(); };
  $a('admClear').onclick = () => { items.forEach(it => URL.revokeObjectURL(it.url)); items = []; $a('admLog').textContent = ''; render(); };
  $a('admPickFiles').onclick = () => $a('admFiles').click();
  $a('admPickFolder').onclick = () => $a('admFolder').click();
  $a('admFiles').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
  $a('admFolder').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
  const drop = $a('admDrop');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', async e => {
    e.preventDefault(); drop.classList.remove('over');
    const entries = [...e.dataTransfer.items].map(i => i.webkitGetAsEntry?.()).filter(Boolean);
    if (!entries.length) return addFiles(e.dataTransfer.files);
    const files = [];
    const walk = async (entry, folder) => {
      if (entry.isFile) {
        const file = await new Promise((res, rej) => entry.file(res, rej));
        Object.defineProperty(file, 'webkitRelativePath', { value: folder ? `${folder}/${file.name}` : file.name });
        files.push(file);
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        let batch;
        do { batch = await new Promise((res, rej) => reader.readEntries(res, rej)); for (const child of batch) await walk(child, entry.name); } while (batch.length);
      }
    };
    for (const entry of entries) await walk(entry, '');
    addFiles(files);
  });

  /* ---------- publishing ---------- */
  function log(message) { const el = $a('admLog'); el.textContent += (el.textContent ? '\n' : '') + message; el.scrollTop = el.scrollHeight; }
  function progress(done, total) { $a('admProgressWrap').hidden = false; $a('admProgress').style.width = `${Math.round(done / Math.max(total, 1) * 100)}%`; }
  async function toJpegBase64(file) {
    if (/gif$/i.test(file.type)) return { base64: await fileBase64(file), ext: 'gif' };
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.86));
      return { base64: await fileBase64(blob), ext: 'jpg' };
    } catch {
      return { base64: await fileBase64(file), ext: (file.name.split('.').pop() || 'jpg').toLowerCase() };
    }
  }
  const fileBase64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });

  $a('admPublish').onclick = async () => {
    const queue = readyItems();
    if (!queue.length || busy) return;
    busy = true; updateCount(); $a('admLog').textContent = '';
    const c = cfg(); let done = 0;
    try {
      for (let start = 0; start < queue.length; start += CHUNK) {
        const batch = queue.slice(start, start + CHUNK);
        log(`Batch ${start / CHUNK + 1}: preparing ${batch.length} template(s)…`);
        const manifest = JSON.parse(await getRaw(MANIFEST_PATH));
        let next = manifest.images.reduce((max, r) => Math.max(max, Number(String(r.id || '').match(/(\d+)$/)?.[1] || 0)), Number(manifest.lastId) || 0) + 1;
        const tree = []; const entries = [];
        for (const it of batch) {
          it.state = 'uploading'; render();
          const id = `library-${String(next).padStart(3, '0')}`; next += 1;
          const { base64, ext } = await toJpegBase64(it.file);
          const blob = await gh('POST', '/git/blobs', { content: base64, encoding: 'base64' });
          const file = `${id}.${ext}`, promptFile = `generated-prompts/library/${id}.txt`;
          tree.push({ path: `image-library/images/${file}`, mode: '100644', type: 'blob', sha: blob.sha });
          tree.push({ path: promptFile, mode: '100644', type: 'blob', content: it.prompt.trim() + '\n' });
          entries.push({ id, file, status: 'analyzed', category: it.category, title: it.title.trim() || titleFromName(it.file.name), promptFile, addedAt: new Date().toISOString() });
          it.newId = id;
          await sleep(900); // stay under GitHub's limit of ~80 uploads per minute
        }
        const fresh = JSON.parse(await getRaw(MANIFEST_PATH));
        fresh.images.push(...entries);
        fresh.lastId = Math.max(Number(fresh.lastId) || 0, next - 1);
        tree.push({ path: MANIFEST_PATH, mode: '100644', type: 'blob', content: JSON.stringify(fresh, null, 2) + '\n' });
        const ref = await gh('GET', `/git/ref/heads/${encodeURIComponent(c.branch)}`);
        const parent = await gh('GET', `/git/commits/${ref.object.sha}`);
        const newTree = await gh('POST', '/git/trees', { base_tree: parent.tree.sha, tree });
        const commit = await gh('POST', '/git/commits', { message: `Admin: add ${entries.length} template(s)`, tree: newTree.sha, parents: [ref.object.sha] });
        await gh('PATCH', `/git/refs/heads/${encodeURIComponent(c.branch)}`, { sha: commit.sha, force: false });
        batch.forEach(it => { it.state = 'published'; });
        done += batch.length; progress(done, queue.length); render();
        log(`✓ Published ${entries.length} (${entries[0].id} – ${entries[entries.length - 1].id}).`);
      }
      log(`\nAll done — ${done} template(s) published. The live site updates in about 1–2 minutes; refresh with Ctrl+F5.`);
    } catch (error) {
      queue.forEach(it => { if (it.state === 'uploading') it.state = 'ready'; });
      log(`✕ ${error.message}\nNothing in the failed batch was published — fix the problem and press Publish again.`);
      render();
    } finally { busy = false; updateCount(); }
  };

  if (unlocked) { /* stay unlocked for this tab, but don't pop the panel open on load */ }
})();
