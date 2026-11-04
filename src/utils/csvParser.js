/**
 * RFC 4180 Compliant CSV Parser and Generator Utility
 *
 * Supports:
 * - UTF-8 character encoding with or without BOM (\uFEFF)
 * - CRLF (\r\n) and LF (\n) line breaks
 * - Quoted fields containing commas, newlines, and carriage returns
 * - Escaped quotation marks ("") within quoted fields
 * - Column header mapping and normalization
 */

/**
 * Parses raw CSV string into a 2D array of rows and cells following RFC 4180
 * @param {string} text - Raw CSV text
 * @returns {Array<Array<string>>} - Array of rows, each row being an array of string values
 */
export function parseRawCSV(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  // Remove UTF-8 BOM if present
  let cleanText = text;
  if (cleanText.charCodeAt(0) === 0xFEFF) {
    cleanText = cleanText.slice(1);
  }

  const rows = [];
  let currentRow = [];
  let currentField = '';
  let insideQuotes = false;
  let i = 0;
  const len = cleanText.length;

  while (i < len) {
    const char = cleanText[i];

    if (insideQuotes) {
      if (char === '"') {
        // Look ahead for escaped quote ("")
        if (i + 1 < len && cleanText[i + 1] === '"') {
          currentField += '"';
          i += 2;
          continue;
        } else {
          // Closing quote
          insideQuotes = false;
          i++;
          continue;
        }
      } else {
        currentField += char;
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        // Opening quote (only valid at start of field or after whitespace)
        insideQuotes = true;
        i++;
        continue;
      } else if (char === ',') {
        currentRow.push(currentField);
        currentField = '';
        i++;
        continue;
      } else if (char === '\r') {
        // Handle CRLF or standalone CR
        if (i + 1 < len && cleanText[i + 1] === '\n') {
          i++; // skip \r, \n will be handled in next iteration or below
        }
        currentRow.push(currentField);
        currentField = '';
        rows.push(currentRow);
        currentRow = [];
        i++;
        continue;
      } else if (char === '\n') {
        currentRow.push(currentField);
        currentField = '';
        rows.push(currentRow);
        currentRow = [];
        i++;
        continue;
      } else {
        currentField += char;
        i++;
        continue;
      }
    }
  }

  // Final field and row if any content remains
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  // Filter out trailing empty rows that can occur from trailing newlines
  while (rows.length > 0 && rows[rows.length - 1].every(cell => cell.trim() === '')) {
    rows.pop();
  }

  return rows;
}

/**
 * Standard column aliases map for forgiving header normalization
 */
const HEADER_KEY_MAP = {
  'question': 'question',
  'questiontext': 'question',
  'question_text': 'question',
  'prompt': 'question',

  'optiona': 'optionA',
  'option_a': 'optionA',
  'opt_a': 'optionA',
  'a': 'optionA',

  'optionb': 'optionB',
  'option_b': 'optionB',
  'opt_b': 'optionB',
  'b': 'optionB',

  'optionc': 'optionC',
  'option_c': 'optionC',
  'opt_c': 'optionC',
  'c': 'optionC',

  'optiond': 'optionD',
  'option_d': 'optionD',
  'opt_d': 'optionD',
  'd': 'optionD',

  'correctanswer': 'correctAnswer',
  'correct_answer': 'correctAnswer',
  'answer': 'correctAnswer',
  'correct': 'correctAnswer',
  'correctoption': 'correctAnswer',

  'subject': 'subject',
  'subjectname': 'subject',
  'subject_name': 'subject',

  'topic': 'topic',
  'topicname': 'topic',
  'topic_name': 'topic',

  'difficulty': 'difficulty',
  'level': 'difficulty',
  'difficultylevel': 'difficulty',

  'explanation': 'explanation',
  'solution': 'explanation',
  'rationale': 'explanation',

  'marks': 'marks',
  'mark': 'marks',
  'score': 'marks',
  'points': 'marks',

  'negativemarks': 'negativeMarks',
  'negative_marks': 'negativeMarks',
  'penaltymarks': 'negativeMarks',
  'penalty': 'negativeMarks',

  'questiontype': 'questionType',
  'question_type': 'questionType',
  'qtype': 'questionType',
  'type': 'questionType',

  'expectedanswer': 'expectedAnswer',
  'expected_answer': 'expectedAnswer',
  'modelanswer': 'expectedAnswer',

  'evaluationcriteria': 'evaluationCriteria',
  'evaluation_criteria': 'evaluationCriteria',
  'rubric': 'evaluationCriteria',

  'programminglanguage': 'programmingLanguage',
  'programming_language': 'programmingLanguage',
  'language': 'programmingLanguage',
  'lang': 'programmingLanguage',

  'startercode': 'starterCode',
  'starter_code': 'starterCode',
  'boilerplate': 'starterCode',

  'timelimit': 'timeLimit',
  'time_limit': 'timeLimit',

  'memorylimit': 'memoryLimit',
  'memory_limit': 'memoryLimit'
};

/**
 * Normalizes a header cell to recognized field key
 * @param {string} header
 * @returns {string} Normalized key or original trimmed lower
 */
export function normalizeHeader(header) {
  if (!header) return '';
  const clean = header.trim().toLowerCase().replace(/[\s\-_]/g, '');
  return HEADER_KEY_MAP[clean] || header.trim();
}

/**
 * Parses CSV text into array of structured row objects with line tracking
 * @param {string} csvText
 * @returns {{ headers: string[], rows: Array<{ rowNumber: number, data: Object, raw: string[] }>, error?: string, missingHeaders?: string[] }}
 */
export function parseCSVToObjects(csvText) {
  const rawRows = parseRawCSV(csvText);

  if (!rawRows || rawRows.length === 0) {
    return {
      headers: [],
      rows: [],
      error: 'CSV file is empty.'
    };
  }

  // Header row (Row 1)
  const headerCells = rawRows[0];
  const mappedHeaders = headerCells.map(h => normalizeHeader(h));

  // Determine required minimum columns:
  // If questionType is present in headers, only universal fields are required at header level.
  // Otherwise, default to legacy MCQ required fields.
  const hasQuestionType = mappedHeaders.includes('questionType');
  const requiredFields = hasQuestionType
    ? ['question', 'subject', 'topic']
    : ['question', 'optionA', 'optionB', 'optionC', 'optionD', 'correctAnswer', 'subject', 'topic'];
  const missingHeaders = requiredFields.filter(req => !mappedHeaders.includes(req));

  const rows = [];
  // Data rows start from index 1 (Row 2 in standard 1-indexed spreadsheet view)
  for (let i = 1; i < rawRows.length; i++) {
    const rowCells = rawRows[i];
    // Skip row if completely empty
    if (rowCells.every(cell => !cell || cell.trim() === '')) {
      continue;
    }

    const rowObj = {};
    mappedHeaders.forEach((key, colIdx) => {
      if (key) {
        rowObj[key] = (rowCells[colIdx] !== undefined ? rowCells[colIdx] : '').trim();
      }
    });

    rows.push({
      rowNumber: i + 1, // 1-indexed for human readable spreadsheet row number
      data: rowObj,
      raw: rowCells
    });
  }

  return {
    headers: mappedHeaders,
    rawHeaders: headerCells,
    missingHeaders,
    rows
  };
}

/**
 * Escapes a cell value for RFC 4180 CSV export
 * @param {any} value
 * @returns {string}
 */
export function escapeCSVCell(value) {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Generates an RFC 4180 compliant CSV string from an array of objects
 * @param {string[]} headers - Header labels
 * @param {Array<Object>} rows - Array of objects whose keys match headers
 * @returns {string}
 */
export function generateCSV(headers, rows) {
  const headerLine = headers.map(h => escapeCSVCell(h)).join(',');
  const lines = [headerLine];

  for (const row of rows) {
    const rowValues = headers.map(h => escapeCSVCell(row[h] !== undefined ? row[h] : ''));
    lines.push(rowValues.join(','));
  }

  return lines.join('\r\n');
}
