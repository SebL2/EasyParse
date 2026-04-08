require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pdfParse = require('pdf-parse');
const ExcelJS = require('exceljs');
const db = require('./db');
const { extractFromPdf } = require('./gemini');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Multer setup
const upload = multer({
  dest: path.join(__dirname, 'uploads'),
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files allowed'));
  },
  limits: { fileSize: 20 * 1024 * 1024 }
});

// Init DB on startup
db.getDb().then(() => {
  console.log('Database initialized');
}).catch(err => {
  console.error('DB init error:', err);
});

// ─── ROUTES ─────────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Upload & process PDFs
app.post('/api/upload', upload.array('pdfs', 20), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }
  console.log("req.files?", req.files);
  const results = [];
  const errors = [];

  for (const file of req.files) {
    try {
      const pdfBuffer = fs.readFileSync(file.path);
      const pdfData = await pdfParse(pdfBuffer);
      const pdfText = pdfData.text;

      if (!pdfText || pdfText.trim().length < 10) {
        errors.push({ filename: file.originalname, error: 'Could not extract text (may be a scanned image PDF)' });
        continue;
      }

      const extracted = await extractFromPdf(pdfText, file.originalname);
      console.log("extracted?", extracted);
      const docId = db.insertDocument(file.originalname, extracted.document_type);

      for (const field of extracted.fields) {
        db.insertField(
          docId,
          field.field_name,
          field.field_value !== null && field.field_value !== undefined ? String(field.field_value) : null,
          field.confidence || 0,
          field.provenance || '',
          field.data_type || 'text'
        );
      }

      results.push({
        id: docId,
        filename: file.originalname,
        doc_type: extracted.document_type,
        field_count: extracted.fields.length
      });

    } catch (err) {
      console.error(`Error processing ${file.originalname}:`, err.message);
      errors.push({ filename: file.originalname, error: err.message });
    } finally {
      try { fs.unlinkSync(file.path); } catch (_) {}
    }
  }

  res.json({ results, errors });
});

// Get all documents (with field count)
app.get('/api/documents', (req, res) => {
  try {
    const docs = db.getAllDocuments();
    // Attach field counts
    const docsWithCount = docs.map(doc => ({
      ...doc,
      field_count: db.getFieldsByDocumentId(doc.id).length
    }));
    res.json(docsWithCount);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single document with fields
app.get('/api/documents/:id', (req, res) => {
  try {
    const doc = db.getDocumentById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    const fields = db.getFieldsByDocumentId(req.params.id);
    res.json({ ...doc, fields });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a field value
app.put('/api/fields/:id', (req, res) => {
  try {
    const { value } = req.body;
    db.updateField(req.params.id, value);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a document
app.delete('/api/documents/:id', (req, res) => {
  try {
    db.deleteDocument(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export documents to Excel using ExcelJS
app.get('/api/export', async (req, res) => {
  try {
    const ids = req.query.ids ? req.query.ids.split(',') : null;
    const allDocs = db.getAllDocuments();
    const docsToExport = ids
      ? allDocs.filter(d => ids.includes(String(d.id)))
      : allDocs;

    if (docsToExport.length === 0) {
      return res.status(400).json({ error: 'No documents to export' });
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'DocParse';
    workbook.created = new Date();

    for (const doc of docsToExport) {
      const fields = db.getFieldsByDocumentId(doc.id);
      const sheetName = doc.filename.replace(/\.pdf$/i, '').substring(0, 31);
      const sheet = workbook.addWorksheet(sheetName);

      // ── Document meta block ──────────────────────────────────────
      const metaRows = [
        ['Document', doc.filename],
        ['Type', doc.doc_type || 'Unknown'],
        ['Parsed At', doc.created_at],
        ['Total Fields', fields.length],
        [],
      ];

      metaRows.forEach(row => sheet.addRow(row));

      // Style meta labels
      [1, 2, 3, 4].forEach(i => {
        const cell = sheet.getRow(i).getCell(1);
        cell.font = { bold: true, color: { argb: 'FF888888' }, size: 10 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A1F' } };
      });

      // ── Header row ───────────────────────────────────────────────
      const headerRow = sheet.addRow(['Field Name', 'Value', 'Data Type', 'Confidence', 'Source / Provenance']);
      headerRow.eachCell(cell => {
        cell.font = { bold: true, color: { argb: 'FF000000' }, size: 11 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00E5A0' } };
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
        cell.border = {
          bottom: { style: 'medium', color: { argb: 'FF009966' } }
        };
      });
      headerRow.height = 22;

      // ── Data rows ────────────────────────────────────────────────
      fields.forEach((f, idx) => {
        const conf = f.confidence || 0;
        const confLabel = `${Math.round(conf * 100)}%`;
        const row = sheet.addRow([
          f.field_name,
          f.field_value || '',
          f.data_type || 'text',
          confLabel,
          f.provenance || ''
        ]);

        const isEven = idx % 2 === 0;
        const bgColor = isEven ? 'FFFAFAFA' : 'FFF3F3F3';

        row.eachCell((cell, colNum) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
          cell.alignment = { vertical: 'top', wrapText: colNum === 2 || colNum === 5 };
          cell.border = {
            bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } }
          };
        });

        // Colour-code confidence cell
        const confCell = row.getCell(4);
        if (conf >= 0.8) {
          confCell.font = { color: { argb: 'FF007755' }, bold: true };
        } else if (conf >= 0.5) {
          confCell.font = { color: { argb: 'FF996600' }, bold: true };
        } else {
          confCell.font = { color: { argb: 'FFCC3300' }, bold: true };
        }

        // Type chip styling
        row.getCell(3).font = { color: { argb: 'FF5B8AFF' }, italic: true };

        row.height = 18;
      });

      // ── Column widths ────────────────────────────────────────────
      sheet.columns = [
        { key: 'a', width: 32 },
        { key: 'b', width: 42 },
        { key: 'c', width: 14 },
        { key: 'd', width: 13 },
        { key: 'e', width: 60 },
      ];

      // Freeze header row
      sheet.views = [{ state: 'frozen', ySplit: 6 }]; // 5 meta rows + 1 header
    }

    // Stream to response
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="extracted_data.xlsx"');
    await workbook.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 PDF Extractor running at http://localhost:${PORT}\n`);
  console.log(`📝 Make sure to set GEMINI_API_KEY in your .env file\n`);
});