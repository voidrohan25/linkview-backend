import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey = process.env.GEMINI_API_KEY || '';
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

export interface AIEvaluationResponse {
  score: number; // 1-10
  feedback: string;
  strengths: string[];
  improvements: string[];
  followUpQuestion?: string;
}

export async function evaluateAIInterviewAnswer(
  question: string,
  studentAnswer: string,
  track: string = 'technical'
): Promise<AIEvaluationResponse | null> {
  if (!genAI || !apiKey || apiKey.includes('placeholder')) {
    return null; // Triggers robust server-side rubric fallback
  }

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `
You are a senior technical interviewer evaluating a student candidate in an IT Placement Mock Interview.
Track: ${track}
Question: "${question}"
Student's Answer: "${studentAnswer}"

Evaluate the answer strictly based on:
1. Technical accuracy (1-10)
2. Conceptual depth
3. Edge cases and trade-offs
4. Articulation and communication

Respond ONLY in valid JSON format with this exact structure:
{
  "score": 8,
  "feedback": "One concise paragraph explaining accuracy and gaps.",
  "strengths": ["Clear understanding of memory management", "Good verbal explanation"],
  "improvements": ["Cite asymptotic O(1) space complexity", "Mention real-world debugging tools"],
  "followUpQuestion": "An intelligent follow-up question digging deeper into edge cases."
}
`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanJson);
  } catch (err) {
    console.warn('Gemini AI evaluation failed, reverting to rubric engine:', err);
    return null;
  }
}
