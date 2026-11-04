import { parseCSVToObjects, generateCSV } from '../utils/csvParser.js';
import { questionBankRepository } from '../repositories/questionBankRepository.js';
import { logAudit } from '../repositories/auditRepository.js';

const MAX_CSV_ROWS = 1000;
const VALID_ANSWERS = ['A', 'B', 'C', 'D'];
const ANSWER_INDEX_MAP = { 'A': 0, 'B': 1, 'C': 2, 'D': 3 };
const VALID_DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'];

export const questionBankService = {
  /**
   * Returns a sample RFC 4180 compliant CSV string for download
   */
  getSampleTemplate() {
    const headers = [
      'question',
      'optionA',
      'optionB',
      'optionC',
      'optionD',
      'correctAnswer',
      'subject',
      'topic',
      'difficulty',
      'explanation',
      'marks',
      'questionType',
      'expectedAnswer',
      'evaluationCriteria',
      'programmingLanguage',
      'starterCode',
      'timeLimit',
      'memoryLimit'
    ];

    const sampleRows = [
      {
        question: 'Which of the following data structures operates on a Last-In First-Out (LIFO) basis?',
        questionType: 'MCQ',
        optionA: 'Queue',
        optionB: 'Stack',
        optionC: 'Binary Search Tree',
        optionD: 'Priority Queue',
        correctAnswer: 'B',
        subject: 'Computer Science Fundamentals',
        topic: 'Linear Data Structures',
        difficulty: 'EASY',
        explanation: 'A stack operates strictly on the LIFO principle, where elements are inserted and removed from the same top end.',
        marks: 4,
        expectedAnswer: '',
        evaluationCriteria: '',
        programmingLanguage: '',
        starterCode: '',
        timeLimit: '',
        memoryLimit: ''
      },
      {
        question: 'HTTP is a stateless communication protocol by design.',
        questionType: 'TRUE_FALSE',
        optionA: '',
        optionB: '',
        optionC: '',
        optionD: '',
        correctAnswer: 'TRUE',
        subject: 'Computer Science Fundamentals',
        topic: 'Computer Networks',
        difficulty: 'EASY',
        explanation: 'Each HTTP request is executed independently without the server retaining session state by default.',
        marks: 2,
        expectedAnswer: '',
        evaluationCriteria: '',
        programmingLanguage: '',
        starterCode: '',
        timeLimit: '',
        memoryLimit: ''
      },
      {
        question: 'Explain the working principle of a heat exchanger and describe its major industrial applications.',
        questionType: 'LONG_ANSWER',
        optionA: '',
        optionB: '',
        optionC: '',
        optionD: '',
        correctAnswer: '',
        subject: 'Computer Science Fundamentals',
        topic: 'Thermodynamics',
        difficulty: 'MEDIUM',
        explanation: 'Heat exchangers transfer thermal energy between fluids without mixing them.',
        marks: 10,
        expectedAnswer: 'A heat exchanger is a device designed to transfer heat between two or more fluids at different temperatures. They operate either through direct contact or across a solid conductive barrier (e.g. shell-and-tube or plate types). Applications include refrigeration, power plants, chemical processing, and HVAC systems.',
        evaluationCriteria: 'Correct principle of thermal energy transfer across conductive barrier; Fluid separation mechanism; Explanation quality; At least two valid industrial applications mentioned.',
        programmingLanguage: '',
        starterCode: '',
        timeLimit: '',
        memoryLimit: ''
      },
      {
        question: 'Write a JavaScript function sum(a, b) that returns the arithmetic sum of two given numbers.',
        questionType: 'CODING',
        optionA: '',
        optionB: '',
        optionC: '',
        optionD: '',
        correctAnswer: '',
        subject: 'Computer Science Fundamentals',
        topic: 'JavaScript Functions',
        difficulty: 'EASY',
        explanation: 'The function should accept two arguments a and b, and return a + b.',
        marks: 10,
        expectedAnswer: '',
        evaluationCriteria: '',
        programmingLanguage: 'javascript',
        starterCode: 'function sum(a, b) {\n  // Write your code here\n  return a + b;\n}',
        timeLimit: 2,
        memoryLimit: 128
      }
    ];

    return generateCSV(headers, sampleRows);
  },

  /**
   * Validates parsed CSV rows against schema constraints, teacher permissions, and duplicate rules
   * @param {string} csvText
   * @param {Object} user
   * @returns {Promise<Object>}
   */
  async validateAndAnalyze(csvText, user) {
    if (!csvText || typeof csvText !== 'string' || csvText.trim() === '') {
      return {
        success: false,
        error: 'The uploaded CSV file is empty. Please choose a valid file containing question records.'
      };
    }

    const parsed = parseCSVToObjects(csvText);

    if (parsed.error) {
      return {
        success: false,
        error: parsed.error
      };
    }

    if (parsed.missingHeaders && parsed.missingHeaders.length > 0) {
      return {
        success: false,
        error: `Missing required CSV column headers: ${parsed.missingHeaders.join(', ')}. Please use the downloadable template.`
      };
    }

    if (parsed.rows.length === 0) {
      return {
        success: false,
        error: 'The CSV file contains column headers but no question data rows.'
      };
    }

    if (parsed.rows.length > MAX_CSV_ROWS) {
      return {
        success: false,
        error: `The CSV file contains ${parsed.rows.length} rows, which exceeds the maximum allowable limit of ${MAX_CSV_ROWS} questions per batch import.`
      };
    }

    // Determine teacher authorized subjects
    const authorizedSubjects = await questionBankRepository.getTeacherAuthorizedSubjects(user.id, user.role);
    const isUnrestricted = authorizedSubjects === null; // ADMIN

    // Query database for existing questions matching candidates to check duplicate questions
    const candidates = parsed.rows.map(r => ({
      question_text: r.data.question || '',
      subject: r.data.subject || ''
    }));
    const existingDbQuestions = await questionBankRepository.findExistingDuplicates(candidates);
    const existingDbMap = new Map();
    existingDbQuestions.forEach(ex => {
      const key = `${ex.norm_text}:::${ex.norm_subject}`;
      existingDbMap.set(key, ex);
    });

    const validatedRows = [];
    const seenInFile = new Map();

    let validCount = 0;
    let invalidCount = 0;
    let duplicateDbCount = 0;
    let duplicateFileCount = 0;

    for (const rowItem of parsed.rows) {
      const { rowNumber, data } = rowItem;
      const errors = [];
      const warnings = [];

      // Determine and normalize question type
      const rawQType = (data.questionType || data.question_type || data.type || 'MCQ').toUpperCase().trim();
      let questionType = 'mcq_single';
      if (['CODING', 'CODE', 'PROGRAMMING'].includes(rawQType)) {
        questionType = 'coding';
      } else if (['LONG_ANSWER', 'LONG', 'SUBJECTIVE', 'ESSAY', 'DESCRIPTIVE'].includes(rawQType)) {
        questionType = 'long_answer';
      } else if (['TRUE_FALSE', 'TRUEFALSE', 'TF', 'BOOLEAN'].includes(rawQType)) {
        questionType = 'true_false';
      } else {
        questionType = 'mcq_single';
      }

      // 1. Validate Question Text
      const questionText = (data.question || '').trim();
      if (!questionText) {
        errors.push('Question text is required.');
      } else if (questionText.length < 3) {
        errors.push('Question text is too short (minimum 3 characters).');
      } else if (questionText.length > 5000) {
        errors.push('Question text exceeds maximum length of 5000 characters.');
      }

      // 2. Validate Type-Specific Options & Answers
      const optA = (data.optionA || '').trim();
      const optB = (data.optionB || '').trim();
      const optC = (data.optionC || '').trim();
      const optD = (data.optionD || '').trim();
      let rawAns = (data.correctAnswer || '').toUpperCase().trim();
      let optionsArr = [];
      let correctOptionIndex = 0;

      if (questionType === 'mcq_single') {
        if (!optA) errors.push('Option A is required for Multiple Choice questions.');
        if (!optB) errors.push('Option B is required for Multiple Choice questions.');
        if (!optC) errors.push('Option C is required for Multiple Choice questions.');
        if (!optD) errors.push('Option D is required for Multiple Choice questions.');

        optionsArr = [optA, optB, optC, optD].filter(Boolean);
        const uniqueOptions = new Set(optionsArr.map(o => o.toLowerCase()));
        if (optionsArr.length === 4 && uniqueOptions.size < 4) {
          warnings.push('Duplicate option values detected within this question.');
        }

        if (!rawAns) {
          errors.push('Correct answer is required for Multiple Choice questions (must be A, B, C, or D).');
        } else if (!VALID_ANSWERS.includes(rawAns)) {
          errors.push(`Invalid correct answer "${rawAns}". Allowed values are: A, B, C, D.`);
        } else {
          correctOptionIndex = ANSWER_INDEX_MAP[rawAns] ?? 0;
        }
      } else if (questionType === 'true_false') {
        optionsArr = ['True', 'False'];
        if (['TRUE', 'T', '1', 'A'].includes(rawAns)) {
          rawAns = 'TRUE';
          correctOptionIndex = 0;
        } else if (['FALSE', 'F', '0', 'B'].includes(rawAns)) {
          rawAns = 'FALSE';
          correctOptionIndex = 1;
        } else {
          errors.push(`Invalid answer for True/False question "${rawAns}". Allowed values: TRUE or FALSE.`);
        }
      } else if (questionType === 'long_answer') {
        // Options and correct answer are not required
        optionsArr = [];
        correctOptionIndex = 0;
      } else if (questionType === 'coding') {
        // Coding question: options not required
        optionsArr = [];
        correctOptionIndex = 0;
      }

      // Expected Answer & Evaluation Criteria (Long Answer)
      const expectedAnswer = (data.expectedAnswer || data.expected_answer || '').trim();
      const evaluationCriteria = (data.evaluationCriteria || data.evaluation_criteria || '').trim();

      // Programming Language, Starter Code, Time/Memory Limits (Coding)
      let programmingLanguage = (data.programmingLanguage || data.programming_language || 'javascript').toLowerCase().trim();
      if (questionType === 'coding' && !programmingLanguage) {
        programmingLanguage = 'javascript';
      }
      const starterCode = (data.starterCode || data.starter_code || '').trim();
      let timeLimit = 2.0;
      if (data.timeLimit || data.time_limit) {
        const parsedTL = parseFloat(data.timeLimit || data.time_limit);
        if (!isNaN(parsedTL) && parsedTL > 0) timeLimit = parsedTL;
      }
      let memoryLimit = 128;
      if (data.memoryLimit || data.memory_limit) {
        const parsedML = parseInt(data.memoryLimit || data.memory_limit, 10);
        if (!isNaN(parsedML) && parsedML > 0) memoryLimit = parsedML;
      }

      // 3. Validate Subject & Topic
      const subject = (data.subject || '').trim();
      const topic = (data.topic || '').trim();

      if (!subject) {
        errors.push('Subject is required.');
      } else if (subject.length < 2) {
        errors.push('Subject name must be at least 2 characters.');
      }

      if (!topic) {
        errors.push('Topic is required.');
      } else if (topic.length < 2) {
        errors.push('Topic name must be at least 2 characters.');
      }

      // 4. Teacher Authorization Check
      if (!isUnrestricted && subject) {
        const subNorm = subject.toLowerCase().trim();
        const hasPermission = authorizedSubjects.some(authSub => authSub === subNorm || subNorm.includes(authSub) || authSub.includes(subNorm));
        if (!hasPermission) {
          errors.push(
            `Permission Denied: You are not authorized to import questions for subject "${subject}".` +
            (authorizedSubjects.length > 0 ? ` Your authorized subjects are: ${authorizedSubjects.join(', ')}.` : ' You currently have no assigned subjects.')
          );
        }
      }

      // 5. Validate Difficulty
      let difficulty = (data.difficulty || 'MEDIUM').toUpperCase().trim();
      if (!VALID_DIFFICULTIES.includes(difficulty)) {
        if (data.difficulty && data.difficulty.trim() !== '') {
          errors.push(`Invalid difficulty "${data.difficulty}". Allowed values: EASY, MEDIUM, HARD.`);
        } else {
          difficulty = 'MEDIUM';
        }
      }

      // 6. Validate Marks
      let marks = (questionType === 'long_answer' || questionType === 'coding') ? 10.0 : 4.0;
      if (data.marks !== undefined && String(data.marks).trim() !== '') {
        const parsedMarks = parseFloat(data.marks);
        if (isNaN(parsedMarks) || parsedMarks <= 0) {
          errors.push(`Marks must be a positive number greater than 0 (received "${data.marks}").`);
        } else if (parsedMarks > 100) {
          errors.push('Marks per question cannot exceed 100.');
        } else {
          marks = parsedMarks;
        }
      }

      // 7. Negative marks calculation
      let negativeMarks = questionType === 'mcq_single' ? parseFloat((marks / 4).toFixed(2)) : 0;
      if (data.negativeMarks !== undefined && String(data.negativeMarks).trim() !== '') {
        const parsedNeg = parseFloat(data.negativeMarks);
        if (!isNaN(parsedNeg) && parsedNeg >= 0) {
          negativeMarks = parsedNeg;
        }
      }

      // 8. Explanation
      const explanation = (data.explanation || '').trim();
      if (explanation.length > 4000) {
        errors.push('Explanation exceeds maximum allowed limit of 4000 characters.');
      }

      // 9. In-file duplicate check
      const fileKey = `${questionText.toLowerCase()}:::${subject.toLowerCase()}`;
      let isDuplicateInFile = false;
      if (questionText && subject) {
        if (seenInFile.has(fileKey)) {
          isDuplicateInFile = true;
          duplicateFileCount++;
          const prevRow = seenInFile.get(fileKey);
          errors.push(`Duplicate question: Identical to Row #${prevRow} in this CSV file.`);
        } else {
          seenInFile.set(fileKey, rowNumber);
        }
      }

      // 10. Database duplicate check
      let isDuplicateInDb = false;
      let existingDbMatch = null;
      if (questionText && subject && !isDuplicateInFile) {
        const dbMatch = existingDbMap.get(fileKey);
        if (dbMatch) {
          isDuplicateInDb = true;
          duplicateDbCount++;
          existingDbMatch = { id: dbMatch.id, question_text: dbMatch.question_text };
          warnings.push(`Matches existing question in Question Bank (ID: ${dbMatch.id}).`);
        }
      }

      const isValid = errors.length === 0;
      if (isValid) {
        validCount++;
      } else {
        invalidCount++;
      }

      validatedRows.push({
        rowNumber,
        isValid,
        isDuplicateInFile,
        isDuplicateInDb,
        existingDbMatch,
        errors,
        warnings,
        data: {
          question: questionText,
          questionType,
          optionA: optA,
          optionB: optB,
          optionC: optC,
          optionD: optD,
          correctAnswer: rawAns,
          correctOptionIndex,
          options: optionsArr,
          subject,
          topic,
          difficulty,
          marks,
          negativeMarks,
          explanation,
          expectedAnswer,
          evaluationCriteria,
          programmingLanguage,
          starterCode,
          timeLimit,
          memoryLimit
        }
      });
    }

    const allErrors = [];
    validatedRows.forEach(r => {
      if (r.errors && r.errors.length) allErrors.push(...r.errors);
    });

    return {
      success: true,
      validCount,
      valid_count: validCount,
      totalRows: parsed.rows.length,
      total_rows: parsed.rows.length,
      invalidCount,
      invalid_count: invalidCount,
      errors: allErrors,
      summary: {
        totalRows: parsed.rows.length,
        validRows: validCount,
        invalidRows: invalidCount,
        duplicateInFileCount: duplicateFileCount,
        duplicateInDbCount: duplicateDbCount,
        unrestrictedUser: isUnrestricted,
        authorizedSubjects: isUnrestricted ? 'ALL' : authorizedSubjects
      },
      headers: parsed.headers,
      rows: validatedRows
    };
  },

  /**
   * Preview CSV import without modifying the database
   */
  async previewCSV(csvText, user) {
    return this.validateAndAnalyze(csvText, user);
  },

  /**
   * Commit questions into database with duplicate strategy and transaction safety
   */
  async importCSV(csvText, user, options = {}, reqInfo = {}) {
    const duplicateStrategy = options.duplicateStrategy === 'allow' ? 'allow' : 'skip';

    // 1. Run authoritative server-side validation
    const validation = await this.validateAndAnalyze(csvText, user);
    if (!validation.success) {
      return validation;
    }

    const { rows, summary } = validation;

    const toInsert = [];
    const skippedRows = [];
    const failedRows = [];

    for (const r of rows) {
      if (!r.isValid) {
        failedRows.push({
          rowNumber: r.rowNumber,
          question: r.data.question,
          errors: r.errors
        });
        continue;
      }

      // Check DB duplicate handling
      if (r.isDuplicateInDb) {
        if (duplicateStrategy === 'skip') {
          skippedRows.push({
            rowNumber: r.rowNumber,
            question: r.data.question,
            reason: `Skipped: Duplicate of existing Question Bank item (${r.existingDbMatch?.id}).`
          });
          continue;
        }
      }

      // Prepare question record for insertion
      toInsert.push({
        question_text: r.data.question,
        question_type: r.data.questionType,
        options: r.data.options,
        correct_option_index: r.data.correctOptionIndex,
        correct_answer: r.data.correctAnswer,
        subject: r.data.subject,
        topic: r.data.topic,
        difficulty: r.data.difficulty,
        explanation: r.data.explanation,
        marks: r.data.marks,
        negative_marks: r.data.negativeMarks,
        expected_answer: r.data.expectedAnswer || null,
        evaluation_criteria: r.data.evaluationCriteria || null,
        programming_language: r.data.programmingLanguage || 'javascript',
        starter_code: r.data.starterCode || null,
        time_limit: r.data.timeLimit || 2.0,
        memory_limit: r.data.memoryLimit || 128,
        test_cases: []
      });
    }

    // 2. Batch insert into database with transaction
    let insertedQuestions = [];
    if (toInsert.length > 0) {
      insertedQuestions = await questionBankRepository.batchInsert(toInsert, user.id);
    }

    // 3. Write structured audit log
    await logAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: 'BULK_QUESTIONS_IMPORTED',
      resourceType: 'QUESTION_BANK',
      resourceId: null,
      summary: `Bulk CSV import completed: ${insertedQuestions.length} inserted, ${skippedRows.length} skipped, ${failedRows.length} failed. Strategy: ${duplicateStrategy}.`,
      ipAddress: reqInfo.ip || null
    });

    return {
      success: true,
      message: `Import completed. ${insertedQuestions.length} question(s) added successfully.`,
      result: {
        totalRows: summary.totalRows,
        importedCount: insertedQuestions.length,
        skippedCount: skippedRows.length,
        failedCount: failedRows.length,
        duplicateStrategy,
        importedQuestions: insertedQuestions,
        skippedRows,
        failedRows
      }
    };
  },

  /**
   * Generates a downloadable CSV error report for failed rows
   */
  generateErrorReport(failedRows) {
    const headers = ['Row Number', 'Question', 'Errors'];
    const rows = (failedRows || []).map(f => ({
      'Row Number': f.rowNumber,
      'Question': f.question || '',
      'Errors': Array.isArray(f.errors) ? f.errors.join('; ') : String(f.reason || '')
    }));
    return generateCSV(headers, rows);
  }
};
