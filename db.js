const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data.sqlite');

let db = null;

async function getDb() {
  if (db) return db;

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Create tables
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
      FOREIGN KEY (document_id) REFERENCES documents(id)
    )
  `);

  saveDb();
  return db;
}

function saveDb() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

function runQuery(sql, params = []) {
  if (!db) throw new Error('DB not initialized');
  db.run(sql, params);
  saveDb();
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

function insertDocument(filename, docType) {
  if (!db) throw new Error('DB not initialized');
  db.run('INSERT INTO documents (filename, doc_type) VALUES (?, ?)', [filename, docType]);
  saveDb();
  const result = getOne('SELECT last_insert_rowid() as id');
  return result.id;
}

function insertField(documentId, fieldName, fieldValue, confidence, provenance, dataType) {
  db.run(
    'INSERT INTO extracted_fields (document_id, field_name, field_value, confidence, provenance, data_type) VALUES (?, ?, ?, ?, ?, ?)',
    [documentId, fieldName, fieldValue, confidence, provenance, dataType]
  );
  saveDb();
}

function updateField(fieldId, fieldValue) {
  db.run('UPDATE extracted_fields SET field_value = ? WHERE id = ?', [fieldValue, fieldId]);
  saveDb();
}

function getAllDocuments() {
  return getAll('SELECT * FROM documents ORDER BY created_at DESC');
}

function getDocumentById(id) {
  return getOne('SELECT * FROM documents WHERE id = ?', [id]);
}

function getFieldsByDocumentId(documentId) {
  return getAll('SELECT * FROM extracted_fields WHERE document_id = ? ORDER BY id', [documentId]);
}

function deleteDocument(id) {
  db.run('DELETE FROM extracted_fields WHERE document_id = ?', [id]);
  db.run('DELETE FROM documents WHERE id = ?', [id]);
  saveDb();
}

module.exports = {
  getDb,
  runQuery,
  getAll,
  getOne,
  insertDocument,
  insertField,
  updateField,
  getAllDocuments,
  getDocumentById,
  getFieldsByDocumentId,
  deleteDocument,
  saveDb
};
