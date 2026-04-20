const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const BUNDLED_DB_PATH = path.join(__dirname, 'data.sqlite');

// On serverless platforms like Vercel, only /tmp is writable. Keep the SQLite
// file there so saves don't crash. Note that /tmp is ephemeral: data resets on
// cold starts. For durable storage, swap this for an external database.
const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const DB_PATH = IS_SERVERLESS
  ? path.join('/tmp', 'data.sqlite')
  : BUNDLED_DB_PATH;

let db = null;

async function getDb() {
  if (db) return db;

  // Load the sql.js wasm file as a buffer so bundlers (e.g. Vercel's ncc)
  // are guaranteed to trace and include it in the deployment package.
  const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
  const wasmBinary = fs.readFileSync(wasmPath);

  const SQL = await initSqlJs({ wasmBinary });

  let seedBuffer = null;
  if (fs.existsSync(DB_PATH)) {
    seedBuffer = fs.readFileSync(DB_PATH);
  } else if (IS_SERVERLESS && fs.existsSync(BUNDLED_DB_PATH)) {
    try {
      seedBuffer = fs.readFileSync(BUNDLED_DB_PATH);
    } catch (_) {
      seedBuffer = null;
    }
  }

  db = seedBuffer ? new SQL.Database(seedBuffer) : new SQL.Database();

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
    schema_mode: 'TEXT',
    schema_id: 'TEXT',
    schema_label: 'TEXT',
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
  try {
    const buffer = Buffer.from(db.export());
    fs.writeFileSync(DB_PATH, buffer);
  } catch (error) {
    // On read-only filesystems (e.g. Vercel outside /tmp) swallow the write
    // error so requests still succeed against the in-memory copy.
    console.warn('saveDb: could not persist database:', error.message);
  }
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
  schemaMode,
  schemaId,
  schemaLabel,
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
      schema_mode,
      schema_id,
      schema_label,
      summary_text,
      spec_json,
      output_json,
      validation_json,
      source_excerpt,
      source_truncated,
      processing_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      filename,
      docType || null,
      detailLevel || 'standard',
      schemaMode || 'discover',
      schemaId || null,
      schemaLabel || null,
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
    schemaMode: 'schema_mode',
    schemaId: 'schema_id',
    schemaLabel: 'schema_label',
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
