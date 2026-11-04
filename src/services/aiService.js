import os from 'os';
import { config } from '../config/env.js';
import { aiRepository } from '../repositories/aiRepository.js';
import crypto from 'crypto';

export const SYSTEM_PROMPT = `You are LinkTest AI Tutor, an intelligent, patient, and highly engaging educational mentor designed for Indian college students, competitive exam aspirants, and technology learners.

Core Responsibilities:
1. Explain technical, scientific, and mathematical concepts in simple, intuitive terms.
2. Provide step-by-step breakdowns, relatable real-world analogies, and clean code examples where appropriate.
3. Act as a Socratic tutor: Never provide direct, copy-paste homework solutions outright; instead guide the student with conceptual hints, questions, and step-by-step reasoning to build their own understanding.
4. When asked for practice questions, format clear multiple-choice questions with options and explanations.
5. If you do not know an answer or if a query is ambiguous, honestly admit uncertainty and ask clarifying questions.
6. Always maintain a professional, motivating, and educational tone.`;

/**
 * Safely resolves the OpenAI-compatible chat completions endpoint.
 * Prevents malformed paths such as duplicate /openai/v1 or /chat/completions.
 */
export function resolveCloudEndpoint(rawBaseUrl, provider = '') {
  const p = (provider || '').trim().toLowerCase();
  let base = (rawBaseUrl || '').trim();

  if (!base) {
    if (p === 'openai') return 'https://api.openai.com/v1/chat/completions';
    return 'https://api.groq.com/openai/v1/chat/completions';
  }

  // Strip trailing slashes
  base = base.replace(/\/+$/, '');

  // If already ends in /chat/completions, return as-is
  if (base.endsWith('/chat/completions')) {
    return base;
  }

  // If user entered only domain for groq (e.g. https://api.groq.com)
  if (base === 'https://api.groq.com' || (p === 'groq' && !base.includes('/openai/v1'))) {
    return `${base}/openai/v1/chat/completions`;
  }

  return `${base}/chat/completions`;
}

export const aiService = {
  /**
   * Diagnostic check for AI availability
   */
  async getStatus() {
    const baseUrl = config.ollama.baseUrl.replace(/\/+$/, '');
    const targetModel = config.ollama.model;

    const totalMemGb = parseFloat((os.totalmem() / (1024 ** 3)).toFixed(2));
    const freeMemGb = parseFloat((os.freemem() / (1024 ** 3)).toFixed(2));
    const memoryDiagnostic = {
      total_ram_gb: totalMemGb,
      free_ram_gb: freeMemGb,
      ram_sufficient_for_local_llm: totalMemGb >= 8.0
    };

    const onboardingInstructions = [
      '1. Download and install Ollama from https://ollama.com',
      "2. Start the local daemon in your terminal: 'ollama serve'",
      `3. Pull the recommended educational model: 'ollama pull ${targetModel}'`,
      '4. Alternatively, configure CLOUD_AI_API_KEY in your environment for cloud-hosted inference.'
    ];

    // Check Cloud AI provider first if configured
    if (config.cloudAi.apiKey) {
      const endpoint = resolveCloudEndpoint(config.cloudAi.baseUrl, config.cloudAi.provider);
      let supportedModels = [];
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);
        const modelsRes = await fetch('https://api.groq.com/openai/v1/models', {
          headers: { 'Authorization': `Bearer ${config.cloudAi.apiKey}` },
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (modelsRes.ok) {
          const modelsData = await modelsRes.json();
          supportedModels = (modelsData.data || []).map(m => m.id);
        }
      } catch {
        // ignore diagnostic failure
      }

      return {
        available: true,
        provider: config.cloudAi.provider || 'groq',
        model: config.cloudAi.model,
        supported_models: supportedModels.length > 0 ? supportedModels : ['qwen/qwen3.8-27b', 'openai/gpt-oss-20b'],
        endpoint,
        is_cloud: true,
        system_memory: memoryDiagnostic,
        status_message: `Cloud AI provider (${config.cloudAi.provider || 'groq'}) is configured with model ${config.cloudAi.model}.`
      };
    }

    // Check if Cloud AI was requested but API key is missing
    if (config.cloudAi.provider && !config.cloudAi.apiKey) {
      const endpoint = resolveCloudEndpoint(config.cloudAi.baseUrl, config.cloudAi.provider);
      return {
        available: false,
        provider: config.cloudAi.provider,
        model: config.cloudAi.model,
        endpoint,
        is_cloud: true,
        system_memory: memoryDiagnostic,
        error: 'Missing API key',
        onboarding_instructions: onboardingInstructions,
        status_message: `Cloud AI provider '${config.cloudAi.provider}' is configured, but CLOUD_AI_API_KEY is not set.`
      };
    }

    // Otherwise check local Ollama
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const response = await fetch(`${baseUrl}/api/tags`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          available: false,
          model: targetModel,
          endpoint: baseUrl,
          is_cloud: false,
          system_memory: memoryDiagnostic,
          error: `Ollama returned HTTP ${response.status}`,
          onboarding_instructions: onboardingInstructions,
          status_message: `Ollama service reachable at ${baseUrl} but responded with status ${response.status}.`
        };
      }

      const data = await response.json();
      const models = data.models || [];
      const hasModel = models.some(m => m.name === targetModel || m.name.startsWith(targetModel.split(':')[0]));

      return {
        available: true,
        model: targetModel,
        model_installed: hasModel,
        installed_models: models.map(m => m.name),
        endpoint: baseUrl,
        is_cloud: false,
        system_memory: memoryDiagnostic,
        status_message: hasModel
          ? `Ollama is active and ${targetModel} is ready for tutoring.`
          : `Ollama is active at ${baseUrl}, but model '${targetModel}' was not found in installed models. Run 'ollama pull ${targetModel}'.`
      };
    } catch (err) {
      return {
        available: false,
        model: targetModel,
        endpoint: baseUrl,
        is_cloud: false,
        system_memory: memoryDiagnostic,
        error: err.name === 'AbortError' ? 'Connection timed out' : err.message,
        onboarding_instructions: onboardingInstructions,
        status_message: `Local Ollama service is not responding at ${baseUrl}. Ensure Ollama is running ('ollama serve') or configure CLOUD_AI_API_KEY for online deployment.`
      };
    }
  },

  /**
   * Initializes and tests Ollama connectivity and model availability.
   * Optionally triggers model pull if missing.
   */
  async initOllama({ model = config.ollama.model, autoPull = false } = {}) {
    const baseUrl = config.ollama.baseUrl.replace(/\/+$/, '');
    const status = await this.getStatus();

    if (!status.available) {
      return {
        success: false,
        status: 'offline',
        endpoint: baseUrl,
        model,
        message: `Ollama is currently unreachable at ${baseUrl}. Ensure Ollama is installed and running ('ollama serve') or configure CLOUD_AI_API_KEY.`
      };
    }

    if (status.is_cloud) {
      return {
        success: true,
        status: 'cloud_ready',
        is_cloud: true,
        provider: status.provider,
        model: status.model,
        message: `Cloud AI provider is active with model '${status.model}'.`
      };
    }

    // Check if target model is installed
    const hasModel = status.installed_models?.some(m => m === model || m.startsWith(model.split(':')[0]));

    if (!hasModel && autoPull) {
      try {
        const pullRes = await fetch(`${baseUrl}/api/pull`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: model, stream: false })
        });
        if (!pullRes.ok) {
          throw new Error(`Pull returned status ${pullRes.status}`);
        }
      } catch (err) {
        return {
          success: false,
          status: 'pull_failed',
          model,
          endpoint: baseUrl,
          message: `Failed to pull model '${model}': ${err.message}. Run 'npm run ollama:init' or 'ollama pull ${model}'.`
        };
      }
    }

    // Warm-up inference test
    let warmupLatencyMs = null;
    let warmupSuccess = false;
    try {
      const start = Date.now();
      const testRes = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt: 'Ping',
          stream: false,
          keep_alive: '24h'
        })
      });
      if (testRes.ok) {
        warmupLatencyMs = Date.now() - start;
        warmupSuccess = true;
      }
    } catch (err) {
      // Warm-up is non-fatal
    }

    return {
      success: true,
      status: 'ready',
      endpoint: baseUrl,
      model,
      model_installed: hasModel || autoPull,
      warmup_success: warmupSuccess,
      latency_ms: warmupLatencyMs,
      installed_models: status.installed_models,
      message: hasModel || autoPull
        ? `Ollama is online and model '${model}' is ready (latency: ${warmupLatencyMs || 'N/A'}ms).`
        : `Ollama is reachable, but model '${model}' is not pulled yet. Run 'npm run ollama:init'.`
    };
  },

  /**
   * Interactive tutoring chat
   */
  async chat({ userId, message, conversationId }) {
    const activeConversationId = conversationId || crypto.randomUUID();

    // 1. Persist user message to DB
    await aiRepository.saveMessage({
      userId,
      conversationId: activeConversationId,
      role: 'user',
      message
    });

    // 2. Fetch past conversation context (last 8 messages for context window efficiency)
    const history = await aiRepository.getMessagesByConversation(userId, activeConversationId);
    const recentHistory = history.slice(-8);

    // 3. Check Cloud AI fallback first
    if (config.cloudAi.apiKey) {
      try {
        const cloudReply = await this._chatWithCloud({ messages: recentHistory });
        await aiRepository.saveMessage({
          userId,
          conversationId: activeConversationId,
          role: 'assistant',
          message: cloudReply
        });

        return {
          reply: cloudReply,
          conversation_id: activeConversationId,
          model: config.cloudAi.model,
          ai_available: true,
          provider: config.cloudAi.provider || 'cloud',
          created_at: new Date().toISOString()
        };
      } catch (cloudErr) {
        console.warn('[AIService] Cloud AI call failed:', cloudErr.message);
        const errMsg = `Cloud AI Tutor error: ${cloudErr.message}`;
        await aiRepository.saveMessage({
          userId,
          conversationId: activeConversationId,
          role: 'assistant',
          message: errMsg
        });

        return {
          reply: errMsg,
          conversation_id: activeConversationId,
          model: config.cloudAi.model,
          ai_available: false,
          created_at: new Date().toISOString()
        };
      }
    }

    // 4. Check local Ollama
    const status = await this.getStatus();
    if (!status.available) {
      const offlineMsg = `LinkTest AI Tutor is currently in offline mode. The backend cannot connect to Ollama at ${config.ollama.baseUrl}.

To enable AI tutoring:
1. Local Development: Install Ollama (https://ollama.com), run 'ollama serve', and pull '${config.ollama.model}'.
2. Cloud Deployment: Set CLOUD_AI_API_KEY and CLOUD_AI_MODEL in backend/.env to connect to Groq, OpenAI, or OpenRouter.`;

      await aiRepository.saveMessage({
        userId,
        conversationId: activeConversationId,
        role: 'assistant',
        message: offlineMsg
      });

      return {
        reply: offlineMsg,
        conversation_id: activeConversationId,
        model: config.ollama.model,
        ai_available: false,
        created_at: new Date().toISOString()
      };
    }

    // 5. Construct messages payload for Ollama
    const ollamaMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...recentHistory.map(m => ({ role: m.role, content: m.message }))
    ];

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), config.ollama.timeoutMs);

      const response = await fetch(`${config.ollama.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.ollama.model,
          messages: ollamaMessages,
          stream: false,
          keep_alive: '24h',
          options: {
            temperature: 0.7,
            top_p: 0.9
          }
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Ollama returned status code ${response.status}`);
      }

      const data = await response.json();
      const reply = data.message?.content || 'I processed your request, but received an empty response from the model.';

      // Persist assistant reply
      await aiRepository.saveMessage({
        userId,
        conversationId: activeConversationId,
        role: 'assistant',
        message: reply
      });

      return {
        reply,
        conversation_id: activeConversationId,
        model: config.ollama.model,
        ai_available: true,
        created_at: new Date().toISOString()
      };
    } catch (err) {
      const errMsg = `AI Tutor service error: ${err.message}. Please verify local Ollama service resources.`;

      await aiRepository.saveMessage({
        userId,
        conversationId: activeConversationId,
        role: 'assistant',
        message: errMsg
      });

      return {
        reply: errMsg,
        conversation_id: activeConversationId,
        model: config.ollama.model,
        ai_available: false,
        created_at: new Date().toISOString()
      };
    }
  },

  /**
   * Helper: Call OpenAI-compatible Cloud AI endpoint
   */
  async _chatWithCloud({
    messages = [],
    modelOverride,
    temperature = 0.7,
    maxTokens,
    responseFormat,
    systemPrompt
  } = {}) {
    const provider = config.cloudAi.provider || 'groq';
    let targetModel = modelOverride || config.cloudAi.model || 'qwen/qwen3.8-27b';

    // Normalize decommissioned legacy Llama models on Groq to active qwen/qwen3.8-27b
    if (provider === 'groq') {
      if (!targetModel || targetModel === 'llama-3.1-8b-instant' || targetModel === 'llama-3.3-70b-versatile') {
        targetModel = 'qwen/qwen3.8-27b';
      }
    }

    const endpoint = resolveCloudEndpoint(config.cloudAi.baseUrl, provider);

    const chatMessages = [
      { role: 'system', content: systemPrompt || SYSTEM_PROMPT },
      ...messages.map(m => ({ role: m.role || 'user', content: m.content || m.message || '' }))
    ];

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);

    const requestPayload = {
      model: targetModel,
      messages: chatMessages,
      temperature
    };

    if (maxTokens) {
      requestPayload.max_tokens = maxTokens;
    }

    if (responseFormat) {
      requestPayload.response_format = responseFormat;
    }

    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.cloudAi.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestPayload),
        signal: controller.signal
      });
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      if (fetchErr.name === 'AbortError') {
        const timeoutErr = new Error('Cloud AI request timed out after 45 seconds.');
        timeoutErr.status = 504;
        timeoutErr.code = 'AI_SERVICE_ERROR';
        timeoutErr.isAiError = true;
        throw timeoutErr;
      }
      const netErr = new Error(`Cloud AI connection error: ${fetchErr.message}`);
      netErr.status = 502;
      netErr.code = 'AI_SERVICE_ERROR';
      netErr.isAiError = true;
      throw netErr;
    }
    clearTimeout(timeoutId);

    if (!response.ok) {
      const rawText = await response.text().catch(() => '');
      let errBody = {};
      try {
        errBody = JSON.parse(rawText);
      } catch {
        errBody = { raw: rawText };
      }

      const detailedMsg = errBody?.error?.message || errBody?.message || rawText || response.statusText;
      const errorCode = errBody?.error?.code || '';

      // Redact any secrets or auth tokens before logging
      const safeBody = (typeof errBody === 'object' ? JSON.stringify(errBody) : String(rawText))
        .replace(/Bearer\s+[A-Za-z0-9_\-\.]+/gi, 'Bearer [REDACTED]')
        .replace(/gsk_[A-Za-z0-9]+/gi, 'gsk_[REDACTED]')
        .replace(/sk-[A-Za-z0-9]+/gi, 'sk-[REDACTED]');

      // Task 6: Production logs contain HTTP status, Groq error message, requested model, provider, endpoint, sanitized body
      console.error(
        `[AIService] Cloud AI request failed:\n` +
        `  Provider: ${provider}\n` +
        `  Endpoint: ${endpoint}\n` +
        `  Requested Model: ${targetModel}\n` +
        `  HTTP Status: ${response.status}\n` +
        `  Groq Error Message: ${detailedMsg}\n` +
        `  Response Body: ${safeBody}`
      );

      // Fallback chain for Groq models: qwen/qwen3.8-27b -> openai/gpt-oss-20b
      if (provider === 'groq' && (response.status === 404 || errorCode === 'model_not_found')) {
        let fallbackModel = null;
        if (targetModel !== 'qwen/qwen3.8-27b') {
          fallbackModel = 'qwen/qwen3.8-27b';
        } else if (targetModel !== 'openai/gpt-oss-20b') {
          fallbackModel = 'openai/gpt-oss-20b';
        }

        if (fallbackModel && fallbackModel !== targetModel) {
          console.warn(`[AIService] Model '${targetModel}' was not found on Groq (${detailedMsg}). Retrying with fallback model '${fallbackModel}'...`);
          return this._chatWithCloud({
            messages,
            modelOverride: fallbackModel,
            temperature,
            maxTokens,
            responseFormat,
            systemPrompt
          });
        }
      }

      // If response_format json_object caused 400 Bad Request on provider, retry once without response_format
      if (responseFormat && response.status === 400 && String(detailedMsg).toLowerCase().includes('response_format')) {
        console.warn(`[AIService] response_format was rejected by ${provider}. Retrying with prompt-based JSON instructions only...`);
        return this._chatWithCloud({
          messages,
          modelOverride: targetModel,
          temperature,
          maxTokens,
          responseFormat: null,
          systemPrompt
        });
      }

      const clientErr = new Error(`Cloud AI provider (${provider}) error: ${detailedMsg}`);
      clientErr.status = response.status === 429 ? 429 : 502;
      clientErr.code = 'AI_SERVICE_ERROR';
      clientErr.isAiError = true;
      clientErr.provider = provider;
      clientErr.providerStatus = response.status;
      clientErr.providerError = detailedMsg;
      throw clientErr;
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || 'Empty response from Cloud AI.';
  },

  /**
   * Quiz Generation
   */
  async generateQuiz({ topic, count = 5 }) {
    const prompt = `Generate ${count} high-quality multiple choice questions (MCQs) for the topic: "${topic}".
Output ONLY valid JSON adhering strictly to this schema, with no preamble or markdown ticks:
{
  "questions": [
    {
      "question_text": "string",
      "options": ["option 1", "option 2", "option 3", "option 4"],
      "correct_option_index": 0,
      "explanation": "concise explanation why option is correct"
    }
  ]
}`;

    // Cloud AI quiz generation
    if (config.cloudAi.apiKey) {
      try {
        const reply = await this._chatWithCloud({
          messages: [{ role: 'user', message: prompt }]
        });
        const cleaned = reply.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleaned);
        return {
          available: true,
          topic,
          questions: parsed.questions || []
        };
      } catch (err) {
        console.warn('[AIService] Cloud quiz generation failed:', err.message);
        return {
          available: false,
          topic,
          questions: [],
          message: `Cloud AI quiz generation failed: ${err.message}`
        };
      }
    }

    const status = await this.getStatus();
    if (!status.available) {
      return {
        available: false,
        topic,
        questions: [],
        message: `AI service unavailable. Cannot generate custom quiz.`
      };
    }

    try {
      const response = await fetch(`${config.ollama.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.ollama.model,
          prompt,
          format: 'json',
          stream: false,
          keep_alive: '24h'
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama generate failed with status ${response.status}`);
      }

      const data = await response.json();
      const parsed = JSON.parse(data.response);
      return {
        available: true,
        topic,
        questions: parsed.questions || []
      };
    } catch (err) {
      return {
        available: false,
        topic,
        questions: [],
        message: `Failed to generate quiz with Ollama: ${err.message}`
      };
    }
  }
};
