// Mock Test Scoring & Question Sanitization Service
// LinkTest Enterprise Examination System

export const mockTestScoringService = {
  /**
   * Sanitizes question list for candidates actively taking the exam.
   * Strips answer keys, correct answers, and explanations to ensure zero leakage.
   */
  sanitizeQuestionsForTaker(questions) {
    if (!Array.isArray(questions)) return [];

    return questions.map(q => {
      // Safely parse options if string
      let rawOptions = q.options;
      if (typeof rawOptions === 'string') {
        try { rawOptions = JSON.parse(rawOptions); } catch {}
      }

      // Safely parse answer_key if string
      let rawAnswerKey = q.answer_key;
      if (typeof rawAnswerKey === 'string') {
        try { rawAnswerKey = JSON.parse(rawAnswerKey); } catch {}
      }

      const qType = String(q.question_type || 'mcq_single').toLowerCase().trim();

      // Clone question
      const sanitized = {
        id: q.id,
        test_id: q.test_id,
        section_id: q.section_id,
        question_text: q.question_text || 'Assessment Question',
        question_type: qType,
        marks: parseFloat(q.marks || 0),
        negative_marks: parseFloat(q.negative_marks || 0),
        topic: q.topic || '',
        difficulty: q.difficulty || 'medium',
        order_index: q.order_index || 1,
        case_passage: q.case_passage || null,
        image_url: q.image_url || null,
        programming_language: q.programming_language || 'javascript',
        starter_code: q.starter_code || null,
        time_limit: parseFloat(q.time_limit || 2.0),
        memory_limit: parseInt(q.memory_limit || 128, 10),
        metadata: { ...q.metadata }
      };

      // Sanitize test cases: strip inputs and expected outputs for hidden test cases
      let rawCases = [];
      try {
        rawCases = typeof q.test_cases === 'string' ? JSON.parse(q.test_cases) : (q.test_cases || []);
      } catch { rawCases = []; }

      sanitized.test_cases = rawCases.map(tc => {
        if (tc.is_hidden) {
          return { id: tc.id, is_hidden: true };
        }
        return { id: tc.id, input: tc.input, expected_output: tc.expected_output, is_hidden: false };
      });

      // Sanitize options based on type
      if (qType === 'matching') {
        let leftItems = [];
        let availableTargets = [];

        if (rawOptions && typeof rawOptions === 'object' && !Array.isArray(rawOptions)) {
          leftItems = Array.isArray(rawOptions.left_items) ? rawOptions.left_items : [];
          availableTargets = Array.isArray(rawOptions.available_targets) ? rawOptions.available_targets : [];
        } else if (Array.isArray(rawOptions)) {
          leftItems = rawOptions.map((opt, oIdx) => ({
            id: typeof opt === 'object' && opt !== null ? (opt.id || opt.key || `left_${oIdx + 1}`) : `left_${oIdx + 1}`,
            text: typeof opt === 'object' && opt !== null ? (opt.text || opt.label || opt.value || opt.title) : String(opt)
          }));
        }

        if (availableTargets.length === 0 && rawAnswerKey && typeof rawAnswerKey === 'object') {
          availableTargets = Array.isArray(rawAnswerKey.available_targets)
            ? rawAnswerKey.available_targets
            : (rawAnswerKey.pairs ? Object.values(rawAnswerKey.pairs) : []);
        }

        sanitized.options = {
          left_items: leftItems,
          available_targets: availableTargets
        };
      } else {
        // For MCQ, True/False, Case Study, etc.
        sanitized.options = Array.isArray(rawOptions) ? [...rawOptions] : (rawOptions || []);
      }

      // Explicitly delete sensitive fields
      delete sanitized.answer_key;
      delete sanitized.correct_answer;
      delete sanitized.correct_answers;
      delete sanitized.correct_option_index;
      delete sanitized.explanation;
      delete sanitized.expected_answer;
      delete sanitized.evaluation_criteria;
      delete sanitized.rubric;

      return sanitized;
    });
  },

  /**
   * Evaluates a single question against the submitted candidate response.
   * Returns: { score_awarded, is_correct, is_pending_review, evaluation_comment }
   */
  evaluateQuestionResponse(question, responseData, negativeMarkingEnabled = true) {
    const marks = parseFloat(question.marks || 0);
    const negativePenalty = negativeMarkingEnabled ? Math.abs(parseFloat(question.negative_marks || 0)) : 0;
    const rawKey = question.answer_key || {};
    const answerKey = (rawKey.correct_answer && typeof rawKey.correct_answer === 'object')
      ? { ...rawKey, ...rawKey.correct_answer }
      : rawKey;
    const type = question.question_type;

    // Check if unanswered
    if (!responseData || Object.keys(responseData).length === 0) {
      return {
        score_awarded: 0,
        is_correct: null,
        is_unanswered: true,
        is_pending_review: false,
        evaluation_comment: 'Unanswered'
      };
    }

    switch (type) {
      case 'mcq_single':
      case 'case_study': {
        const selected = responseData.selected_index !== undefined
          ? responseData.selected_index
          : (responseData.selected !== undefined
              ? responseData.selected
              : (responseData.selected_option_index !== undefined ? responseData.selected_option_index : responseData.option_id));
        if (selected === undefined || selected === null) {
          return { score_awarded: 0, is_correct: null, is_unanswered: true, evaluation_comment: 'Unanswered' };
        }
        const correct = answerKey.correct_index !== undefined
          ? answerKey.correct_index
          : (answerKey.selected !== undefined ? answerKey.selected : answerKey.correct_option_id);

        const isMatch = String(selected).trim().toLowerCase() === String(correct).trim().toLowerCase()
          || (!isNaN(Number(selected)) && !isNaN(Number(correct)) && Number(selected) === Number(correct));

        if (isMatch) {
          return { score_awarded: marks, is_correct: true, evaluation_comment: 'Correct option selected.' };
        } else {
          return { score_awarded: -negativePenalty, is_correct: false, evaluation_comment: 'Incorrect option selected.' };
        }
      }

      case 'mcq_multiple': {
        const selected = Array.isArray(responseData.selected_indices)
          ? responseData.selected_indices
          : (Array.isArray(responseData.selected) ? responseData.selected : (Array.isArray(responseData.option_ids) ? responseData.option_ids : []));
        const correct = Array.isArray(answerKey.correct_indices)
          ? answerKey.correct_indices
          : (Array.isArray(answerKey.selected) ? answerKey.selected : (Array.isArray(answerKey.correct_option_ids) ? answerKey.correct_option_ids : []));

        if (selected.length === 0) {
          return { score_awarded: 0, is_correct: null, is_unanswered: true, evaluation_comment: 'Unanswered' };
        }

        const selectedSet = new Set(selected.map(s => String(s).trim().toLowerCase()));
        const correctSet = new Set(correct.map(c => String(c).trim().toLowerCase()));

        // Count correct selections and extraneous (wrong) selections
        let correctMatches = 0;
        let incorrectSelections = 0;

        for (const val of selectedSet) {
          if (correctSet.has(val)) {
            correctMatches++;
          } else {
            incorrectSelections++;
          }
        }

        const isExactMatch = correctMatches === correctSet.size && incorrectSelections === 0;

        if (isExactMatch) {
          return { score_awarded: marks, is_correct: true, evaluation_comment: 'All correct options selected.' };
        }

        // Partial credit support if enabled in metadata
        const allowPartial = question.metadata?.allow_partial_credit ?? true;
        if (allowPartial && correctSet.size > 0 && incorrectSelections === 0 && correctMatches > 0) {
          const partialScore = parseFloat(((correctMatches / correctSet.size) * marks).toFixed(2));
          return {
            score_awarded: partialScore,
            is_correct: false,
            evaluation_comment: `Partial credit awarded (${correctMatches}/${correctSet.size} correct selections).`
          };
        }

        return { score_awarded: -negativePenalty, is_correct: false, evaluation_comment: 'Incorrect option(s) selected.' };
      }

      case 'true_false': {
        let selected = responseData.selected_value !== undefined
          ? responseData.selected_value
          : responseData.boolean;
        if (selected === undefined && responseData.selected_index !== undefined) {
          selected = responseData.selected_index === 0;
        }
        if (selected === undefined || selected === null) {
          return { score_awarded: 0, is_correct: null, is_unanswered: true, evaluation_comment: 'Unanswered' };
        }
        let expected;
        if (answerKey.correct_value !== undefined) {
          expected = Boolean(answerKey.correct_value);
        } else if (answerKey.boolean !== undefined) {
          expected = Boolean(answerKey.boolean);
        } else if (answerKey.correct_index !== undefined) {
          expected = answerKey.correct_index === 0;
        } else {
          expected = true;
        }
        const actual = Boolean(selected);

        if (actual === expected) {
          return { score_awarded: marks, is_correct: true, evaluation_comment: 'Correct answer.' };
        } else {
          return { score_awarded: -negativePenalty, is_correct: false, evaluation_comment: 'Incorrect answer.' };
        }
      }

      case 'fill_blank':
      case 'short_answer': {
        const rawText = responseData.text !== undefined
          ? responseData.text
          : (Array.isArray(responseData.blanks) ? responseData.blanks[0] : (responseData.value || ''));
        const text = String(rawText || '').trim().toLowerCase();
        if (!text) {
          return { score_awarded: 0, is_correct: null, is_unanswered: true, evaluation_comment: 'Unanswered' };
        }

        const rawAccepted = answerKey.accepted_answers || answerKey.blanks || (answerKey.text ? [answerKey.text] : []);
        const accepted = (Array.isArray(rawAccepted) ? rawAccepted : [rawAccepted]).map(a => String(a).trim().toLowerCase());
        const isMatch = accepted.some(acc => acc === text);

        if (isMatch) {
          return { score_awarded: marks, is_correct: true, evaluation_comment: 'Text answer matches expected key.' };
        } else {
          return { score_awarded: -negativePenalty, is_correct: false, evaluation_comment: 'Answer does not match key.' };
        }
      }

      case 'numerical': {
        const rawNum = responseData.number !== undefined ? responseData.number : responseData.value;
        const numberVal = parseFloat(rawNum);
        if (isNaN(numberVal)) {
          return { score_awarded: 0, is_correct: null, is_unanswered: true, evaluation_comment: 'Unanswered' };
        }

        const target = parseFloat(answerKey.target_value !== undefined ? answerKey.target_value : (answerKey.value || 0));
        const tolerance = parseFloat(answerKey.tolerance !== undefined ? answerKey.tolerance : 0);

        const diff = Math.abs(numberVal - target);
        if (diff <= tolerance) {
          return { score_awarded: marks, is_correct: true, evaluation_comment: 'Numerical value within accepted tolerance.' };
        } else {
          return { score_awarded: -negativePenalty, is_correct: false, evaluation_comment: `Numerical answer out of range (diff: ${diff.toFixed(2)}).` };
        }
      }

      case 'matching': {
        const submittedPairs = responseData.pairs || {};
        const correctPairs = answerKey.pairs || {};
        const totalPairs = Object.keys(correctPairs).length;

        if (Object.keys(submittedPairs).length === 0) {
          return { score_awarded: 0, is_correct: null, is_unanswered: true, evaluation_comment: 'Unanswered' };
        }

        let matchCount = 0;
        for (const [leftKey, expectedRight] of Object.entries(correctPairs)) {
          if (submittedPairs[leftKey] && submittedPairs[leftKey] === expectedRight) {
            matchCount++;
          }
        }

        if (matchCount === totalPairs && totalPairs > 0) {
          return { score_awarded: marks, is_correct: true, evaluation_comment: 'All pairs correctly matched.' };
        } else if (matchCount > 0 && totalPairs > 0) {
          const partialScore = parseFloat(((matchCount / totalPairs) * marks).toFixed(2));
          return {
            score_awarded: partialScore,
            is_correct: false,
            evaluation_comment: `Partial matches (${matchCount}/${totalPairs}).`
          };
        } else {
          return { score_awarded: -negativePenalty, is_correct: false, evaluation_comment: 'No correct pairs matched.' };
        }
      }

      case 'long_answer':
      case 'subjective': {
        const text = (responseData.text || responseData.response_text || responseData.text_response || '').trim();
        if (!text) {
          return { score_awarded: 0, is_correct: null, is_unanswered: true, evaluation_comment: 'Unanswered' };
        }
        return {
          score_awarded: 0,
          is_correct: null,
          is_pending_review: true,
          evaluation_comment: 'Submitted. Pending teacher evaluation.'
        };
      }

      case 'coding': {
        const code = (responseData.code || responseData.text || '').trim();
        if (!code) {
          return { score_awarded: 0, is_correct: null, is_unanswered: true, evaluation_comment: 'Unanswered' };
        }

        // If execution results are present, preserve for teacher review while requiring manual grading
        if (responseData.test_cases_passed !== undefined && responseData.total_test_cases) {
          return {
            score_awarded: 0,
            is_correct: null,
            is_pending_review: true,
            evaluation_comment: `${responseData.test_cases_passed}/${responseData.total_test_cases} test cases passed. Pending teacher evaluation.`
          };
        }

        return {
          score_awarded: 0,
          is_correct: null,
          is_pending_review: true,
          evaluation_comment: 'Code submitted. Pending teacher evaluation.'
        };
      }

      default:
        return { score_awarded: 0, is_correct: null, evaluation_comment: 'Unknown question type' };
    }
  },

  /**
   * Evaluates all candidate responses against test questions.
   */
  evaluateAttempt(test, questions, responsesMap) {
    let totalScore = 0;
    let maxScore = 0;
    let correctCount = 0;
    let incorrectCount = 0;
    let unansweredCount = 0;
    let pendingReviewCount = 0;

    const evaluatedResponses = [];

    for (const q of questions) {
      const qMarks = parseFloat(q.marks || 0);
      maxScore += qMarks;

      const rawResponse = responsesMap[q.id];
      const evalResult = this.evaluateQuestionResponse(q, rawResponse?.response_data, test.negative_marking);

      if (evalResult.is_unanswered) {
        unansweredCount++;
      } else if (evalResult.is_pending_review) {
        pendingReviewCount++;
      } else if (evalResult.is_correct) {
        correctCount++;
        totalScore += evalResult.score_awarded;
      } else {
        incorrectCount++;
        totalScore += evalResult.score_awarded;
      }

      evaluatedResponses.push({
        question_id: q.id,
        response_data: rawResponse?.response_data || null,
        is_marked_for_review: Boolean(rawResponse?.is_marked_for_review),
        is_visited: Boolean(rawResponse?.is_visited ?? true),
        score_awarded: evalResult.score_awarded,
        is_correct: evalResult.is_correct,
        evaluation_comment: evalResult.evaluation_comment,
        is_pending_review: Boolean(evalResult.is_pending_review)
      });
    }

    // Floor score at 0 if test does not allow negative final total
    const finalTotalScore = Math.max(0, parseFloat(totalScore.toFixed(2)));
    const percentage = maxScore > 0 ? parseFloat(((finalTotalScore / maxScore) * 100).toFixed(2)) : 0;
    const passed = percentage >= parseFloat(test.pass_percentage || 40);

    return {
      total_score: finalTotalScore,
      max_score: parseFloat(maxScore.toFixed(2)),
      percentage,
      passed,
      correct_count: correctCount,
      incorrect_count: incorrectCount,
      unanswered_count: unansweredCount,
      pending_review_count: pendingReviewCount,
      evaluated_responses: evaluatedResponses
    };
  }
};
