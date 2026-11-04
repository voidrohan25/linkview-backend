import { quizRepository } from '../repositories/quizRepository.js';
import { codeExecutionService } from './codeExecutionService.js';

export const quizService = {
  async submitAttempt({ userId, quizId, answers }) {
    const questions = await quizRepository.getQuizQuestionsInternal(quizId);
    if (!questions || questions.length === 0) {
      const err = new Error('Quiz not found or contains no questions.');
      err.statusCode = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    // Build map of user submitted answers by question_id
    const userAnswersMap = new Map();
    answers.forEach(a => {
      userAnswersMap.set(a.question_id, a);
    });

    let totalScore = 0;
    let maxTotalMarks = 0;
    const totalQuestions = questions.length;
    const detailedResults = [];
    let pendingEvaluationCount = 0;

    for (const q of questions) {
      const qType = String(q.question_type || 'mcq_single').toLowerCase().trim();
      const qMarks = parseFloat(q.marks || 1.0);
      maxTotalMarks += qMarks;

      const userAns = userAnswersMap.get(q.id) || {};
      const selectedIndex = userAns.selected_option_index !== undefined ? userAns.selected_option_index : -1;
      const rawText = userAns.response_text || userAns.text || userAns.code || '';

      let isCorrect = false;
      let scoreAwarded = 0;
      let isPendingReview = false;
      let evalComment = '';
      let execResults = null;

      if (qType === 'long_answer' || qType === 'subjective') {
        const text = String(rawText || '').trim();
        if (text) {
          isPendingReview = true;
          isCorrect = null;
          scoreAwarded = 0;
          evalComment = 'Submitted. Pending teacher evaluation.';
          pendingEvaluationCount++;
        } else {
          isPendingReview = false;
          isCorrect = null;
          scoreAwarded = 0;
          evalComment = 'Unanswered';
        }
      } else if (qType === 'coding') {
        const code = String(rawText || '').trim();
        if (code) {
          let testCases = [];
          try {
            testCases = typeof q.test_cases === 'string' ? JSON.parse(q.test_cases) : (q.test_cases || []);
          } catch { testCases = []; }

          if (testCases.length > 0) {
            const execRes = await codeExecutionService.executeCode({
              code,
              testCases,
              timeLimitSeconds: parseFloat(q.time_limit || 2.0),
              memoryLimitMb: parseInt(q.memory_limit || 128, 10)
            });

            isCorrect = Boolean(execRes.passed);
            const passedRatio = execRes.total_test_cases > 0 ? (execRes.test_cases_passed / execRes.total_test_cases) : 0;
            scoreAwarded = parseFloat((passedRatio * qMarks).toFixed(2));
            evalComment = `${execRes.test_cases_passed}/${execRes.total_test_cases} test cases passed.`;
            execResults = codeExecutionService.sanitizeResultsForCandidate(execRes);
          } else {
            // No test cases defined, award marks if code submitted
            scoreAwarded = qMarks;
            isCorrect = true;
            evalComment = 'Code submitted successfully.';
          }
        } else {
          scoreAwarded = 0;
          isCorrect = null;
          evalComment = 'Unanswered';
        }
        totalScore += scoreAwarded;
      } else if (qType === 'true_false') {
        isCorrect = selectedIndex === q.correct_option_index;
        if (isCorrect) {
          scoreAwarded = qMarks;
          totalScore += scoreAwarded;
        }
        evalComment = isCorrect ? 'Correct answer.' : 'Incorrect answer.';
      } else {
        // Standard mcq_single
        isCorrect = selectedIndex === q.correct_option_index;
        if (isCorrect) {
          scoreAwarded = qMarks;
          totalScore += scoreAwarded;
        }
        evalComment = isCorrect ? 'Correct option selected.' : 'Incorrect option selected.';
      }

      detailedResults.push({
        question_id: q.id,
        question_text: q.question_text,
        options: typeof q.options === 'string' ? JSON.parse(q.options) : (q.options || []),
        selected_option_index: selectedIndex,
        correct_option_index: q.correct_option_index,
        is_correct: isCorrect,
        explanation: q.explanation,
        question_type: qType,
        marks: qMarks,
        score_awarded: scoreAwarded,
        is_pending_review: isPendingReview,
        evaluation_comment: evalComment,
        response_text: rawText,
        execution_results: execResults
      });
    }

    const roundedScore = parseFloat(totalScore.toFixed(2));
    const percentage = maxTotalMarks > 0 ? Math.round((roundedScore / maxTotalMarks) * 100) : 0;
    const passed = percentage >= 60;

    // Persist to database atomically
    const attemptId = await quizRepository.saveAttemptAndAnswers({
      userId,
      quizId,
      score: Math.round(roundedScore),
      totalQuestions,
      results: detailedResults
    });

    return {
      attempt_id: attemptId,
      quiz_id: quizId,
      score: roundedScore,
      max_score: maxTotalMarks,
      total_questions: totalQuestions,
      percentage,
      passed,
      pending_evaluation_count: pendingEvaluationCount,
      submitted_at: new Date().toISOString(),
      results: detailedResults
    };
  }
};
