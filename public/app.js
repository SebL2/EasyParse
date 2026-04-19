let fileQueue = [];
let currentDocId = null;
let currentDoc = null;
let modifiedFields = new Set();
let uploadInFlight = false;

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const fileQueueEl = document.getElementById('fileQueue');
const uploadActions = document.getElementById('uploadActions');
const processBtn = document.getElementById('processBtn');
const clearQueueBtn = document.getElementById('clearQueueBtn');
const detailLevel = document.getElementById('detailLevel');
const queueCount = document.getElementById('queueCount');
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
const modalMeta = document.getElementById('modalMeta');
const summaryPanel = document.getElementById('summaryPanel');
const validationStats = document.getElementById('validationStats');
const validationIssues = document.getElementById('validationIssues');
const specPreview = document.getElementById('specPreview');
const structuredPreview = document.getElementById('structuredPreview');
const fieldsBody = document.getElementById('fieldsBody');
const modalClose = document.getElementById('modalClose');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const exportThis = document.getElementById('exportThis');
const saveIndicator = document.getElementById('saveIndicator');

function isPdfFile(file) {
  if (file.type === 'application/pdf') return true;
  return /\.pdf$/i.test(file.name || '');
}

dropZone.addEventListener('dragover', event => {
  event.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', event => {
  event.preventDefault();
  dropZone.classList.remove('drag-over');
  const files = Array.from(event.dataTransfer.files).filter(isPdfFile);
  addToQueue(files);
});

fileInput.addEventListener('change', () => {
  addToQueue(Array.from(fileInput.files).filter(isPdfFile));
  fileInput.value = '';
});

function addToQueue(files) {
  for (const file of files) {
    if (!fileQueue.find(existing => existing.name === file.name && existing.size === file.size)) {
      fileQueue.push(file);
    }
  }
  renderQueue();
}

function renderQueue() {
  fileQueueEl.innerHTML = '';

  for (let index = 0; index < fileQueue.length; index += 1) {
    const file = fileQueue[index];
    const item = document.createElement('div');
    item.className = 'file-item';
    item.innerHTML = `
      <span>📄</span>
      <span class="file-name">${escHtml(file.name)}</span>
      <span class="file-size">${formatBytes(file.size)}</span>
      <button class="file-remove" data-index="${index}">×</button>
    `;
    fileQueueEl.appendChild(item);
  }

  fileQueueEl.querySelectorAll('.file-remove').forEach(button => {
    button.addEventListener('click', () => {
      fileQueue.splice(Number(button.dataset.index), 1);
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

processBtn.addEventListener('click', () => processQueue());

async function processQueue() {
  if (uploadInFlight || fileQueue.length === 0) return;

  const formData = new FormData();
  for (const file of fileQueue) formData.append('pdfs', file);
  formData.append('detailLevel', detailLevel.value);

  uploadInFlight = true;
  setProcessing(true, `Processing ${fileQueue.length} document${fileQueue.length !== 1 ? 's' : ''} at ${detailLevel.value} detail...`);
  showStatus('', '');

  try {
    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Upload failed.');
    }

    if (data.results && data.results.length > 0) {
      const totalIssues = data.results.reduce((sum, result) => sum + Number(result.issue_count || 0), 0);
      showStatus(
        `Processed ${data.results.length} document${data.results.length !== 1 ? 's' : ''}. Review flagged ${totalIssues} validation issue${totalIssues !== 1 ? 's' : ''}.`,
        'success'
      );
      fileQueue = [];
      renderQueue();
      await loadDocuments();
    }

    if (data.errors && data.errors.length > 0) {
      const message = data.errors.map(entry => `${entry.filename}: ${entry.error}`).join(' | ');
      showStatus(message, 'error');
    }
  } catch (error) {
    showStatus(`Upload failed: ${error.message}`, 'error');
  } finally {
    uploadInFlight = false;
    setProcessing(false);
  }
}

function setProcessing(enabled, message = '') {
  processingOverlay.classList.toggle('open', enabled);
  if (message) processingMsg.textContent = message;
  processBtn.disabled = enabled;
  clearQueueBtn.disabled = enabled;
  detailLevel.disabled = enabled;
  fileInput.disabled = enabled;
  dropZone.classList.toggle('drop-zone-busy', enabled);
  fileQueueEl.style.pointerEvents = enabled ? 'none' : '';
}

function showStatus(message, type) {
  statusMsg.innerHTML = message ? `<div class="status-msg ${type}">${escHtml(message)}</div>` : '';
}

async function loadDocuments() {
  try {
    const response = await fetch('/api/documents');
    const docs = await response.json();
    renderDocuments(docs);
  } catch (error) {
    console.error('Failed to load documents:', error);
  }
}

function renderDocuments(docs) {
  if (!docs || docs.length === 0) {
    docsBody.innerHTML = `
      <tr>
        <td colspan="8">
          <div class="empty-state">No documents parsed yet. Upload PDFs above to get started.</div>
        </td>
      </tr>
    `;
    updateSelectionUI();
    return;
  }

  docsBody.innerHTML = docs.map(doc => {
    const issueCount = Number(doc.issue_count || 0);
    const issuesBadge = issueCount > 0
      ? `<span class="badge badge-warn">${issueCount} issue${issueCount !== 1 ? 's' : ''}</span>`
      : '<span class="badge badge-green">Clean</span>';

    return `
      <tr>
        <td><input type="checkbox" class="row-check doc-check" value="${doc.id}" /></td>
        <td>
          <div class="doc-primary">
            <span class="doc-filename">${escHtml(doc.filename)}</span>
            <span class="doc-summary">${escHtml(doc.summary_text || 'No AI summary available.')}</span>
          </div>
        </td>
        <td><span class="badge badge-blue">${escHtml(doc.doc_type || 'Unknown')}</span></td>
        <td><span class="badge badge-muted">${escHtml((doc.detail_level || 'standard').toUpperCase())}</span></td>
        <td>
          <span class="metric">${Number(doc.field_count || 0)}</span>
          <span class="metric-muted">fields</span>
        </td>
        <td>${issuesBadge}</td>
        <td><span class="doc-date">${new Date(doc.created_at).toLocaleString()}</span></td>
        <td><button class="btn" data-open-id="${doc.id}" style="padding:4px 10px;font-size:11px">View / Edit →</button></td>
      </tr>
    `;
  }).join('');

  docsBody.querySelectorAll('.doc-check').forEach(checkbox => {
    checkbox.addEventListener('change', updateSelectionUI);
  });

  docsBody.querySelectorAll('[data-open-id]').forEach(button => {
    button.addEventListener('click', () => openDoc(button.dataset.openId));
  });

  updateSelectionUI();
}

function updateSelectionUI() {
  const checks = Array.from(docsBody.querySelectorAll('.doc-check'));
  const selected = checks.filter(checkbox => checkbox.checked);
  selectAll.checked = checks.length > 0 && selected.length === checks.length;
  deleteSelected.style.display = selected.length > 0 ? 'flex' : 'none';
  exportSelected.disabled = selected.length === 0;
  exportAll.disabled = checks.length === 0;
}

selectAll.addEventListener('change', () => {
  docsBody.querySelectorAll('.doc-check').forEach(checkbox => {
    checkbox.checked = selectAll.checked;
  });
  updateSelectionUI();
});

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
  return Array.from(docsBody.querySelectorAll('.doc-check:checked')).map(checkbox => checkbox.value);
}

exportAll.addEventListener('click', () => exportDocs(null));
exportSelected.addEventListener('click', () => exportDocs(getSelectedIds()));
exportThis.addEventListener('click', () => {
  if (currentDocId) exportDocs([currentDocId]);
});

function exportDocs(ids) {
  const url = ids ? `/api/export?ids=${ids.join(',')}` : '/api/export';
  window.location.href = url;
}

async function openDoc(id) {
  currentDocId = id;
  modifiedFields.clear();

  try {
    const response = await fetch(`/api/documents/${id}`);
    const doc = await response.json();
    if (!response.ok) throw new Error(doc.error || 'Failed to load document.');
    currentDoc = doc;
    renderModal(doc);
    modalOverlay.classList.add('open');
  } catch (error) {
    alert(`Failed to load document: ${error.message}`);
  }
}

function renderModal(doc) {
  const issueCount = doc.validation && Array.isArray(doc.validation.issues) ? doc.validation.issues.length : 0;
  modalTitle.innerHTML = `${escHtml(doc.filename)} <span>${doc.fields ? doc.fields.length : 0} fields</span>`;

  modalMeta.innerHTML = `
    <div class="meta-item"><div class="meta-key">Document Type</div><div class="meta-val">${badgeHtml(doc.doc_type || 'Unknown', 'blue')}</div></div>
    <div class="meta-item"><div class="meta-key">Detail Level</div><div class="meta-val">${badgeHtml((doc.detail_level || 'standard').toUpperCase(), 'muted')}</div></div>
    <div class="meta-item"><div class="meta-key">Validation</div><div class="meta-val">${issueCount > 0 ? badgeHtml(`${issueCount} issue${issueCount !== 1 ? 's' : ''}`, 'warn') : badgeHtml('Ready', 'green')}</div></div>
    <div class="meta-item"><div class="meta-key">Parsed At</div><div class="meta-val">${new Date(doc.created_at).toLocaleString()}</div></div>
  `;

  summaryPanel.textContent = doc.summary_text || (doc.structured_output && doc.structured_output.summary) || 'No summary available.';
  renderValidationStats(doc.validation);
  renderValidationIssues(doc.validation);
  specPreview.textContent = prettyJson(doc.spec);
  structuredPreview.textContent = prettyJson(doc.structured_output);
  renderFields(doc.fields || []);
  saveIndicator.classList.remove('show');
}

function renderValidationStats(validation) {
  const completeness = validation && validation.completeness ? validation.completeness : {};
  const confidence = validation && validation.confidence ? validation.confidence : {};

  validationStats.innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${Number(completeness.total_fields || 0)}</div>
      <div class="stat-name">Total Fields</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${Number(completeness.populated_fields || 0)}</div>
      <div class="stat-name">Populated</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${Math.round(Number(confidence.average || 0) * 100)}%</div>
      <div class="stat-name">Avg Confidence</div>
    </div>
  `;
}

function renderValidationIssues(validation) {
  const issues = validation && Array.isArray(validation.issues) ? validation.issues : [];
  if (issues.length === 0) {
    validationIssues.innerHTML = '<div class="panel"><div class="panel-copy">No validation issues were flagged. This extraction still benefits from human review, but it passed the current deterministic checks.</div></div>';
    return;
  }

  validationIssues.innerHTML = issues.slice(0, 8).map(issue => `
    <div class="issue-row ${issue.severity === 'warning' ? 'warn' : ''}">
      <div class="issue-title">${escHtml(issue.label || issue.path || 'Issue')} · ${escHtml((issue.severity || 'info').toUpperCase())}</div>
      <div class="issue-body">${escHtml(issue.message || '')}${issue.path ? ` (${escHtml(issue.path)})` : ''}</div>
    </div>
  `).join('');
}

function renderFields(fields) {
  if (!fields || fields.length === 0) {
    fieldsBody.innerHTML = `
      <tr>
        <td colspan="6" style="padding:28px;text-align:center;color:var(--text-muted);font-family:var(--mono);font-size:12px">
          No flattened fields were stored for this document.
        </td>
      </tr>
    `;
    return;
  }

  fieldsBody.innerHTML = fields.map(field => {
    const confidence = Number(field.confidence || 0);
    const confidenceColor = getConfidenceColor(confidence);
    const scopeBits = [field.section_label, field.entry_label].filter(Boolean);
    return `
      <tr data-field-id="${field.id}">
        <td>
          <div class="field-main">
            <span class="field-label">${escHtml(field.field_label || field.field_name || 'Field')}</span>
            <span class="field-path">${escHtml(field.field_path || '')}</span>
          </div>
        </td>
        <td><div class="scope-text">${escHtml(scopeBits.join(' · ') || 'Document')}</div></td>
        <td>
          <textarea
            class="field-value-edit"
            rows="1"
            data-field-id="${field.id}"
          >${escHtml(field.field_value ?? '')}</textarea>
        </td>
        <td><span class="badge badge-muted">${escHtml(field.data_type || 'text')}</span></td>
        <td>
          <div class="confidence-bar-wrap">
            <div class="conf-bar"><div class="conf-fill" style="width:${confidence * 100}%;background:${confidenceColor}"></div></div>
            <span class="conf-label">${Math.round(confidence * 100)}%</span>
          </div>
        </td>
        <td><span class="provenance-text" title="${escHtml(field.provenance || '')}">${escHtml(field.provenance || '—')}</span></td>
      </tr>
    `;
  }).join('');

  fieldsBody.querySelectorAll('.field-value-edit').forEach(textarea => {
    textarea.dataset.original = textarea.value;
    autoResize(textarea);
    textarea.addEventListener('input', () => {
      autoResize(textarea);
      const original = textarea.dataset.original;
      if (textarea.value !== original) {
        textarea.classList.add('modified');
        modifiedFields.add(textarea.dataset.fieldId);
        debouncedSave(textarea);
      } else {
        textarea.classList.remove('modified');
        modifiedFields.delete(textarea.dataset.fieldId);
      }
    });
  });
}

function autoResize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.max(34, textarea.scrollHeight)}px`;
}

const saveTimers = {};
function debouncedSave(textarea) {
  const id = textarea.dataset.fieldId;
  clearTimeout(saveTimers[id]);

  saveTimers[id] = setTimeout(async () => {
    try {
      const response = await fetch(`/api/fields/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: textarea.value }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Save failed.');

      textarea.dataset.original = textarea.value;
      textarea.classList.remove('modified');
      modifiedFields.delete(id);
      saveIndicator.classList.add('show');
      setTimeout(() => saveIndicator.classList.remove('show'), 1800);
    } catch (error) {
      console.error('Save failed:', error);
    }
  }, 600);
}

modalClose.addEventListener('click', closeModal);
modalCloseBtn.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', event => {
  if (event.target === modalOverlay) closeModal();
});

function closeModal() {
  modalOverlay.classList.remove('open');
  currentDocId = null;
  currentDoc = null;
  loadDocuments();
}

function escHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function prettyJson(value) {
  if (!value) return 'No JSON stored for this document.';
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return 'Unable to render JSON preview.';
  }
}

function getConfidenceColor(confidence) {
  if (confidence >= 0.8) return 'var(--accent)';
  if (confidence >= 0.55) return '#f5c842';
  return 'var(--warn)';
}

function badgeHtml(label, tone) {
  const toneClass = tone === 'green'
    ? 'badge-green'
    : tone === 'warn'
      ? 'badge-warn'
      : tone === 'blue'
        ? 'badge-blue'
        : 'badge-muted';
  return `<span class="badge ${toneClass}">${escHtml(label)}</span>`;
}

loadDocuments();
