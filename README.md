# EasyParse

EasyParse is an AI-powered PDF extraction workbench built around a structured two-pass pipeline:

1. `Spec discovery`
   The model inspects the PDF text and generates an extraction spec with:
   - document type
   - top-level fields
   - repeated groups
   - nested subgroups when a repeated record contains its own repeated items

2. `Extraction`
   The model follows that spec to produce structured output.

3. `Validation + flattening`
   The app runs deterministic checks, stores the structured JSON, and also flattens the result into editable review rows.

## What Changed

The repo no longer treats every PDF as one flat list of `field_name -> field_value`.

It now stores:
- the discovered extraction spec
- the structured extraction output
- a validation report
- flattened fields for fast review/edit/export

This makes repeated structures like transcript terms/courses, invoice line items, team members/tasks, and table-like records much easier to preserve.

## Setup

1. Install dependencies

```bash
npm install
```

2. Add your Gemini API key to `.env`

```bash
GEMINI_API_KEY=your_key_here
```

3. Start the app

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000).

## Current Flow

1. Upload one or more PDFs
2. Choose a detail level:
   - `core`
   - `standard`
   - `exhaustive`
3. EasyParse:
   - extracts PDF text
   - discovers an extraction spec
   - extracts structured data
   - validates the output
   - stores flattened review rows
4. Review/edit fields in the modal
5. Export the flattened review rows to Excel

## Data Model

`documents` now stores:
- filename
- document type
- detail level
- summary text
- extraction spec JSON
- structured output JSON
- validation JSON
- source excerpt metadata

`extracted_fields` stores flattened rows with:
- field path
- field label
- section label
- entry label
- value
- confidence
- evidence
- data type

## Notes

- The current implementation still uses text extraction via `pdf-parse`, so image-only/scanned PDFs still need OCR.
- Long PDFs are excerpted before model submission, and the validation report flags that condition.
- User edits update the flattened row immediately and also patch the stored structured JSON when the field path is known.
