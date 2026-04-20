require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getPredefinedSchemaById, listPredefinedSchemas } = require('./schemas');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

const MODEL_PRIORITY = [
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
];

const SUPPORTED_DETAIL_LEVELS = ['core', 'standard', 'exhaustive'];
const FIELD_TYPES = [
  'text',
  'number',
  'date',
  'currency',
  'email',
  'phone',
  'address',
  'percentage',
  'boolean',
  'list',
];

const MAX_DISCOVERY_CHARS = 45000;
const MAX_EXTRACTION_CHARS = 140000;
const PROCESSING_VERSION = 'v2-spec-pipeline';

const DISCOVERY_SYSTEM_INSTRUCTION = `
You are a document analysis planner.

Your job is to inspect the supplied PDF text excerpt and design a reusable extraction spec.
You are NOT extracting the final values yet.

Rules:
- Match the requested detail level exactly.
- Use top-level fields for singleton facts.
- Use groups for repeated records such as terms, line items, sections, people, entries, or milestones.
- Use subgroups only when a repeated record contains its own repeated list.
- Keep field ids short, stable, and snake_case.
- Keep labels human-readable.
- Prefer meaningful structure over a giant flat list.
- Avoid speculative fields that do not have a clear anchor in the document.
- If a field might be absent, include it but mark required=false.
- Return JSON only.
`.trim();

const EXTRACTION_SYSTEM_INSTRUCTION = `
You are a precise document extraction engine.

Follow the provided extraction spec exactly.

Rules:
- Extract only what is supported by the source text.
- Preserve document order.
- Keep ids, labels, and types aligned to the spec.
- If a value is missing or ambiguous, use null and a low confidence score.
- Evidence should be a short supporting snippet, not a long quote.
- For date/number/currency/percentage fields, preserve the source-form value as a string.
- For list-like fields, return a concise comma-separated string.
- Do not invent fields, entries, or groups outside the spec.
- Return JSON only.
`.trim();

const FIELD_SPEC_SCHEMA = {
  type: 'object',
  required: ['id', 'label', 'type', 'required', 'description', 'extraction_hint'],
  properties: {
    id: { type: 'string' },
    label: { type: 'string' },
    type: { type: 'string', enum: FIELD_TYPES },
    required: { type: 'boolean' },
    description: { type: 'string' },
    extraction_hint: { type: 'string' },
  },
};

const SUBGROUP_SPEC_SCHEMA = {
  type: 'object',
  required: ['id', 'label', 'repeat', 'description', 'key_hint', 'fields'],
  properties: {
    id: { type: 'string' },
    label: { type: 'string' },
    repeat: { type: 'boolean' },
    description: { type: 'string' },
    key_hint: { type: 'string' },
    fields: { type: 'array', items: FIELD_SPEC_SCHEMA },
  },
};

const GROUP_SPEC_SCHEMA = {
  type: 'object',
  required: ['id', 'label', 'repeat', 'description', 'key_hint', 'fields', 'subgroups'],
  properties: {
    id: { type: 'string' },
    label: { type: 'string' },
    repeat: { type: 'boolean' },
    description: { type: 'string' },
    key_hint: { type: 'string' },
    fields: { type: 'array', items: FIELD_SPEC_SCHEMA },
    subgroups: { type: 'array', items: SUBGROUP_SPEC_SCHEMA },
  },
};

const DISCOVERY_RESPONSE_SCHEMA = {
  type: 'object',
  required: ['document_type', 'title', 'detail_level', 'summary', 'fields', 'groups', 'warnings'],
  properties: {
    document_type: { type: 'string' },
    title: { type: 'string' },
    detail_level: { type: 'string', enum: SUPPORTED_DETAIL_LEVELS },
    summary: { type: 'string' },
    fields: { type: 'array', items: FIELD_SPEC_SCHEMA },
    groups: { type: 'array', items: GROUP_SPEC_SCHEMA },
    warnings: { type: 'array', items: { type: 'string' } },
  },
};

const FIELD_RESULT_SCHEMA = {
  type: 'object',
  required: ['id', 'label', 'type', 'value', 'evidence', 'confidence'],
  properties: {
    id: { type: 'string' },
    label: { type: 'string' },
    type: { type: 'string', enum: FIELD_TYPES },
    value: { type: 'string', nullable: true },
    evidence: { type: 'string', nullable: true },
    confidence: { type: 'number' },
  },
};

const SUBGROUP_ENTRY_SCHEMA = {
  type: 'object',
  required: ['key', 'title', 'summary', 'fields'],
  properties: {
    key: { type: 'string', nullable: true },
    title: { type: 'string' },
    summary: { type: 'string', nullable: true },
    fields: { type: 'array', items: FIELD_RESULT_SCHEMA },
  },
};

const SUBGROUP_RESULT_SCHEMA = {
  type: 'object',
  required: ['id', 'label', 'entries'],
  properties: {
    id: { type: 'string' },
    label: { type: 'string' },
    entries: { type: 'array', items: SUBGROUP_ENTRY_SCHEMA },
  },
};

const GROUP_ENTRY_SCHEMA = {
  type: 'object',
  required: ['key', 'title', 'summary', 'fields', 'subgroups'],
  properties: {
    key: { type: 'string', nullable: true },
    title: { type: 'string' },
    summary: { type: 'string', nullable: true },
    fields: { type: 'array', items: FIELD_RESULT_SCHEMA },
    subgroups: { type: 'array', items: SUBGROUP_RESULT_SCHEMA },
  },
};

const GROUP_RESULT_SCHEMA = {
  type: 'object',
  required: ['id', 'label', 'entries'],
  properties: {
    id: { type: 'string' },
    label: { type: 'string' },
    entries: { type: 'array', items: GROUP_ENTRY_SCHEMA },
  },
};

const EXTRACTION_RESPONSE_SCHEMA = {
  type: 'object',
  required: ['document_type', 'title', 'summary', 'fields', 'groups', 'warnings'],
  properties: {
    document_type: { type: 'string' },
    title: { type: 'string' },
    summary: { type: 'string' },
    fields: { type: 'array', items: FIELD_RESULT_SCHEMA },
    groups: { type: 'array', items: GROUP_RESULT_SCHEMA },
    warnings: { type: 'array', items: { type: 'string' } },
  },
};

function normalizeDetailLevel(value) {
  const normalized = String(value || 'standard').trim().toLowerCase();
  return SUPPORTED_DETAIL_LEVELS.includes(normalized) ? normalized : 'standard';
}

function normalizePdfText(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/\t/g, ' ')
    .replace(/\u0000/g, '')
    .replace(/[ \u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function toCleanString(value, fallback = '') {
  if (value == null) return fallback;
  const normalized = String(value).replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function toNullableString(value) {
  const cleaned = toCleanString(value, '');
  return cleaned || null;
}

function clampConfidence(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(1, num));
}

function sanitizeIdentifier(value, fallback) {
  const seed = toCleanString(value || fallback, fallback || 'field');
  let id = seed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');

  if (!id) id = toCleanString(fallback, 'field').toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'field';
  if (/^\d/.test(id)) id = `field_${id}`;
  return id;
}

function makeUniqueIds(items) {
  const seen = new Map();
  return items.map(item => {
    const base = item.id;
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    if (count === 0) return item;
    return { ...item, id: `${base}_${count + 1}` };
  });
}

function sanitizeFieldSpec(field, fallback) {
  const label = toCleanString(field && field.label, fallback);
  return {
    id: sanitizeIdentifier(field && field.id, label || fallback),
    label: label || fallback,
    type: FIELD_TYPES.includes(field && field.type) ? field.type : 'text',
    required: Boolean(field && field.required),
    description: toCleanString(field && field.description, `Extract ${label || fallback}.`),
    extraction_hint: toCleanString(field && field.extraction_hint, `Look for ${label || fallback} in the document.`),
  };
}

function sanitizeSubgroupSpec(subgroup, fallback) {
  const label = toCleanString(subgroup && subgroup.label, fallback);
  const rawFields = Array.isArray(subgroup && subgroup.fields) ? subgroup.fields : [];
  const fields = makeUniqueIds(
    rawFields.map((field, index) => sanitizeFieldSpec(field, `${label} Field ${index + 1}`))
  );

  return {
    id: sanitizeIdentifier(subgroup && subgroup.id, label || fallback),
    label: label || fallback,
    repeat: subgroup && subgroup.repeat !== false,
    description: toCleanString(subgroup && subgroup.description, `Repeated ${label || fallback} records.`),
    key_hint: toCleanString(subgroup && subgroup.key_hint, label || fallback),
    fields,
  };
}

function sanitizeGroupSpec(group, fallback) {
  const label = toCleanString(group && group.label, fallback);
  const rawFields = Array.isArray(group && group.fields) ? group.fields : [];
  const rawSubgroups = Array.isArray(group && group.subgroups) ? group.subgroups : [];

  const fields = makeUniqueIds(
    rawFields.map((field, index) => sanitizeFieldSpec(field, `${label} Field ${index + 1}`))
  );
  const subgroups = makeUniqueIds(
    rawSubgroups.map((subgroup, index) => sanitizeSubgroupSpec(subgroup, `${label} Group ${index + 1}`))
  );

  return {
    id: sanitizeIdentifier(group && group.id, label || fallback),
    label: label || fallback,
    repeat: group && group.repeat !== false,
    description: toCleanString(group && group.description, `Repeated ${label || fallback} records.`),
    key_hint: toCleanString(group && group.key_hint, label || fallback),
    fields,
    subgroups,
  };
}

function buildFallbackSpec(detailLevel) {
  return {
    document_type: 'General Document',
    title: 'Generic Document Extraction',
    detail_level: detailLevel,
    summary: 'Fallback extraction plan for a general PDF document.',
    fields: [
      {
        id: 'document_title',
        label: 'Document Title',
        type: 'text',
        required: false,
        description: 'Primary title or heading of the document.',
        extraction_hint: 'Use the most prominent document title if present.',
      },
      {
        id: 'document_date',
        label: 'Document Date',
        type: 'date',
        required: false,
        description: 'Primary published, issued, or print date for the document.',
        extraction_hint: 'Look for dates near headers, footers, or metadata blocks.',
      },
      {
        id: 'document_summary',
        label: 'Document Summary',
        type: 'text',
        required: false,
        description: 'A concise summary-worthy value or purpose statement if clearly stated.',
        extraction_hint: 'Capture the clearest plain-language description of the document purpose.',
      },
    ],
    groups: [],
    warnings: ['The planner returned an empty spec, so a fallback spec was generated.'],
  };
}

function sanitizeSpec(rawSpec, detailLevel) {
  const rawFields = Array.isArray(rawSpec && rawSpec.fields) ? rawSpec.fields : [];
  const rawGroups = Array.isArray(rawSpec && rawSpec.groups) ? rawSpec.groups : [];

  const spec = {
    document_type: toCleanString(rawSpec && rawSpec.document_type, 'General Document'),
    title: toCleanString(rawSpec && rawSpec.title, 'Untitled Extraction Plan'),
    detail_level: detailLevel,
    summary: toCleanString(rawSpec && rawSpec.summary, 'Structured extraction plan generated from the document.'),
    fields: makeUniqueIds(rawFields.map((field, index) => sanitizeFieldSpec(field, `Field ${index + 1}`))),
    groups: makeUniqueIds(rawGroups.map((group, index) => sanitizeGroupSpec(group, `Group ${index + 1}`))),
    warnings: Array.isArray(rawSpec && rawSpec.warnings)
      ? rawSpec.warnings.map(warning => toCleanString(warning)).filter(Boolean)
      : [],
  };

  if (spec.fields.length === 0 && spec.groups.length === 0) {
    return buildFallbackSpec(detailLevel);
  }

  return spec;
}

function sanitizeFieldResult(rawField, specField) {
  return {
    id: specField.id,
    label: specField.label,
    type: specField.type,
    value: toNullableString(rawField && rawField.value),
    evidence: toNullableString(rawField && rawField.evidence),
    confidence: clampConfidence(rawField && rawField.confidence),
  };
}

function alignFieldResults(specFields, rawFields) {
  const pool = Array.isArray(rawFields) ? rawFields.slice() : [];
  return specFields.map(specField => {
    const normalizedSpecId = sanitizeIdentifier(specField.id, specField.id);
    const matchIndex = pool.findIndex(rawField => {
      const rawId = sanitizeIdentifier(rawField && rawField.id, rawField && rawField.label);
      const rawLabel = toCleanString(rawField && rawField.label).toLowerCase();
      return rawId === normalizedSpecId || rawLabel === specField.label.toLowerCase();
    });

    const rawField = matchIndex >= 0 ? pool.splice(matchIndex, 1)[0] : null;
    return sanitizeFieldResult(rawField, specField);
  });
}

function sanitizeSubgroupEntries(rawEntries, subgroupSpec) {
  const entries = Array.isArray(rawEntries) ? rawEntries : [];
  return entries.map((entry, entryIndex) => ({
    key: toNullableString(entry && entry.key),
    title: toCleanString(entry && entry.title, `${subgroupSpec.label} ${entryIndex + 1}`),
    summary: toNullableString(entry && entry.summary),
    fields: alignFieldResults(subgroupSpec.fields, entry && entry.fields),
  }));
}

function sanitizeGroupEntries(rawEntries, groupSpec) {
  const entries = Array.isArray(rawEntries) ? rawEntries : [];
  return entries.map((entry, entryIndex) => {
    const rawSubgroups = Array.isArray(entry && entry.subgroups) ? entry.subgroups : [];
    const subgroups = groupSpec.subgroups.map(subgroupSpec => {
      const match = rawSubgroups.find(rawSubgroup => {
        const rawId = sanitizeIdentifier(rawSubgroup && rawSubgroup.id, rawSubgroup && rawSubgroup.label);
        return rawId === subgroupSpec.id;
      });

      return {
        id: subgroupSpec.id,
        label: subgroupSpec.label,
        entries: sanitizeSubgroupEntries(match && match.entries, subgroupSpec),
      };
    });

    return {
      key: toNullableString(entry && entry.key),
      title: toCleanString(entry && entry.title, `${groupSpec.label} ${entryIndex + 1}`),
      summary: toNullableString(entry && entry.summary),
      fields: alignFieldResults(groupSpec.fields, entry && entry.fields),
      subgroups,
    };
  });
}

function sanitizeExtraction(rawOutput, spec) {
  const rawGroups = Array.isArray(rawOutput && rawOutput.groups) ? rawOutput.groups : [];
  return {
    document_type: toCleanString(rawOutput && rawOutput.document_type, spec.document_type),
    title: toCleanString(rawOutput && rawOutput.title, spec.title),
    summary: toCleanString(rawOutput && rawOutput.summary, spec.summary),
    fields: alignFieldResults(spec.fields, rawOutput && rawOutput.fields),
    groups: spec.groups.map(groupSpec => {
      const match = rawGroups.find(rawGroup => {
        const rawId = sanitizeIdentifier(rawGroup && rawGroup.id, rawGroup && rawGroup.label);
        return rawId === groupSpec.id;
      });

      return {
        id: groupSpec.id,
        label: groupSpec.label,
        entries: sanitizeGroupEntries(match && match.entries, groupSpec),
      };
    }),
    warnings: Array.isArray(rawOutput && rawOutput.warnings)
      ? rawOutput.warnings.map(warning => toCleanString(warning)).filter(Boolean)
      : [],
  };
}

function buildContextWindow(text, limit) {
  if (text.length <= limit) {
    return { content: text, truncated: false };
  }

  const headLen = Math.floor(limit * 0.45);
  const middleLen = Math.floor(limit * 0.2);
  const tailLen = limit - headLen - middleLen;
  const middleStart = Math.max(0, Math.floor(text.length / 2) - Math.floor(middleLen / 2));

  const head = text.slice(0, headLen);
  const middle = text.slice(middleStart, middleStart + middleLen);
  const tail = text.slice(text.length - tailLen);

  return {
    content: [
      head,
      '[... middle excerpt omitted for size ...]',
      middle,
      '[... tail excerpt omitted for size ...]',
      tail,
    ].join('\n\n'),
    truncated: true,
  };
}

function cleanJsonText(text) {
  let cleaned = String(text || '').trim();
  cleaned = cleaned.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end >= start) {
    cleaned = cleaned.slice(start, end + 1);
  }

  return cleaned;
}

async function generateStructuredObject({ systemInstruction, prompt, responseSchema, label }) {
  if (!genAI) {
    throw new Error('GEMINI_API_KEY is not configured.');
  }

  let lastError = null;

  for (const modelName of MODEL_PRIORITY) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction,
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
          responseSchema,
        },
      });

      console.log(`[gemini] ${label} using ${modelName}`);
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      return JSON.parse(cleanJsonText(text));
    } catch (error) {
      lastError = new Error(`${label} failed on ${modelName}: ${error.message}`);
      console.error(`[gemini] ${label} failed on ${modelName}:`, error.message);
    }
  }

  throw lastError || new Error(`${label} failed on all configured models.`);
}

async function discoverExtractionSpec({ filename, pdfText, detailLevel }) {
  const context = buildContextWindow(pdfText, MAX_DISCOVERY_CHARS);
  const prompt = `
Filename: ${filename}
Requested detail level: ${detailLevel}

Detail level guidance:
- core: only the most important singleton fields and repeated records.
- standard: the important fields plus secondary records a reviewer would expect.
- exhaustive: all meaningful fields and repeated records worth reviewing.

Design an extraction plan for this PDF text.
Return a structure with:
- top-level fields for singleton values
- groups for repeated records
- subgroups only when repeated records contain their own repeated items

Document excerpt${context.truncated ? ' (excerpted because the source was long)' : ''}:
${context.content}
`.trim();

  const rawSpec = await generateStructuredObject({
    systemInstruction: DISCOVERY_SYSTEM_INSTRUCTION,
    prompt,
    responseSchema: DISCOVERY_RESPONSE_SCHEMA,
    label: 'discovery',
  });

  return sanitizeSpec(rawSpec, detailLevel);
}

async function extractStructuredData({ filename, pdfText, detailLevel, spec }) {
  const context = buildContextWindow(pdfText, MAX_EXTRACTION_CHARS);
  const prompt = `
Filename: ${filename}
Requested detail level: ${detailLevel}

Extraction spec:
${JSON.stringify(spec, null, 2)}

Document text${context.truncated ? ' (excerpted because the source was long)' : ''}:
${context.content}

Return extracted data that follows the spec.
Keep arrays in document order.
If a group has no matching entries, return an empty entries array for that group.
`.trim();

  const rawOutput = await generateStructuredObject({
    systemInstruction: EXTRACTION_SYSTEM_INSTRUCTION,
    prompt,
    responseSchema: EXTRACTION_RESPONSE_SCHEMA,
    label: 'extraction',
  });

  return {
    output: sanitizeExtraction(rawOutput, spec),
    sourceTruncated: context.truncated,
    sourceExcerpt: context.content,
  };
}

function validateValueByType(value, type) {
  if (value == null || value === '') return true;

  switch (type) {
    case 'number':
      return /^[-+]?[\d,.]+$/.test(value);
    case 'currency':
      return /[\d]/.test(value) && /[$€£¥]|usd|eur|gbp|cad|aud|sgd|inr/i.test(value) || /^[-+]?[\d,.]+$/.test(value);
    case 'date':
      return !Number.isNaN(Date.parse(value)) || /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/.test(value);
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    case 'phone':
      return /[\d]{7,}/.test(value.replace(/\D/g, ''));
    case 'percentage':
      return /%/.test(value) || /^[-+]?[\d,.]+$/.test(value);
    case 'boolean':
      return /^(true|false|yes|no|y|n)$/i.test(value);
    default:
      return true;
  }
}

function createFlatRow({ path, label, value, confidence, evidence, type, sectionLabel, entryLabel, orderIndex }) {
  return {
    field_path: path,
    field_label: label,
    field_name: label,
    field_value: value,
    confidence,
    provenance: evidence,
    data_type: type,
    section_label: sectionLabel || '',
    entry_label: entryLabel || '',
    order_index: orderIndex,
  };
}

function flattenExtraction(output) {
  const rows = [];
  let orderIndex = 0;

  for (const field of output.fields) {
    rows.push(createFlatRow({
      path: field.id,
      label: field.label,
      value: field.value,
      confidence: field.confidence,
      evidence: field.evidence,
      type: field.type,
      sectionLabel: 'Document',
      entryLabel: '',
      orderIndex: orderIndex++,
    }));
  }

  for (const group of output.groups) {
    group.entries.forEach((entry, entryIndex) => {
      const entryLabel = entry.title || entry.key || `${group.label} ${entryIndex + 1}`;

      for (const field of entry.fields) {
        rows.push(createFlatRow({
          path: `${group.id}[${entryIndex}].${field.id}`,
          label: field.label,
          value: field.value,
          confidence: field.confidence,
          evidence: field.evidence,
          type: field.type,
          sectionLabel: group.label,
          entryLabel,
          orderIndex: orderIndex++,
        }));
      }

      for (const subgroup of entry.subgroups) {
        subgroup.entries.forEach((subEntry, subIndex) => {
          const subEntryLabel = subEntry.title || subEntry.key || `${subgroup.label} ${subIndex + 1}`;
          for (const field of subEntry.fields) {
            rows.push(createFlatRow({
              path: `${group.id}[${entryIndex}].${subgroup.id}[${subIndex}].${field.id}`,
              label: field.label,
              value: field.value,
              confidence: field.confidence,
              evidence: field.evidence,
              type: field.type,
              sectionLabel: `${group.label} / ${subgroup.label}`,
              entryLabel: `${entryLabel} -> ${subEntryLabel}`,
              orderIndex: orderIndex++,
            }));
          }
        });
      }
    });
  }

  return rows;
}

function validateExtraction(spec, output, options = {}) {
  const issues = [];
  const allRows = flattenExtraction(output);
  const populatedRows = allRows.filter(row => row.field_value != null && row.field_value !== '');
  const lowConfidenceRows = populatedRows.filter(row => Number(row.confidence || 0) < 0.55);
  const averageConfidence = populatedRows.length
    ? populatedRows.reduce((sum, row) => sum + Number(row.confidence || 0), 0) / populatedRows.length
    : 0;

  for (const field of output.fields) {
    const specField = spec.fields.find(candidate => candidate.id === field.id);
    if (specField && specField.required && (field.value == null || field.value === '')) {
      issues.push({
        severity: 'error',
        path: field.id,
        label: field.label,
        message: 'Required top-level field is missing.',
      });
    }
    if (field.value != null && field.value !== '' && !validateValueByType(field.value, field.type)) {
      issues.push({
        severity: 'warning',
        path: field.id,
        label: field.label,
        message: `Value does not look like a valid ${field.type}.`,
      });
    }
  }

  for (const groupSpec of spec.groups) {
    const outputGroup = output.groups.find(group => group.id === groupSpec.id);
    const entries = outputGroup ? outputGroup.entries : [];

    if (!groupSpec.repeat && entries.length === 0) {
      issues.push({
        severity: 'warning',
        path: groupSpec.id,
        label: groupSpec.label,
        message: 'Expected a grouped record but none was extracted.',
      });
    }

    entries.forEach((entry, entryIndex) => {
      for (const field of entry.fields) {
        const specField = groupSpec.fields.find(candidate => candidate.id === field.id);
        const path = `${groupSpec.id}[${entryIndex}].${field.id}`;
        if (specField && specField.required && (field.value == null || field.value === '')) {
          issues.push({
            severity: 'error',
            path,
            label: field.label,
            message: 'Required grouped field is missing.',
          });
        }
        if (field.value != null && field.value !== '' && !validateValueByType(field.value, field.type)) {
          issues.push({
            severity: 'warning',
            path,
            label: field.label,
            message: `Value does not look like a valid ${field.type}.`,
          });
        }
      }

      groupSpec.subgroups.forEach(subgroupSpec => {
        const outputSubgroup = entry.subgroups.find(subgroup => subgroup.id === subgroupSpec.id);
        const subEntries = outputSubgroup ? outputSubgroup.entries : [];

        subEntries.forEach((subEntry, subIndex) => {
          for (const field of subEntry.fields) {
            const specField = subgroupSpec.fields.find(candidate => candidate.id === field.id);
            const path = `${groupSpec.id}[${entryIndex}].${subgroupSpec.id}[${subIndex}].${field.id}`;
            if (specField && specField.required && (field.value == null || field.value === '')) {
              issues.push({
                severity: 'error',
                path,
                label: field.label,
                message: 'Required nested field is missing.',
              });
            }
            if (field.value != null && field.value !== '' && !validateValueByType(field.value, field.type)) {
              issues.push({
                severity: 'warning',
                path,
                label: field.label,
                message: `Value does not look like a valid ${field.type}.`,
              });
            }
          }
        });
      });
    });
  }

  for (const row of lowConfidenceRows) {
    issues.push({
      severity: 'warning',
      path: row.field_path,
      label: row.field_label,
      message: 'Field has low model confidence and should be reviewed.',
    });
  }

  if (options.sourceTruncated) {
    issues.push({
      severity: 'warning',
      path: '_document',
      label: 'Source coverage',
      message: 'The source text was excerpted before sending to the model, so long-document coverage may be incomplete.',
    });
  }

  return {
    ready_for_review: !issues.some(issue => issue.severity === 'error'),
    completeness: {
      total_fields: allRows.length,
      populated_fields: populatedRows.length,
      missing_fields: allRows.length - populatedRows.length,
    },
    confidence: {
      average: Number(averageConfidence.toFixed(3)),
      low_confidence_fields: lowConfidenceRows.length,
    },
    issues,
  };
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function applyFieldEdit(output, fieldPath, nextValue) {
  const cloned = deepClone(output);
  let updated = false;

  for (const field of cloned.fields) {
    if (field.id === fieldPath) {
      field.value = nextValue;
      updated = true;
      break;
    }
  }

  if (updated) return cloned;

  for (const group of cloned.groups) {
    group.entries.forEach((entry, entryIndex) => {
      entry.fields.forEach(field => {
        if (`${group.id}[${entryIndex}].${field.id}` === fieldPath) {
          field.value = nextValue;
          updated = true;
        }
      });

      entry.subgroups.forEach(subgroup => {
        subgroup.entries.forEach((subEntry, subIndex) => {
          subEntry.fields.forEach(field => {
            if (`${group.id}[${entryIndex}].${subgroup.id}[${subIndex}].${field.id}` === fieldPath) {
              field.value = nextValue;
              updated = true;
            }
          });
        });
      });
    });
  }

  return updated ? cloned : null;
}

async function processPdf({ filename, pdfText, detailLevel = 'standard' }) {
  return processPdfWithSchemaMode({
    filename,
    pdfText,
    detailLevel,
    schemaMode: 'discover',
    schemaId: null,
  });
}

async function processPdfWithSchemaMode({
  filename,
  pdfText,
  detailLevel = 'standard',
  schemaMode = 'discover',
  schemaId = null,
}) {
  const normalizedDetailLevel = normalizeDetailLevel(detailLevel);
  const normalizedText = normalizePdfText(pdfText);
  const usePredefined = schemaMode === 'predefined' && schemaId;

  let spec;
  let schemaSelection;

  if (usePredefined) {
    const predefinedSchema = getPredefinedSchemaById(schemaId);
    if (!predefinedSchema) {
      throw new Error(`Unknown predefined schema: ${schemaId}`);
    }

    spec = sanitizeSpec(predefinedSchema.spec, normalizedDetailLevel);
    schemaSelection = {
      mode: 'predefined',
      schema_id: predefinedSchema.id,
      schema_label: predefinedSchema.label,
    };
  } else {
    spec = await discoverExtractionSpec({
      filename,
      pdfText: normalizedText,
      detailLevel: normalizedDetailLevel,
    });
    schemaSelection = {
      mode: 'discover',
      schema_id: null,
      schema_label: 'AI Discovered Schema',
    };
  }

  const { output, sourceTruncated, sourceExcerpt } = await extractStructuredData({
    filename,
    pdfText: normalizedText,
    detailLevel: normalizedDetailLevel,
    spec,
  });

  const validation = validateExtraction(spec, output, { sourceTruncated });
  const flatFields = flattenExtraction(output);

  return {
    documentType: output.document_type,
    title: output.title,
    detailLevel: normalizedDetailLevel,
    schemaSelection,
    spec,
    output,
    validation,
    flatFields,
    sourceExcerpt,
    sourceTruncated,
    processingVersion: PROCESSING_VERSION,
  };
}

module.exports = {
  MODEL_PRIORITY,
  PROCESSING_VERSION,
  SUPPORTED_DETAIL_LEVELS,
  applyFieldEdit,
  flattenExtraction,
  listPredefinedSchemas,
  normalizeDetailLevel,
  processPdf,
  processPdfWithSchemaMode,
  validateExtraction,
};
