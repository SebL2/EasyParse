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

## Deploy to Vercel

The repo ships a serverless entrypoint at `api/index.js` and a `vercel.json`
that routes all non-static requests through the Express app.

1. Push the repo to GitHub and import it in Vercel (or run `vercel` from the
   Vercel CLI).
2. In the Vercel project settings, add an environment variable:
   - `GEMINI_API_KEY` = your Gemini API key
3. Deploy.

### Vercel caveats

- **Storage is ephemeral.** Vercel serverless functions only have `/tmp` as a
  writable path, and `/tmp` is wiped on cold starts. This app stores its
  SQLite file there, so uploaded documents will eventually disappear. For
  durable storage swap `db.js` for an external database (Vercel Postgres,
  Turso, Supabase, Neon, etc.).
- **Request body size.** Vercel caps serverless request bodies at 4.5 MB by
  default. Large PDFs near the 20 MB client-side limit will be rejected at
  the platform edge before they reach the app.
- **Execution time.** `vercel.json` sets `maxDuration` to 60s, which is the
  hobby-plan ceiling. Very large PDFs may still time out; use Pro if you need
  up to 300s.
- Uploads now use in-memory multer storage, so no `uploads/` directory is
  needed at runtime.

## Current Flow

1. Upload one or more PDFs
2. Choose a schema mode:
   - `AI Discover` to let the model design the extraction schema
   - `Predefined Schema` to lock extraction to an established schema
3. Choose a detail level:
   - `core`
   - `standard`
   - `exhaustive`
4. EasyParse:
   - extracts PDF text
   - either loads the chosen predefined schema or discovers a schema
   - extracts structured data
   - validates the output
   - stores flattened review rows
5. Review/edit fields in the modal
6. Export the flattened review rows to Excel

## Predefined Schemas

The app now ships with several established schemas:
- `Academic Transcript`
- `Invoice`
- `Resume / CV`
- `Contract / Agreement`

Users can still skip those and let the model infer the schema from the PDF.

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
