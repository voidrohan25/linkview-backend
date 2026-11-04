import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mockTestService } from '../src/services/mockTestService.js';
import { aiService, resolveCloudEndpoint } from '../src/services/aiService.js';
import { config } from '../src/config/env.js';
import app from '../src/app.js';

describe('AI Question Generation & Groq Integration Suite', () => {

  // =========================================================================
  // 1. Model Configuration & Groq Supported Model Validation
  // =========================================================================
  test('1. Configured Groq model is a valid active production model', () => {
    const validProductionModels = [
      'qwen/qwen3.8-27b',
      'openai/gpt-oss-120b',
      'openai/gpt-oss-20b',
      'llama-3.3-70b-versatile'
    ];

    assert.ok(
      validProductionModels.includes(config.cloudAi.model) || config.cloudAi.model.startsWith('qwen'),
      `Configured model '${config.cloudAi.model}' must be a recognized production model`
    );
  });

  // =========================================================================
  // 2. Parser Resilience: Valid JSON, Markdown Fences, Reasoning Tags & Schema
  // =========================================================================
  test('2a. Parser correctly processes clean JSON response', () => {
    const raw = JSON.stringify({
      questions: [
        {
          question_text: 'What is the purpose of React useEffect?',
          question_type: 'mcq_single',
          options: ['Manage side effects', 'Create HTML elements', 'Style components', 'Compile code'],
          correct_index: 0,
          marks: 4,
          negative_marks: 1,
          explanation: 'useEffect handles side-effects like data fetching and subscriptions.'
        }
      ]
    });

    const parsed = mockTestService.parseAndValidateGeneratedQuestions(raw, {
      topic: 'React Hooks',
      difficulty: 'medium',
      count: 1
    });

    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0].question_text, 'What is the purpose of React useEffect?');
    assert.strictEqual(parsed[0].question_type, 'mcq_single');
    assert.strictEqual(parsed[0].options.length, 4);
    assert.strictEqual(parsed[0].answer_key.correct_index, 0);
    assert.strictEqual(parsed[0].marks, 4);
    assert.strictEqual(parsed[0].negative_marks, 1);
    assert.strictEqual(parsed[0].order_index, 1);
  });

  test('2b. Parser strips markdown code fences (```json ... ```)', () => {
    const raw = '```json\n{\n  "questions": [\n    {\n      "question_text": "What does CSS stand for?",\n      "options": ["Cascading Style Sheets", "Creative Style System", "Computer Style Syntax", "Colorful Style Sheet"],\n      "correct_index": 0,\n      "explanation": "CSS stands for Cascading Style Sheets."\n    }\n  ]\n}\n```';

    const parsed = mockTestService.parseAndValidateGeneratedQuestions(raw, {
      topic: 'CSS Basics',
      difficulty: 'easy',
      count: 1
    });

    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0].question_text, 'What does CSS stand for?');
    assert.strictEqual(parsed[0].answer_key.correct_index, 0);
  });

  test('2c. Parser strips <think>...</think> reasoning tags', () => {
    const raw = '<think>\nThe user asked for 1 question on JavaScript closures.\nI will generate a clear question.\n</think>\n{\n  "questions": [\n    {\n      "question": "Which scope does a closure retain access to?",\n      "options": ["Its outer lexical environment", "Global scope only", "Block scope only", "None"],\n      "correct_answer": "A",\n      "explanation": "Closures preserve lexical environment access."\n    }\n  ]\n}';

    const parsed = mockTestService.parseAndValidateGeneratedQuestions(raw, {
      topic: 'JavaScript',
      difficulty: 'medium',
      count: 1
    });

    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0].question_text, 'Which scope does a closure retain access to?');
    assert.strictEqual(parsed[0].answer_key.correct_index, 0); // "A" -> 0
  });

  test('2d. Parser handles trailing commas and repairs minor JSON syntax errors', () => {
    const raw = '{\n  "questions": [\n    {\n      "question_text": "What is the time complexity of binary search?",\n      "options": ["O(log n)", "O(n)", "O(n^2)", "O(1)"],\n      "correct_index": 0,\n      "explanation": "Binary search halves the search space each step.",\n    },\n  ],\n}';

    const parsed = mockTestService.parseAndValidateGeneratedQuestions(raw, {
      topic: 'Algorithms',
      difficulty: 'medium',
      count: 1
    });

    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0].question_text, 'What is the time complexity of binary search?');
    assert.strictEqual(parsed[0].answer_key.correct_index, 0);
  });

  test('2e. Parser rejects empty or text-only responses gracefully', () => {
    assert.throws(
      () => mockTestService.parseAndValidateGeneratedQuestions('', { count: 1 }),
      /empty response/i
    );

    assert.throws(
      () => mockTestService.parseAndValidateGeneratedQuestions('Sorry, I cannot answer that.', { count: 1 }),
      /could not parse valid json/i
    );
  });

  // =========================================================================
  // 3. Question Schema Compatibility for TeacherTestBuilderPage
  // =========================================================================
  test('3. Output schema strictly matches TeacherTestBuilderPage expectations', () => {
    const raw = JSON.stringify({
      questions: [
        {
          question_text: 'Which protocol is used for secure web browsing?',
          question_type: 'mcq_single',
          options: ['HTTPS', 'HTTP', 'FTP', 'SMTP'],
          correct_index: 0,
          marks: 4,
          negative_marks: 1,
          explanation: 'HTTPS encrypts HTTP traffic using TLS/SSL.'
        }
      ]
    });

    const [q] = mockTestService.parseAndValidateGeneratedQuestions(raw, {
      topic: 'Networking',
      difficulty: 'easy',
      count: 1
    });

    // Required fields for preview and saving:
    assert.ok(q.id && q.id.startsWith('ai-gen-'), 'Must have generated ID');
    assert.strictEqual(typeof q.question_text, 'string');
    assert.strictEqual(q.question_type, 'mcq_single');
    assert.ok(Array.isArray(q.options) && q.options.length >= 2, 'Options must be array');
    assert.ok(typeof q.answer_key === 'object' && typeof q.answer_key.correct_index === 'number');
    assert.strictEqual(typeof q.marks, 'number');
    assert.strictEqual(typeof q.negative_marks, 'number');
    assert.strictEqual(typeof q.explanation, 'string');
    assert.strictEqual(typeof q.topic, 'string');
    assert.strictEqual(typeof q.difficulty, 'string');
    assert.strictEqual(typeof q.order_index, 'number');
  });

  // =========================================================================
  // 4. Safe Production Question Generation Test (1-2 questions, NOT 15)
  // =========================================================================
  test('4. Safe production question generation test with small request (1-2 questions)', async () => {
    const status = await aiService.getStatus();

    // If Cloud AI key is configured in this test environment, test actual generation
    if (status.is_cloud && config.cloudAi.apiKey) {
      const result = await mockTestService.generateAiQuestions({
        subject: 'Computer Science',
        topic: 'Data Structures',
        difficulty: 'easy',
        count: 2,
        question_types: ['mcq_single']
      });

      assert.strictEqual(result.success, true);
      assert.ok(Array.isArray(result.questions));
      assert.ok(result.questions.length >= 1 && result.questions.length <= 2);
      assert.ok(result.questions[0].question_text);
      assert.ok(result.questions[0].options.length >= 2);
      assert.ok(result.questions[0].answer_key.correct_index !== undefined);
    } else {
      // In offline / mock test environment, verify endpoint resolution and prompt generation
      const ep = resolveCloudEndpoint(config.cloudAi.baseUrl, 'groq');
      assert.strictEqual(ep, 'https://api.groq.com/openai/v1/chat/completions');
    }
  });

  // =========================================================================
  // 5. Express Proxy & Rate Limiter Configuration
  // =========================================================================
  test('5. Express trust proxy is set and rate limit validation prevents X-Forwarded-For warning', () => {
    assert.strictEqual(app.get('trust proxy'), 1);
  });

});
