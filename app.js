// ── State ─────────────────────────────────────────────────────────
let fileQueue = [];
let currentDocId = null;
let modifiedFields = new Set();
let uploadInFlight = false;

// ── DOM Refs ──────────────────────────────────────────────────────
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const fileQueueEl = document.getElementById('fileQueue');
const uploadActions = document.getElementById('uploadActions');
const processBtn = document.getElementById('processBtn');
const clearQueueBtn = document.getElementById('clearQueueBtn');
const queueCount = document.getElementById('queueCount');
const progressBar = document.getElementById('progressBar');
const progressFill = document.getElementById('progressFill');
const statusMsg = document.getElementById('statusMsg');
const docsBody = document.getElementById('docsBody');
const selectAll = document.getElementById('selectAll');
const deleteSelected = document.getElementById('deleteSelected');
const exportSelected = document.getElementById('exportSelected');
const exportAll = document.getElementById('exportAll');
const processingOverlay = document.getElementById('processingOverlay');
const processingMsg = document.getElementById('processingMsg');
const modalOverlay = document.getElementById('modalOverlay');
const modalTitle = document.getElementById('modalTitle');
const modalBadge = document.getElementById('modalBadge');
const modalMeta = document.getElementById('modalMeta');
const fieldsBody = document.getElementById('fieldsBody');
const modalClose = document.getElementById('modalClose');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const exportThis = document.getElementById('exportThis');
const saveIndicator = document.getElementById('saveIndicator');

// ── Drop Zone ─────────────────────────────────────────────────────
function isPdfFile(f) {
  if (f.type === 'application/pdf') return true;
  return /\.pdf$/i.test(f.name || '');
}

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const files = Array.from(e.dataTransfer.files).filter(isPdfFile);
  addToQueue(files);
});
fileInput.addEventListener('change', () => {
  addToQueue(Array.from(fileInput.files).filter(isPdfFile));
  fileInput.value = '';
});

function addToQueue(files) {
  for (const f of files) {
    if (!fileQueue.find(q => q.name === f.name && q.size === f.size)) {
      fileQueue.push(f);
    }
  }
  renderQueue();
}

function renderQueue() {
  console.log("renderQueue");
  fileQueueEl.innerHTML = '';
  for (let i = 0; i < fileQueue.length; i++) {
    const f = fileQueue[i];
    const el = document.createElement('div');
    el.className = 'file-item';
    el.innerHTML = `
      <span class="file-icon">📄</span>
      <span class="file-name">${escHtml(f.name)}</span>
      <span class="file-size">${formatBytes(f.size)}</span>
      <button class="file-remove" data-i="${i}">×</button>
    `;
    fileQueueEl.appendChild(el);
  }
  fileQueueEl.querySelectorAll('.file-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      fileQueue.splice(parseInt(btn.dataset.i), 1);
      renderQueue();
    });
  });
  uploadActions.style.display = fileQueue.length > 0 ? 'flex' : 'none';
  queueCount.textContent = `${fileQueue.length} file${fileQueue.length !== 1 ? 's' : ''} queued`;
}

clearQueueBtn.addEventListener('click', () => {
  fileQueue = [];
  renderQueue();
});

// ── Process ───────────────────────────────────────────────────────
processBtn.addEventListener('click', () => processQueue());

async function processQueue() {
  console.log("processQueue");
  if (uploadInFlight || fileQueue.length === 0) return;

  const formData = new FormData();
  for (const f of fileQueue) formData.append('pdfs', f);

  uploadInFlight = true;
  setProcessing(true, `Processing ${fileQueue.length} document${fileQueue.length !== 1 ? 's' : ''}...`);
  showStatus('', '');
  
  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();
    console.log("data?", data);

    if (data.results && data.results.length > 0) {
      const msg = `✓ Extracted ${data.results.length} document${data.results.length !== 1 ? 's' : ''} successfully`;
      showStatus(msg, 'success');
      fileQueue = [];
      renderQueue();
      await loadDocuments();
    }

    if (data.errors && data.errors.length > 0) {
      const errMsg = data.errors.map(e => `${e.filename}: ${e.error}`).join(' | ');
      showStatus(`⚠ Errors: ${errMsg}`, 'error');
    }
  } catch (err) {
    showStatus(`✗ Upload failed: ${err.message}`, 'error');
  } finally {
    uploadInFlight = false;
    setProcessing(false);
  }
}

function setProcessing(on, msg = '') {
  processingOverlay.classList.toggle('open', on);
  if (msg) processingMsg.textContent = msg;
  processBtn.disabled = on;
  clearQueueBtn.disabled = on;
  fileInput.disabled = on;
  dropZone.classList.toggle('drop-zone-busy', on);
  fileQueueEl.style.pointerEvents = on ? 'none' : '';
}

function showStatus(msg, type) {
  statusMsg.innerHTML = msg ? `<div class="status-msg ${type}">${msg}</div>` : '';
}

// ── Load Documents ────────────────────────────────────────────────
async function loadDocuments() {
  try {
    const res = await fetch('/api/documents');
    const docs = await res.json();
    renderDocuments(docs);
  } catch (err) {
    console.error('Failed to load documents:', err);
  }
}

function renderDocuments(docs) {
  if (!docs || docs.length === 0) {
    docsBody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><p>No documents parsed yet. Upload PDFs above to get started.</p></div></td></tr>`;
    updateSelectionUI();
    return;
  }

  docsBody.innerHTML = docs.map(doc => {
    const date = new Date(doc.created_at).toLocaleString();
    return `
      <tr data-id="${doc.id}">
        <td><input type="checkbox" class="row-check doc-check" value="${doc.id}" /></td>
        <td>
          <span style="font-family:var(--mono);font-size:12px">${escHtml(doc.filename)}</span>
        </td>
        <td><span class="doc-type-badge">${escHtml(doc.doc_type || 'Unknown')}</span></td>
        <td>
          <span style="font-family:var(--mono);font-size:12px;color:var(--accent)">${doc.field_count || '—'}</span>
          <span style="font-family:var(--mono);font-size:11px;color:var(--text-muted)"> fields</span>
        </td>
        <td><span class="doc-date">${date}</span></td>
        <td>
          <button class="btn" style="padding:4px 10px;font-size:11px" onclick="openDoc(${doc.id})">View / Edit →</button>
        </td>
      </tr>
    `;
  }).join('');

  docsBody.querySelectorAll('.doc-check').forEach(cb => {
    cb.addEventListener('change', updateSelectionUI);
  });

  updateSelectionUI();
}

function updateSelectionUI() {
  const checks = Array.from(docsBody.querySelectorAll('.doc-check'));
  const selected = checks.filter(c => c.checked);
  const hasSelected = selected.length > 0;
  deleteSelected.style.display = hasSelected ? 'flex' : 'none';
  exportSelected.disabled = !hasSelected;
  exportAll.disabled = checks.length === 0;
}

selectAll.addEventListener('change', () => {
  docsBody.querySelectorAll('.doc-check').forEach(c => c.checked = selectAll.checked);
  updateSelectionUI();
});

// ── Delete ────────────────────────────────────────────────────────
deleteSelected.addEventListener('click', async () => {
  const ids = getSelectedIds();
  if (!ids.length) return;
  if (!confirm(`Delete ${ids.length} document${ids.length !== 1 ? 's' : ''} and all extracted data?`)) return;

  for (const id of ids) {
    await fetch(`/api/documents/${id}`, { method: 'DELETE' });
  }
  await loadDocuments();
});

function getSelectedIds() {
  return Array.from(docsBody.querySelectorAll('.doc-check:checked')).map(c => c.value);
}

// ── Export ────────────────────────────────────────────────────────
exportAll.addEventListener('click', () => exportDocs(null));
exportSelected.addEventListener('click', () => exportDocs(getSelectedIds()));
exportThis.addEventListener('click', () => currentDocId && exportDocs([currentDocId]));

function exportDocs(ids) {
  const url = ids ? `/api/export?ids=${ids.join(',')}` : '/api/export';
  window.location.href = url;
}

// ── Modal ─────────────────────────────────────────────────────────
async function openDoc(id) {
  currentDocId = id;
  modifiedFields.clear();

  try {
    const res = await fetch(`/api/documents/${id}`);
    const doc = await res.json();
    renderModal(doc);
    modalOverlay.classList.add('open');
  } catch (err) {
    alert('Failed to load document: ' + err.message);
  }
}

function renderModal(doc) {
  modalTitle.innerHTML = `${escHtml(doc.filename)} <span>${doc.fields ? doc.fields.length + ' fields' : ''}</span>`;
  modalBadge.textContent = '';

  modalMeta.innerHTML = `
    <div class="meta-item"><div class="meta-key">Document Type</div><div class="meta-val"><span class="doc-type-badge">${escHtml(doc.doc_type || 'Unknown')}</span></div></div>
    <div class="meta-item"><div class="meta-key">Parsed At</div><div class="meta-val doc-date">${new Date(doc.created_at).toLocaleString()}</div></div>
    <div class="meta-item"><div class="meta-key">Fields</div><div class="meta-val" style="color:var(--accent);font-family:var(--mono)">${doc.fields ? doc.fields.length : 0}</div></div>
  `;

  if (!doc.fields || doc.fields.length === 0) {
    fieldsBody.innerHTML = `<tr><td colspan="5" style="padding:32px;text-align:center;color:var(--text-muted);font-family:var(--mono);font-size:12px">No fields extracted</td></tr>`;
    return;
  }

  fieldsBody.innerHTML = doc.fields.map(f => {
    const conf = f.confidence || 0;
    const confColor = conf >= 0.8 ? 'var(--accent)' : conf >= 0.5 ? '#f5c842' : 'var(--warn)';
    return `
      <tr class="field-row" data-field-id="${f.id}">
        <td class="field-name-cell">${escHtml(f.field_name)}</td>
        <td class="field-value-cell">
          <textarea class="field-value-edit" rows="1" data-field-id="${f.id}" data-original="${escHtml(f.field_value || '')}">${escHtml(f.field_value || '')}</textarea>
        </td>
        <td><span class="type-chip">${escHtml(f.data_type || 'text')}</span></td>
        <td>
          <div class="confidence-bar-wrap">
            <div class="conf-bar"><div class="conf-fill" style="width:${conf * 100}%;background:${confColor}"></div></div>
            <span class="conf-label">${Math.round(conf * 100)}%</span>
          </div>
        </td>
        <td class="provenance-cell"><span class="provenance-text" title="${escHtml(f.provenance || '')}">${escHtml(f.provenance || '—')}</span></td>
      </tr>
    `;
  }).join('');

  // Auto-resize textareas
  fieldsBody.querySelectorAll('.field-value-edit').forEach(ta => {
    autoResize(ta);
    ta.addEventListener('input', () => {
      autoResize(ta);
      const original = ta.dataset.original;
      if (ta.value !== original) {
        ta.classList.add('modified');
        modifiedFields.add(ta.dataset.fieldId);
        debouncedSave(ta);
      } else {
        ta.classList.remove('modified');
        modifiedFields.delete(ta.dataset.fieldId);
      }
    });
  });

  saveIndicator.classList.remove('show');
}

function autoResize(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.max(32, ta.scrollHeight) + 'px';
}

// Debounced auto-save
const saveTimers = {};
function debouncedSave(ta) {
  const id = ta.dataset.fieldId;
  clearTimeout(saveTimers[id]);
  saveTimers[id] = setTimeout(async () => {
    try {
      await fetch(`/api/fields/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: ta.value })
      });
      ta.dataset.original = ta.value;
      ta.classList.remove('modified');
      modifiedFields.delete(id);
      saveIndicator.classList.add('show');
      setTimeout(() => saveIndicator.classList.remove('show'), 2000);
    } catch (err) {
      console.error('Save failed:', err);
    }
  }, 600);
}

modalClose.addEventListener('click', closeModal);
modalCloseBtn.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });

function closeModal() {
  modalOverlay.classList.remove('open');
  currentDocId = null;
  loadDocuments(); // refresh field counts
}

// ── Utils ─────────────────────────────────────────────────────────
function escHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / (1024 * 1024)).toFixed(1) + ' MB';
}

// ── Init ──────────────────────────────────────────────────────────
loadDocuments();
