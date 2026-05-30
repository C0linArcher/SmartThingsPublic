const $ = (sel, el = document) => el.querySelector(sel);
const api = async (path, opts) => {
  const r = await fetch(path, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
};
const money = (n) => '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let PRODUCTS = [];

function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 2600);
}

// --- Tabs (with #hash deep-linking) ---
function activateTab(name) {
  const tab = document.querySelector(`.tab[data-tab="${name}"]`);
  if (!tab) return;
  document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
  tab.classList.add('active');
  $('#' + name).classList.add('active');
  if (name === 'ledger') loadLedger();
  if (name === 'products') loadProducts();
}
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => { location.hash = tab.dataset.tab; });
});
window.addEventListener('hashchange', () => activateTab(location.hash.slice(1) || 'dashboard'));

// --- Dashboard ---
const ALERT_ICON = { LOW_STOCK: '📉', EXPIRING_SOON: '⏳', EXPIRED: '🚫' };

async function loadDashboard() {
  const d = await api('/api/dashboard');
  $('#today').textContent = d.today;
  const m = d.metrics;
  $('#metrics').innerHTML = `
    <div class="metric"><div class="num">${m.products}</div><div class="label">Products tracked</div></div>
    <div class="metric"><div class="num">${money(m.inventoryValue)}</div><div class="label">Inventory value (at cost)</div></div>
    <div class="metric ${m.lowStock ? 'warn' : ''}"><div class="num">${m.lowStock}</div><div class="label">Low-stock items</div></div>
    <div class="metric ${m.expiringSoon ? 'warn' : ''}"><div class="num">${m.expiringSoon}</div><div class="label">Lots expiring soon</div></div>
    <div class="metric ${m.expiredUnits ? 'bad' : ''}"><div class="num">${m.expiredUnits}</div><div class="label">Expired units</div></div>
  `;
  $('#alerts').innerHTML = d.alerts.length
    ? d.alerts.map((a) => `
      <div class="alert ${a.type}">
        <span class="dot">${ALERT_ICON[a.type] || '•'}</span>
        <div class="msg"><span class="who">${a.product}</span> <span class="sku">${a.sku}</span><br>${a.message}</div>
      </div>`).join('')
    : '<div class="empty">All clear — no alerts 🎉</div>';
}

// --- Products ---
async function loadProducts() {
  PRODUCTS = await api('/api/products');
  $('#product-list').innerHTML = PRODUCTS.map((p) => `
    <div class="card">
      <div class="prow">
        <div>
          <div class="pname">${p.name}</div>
          <div class="pmeta">${p.sku} · ${p.category || '—'} · ${p.supplier || '—'}</div>
          <div class="tagline">
            <span class="pill ${p.storage}">${p.storage}</span>
            ${p.perishable ? '<span class="pill">perishable</span>' : '<span class="pill">non-perishable</span>'}
            ${p.needsReorder ? '<span class="pill" style="background:var(--red-bg);color:var(--red)">reorder</span>' : ''}
            ${p.expiredOnHand ? `<span class="pill" style="background:var(--red-bg);color:var(--red)">${p.expiredOnHand} expired</span>` : ''}
          </div>
        </div>
        <div class="stock">
          <div class="qty ${p.needsReorder ? 'low' : ''}">${p.onHand}</div>
          <div class="unit">${p.unit} · @ ${money(p.unit_price)}</div>
        </div>
      </div>
      <div class="actions">
        <button class="btn ghost" data-act="batches" data-id="${p.id}">Batches</button>
        <button class="btn ghost" data-act="receive" data-id="${p.id}">Receive</button>
        <button class="btn primary" data-act="sell" data-id="${p.id}">Sell</button>
      </div>
    </div>`).join('');

  $('#product-list').querySelectorAll('button[data-act]').forEach((b) => {
    b.addEventListener('click', () => {
      const p = PRODUCTS.find((x) => x.id === Number(b.dataset.id));
      if (b.dataset.act === 'receive') openReceive(p);
      if (b.dataset.act === 'sell') openSell(p);
      if (b.dataset.act === 'batches') openBatches(p);
    });
  });
}

// --- Ledger ---
async function loadLedger() {
  const rows = await api('/api/movements?limit=80');
  $('#movements').innerHTML = `<div class="card">${rows.map((m) => {
    const sign = m.quantity > 0 ? 'pos' : 'neg';
    const when = new Date(m.occurred_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    return `<div class="mv">
      <div>
        <span class="mtype ${m.type}">${m.type.replace('_', ' ')}</span>
        <div class="pname" style="font-size:14px;margin-top:4px">${m.product}</div>
        <div class="mwhen">${m.lot_number ? 'Lot ' + m.lot_number + ' · ' : ''}${m.reason || ''} · ${when}</div>
      </div>
      <div class="mqty ${sign}">${m.quantity > 0 ? '+' : ''}${m.quantity}</div>
    </div>`;
  }).join('') || '<div class="empty">No movements yet</div>'}</div>`;
}

// --- Action sheet ---
function openSheet(title, bodyHTML) {
  $('#sheet-title').textContent = title;
  $('#sheet-body').innerHTML = bodyHTML;
  $('#sheet').hidden = false;
}
function closeSheet() { $('#sheet').hidden = true; }
$('#sheet-close').addEventListener('click', closeSheet);
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });

function openReceive(p) {
  openSheet(`Receive — ${p.name}`, `
    <label>Quantity (${p.unit})</label>
    <input id="f-qty" type="number" inputmode="numeric" min="1" value="${p.reorder_qty}" />
    <label>Lot number (optional)</label>
    <input id="f-lot" type="text" placeholder="auto-generated" />
    <label>Expiration date${p.perishable ? '' : ' (n/a)'}</label>
    <input id="f-exp" type="date" ${p.perishable ? '' : 'disabled'} />
    <div class="actions">
      <button class="btn ghost" id="f-cancel">Cancel</button>
      <button class="btn primary" id="f-go">Receive stock</button>
    </div>`);
  $('#f-cancel').onclick = closeSheet;
  $('#f-go').onclick = async () => {
    try {
      const r = await api('/api/receive', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: p.id,
          quantity: Number($('#f-qty').value),
          lotNumber: $('#f-lot').value || undefined,
          expirationDate: $('#f-exp').value || undefined,
        }),
      });
      closeSheet();
      toast(`Received lot ${r.lotNumber}${r.expirationDate ? ' (exp ' + r.expirationDate + ')' : ''}`);
      await refreshAll();
    } catch (e) { toast(e.message, true); }
  };
}

function openSell(p) {
  openSheet(`Sell — ${p.name}`, `
    <p class="pmeta">${p.onHand} ${p.unit} sellable · picked first-expired-first-out (FEFO)</p>
    <label>Quantity (${p.unit})</label>
    <input id="f-qty" type="number" inputmode="numeric" min="1" max="${p.onHand}" value="1" />
    <label>Reference (optional)</label>
    <input id="f-ref" type="text" placeholder="e.g. SO-2050" />
    <div class="actions">
      <button class="btn ghost" id="f-cancel">Cancel</button>
      <button class="btn primary" id="f-go">Fulfill sale</button>
    </div>`);
  $('#f-cancel').onclick = closeSheet;
  $('#f-go').onclick = async () => {
    try {
      const r = await api('/api/sell', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: p.id, quantity: Number($('#f-qty').value), reference: $('#f-ref').value || undefined }),
      });
      closeSheet();
      const lots = r.picks.map((x) => `${x.taken} from ${x.lotNumber}`).join(', ');
      toast(`Sold ${r.reference}: ${lots}`);
      await refreshAll();
    } catch (e) { toast(e.message, true); }
  };
}

async function openBatches(p) {
  const batches = await api(`/api/products/${p.id}/batches`);
  const body = batches.length ? batches.map((b) => `
    <div class="batch-row">
      <div>
        <div class="pname" style="font-size:14px">Lot ${b.lot_number}</div>
        <div class="pmeta">${b.quantity} ${p.unit} · ${b.expiration_date ? 'exp ' + b.expiration_date + (b.daysUntilExpiry !== null ? ` (${b.daysUntilExpiry}d)` : '') : 'no expiry'}</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <span class="bstatus ${b.status}">${b.status.replace('_', ' ')}</span>
        ${b.status === 'EXPIRED' && b.quantity > 0 ? `<button class="btn ghost" style="flex:0;padding:6px 10px" data-waste="${b.id}">Write off</button>` : ''}
      </div>
    </div>`).join('') : '<div class="empty">No batches</div>';
  openSheet(`Batches — ${p.name}`, body);
  $('#sheet-body').querySelectorAll('button[data-waste]').forEach((btn) => {
    btn.onclick = async () => {
      try {
        await api('/api/waste', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batchId: Number(btn.dataset.waste), reason: 'Expired — disposed' }),
        });
        closeSheet();
        toast('Expired stock written off');
        await refreshAll();
      } catch (e) { toast(e.message, true); }
    };
  });
}

async function refreshAll() {
  await loadDashboard();
  if ($('#products').classList.contains('active')) await loadProducts();
  if ($('#ledger').classList.contains('active')) await loadLedger();
}

// Initial load
loadDashboard().catch((e) => toast(e.message, true));
activateTab(location.hash.slice(1) || 'dashboard');
