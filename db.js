const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data.sqlite');

let db = null;

async function getDb() {
  if (db) return db;

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON');

  db.run(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      doc_type TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS extracted_fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      field_name TEXT NOT NULL,
      field_value TEXT,
      confidence REAL,
      provenance TEXT,
      data_type TEXT,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    )
  `);

  ensureColumns('documents', {
    detail_level: 'TEXT',
    summary_text: 'TEXT',
    spec_json: 'TEXT',
    output_json: 'TEXT',
    validation_json: 'TEXT',
    source_excerpt: 'TEXT',
    source_truncated: 'INTEGER DEFAULT 0',
    processing_version: 'TEXT',
  });

  ensureColumns('extracted_fields', {
    field_path: 'TEXT',
    field_label: 'TEXT',
    section_label: 'TEXT',
    entry_label: 'TEXT',
    order_index: 'INTEGER DEFAULT 0',
  });

  db.run('CREATE INDEX IF NOT EXISTS idx_extracted_fields_document_id ON extracted_fields(document_id)');
  db.run('UPDATE extracted_fields SET field_label = field_name WHERE field_label IS NULL OR field_label = ""');
  db.run('UPDATE extracted_fields SET field_path = "legacy." || id WHERE field_path IS NULL OR field_path = ""');
  db.run('UPDATE extracted_fields SET section_label = "Legacy Import" WHERE section_label IS NULL');
  db.run('UPDATE extracted_fields SET entry_label = "" WHERE entry_label IS NULL');
  db.run('UPDATE extracted_fields SET order_index = id WHERE order_index IS NULL');

  saveDb();
  return db;
}

function saveDb() {
  if (!db) return;
  const buffer = Buffer.from(db.export());
  fs.writeFileSync(DB_PATH, buffer);
}

function getAll(sql, params = []) {
  if (!db) throw new Error('DB not initialized');
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function getOne(sql, params = []) {
  const rows = getAll(sql, params);
  return rows[0] || null;
}

function ensureColumns(tableName, columnDefinitions) {
  const existingColumns = new Set(
    getAll(`PRAGMA table_info(${tableName})`).map(row => String(row.name))
  );

  for (const [columnName, definition] of Object.entries(columnDefinitions)) {
    if (!existingColumns.has(columnName)) {
      db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
  }
}

function insertDocument({
  filename,
  docType,
  detailLevel,
  summaryText,
  specJson,
  outputJson,
  validationJson,
  sourceExcerpt,
  sourceTruncated,
  processingVersion,
}) {
  if (!db) throw new Error('DB not initialized');

  db.run(
    `INSERT INTO documents (
      filename,
      doc_type,
      detail_level,
      summary_text,
      spec_json,
      output_json,
      validation_json,
      source_excerpt,
      source_truncated,
      processing_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      filename,
      docType || null,
      detailLevel || 'standard',
      summaryText || null,
      specJson || null,
      outputJson || null,
      validationJson || null,
      sourceExcerpt || null,
      sourceTruncated ? 1 : 0,
      processingVersion || null,
    ]
  );

  const result = getOne('SELECT last_insert_rowid() AS id');
  const id = result && result.id != null ? result.id : null;
  if (id == null || id === 0) {
    throw new Error('insertDocument: failed to read new document id');
  }

  saveDb();
  return id;
}

function replaceDocumentFields(documentId, fields) {
  if (!db) throw new Error('DB not initialized');

  db.run('DELETE FROM extracted_fields WHERE document_id = ?', [documentId]);

  for (const field of fields) {
    db.run(
      `INSERT INTO extracted_fields (
        document_id,
        field_name,
        field_label,
        field_path,
        field_value,
        confidence,
        provenance,
        data_type,
        section_label,
        entry_label,
        order_index
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        documentId,
        field.field_name,
        field.field_label || field.field_name,
        field.field_path || null,
        field.field_value != null ? String(field.field_value) : null,
        field.confidence != null ? Number(field.confidence) : 0,
        field.provenance || '',
        field.data_type || 'text',
        field.section_label || '',
        field.entry_label || '',
        field.order_index != null ? Number(field.order_index) : 0,
      ]
    );
  }

  saveDb();
}

function updateDocument(id, patch) {
  if (!db) throw new Error('DB not initialized');

  const assignments = [];
  const params = [];

  const mapping = {
    docType: 'doc_type',
    detailLevel: 'detail_level',
    summaryText: 'summary_text',
    specJson: 'spec_json',
    outputJson: 'output_json',
    validationJson: 'validation_json',
    sourceExcerpt: 'source_excerpt',
    sourceTruncated: 'source_truncated',
    processingVersion: 'processing_version',
  };

  for (const [key, column] of Object.entries(mapping)) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      assignments.push(`${column} = ?`);
      if (key === 'sourceTruncated') {
        params.push(patch[key] ? 1 : 0);
      } else {
        params.push(patch[key]);
      }
    }
  }

  if (assignments.length === 0) return;

  params.push(id);
  db.run(`UPDATE documents SET ${assignments.join(', ')} WHERE id = ?`, params);
  saveDb();
}

function updateField(fieldId, fieldValue) {
  if (!db) throw new Error('DB not initialized');
  db.run('UPDATE extracted_fields SET field_value = ? WHERE id = ?', [fieldValue, fieldId]);
  saveDb();
}

function getFieldById(fieldId) {
  return getOne('SELECT * FROM extracted_fields WHERE id = ?', [fieldId]);
}

function getAllDocuments() {
  return getAll('SELECT * FROM documents ORDER BY created_at DESC, id DESC');
}

function getDocumentById(id) {
  return getOne('SELECT * FROM documents WHERE id = ?', [id]);
}

function getFieldsByDocumentId(documentId) {
  return getAll(
    'SELECT * FROM extracted_fields WHERE document_id = ? ORDER BY order_index ASC, id ASC',
    [documentId]
  );
}

function deleteDocument(id) {
  if (!db) throw new Error('DB not initialized');
  db.run('DELETE FROM extracted_fields WHERE document_id = ?', [id]);
  db.run('DELETE FROM documents WHERE id = ?', [id]);
  saveDb();
}

module.exports = {
  deleteDocument,
  getAll,
  getAllDocuments,
  getDb,
  getDocumentById,
  getFieldById,
  getFieldsByDocumentId,
  getOne,
  insertDocument,
  replaceDocumentFields,
  saveDb,
  updateDocument,
  updateField,
};
