// Directory: search and room filters over the collection in data.js
(() => {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const roomOf = id => ROOMS.find(r => r.id === id);
  const grid = document.getElementById('grid'), empty = document.getElementById('empty'),
        q = document.getElementById('q'), chips = document.getElementById('chips');
  let room = 'all';

  const glyph = e => e.kind === 'case' ? '◆' : e.name[0];
  const card = e => `<article class="piece" data-kind="${e.kind}" style="--wall:${roomOf(e.room).wall};--c:${e.color}">
    <div class="plate" aria-hidden="true"><div class="obj">${esc(glyph(e))}</div></div>
    <div class="label">
      <h3>${esc(e.name)}${e.sample ? '<span class="tag-sample">Sample</span>' : ''}</h3>
      <div class="by">${esc(e.maker)}, ${e.year}</div>
      <p>${esc(e.desc)}</p>
      <div class="meta"><span>${esc(roomOf(e.room).name)} · ${e.acc}</span>${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">Visit</a>` : ''}</div>
    </div></article>`;

  function render() {
    const s = q.value.trim().toLowerCase();
    const list = EXHIBITS.filter(e => (room === 'all' || e.room === room) &&
      (!s || (e.name + ' ' + e.maker + ' ' + e.desc + ' ' + e.medium).toLowerCase().includes(s)));
    grid.innerHTML = list.map(card).join('');
    empty.hidden = list.length > 0;
  }

  chips.innerHTML = [{id: 'all', name: 'All rooms'}, ...ROOMS]
    .map(r => `<button type="button" data-room="${r.id}" aria-pressed="${r.id === 'all'}">${esc(r.name)}</button>`).join('');
  chips.addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    room = b.dataset.room;
    chips.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
    render();
  });
  q.addEventListener('input', render);
  render();
})();
