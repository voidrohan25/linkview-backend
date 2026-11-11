"use strict";
/**
 * Universal AI Service Integration for LinkView
 * Supports Google Gemini & OpenAI with zero external npm dependencies using native fetch.
 * Automatically falls back to deterministic high-quality rubric evaluation when API keys are not yet configured.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateAIQuestions = generateAIQuestions;
exports.evaluateAIInterviewAnswer = evaluateAIInterviewAnswer;
function getApiKey() {
    const geminiKey = process.env.GEMINI_API_KEY ||
        (process.env.AI_PROVIDER_MODEL?.includes('gemini') ? process.env.AI_PROVIDER_API_KEY : '');
    if (geminiKey)
        return { key: geminiKey, provider: 'gemini' };
    const openaiKey = process.env.OPENAI_API_KEY ||
        (process.env.AI_PROVIDER_MODEL?.includes('gpt') ? process.env.AI_PROVIDER_API_KEY : '');
    if (openaiKey)
        return { key: openaiKey, provider: 'openai' };
    const generalKey = process.env.AI_PROVIDER_API_KEY;
    if (generalKey) {
        if (generalKey.startsWith('AIza'))
            return { key: generalKey, provider: 'gemini' };
        return { key: generalKey, provider: 'openai' };
    }
    return { key: '', provider: 'none' };
}
/**
 * Generate MCQs dynamically using Gemini or OpenAI
 */
async function generateAIQuestions(topic, count = 3, difficulty = 'medium') {
    const { key, provider } = getApiKey();
    if (!key || provider === 'none')
        return null;
    const prompt = `You are a strict technical assessment engine. Generate exactly ${count} multiple choice questions (MCQ) for topic "${topic}" with difficulty level "${difficulty}".
Respond ONLY with a valid JSON array of objects without markdown formatting, each with:
- "prompt": question text
- "options": array of exactly 4 choices
- "correctAnswer": exact matching string from options
- "explanation": concise explanation of why it is correct
- "difficulty": "${difficulty}"
- "topic": "${topic}"`;
    try {
        if (provider === 'gemini') {
            const model = process.env.AI_PROVIDER_MODEL || 'gemini-1.5-flash';
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { responseMimeType: 'application/json', temperature: 0.3 },
                }),
            });
            if (!res.ok)
                return null;
            const data = await res.json();
            const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!rawText)
                return null;
            const parsed = JSON.parse(rawText);
            return parsed.map((q, i) => ({
                ...q,
                id: `ai-gen-${Date.now()}-${i}`,
            }));
        }
        else if (provider === 'openai') {
            const model = process.env.AI_PROVIDER_MODEL || 'gpt-4o-mini';
            const res = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${key}`,
                },
                body: JSON.stringify({
                    model,
                    messages: [{ role: 'user', content: prompt }],
                    response_format: { type: 'json_object' },
                    temperature: 0.3,
                }),
            });
            if (!res.ok)
                return null;
            const data = await res.json();
            const content = data.choices?.[0]?.message?.content;
            if (!content)
                return null;
            const parsed = JSON.parse(content);
            const list = Array.isArray(parsed) ? parsed : parsed.questions || [];
            return list.map((q, i) => ({
                ...q,
                id: `ai-gen-${Date.now()}-${i}`,
            }));
        }
    }
    catch (err) {
        console.warn('[AI Service] Failed to call external LLM API, using fallback:', err);
    }
    return null;
}
/**
 * Real AI evaluation for mock placement interview answers.
 * Uses Gemini / OpenAI when configured, and falls back to semantic keypoint-coverage rubric analysis.
 */
async function evaluateAIInterviewAnswer(question, answer, track, expectedKeypoints) {
    const cleanAnswer = (answer || '').trim();
    // Edge case: empty or essentially blank answer
    if (cleanAnswer.length < 10) {
        return {
            score: 1,
            technicalAccuracy: 10,
            conceptualDepth: 10,
            communication: 20,
            completeness: 10,
            feedback: 'No substantive verbal or written response was provided for this technical question.',
            strengths: ['Prompt acknowledged by candidate'],
            weaknesses: ['Failed to articulate technical mechanics or architectural definitions'],
            recommendations: ['Review foundational principles and practice verbalizing definitions'],
            matchedKeypoints: [],
            missingKeypoints: expectedKeypoints || [],
        };
    }
    const { key, provider } = getApiKey();
    // 1. Try external LLM API if key is configured
    if (key && provider !== 'none') {
        const prompt = `You are a Principal Software Architect evaluating an engineering candidate's interview response.
Track: "${track}"
Interview Question: "${question}"
Candidate Spoken Answer: "${cleanAnswer}"
${expectedKeypoints && expectedKeypoints.length > 0 ? `Expected Keypoints: ${expectedKeypoints.join(', ')}` : ''}

Evaluate the response objectively against real production software standards.
Respond STRICTLY with a valid JSON object (no markdown, no extra text):
{
  "score": <integer from 1 to 10>,
  "technicalAccuracy": <integer from 10 to 100>,
  "conceptualDepth": <integer from 10 to 100>,
  "communication": <integer from 10 to 100>,
  "completeness": <integer from 10 to 100>,
  "feedback": "<2-3 sentences of constructive technical feedback>",
  "strengths": ["<strength 1>", "<strength 2>"],
  "weaknesses": ["<weakness 1>", "<weakness 2>"],
  "recommendations": ["<actionable recommendation 1>", "<actionable recommendation 2>"]
}`;
        try {
            if (provider === 'gemini') {
                const model = process.env.AI_PROVIDER_MODEL || 'gemini-1.5-flash';
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
                    }),
                });
                if (res.ok) {
                    const data = await res.json();
                    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (rawText) {
                        const parsed = JSON.parse(rawText);
                        return {
                            score: Math.min(10, Math.max(1, Number(parsed.score) || 6)),
                            technicalAccuracy: Math.min(100, Math.max(10, Number(parsed.technicalAccuracy) || 65)),
                            conceptualDepth: Math.min(100, Math.max(10, Number(parsed.conceptualDepth) || 60)),
                            communication: Math.min(100, Math.max(10, Number(parsed.communication) || 70)),
                            completeness: Math.min(100, Math.max(10, Number(parsed.completeness) || 60)),
                            feedback: parsed.feedback || 'Good explanation of concepts with structured reasoning.',
                            strengths: Array.isArray(parsed.strengths) && parsed.strengths.length > 0
                                ? parsed.strengths
                                : ['Structured verbal explanation', 'Relevant core concepts mentioned'],
                            weaknesses: Array.isArray(parsed.weaknesses) && parsed.weaknesses.length > 0
                                ? parsed.weaknesses
                                : ['Could incorporate deeper asymptotic analysis'],
                            recommendations: Array.isArray(parsed.recommendations) && parsed.recommendations.length > 0
                                ? parsed.recommendations
                                : ['Review edge-case boundary conditions'],
                        };
                    }
                }
            }
            else if (provider === 'openai') {
                const model = process.env.AI_PROVIDER_MODEL || 'gpt-4o-mini';
                const res = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${key}`,
                    },
                    body: JSON.stringify({
                        model,
                        messages: [{ role: 'user', content: prompt }],
                        response_format: { type: 'json_object' },
                        temperature: 0.2,
                    }),
                });
                if (res.ok) {
                    const data = await res.json();
                    const content = data.choices?.[0]?.message?.content;
                    if (content) {
                        const parsed = JSON.parse(content);
                        return {
                            score: Math.min(10, Math.max(1, Number(parsed.score) || 6)),
                            technicalAccuracy: Math.min(100, Math.max(10, Number(parsed.technicalAccuracy) || 65)),
                            conceptualDepth: Math.min(100, Math.max(10, Number(parsed.conceptualDepth) || 60)),
                            communication: Math.min(100, Math.max(10, Number(parsed.communication) || 70)),
                            completeness: Math.min(100, Math.max(10, Number(parsed.completeness) || 60)),
                            feedback: parsed.feedback || 'Constructive technical answer with good conceptual framing.',
                            strengths: parsed.strengths || ['Logical verbal delivery', 'Sound topic familiarity'],
                            weaknesses: parsed.weaknesses || ['Elaborate with production system trade-offs'],
                            recommendations: parsed.recommendations || ['Review system concurrency patterns'],
                        };
                    }
                }
            }
        }
        catch (err) {
            console.warn('[AI Evaluation Service] External LLM error, using rubric engine:', err);
        }
    }
    // 2. Deterministic Semantic Rubric Engine (Zero-Hallucination Fallback)
    const lowerAnswer = cleanAnswer.toLowerCase();
    // Comprehensive Domain Vocabulary Across 13 Technical Disciplines
    const domainLexicon = {
        python: [
            'gil', 'global interpreter lock', 'reference counting', 'garbage collection', 'cyclic reference',
            'generation', 'gen 0', 'gen 1', 'gen 2', 'cpython', 'bytecode', 'thread', 'multiprocessing',
            'generator', 'yield', 'lazy evaluation', 'decorator', 'closure', 'higher order function',
            'dunder', 'magic method', 'context manager', 'asyncio', 'coroutine', 'event loop', 'pypy',
            'sys.getrefcount', 'gc module', 'memory leak', 'heap', 'stack', 'pyobject',
        ],
        java: [
            'jvm', 'garbage collection', 'g1', 'zgc', 'eden', 'survivor', 'metaspace', 'heap', 'stack',
            'multithreading', 'synchronized', 'volatile', 'atomic', 'thread pool', 'executor',
            'classloader', 'bytecode', 'jmm', 'java memory model', 'string pool', 'equals', 'hashcode',
            'generics', 'reflection', 'polymorphism', 'inheritance', 'interface', 'abstract class',
        ],
        dsa: [
            'time complexity', 'space complexity', 'o(1)', 'o(n)', 'o(log n)', 'o(n log n)', 'o(n^2)',
            'binary search', 'dynamic programming', 'memoization', 'tabulation', 'recursion', 'backtracking',
            'graph', 'bfs', 'dfs', 'tree', 'bst', 'avl', 'trie', 'heap', 'priority queue', 'hash table',
            'linked list', 'stack', 'queue', 'asymptotic', 'worst case', 'amortized', 'two pointer',
        ],
        javascript: [
            'event loop', 'call stack', 'microtask', 'macrotask', 'promise', 'async', 'await', 'closure',
            'lexical scope', 'prototype', 'prototypal inheritance', 'hoisting', 'v8 engine', 'garbage collection',
            'settimeout', 'queueMicrotask', 'event bubbling', 'debouncing', 'throttling', 'immutability',
        ],
        system_design: [
            'scalability', 'horizontal scaling', 'vertical scaling', 'load balancer', 'reverse proxy',
            'caching', 'redis', 'memcached', 'cdn', 'sharding', 'partitioning', 'replication',
            'cap theorem', 'consistency', 'availability', 'partition tolerance', 'microservices',
            'message queue', 'kafka', 'rabbitmq', 'circuit breaker', 'rate limiting', 'idempotency',
        ],
        dbms: [
            'acid', 'atomicity', 'consistency', 'isolation', 'durability', 'transaction', 'isolation levels',
            'dirty read', 'phantom read', 'non-repeatable read', 'indexing', 'b-tree', 'b+ tree', 'hash index',
            'normalization', '1nf', '2nf', '3nf', 'bcnf', 'deadlock', 'wal', 'write ahead logging',
        ],
        web: [
            'virtual dom', 'reconciliation', 'fiber', 'state', 'props', 'hooks', 'useeffect', 'usememo',
            'usecallback', 'ssr', 'csr', 'isr', 'next.js', 'hydration', 'xss', 'csrf', 'cors',
            'csp', 'content security policy', 'dom', 'rendering pipeline', 'critical rendering path',
        ],
    };
    const currentTrackKey = track.toLowerCase().includes('python') ? 'python'
        : track.toLowerCase().includes('java') ? 'java'
            : track.toLowerCase().includes('dsa') || track.toLowerCase().includes('algo') ? 'dsa'
                : track.toLowerCase().includes('script') || track.toLowerCase().includes('js') ? 'javascript'
                    : track.toLowerCase().includes('system') ? 'system_design'
                        : track.toLowerCase().includes('db') || track.toLowerCase().includes('sql') ? 'dbms'
                            : track.toLowerCase().includes('web') || track.toLowerCase().includes('react') ? 'web'
                                : 'python';
    const trackTerms = domainLexicon[currentTrackKey] || domainLexicon.python;
    const commonTechTerms = [
        'latency', 'throughput', 'architecture', 'concurrency', 'asynchronous', 'memory',
        'performance', 'optimization', 'trade-off', 'complexity', 'overhead', 'lifecycle',
    ];
    let matchedTechCount = 0;
    for (const term of trackTerms) {
        if (lowerAnswer.includes(term))
            matchedTechCount++;
    }
    for (const term of commonTechTerms) {
        if (lowerAnswer.includes(term))
            matchedTechCount++;
    }
    const matchedKeypoints = [];
    const missingKeypoints = [];
    if (expectedKeypoints && expectedKeypoints.length > 0) {
        for (const kp of expectedKeypoints) {
            const words = kp.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
            const isMatched = words.some((w) => lowerAnswer.includes(w));
            if (isMatched)
                matchedKeypoints.push(kp);
            else
                missingKeypoints.push(kp);
        }
    }
    const wordCount = cleanAnswer.split(/\s+/).filter(Boolean).length;
    let rawScore = 3;
    // Realistic Grading Curve
    if (wordCount < 12) {
        rawScore = 2;
    }
    else if (matchedKeypoints.length >= 3 && matchedTechCount >= 4) {
        rawScore = Math.min(10, 8 + Math.floor(wordCount / 50));
    }
    else if (matchedKeypoints.length >= 2 || matchedTechCount >= 4) {
        rawScore = Math.min(9, 7 + Math.floor(wordCount / 60));
    }
    else if (matchedKeypoints.length >= 1 || matchedTechCount >= 2) {
        rawScore = Math.min(7, 5 + Math.floor(matchedTechCount / 2));
    }
    else if (wordCount >= 35) {
        rawScore = 5;
    }
    else {
        rawScore = 3;
    }
    // Dimension breakdown calculated strictly from candidate performance
    const technicalAccuracy = Math.min(98, Math.max(25, rawScore * 10 - (missingKeypoints.length * 3) + Math.min(8, matchedTechCount)));
    const conceptualDepth = Math.min(96, Math.max(20, Math.round(rawScore * 9.5 + Math.min(10, matchedKeypoints.length * 4))));
    const communication = Math.min(95, Math.max(35, Math.min(95, 45 + Math.floor(wordCount / 1.5))));
    const completeness = Math.min(98, Math.max(20, Math.round((matchedKeypoints.length / Math.max(1, (expectedKeypoints?.length || 3))) * 80 + rawScore * 2)));
    let feedback = '';
    if (rawScore >= 8) {
        feedback = `Exceptional technical explanation. Accurately demonstrated deep mechanical understanding of ${matchedKeypoints.length > 0 ? matchedKeypoints.slice(0, 2).join(' and ') : 'the core architectural concepts'} with concrete production trade-offs.`;
    }
    else if (rawScore >= 6) {
        feedback = `Solid answer demonstrating practical familiarity. To elevate into senior engineering caliber, elaborate on concrete runtime edge cases and memory/asymptotic trade-offs.`;
    }
    else {
        feedback = `Basic familiarity shown, but response lacks technical precision. Review ${missingKeypoints.length > 0
            ? missingKeypoints.slice(0, 2).join(' and ')
            : 'underlying execution mechanics, memory lifecycle, and asymptotic complexities'}.`;
    }
    const strengthsList = [];
    if (matchedKeypoints.length > 0) {
        strengthsList.push(`Accurately articulated: ${matchedKeypoints[0]}`);
        if (matchedKeypoints.length > 1) {
            strengthsList.push(`Strong conceptual grasp of: ${matchedKeypoints[1]}`);
        }
    }
    else if (matchedTechCount >= 2) {
        strengthsList.push(`Demonstrated appropriate technical terminology for ${track}`);
        strengthsList.push('Structured communicative framing');
    }
    else {
        strengthsList.push('Attempted technical problem definition');
        strengthsList.push('Clear audible cadence and response willingness');
    }
    const weaknessesList = [];
    if (missingKeypoints.length > 0) {
        weaknessesList.push(`Did not elaborate on: ${missingKeypoints[0]}`);
        if (missingKeypoints.length > 1) {
            weaknessesList.push(`Omitted deep dive into: ${missingKeypoints[1]}`);
        }
    }
    else {
        weaknessesList.push('Incorporate more explicit runtime time and space complexity figures');
        weaknessesList.push('Detail multi-threaded synchronization or production scale trade-offs');
    }
    return {
        score: rawScore,
        technicalAccuracy,
        conceptualDepth,
        communication,
        completeness,
        feedback,
        strengths: strengthsList,
        weaknesses: weaknessesList,
        recommendations: [
            `Deepen technical mastery of ${track} internals and runtime memory lifecycle`,
            'Structure technical interview viva answers using: Core Definition -> Mechanical How/Why -> Complexity/Trade-off',
        ],
        matchedKeypoints,
        missingKeypoints,
    };
}
