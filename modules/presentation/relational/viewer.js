(() => {
  'use strict';
  const payload = document.getElementById('waxwing-source');
  const layout = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload.textContent), char => char.charCodeAt(0))));
  const model = layout.model;
  const entries = [{ id: model.id, record: model }, ...['tables', 'columns', 'constraints', 'indexes', 'associations', 'sources'].flatMap(key => model[key].map(record => ({ id: record.id, record })))];
  const records = new Map(entries.map(entry => [entry.id, entry.record]));
  const viewport = document.getElementById('map-viewport'), svg = viewport.querySelector('svg');
  const inspector = document.getElementById('inspector'), content = document.getElementById('inspector-content');
  const filter = document.getElementById('table-filter'), focus = document.getElementById('focus-neighbors');
  const visualRecords = [...svg.querySelectorAll('[data-ref]')], tableLinks = [...document.querySelectorAll('[data-table-link]')];
  const tableGroups = [...svg.querySelectorAll('[data-table-ref]')], edges = [...svg.querySelectorAll('.connection,.connection-label')];
  let selected = null, scale = 1, fitMode = true;
  function tableFor(id) {
    const record = records.get(id);
    return model.tables.some(table => table.id === id) ? id : record?.tableRef ?? record?.from?.tableRef ?? null;
  }
  function applyVisibility() {
    const query = filter.value.trim().toLocaleLowerCase();
    let visible = new Set(model.tables.filter(table => `${table.label} ${table.name} ${table.schema ?? ''}`.toLocaleLowerCase().includes(query)).map(table => table.id));
    const table = tableFor(selected);
    if (focus.checked && table) {
      const neighbors = new Set([table]);
      for (const edge of layout.edges) if (edge.from === table || edge.to === table) { neighbors.add(edge.from); neighbors.add(edge.to); }
      visible = new Set([...visible].filter(ref => neighbors.has(ref)));
    }
    for (const group of tableGroups) { group.classList.toggle('dimmed', !visible.has(group.dataset.tableRef)); group.classList.toggle('related', group.dataset.tableRef === table); }
    for (const element of edges) { const edge = layout.edges.find(item => item.ref === element.dataset.ref); element.classList.toggle('dimmed', !visible.has(edge.from) || !visible.has(edge.to)); }
    for (const link of tableLinks) { link.hidden = !visible.has(link.dataset.tableLink); link.classList.toggle('selected', link.dataset.tableLink === table); }
    document.getElementById('table-filter-summary').textContent = `${visible.size} of ${model.tables.length} tables shown${visible.size ? '' : '. Clear the filter to see all tables.'}`;
  }
  function zoom(value, fit = false) {
    fitMode = fit;
    scale = Math.min(2.5, Math.max(0.08, value));
    svg.style.width = `${layout.canvas.width * scale}px`; svg.style.height = `${layout.canvas.height * scale}px`;
    document.getElementById('zoom-label').textContent = `${Math.round(scale * 100)}%`;
  }
  function fit() { zoom(Math.min(1, (viewport.clientWidth - 8) / layout.canvas.width, Math.max(440, viewport.clientHeight - 8) / layout.canvas.height), true); }
  function reveal(id) {
    const table = layout.tables.find(item => item.ref === tableFor(id));
    if (!table) return;
    const column = table.columns.find(item => item.ref === id), box = column?.box ?? table.box;
    viewport.scrollTo({ left: Math.max(0, (box.x + box.width / 2) * scale - viewport.clientWidth / 2), top: Math.max(0, (box.y + box.height / 2) * scale - viewport.clientHeight / 2), behavior: 'smooth' });
  }
  function select(id, updateHash = true, center = false) {
    const template = document.getElementById(`relational-record-${id}`);
    if (!template || !records.has(id)) return;
    selected = id;
    content.replaceChildren(template.content.cloneNode(true));
    inspector.hidden = false; document.body.classList.add('inspector-open');
    for (const record of visualRecords) record.classList.toggle('selected', record.dataset.ref === id);
    applyVisibility();
    if (updateHash && new URLSearchParams(location.hash.slice(1)).get('record') !== id) location.hash = `record=${encodeURIComponent(id)}`;
    if (fitMode) fit();
    if (center) reveal(id);
  }
  function fromHash() {
    const id = new URLSearchParams(location.hash.slice(1)).get('record');
    if (id) select(id, false, true);
  }
  svg.addEventListener('click', event => { const item = event.target.closest('[data-ref]'); if (item) select(item.dataset.ref); });
  svg.addEventListener('keydown', event => { if (!['Enter', ' '].includes(event.key)) return; const item = event.target.closest('[data-ref]'); if (item) { event.preventDefault(); select(item.dataset.ref); } });
  document.addEventListener('click', event => { const link = event.target.closest('a[href^="#record="]'); if (!link) return; event.preventDefault(); const id = new URLSearchParams(link.hash.slice(1)).get('record'); select(id, true, true); });
  document.getElementById('close-inspector').onclick = () => {
    inspector.hidden = true; document.body.classList.remove('inspector-open'); selected = null;
    for (const record of visualRecords) record.classList.remove('selected');
    applyVisibility();
    if (location.hash.startsWith('#record=')) { try { history.replaceState(null, '', location.pathname + location.search); } catch { location.hash = ''; } }
    if (fitMode) fit();
  };
  filter.oninput = applyVisibility; focus.onchange = applyVisibility;
  document.getElementById('zoom-in').onclick = () => zoom(scale * 1.25);
  document.getElementById('zoom-out').onclick = () => zoom(scale / 1.25);
  document.getElementById('zoom-read').onclick = () => { zoom(1); if (selected) reveal(selected); };
  document.getElementById('zoom-fit').onclick = fit;
  document.getElementById('theme').onclick = () => {
    const dark = document.body.dataset.theme !== 'dark'; document.body.dataset.theme = dark ? 'dark' : 'light'; svg.dataset.theme = document.body.dataset.theme;
    document.getElementById('theme').textContent = dark ? 'Light theme' : 'Dark theme';
  };
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type })), link = document.createElement('a');
    link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  document.getElementById('source-download').onclick = () => download(`${model.id}.json`, JSON.stringify(model, null, 2) + '\n', 'application/json');
  document.getElementById('layout-download').onclick = () => download(`${model.id}.layout.json`, JSON.stringify(layout, null, 2) + '\n', 'application/json');
  document.getElementById('svg-download').onclick = () => {
    const copy = svg.cloneNode(true); copy.removeAttribute('style'); copy.setAttribute('width', layout.canvas.width); copy.setAttribute('height', layout.canvas.height);
    for (const item of copy.querySelectorAll('.selected,.dimmed,.related')) item.classList.remove('selected', 'dimmed', 'related');
    download(`${model.id}.svg`, '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(copy) + '\n', 'image/svg+xml');
  };
  window.addEventListener('hashchange', fromHash);
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => { if (fitMode) fit(); }).observe(viewport);
  window.addEventListener('resize', () => { if (fitMode) fit(); });
  applyVisibility(); fit(); fromHash();
})();
