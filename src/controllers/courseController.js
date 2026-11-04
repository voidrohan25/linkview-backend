import { courseRepository } from '../repositories/courseRepository.js';
import { lessonRepository } from '../repositories/lessonRepository.js';
import { createCourseSchema, updateCourseSchema } from '../validators/index.js';
import { recordAuditLog } from '../repositories/auditRepository.js';

export const courseController = {
  async getAll(req, res, next) {
    try {
      const { search, category, published } = req.query;
      const publishedOnly = published === 'all' && req.user?.role === 'ADMIN' ? false : true;
      const courses = await courseRepository.getAll({ search, category, publishedOnly });
      return res.status(200).json({
        success: true,
        data: { courses },
        message: 'Courses retrieved successfully.'
      });
    } catch (err) {
      next(err);
    }
  },

  async getById(req, res, next) {
    try {
      const { id } = req.params;
      const course = await courseRepository.getById(id);
      if (!course) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Course not found.' }
        });
      }

      const lessons = await lessonRepository.getByCourseId(id, req.user?.id);
      const isEnrolled = req.user ? await courseRepository.isEnrolled(req.user.id, id) : false;

      return res.status(200).json({
        success: true,
        data: { course, lessons, is_enrolled: isEnrolled },
        message: 'Course details retrieved successfully.'
      });
    } catch (err) {
      next(err);
    }
  },

  async enroll(req, res, next) {
    try {
      const { id } = req.params;
      const course = await courseRepository.getById(id);
      if (!course) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Course not found.' }
        });
      }

      await courseRepository.enroll(req.user.id, id);
      return res.status(200).json({
        success: true,
        data: { course_id: id, enrolled: true },
        message: 'Successfully enrolled in course.'
      });
    } catch (err) {
      next(err);
    }
  },

  async getMyCourses(req, res, next) {
    try {
      const enrolledCourses = await courseRepository.getEnrolledCoursesForUser(req.user.id);
      return res.status(200).json({
        success: true,
        data: { courses: enrolledCourses },
        message: 'Enrolled courses retrieved successfully.'
      });
    } catch (err) {
      next(err);
    }
  },

  async create(req, res, next) {
    try {
      const validated = createCourseSchema.parse({
        ...req.body,
        instructor_name: req.body.instructor_name || req.user?.full_name || 'LinkTest Faculty'
      });
      const course = await courseRepository.create(validated);
      if (req.user) {
        await recordAuditLog({
          actorId: req.user.id,
          actorEmail: req.user.email,
          action: 'COURSE_CREATED',
          resourceType: 'course',
          resourceId: course.id,
          targetResource: `course:${course.id}`,
          summary: `Course '${course.title}' created`,
          ipAddress: req.ip || req.headers['x-forwarded-for'],
          userAgent: req.headers['user-agent']
        });
      }
      return res.status(201).json({
        success: true,
        data: { course },
        message: 'Course created successfully.'
      });
    } catch (err) {
      next(err);
    }
  },

  async update(req, res, next) {
    try {
      const { id } = req.params;
      const validated = updateCourseSchema.parse(req.body);
      const updated = await courseRepository.update(id, validated);
      if (!updated) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Course not found.' }
        });
      }
      if (req.user) {
        await recordAuditLog({
          actorId: req.user.id,
          actorEmail: req.user.email,
          action: 'COURSE_UPDATED',
          resourceType: 'course',
          resourceId: id,
          targetResource: `course:${id}`,
          summary: `Course '${updated.title}' updated`,
          ipAddress: req.ip || req.headers['x-forwarded-for'],
          userAgent: req.headers['user-agent']
        });
      }
      return res.status(200).json({
        success: true,
        data: { course: updated },
        message: 'Course updated successfully.'
      });
    } catch (err) {
      next(err);
    }
  },

  async delete(req, res, next) {
    try {
      const { id } = req.params;
      const success = await courseRepository.delete(id);
      if (!success) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Course not found.' }
        });
      }
      if (req.user) {
        await recordAuditLog({
          actorId: req.user.id,
          actorEmail: req.user.email,
          action: 'COURSE_DELETED',
          resourceType: 'course',
          resourceId: id,
          targetResource: `course:${id}`,
          summary: `Course ${id} deleted`,
          ipAddress: req.ip || req.headers['x-forwarded-for'],
          userAgent: req.headers['user-agent']
        });
      }
      return res.status(200).json({
        success: true,
        data: { id },
        message: 'Course deleted successfully.'
      });
    } catch (err) {
      next(err);
    }
  }
};
