(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const money = (n) => {
    if (n === '' || n === null || n === undefined) return 'Ask';
    const v = Number(n);
    if (!isFinite(v)) return esc(n);
    return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  };

  const PLACEHOLDER = `<div class="placeholder">
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4">
        <rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.6"/>
        <path d="M21 16l-5-5-5 5-3-3-5 5"/>
      </svg>
      <span>Photo coming soon</span>
    </div>`;

  let DATA = { config: {}, items: [] };
  let hideSold = false;
  let activeCategory = null;

  // Contact details are stored base64-encoded so the plain strings never appear
  // in the repo or in items.json, where search engines would pick them up.
  function decodeContact(v) {
    const s = String(v || '');
    if (!s.startsWith('b64:')) return s;          // plain text still works
    try {
      return new TextDecoder().decode(
        Uint8Array.from(atob(s.slice(4)), (c) => c.charCodeAt(0)));
    } catch (_) { return ''; }
  }

  function telHref(raw) {
    const d = String(raw || '').replace(/[^\d+]/g, '');
    if (d.startsWith('+')) return d;
    if (d.length === 10) return '+1' + d;          // US number typed without country code
    if (d.length === 11 && d.startsWith('1')) return '+' + d;
    return d;
  }

  /* ---------- render ---------- */
  function statusOf(item) {
    const s = (item.status || 'available').toLowerCase();
    return ['available', 'pending', 'sold'].includes(s) ? s : 'available';
  }

  function cardHTML(item, index) {
    const st = statusOf(item);
    const photos = Array.isArray(item.photos) ? item.photos.filter(Boolean) : [];
    const first = photos[0];

    const tag = st === 'sold' ? `<span class="status-tag sold">Sold</span>`
              : st === 'pending' ? `<span class="status-tag pending">On hold</span>` : '';

    const thumbInner = first
      ? `<img src="${esc(first)}" alt="${esc(item.title)}" loading="lazy" decoding="async">`
      : PLACEHOLDER;

    const meta = [
      item.category  ? `<span class="pill">${esc(item.category)}</span>` : '',
      item.condition ? `<span class="pill">${esc(item.condition)}</span>` : '',
      item.dimensions? `<span class="pill">${esc(item.dimensions)}</span>` : '',
    ].join('');

    return `
      <article class="card ${st === 'sold' ? 'is-sold' : ''}" data-index="${index}">
        <button class="thumb" data-open="${index}" ${photos.length ? '' : 'disabled style="cursor:default"'}
                aria-label="View photos of ${esc(item.title)}">
          ${thumbInner}
          ${tag}
          ${photos.length > 1 ? `<span class="badge-count">${photos.length} photos</span>` : ''}
        </button>
        <div class="body">
          <div class="row-1">
            <h2 class="name">${esc(item.title)}</h2>
            <span class="price">${money(item.price)}</span>
          </div>
          ${meta ? `<div class="meta">${meta}</div>` : ''}
          ${item.description ? `<p class="desc">${esc(item.description)}</p>` : ''}
        </div>
      </article>`;
  }

  function visibleItems() {
    return DATA.items
      .map((it, i) => ({ it, i }))
      .filter(({ it }) => !(hideSold && statusOf(it) === 'sold'))
      .filter(({ it }) => !activeCategory || (it.category || 'Other') === activeCategory);
  }

  function render() {
    const grid = $('grid');
    const shown = visibleItems();

    grid.innerHTML = shown.length
      ? shown.map(({ it, i }) => cardHTML(it, i)).join('')
      : `<div class="empty">No items match this filter.</div>`;

    const total = DATA.items.length;
    const sold = DATA.items.filter((it) => statusOf(it) === 'sold').length;
    $('count').textContent = total
      ? `${shown.length} of ${total} item${total === 1 ? '' : 's'}${sold ? ` · ${sold} sold` : ''}`
      : 'No items listed yet';

    grid.querySelectorAll('[data-open]').forEach((b) =>
      b.addEventListener('click', () => openLightbox(Number(b.dataset.open))));
  }

  function renderFilters() {
    const cats = [...new Set(DATA.items.map((i) => i.category).filter(Boolean))].sort();
    const host = $('categoryFilters');
    if (cats.length < 2) { host.innerHTML = ''; return; }
    host.innerHTML = cats.map((c) =>
      `<button class="chip" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
    host.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => {
      activeCategory = activeCategory === b.dataset.cat ? null : b.dataset.cat;
      host.querySelectorAll('[data-cat]').forEach((x) =>
        x.classList.toggle('on', x.dataset.cat === activeCategory));
      render();
    }));
  }

  /* ---------- lightbox ---------- */
  let lbItem = null, lbIdx = 0;

  function openLightbox(itemIndex) {
    lbItem = DATA.items[itemIndex];
    const photos = (lbItem.photos || []).filter(Boolean);
    if (!photos.length) return;
    lbIdx = 0;
    $('lbTitle').textContent = lbItem.title;
    $('lbPrice').textContent = statusOf(lbItem) === 'sold' ? 'Sold' : money(lbItem.price);
    $('lightbox').hidden = false;
    requestAnimationFrame(() => $('lightbox').classList.add('open'));
    document.body.style.overflow = 'hidden';
    showPhoto(0);
    $('lbClose').focus();
  }

  function closeLightbox() {
    $('lightbox').classList.remove('open');
    document.body.style.overflow = '';
    setTimeout(() => { $('lightbox').hidden = true; }, 200);
    lbItem = null;
  }

  function showPhoto(i) {
    if (!lbItem) return;
    const photos = (lbItem.photos || []).filter(Boolean);
    lbIdx = (i + photos.length) % photos.length;
    $('lbImg').src = photos[lbIdx];
    $('lbImg').alt = `${lbItem.title} — photo ${lbIdx + 1} of ${photos.length}`;
    const multi = photos.length > 1;
    $('lbPrev').hidden = !multi; $('lbNext').hidden = !multi;
    $('lbDots').innerHTML = multi
      ? photos.map((_, n) => `<button class="dot ${n === lbIdx ? 'on' : ''}" data-dot="${n}" aria-label="Photo ${n + 1}"></button>`).join('')
      : '';
    $('lbDots').querySelectorAll('[data-dot]').forEach((d) =>
      d.addEventListener('click', () => showPhoto(Number(d.dataset.dot))));
  }

  function wireLightbox() {
    $('lbClose').addEventListener('click', closeLightbox);
    $('lbPrev').addEventListener('click', () => showPhoto(lbIdx - 1));
    $('lbNext').addEventListener('click', () => showPhoto(lbIdx + 1));
    $('lightbox').addEventListener('click', (e) => {
      if (e.target.id === 'lightbox' || e.target.classList.contains('lb-stage')) closeLightbox();
    });
    document.addEventListener('keydown', (e) => {
      if ($('lightbox').hidden) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') showPhoto(lbIdx - 1);
      if (e.key === 'ArrowRight') showPhoto(lbIdx + 1);
    });
    // swipe
    let x0 = null;
    const stage = document.querySelector('.lb-stage');
    stage.addEventListener('touchstart', (e) => { x0 = e.changedTouches[0].clientX; }, { passive: true });
    stage.addEventListener('touchend', (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 45) showPhoto(lbIdx + (dx < 0 ? 1 : -1));
      x0 = null;
    }, { passive: true });
  }

  /* ---------- boot ---------- */
  async function boot() {
    try {
      const res = await fetch('items.json?v=' + Date.now());
      if (!res.ok) throw new Error('HTTP ' + res.status);
      DATA = await res.json();
    } catch (err) {
      $('grid').innerHTML = `<div class="empty">Could not load the listing.<br><small>${esc(err.message)}</small></div>`;
      $('count').textContent = '';
      return;
    }

    const c = DATA.config || {};
    if (c.title) { document.title = c.title; $('siteTitle').textContent = c.title; }
    $('siteSubtitle').textContent = c.subtitle || '';
    if (c.note) { $('siteNote').textContent = c.note; $('siteNote').hidden = false; }

    const ct = c.contact || {};
    const email = decodeContact(ct.email);
    const phone = decodeContact(ct.phone);
    const bits = [];
    if (email) bits.push(`<a href="mailto:${esc(email)}">${esc(email)}</a>`);
    if (phone) bits.push(`<a href="tel:${esc(telHref(phone))}">${esc(phone)}</a>`);
    const head = $('headContact');
    if (bits.length) {
      head.innerHTML = `<strong>Interested in something?</strong> Contact ${esc(ct.name || 'us')} `
        + `at ${bits.join(' or ')} and mention the item.`;
      head.hidden = false;
    }

    $('toggleSold').addEventListener('click', (e) => {
      hideSold = !hideSold;
      e.currentTarget.setAttribute('aria-pressed', String(hideSold));
      e.currentTarget.textContent = hideSold ? 'Show sold' : 'Hide sold';
      render();
    });

    renderFilters();
    wireLightbox();
    render();
  }

  boot();
})();
