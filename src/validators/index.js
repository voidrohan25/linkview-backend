import { z } from 'zod';

export const registerSchema = z.object({
  full_name: z.string().trim().min(2, 'Full name must be at least 2 characters').max(100),
  email: z.string().trim().email('Please enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters')
});

export const loginSchema = z.object({
  email: z.string().trim().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required')
});

export const verifyEmailSchema = z.object({
  email: z.string().trim().email('Please enter a valid email address'),
  otp: z.preprocess(
    val => (typeof val === 'number' ? String(val) : val),
    z.string().trim().regex(/^\d{6}$/, 'Verification code must be exactly 6 digits')
  )
});

export const resendVerificationSchema = z.object({
  email: z.string().trim().email('Please enter a valid email address')
});

export const googleAuthSchema = z.object({
  credential: z
    .string({
      required_error: 'Google credential token is required',
      invalid_type_error: 'Google credential token must be a string'
    })
    .trim()
    .min(1, 'Google credential token cannot be empty')
});

export const createCourseSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters'),
  description: z.string().min(10, 'Description must be at least 10 characters'),
  category: z.string().min(2, 'Category is required'),
  thumbnail_url: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  instructor_name: z.string().min(2, 'Instructor name is required'),
  published: z.boolean().default(true)
});

export const updateCourseSchema = createCourseSchema.partial();

export const createLessonSchema = z.object({
  title: z.string().min(3, 'Lesson title must be at least 3 characters'),
  content: z.string().min(10, 'Lesson content is required'),
  video_url: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  position: z.number().int().positive().default(1)
});

export const updateLessonSchema = createLessonSchema.partial();

export const setProgressSchema = z.object({
  lesson_id: z.string().min(1, 'lesson_id is required'),
  completed: z.boolean()
});

export const submitQuizAttemptSchema = z.object({
  answers: z.array(
    z.object({
      question_id: z.string().min(1, 'question_id is required'),
      selected_option_index: z.number().int().optional().default(-1),
      response_text: z.string().optional(),
      text: z.string().optional(),
      code: z.string().optional()
    })
  ).min(1, 'At least one answer must be provided')
});

export const aiChatSchema = z.object({
  message: z.string().min(1, 'Message cannot be empty').max(3000, 'Message cannot exceed 3000 characters'),
  conversation_id: z.string().optional()
});

export const aiGenerateQuizSchema = z.object({
  topic: z.string().min(2, 'Topic must be at least 2 characters').max(200),
  count: z.number().int().min(1).max(10).default(5)
});
