# DocParse — AI PDF Data Extractor

Automatically extracts structured data from any PDF using Gemini AI with auto-schema discovery.

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure API key**
   ```bash
   cp .env.example .env
   # Edit .env and add your Gemini API key
   ```
  

3. **Run**
   ```bash
   npm start
   # Opens at http://localhost:3000
   ```

## How it works

1. **Upload** one or more PDFs via drag-and-drop
2. **AI Schema Discovery** — Gemini reads each document and infers what type it is and what fields to extract (no predefined schema needed)
3. **Field Extraction** — Each field is extracted with:
   - The value
   - A confidence score (0–100%)
   - Provenance (the source text it was pulled from)
   - Data type (text, number, date, currency, etc.)
4. **Review & Edit** — Click any document to view all extracted fields in an editable table. Changes auto-save.
5. **Export** — Download selected or all documents as a formatted Excel file (.xlsx), one sheet per document.

## Model

Uses `gemini-2.5-flash-lite` (Gemini 2.5 Flash Lite) with automatic fallback to `gemini-2.0-flash` and `gemini-1.5-flash`.

## Data Storage

Extracted data is stored in a local SQLite database (`data.sqlite`) using sql.js — no external database required.
