import { aiService } from '../services/aiService.js';
import { aiChatSchema, aiGenerateQuizSchema } from '../validators/index.js';

export const aiController = {
  async getStatus(req, res, next) {
    try {
      const status = await aiService.getStatus();
      return res.status(200).json({
        success: true,
        data: status,
        message: 'AI Tutor service status.'
      });
    } catch (err) {
      next(err);
    }
  },

  async initOllama(req, res, next) {
    try {
      const { model, auto_pull = false } = req.body || {};
      const result = await aiService.initOllama({
        model,
        autoPull: Boolean(auto_pull)
      });
      return res.status(200).json({
        success: result.success,
        data: result,
        message: result.message
      });
    } catch (err) {
      next(err);
    }
  },

  async chat(req, res, next) {
    try {
      const validated = aiChatSchema.parse(req.body);
      const result = await aiService.chat({
        userId: req.user.id,
        message: validated.message,
        conversationId: validated.conversation_id
      });
      return res.status(200).json({
        success: true,
        data: result,
        message: 'AI Tutor response generated.'
      });
    } catch (err) {
      next(err);
    }
  },

  async generateQuiz(req, res, next) {
    try {
      const validated = aiGenerateQuizSchema.parse(req.body);
      const result = await aiService.generateQuiz({
        topic: validated.topic,
        count: validated.count
      });
      return res.status(200).json({
        success: true,
        data: result,
        message: result.available ? 'Practice quiz generated.' : result.message
      });
    } catch (err) {
      next(err);
    }
  }
};
