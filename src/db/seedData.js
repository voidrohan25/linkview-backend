// LinkTest Seed Data v2.0 — Extended LMS Seed
// Includes TEACHER role, classes, subjects, batches, timetable, assignments, announcements, etc.
import bcrypt from 'bcryptjs';

export const SEED_USERS = [
  {
    id: 'user-student-001',
    full_name: 'Aarav Sharma',
    email: 'student@linktest.io',
    password_hash: bcrypt.hashSync('Student123!', 10),
    role: 'STUDENT',
    status: 'active',
    email_verified: true,
    email_verified_at: new Date('2026-01-15T09:00:00Z').toISOString(),
    created_at: new Date('2026-01-15T09:00:00Z').toISOString(),
    phone: null, avatar_url: null, last_login_at: null
  },
  {
    id: 'user-student-002',
    full_name: 'Priya Mehta',
    email: 'priya@linktest.io',
    password_hash: bcrypt.hashSync('Student123!', 10),
    role: 'STUDENT',
    status: 'active',
    email_verified: true,
    email_verified_at: new Date('2026-01-20T09:00:00Z').toISOString(),
    created_at: new Date('2026-01-20T09:00:00Z').toISOString(),
    phone: null, avatar_url: null, last_login_at: null
  },
  {
    id: 'user-student-003',
    full_name: 'Rohan Verma',
    email: 'rohan@linktest.io',
    password_hash: bcrypt.hashSync('Student123!', 10),
    role: 'STUDENT',
    status: 'active',
    email_verified: true,
    email_verified_at: new Date('2026-02-01T09:00:00Z').toISOString(),
    created_at: new Date('2026-02-01T09:00:00Z').toISOString(),
    phone: null, avatar_url: null, last_login_at: null
  },
  {
    id: 'user-admin-001',
    full_name: 'Dr. Priya Patel',
    email: 'admin@linktest.io',
    password_hash: bcrypt.hashSync('Admin123!', 10),
    role: 'ADMIN',
    status: 'active',
    email_verified: true,
    email_verified_at: new Date('2026-01-10T09:00:00Z').toISOString(),
    created_at: new Date('2026-01-10T09:00:00Z').toISOString(),
    phone: null, avatar_url: null, last_login_at: null
  },
  {
    id: 'user-teacher-001',
    full_name: 'Prof. Rajesh Kulkarni',
    email: 'teacher@linktest.io',
    password_hash: bcrypt.hashSync('Teacher123!', 10),
    role: 'TEACHER',
    status: 'active',
    email_verified: true,
    email_verified_at: new Date('2026-01-12T09:00:00Z').toISOString(),
    created_at: new Date('2026-01-12T09:00:00Z').toISOString(),
    phone: null, avatar_url: null, last_login_at: null
  },
  {
    id: 'user-teacher-002',
    full_name: 'Ananya Deshmukh',
    email: 'ananya@linktest.io',
    password_hash: bcrypt.hashSync('Teacher123!', 10),
    role: 'TEACHER',
    status: 'active',
    email_verified: true,
    email_verified_at: new Date('2026-01-14T09:00:00Z').toISOString(),
    created_at: new Date('2026-01-14T09:00:00Z').toISOString(),
    phone: null, avatar_url: null, last_login_at: null
  }
];

export const SEED_TEACHER_PROFILES = [
  {
    id: 'tp-001',
    user_id: 'user-teacher-001',
    employee_id: 'EMP-001',
    department: 'Computer Science',
    qualification: 'M.Tech, IIT Bombay',
    specialization: 'Data Structures & Algorithms, System Design',
    joining_date: '2026-01-12',
    created_at: new Date('2026-01-12T09:00:00Z').toISOString(),
    updated_at: new Date('2026-01-12T09:00:00Z').toISOString()
  },
  {
    id: 'tp-002',
    user_id: 'user-teacher-002',
    employee_id: 'EMP-002',
    department: 'AI & Data Science',
    qualification: 'M.S. Computer Science, Stanford',
    specialization: 'Machine Learning, Python, Neural Networks',
    joining_date: '2026-01-14',
    created_at: new Date('2026-01-14T09:00:00Z').toISOString(),
    updated_at: new Date('2026-01-14T09:00:00Z').toISOString()
  }
];

export const SEED_STUDENT_PROFILES = [
  {
    id: 'sp-001', user_id: 'user-student-001',
    enrollment_number: 'LT-2026-001',
    date_of_birth: '2004-05-15', guardian_name: 'Suresh Sharma',
    guardian_contact: '9876543210', address: 'Mumbai, Maharashtra',
    created_at: new Date('2026-01-15T09:00:00Z').toISOString(),
    updated_at: new Date('2026-01-15T09:00:00Z').toISOString()
  },
  {
    id: 'sp-002', user_id: 'user-student-002',
    enrollment_number: 'LT-2026-002',
    date_of_birth: '2004-08-22', guardian_name: 'Ravi Mehta',
    guardian_contact: '9876543211', address: 'Pune, Maharashtra',
    created_at: new Date('2026-01-20T09:00:00Z').toISOString(),
    updated_at: new Date('2026-01-20T09:00:00Z').toISOString()
  },
  {
    id: 'sp-003', user_id: 'user-student-003',
    enrollment_number: 'LT-2026-003',
    date_of_birth: '2005-02-10', guardian_name: 'Mohan Verma',
    guardian_contact: '9876543212', address: 'Delhi, India',
    created_at: new Date('2026-02-01T09:00:00Z').toISOString(),
    updated_at: new Date('2026-02-01T09:00:00Z').toISOString()
  }
];

export const SEED_ACADEMIC_SESSIONS = [
  {
    id: 'session-2026',
    name: 'Academic Year 2026-27',
    start_date: '2026-06-01',
    end_date: '2027-03-31',
    is_current: true,
    created_at: new Date('2026-01-01T00:00:00Z').toISOString()
  }
];

export const SEED_SUBJECTS = [
  { id: 'sub-cs101', name: 'Computer Science Fundamentals', code: 'CS101', description: 'Basics of computing, algorithms and data structures', department: 'Computer Science', status: 'active', created_at: new Date().toISOString() },
  { id: 'sub-ai201', name: 'Artificial Intelligence & ML', code: 'AI201', description: 'Machine learning, neural networks, and AI applications', department: 'AI & Data Science', status: 'active', created_at: new Date().toISOString() },
  { id: 'sub-wd101', name: 'Web Development', code: 'WD101', description: 'Full-stack web development with React and Node.js', department: 'Computer Science', status: 'active', created_at: new Date().toISOString() },
  { id: 'sub-ds101', name: 'Data Structures & Algorithms', code: 'DS101', description: 'Advanced data structures and algorithmic problem solving', department: 'Computer Science', status: 'active', created_at: new Date().toISOString() },
  { id: 'sub-db101', name: 'Database Systems', code: 'DB101', description: 'SQL, NoSQL, and database design principles', department: 'Computer Science', status: 'active', created_at: new Date().toISOString() }
];

export const SEED_CLASSES = [
  { id: 'class-cs-a', name: 'CS Batch A — 2026', description: 'Computer Science undergraduate batch A', academic_session_id: 'session-2026', created_at: new Date().toISOString() },
  { id: 'class-cs-b', name: 'CS Batch B — 2026', description: 'Computer Science undergraduate batch B', academic_session_id: 'session-2026', created_at: new Date().toISOString() }
];

export const SEED_BATCHES = [
  { id: 'batch-cs-a1', class_id: 'class-cs-a', course_id: 'course-ds-01', name: 'Section A1', code: 'BATCH-CS-A1', description: 'Data Structures & Algorithms Morning Cohort', start_date: '2026-08-01', end_date: '2026-12-15', capacity: 40, status: 'Active', class_teacher_id: 'user-teacher-001', created_at: new Date().toISOString() },
  { id: 'batch-cs-a2', class_id: 'class-cs-a', course_id: 'course-ai-01', name: 'Section A2', code: 'BATCH-CS-A2', description: 'Machine Learning & AI Foundations Cohort', start_date: '2026-08-01', end_date: '2026-12-15', capacity: 40, status: 'Active', class_teacher_id: 'user-teacher-002', created_at: new Date().toISOString() },
  { id: 'batch-cs-b1', class_id: 'class-cs-b', course_id: 'course-wd-01', name: 'Section B1', code: 'BATCH-CS-B1', description: 'Full Stack Web Engineering Intensive', start_date: '2026-08-01', end_date: '2026-12-15', capacity: 40, status: 'Active', class_teacher_id: 'user-teacher-001', created_at: new Date().toISOString() }
];

export const SEED_BATCH_TEACHERS = [
  { id: 'bt-001', batch_id: 'batch-cs-a1', teacher_id: 'user-teacher-001', assigned_by: 'user-admin-001', assigned_at: new Date().toISOString() },
  { id: 'bt-002', batch_id: 'batch-cs-a2', teacher_id: 'user-teacher-002', assigned_by: 'user-admin-001', assigned_at: new Date().toISOString() },
  { id: 'bt-003', batch_id: 'batch-cs-b1', teacher_id: 'user-teacher-001', assigned_by: 'user-admin-001', assigned_at: new Date().toISOString() }
];

export const SEED_BATCH_ENROLLMENTS = [
  { id: 'be-001', batch_id: 'batch-cs-a1', student_id: 'user-student-001', enrolled_by: 'user-admin-001', status: 'active', enrolled_at: new Date().toISOString() },
  { id: 'be-002', batch_id: 'batch-cs-b1', student_id: 'user-student-001', enrolled_by: 'user-teacher-001', status: 'active', enrolled_at: new Date().toISOString() }
];

export const SEED_CLASS_SUBJECTS = [
  { id: 'cs-sub-1', class_id: 'class-cs-a', subject_id: 'sub-cs101' },
  { id: 'cs-sub-2', class_id: 'class-cs-a', subject_id: 'sub-ds101' },
  { id: 'cs-sub-3', class_id: 'class-cs-a', subject_id: 'sub-wd101' },
  { id: 'cs-sub-4', class_id: 'class-cs-a', subject_id: 'sub-ai201' },
  { id: 'cs-sub-5', class_id: 'class-cs-b', subject_id: 'sub-cs101' },
  { id: 'cs-sub-6', class_id: 'class-cs-b', subject_id: 'sub-db101' }
];

export const SEED_TEACHER_ASSIGNMENTS = [
  { id: 'ta-001', teacher_id: 'user-teacher-001', class_id: 'class-cs-a', batch_id: 'batch-cs-a1', subject_id: 'sub-ds101', assigned_at: new Date().toISOString() },
  { id: 'ta-002', teacher_id: 'user-teacher-001', class_id: 'class-cs-a', batch_id: 'batch-cs-a1', subject_id: 'sub-cs101', assigned_at: new Date().toISOString() },
  { id: 'ta-003', teacher_id: 'user-teacher-002', class_id: 'class-cs-a', batch_id: 'batch-cs-a2', subject_id: 'sub-ai201', assigned_at: new Date().toISOString() },
  { id: 'ta-004', teacher_id: 'user-teacher-001', class_id: 'class-cs-b', batch_id: 'batch-cs-b1', subject_id: 'sub-cs101', assigned_at: new Date().toISOString() }
];

export const SEED_STUDENT_CLASS_ENROLLMENTS = [
  { id: 'sce-001', student_id: 'user-student-001', class_id: 'class-cs-a', batch_id: 'batch-cs-a1', enrolled_at: new Date().toISOString() },
  { id: 'sce-002', student_id: 'user-student-002', class_id: 'class-cs-a', batch_id: 'batch-cs-a1', enrolled_at: new Date().toISOString() },
  { id: 'sce-003', student_id: 'user-student-003', class_id: 'class-cs-b', batch_id: 'batch-cs-b1', enrolled_at: new Date().toISOString() }
];

export const SEED_TIMETABLE = [
  { id: 'tt-001', class_id: 'class-cs-a', batch_id: 'batch-cs-a1', subject_id: 'sub-ds101', teacher_id: 'user-teacher-001', day_of_week: 1, start_time: '09:00', end_time: '10:30', room: 'Lab A', academic_session_id: 'session-2026', created_at: new Date().toISOString() },
  { id: 'tt-002', class_id: 'class-cs-a', batch_id: 'batch-cs-a1', subject_id: 'sub-cs101', teacher_id: 'user-teacher-001', day_of_week: 2, start_time: '10:00', end_time: '11:30', room: 'Room 101', academic_session_id: 'session-2026', created_at: new Date().toISOString() },
  { id: 'tt-003', class_id: 'class-cs-a', batch_id: 'batch-cs-a2', subject_id: 'sub-ai201', teacher_id: 'user-teacher-002', day_of_week: 3, start_time: '14:00', end_time: '15:30', room: 'Lab B', academic_session_id: 'session-2026', created_at: new Date().toISOString() }
];

export const SEED_ASSIGNMENTS = [
  {
    id: 'assign-001',
    title: 'Implement a Binary Search Tree in Python',
    instructions: 'Implement a complete Binary Search Tree with insert, delete, search, and three traversal methods (in-order, pre-order, post-order). Include time complexity analysis.',
    subject_id: 'sub-ds101',
    class_id: 'class-cs-a',
    batch_id: 'batch-cs-a1',
    teacher_id: 'user-teacher-001',
    issue_date: '2026-10-01',
    due_date: '2026-10-20',
    max_marks: 100,
    status: 'published',
    created_at: new Date('2026-10-01').toISOString(),
    updated_at: new Date('2026-10-01').toISOString()
  }
];

export const SEED_ANNOUNCEMENTS = [
  {
    id: 'ann-001',
    title: 'Welcome to Academic Year 2026-27!',
    content: 'Dear students and teachers, welcome to the new academic year. Classes begin June 1st. Please check your timetables and ensure your profiles are complete.',
    author_id: 'user-admin-001',
    target_type: 'global',
    target_id: null,
    status: 'published',
    publish_at: new Date('2026-06-01').toISOString(),
    created_at: new Date('2026-06-01').toISOString(),
    updated_at: new Date('2026-06-01').toISOString()
  },
  {
    id: 'ann-002',
    title: 'Assignment 1 Posted — BST Implementation',
    content: 'Assignment 1 on Binary Search Trees has been posted. Due date: October 20th. Please check the Assignments section.',
    author_id: 'user-teacher-001',
    target_type: 'class',
    target_id: 'class-cs-a',
    status: 'published',
    publish_at: new Date('2026-10-01').toISOString(),
    created_at: new Date('2026-10-01').toISOString(),
    updated_at: new Date('2026-10-01').toISOString()
  }
];

export const SEED_LIVE_CLASSES = [
  {
    id: 'live-001',
    title: 'Introduction to Binary Trees — Live Session',
    description: 'Interactive live session covering binary tree fundamentals with Q&A',
    teacher_id: 'user-teacher-001',
    class_id: 'class-cs-a',
    batch_id: 'batch-cs-a1',
    subject_id: 'sub-ds101',
    course_id: null,
    scheduled_at: new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString(),
    started_at: null,
    ended_at: null,
    meeting_url: null,
    meeting_provider: 'external',
    status: 'scheduled',
    created_at: new Date().toISOString()
  }
];

export const SEED_SYLLABUS_TOPICS = [
  { id: 'syl-001', subject_id: 'sub-ds101', class_id: 'class-cs-a', teacher_id: 'user-teacher-001', chapter: 'Chapter 1: Arrays & Sorting', topic: 'Arrays, Sorting Algorithms, Big-O', planned_date: '2026-06-10', completed: true, completed_date: '2026-06-10', notes: null, position: 1, created_at: new Date().toISOString() },
  { id: 'syl-002', subject_id: 'sub-ds101', class_id: 'class-cs-a', teacher_id: 'user-teacher-001', chapter: 'Chapter 2: Linked Lists', topic: 'Singly & Doubly Linked Lists, Stacks, Queues', planned_date: '2026-07-01', completed: true, completed_date: '2026-07-05', notes: null, position: 2, created_at: new Date().toISOString() },
  { id: 'syl-003', subject_id: 'sub-ds101', class_id: 'class-cs-a', teacher_id: 'user-teacher-001', chapter: 'Chapter 3: Trees', topic: 'Binary Trees, BST, AVL Trees', planned_date: '2026-08-01', completed: false, completed_date: null, notes: 'AVL rotations pending', position: 3, created_at: new Date().toISOString() },
  { id: 'syl-004', subject_id: 'sub-ds101', class_id: 'class-cs-a', teacher_id: 'user-teacher-001', chapter: 'Chapter 4: Graphs', topic: 'BFS, DFS, Shortest Path Algorithms', planned_date: '2026-09-01', completed: false, completed_date: null, notes: null, position: 4, created_at: new Date().toISOString() }
];

// Re-export original seed data
export const SEED_COURSES = [
  {
    id: 'course-web-dev-101',
    title: 'Full-Stack Web Development with React & Node.js',
    description: 'Master modern frontend and backend development. Build scalable web applications with React, Express, PostgreSQL, and REST APIs.',
    category: 'Web Development',
    thumbnail_url: 'https://images.unsplash.com/photo-1593720213428-28a5b9e94613?auto=format&fit=crop&w=800&q=80',
    instructor_name: 'Dr. Priya Patel',
    instructor_id: 'user-admin-001',
    status: 'published',
    published: true,
    created_at: new Date('2026-02-01T10:00:00Z').toISOString(),
    updated_at: new Date('2026-02-01T10:00:00Z').toISOString()
  },
  {
    id: 'course-dsa-201',
    title: 'Data Structures & Algorithms Mastery',
    description: 'Ace technical interviews with deep mastery of arrays, linked lists, trees, graphs, dynamic programming, and asymptotic Big-O analysis.',
    category: 'Computer Science',
    thumbnail_url: 'https://images.unsplash.com/photo-1516116211227-bbc0c25a0750?auto=format&fit=crop&w=800&q=80',
    instructor_name: 'Prof. Rajesh Kulkarni',
    instructor_id: 'user-teacher-001',
    status: 'published',
    published: true,
    created_at: new Date('2026-02-05T10:00:00Z').toISOString(),
    updated_at: new Date('2026-02-05T10:00:00Z').toISOString()
  },
  {
    id: 'course-ai-ml-301',
    title: 'Python for AI, Machine Learning & LLMs',
    description: 'From NumPy and Pandas to neural networks and local LLM prompting with Ollama. Practical, hands-on machine learning.',
    category: 'AI & Data Science',
    thumbnail_url: 'https://images.unsplash.com/photo-1677442136019-21780ecad995?auto=format&fit=crop&w=800&q=80',
    instructor_name: 'Ananya Deshmukh',
    instructor_id: 'user-teacher-002',
    status: 'published',
    published: true,
    created_at: new Date('2026-02-10T10:00:00Z').toISOString(),
    updated_at: new Date('2026-02-10T10:00:00Z').toISOString()
  },
  {
    id: 'course-cloud-401',
    title: 'Cloud DevOps & Containerization with Docker',
    description: 'Learn modern DevOps workflows: containerize microservices, write Dockerfiles, configure CI/CD pipelines, and deploy reliably.',
    category: 'Cloud & DevOps',
    thumbnail_url: 'https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?auto=format&fit=crop&w=800&q=80',
    instructor_name: 'Vikram Sengupta',
    instructor_id: null,
    status: 'published',
    published: true,
    created_at: new Date('2026-02-15T10:00:00Z').toISOString(),
    updated_at: new Date('2026-02-15T10:00:00Z').toISOString()
  },
  {
    id: 'course-sys-501',
    title: 'System Design & High-Scalability Architectures',
    description: 'Architect resilient enterprise systems. Understand caching, load balancing, message queues, database sharding, and CAP theorem trade-offs.',
    category: 'System Architecture',
    thumbnail_url: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=800&q=80',
    instructor_name: 'Suresh Narayanan',
    instructor_id: null,
    status: 'published',
    published: true,
    created_at: new Date('2026-02-20T10:00:00Z').toISOString(),
    updated_at: new Date('2026-02-20T10:00:00Z').toISOString()
  }
];

export const SEED_LESSONS = [
  { id: 'lesson-wd-01', course_id: 'course-web-dev-101', title: '1. Introduction to Modern Web Architecture & HTTP', content: `# Introduction to Modern Web Architecture\n\nWelcome to LinkTest's Full-Stack Web Development track!\n\n### Key Concepts\n- **Client-Server Model**: How browsers communicate with backend runtimes via HTTP/HTTPS protocols.\n- **RESTful Endpoints**: Stateless verbs (GET, POST, PUT, DELETE) representing resources.\n- **The DOM and Virtual DOM**: Why React utilizes an in-memory abstraction for optimized reconciliation.`, video_url: 'https://www.youtube.com/watch?v=kUMe1FH4CHE', position: 1 },
  { id: 'lesson-wd-02', course_id: 'course-web-dev-101', title: '2. React State Management & Hooks (useState, useEffect)', content: `# React State Management & Hooks\n\nIn this lesson, we examine state persistence, side effects, and re-rendering cycles.`, video_url: 'https://www.youtube.com/watch?v=O6P86uwfdR0', position: 2 },
  { id: 'lesson-wd-03', course_id: 'course-web-dev-101', title: '3. Building Secure Express APIs with JWT & PostgreSQL', content: `# Secure Express APIs with JWT & PostgreSQL\n\nLearn how to safeguard endpoints using JSON Web Tokens and parameterized SQL queries.`, video_url: 'https://www.youtube.com/watch?v=7nafaH9SddU', position: 3 },
  { id: 'lesson-dsa-01', course_id: 'course-dsa-201', title: '1. Asymptotic Analysis & Big-O Notation', content: `# Asymptotic Analysis & Big-O Notation\n\nUnderstanding how algorithm runtime scales with input size n.`, video_url: 'https://www.youtube.com/watch?v=__vX2sjlpXU', position: 1 },
  { id: 'lesson-dsa-02', course_id: 'course-dsa-201', title: '2. Linked Lists, Stacks & Queues', content: `# Linked Lists, Stacks & Queues\n\nLinear data structures and pointer manipulations.`, video_url: 'https://www.youtube.com/watch?v=RBSGKlAvoiM', position: 2 },
  { id: 'lesson-dsa-03', course_id: 'course-dsa-201', title: '3. Binary Search Trees & Tree Traversals', content: `# Binary Search Trees & Traversals`, video_url: 'https://www.youtube.com/watch?v=9GMbODhB470', position: 3 },
  { id: 'lesson-ai-01', course_id: 'course-ai-ml-301', title: '1. Foundations of Machine Learning & Python Numerical Libraries', content: `# Foundations of Machine Learning`, video_url: 'https://www.youtube.com/watch?v=i_LwzRVP7bg', position: 1 },
  { id: 'lesson-ai-02', course_id: 'course-ai-ml-301', title: '2. Neural Networks & Deep Learning Basics', content: `# Neural Networks & Backpropagation`, video_url: 'https://www.youtube.com/watch?v=aircAruvnKk', position: 2 },
  { id: 'lesson-ai-03', course_id: 'course-ai-ml-301', title: '3. Large Language Models & Local Prompting with Ollama', content: `# Large Language Models with Ollama & Qwen`, video_url: 'https://www.youtube.com/watch?v=GWB9ApDZTV4', position: 3 },
  { id: 'lesson-cloud-01', course_id: 'course-cloud-401', title: '1. Introduction to Linux & Containerization with Docker', content: `# Containerization with Docker`, video_url: 'https://www.youtube.com/watch?v=fqMOX6JJhGo', position: 1 },
  { id: 'lesson-cloud-02', course_id: 'course-cloud-401', title: '2. Multi-Container Orchestration with Docker Compose', content: `# Docker Compose Multi-Service Setup`, video_url: 'https://www.youtube.com/watch?v=HG6yIjZapSA', position: 2 },
  { id: 'lesson-cloud-03', course_id: 'course-cloud-401', title: '3. Continuous Integration & Deployment (CI/CD)', content: `# CI/CD Automation`, video_url: 'https://www.youtube.com/watch?v=R8_veQiYBjI', position: 3 },
  { id: 'lesson-sys-01', course_id: 'course-sys-501', title: '1. Scalability Fundamentals: Vertical vs Horizontal Scaling', content: `# Scalability Fundamentals`, video_url: 'https://www.youtube.com/watch?v=xpDnVSmNFX0', position: 1 },
  { id: 'lesson-sys-02', course_id: 'course-sys-501', title: '2. Caching Strategies & Distributed In-Memory Datastores', content: `# Caching Strategies with Redis`, video_url: 'https://www.youtube.com/watch?v=6PHXv87phhM', position: 2 },
  { id: 'lesson-sys-03', course_id: 'course-sys-501', title: '3. Database Sharding, Replication & CAP Theorem Trade-offs', content: `# Database Sharding & High Availability`, video_url: 'https://www.youtube.com/watch?v=kPr43k9bS1c', position: 3 }
];

export const SEED_QUIZZES = [
  { id: 'quiz-web-dev-01', course_id: 'course-web-dev-101', title: 'Web Development & Full-Stack Architecture Assessment', description: 'Test your understanding of HTTP, React lifecycle, JWT authentication, and secure database practices.', teacher_id: 'user-teacher-001', status: 'published', duration_minutes: 20, pass_percentage: 60, results_published: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: 'quiz-dsa-01', course_id: 'course-dsa-201', title: 'Data Structures & Algorithmic Complexity Quiz', description: 'Validate your knowledge of Big-O analysis, binary search trees, hash tables, and algorithm efficiency.', teacher_id: 'user-teacher-001', status: 'published', duration_minutes: 15, pass_percentage: 60, results_published: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
];

export const SEED_QUESTIONS = [
  { id: 'q-wd-1', quiz_id: 'quiz-web-dev-01', question_text: 'Which HTTP method should be used when updating an entire existing resource according to standard REST conventions?', options: ['GET', 'POST', 'PUT', 'DELETE'], correct_option_index: 2, explanation: 'PUT is idempotent and standard for updating an entire resource.', position: 1 },
  { id: 'q-wd-2', quiz_id: 'quiz-web-dev-01', question_text: 'In React, what is the primary consequence of directly mutating state?', options: ['The application will throw a syntax error during compilation.', 'React will not detect the change and will not trigger a re-render.', 'The browser DOM will crash immediately.', 'The variable will be reset to null automatically.'], correct_option_index: 1, explanation: 'React relies on immutable state updates to detect differences through shallow comparison.', position: 2 },
  { id: 'q-wd-3', quiz_id: 'quiz-web-dev-01', question_text: 'Why should passwords never be stored in plain text?', options: ['Plain text takes up more disk space.', 'Unsalted hashes are vulnerable to Rainbow Table lookups.', 'Databases cannot index non-hashed strings.', 'Operating systems reject plain text strings.'], correct_option_index: 1, explanation: 'Bcrypt incorporates random salting and work factors to thwart cracking attacks.', position: 3 },
  { id: 'q-wd-4', quiz_id: 'quiz-web-dev-01', question_text: 'What is the primary purpose of parameterized queries in PostgreSQL?', options: ['Speed up CPU clock.', 'Prevent SQL Injection.', 'Auto-convert results to JSON.', 'Enable multi-threading.'], correct_option_index: 1, explanation: 'Parameterized queries ensure user input is parsed strictly as data values.', position: 4 },
  { id: 'q-wd-5', quiz_id: 'quiz-web-dev-01', question_text: 'Which HTTP header is standard for conveying a JWT in authenticated REST requests?', options: ['Content-Type: application/jwt', 'Authorization: Bearer <token>', 'X-Auth-Token: <token>', 'Authentication: Token <token>'], correct_option_index: 1, explanation: 'The standard HTTP authorization header format is Authorization: Bearer <token> as per RFC 6750.', position: 5 },
  { id: 'q-dsa-1', quiz_id: 'quiz-dsa-01', question_text: 'What is the worst-case time complexity of Binary Search on a sorted array of size n?', options: ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'], correct_option_index: 1, explanation: 'Binary search halves the search space with every iteration, resulting in O(log n).', position: 1 },
  { id: 'q-dsa-2', quiz_id: 'quiz-dsa-01', question_text: 'Which tree traversal yields values in non-decreasing sorted order in a BST?', options: ['Pre-order', 'In-order', 'Post-order', 'Level-order'], correct_option_index: 1, explanation: 'In-order traversal visits left, root, right — yielding sorted order in a BST.', position: 2 },
  { id: 'q-dsa-3', quiz_id: 'quiz-dsa-01', question_text: 'What is the average time complexity for Hash Table lookup?', options: ['O(1)', 'O(log n)', 'O(n)', 'O(n²)'], correct_option_index: 0, explanation: 'With uniform hash distribution, hash table lookups take constant amortized O(1) time.', position: 3 },
  { id: 'q-dsa-4', quiz_id: 'quiz-dsa-01', question_text: 'Which data structure is used to implement BFS on a graph?', options: ['Stack', 'Queue', 'Max-Heap', 'Binary Tree'], correct_option_index: 1, explanation: 'BFS uses a FIFO Queue to explore neighbor vertices level by level.', position: 4 },
  { id: 'q-dsa-5', quiz_id: 'quiz-dsa-01', question_text: 'What is the space complexity of merge sort on an array of size n?', options: ['O(1)', 'O(log n)', 'O(n)', 'O(n²)'], correct_option_index: 2, explanation: 'Standard merge sort requires O(n) auxiliary memory during merging.', position: 5 }
];

export const SEED_STUDY_MATERIALS = [
  { id: 'mat-001', title: 'BST Lecture Notes', description: 'Comprehensive notes on Binary Search Trees with examples and exercises', type: 'document', file_path: null, file_name: null, file_size: null, external_url: null, subject_id: 'sub-ds101', class_id: 'class-cs-a', course_id: 'course-dsa-201', lesson_id: 'lesson-dsa-03', uploaded_by: 'user-teacher-001', published: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: 'mat-002', title: 'AI & ML Reference Guide', description: 'Python reference guide for ML frameworks and libraries', type: 'link', file_path: null, file_name: null, file_size: null, external_url: 'https://scikit-learn.org/stable/user_guide.html', subject_id: 'sub-ai201', class_id: 'class-cs-a', course_id: 'course-ai-ml-301', lesson_id: null, uploaded_by: 'user-teacher-002', published: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
];

export const SEED_LEAVE_REQUESTS = [
  { id: 'leave-001', teacher_id: 'user-teacher-001', from_date: '2026-11-01', to_date: '2026-11-03', reason: 'Family function', status: 'pending', reviewed_by: null, reviewed_at: null, review_note: null, created_at: new Date().toISOString() }
];

export const SEED_FEEDBACK_TICKETS = [];
export const SEED_AUDIT_LOGS = [];
export const SEED_NOTIFICATIONS = [];
export const SEED_ATTENDANCE = [];
export const SEED_ASSIGNMENT_SUBMISSIONS = [];
export const SEED_ASSESSMENT_RESULTS = [];
export const SEED_TEACHER_INVITATIONS = [];
export const SEED_PASSWORD_RESET_TOKENS = [];
