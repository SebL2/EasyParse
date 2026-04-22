async function request(url, options = {}) {
  const response = await fetch(url, options);
  const isJson = response.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await response.json() : null;

  if (!response.ok) {
    throw new Error(payload?.error || 'Request failed.');
  }

  return payload;
}

export function fetchSchemas() {
  return request('/api/schemas');
}

export function fetchDocuments() {
  return request('/api/documents');
}

export function fetchDocument(id) {
  return request(`/api/documents/${id}`);
}

export function updateField(id, value) {
  return request(`/api/fields/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
}

export function deleteDocument(id) {
  return request(`/api/documents/${id}`, {
    method: 'DELETE',
  });
}

export async function uploadDocuments({ files, detailLevel, schemaMode, schemaId }) {
  const formData = new FormData();
  files.forEach(file => formData.append('pdfs', file));
  formData.append('detailLevel', detailLevel);
  formData.append('schemaMode', schemaMode);
  if (schemaMode === 'predefined' && schemaId) {
    formData.append('schemaId', schemaId);
  }

  return request('/api/upload', {
    method: 'POST',
    body: formData,
  });
}

export function exportUrl(ids) {
  return ids?.length ? `/api/export?ids=${ids.join(',')}` : '/api/export';
}
