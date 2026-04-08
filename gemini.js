require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SYSTEM_INSTRUCTION = `You are an intelligent document parsing engine. Your job is to analyze any document and perform TWO tasks automatically:

TASK 1 - SCHEMA DISCOVERY:
Read the entire document and determine:
- What type of document this is (invoice, contract, resume, medical record, research paper, form, report, etc.)
- What fields/data points are meaningful and extractable from THIS specific document
- Do NOT use a predefined schema — infer the schema from the document's content and context
- Think contextually: if a number appears near the word "total" at the bottom of a table, it's likely a total amount

TASK 2 - FIELD EXTRACTION:
For each discovered field:
- Extract the value precisely as it appears
- Note the exact surrounding text (provenance) that confirms where you found it
- Assign a confidence score (0.0 to 1.0): 1.0 = explicitly stated, 0.7 = inferred from context, 0.4 = ambiguous
- Classify the data type: text, number, date, currency, email, phone, address, percentage, boolean, list

RULES:
- Never hallucinate a field value. If you cannot find it, set value to null and confidence to 0
- Extract ALL meaningful fields — be thorough, not minimal
- For tables, extract each row as structured data
- Use contextual reasoning: infer what unlabeled data means from surrounding context
- Field names should be human-readable (e.g., "Invoice Total" not "inv_tot")

RESPONSE FORMAT — Return ONLY valid JSON, no markdown, no explanation:
{
  "document_type": "string describing what this document is",
  "fields": [
    {
      "field_name": "Human readable field name",
      "field_value": "extracted value or null",
      "confidence": 0.95,
      "provenance": "the surrounding text snippet that confirms this value",
      "data_type": "text|number|date|currency|email|phone|address|percentage|boolean|list"
    }
  ]
}`;

// Model priority: try newest first, fallback gracefully
const MODEL_PRIORITY = [
  'gemini-2.5-flash-lite',       // Gemini 2.5 Flash Lite (API name)
  'gemini-2.0-flash',            // Gemini 2.5 Flash fallback
  'gemini-1.5-flash',            // Final fallback
];

async function extractFromPdf(pdfText, filename) {
  const prompt = `Parse this document (filename: ${filename}) and extract all meaningful fields.\n\nDOCUMENT CONTENT:\n${pdfText.substring(0, 30000)}`; // cap at ~30k chars
  let lastError;
    try {
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash-lite',
        systemInstruction: SYSTEM_INSTRUCTION,
      });
      console.log(`Using model: gemini-2.5-flash-lite`);
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      return parseGeminiResponse(text);
    } catch (e) {
      lastError = e;
    }
  throw lastError;
}

function parseGeminiResponse(text) {
  // Strip markdown fences if present
  let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  
  // Find JSON object
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1) {
    cleaned = cleaned.substring(start, end + 1);
  }
  
  const parsed = JSON.parse(cleaned);
  
  // Validate structure
  if (!parsed.fields || !Array.isArray(parsed.fields)) {
    throw new Error('Invalid response structure from AI');
  }
  
  return parsed;
}

module.exports = { extractFromPdf };
