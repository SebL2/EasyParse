require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pdfParse = require('pdf-parse');
const ExcelJS = require('exceljs');
const db = require('./db');
const {
  PROCESSING_VERSION,
  applyFieldEdit,
  normalizeDetailLevel,
  processPdf,
  validateExtraction,
} = require('./gemini');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  dest: UPLOAD_DIR,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed.'));
  },
  limits: { fileSize: 20 * 1024 * 1024 },
});

db.getDb()
  .then(() => console.log('Database initialized'))
  .catch(err => console.error('DB init error:', err));

function safeJsonParse(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function summarizeDocument(doc) {
  const validation = safeJsonParse(doc.validation_json, null);
  return {
    ...doc,
    source_truncated: Boolean(doc.source_truncated),
    issue_count: validation && Array.isArray(validation.issues) ? validation.issues.length : 0,
    ready_for_review: validation ? Boolean(validation.ready_for_review) : true,
  };
}

function expandDocument(doc) {
  const summary = summarizeDocument(doc);
  return {
    ...summary,
    spec: safeJsonParse(doc.spec_json, null),
    structured_output: safeJsonParse(doc.output_json, null),
    validation: safeJsonParse(doc.validation_json, null),
  };
}

function buildUniqueSheetName(baseName, usedNames) {
  const trimmedBase = baseName.slice(0, 31) || 'Document';
  let candidate = trimmedBase;
  let counter = 2;

  while (usedNames.has(candidate)) {
    const suffix = `_${counter}`;
    candidate = `${trimmedBase.slice(0, 31 - suffix.length)}${suffix}`;
    counter += 1;
  }

  usedNames.add(candidate);
  return candidate;
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/upload', upload.array('pdfs', 20), async (req, res) => {
  await db.getDb();

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded.' });
  }

  const detailLevel = normalizeDetailLevel(req.body.detailLevel);
  const results = [];
  const errors = [];

  for (const file of req.files) {
    try {
      const pdfBuffer = fs.readFileSync(file.path);
      const pdfData = await pdfParse(pdfBuffer);
      const pdfText = String(pdfData.text || '').trim();

      if (!pdfText || pdfText.length < 10) {
        errors.push({
          filename: file.originalname,
          error: 'Could not extract text. Image-only PDFs still need OCR support.',
        });
        continue;
      }

      const processed = await processPdf({
        filename: file.originalname,
        pdfText,
        detailLevel,
      });

      const docId = db.insertDocument({
        filename: file.originalname,
        docType: processed.documentType,
        detailLevel: processed.detailLevel,
        summaryText: processed.output.summary,
        specJson: JSON.stringify(processed.spec),
        outputJson: JSON.stringify(processed.output),
        validationJson: JSON.stringify(processed.validation),
        sourceExcerpt: processed.sourceExcerpt,
        sourceTruncated: processed.sourceTruncated,
        processingVersion: processed.processingVersion || PROCESSING_VERSION,
      });

      db.replaceDocumentFields(docId, processed.flatFields);

      results.push({
        id: docId,
        filename: file.originalname,
        doc_type: processed.documentType,
        detail_level: processed.detailLevel,
        field_count: processed.flatFields.length,
        issue_count: processed.validation.issues.length,
        ready_for_review: processed.validation.ready_for_review,
        summary_text: processed.output.summary,
      });
    } catch (error) {
      console.error(`Error processing ${file.originalname}:`, error.message);
      errors.push({
        filename: file.originalname,
        error: error.message,
      });
    } finally {
      try {
        fs.unlinkSync(file.path);
      } catch (_) {
        // Ignore upload cleanup errors.
      }
    }
  }

  res.json({ results, errors });
});

app.get('/api/documents', async (req, res) => {
  await db.getDb();

  try {
    const docs = db.getAllDocuments();
    const decorated = docs.map(doc => {
      const summary = summarizeDocument(doc);
      const fields = db.getFieldsByDocumentId(doc.id);
      return {
        ...summary,
        field_count: fields.length,
      };
    });
    res.json(decorated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/documents/:id', async (req, res) => {
  await db.getDb();

  try {
    const doc = db.getDocumentById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found.' });

    const fields = db.getFieldsByDocumentId(req.params.id);
    res.json({ ...expandDocument(doc), fields });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/fields/:id', async (req, res) => {
  await db.getDb();

  try {
    const nextValue = req.body.value == null ? null : String(req.body.value);
    const field = db.getFieldById(req.params.id);
    if (!field) return res.status(404).json({ error: 'Field not found.' });

    db.updateField(req.params.id, nextValue);

    const doc = db.getDocumentById(field.document_id);
    if (!doc) return res.json({ success: true });

    const spec = safeJsonParse(doc.spec_json, null);
    const output = safeJsonParse(doc.output_json, null);

    if (spec && output && field.field_path) {
      const updatedOutput = applyFieldEdit(output, field.field_path, nextValue);
      if (updatedOutput) {
        const validation = validateExtraction(spec, updatedOutput, {
          sourceTruncated: Boolean(doc.source_truncated),
        });

        db.updateDocument(doc.id, {
          outputJson: JSON.stringify(updatedOutput),
          validationJson: JSON.stringify(validation),
          summaryText: updatedOutput.summary,
        });
      }
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/documents/:id', async (req, res) => {
  await db.getDb();

  try {
    db.deleteDocument(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/export', async (req, res) => {
  await db.getDb();

  try {
    const ids = req.query.ids ? String(req.query.ids).split(',') : null;
    const allDocs = db.getAllDocuments();
    const docsToExport = ids
      ? allDocs.filter(doc => ids.includes(String(doc.id)))
      : allDocs;

    if (docsToExport.length === 0) {
      return res.status(400).json({ error: 'No documents to export.' });
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'EasyParse';
    workbook.created = new Date();

    const usedSheetNames = new Set();

    for (const doc of docsToExport) {
      const summary = summarizeDocument(doc);
      const fields = db.getFieldsByDocumentId(doc.id);
      const sheetName = buildUniqueSheetName(
        doc.filename.replace(/\.pdf$/i, ''),
        usedSheetNames
      );
      const sheet = workbook.addWorksheet(sheetName);

      const metaRows = [
        ['Document', doc.filename],
        ['Type', doc.doc_type || 'Unknown'],
        ['Detail Level', doc.detail_level || 'standard'],
        ['Parsed At', doc.created_at],
        ['Validation Issues', summary.issue_count],
        ['Summary', doc.summary_text || ''],
        [],
      ];

      metaRows.forEach(row => sheet.addRow(row));

      [1, 2, 3, 4, 5, 6].forEach(rowIndex => {
        const cell = sheet.getRow(rowIndex).getCell(1);
        cell.font = { bold: true, color: { argb: 'FF777777' }, size: 10 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A1F' } };
      });

      const headerRow = sheet.addRow([
        'Path',
        'Field',
        'Section',
        'Entry',
        'Value',
        'Data Type',
        'Confidence',
        'Evidence',
      ]);

      headerRow.eachCell(cell => {
        cell.font = { bold: true, color: { argb: 'FF000000' }, size: 11 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00E5A0' } };
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
        cell.border = {
          bottom: { style: 'medium', color: { argb: 'FF009966' } },
        };
      });

      fields.forEach((field, index) => {
        const confidence = Number(field.confidence || 0);
        const row = sheet.addRow([
          field.field_path || '',
          field.field_label || field.field_name || '',
          field.section_label || '',
          field.entry_label || '',
          field.field_value ?? '',
          field.data_type || 'text',
          `${Math.round(confidence * 100)}%`,
          field.provenance || '',
        ]);

        const background = index % 2 === 0 ? 'FFFAFAFA' : 'FFF3F3F3';
        row.eachCell((cell, colNum) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: background } };
          cell.alignment = { vertical: 'top', wrapText: colNum === 1 || colNum === 5 || colNum === 8 };
          cell.border = {
            bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
          };
        });

        const confidenceCell = row.getCell(7);
        if (confidence >= 0.8) {
          confidenceCell.font = { color: { argb: 'FF007755' }, bold: true };
        } else if (confidence >= 0.55) {
          confidenceCell.font = { color: { argb: 'FF996600' }, bold: true };
        } else {
          confidenceCell.font = { color: { argb: 'FFCC3300' }, bold: true };
        }
      });

      sheet.columns = [
        { width: 30 },
        { width: 28 },
        { width: 22 },
        { width: 28 },
        { width: 40 },
        { width: 14 },
        { width: 12 },
        { width: 50 },
      ];

      sheet.views = [{ state: 'frozen', ySplit: 8 }];
    }

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', 'attachment; filename="easyparse_export.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.use((error, req, res, next) => {
  if (!error) return next();
  console.error('Request error:', error.message);
  res.status(400).json({ error: error.message });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\nEasyParse running at http://localhost:${PORT}\n`);
    console.log('Set GEMINI_API_KEY in your .env file before uploading PDFs.\n');
  });
}

module.exports = app;
