(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const TOKEN_KEY = 'movingsale.token';
  const API = 'https://api.github.com';

  /* ============================ repo config ============================ */
  let REPO = { owner: '', repo: '', branch: 'main' };

  function guessRepo() {
    const host = location.hostname;                       // e.g. rothblum.github.io
    const seg = location.pathname.split('/').filter(Boolean);
    const m = host.match(/^([\w-]+)\.github\.io$/i);
    if (!m) return null;
    const owner = m[1];
    // project page: /<repo>/...  |  user page: repo is <owner>.github.io
    const repo = seg.length && !/\.html?$/i.test(seg[0]) ? seg[0] : `${owner}.github.io`;
    return { owner, repo, branch: 'main' };
  }

  async function loadRepoConfig() {
    try {
      const r = await fetch('assets/repo.json?v=' + Date.now());
      if (r.ok) {
        const c = await r.json();
        if (c.owner && c.repo) { REPO = { branch: 'main', ...c }; return; }
      }
    } catch (_) { /* fall through */ }
    const g = guessRepo();
    if (g) REPO = g;
  }

  /* ============================ github api ============================ */
  let TOKEN = '';

  async function gh(path, opts = {}) {
    const res = await fetch(API + path, {
      ...opts,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: 'Bearer ' + TOKEN,
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...opts.headers,
      },
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).message || ''; } catch (_) {}
      const err = new Error(`GitHub ${res.status}${detail ? ': ' + detail : ''}`);
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }

  /* ============================ state ============================ */
  let data = { config: {}, items: [] };
  let newBlobs = new Map();   // repoPath -> base64 (uploads pending)
  let previews = new Map();   // repoPath -> object URL for display
  let removedPaths = new Set();
  let openItems = new Set();
  let dirty = false;
  let baseItemsSha = null;

  function markDirty(v = true) {
    dirty = v;
    $('saveBtn').disabled = !v;
    $('saveStatus').innerHTML = v
      ? `<span class="dirty-dot"></span>Unsaved changes`
      : 'No unsaved changes';
  }

  window.addEventListener('beforeunload', (e) => {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ============================ helpers ============================ */
  const slug = (s) => String(s || 'item').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'item';

  const rand = () => Math.random().toString(36).slice(2, 7);

  function msg(host, text, kind = 'info') {
    $(host).innerHTML = text ? `<div class="msg ${kind}">${text}</div>` : '';
  }

  function bytesToB64(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(s);
  }

  const b64ToText = (b64) => new TextDecoder().decode(
    Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

  /* ---------- image resize ---------- */
  const MAX_EDGE = 1600, JPEG_Q = 0.82;

  async function loadBitmap(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
      catch (_) { /* fall back */ }
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')); };
      img.src = url;
    });
  }

  async function processImage(file) {
    const bmp = await loadBitmap(file);
    const w0 = bmp.width, h0 = bmp.height;
    const scale = Math.min(1, MAX_EDGE / Math.max(w0, h0));
    const w = Math.round(w0 * scale), h = Math.round(h0 * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', JPEG_Q));
    if (!blob) throw new Error('Could not process that image');
    return { blob, base64: bytesToB64(await blob.arrayBuffer()) };
  }

  /* ============================ auth ============================ */
  async function signIn(token, remember) {
    TOKEN = token;
    const repoInfo = await gh(`/repos/${REPO.owner}/${REPO.repo}`);
    if (!repoInfo.permissions || !repoInfo.permissions.push) {
      throw new Error('That token can read the repository but cannot write to it. Give it Contents: Read and write.');
    }
    REPO.branch = repoInfo.default_branch || REPO.branch;
    let login = '';
    try { login = (await gh('/user')).login; } catch (_) { /* fine-grained tokens may lack user scope */ }

    (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token);
    $('whoami').textContent = `${login ? login + ' · ' : ''}${REPO.owner}/${REPO.repo}`;
    $('gate').hidden = true;
    $('editor').hidden = false;
    await loadData();
  }

  function signOut() {
    if (dirty && !confirm('You have unsaved changes. Sign out anyway?')) return;
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    dirty = false;
    location.reload();
  }

  /* ============================ load ============================ */
  async function loadData() {
    msg('topMsg', 'Loading the current listing…', 'info');
    const file = await gh(`/repos/${REPO.owner}/${REPO.repo}/contents/items.json?ref=${encodeURIComponent(REPO.branch)}`);
    baseItemsSha = file.sha;
    data = JSON.parse(b64ToText(file.content));
    data.config = data.config || {};
    data.items = Array.isArray(data.items) ? data.items : [];
    newBlobs.clear(); previews.forEach((u) => URL.revokeObjectURL(u)); previews.clear(); removedPaths.clear();
    fillConfig();
    renderItems();
    markDirty(false);
    msg('topMsg', '', 'info');
  }

  function fillConfig() {
    const c = data.config, ct = c.contact || {};
    $('cfgTitle').value = c.title || '';
    $('cfgSubtitle').value = c.subtitle || '';
    $('cfgNote').value = c.note || '';
    $('cfgName').value = ct.name || '';
    $('cfgEmail').value = ct.email || '';
    $('cfgPhone').value = ct.phone || '';
  }

  function wireConfig() {
    const map = {
      cfgTitle: (v) => (data.config.title = v),
      cfgSubtitle: (v) => (data.config.subtitle = v),
      cfgNote: (v) => (data.config.note = v),
      cfgName: (v) => ((data.config.contact ||= {}).name = v),
      cfgEmail: (v) => ((data.config.contact ||= {}).email = v),
      cfgPhone: (v) => ((data.config.contact ||= {}).phone = v),
    };
    Object.entries(map).forEach(([id, set]) => {
      $(id).addEventListener('input', (e) => { set(e.target.value); markDirty(); });
    });
  }

  /* ============================ render ============================ */
  const STATUSES = [['available', 'Available'], ['pending', 'On hold'], ['sold', 'Sold']];

  function photoSrc(p) { return previews.get(p) || p; }

  function itemRowHTML(item, i) {
    const st = (item.status || 'available').toLowerCase();
    const open = openItems.has(item.id);
    const photos = item.photos || [];
    const cover = photos[0];

    return `
      <div class="item-row ${st}" data-i="${i}">
        <div class="item-top">
          <span class="idx">${i + 1}</span>
          <div class="photo-tile" style="width:44px;height:44px;flex:0 0 auto">
            ${cover ? `<img src="${esc(photoSrc(cover))}" alt="">` : ''}
          </div>
          <div class="grow" style="min-width:0">
            <input type="text" data-f="title" data-i="${i}" value="${esc(item.title || '')}"
                   placeholder="Item name" style="font-weight:600;border-color:transparent;background:transparent;padding-left:0">
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex:0 0 auto">
            <span style="color:var(--ink-3);font-size:14px">$</span>
            <input type="number" data-f="price" data-i="${i}" value="${item.price ?? ''}"
                   placeholder="—" min="0" step="1" style="width:86px;text-align:right">
            <select data-f="status" data-i="${i}" style="width:110px">
              ${STATUSES.map(([v, l]) => `<option value="${v}" ${st === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
            <button class="iconbtn" data-act="up"     data-i="${i}" ${i === 0 ? 'disabled' : ''} title="Move up">↑</button>
            <button class="iconbtn" data-act="down"   data-i="${i}" ${i === data.items.length - 1 ? 'disabled' : ''} title="Move down">↓</button>
            <button class="iconbtn" data-act="toggle" data-i="${i}" title="${open ? 'Collapse' : 'Details & photos'}">${open ? '▴' : '▾'}</button>
            <button class="iconbtn danger" data-act="del" data-i="${i}" title="Delete item">✕</button>
          </div>
        </div>

        <div class="collapse-body" ${open ? '' : 'hidden'}>
          <div class="three-col">
            <label class="field"><span>Category</span>
              <input type="text" data-f="category" data-i="${i}" value="${esc(item.category || '')}" placeholder="Living room" list="catList"></label>
            <label class="field"><span>Condition</span>
              <input type="text" data-f="condition" data-i="${i}" value="${esc(item.condition || '')}" placeholder="Very good"></label>
            <label class="field"><span>Dimensions</span>
              <input type="text" data-f="dimensions" data-i="${i}" value="${esc(item.dimensions || '')}" placeholder='30" W × 20" D'></label>
          </div>
          <label class="field"><span>Description</span>
            <textarea data-f="description" data-i="${i}" rows="2" placeholder="Anything a buyer should know — wear, brand, why you love it.">${esc(item.description || '')}</textarea></label>
          <span style="display:block;font-size:13px;font-weight:600;color:var(--ink-2);margin-bottom:6px">Photos</span>
          <div class="photostrip">
            ${photos.map((p, n) => `
              <div class="photo-tile ${n === 0 ? 'cover' : ''} ${newBlobs.has(p) ? 'new' : ''}">
                <img src="${esc(photoSrc(p))}" alt="">
                <div class="tools">
                  <button data-act="pleft"  data-i="${i}" data-n="${n}" ${n === 0 ? 'disabled style="opacity:.3"' : ''} title="Move left">‹</button>
                  <button data-act="pdel"   data-i="${i}" data-n="${n}" title="Remove photo">✕</button>
                  <button data-act="pright" data-i="${i}" data-n="${n}" ${n === photos.length - 1 ? 'disabled style="opacity:.3"' : ''} title="Move right">›</button>
                </div>
              </div>`).join('')}
            <button class="addphoto" data-act="addphoto" data-i="${i}">
              <span style="font-size:20px">+</span><span>Add photos</span>
            </button>
          </div>
        </div>
      </div>`;
  }

  function renderItems() {
    const cats = [...new Set(data.items.map((i) => i.category).filter(Boolean))];
    $('itemList').innerHTML =
      (data.items.length ? data.items.map(itemRowHTML).join('')
                         : `<div class="panel" style="text-align:center;color:var(--ink-3)">No items yet — add the first one below.</div>`)
      + `<datalist id="catList">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>`;

    const sold = data.items.filter((i) => (i.status || '') === 'sold').length;
    $('itemCount').textContent = data.items.length
      ? `— ${data.items.length} listed${sold ? `, ${sold} sold` : ''}` : '';
  }

  /* ---------- events (delegated) ---------- */
  function wireItemList() {
    const host = $('itemList');

    host.addEventListener('input', (e) => {
      const f = e.target.dataset.f;
      if (!f) return;
      const item = data.items[Number(e.target.dataset.i)];
      if (!item) return;
      if (f === 'price') {
        item.price = e.target.value === '' ? null : Number(e.target.value);
      } else {
        item[f] = e.target.value;
      }
      markDirty();
    });

    host.addEventListener('change', (e) => {
      if (e.target.dataset.f !== 'status') return;
      const i = Number(e.target.dataset.i);
      data.items[i].status = e.target.value;
      e.target.closest('.item-row').className = 'item-row ' + e.target.value;
      const sold = data.items.filter((x) => x.status === 'sold').length;
      $('itemCount').textContent = `— ${data.items.length} listed${sold ? `, ${sold} sold` : ''}`;
      markDirty();
    });

    host.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const i = Number(btn.dataset.i);
      const item = data.items[i];
      const act = btn.dataset.act;

      if (act === 'toggle') {
        openItems.has(item.id) ? openItems.delete(item.id) : openItems.add(item.id);
        renderItems(); return;
      }
      if (act === 'up' || act === 'down') {
        const j = act === 'up' ? i - 1 : i + 1;
        if (j < 0 || j >= data.items.length) return;
        [data.items[i], data.items[j]] = [data.items[j], data.items[i]];
        renderItems(); markDirty(); return;
      }
      if (act === 'del') {
        if (!confirm(`Delete "${item.title || 'this item'}"? This cannot be undone after you save.`)) return;
        (item.photos || []).forEach((p) => dropPhoto(p));
        data.items.splice(i, 1);
        renderItems(); markDirty(); return;
      }
      if (act === 'addphoto') { pickPhotos(i); return; }

      const n = Number(btn.dataset.n);
      if (act === 'pdel') {
        dropPhoto(item.photos[n]);
        item.photos.splice(n, 1);
        renderItems(); markDirty(); return;
      }
      if (act === 'pleft' || act === 'pright') {
        const j = act === 'pleft' ? n - 1 : n + 1;
        if (j < 0 || j >= item.photos.length) return;
        [item.photos[n], item.photos[j]] = [item.photos[j], item.photos[n]];
        renderItems(); markDirty(); return;
      }
    });
  }

  function dropPhoto(path) {
    if (!path) return;
    if (newBlobs.has(path)) {                 // never committed — just forget it
      newBlobs.delete(path);
      const u = previews.get(path);
      if (u) { URL.revokeObjectURL(u); previews.delete(path); }
    } else {
      removedPaths.add(path);
    }
  }

  /* ---------- photo picking ---------- */
  let pickTarget = null;

  function pickPhotos(i) {
    pickTarget = i;
    const picker = $('filePicker');
    picker.value = '';
    picker.click();
  }

  async function onFilesPicked(e) {
    const files = [...e.target.files];
    if (!files.length || pickTarget === null) return;
    const item = data.items[pickTarget];
    item.photos = item.photos || [];

    msg('topMsg', `Processing ${files.length} photo${files.length === 1 ? '' : 's'}…`, 'info');
    let failed = 0;
    for (const file of files) {
      try {
        const { blob, base64 } = await processImage(file);
        const path = `images/${slug(item.title || item.id)}-${rand()}.jpg`;
        newBlobs.set(path, base64);
        previews.set(path, URL.createObjectURL(blob));
        item.photos.push(path);
      } catch (err) {
        failed++;
        console.error(file.name, err);
      }
    }
    openItems.add(item.id);
    renderItems();
    markDirty();
    msg('topMsg', failed
      ? `Added ${files.length - failed} photo(s); ${failed} could not be read.`
      : `Added ${files.length} photo${files.length === 1 ? '' : 's'}. Press <strong>Save changes</strong> to publish.`,
      failed ? 'err' : 'ok');
    pickTarget = null;
  }

  /* ============================ save ============================ */
  function cleanForSave() {
    const out = {
      config: {
        title: data.config.title || '',
        subtitle: data.config.subtitle || '',
        note: data.config.note || '',
        contact: {
          name: (data.config.contact || {}).name || '',
          email: (data.config.contact || {}).email || '',
          phone: (data.config.contact || {}).phone || '',
        },
      },
      items: data.items.map((it) => ({
        id: it.id,
        title: it.title || '',
        price: it.price === '' || it.price === undefined ? null : it.price,
        status: it.status || 'available',
        category: it.category || '',
        condition: it.condition || '',
        dimensions: it.dimensions || '',
        description: it.description || '',
        photos: (it.photos || []).filter(Boolean),
      })),
    };
    return JSON.stringify(out, null, 2) + '\n';
  }

  async function save() {
    const btn = $('saveBtn');
    btn.disabled = true;
    const setStatus = (t) => ($('saveStatus').textContent = t);

    try {
      // Warn if someone else changed items.json since we loaded it.
      const cur = await gh(`/repos/${REPO.owner}/${REPO.repo}/contents/items.json?ref=${encodeURIComponent(REPO.branch)}`);
      if (baseItemsSha && cur.sha !== baseItemsSha &&
          !confirm('The listing was changed somewhere else since you opened this page. Saving will overwrite those changes. Continue?')) {
        btn.disabled = false; setStatus('Save cancelled'); return;
      }

      setStatus('Reading branch…');
      const ref = await gh(`/repos/${REPO.owner}/${REPO.repo}/git/ref/heads/${encodeURIComponent(REPO.branch)}`);
      const headSha = ref.object.sha;
      const headCommit = await gh(`/repos/${REPO.owner}/${REPO.repo}/git/commits/${headSha}`);

      const tree = [];

      // upload new photos as blobs
      const uploads = [...newBlobs.entries()];
      let done = 0;
      for (const [path, base64] of uploads) {
        setStatus(`Uploading photo ${++done} of ${uploads.length}…`);
        const blob = await gh(`/repos/${REPO.owner}/${REPO.repo}/git/blobs`, {
          method: 'POST',
          body: JSON.stringify({ content: base64, encoding: 'base64' }),
        });
        tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
      }

      // delete photos no longer referenced anywhere
      const stillUsed = new Set(data.items.flatMap((it) => it.photos || []));
      for (const path of removedPaths) {
        if (!stillUsed.has(path)) tree.push({ path, mode: '100644', type: 'blob', sha: null });
      }

      tree.push({ path: 'items.json', mode: '100644', type: 'blob', content: cleanForSave() });

      setStatus('Committing…');
      const newTree = await gh(`/repos/${REPO.owner}/${REPO.repo}/git/trees`, {
        method: 'POST',
        body: JSON.stringify({ base_tree: headCommit.tree.sha, tree }),
      });

      const nUp = uploads.length;
      const message = `Update listing (${data.items.length} items${nUp ? `, +${nUp} photo${nUp === 1 ? '' : 's'}` : ''})`;
      const commit = await gh(`/repos/${REPO.owner}/${REPO.repo}/git/commits`, {
        method: 'POST',
        body: JSON.stringify({ message, tree: newTree.sha, parents: [headSha] }),
      });

      await gh(`/repos/${REPO.owner}/${REPO.repo}/git/refs/heads/${encodeURIComponent(REPO.branch)}`, {
        method: 'PATCH',
        body: JSON.stringify({ sha: commit.sha }),
      });

      newBlobs.clear();
      removedPaths.clear();
      markDirty(false);
      msg('topMsg', 'Saved. The public site updates in about a minute — refresh it to see the change.', 'ok');
      setStatus('Saved');
      await loadData();
      msg('topMsg', 'Saved. The public site updates in about a minute — refresh it to see the change.', 'ok');
    } catch (err) {
      console.error(err);
      msg('topMsg', `Could not save: ${esc(err.message)}`, 'err');
      setStatus('Save failed');
      btn.disabled = false;
    }
  }

  /* ============================ boot ============================ */
  function addItem() {
    const id = `item-${Date.now().toString(36)}-${rand()}`;
    data.items.unshift({
      id, title: '', price: null, status: 'available',
      category: '', condition: '', dimensions: '', description: '', photos: [],
    });
    openItems.add(id);
    renderItems();
    markDirty();
    const first = $('itemList').querySelector('[data-f="title"]');
    if (first) first.focus();
  }

  async function init() {
    await loadRepoConfig();

    if (!REPO.owner || !REPO.repo) {
      msg('gateMsg', 'This page cannot tell which GitHub repository it belongs to. Add <code>assets/repo.json</code> with <code>{"owner":"…","repo":"…"}</code>.', 'err');
    } else {
      $('patLink').href =
        `https://github.com/settings/personal-access-tokens/new?name=moving-sale&description=Edit+the+moving+sale+listing`;
    }

    wireConfig();
    wireItemList();
    $('filePicker').addEventListener('change', onFilesPicked);
    $('addItemBtn').addEventListener('click', addItem);
    $('saveBtn').addEventListener('click', save);
    $('signOutBtn').addEventListener('click', signOut);
    $('reloadBtn').addEventListener('click', async () => {
      if (dirty && !confirm('Discard your unsaved changes?')) return;
      try { await loadData(); } catch (err) { msg('topMsg', esc(err.message), 'err'); }
    });

    const attempt = async (token, remember) => {
      msg('gateMsg', 'Checking…', 'info');
      try {
        await signIn(token, remember);
      } catch (err) {
        localStorage.removeItem(TOKEN_KEY);
        sessionStorage.removeItem(TOKEN_KEY);
        const hint = err.status === 401 ? 'That token was not accepted. It may be wrong or expired.'
                   : err.status === 404 ? `Could not find ${REPO.owner}/${REPO.repo}, or the token has no access to it.`
                   : esc(err.message);
        msg('gateMsg', hint, 'err');
        $('gate').hidden = false;
        $('editor').hidden = true;
      }
    };

    $('signInBtn').addEventListener('click', () => {
      const t = $('tokenInput').value.trim();
      if (!t) { msg('gateMsg', 'Paste your token first.', 'err'); return; }
      attempt(t, $('rememberToken').checked);
    });
    $('tokenInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('signInBtn').click();
    });

    const saved = localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
    if (saved) await attempt(saved, !!localStorage.getItem(TOKEN_KEY));
  }

  init();
})();
