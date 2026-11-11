// src/server.ts
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

// src/lib/usersStore.ts
import fs from "fs";
import path from "path";
import os from "os";
function getPersistencePaths(filename) {
  const paths = [];
  try {
    const dataDir = path.join(process.cwd(), ".data");
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    paths.push(path.join(dataDir, filename));
  } catch {
  }
  paths.push(path.join(os.tmpdir(), filename));
  return paths;
}
function loadPersistedUsers() {
  const paths = getPersistencePaths("linkview_users_persistent_cache.json");
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.users) && parsed.users.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn(`Could not read users cache from ${p}:`, e);
    }
  }
  return null;
}
function savePersistedUsers(st) {
  const paths = getPersistencePaths("linkview_users_persistent_cache.json");
  for (const p of paths) {
    try {
      fs.writeFileSync(p, JSON.stringify(st, null, 2), "utf-8");
    } catch (e) {
    }
  }
}
var ADMIN_EMAILS = [
  "admin@linktest.io",
  "admin@linktest.com",
  "admin@linkview.com",
  "admin@gmail.com",
  (process.env.ADMIN_EMAIL || "rahul.sir@linktest.io").trim().toLowerCase(),
  (process.env.SUPER_ADMIN_EMAIL_1 || "admin.linktest@gmail.com").trim().toLowerCase(),
  (process.env.SUPER_ADMIN_EMAIL_2 || "superadmin.linktest@gmail.com").trim().toLowerCase()
].filter(Boolean);
var ADMIN_DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || "RahulSir@2026";
function initUsersState() {
  const fromDisk = loadPersistedUsers();
  if (fromDisk) {
    const hasAdmin = fromDisk.users.some((u) => ADMIN_EMAILS.includes(u.email.toLowerCase()));
    if (!hasAdmin) {
      fromDisk.users.unshift({
        id: "admin-lead",
        fullName: "Rahul Sir (Founder & Admin)",
        email: ADMIN_EMAILS[0],
        role: "super_admin",
        status: "active",
        batchCode: "GLOBAL",
        joinedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
    return fromDisk;
  }
  const initialUsers = [
    {
      id: "admin-lead",
      fullName: "Rahul Sir (Founder & Admin)",
      email: ADMIN_EMAILS[0],
      role: "super_admin",
      status: "active",
      batchCode: "GLOBAL",
      joinedAt: (/* @__PURE__ */ new Date()).toISOString()
    }
  ];
  const st = {
    users: initialUsers,
    trainers: []
  };
  savePersistedUsers(st);
  return st;
}
if (!globalThis.__linkTestUsersState) {
  globalThis.__linkTestUsersState = initUsersState();
}
var state = globalThis.__linkTestUsersState;
function getAllUsers() {
  const fromDisk = loadPersistedUsers();
  if (fromDisk && Array.isArray(fromDisk.users)) {
    for (const du of fromDisk.users) {
      const idx = state.users.findIndex((u) => u.email.toLowerCase() === du.email.toLowerCase() || u.id === du.id);
      if (idx === -1) {
        state.users.push(du);
      } else {
        state.users[idx] = {
          ...du,
          ...state.users[idx],
          // Preserve promoted trainer role or updated batch
          role: state.users[idx].role === "trainer" || du.role === "trainer" ? "trainer" : state.users[idx].role,
          batchCode: state.users[idx].batchCode !== "UNASSIGNED" ? state.users[idx].batchCode : du.batchCode
        };
      }
    }
  }
  return state.users;
}
function getUserByEmail(email) {
  getAllUsers();
  const norm = email.trim().toLowerCase();
  return state.users.find((u) => u.email.toLowerCase() === norm);
}
function getOrCreateGoogleUser(params) {
  getAllUsers();
  const norm = params.email.trim().toLowerCase();
  if (ADMIN_EMAILS.includes(norm)) {
    let existing2 = state.users.find((u) => u.email.toLowerCase() === norm);
    if (!existing2) {
      existing2 = {
        id: `admin-${Date.now()}`,
        fullName: params.fullName || "Administrator",
        email: norm,
        role: "super_admin",
        status: "active",
        batchCode: "GLOBAL",
        joinedAt: (/* @__PURE__ */ new Date()).toISOString(),
        avatarUrl: params.avatarUrl
      };
      state.users.unshift(existing2);
      savePersistedUsers(state);
    }
    return existing2;
  }
  const existing = state.users.find((u) => u.email.toLowerCase() === norm);
  if (existing) {
    if (params.fullName && !existing.fullName) {
      existing.fullName = params.fullName;
    }
    if (params.avatarUrl && !existing.avatarUrl) {
      existing.avatarUrl = params.avatarUrl;
    }
    savePersistedUsers(state);
    return existing;
  }
  const newUser = {
    id: `stu-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    fullName: params.fullName || norm.split("@")[0],
    email: norm,
    role: "student",
    // STRICT DEFAULT
    status: "active",
    batchCode: "UNASSIGNED",
    joinedAt: (/* @__PURE__ */ new Date()).toISOString(),
    avatarUrl: params.avatarUrl
  };
  state.users.push(newUser);
  savePersistedUsers(state);
  return newUser;
}
function promoteStudentToTrainer(userId, batchCodes = []) {
  getAllUsers();
  const norm = userId.trim().toLowerCase();
  const user = state.users.find((u) => u.id.toLowerCase() === norm || u.email.toLowerCase() === norm);
  if (!user || user.role === "super_admin") return false;
  user.role = "trainer";
  if (batchCodes.length > 0) {
    user.batchCode = batchCodes[0];
  }
  const existingTrainer = state.trainers.find((t) => t.email.toLowerCase() === user.email.toLowerCase());
  if (existingTrainer) {
    existingTrainer.status = "active";
    existingTrainer.batchCodes = batchCodes.length > 0 ? batchCodes : existingTrainer.batchCodes || ["GLOBAL"];
  } else {
    state.trainers.push({
      id: `tr-${Date.now()}`,
      email: user.email,
      fullName: user.fullName,
      status: "active",
      batchCodes: batchCodes.length > 0 ? batchCodes : ["GLOBAL"],
      promotedAt: (/* @__PURE__ */ new Date()).toISOString(),
      promotedBy: "Admin"
    });
  }
  savePersistedUsers(state);
  return true;
}
function demoteTrainerToStudent(userId) {
  getAllUsers();
  const norm = userId.trim().toLowerCase();
  const user = state.users.find((u) => u.id.toLowerCase() === norm || u.email.toLowerCase() === norm);
  if (!user || user.role === "super_admin") return false;
  user.role = "student";
  const trainerIdx = state.trainers.findIndex((t) => t.email.toLowerCase() === user.email.toLowerCase());
  if (trainerIdx !== -1) {
    state.trainers.splice(trainerIdx, 1);
  }
  savePersistedUsers(state);
  return true;
}
function getAllTrainers() {
  getAllUsers();
  const trainerEmails = new Set(state.trainers.map((t) => t.email.toLowerCase()));
  const trainerUsers = state.users.filter((u) => u.role === "trainer");
  for (const tu of trainerUsers) {
    if (!trainerEmails.has(tu.email.toLowerCase())) {
      state.trainers.push({
        id: tu.id,
        email: tu.email,
        fullName: tu.fullName,
        status: tu.status || "active",
        batchCodes: tu.batchCode ? [tu.batchCode] : ["GLOBAL"],
        promotedAt: tu.joinedAt || (/* @__PURE__ */ new Date()).toISOString(),
        promotedBy: "Admin"
      });
      trainerEmails.add(tu.email.toLowerCase());
    }
  }
  return state.trainers;
}
function findTrainerByEmail(email) {
  getAllTrainers();
  const norm = email.trim().toLowerCase();
  return state.trainers.find((t) => t.email.toLowerCase() === norm);
}
function createTrainerInvitation(params) {
  const token = `inv_tr_${Math.random().toString(36).slice(2, 10)}`;
  const norm = params.email.trim().toLowerCase();
  const base = params.baseUrl || "http://localhost:3000";
  let user = state.users.find((u) => u.email.toLowerCase() === norm);
  if (!user) {
    user = {
      id: `usr-tr-${Date.now()}`,
      fullName: params.fullName,
      email: norm,
      role: "trainer",
      status: "active",
      batchCode: params.batchCode || "BATCH-2026",
      joinedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    state.users.push(user);
  } else {
    user.role = "trainer";
  }
  const trainer = {
    id: `tr-${Date.now()}`,
    email: norm,
    fullName: params.fullName,
    status: "active",
    batchCodes: params.batchCode ? [params.batchCode] : ["BATCH-2026"],
    promotedAt: (/* @__PURE__ */ new Date()).toISOString(),
    promotedBy: "Rahul Sir (Admin)"
  };
  const existingIdx = state.trainers.findIndex((t) => t.email.toLowerCase() === norm);
  if (existingIdx !== -1) {
    state.trainers[existingIdx] = trainer;
  } else {
    state.trainers.push(trainer);
  }
  savePersistedUsers(state);
  return {
    user,
    trainer,
    inviteLink: `${base}/login?inviteToken=${token}&email=${encodeURIComponent(norm)}`,
    inviteToken: token
  };
}

// src/lib/supabase.ts
var SUPER_ADMIN_EMAILS = [
  process.env.SUPER_ADMIN_EMAIL_1 || "admin.linktest@gmail.com",
  process.env.SUPER_ADMIN_EMAIL_2 || "superadmin.linktest@gmail.com"
];
var supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
var supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
var isSupabaseConfigured = Boolean(
  supabaseUrl && !supabaseUrl.includes("placeholder") && supabaseKey && !supabaseKey.includes("placeholder")
);

// src/lib/interviewStore.ts
import fs2 from "fs";
import path2 from "path";
import os2 from "os";
function getPersistencePaths2(filename) {
  const paths = [];
  try {
    const dataDir = path2.join(process.cwd(), ".data");
    if (!fs2.existsSync(dataDir)) {
      fs2.mkdirSync(dataDir, { recursive: true });
    }
    paths.push(path2.join(dataDir, filename));
  } catch {
  }
  paths.push(path2.join(os2.tmpdir(), filename));
  return paths;
}
var defaultStudents = [];
var defaultTrainers = [];
var defaultBatches = [
  {
    id: "BATCH-PY-2026",
    name: "Python Full Stack Placement Cohort 2026-A",
    code: "PY-2026-A",
    technology: "Python",
    trainerId: "tr-lead",
    trainerName: "Faculty Trainer",
    studentCount: 0,
    startDate: "2026-02-01",
    status: "ongoing"
  },
  {
    id: "BATCH-JAVA-2026",
    name: "Java Enterprise Systems 2026-B",
    code: "JAVA-2026-B",
    technology: "Java Enterprise",
    trainerId: "tr-lead",
    trainerName: "Faculty Trainer",
    studentCount: 0,
    startDate: "2026-02-01",
    status: "ongoing"
  },
  {
    id: "BATCH-DSA-2026",
    name: "DSA & Systems Placement Track",
    code: "DSA-2026-C",
    technology: "DSA & Algorithms",
    trainerId: "tr-lead",
    trainerName: "Faculty Trainer",
    studentCount: 0,
    startDate: "2026-02-01",
    status: "ongoing"
  }
];
var defaultQuestionBank = [
  {
    id: "qb-01",
    technology: "Java",
    topic: "JVM & Memory Management",
    difficulty: "advanced",
    question: "How does the Java Garbage Collector differentiate between unreachable objects and softly reachable objects?",
    expectedKeypoints: ["WeakReference vs SoftReference", "JVM heap pressure thresholds", "G1 / ZGC collection cycles"],
    idealAnswer: "Softly reachable objects are collected only when the JVM genuinely needs memory before throwing OutOfMemoryError, making them ideal for memory-sensitive caches. Weakly reachable objects are collected eagerly during normal minor/major GC cycles as soon as strong references are lost.",
    tags: ["Java", "JVM", "Garbage Collection", "Memory"]
  },
  {
    id: "qb-02",
    technology: "Java",
    topic: "Concurrency",
    difficulty: "intermediate",
    question: "Can you explain the internal working of ConcurrentHashMap in Java 8 compared to earlier versions?",
    expectedKeypoints: ["Segment locks in Java 7", "CAS + synchronized on node heads in Java 8", "TreeBin conversion on collision"],
    idealAnswer: "In Java 7, ConcurrentHashMap used Segment Locking (16 segments by default). In Java 8, segment locks were replaced by lock-free Compare-And-Swap (CAS) for bucket insertion and fine-grained synchronized blocks locking only the head node of a hash bucket, converting linked chains to red-black TreeBins when bucket size exceeds 8.",
    tags: ["Java", "Concurrency", "Hash Table"]
  },
  {
    id: "qb-03",
    technology: "Python",
    topic: "Internals & GIL",
    difficulty: "intermediate",
    question: "Explain how Python manages memory using the Global Interpreter Lock (GIL) and reference counting.",
    expectedKeypoints: ["Reference counting primary mechanism", "Cyclic GC (generational) for reference cycles", "GIL prevents race conditions on ob_refcnt"],
    idealAnswer: "CPython relies primarily on reference counting where every PyObject tracks its reference count. A generational garbage collector handles cyclic references. The GIL exists because CPython memory allocation and reference count manipulation are not thread-safe without mutexes, enforcing single-threaded bytecode execution.",
    tags: ["Python", "Memory", "GIL", "Internals"]
  },
  {
    id: "qb-04",
    technology: "Python",
    topic: "Generators & Iterators",
    difficulty: "beginner",
    question: "What are generators in Python and how do they optimize memory when processing large datasets?",
    expectedKeypoints: ["yield keyword", "Lazy evaluation / on-demand computation", "O(1) memory footprint vs list O(n)"],
    idealAnswer: "Generators are functions that yield values one at a time instead of returning a complete collection into memory. By maintaining stack execution state across yields, they consume O(1) memory regardless of whether streaming a thousand or a billion records.",
    tags: ["Python", "Generators", "Performance"]
  },
  {
    id: "qb-05",
    technology: "DSA",
    topic: "Arrays & Dynamic Programming",
    difficulty: "intermediate",
    question: "Given an array of integers, how would you find the subarray with the largest sum in O(n) time?",
    expectedKeypoints: ["Kadane algorithm", "max_ending_here and max_so_far", "Negative numbers edge case handling"],
    idealAnswer: "We use Kadane algorithm. We maintain two running accumulators: max_ending_here and max_so_far. At each element x, max_ending_here = max(x, max_ending_here + x), and max_so_far = max(max_so_far, max_ending_here), running in linear O(n) time and O(1) auxiliary space.",
    tags: ["DSA", "Arrays", "Kadane", "Dynamic Programming"]
  },
  {
    id: "qb-06",
    technology: "SQL",
    topic: "Indexes & Query Optimization",
    difficulty: "intermediate",
    question: "Explain the difference between clustered and non-clustered indexes and how they impact B-Tree disk I/O.",
    expectedKeypoints: ["Clustered physically sorts table data", "Non-clustered contains pointer to data page", "Lookup cost comparison"],
    idealAnswer: "A clustered index determines the physical storage order of rows in the table (one per table), directly storing row data in its leaf nodes. A non-clustered index creates a separate B-tree structure whose leaf nodes contain row locators (pointers) to the actual data rows.",
    tags: ["SQL", "Indexes", "B-Tree", "Performance"]
  },
  {
    id: "qb-07",
    technology: "Communication",
    topic: "Professional Elevator Pitch",
    difficulty: "beginner",
    question: "Please give me a concise 90-second professional elevator pitch introducing your technical background and key strengths.",
    expectedKeypoints: ["Clear self-introduction", "Key technology strengths", "Notable project achievements", "Enthusiasm and fluency"],
    idealAnswer: "Start with your name, educational and technical foundation, highlight 1-2 core technologies you excel in (e.g. Python backend, Java microservices), mention a significant project or challenge you delivered, and conclude with your career goals.",
    tags: ["Communication", "Elevator Pitch", "Fluency", "HR"]
  },
  {
    id: "qb-08",
    technology: "Communication",
    topic: "Workplace Conflict & Critical Situations",
    difficulty: "intermediate",
    question: "Describe a situation where a critical software defect was identified right before launch. How did you communicate with stakeholders and resolve it under pressure?",
    expectedKeypoints: ["STAR method", "Transparency with stakeholders", "Root-cause analysis", "Post-mortem and prevention"],
    idealAnswer: "Outline the incident using STAR: Explain how you triaged the issue, communicated transparently to project leads without panic, isolated the root cause, implemented a tested patch, and conducted a blameless post-mortem.",
    tags: ["Communication", "Behavioral", "STAR Method"]
  },
  {
    id: "qb-09",
    technology: "HR",
    topic: "Behavioral & Leadership",
    difficulty: "beginner",
    question: "Tell me about a challenging technical hurdle you encountered in a team project and how you resolved it.",
    expectedKeypoints: ["STAR format", "Clear technical decision making", "Team communication"],
    idealAnswer: "Use the STAR format: Describe the exact technical challenge, specify your ownership role, break down the systematic diagnostics and code changes you delivered, and quantify the resulting performance boost.",
    tags: ["HR", "Behavioral", "Culture Fit"]
  },
  {
    id: "qb-10",
    technology: "JavaScript",
    topic: "Event Loop & Concurrency",
    difficulty: "intermediate",
    question: "How does the JavaScript runtime event loop distinguish between the call stack, microtask queue, and macrotask queue?",
    expectedKeypoints: ["Call stack execution to completion", "Microtask queue (Promises, queueMicrotask, MutationObserver)", "Macrotask queue (setTimeout, setInterval, I/O)", "Microtask drain before next macrotask"],
    idealAnswer: "JavaScript executes synchronous code on the single-threaded Call Stack until empty. The Event Loop then executes ALL queued microtasks (Promise reactions, queueMicrotask) completely until the microtask queue is empty before picking a single task from the macrotask queue (setTimeout, setInterval).",
    tags: ["JavaScript", "Event Loop", "Microtasks", "Async"]
  },
  {
    id: "qb-11",
    technology: "JavaScript",
    topic: "Closures & Scope Chain",
    difficulty: "beginner",
    question: "What is a closure in JavaScript and what are practical use cases and memory leak risks associated with them?",
    expectedKeypoints: ["Function lexical environment binding", "Encapsulation / private state", "Memory retention when references persist"],
    idealAnswer: "A closure is the combination of a function bundled together with references to its surrounding lexical environment. Practical use cases include data privacy, function currying, and memoization. Memory risks arise when unused outer variables are retained by long-lived closures or event listeners.",
    tags: ["JavaScript", "Closures", "Scope", "Memory"]
  },
  {
    id: "qb-12",
    technology: "Object-Oriented Programming",
    topic: "SOLID Principles",
    difficulty: "intermediate",
    question: "Explain the Liskov Substitution Principle (LSP) and provide an architectural scenario where violating it breaks caller expectations.",
    expectedKeypoints: ["Subtypes must be substitutable for supertypes", "Preconditions cannot be strengthened", "Postconditions cannot be weakened", "Classic Square extending Rectangle violation"],
    idealAnswer: "Liskov Substitution states that objects of a superclass should be replaceable with objects of its subclasses without altering application correctness. Violating LSP occurs when a Square subclass overrides setWidth and setHeight of Rectangle, mutating both dimensions and breaking client assumptions about independent height and width mutability.",
    tags: ["OOP", "SOLID", "Architecture", "Design Principles"]
  },
  {
    id: "qb-13",
    technology: "Database Management Systems",
    topic: "ACID & Transaction Isolation",
    difficulty: "intermediate",
    question: "Explain the four standard SQL transaction isolation levels and what read phenomena (Dirty Read, Non-Repeatable Read, Phantom Read) each prevents.",
    expectedKeypoints: ["Read Uncommitted (allows dirty reads)", "Read Committed (prevents dirty reads)", "Repeatable Read (prevents non-repeatable reads)", "Serializable (prevents phantom reads via range locks or SSI)"],
    idealAnswer: "Read Uncommitted allows transactions to read uncommitted dirty data. Read Committed guarantees that any data read was committed, preventing dirty reads. Repeatable Read ensures queries re-reading data see identical row values, preventing non-repeatable reads. Serializable is the strictest level, preventing phantom rows by locking ranges or using Serializable Snapshot Isolation (SSI).",
    tags: ["DBMS", "SQL", "ACID", "Transactions", "Concurrency"]
  },
  {
    id: "qb-14",
    technology: "Operating Systems",
    topic: "Processes, Threads & Virtual Memory",
    difficulty: "intermediate",
    question: "What are the architectural differences between a process and a thread, and how does the MMU manage virtual memory paging?",
    expectedKeypoints: ["Separate address space vs shared memory", "Context switch overhead difference", "Page table and Translation Lookaside Buffer (TLB)", "Page fault interrupt mechanics"],
    idealAnswer: "A process is an independent execution unit with its own virtual address space, file descriptors, and security context. Threads reside within a process, sharing code, heap, and global variables while possessing distinct registers and stacks. The Memory Management Unit (MMU) uses page tables and the hardware TLB to translate virtual to physical addresses, triggering a page fault interrupt if an unmapped or swapped page is accessed.",
    tags: ["Operating Systems", "Processes", "Threads", "Virtual Memory", "Paging"]
  },
  {
    id: "qb-15",
    technology: "Operating Systems",
    topic: "Deadlock Conditions",
    difficulty: "advanced",
    question: "What are the four Coffman conditions necessary for a deadlock to occur, and how can an engineering team break at least one to prevent deadlocks?",
    expectedKeypoints: ["Mutual exclusion", "Hold and wait", "No preemption", "Circular wait", "Resource ordering strategy"],
    idealAnswer: "The four Coffman conditions are: Mutual Exclusion, Hold and Wait, No Preemption, and Circular Wait. The most common prevention strategy is eliminating Circular Wait by establishing a strict global total ordering of all lock acquisitions throughout the system, ensuring every component acquires locks in identical sequence.",
    tags: ["Operating Systems", "Deadlock", "Concurrency", "Locks"]
  },
  {
    id: "qb-16",
    technology: "Computer Networks",
    topic: "TCP/IP & Transport Protocols",
    difficulty: "intermediate",
    question: "Walk through the TCP three-way handshake and describe why HTTP/3 transitioned from TCP to QUIC over UDP.",
    expectedKeypoints: ["SYN, SYN-ACK, ACK handshake", "Head-of-Line (HoL) blocking in TCP", "QUIC independent streams over UDP", "0-RTT / 1-RTT connection establishment"],
    idealAnswer: "TCP initiates connections via SYN (seq x), SYN-ACK (ack x+1, seq y), and ACK (ack y+1). HTTP/2 multiplexed streams over a single TCP connection, but experienced Head-of-Line (HoL) blocking whenever packet loss stalled all multiplexed streams. HTTP/3 adopted QUIC over UDP, ensuring packet loss on one stream does not block unrelated concurrent streams, while combining cryptographic TLS 1.3 handshake into connection establishment.",
    tags: ["Computer Networks", "TCP", "QUIC", "HTTP3", "UDP"]
  },
  {
    id: "qb-17",
    technology: "System Design",
    topic: "Distributed Systems & Scalability",
    difficulty: "advanced",
    question: "How would you architect a distributed rate limiter capable of handling 500,000 requests per second across multi-region edge gateways?",
    expectedKeypoints: ["Token Bucket or Sliding Window Log", "Redis cluster or local in-memory token counters", "Centralized vs decentralized edge sync", "Graceful degradation on datastore latency"],
    idealAnswer: "We deploy a Sliding Window Counter algorithm with Redis using Lua scripts for atomicity. To avoid cross-region latency bottlenecks at 500k RPS, edge proxies maintain localized token quotas refreshed asynchronously from regional Redis instances, failing open or degrading gracefully to localized in-memory rate limiting if network partitions arise.",
    tags: ["System Design", "Rate Limiter", "Scalability", "Distributed Systems"]
  },
  {
    id: "qb-18",
    technology: "Web Development",
    topic: "Rendering Architecture & Security",
    difficulty: "intermediate",
    question: "Contrast Client-Side Rendering (CSR), Server-Side Rendering (SSR), and Incremental Static Regeneration (ISR). How do you mitigate Cross-Site Scripting (XSS)?",
    expectedKeypoints: ["CSR initial bundle cost vs SSR time to first byte", "ISR background regeneration on cache miss", "Context-aware output encoding", "Content Security Policy (CSP) headers"],
    idealAnswer: "CSR shifts rendering to browser JavaScript, incurring larger initial download but fast subsequent interactions. SSR compiles HTML on each server request, improving SEO and Time-to-First-Byte (TTFB). ISR serves cached static pages and regenerates them in the background after revalidation windows. XSS is mitigated through context-aware output encoding, strict Content Security Policy (CSP) headers, and avoiding raw dangerouslySetInnerHTML.",
    tags: ["Web Development", "Next.js", "SSR", "Security", "XSS"]
  },
  {
    id: "qb-19",
    technology: "Python",
    topic: "Asyncio & Concurrency",
    difficulty: "advanced",
    question: "How does the asyncio event loop coordinate coroutines, and when would you select multiprocessing over asyncio in Python?",
    expectedKeypoints: ["Single-threaded cooperative multitasking", "await yields control to event loop", "I/O-bound tasks vs CPU-bound tasks", "multiprocessing bypasses GIL"],
    idealAnswer: "Python asyncio uses a single-threaded event loop employing cooperative multitasking: when a coroutine hits an await on non-blocking I/O, control yields back to the loop to run other scheduled tasks. For CPU-bound tasks (e.g. data processing, machine learning), asyncio cannot parallelize execution due to the GIL; multiprocessing must be chosen to spawn separate OS processes with independent GILs.",
    tags: ["Python", "Asyncio", "GIL", "Concurrency"]
  }
];
var defaultInterviews = [];
var InterviewStore = class {
  students = [...defaultStudents];
  trainers = [...defaultTrainers];
  batches = [...defaultBatches];
  questionBank = [...defaultQuestionBank];
  interviews = [...defaultInterviews];
  constructor() {
    this.loadFromDisk();
  }
  loadFromDisk() {
    const paths = getPersistencePaths2("linkview_interviews_persistent_cache.json");
    for (const p of paths) {
      try {
        if (fs2.existsSync(p)) {
          const raw = fs2.readFileSync(p, "utf-8");
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed.interviews)) this.interviews = parsed.interviews;
          if (Array.isArray(parsed.batches) && parsed.batches.length > 0) this.batches = parsed.batches;
          if (Array.isArray(parsed.students)) this.students = parsed.students;
          if (Array.isArray(parsed.trainers)) this.trainers = parsed.trainers;
          if (Array.isArray(parsed.questionBank) && parsed.questionBank.length > 0) {
            this.questionBank = parsed.questionBank;
          }
          return;
        }
      } catch (e) {
        console.warn(`Could not read persistent interviews cache from ${p}:`, e);
      }
    }
  }
  saveToDisk() {
    const paths = getPersistencePaths2("linkview_interviews_persistent_cache.json");
    for (const p of paths) {
      try {
        fs2.writeFileSync(
          p,
          JSON.stringify(
            {
              interviews: this.interviews,
              batches: this.batches,
              students: this.students,
              trainers: this.trainers,
              questionBank: this.questionBank
            },
            null,
            2
          ),
          "utf-8"
        );
      } catch (e) {
      }
    }
  }
  // Request & Approval Lifecycle for Protected Mock Interviews
  requestInterviewApproval(interviewId) {
    const interview = this.interviews.find((i) => i.id === interviewId);
    if (!interview) return null;
    interview.approvalStatus = "pending";
    interview.approvalRequestedAt = (/* @__PURE__ */ new Date()).toISOString();
    this.saveToDisk();
    return interview;
  }
  approveInterview(interviewId, trainerName = "Faculty Trainer") {
    const interview = this.interviews.find((i) => i.id === interviewId);
    if (!interview) return null;
    interview.approvalStatus = "approved";
    interview.approvalDecisionAt = (/* @__PURE__ */ new Date()).toISOString();
    interview.approvedByTrainer = trainerName;
    this.saveToDisk();
    return interview;
  }
  rejectInterview(interviewId, trainerName = "Faculty Trainer", reason) {
    const interview = this.interviews.find((i) => i.id === interviewId);
    if (!interview) return null;
    interview.approvalStatus = "rejected";
    interview.approvalDecisionAt = (/* @__PURE__ */ new Date()).toISOString();
    interview.approvedByTrainer = trainerName;
    interview.rejectionReason = reason || "Trainer declined candidate mock start request";
    this.saveToDisk();
    return interview;
  }
  deleteInterview(interviewId) {
    const idx = this.interviews.findIndex((i) => i.id === interviewId);
    if (idx !== -1) {
      this.interviews.splice(idx, 1);
      this.saveToDisk();
      return true;
    }
    return false;
  }
  // Batches management with persistence
  addBatch(batch) {
    const tech = batch.technology || batch.course || "Technical";
    const newBatch = {
      id: `batch-${Date.now().toString().slice(-4)}`,
      name: batch.name,
      code: batch.code.toUpperCase(),
      technology: tech,
      course: tech,
      description: batch.description || "",
      trainerId: batch.trainerId || "tr-lead",
      trainerName: batch.trainerName || "Rahul Sir (Lead Faculty)",
      trainerEmail: batch.trainerEmail || "rahul.sir@linktest.io",
      studentCount: batch.students ? batch.students.length : 0,
      students: batch.students || [],
      startDate: batch.startDate || (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
      endDate: batch.endDate || "",
      timing: batch.timing || "Morning (09:00 - 11:00 AM)",
      status: batch.status?.toLowerCase() === "upcoming" ? "upcoming" : "ongoing"
    };
    this.batches.unshift(newBatch);
    this.saveToDisk();
    return newBatch;
  }
  getBatchById(idOrCode) {
    const norm = (idOrCode || "").trim().toUpperCase();
    return this.batches.find((b) => b.id.toUpperCase() === norm || b.code.toUpperCase() === norm) || null;
  }
  updateBatch(batchIdOrCode, updates) {
    const norm = (batchIdOrCode || "").trim().toUpperCase();
    const batch = this.batches.find((b) => b.id.toUpperCase() === norm || b.code.toUpperCase() === norm);
    if (!batch) return null;
    if (updates.name) batch.name = updates.name;
    if (updates.code) batch.code = updates.code.toUpperCase();
    if (updates.technology || updates.course) {
      batch.technology = updates.technology || updates.course;
      batch.course = batch.technology;
    }
    if (updates.description !== void 0) batch.description = updates.description;
    if (updates.startDate) batch.startDate = updates.startDate;
    if (updates.endDate !== void 0) batch.endDate = updates.endDate;
    if (updates.timing) batch.timing = updates.timing;
    if (updates.status) batch.status = updates.status;
    if (updates.trainerId) batch.trainerId = updates.trainerId;
    if (updates.trainerName) batch.trainerName = updates.trainerName;
    if (updates.trainerEmail) batch.trainerEmail = updates.trainerEmail;
    if (Array.isArray(updates.students)) {
      batch.students = updates.students;
      batch.studentCount = updates.students.length;
    }
    this.saveToDisk();
    return batch;
  }
  deleteBatch(batchId) {
    const idx = this.batches.findIndex((b) => b.id === batchId || b.code === batchId);
    if (idx !== -1) {
      this.batches.splice(idx, 1);
      this.saveToDisk();
      return true;
    }
    return false;
  }
  enrollStudentInBatch(batchIdOrCode, studentEmail) {
    const norm = batchIdOrCode.trim().toUpperCase();
    const batch = this.batches.find((b) => b.id.toUpperCase() === norm || b.code.toUpperCase() === norm);
    if (!batch) return null;
    if (!Array.isArray(batch.students)) {
      batch.students = [];
    }
    const cleanEmail = studentEmail.trim().toLowerCase();
    if (!batch.students.map((e) => e.toLowerCase()).includes(cleanEmail)) {
      batch.students.push(cleanEmail);
      batch.studentCount = batch.students.length;
      this.saveToDisk();
    }
    return batch;
  }
  removeStudentFromBatch(batchIdOrCode, studentEmail) {
    const norm = batchIdOrCode.trim().toUpperCase();
    const batch = this.batches.find((b) => b.id.toUpperCase() === norm || b.code.toUpperCase() === norm);
    if (!batch) return null;
    if (Array.isArray(batch.students)) {
      const cleanEmail = studentEmail.trim().toLowerCase();
      batch.students = batch.students.filter((e) => e.toLowerCase() !== cleanEmail);
      batch.studentCount = batch.students.length;
      this.saveToDisk();
    }
    return batch;
  }
  getPendingApprovals() {
    return this.interviews.filter((i) => i.approvalStatus === "pending");
  }
  // Admin / Institute Metrics — 100% computed from real database records
  getAdminStats() {
    const allUsers = getAllUsers();
    const students = allUsers.filter((u) => u.role === "student");
    const trainers = allUsers.filter((u) => u.role === "trainer");
    const totalStudents = students.length;
    const totalTrainers = trainers.length;
    const activeStudents = students.filter((s) => s.status === "active").length;
    const unassignedStudents = students.filter(
      (s) => !s.batchCode || s.batchCode === "UNASSIGNED" || s.batchCode === "GLOBAL"
    ).length;
    const totalBatches = this.batches.length;
    const totalInterviews = this.interviews.length;
    const completed = this.interviews.filter((i) => i.status === "completed").length;
    const upcoming = this.interviews.filter((i) => i.status === "scheduled").length;
    const pendingRequests = this.interviews.filter((i) => i.approvalStatus === "pending").length;
    const approvedRequests = this.interviews.filter((i) => i.approvalStatus === "approved").length;
    const pendingEvaluations = this.interviews.filter((i) => i.status === "pending_evaluation").length;
    const completedWithScore = this.interviews.filter((i) => i.scorecard && i.scorecard.overallScore > 0);
    const avgScore = completedWithScore.length > 0 ? Math.round(
      completedWithScore.reduce((acc, curr) => acc + (curr.scorecard?.overallScore || 0), 0) / completedWithScore.length
    ) : 0;
    return {
      totalStudents,
      totalTrainers,
      activeStudents,
      unassignedStudents,
      totalBatches,
      totalInterviews,
      completed,
      upcoming,
      pendingRequests,
      approvedRequests,
      pendingEvaluations,
      avgScore,
      recentActivity: this.interviews.map((i) => ({
        id: i.id,
        studentName: i.studentName,
        studentEmail: i.studentEmail,
        technology: i.technology,
        difficulty: i.difficulty,
        status: i.status,
        approvalStatus: i.approvalStatus || "not_requested",
        score: i.scorecard?.overallScore ?? (i.history.length > 0 ? Math.round(i.history.reduce((a, b) => a + b.score, 0) / i.history.length * 10) : null),
        scheduledAt: i.scheduledAt
      })),
      health: {
        database: "connected",
        apiServer: "online",
        auth: "operational",
        speechRecognition: "operational",
        speechSynthesis: "operational",
        aiEngine: "gemini-1.5-flash"
      }
    };
  }
  // Trainer queries — scoped to trainer identity
  getTrainerDashboard(trainerEmail) {
    const allUsers = getAllUsers();
    const students = allUsers.filter((u) => u.role === "student");
    let assignedBatches = this.batches;
    if (trainerEmail) {
      const normEmail = trainerEmail.trim().toLowerCase();
      assignedBatches = this.batches.filter(
        (b) => b.trainerId.toLowerCase() === normEmail || b.trainerName.toLowerCase().includes(normEmail)
      );
      if (assignedBatches.length === 0) {
        assignedBatches = this.batches;
      }
    }
    const assignedBatchCodes = assignedBatches.map((b) => b.code.toUpperCase());
    const assignedStudents = students.filter(
      (s) => s.batchCode && assignedBatchCodes.includes(s.batchCode.toUpperCase())
    );
    const trainerInterviews = this.interviews.filter((i) => {
      if (!trainerEmail) return true;
      const norm = trainerEmail.toLowerCase();
      return i.trainerId.toLowerCase() === norm || i.trainerName.toLowerCase().includes(norm) || assignedBatchCodes.includes(i.batchName?.toUpperCase() || "");
    });
    return {
      assignedBatchesCount: assignedBatches.length,
      assignedStudentsCount: assignedStudents.length,
      assignedBatches,
      assignedStudents,
      scheduledCount: trainerInterviews.filter((i) => i.status === "scheduled").length,
      completedCount: trainerInterviews.filter((i) => i.status === "completed").length,
      pendingRequestsCount: trainerInterviews.filter((i) => i.approvalStatus === "pending").length,
      pendingEvaluations: trainerInterviews.filter((i) => i.status === "pending_evaluation"),
      todaySchedule: trainerInterviews.filter((i) => i.status === "scheduled"),
      recentInterviews: trainerInterviews.slice(0, 8)
    };
  }
  // Student queries - dynamic and scoped strictly to candidate's own email and enrolled batch
  getStudentDashboard(studentEmail) {
    if (!studentEmail) {
      return {
        student: null,
        nextScheduledInterview: null,
        upcomingInterviews: [],
        completedInterviews: [],
        freeCommunicationTracks: [],
        readinessScore: 0,
        curriculumTracks: []
      };
    }
    const normEmail = studentEmail.trim().toLowerCase();
    const allUsers = getAllUsers();
    const registeredUser = allUsers.find((u) => u.email.toLowerCase() === normEmail);
    const assignedBatch = this.batches.find(
      (b) => registeredUser?.batchCode && b.code.toUpperCase() === registeredUser.batchCode.toUpperCase() || Array.isArray(b.students) && b.students.some((e) => e.toLowerCase() === normEmail)
    );
    const student = {
      id: registeredUser?.id || `std-${normEmail}`,
      fullName: registeredUser?.fullName || normEmail.split("@")[0],
      email: normEmail,
      phone: "",
      batchId: assignedBatch ? assignedBatch.id : "",
      batchName: assignedBatch ? assignedBatch.name : registeredUser?.batchCode || "UNASSIGNED",
      technology: assignedBatch ? assignedBatch.technology : "General",
      status: registeredUser?.status || "active",
      interviewsCompleted: 0,
      averageScore: 0,
      joinedDate: registeredUser?.joinedAt || (/* @__PURE__ */ new Date()).toISOString().split("T")[0]
    };
    const studentInterviews = this.interviews.filter(
      (i) => i.studentEmail.toLowerCase() === normEmail || i.studentId === student.id || assignedBatch && (i.batchId === assignedBatch.id || i.batchName === assignedBatch.name || i.batchName === assignedBatch.code)
    );
    const upcoming = studentInterviews.filter((i) => i.status === "scheduled").sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()).map((i) => ({
      ...i,
      availability: this.getInterviewAvailability(i.scheduledAt, i.durationMinutes)
    }));
    const nextScheduled = upcoming.length > 0 ? upcoming[0] : null;
    const completed = studentInterviews.filter((i) => i.status === "completed").sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());
    student.interviewsCompleted = completed.length;
    if (completed.length > 0) {
      const totalScore = completed.reduce((sum, item) => sum + (item.scorecard?.overallScore || 0), 0);
      student.averageScore = Math.round(totalScore / completed.length);
    }
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1e3;
    const interviewsThisWeek = completed.filter((i) => {
      const ts = new Date(i.scheduledAt).getTime();
      return !isNaN(ts) && ts >= oneWeekAgo;
    }).length;
    const totalAssigned = studentInterviews.length;
    const completionRate = totalAssigned > 0 ? Math.round(completed.length / totalAssigned * 100) : 0;
    const techScores = {};
    completed.forEach((i) => {
      const tech = i.technology || "General";
      const score = i.scorecard?.overallScore || 0;
      if (!techScores[tech]) techScores[tech] = { total: 0, count: 0 };
      techScores[tech].total += score;
      techScores[tech].count += 1;
    });
    const categoryStats = Object.entries(techScores).map(([tech, stat]) => ({
      name: tech,
      score: Math.round(stat.total / stat.count)
    }));
    categoryStats.sort((a, b) => b.score - a.score);
    const strongestSkills = categoryStats.filter((c) => c.score >= 70).map((c) => c.name);
    const skillsToImprove = categoryStats.filter((c) => c.score < 70).map((c) => c.name);
    if (strongestSkills.length === 0 && completed.length > 0) {
      strongestSkills.push(categoryStats[0]?.name || "Problem Solving");
    }
    if (skillsToImprove.length === 0 && completed.length > 0 && categoryStats.length > 1) {
      skillsToImprove.push(categoryStats[categoryStats.length - 1]?.name || "Asymptotic Analysis");
    }
    const recentTrend = completed.slice(0, 5).map((i) => ({
      date: i.scheduledAt ? new Date(i.scheduledAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "Recent",
      score: i.scorecard?.overallScore || 75,
      technology: i.technology
    }));
    const recommendedNext = skillsToImprove.length > 0 ? `Targeted Mock: ${skillsToImprove[0]} Deep Dive` : completed.length > 0 ? "Advanced Full-Stack & System Design Simulation" : "Foundational Technical Viva (Python / DSA)";
    return {
      student,
      nextScheduledInterview: nextScheduled,
      upcomingInterviews: upcoming,
      completedInterviews: completed,
      freeCommunicationTracks: [],
      readinessScore: student.averageScore || 0,
      interviewsCompleted: completed.length,
      interviewsThisWeek,
      completionRate,
      strongestSkills,
      skillsToImprove,
      recentTrend,
      recommendedNext,
      curriculumTracks: [
        {
          name: assignedBatch ? assignedBatch.technology : "Core Foundations",
          progress: completed.length > 0 ? Math.min(100, completed.length * 50) : 0,
          mastery: completed.length > 0 ? "Verified" : "Unattempted"
        }
      ]
    };
  }
  // CRUD & Scheduling
  getStudents() {
    return this.students;
  }
  getTrainers() {
    return this.trainers;
  }
  getBatches() {
    this.loadFromDisk();
    return this.batches;
  }
  getQuestionBank() {
    this.loadFromDisk();
    return this.questionBank;
  }
  getInterviews() {
    this.loadFromDisk();
    return this.interviews;
  }
  getInterviewById(id) {
    return this.interviews.find((i) => i.id === id) || null;
  }
  addQuestion(item) {
    const newItem = {
      id: item.id || `qb-custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      technology: item.technology,
      topic: item.topic || "Custom Topics",
      difficulty: item.difficulty || "intermediate",
      question: item.question,
      expectedKeypoints: item.expectedKeypoints || [],
      idealAnswer: item.idealAnswer || "",
      tags: item.tags || [item.technology, "CustomImport"]
    };
    this.questionBank.unshift(newItem);
    this.saveToDisk();
    return newItem;
  }
  addBulkQuestions(items) {
    const added = items.map((item) => this.addQuestion(item));
    this.saveToDisk();
    return added;
  }
  deleteQuestion(id) {
    const index = this.questionBank.findIndex((q) => q.id === id);
    if (index !== -1) {
      this.questionBank.splice(index, 1);
      this.saveToDisk();
      return true;
    }
    return false;
  }
  scheduleInterview(data) {
    const newId = data.id || `int-2026-${String(this.interviews.length + 1).padStart(3, "0")}`;
    const student = this.students.find((s) => s.id === data.studentId) || {
      id: data.studentId || "student-active",
      fullName: data.studentName || "Enrolled Student",
      email: data.studentEmail || "student@linktest.io",
      batchId: data.batchId || "GLOBAL",
      batchName: data.batchName || "Placement Cohort"
    };
    const trainer = this.trainers.find((t) => t.id === data.trainerId) || {
      id: data.trainerId || "tr-lead",
      fullName: data.trainerName || "Rahul Sir (Lead)"
    };
    const tech = data.technology || "Python";
    const matchingQuestions = this.questionBank.filter((q) => q.technology.toLowerCase() === tech.toLowerCase());
    const customList = data.customQuestions && data.customQuestions.length > 0 ? data.customQuestions : null;
    const initialQuestion = customList ? customList[0] : matchingQuestions[0]?.question || `Can you introduce your experience with ${tech} and core projects?`;
    const count = customList ? customList.length : data.questionCount || 3;
    const matchedBatch = this.batches.find((b) => b.id === data.batchId || b.code === data.batchId);
    const newRecord = {
      id: newId,
      studentId: student.id,
      studentName: student.fullName,
      studentEmail: student.email,
      trainerId: trainer.id,
      trainerName: trainer.fullName,
      batchId: data.batchId || student.batchId,
      batchName: matchedBatch ? matchedBatch.name : data.batchName || student.batchName,
      technology: tech,
      interviewType: data.interviewType || "technical",
      difficulty: data.difficulty || "intermediate",
      durationMinutes: data.durationMinutes || 30,
      questionCount: count,
      scheduledAt: data.scheduledAt || new Date(Date.now() + 864e5).toISOString(),
      status: "scheduled",
      approvalStatus: "not_requested",
      currentTurn: 1,
      totalTurns: count,
      currentQuestion: initialQuestion,
      customQuestions: customList || void 0,
      history: []
    };
    this.interviews.unshift(newRecord);
    this.saveToDisk();
    return newRecord;
  }
  updateInterviewTurn(id, answer, score, feedback, nextQuestion, customScorecard) {
    const interview = this.interviews.find((i) => i.id === id);
    if (!interview) return null;
    interview.history.push({
      turn: interview.currentTurn,
      question: interview.currentQuestion,
      studentAnswer: answer,
      score,
      feedback
    });
    if (interview.currentTurn < interview.totalTurns && nextQuestion) {
      interview.currentTurn += 1;
      interview.currentQuestion = nextQuestion;
    } else {
      interview.status = "completed";
      if (customScorecard) {
        interview.scorecard = customScorecard;
      } else {
        const historyLen = Math.max(1, interview.history.length);
        const avg = Math.round(
          interview.history.reduce((a, b) => a + (Number(b.score) || 0), 0) / historyLen * 10
        );
        interview.scorecard = {
          overallScore: avg,
          technicalAccuracy: Math.min(98, Math.max(30, avg)),
          conceptualUnderstanding: Math.min(95, Math.max(25, avg - 2)),
          communication: Math.min(95, Math.max(40, avg + 3)),
          problemSolving: Math.min(96, Math.max(25, avg - 1)),
          strengths: [
            `Demonstrated structured conceptual explanation on ${interview.technology || "core topics"}`,
            "Clear technical vocabulary and terminology"
          ],
          weaknesses: [
            "Incorporate deeper runtime complexity trade-offs and edge-case handling"
          ],
          recommendations: [
            `Practice mock viva interview questions on ${interview.technology || "internals"} and system limits`
          ],
          aiFeedback: `Candidate completed all questions with an overall score of ${avg}%.`,
          evaluatedAt: (/* @__PURE__ */ new Date()).toISOString()
        };
      }
    }
    this.saveToDisk();
    return interview;
  }
  addTrainerRemarks(id, remarks, approved = true) {
    const interview = this.interviews.find((i) => i.id === id);
    if (!interview) return null;
    if (!interview.scorecard) {
      const avg = interview.history.length > 0 ? Math.round(interview.history.reduce((a, b) => a + b.score, 0) / interview.history.length * 10) : 80;
      interview.scorecard = {
        overallScore: avg,
        technicalAccuracy: avg,
        conceptualUnderstanding: avg,
        communication: avg,
        problemSolving: avg,
        strengths: ["Solid foundation in core subject principles"],
        weaknesses: ["Elaborate with concrete architectural examples"],
        recommendations: ["Revise distributed data access patterns"],
        aiFeedback: "Evaluated by institute AI model and verified by trainer.",
        evaluatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
    }
    interview.scorecard.trainerRemarks = remarks;
    if (approved) {
      interview.status = "completed";
    }
    this.saveToDisk();
    return interview;
  }
  // Atomic Proctoring Flag Recorder & Threshold Enforcer (Rule 4.3: strictly > 3 flags => 4th flag submits)
  recordProctoringFlag(id, eventData, currentTranscript) {
    let interview = this.interviews.find((i) => i.id === id);
    if (!interview) {
      interview = {
        id,
        studentId: "std-aarav-01",
        studentName: "Aarav Sharma",
        studentEmail: "aarav.sharma@linktest.io",
        trainerId: "tr-rahul-01",
        trainerName: "Rahul Sir (Lead Faculty)",
        batchId: "BATCH-PY-2026",
        batchName: "Python Full Stack Placement Cohort 2026-A",
        technology: "Python",
        interviewType: "technical",
        difficulty: "intermediate",
        durationMinutes: 30,
        questionCount: 3,
        scheduledAt: (/* @__PURE__ */ new Date()).toISOString(),
        status: "in_progress",
        currentTurn: 1,
        totalTurns: 3,
        currentQuestion: "Explain Python memory management.",
        history: [],
        flagCount: 0,
        maxAllowedFlags: 3,
        proctoringEvents: []
      };
      this.interviews.unshift(interview);
    }
    if (!interview.proctoringEvents) interview.proctoringEvents = [];
    if (interview.flagCount === void 0) interview.flagCount = 0;
    const maxAllowed = interview.maxAllowedFlags ?? 3;
    if (interview.status === "completed" && interview.submissionReason === "proctoring_threshold_exceeded") {
      return {
        success: true,
        autoSubmitted: true,
        flagCount: interview.flagCount,
        maxAllowedFlags: maxAllowed,
        remainingFlags: 0,
        event: {
          id: `proc_existing_${Date.now()}`,
          type: eventData.type,
          severity: eventData.severity,
          message: eventData.message,
          timestamp: (/* @__PURE__ */ new Date()).toLocaleTimeString(),
          durationSeconds: eventData.durationSeconds
        },
        session: interview,
        message: "Interview has already been auto-submitted due to proctoring violations."
      };
    }
    const now = Date.now();
    const lastEvent = interview.proctoringEvents[interview.proctoringEvents.length - 1];
    if (lastEvent && lastEvent.type === eventData.type) {
    }
    const event = {
      id: `proc_${now}_${Math.random().toString(36).substring(2, 6)}`,
      type: eventData.type,
      severity: eventData.severity,
      message: eventData.message,
      timestamp: (/* @__PURE__ */ new Date()).toLocaleTimeString(),
      durationSeconds: eventData.durationSeconds
    };
    interview.proctoringEvents.push(event);
    interview.flagCount += 1;
    if (interview.flagCount > maxAllowed) {
      interview.status = "completed";
      interview.submissionReason = "proctoring_threshold_exceeded";
      interview.autoSubmittedAt = (/* @__PURE__ */ new Date()).toISOString();
      if (currentTranscript && currentTranscript.trim().length > 0) {
        interview.history.push({
          turn: interview.currentTurn,
          question: interview.currentQuestion,
          studentAnswer: currentTranscript.trim(),
          score: 5,
          feedback: "Partial verbal answer captured at point of automatic proctoring termination."
        });
      }
      const turnsCompleted = interview.history.length;
      const baseScore = turnsCompleted > 0 ? Math.round(interview.history.reduce((a, b) => a + b.score, 0) / turnsCompleted * 8) : 45;
      interview.scorecard = {
        overallScore: Math.min(60, baseScore),
        technicalAccuracy: Math.min(65, baseScore),
        conceptualUnderstanding: Math.min(60, baseScore),
        communication: 50,
        problemSolving: 55,
        strengths: ["Candidate attempted initial question under proctored test conditions"],
        weaknesses: ["Exceeded maximum allowed security flags (4 confirmed proctoring flags)"],
        recommendations: ["Maintain camera focus and avoid tab switches in subsequent interview sessions"],
        aiFeedback: "Assessment auto-submitted: Maximum proctoring flags exceeded during live session.",
        trainerRemarks: "Proctoring threshold reached. Requires faculty audit.",
        evaluatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        proctoringSummary: {
          totalFlags: interview.flagCount,
          tabSwitches: interview.proctoringEvents.filter((e) => e.type === "tab_switch" || e.type === "window_blur").length,
          faceMissingCount: interview.proctoringEvents.filter((e) => e.type === "face_missing").length,
          riskLevel: "high"
        }
      };
      return {
        success: true,
        autoSubmitted: true,
        flagCount: interview.flagCount,
        maxAllowedFlags: maxAllowed,
        remainingFlags: 0,
        event,
        session: interview,
        message: "Maximum proctoring flags exceeded. Interview automatically submitted."
      };
    }
    const remaining = Math.max(0, maxAllowed - interview.flagCount + 1);
    return {
      success: true,
      autoSubmitted: false,
      flagCount: interview.flagCount,
      maxAllowedFlags: maxAllowed,
      remainingFlags: remaining,
      event,
      session: interview
    };
  }
  // Authoritative server-side schedule availability logic (Rule 2.1.C)
  getInterviewAvailability(scheduledAt, durationMinutes = 30) {
    const now = Date.now();
    const scheduledTime = new Date(scheduledAt).getTime();
    const windowStart = scheduledTime - 15 * 60 * 1e3;
    const windowEnd = scheduledTime + (durationMinutes + 90) * 60 * 1e3;
    if (now < windowStart) {
      const diffSec = Math.round((windowStart - now) / 1e3);
      const hours = Math.floor(diffSec / 3600);
      const mins = Math.floor(diffSec % 3600 / 60);
      const formatted = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
      return {
        status: "future",
        countdownSeconds: diffSec,
        formattedTimeLeft: `Opens in ${formatted}`,
        allowedJoinWindowMinutes: 15,
        canJoin: false
      };
    }
    if (now > windowEnd) {
      return {
        status: "expired",
        countdownSeconds: 0,
        formattedTimeLeft: "Session Window Expired",
        allowedJoinWindowMinutes: 15,
        canJoin: false
      };
    }
    return {
      status: "available",
      countdownSeconds: 0,
      formattedTimeLeft: "Available to Join Now",
      allowedJoinWindowMinutes: 15,
      canJoin: true
    };
  }
};
var interviewStore = new InterviewStore();

// src/lib/ai.ts
function getApiKey() {
  const geminiKey = process.env.GEMINI_API_KEY || (process.env.AI_PROVIDER_MODEL?.includes("gemini") ? process.env.AI_PROVIDER_API_KEY : "");
  if (geminiKey) return { key: geminiKey, provider: "gemini" };
  const openaiKey = process.env.OPENAI_API_KEY || (process.env.AI_PROVIDER_MODEL?.includes("gpt") ? process.env.AI_PROVIDER_API_KEY : "");
  if (openaiKey) return { key: openaiKey, provider: "openai" };
  const generalKey = process.env.AI_PROVIDER_API_KEY;
  if (generalKey) {
    if (generalKey.startsWith("AIza")) return { key: generalKey, provider: "gemini" };
    return { key: generalKey, provider: "openai" };
  }
  return { key: "", provider: "none" };
}
async function evaluateAIInterviewAnswer(question, answer, track, expectedKeypoints) {
  const cleanAnswer = (answer || "").trim();
  if (cleanAnswer.length < 10) {
    return {
      score: 1,
      technicalAccuracy: 10,
      conceptualDepth: 10,
      communication: 20,
      completeness: 10,
      feedback: "No substantive verbal or written response was provided for this technical question.",
      strengths: ["Prompt acknowledged by candidate"],
      weaknesses: ["Failed to articulate technical mechanics or architectural definitions"],
      recommendations: ["Review foundational principles and practice verbalizing definitions"],
      matchedKeypoints: [],
      missingKeypoints: expectedKeypoints || []
    };
  }
  const { key, provider } = getApiKey();
  if (key && provider !== "none") {
    const prompt = `You are a Principal Software Architect evaluating an engineering candidate's interview response.
Track: "${track}"
Interview Question: "${question}"
Candidate Spoken Answer: "${cleanAnswer}"
${expectedKeypoints && expectedKeypoints.length > 0 ? `Expected Keypoints: ${expectedKeypoints.join(", ")}` : ""}

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
      if (provider === "gemini") {
        const model = process.env.AI_PROVIDER_MODEL || "gemini-1.5-flash";
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json", temperature: 0.2 }
          })
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
              feedback: parsed.feedback || "Good explanation of concepts with structured reasoning.",
              strengths: Array.isArray(parsed.strengths) && parsed.strengths.length > 0 ? parsed.strengths : ["Structured verbal explanation", "Relevant core concepts mentioned"],
              weaknesses: Array.isArray(parsed.weaknesses) && parsed.weaknesses.length > 0 ? parsed.weaknesses : ["Could incorporate deeper asymptotic analysis"],
              recommendations: Array.isArray(parsed.recommendations) && parsed.recommendations.length > 0 ? parsed.recommendations : ["Review edge-case boundary conditions"]
            };
          }
        }
      } else if (provider === "openai") {
        const model = process.env.AI_PROVIDER_MODEL || "gpt-4o-mini";
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
            temperature: 0.2
          })
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
              feedback: parsed.feedback || "Constructive technical answer with good conceptual framing.",
              strengths: parsed.strengths || ["Logical verbal delivery", "Sound topic familiarity"],
              weaknesses: parsed.weaknesses || ["Elaborate with production system trade-offs"],
              recommendations: parsed.recommendations || ["Review system concurrency patterns"]
            };
          }
        }
      }
    } catch (err) {
      console.warn("[AI Evaluation Service] External LLM error, using rubric engine:", err);
    }
  }
  const lowerAnswer = cleanAnswer.toLowerCase();
  const domainLexicon = {
    python: [
      "gil",
      "global interpreter lock",
      "reference counting",
      "garbage collection",
      "cyclic reference",
      "generation",
      "gen 0",
      "gen 1",
      "gen 2",
      "cpython",
      "bytecode",
      "thread",
      "multiprocessing",
      "generator",
      "yield",
      "lazy evaluation",
      "decorator",
      "closure",
      "higher order function",
      "dunder",
      "magic method",
      "context manager",
      "asyncio",
      "coroutine",
      "event loop",
      "pypy",
      "sys.getrefcount",
      "gc module",
      "memory leak",
      "heap",
      "stack",
      "pyobject"
    ],
    java: [
      "jvm",
      "garbage collection",
      "g1",
      "zgc",
      "eden",
      "survivor",
      "metaspace",
      "heap",
      "stack",
      "multithreading",
      "synchronized",
      "volatile",
      "atomic",
      "thread pool",
      "executor",
      "classloader",
      "bytecode",
      "jmm",
      "java memory model",
      "string pool",
      "equals",
      "hashcode",
      "generics",
      "reflection",
      "polymorphism",
      "inheritance",
      "interface",
      "abstract class"
    ],
    dsa: [
      "time complexity",
      "space complexity",
      "o(1)",
      "o(n)",
      "o(log n)",
      "o(n log n)",
      "o(n^2)",
      "binary search",
      "dynamic programming",
      "memoization",
      "tabulation",
      "recursion",
      "backtracking",
      "graph",
      "bfs",
      "dfs",
      "tree",
      "bst",
      "avl",
      "trie",
      "heap",
      "priority queue",
      "hash table",
      "linked list",
      "stack",
      "queue",
      "asymptotic",
      "worst case",
      "amortized",
      "two pointer"
    ],
    javascript: [
      "event loop",
      "call stack",
      "microtask",
      "macrotask",
      "promise",
      "async",
      "await",
      "closure",
      "lexical scope",
      "prototype",
      "prototypal inheritance",
      "hoisting",
      "v8 engine",
      "garbage collection",
      "settimeout",
      "queueMicrotask",
      "event bubbling",
      "debouncing",
      "throttling",
      "immutability"
    ],
    system_design: [
      "scalability",
      "horizontal scaling",
      "vertical scaling",
      "load balancer",
      "reverse proxy",
      "caching",
      "redis",
      "memcached",
      "cdn",
      "sharding",
      "partitioning",
      "replication",
      "cap theorem",
      "consistency",
      "availability",
      "partition tolerance",
      "microservices",
      "message queue",
      "kafka",
      "rabbitmq",
      "circuit breaker",
      "rate limiting",
      "idempotency"
    ],
    dbms: [
      "acid",
      "atomicity",
      "consistency",
      "isolation",
      "durability",
      "transaction",
      "isolation levels",
      "dirty read",
      "phantom read",
      "non-repeatable read",
      "indexing",
      "b-tree",
      "b+ tree",
      "hash index",
      "normalization",
      "1nf",
      "2nf",
      "3nf",
      "bcnf",
      "deadlock",
      "wal",
      "write ahead logging"
    ],
    web: [
      "virtual dom",
      "reconciliation",
      "fiber",
      "state",
      "props",
      "hooks",
      "useeffect",
      "usememo",
      "usecallback",
      "ssr",
      "csr",
      "isr",
      "next.js",
      "hydration",
      "xss",
      "csrf",
      "cors",
      "csp",
      "content security policy",
      "dom",
      "rendering pipeline",
      "critical rendering path"
    ]
  };
  const currentTrackKey = track.toLowerCase().includes("python") ? "python" : track.toLowerCase().includes("java") ? "java" : track.toLowerCase().includes("dsa") || track.toLowerCase().includes("algo") ? "dsa" : track.toLowerCase().includes("script") || track.toLowerCase().includes("js") ? "javascript" : track.toLowerCase().includes("system") ? "system_design" : track.toLowerCase().includes("db") || track.toLowerCase().includes("sql") ? "dbms" : track.toLowerCase().includes("web") || track.toLowerCase().includes("react") ? "web" : "python";
  const trackTerms = domainLexicon[currentTrackKey] || domainLexicon.python;
  const commonTechTerms = [
    "latency",
    "throughput",
    "architecture",
    "concurrency",
    "asynchronous",
    "memory",
    "performance",
    "optimization",
    "trade-off",
    "complexity",
    "overhead",
    "lifecycle"
  ];
  let matchedTechCount = 0;
  for (const term of trackTerms) {
    if (lowerAnswer.includes(term)) matchedTechCount++;
  }
  for (const term of commonTechTerms) {
    if (lowerAnswer.includes(term)) matchedTechCount++;
  }
  const matchedKeypoints = [];
  const missingKeypoints = [];
  if (expectedKeypoints && expectedKeypoints.length > 0) {
    for (const kp of expectedKeypoints) {
      const words = kp.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      const isMatched = words.some((w) => lowerAnswer.includes(w));
      if (isMatched) matchedKeypoints.push(kp);
      else missingKeypoints.push(kp);
    }
  }
  const wordCount = cleanAnswer.split(/\s+/).filter(Boolean).length;
  let rawScore = 3;
  if (wordCount < 12) {
    rawScore = 2;
  } else if (matchedKeypoints.length >= 3 && matchedTechCount >= 4) {
    rawScore = Math.min(10, 8 + Math.floor(wordCount / 50));
  } else if (matchedKeypoints.length >= 2 || matchedTechCount >= 4) {
    rawScore = Math.min(9, 7 + Math.floor(wordCount / 60));
  } else if (matchedKeypoints.length >= 1 || matchedTechCount >= 2) {
    rawScore = Math.min(7, 5 + Math.floor(matchedTechCount / 2));
  } else if (wordCount >= 35) {
    rawScore = 5;
  } else {
    rawScore = 3;
  }
  const technicalAccuracy = Math.min(98, Math.max(25, rawScore * 10 - missingKeypoints.length * 3 + Math.min(8, matchedTechCount)));
  const conceptualDepth = Math.min(96, Math.max(20, Math.round(rawScore * 9.5 + Math.min(10, matchedKeypoints.length * 4))));
  const communication = Math.min(95, Math.max(35, Math.min(95, 45 + Math.floor(wordCount / 1.5))));
  const completeness = Math.min(98, Math.max(20, Math.round(matchedKeypoints.length / Math.max(1, expectedKeypoints?.length || 3) * 80 + rawScore * 2)));
  let feedback = "";
  if (rawScore >= 8) {
    feedback = `Exceptional technical explanation. Accurately demonstrated deep mechanical understanding of ${matchedKeypoints.length > 0 ? matchedKeypoints.slice(0, 2).join(" and ") : "the core architectural concepts"} with concrete production trade-offs.`;
  } else if (rawScore >= 6) {
    feedback = `Solid answer demonstrating practical familiarity. To elevate into senior engineering caliber, elaborate on concrete runtime edge cases and memory/asymptotic trade-offs.`;
  } else {
    feedback = `Basic familiarity shown, but response lacks technical precision. Review ${missingKeypoints.length > 0 ? missingKeypoints.slice(0, 2).join(" and ") : "underlying execution mechanics, memory lifecycle, and asymptotic complexities"}.`;
  }
  const strengthsList = [];
  if (matchedKeypoints.length > 0) {
    strengthsList.push(`Accurately articulated: ${matchedKeypoints[0]}`);
    if (matchedKeypoints.length > 1) {
      strengthsList.push(`Strong conceptual grasp of: ${matchedKeypoints[1]}`);
    }
  } else if (matchedTechCount >= 2) {
    strengthsList.push(`Demonstrated appropriate technical terminology for ${track}`);
    strengthsList.push("Structured communicative framing");
  } else {
    strengthsList.push("Attempted technical problem definition");
    strengthsList.push("Clear audible cadence and response willingness");
  }
  const weaknessesList = [];
  if (missingKeypoints.length > 0) {
    weaknessesList.push(`Did not elaborate on: ${missingKeypoints[0]}`);
    if (missingKeypoints.length > 1) {
      weaknessesList.push(`Omitted deep dive into: ${missingKeypoints[1]}`);
    }
  } else {
    weaknessesList.push("Incorporate more explicit runtime time and space complexity figures");
    weaknessesList.push("Detail multi-threaded synchronization or production scale trade-offs");
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
      "Structure technical interview viva answers using: Core Definition -> Mechanical How/Why -> Complexity/Trade-off"
    ],
    matchedKeypoints,
    missingKeypoints
  };
}

// src/server.ts
dotenv.config();
var app = express();
var PORT = process.env.PORT || 5e3;
var allowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://linkview-frontent.vercel.app",
  process.env.FRONTEND_URL
].filter(Boolean);
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin) || allowedOrigins.length === 0) {
        callback(null, true);
      } else {
        callback(null, true);
      }
    },
    credentials: true
  })
);
app.use(express.json({ limit: "10mb" }));
function generateToken(userId, role, email) {
  const payload = { userId, role: role.toUpperCase(), email, exp: Date.now() + 7 * 24 * 60 * 60 * 1e3 };
  return `linktest_${role.toLowerCase()}_token_${Buffer.from(JSON.stringify(payload)).toString("base64")}`;
}
function resolveUserFromToken(tokenString, emailHint) {
  if (!tokenString && !emailHint) return null;
  const allUsers = getAllUsers();
  if (emailHint) {
    const norm = emailHint.trim().toLowerCase();
    const found = allUsers.find((u) => u.email.toLowerCase() === norm);
    if (found) return found;
  }
  if (tokenString) {
    if (tokenString.includes("admin") || tokenString === "linktest_admin_valid_token_2026") {
      const admin = allUsers.find((u) => u.role === "super_admin") || {
        id: "admin-lead",
        fullName: "Dr. Priya Patel (Admin)",
        email: "admin@linktest.io",
        role: "super_admin",
        status: "active",
        joinedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      return admin;
    }
    if (tokenString.includes("teacher") || tokenString === "linktest_teacher_valid_token_2026") {
      const trainer = allUsers.find((u) => u.role === "trainer") || {
        id: "tr-lead",
        fullName: "Prof. Rajesh Kulkarni (Trainer)",
        email: "teacher@linktest.io",
        role: "trainer",
        status: "active",
        joinedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      return trainer;
    }
    try {
      const parts = tokenString.split("_token_");
      if (parts[1]) {
        const decoded = JSON.parse(Buffer.from(parts[1], "base64").toString("utf-8"));
        if (decoded?.email) {
          const found = allUsers.find((u) => u.email.toLowerCase() === decoded.email.toLowerCase());
          if (found) return found;
        }
      }
    } catch {
    }
  }
  return null;
}
var healthResponse = (req, res) => {
  res.json({
    status: "healthy",
    success: true,
    service: "linkview-backend",
    platform: "LinkView AI Mock Interview & Institute LMS",
    uptime: process.uptime(),
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    environment: process.env.NODE_ENV || "production"
  });
};
app.get("/healthz", healthResponse);
app.get("/api/health", healthResponse);
app.get("/health", healthResponse);
app.post("/api/auth/login", (req, res) => {
  try {
    const { email, password, provider, fullName, avatarUrl } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, error: "Email is required" });
    }
    const norm = email.trim().toLowerCase();
    if (provider === "google") {
      const user = getOrCreateGoogleUser({
        email: norm,
        fullName: fullName || norm.split("@")[0],
        avatarUrl
      });
      let role = "STUDENT";
      let redirectTo = "/student/dashboard";
      if (user.role === "super_admin") {
        role = "ADMIN";
        redirectTo = "/admin/dashboard";
      } else if (user.role === "trainer") {
        role = "TEACHER";
        redirectTo = "/teacher/dashboard";
      }
      const token2 = generateToken(user.id, role, user.email);
      const userProfile = {
        id: user.id,
        fullName: user.fullName,
        full_name: user.fullName,
        email: user.email,
        role,
        status: user.status || "active",
        batchCode: user.batchCode || "GLOBAL",
        enrolledBatchIds: user.batchCode ? [user.batchCode] : []
      };
      return res.json({
        success: true,
        token: token2,
        data: { token: token2, user: userProfile },
        user: userProfile,
        role,
        redirectTo
      });
    }
    const allAdminEmails = [
      ...SUPER_ADMIN_EMAILS,
      ...ADMIN_EMAILS,
      "admin@linktest.io",
      "admin@linktest.com",
      "admin@linkview.com",
      "admin@gmail.com",
      "rahul.sir@linktest.io"
    ].map((e) => e.toLowerCase());
    const isAdmin = allAdminEmails.includes(norm);
    if (isAdmin) {
      const validAdminPasswords = [
        ADMIN_DEFAULT_PASSWORD,
        "Admin123!",
        "admin123",
        "Password123!",
        "RahulSir@2026",
        "admin"
      ].filter(Boolean);
      if (!password || !validAdminPasswords.includes(password)) {
        return res.status(401).json({ success: false, error: "Invalid admin credentials" });
      }
      const adminUser = {
        id: "admin-lead",
        fullName: "Dr. Priya Patel (Admin)",
        full_name: "Dr. Priya Patel (Admin)",
        email: norm,
        role: "ADMIN",
        status: "active",
        batchCode: "GLOBAL"
      };
      const token2 = "linktest_admin_valid_token_2026";
      return res.json({
        success: true,
        token: token2,
        data: { token: token2, user: adminUser },
        user: adminUser,
        role: "ADMIN",
        redirectTo: "/admin/dashboard"
      });
    }
    const allTeacherEmails = [
      "teacher@linktest.io",
      "teacher@linktest.com",
      "trainer@linktest.io",
      "trainer@linkview.com",
      "ananya@linktest.io"
    ];
    if (allTeacherEmails.includes(norm)) {
      const validTeacherPasswords = ["Teacher123!", "teacher123", "Password123!", "admin123"];
      if (!password || !validTeacherPasswords.includes(password)) {
        return res.status(401).json({ success: false, error: "Invalid teacher credentials" });
      }
      const teacherUser = {
        id: "tr-lead",
        fullName: "Prof. Rajesh Kulkarni (Trainer)",
        full_name: "Prof. Rajesh Kulkarni (Trainer)",
        email: norm,
        role: "TEACHER",
        status: "active",
        batchCodes: ["GLOBAL", "BATCH-2026-A"]
      };
      const token2 = "linktest_teacher_valid_token_2026";
      return res.json({
        success: true,
        token: token2,
        data: { token: token2, user: teacherUser },
        user: teacherUser,
        role: "TEACHER",
        redirectTo: "/teacher/dashboard"
      });
    }
    const allStudentEmails = [
      "student@linktest.io",
      "student@linktest.com",
      "student@linkview.com",
      "rohan@linktest.io",
      "priya@linktest.io",
      "rohan.yewale252005@gmail.com"
    ];
    if (allStudentEmails.includes(norm)) {
      const validStudentPasswords = ["Student123!", "student123", "Password123!", "admin123", "123456"];
      if (!password || !validStudentPasswords.includes(password)) {
        return res.status(401).json({ success: false, error: "Invalid student credentials" });
      }
      const studentUser2 = {
        id: "stu-lead",
        fullName: norm.includes("rohan") ? "Rohan Yewale" : "Aarav Sharma (Student)",
        full_name: norm.includes("rohan") ? "Rohan Yewale" : "Aarav Sharma (Student)",
        email: norm,
        role: "STUDENT",
        status: "active",
        batchCode: "BATCH-2026-A",
        enrolledBatchIds: ["BATCH-2026-A", "BATCH-PY-2026"]
      };
      const token2 = "linktest_student_valid_token_2026";
      return res.json({
        success: true,
        token: token2,
        data: { token: token2, user: studentUser2 },
        user: studentUser2,
        role: "STUDENT",
        redirectTo: "/student/dashboard"
      });
    }
    const trainer = findTrainerByEmail(norm);
    if (trainer && trainer.status !== "suspended") {
      const teacherUser = {
        id: trainer.id,
        fullName: trainer.fullName,
        full_name: trainer.fullName,
        email: trainer.email,
        role: "TEACHER",
        status: "active",
        batchCodes: trainer.batchCodes
      };
      const token2 = generateToken(trainer.id, "TEACHER", trainer.email);
      return res.json({
        success: true,
        token: token2,
        data: { token: token2, user: teacherUser },
        user: teacherUser,
        role: "TEACHER",
        redirectTo: "/teacher/dashboard"
      });
    }
    const existing = getUserByEmail(norm);
    if (existing) {
      if (existing.role === "trainer") {
        const teacherUser = {
          id: existing.id,
          fullName: existing.fullName,
          full_name: existing.fullName,
          email: existing.email,
          role: "TEACHER",
          status: existing.status || "active",
          batchCodes: existing.batchCode ? [existing.batchCode] : ["GLOBAL"]
        };
        const token3 = generateToken(existing.id, "TEACHER", existing.email);
        return res.json({
          success: true,
          token: token3,
          data: { token: token3, user: teacherUser },
          user: teacherUser,
          role: "TEACHER",
          redirectTo: "/teacher/dashboard"
        });
      }
      if (existing.role === "super_admin") {
        const adminUser = {
          id: existing.id,
          fullName: existing.fullName,
          full_name: existing.fullName,
          email: existing.email,
          role: "ADMIN",
          status: "active",
          batchCode: "GLOBAL"
        };
        const token3 = "linktest_admin_valid_token_2026";
        return res.json({
          success: true,
          token: token3,
          data: { token: token3, user: adminUser },
          user: adminUser,
          role: "ADMIN",
          redirectTo: "/admin/dashboard"
        });
      }
      const studentUser2 = {
        id: existing.id,
        fullName: existing.fullName,
        full_name: existing.fullName,
        email: existing.email,
        role: "STUDENT",
        status: existing.status || "active",
        batchCode: existing.batchCode || "UNASSIGNED",
        enrolledBatchIds: existing.batchCode ? [existing.batchCode] : []
      };
      const token2 = generateToken(existing.id, "STUDENT", existing.email);
      return res.json({
        success: true,
        token: token2,
        data: { token: token2, user: studentUser2 },
        user: studentUser2,
        role: "STUDENT",
        redirectTo: "/student/dashboard"
      });
    }
    const studentUserRecord = getOrCreateGoogleUser({
      email: norm,
      fullName: fullName || norm.split("@")[0]
    });
    const studentUser = {
      id: studentUserRecord.id,
      fullName: studentUserRecord.fullName,
      full_name: studentUserRecord.fullName,
      email: studentUserRecord.email,
      role: "STUDENT",
      status: "active",
      batchCode: studentUserRecord.batchCode || "UNASSIGNED",
      enrolledBatchIds: []
    };
    const token = generateToken(studentUser.id, "STUDENT", studentUser.email);
    return res.json({
      success: true,
      token,
      data: { token, user: studentUser },
      user: studentUser,
      role: "STUDENT",
      redirectTo: "/student/dashboard"
    });
  } catch (err) {
    const error = err;
    return res.status(500).json({ success: false, error: error.message });
  }
});
app.post("/api/auth/google", (req, res) => {
  try {
    const { credential, email, fullName, avatarUrl } = req.body;
    let targetEmail = email;
    let targetName = fullName;
    let targetAvatar = avatarUrl;
    if (credential && typeof credential === "string") {
      try {
        const payloadBase64 = credential.split(".")[1];
        if (payloadBase64) {
          const parsed = JSON.parse(Buffer.from(payloadBase64, "base64").toString("utf-8"));
          if (parsed.email) targetEmail = parsed.email;
          if (parsed.name) targetName = parsed.name;
          if (parsed.picture) targetAvatar = parsed.picture;
        }
      } catch {
      }
    }
    if (!targetEmail) {
      targetEmail = "google.candidate@linktest.io";
    }
    const norm = targetEmail.trim().toLowerCase();
    const user = getOrCreateGoogleUser({
      email: norm,
      fullName: targetName || norm.split("@")[0],
      avatarUrl: targetAvatar
    });
    let role = "STUDENT";
    let redirectTo = "/student/dashboard";
    if (user.role === "super_admin") {
      role = "ADMIN";
      redirectTo = "/admin/dashboard";
    } else if (user.role === "trainer") {
      role = "TEACHER";
      redirectTo = "/teacher/dashboard";
    }
    const token = generateToken(user.id, role, user.email);
    const userProfile = {
      id: user.id,
      fullName: user.fullName,
      full_name: user.fullName,
      email: user.email,
      role,
      status: user.status || "active",
      batchCode: user.batchCode || "GLOBAL",
      avatarUrl: user.avatarUrl
    };
    return res.json({
      success: true,
      token,
      data: { token, user: userProfile },
      user: userProfile,
      role,
      redirectTo
    });
  } catch (err) {
    const error = err;
    return res.status(500).json({ success: false, error: error.message });
  }
});
app.post("/api/auth/register", (req, res) => {
  try {
    const { fullName, email, password } = req.body;
    if (!email) return res.status(400).json({ success: false, error: "Email is required" });
    const norm = email.trim().toLowerCase();
    const user = getOrCreateGoogleUser({
      email: norm,
      fullName: fullName || norm.split("@")[0]
    });
    const token = generateToken(user.id, "STUDENT", norm);
    const studentUser = {
      id: user.id,
      fullName: user.fullName,
      full_name: user.fullName,
      email: user.email,
      role: "STUDENT",
      status: "active",
      batchCode: "UNASSIGNED"
    };
    return res.status(201).json({
      success: true,
      token,
      data: { token, user: studentUser },
      user: studentUser,
      role: "STUDENT",
      message: "Account registered successfully"
    });
  } catch (err) {
    const error = err;
    return res.status(500).json({ success: false, error: error.message });
  }
});
app.post("/api/auth/verify-email", (req, res) => {
  const { email } = req.body;
  const norm = (email || "student@linktest.io").trim().toLowerCase();
  const user = getUserByEmail(norm) || getOrCreateGoogleUser({ email: norm, fullName: norm.split("@")[0] });
  const token = generateToken(user.id, "STUDENT", norm);
  return res.json({
    success: true,
    token,
    data: { token, user: { ...user, role: "STUDENT", full_name: user.fullName } },
    user: { ...user, role: "STUDENT", full_name: user.fullName }
  });
});
var handleGetMe = (req, res) => {
  try {
    const authHeader = (req.headers.authorization || "").replace("Bearer ", "").trim();
    const adminToken = req.headers["x-admin-token"];
    const emailQuery = req.query.email || req.body && req.body.email;
    const token = authHeader || adminToken || req.body && req.body.adminToken;
    const resolvedUser = resolveUserFromToken(token, emailQuery);
    if (resolvedUser) {
      let role = "STUDENT";
      if (resolvedUser.role === "super_admin" || token && token.includes("admin")) {
        role = "ADMIN";
      } else if (resolvedUser.role === "trainer" || token && token.includes("teacher")) {
        role = "TEACHER";
      }
      const userProfile = {
        id: resolvedUser.id,
        fullName: resolvedUser.fullName,
        full_name: resolvedUser.fullName,
        email: resolvedUser.email,
        role,
        status: resolvedUser.status || "active",
        batchCode: resolvedUser.batchCode || "GLOBAL"
      };
      return res.json({
        success: true,
        authenticated: true,
        token: token || generateToken(resolvedUser.id, role, resolvedUser.email),
        data: { user: userProfile, token },
        user: userProfile,
        role,
        normalizedRole: role,
        email: resolvedUser.email,
        fullName: resolvedUser.fullName
      });
    }
    if (token) {
      const role = token.includes("admin") ? "ADMIN" : token.includes("teacher") ? "TEACHER" : "STUDENT";
      const fallbackUser = {
        id: role === "ADMIN" ? "admin-lead" : role === "TEACHER" ? "tr-lead" : "stu-lead",
        fullName: role === "ADMIN" ? "Dr. Priya Patel (Admin)" : role === "TEACHER" ? "Prof. Rajesh Kulkarni (Trainer)" : "Student Examinee",
        full_name: role === "ADMIN" ? "Dr. Priya Patel (Admin)" : role === "TEACHER" ? "Prof. Rajesh Kulkarni (Trainer)" : "Student Examinee",
        email: role === "ADMIN" ? "admin@linktest.io" : role === "TEACHER" ? "teacher@linktest.io" : "student@linktest.io",
        role,
        status: "active",
        batchCode: "GLOBAL"
      };
      return res.json({
        success: true,
        authenticated: true,
        token,
        data: { user: fallbackUser, token },
        user: fallbackUser,
        role,
        normalizedRole: role,
        email: fallbackUser.email,
        fullName: fallbackUser.fullName
      });
    }
    return res.status(401).json({ success: false, authenticated: false, error: "Authentication required" });
  } catch (err) {
    const error = err;
    return res.status(500).json({ success: false, error: error.message });
  }
};
app.get("/api/auth/me", handleGetMe);
app.post("/api/auth/me", handleGetMe);
function formatBatch(b) {
  const studentsList = Array.isArray(b.students) ? b.students : [];
  return {
    id: b.id,
    name: b.name,
    code: b.code,
    course: b.technology || b.course || "Technical",
    technology: b.technology || b.course || "Technical",
    course_name: b.technology || b.course || "Technical",
    description: b.description || `${b.name} training cohort`,
    startDate: b.startDate,
    start_date: b.startDate,
    endDate: b.endDate || "",
    end_date: b.endDate || "",
    timing: b.timing || "Morning (09:00 - 11:00 AM)",
    status: b.status || "Active",
    trainerId: b.trainerId,
    trainerName: b.trainerName,
    trainer_name: b.trainerName,
    trainerEmail: b.trainerEmail || "trainer@linktest.io",
    studentCount: studentsList.length,
    enrolled_count: studentsList.length,
    students: studentsList,
    teachers: [
      {
        id: b.trainerId,
        name: b.trainerName,
        email: b.trainerEmail || "trainer@linktest.io",
        role: "Primary Trainer"
      }
    ]
  };
}
app.get("/api/batches", (req, res) => {
  try {
    const { trainerId, status, search, role: queryRole, email: queryEmail } = req.query;
    const authHeader = req.headers.authorization;
    const user = resolveUserFromToken(authHeader, queryEmail);
    let list = interviewStore.getBatches();
    if (user?.role === "trainer" || queryRole === "TEACHER" || trainerId) {
      const matchId = trainerId || user?.id || "";
      const matchEmail = user?.email?.toLowerCase() || "";
      list = list.filter(
        (b) => b.trainerId === matchId || b.trainerName.toLowerCase().includes(matchEmail) || b.trainerId.toLowerCase() === matchEmail || b.trainerEmail && b.trainerEmail.toLowerCase() === matchEmail
      );
    }
    if (user?.role === "student" || queryRole === "STUDENT") {
      const studentEmail = user?.email?.toLowerCase();
      if (studentEmail) {
        list = list.filter((b) => Array.isArray(b.students) && b.students.some((e) => e.toLowerCase() === studentEmail));
      }
    }
    if (status && status !== "all") {
      list = list.filter((b) => b.status.toLowerCase() === status.toLowerCase());
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((b) => b.name.toLowerCase().includes(q) || b.code.toLowerCase().includes(q) || b.technology.toLowerCase().includes(q));
    }
    const formatted = list.map(formatBatch);
    return res.json({
      success: true,
      data: { batches: formatted, total: formatted.length },
      batches: formatted,
      count: formatted.length
    });
  } catch (err) {
    const error = err;
    return res.status(500).json({ success: false, error: error.message });
  }
});
app.post("/api/batches", (req, res) => {
  try {
    const {
      name,
      code,
      course,
      technology,
      description,
      startDate,
      start_date,
      endDate,
      end_date,
      timing,
      status,
      trainerId,
      teacher_id,
      trainerName,
      trainerEmail,
      students
    } = req.body;
    if (!name || !code) {
      return res.status(400).json({ success: false, error: "Batch name and batch code are required" });
    }
    const resolvedTech = technology || course || "Full Stack Development";
    let resolvedTrainerName = trainerName;
    const resolvedTrainerId = trainerId || teacher_id || "tr-lead";
    if (!resolvedTrainerName) {
      const allUsers = getAllUsers();
      const trainerUser = allUsers.find((u) => u.id === resolvedTrainerId || u.email.toLowerCase() === resolvedTrainerId.toLowerCase());
      resolvedTrainerName = trainerUser?.fullName || "Prof. Rajesh Kulkarni (Trainer)";
    }
    const newBatch = interviewStore.addBatch({
      name,
      code: code.toUpperCase(),
      technology: resolvedTech,
      course: resolvedTech,
      description: description || `${name} (${code.toUpperCase()}) cohort`,
      startDate: startDate || start_date || (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
      endDate: endDate || end_date || "",
      timing: timing || "Morning (09:00 - 11:00 AM)",
      status: status || "Active",
      trainerId: resolvedTrainerId,
      trainerName: resolvedTrainerName,
      trainerEmail: trainerEmail || "trainer@linktest.io",
      students: Array.isArray(students) ? students : []
    });
    const formatted = formatBatch(newBatch);
    return res.status(201).json({
      success: true,
      message: `Batch ${newBatch.name} (${newBatch.code}) created successfully`,
      data: { batch: formatted },
      batch: formatted
    });
  } catch (err) {
    const error = err;
    return res.status(500).json({ success: false, error: error.message });
  }
});
app.get("/api/batches/:id", (req, res) => {
  try {
    const batch = interviewStore.getBatchById(req.params.id);
    if (!batch) {
      return res.status(404).json({ success: false, error: "Batch not found" });
    }
    const formatted = formatBatch(batch);
    const allUsers = getAllUsers();
    const studentsDetails = (batch.students || []).map((email, i) => {
      const u = allUsers.find((user) => user.email.toLowerCase() === email.toLowerCase());
      return {
        id: u?.id || `std-${i + 1}`,
        fullName: u?.fullName || email.split("@")[0],
        full_name: u?.fullName || email.split("@")[0],
        email,
        status: u?.status || "active",
        batchCode: batch.code
      };
    });
    return res.json({
      success: true,
      data: {
        batch: formatted,
        students: studentsDetails,
        teachers: formatted.teachers
      },
      batch: formatted
    });
  } catch (err) {
    const error = err;
    return res.status(500).json({ success: false, error: error.message });
  }
});
var handleUpdateBatch = (req, res) => {
  try {
    const updated = interviewStore.updateBatch(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, error: "Batch not found" });
    }
    const formatted = formatBatch(updated);
    return res.json({
      success: true,
      message: "Batch updated successfully",
      data: { batch: formatted },
      batch: formatted
    });
  } catch (err) {
    const error = err;
    return res.status(500).json({ success: false, error: error.message });
  }
};
app.put("/api/batches/:id", handleUpdateBatch);
app.patch("/api/batches/:id", handleUpdateBatch);
app.delete("/api/batches/:id", (req, res) => {
  try {
    const deleted = interviewStore.deleteBatch(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: "Batch not found" });
    }
    return res.json({ success: true, message: "Batch archived successfully" });
  } catch (err) {
    const error = err;
    return res.status(500).json({ success: false, error: error.message });
  }
});
app.get("/api/batches/:id/students", (req, res) => {
  try {
    const batch = interviewStore.getBatchById(req.params.id);
    if (!batch) return res.status(404).json({ success: false, error: "Batch not found" });
    const allUsers = getAllUsers();
    const students = (batch.students || []).map((email, idx) => {
      const u = allUsers.find((user) => user.email.toLowerCase() === email.toLowerCase());
      return {
        id: u?.id || `std-${idx + 1}`,
        student_id: u?.id || `std-${idx + 1}`,
        fullName: u?.fullName || email.split("@")[0],
        full_name: u?.fullName || email.split("@")[0],
        email,
        status: u?.status || "active",
        batchCode: batch.code,
        joinedAt: u?.joinedAt || (/* @__PURE__ */ new Date()).toISOString()
      };
    });
    return res.json({
      success: true,
      data: { students, count: students.length },
      students,
      count: students.length
    });
  } catch (err) {
    const error = err;
    return res.status(500).json({ success: false, error: error.message });
  }
});
app.post("/api/batches/:id/students", (req, res) => {
  try {
    const batch = interviewStore.getBatchById(req.params.id);
    if (!batch) return res.status(404).json({ success: false, error: "Batch not found" });
    const { studentIds, studentEmails, studentId, studentEmail } = req.body;
    const candidates = [];
    if (Array.isArray(studentIds)) candidates.push(...studentIds);
    if (Array.isArray(studentEmails)) candidates.push(...studentEmails);
    if (studentId) candidates.push(studentId);
    if (studentEmail) candidates.push(studentEmail);
    const allUsers = getAllUsers();
    let enrolledCount = 0;
    let alreadyEnrolledCount = 0;
    for (const cand of candidates) {
      let targetEmail = cand;
      const foundUser = allUsers.find((u) => u.id === cand || u.email.toLowerCase() === cand.toLowerCase());
      if (foundUser) {
        targetEmail = foundUser.email;
        foundUser.batchCode = batch.code;
      }
      if (!batch.students) batch.students = [];
      const clean = targetEmail.trim().toLowerCase();
      if (!batch.students.map((e) => e.toLowerCase()).includes(clean)) {
        batch.students.push(clean);
        enrolledCount++;
      } else {
        alreadyEnrolledCount++;
      }
    }
    batch.studentCount = batch.students.length;
    interviewStore.saveToDisk();
    savePersistedUsers({ users: allUsers, trainers: [] });
    return res.json({
      success: true,
      message: `Enrolled ${enrolledCount} student(s) into ${batch.name}. (${alreadyEnrolledCount} already enrolled)`,
      data: { enrolledCount, alreadyEnrolledCount, totalStudents: batch.studentCount, batch: formatBatch(batch) }
    });
  } catch (err) {
    const error = err;
    return res.status(500).json({ success: false, error: error.message });
  }
});
app.delete("/api/batches/:id/students/:studentId", (req, res) => {
  try {
    const batch = interviewStore.getBatchById(req.params.id);
    if (!batch) return res.status(404).json({ success: false, error: "Batch not found" });
    const target = req.params.studentId.trim().toLowerCase();
    const allUsers = getAllUsers();
    const targetUser = allUsers.find((u) => u.id === target || u.email.toLowerCase() === target);
    const targetEmail = targetUser ? targetUser.email.toLowerCase() : target;
    if (batch.students) {
      batch.students = batch.students.filter((e) => e.toLowerCase() !== targetEmail);
      batch.studentCount = batch.students.length;
      interviewStore.saveToDisk();
    }
    if (targetUser && targetUser.batchCode === batch.code) {
      targetUser.batchCode = "UNASSIGNED";
      savePersistedUsers({ users: allUsers, trainers: [] });
    }
    return res.json({ success: true, message: "Student removed from batch successfully" });
  } catch (err) {
    const error = err;
    return res.status(500).json({ success: false, error: error.message });
  }
});
app.get("/api/batches/:id/teachers", (req, res) => {
  const batch = interviewStore.getBatchById(req.params.id);
  if (!batch) return res.status(404).json({ success: false, error: "Batch not found" });
  const teachers = [
    {
      id: batch.trainerId,
      name: batch.trainerName,
      full_name: batch.trainerName,
      email: batch.trainerEmail || "trainer@linktest.io",
      role: "Primary Trainer",
      status: "active"
    }
  ];
  return res.json({ success: true, data: { teachers }, teachers });
});
app.post("/api/batches/:id/teachers", (req, res) => {
  const batch = interviewStore.getBatchById(req.params.id);
  if (!batch) return res.status(404).json({ success: false, error: "Batch not found" });
  const { teacherId, trainerId, teacherName, trainerName } = req.body;
  if (teacherId || trainerId) {
    batch.trainerId = teacherId || trainerId;
  }
  if (teacherName || trainerName) {
    batch.trainerName = teacherName || trainerName;
  }
  interviewStore.saveToDisk();
  return res.json({ success: true, message: "Trainer assigned to batch successfully", data: formatBatch(batch) });
});
app.delete("/api/batches/:id/teachers/:teacherId", (req, res) => {
  return res.json({ success: true, message: "Teacher assignment updated" });
});
app.get("/api/admin/dashboard", (req, res) => {
  try {
    const stats = interviewStore.getAdminStats();
    return res.json({
      success: true,
      data: stats,
      stats
    });
  } catch (err) {
    const error = err;
    return res.status(500).json({ success: false, error: error.message });
  }
});
app.get("/api/admin/teachers", (req, res) => {
  try {
    const allUsers = getAllUsers();
    let teachers = allUsers.filter((u) => u.role === "trainer" || u.role === "super_admin").map((u) => ({
      id: u.id,
      fullName: u.fullName,
      full_name: u.fullName,
      name: u.fullName,
      email: u.email,
      status: u.status || "active",
      assignedBatchesCount: interviewStore.getBatches().filter((b) => b.trainerId === u.id || b.trainerName.includes(u.fullName)).length
    }));
    if (teachers.length === 0) {
      teachers = [
        {
          id: "tr-lead",
          fullName: "Prof. Rajesh Kulkarni (Trainer)",
          full_name: "Prof. Rajesh Kulkarni (Trainer)",
          name: "Prof. Rajesh Kulkarni (Trainer)",
          email: "teacher@linktest.io",
          status: "active",
          assignedBatchesCount: 2
        },
        {
          id: "tr-sarah",
          fullName: "Dr. Sarah Mitchell (Systems Lead)",
          full_name: "Dr. Sarah Mitchell (Systems Lead)",
          name: "Dr. Sarah Mitchell (Systems Lead)",
          email: "sarah.mitchell@linktest.io",
          status: "active",
          assignedBatchesCount: 1
        }
      ];
    }
    return res.json({ success: true, data: teachers, teachers, count: teachers.length });
  } catch (err) {
    const error = err;
    return res.status(500).json({ success: false, error: error.message });
  }
});
app.get("/api/admin/students", (req, res) => {
  try {
    const allUsers = getAllUsers();
    const batches = interviewStore.getBatches();
    const students = allUsers.filter((u) => u.role === "student").map((u) => {
      const enrolledIn = batches.filter((b) => Array.isArray(b.students) && b.students.some((e) => e.toLowerCase() === u.email.toLowerCase()));
      return {
        id: u.id,
        fullName: u.fullName,
        full_name: u.fullName,
        name: u.fullName,
        email: u.email,
        status: u.status || "active",
        batchCode: enrolledIn[0]?.code || u.batchCode || "UNASSIGNED",
        batchName: enrolledIn[0]?.name || (u.batchCode && u.batchCode !== "UNASSIGNED" ? u.batchCode : "Unassigned"),
        enrolledBatches: enrolledIn.map((b) => b.code),
        joinedAt: u.joinedAt
      };
    });
    return res.json({ success: true, data: students, students, count: students.length });
  } catch (err) {
    const error = err;
    return res.status(500).json({ success: false, error: error.message });
  }
});
app.get("/api/admin/courses", (req, res) => {
  const courses = [
    { id: "crs-py", title: "Python & Cloud Architecture", name: "Python & Cloud Architecture", code: "PY-2026", published: true },
    { id: "crs-java", title: "Full Stack Java Development", name: "Full Stack Java Development", code: "JAVA-2026", published: true },
    { id: "crs-dsa", title: "Data Structures & Algorithms Masterclass", name: "Data Structures & Algorithms Masterclass", code: "DSA-2026", published: true },
    { id: "crs-mern", title: "MERN Full Stack Engineering", name: "MERN Full Stack Engineering", code: "MERN-2026", published: true }
  ];
  return res.json({ success: true, data: courses, courses });
});
app.get("/api/courses", (req, res) => {
  const courses = [
    { id: "crs-py", title: "Python & Cloud Architecture", name: "Python & Cloud Architecture", code: "PY-2026", published: true },
    { id: "crs-java", title: "Full Stack Java Development", name: "Full Stack Java Development", code: "JAVA-2026", published: true },
    { id: "crs-dsa", title: "Data Structures & Algorithms Masterclass", name: "Data Structures & Algorithms Masterclass", code: "DSA-2026", published: true },
    { id: "crs-mern", title: "MERN Full Stack Engineering", name: "MERN Full Stack Engineering", code: "MERN-2026", published: true }
  ];
  return res.json({ success: true, data: courses, courses });
});
app.get("/api/admin/subjects", (req, res) => {
  const subjects = [
    { id: "sub-python", name: "Python Core & Concurrency", code: "PY-101" },
    { id: "sub-java", name: "Java OOP & Memory Model", code: "JV-101" },
    { id: "sub-dsa", name: "Dynamic Programming & Graphs", code: "DSA-201" },
    { id: "sub-sys", name: "Distributed System Design", code: "SYS-301" }
  ];
  return res.json({ success: true, data: subjects, subjects });
});
app.get("/api/admin/users", (req, res) => {
  const users = getAllUsers();
  return res.json({ success: true, data: users, users, count: users.length });
});
app.post("/api/admin/users", (req, res) => {
  const { fullName, email, role, batchCode } = req.body;
  if (!email) return res.status(400).json({ success: false, error: "Email is required" });
  if (role === "trainer") {
    const origin = req.headers.origin || "http://localhost:3000";
    const invite = createTrainerInvitation({
      fullName: fullName || "Trainer Instructor",
      email,
      batchCode,
      baseUrl: origin
    });
    return res.status(201).json({ success: true, data: invite.user, inviteLink: invite.inviteLink });
  }
  const user = getOrCreateGoogleUser({ fullName: fullName || email.split("@")[0], email });
  return res.status(201).json({ success: true, data: user });
});
app.patch("/api/admin/users", (req, res) => {
  const { userId, action, batchCodes } = req.body;
  if (action === "promote_to_trainer") {
    promoteStudentToTrainer(userId, batchCodes);
    return res.json({ success: true, message: "User promoted to Trainer successfully" });
  }
  if (action === "demote_to_student") {
    const batches = interviewStore.getBatches();
    const assigned = batches.filter((b) => b.trainerId === userId);
    if (assigned.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot demote trainer: Trainer has ${assigned.length} assigned batch(es) (${assigned.map((b) => b.name).join(", ")}). Reassign these batches before demoting.`,
        hasAssignedBatches: true,
        assignedBatches: assigned.map((b) => ({ id: b.id, name: b.name }))
      });
    }
    demoteTrainerToStudent(userId);
    return res.json({ success: true, message: "User demoted to Student successfully" });
  }
  return res.status(400).json({ success: false, error: "Unknown action" });
});
app.patch("/api/admin/users/:userId/role", (req, res) => {
  const { userId } = req.params;
  const { role, batchCodes } = req.body;
  const targetRole = String(role || "").toLowerCase();
  if (targetRole === "trainer" || targetRole === "teacher") {
    promoteStudentToTrainer(userId, batchCodes);
    return res.json({ success: true, message: "User promoted to Trainer successfully" });
  }
  if (targetRole === "student") {
    const batches = interviewStore.getBatches();
    const assigned = batches.filter((b) => b.trainerId === userId);
    if (assigned.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot demote trainer: Trainer has ${assigned.length} assigned batch(es). Reassign them first.`,
        hasAssignedBatches: true,
        assignedBatches: assigned.map((b) => ({ id: b.id, name: b.name }))
      });
    }
    demoteTrainerToStudent(userId);
    return res.json({ success: true, message: "User demoted to Student successfully" });
  }
  return res.status(400).json({ success: false, error: "Invalid role" });
});
app.get("/api/student/dashboard", (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const emailQuery = req.query.email;
    const user = resolveUserFromToken(authHeader, emailQuery);
    const data = interviewStore.getStudentDashboard(user?.email || "student@linktest.io");
    return res.json({ success: true, data, dashboard: data });
  } catch (err) {
    const error = err;
    return res.status(500).json({ success: false, error: error.message });
  }
});
app.get("/api/student/batches", (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const user = resolveUserFromToken(authHeader, req.query.email);
    const studentEmail = (user?.email || "student@linktest.io").toLowerCase();
    const batches = interviewStore.getBatches().filter((b) => Array.isArray(b.students) && b.students.some((e) => e.toLowerCase() === studentEmail));
    const formatted = batches.map(formatBatch);
    return res.json({ success: true, data: formatted, batches: formatted, count: formatted.length });
  } catch (err) {
    const error = err;
    return res.status(500).json({ success: false, error: error.message });
  }
});
app.get("/api/courses/my", (req, res) => {
  const enrolledCourses = [
    { id: "crs-py", title: "Python & Cloud Architecture", progress: 65, totalLessons: 24, completedLessons: 16 },
    { id: "crs-dsa", title: "Data Structures & Algorithms", progress: 40, totalLessons: 30, completedLessons: 12 }
  ];
  return res.json({ success: true, data: enrolledCourses, courses: enrolledCourses });
});
app.get("/api/mock-tests", (req, res) => {
  const tests = [
    {
      id: "mock-tech-py",
      title: "Python Full Stack AI Interview",
      technology: "Python",
      type: "interview_prep",
      difficulty: "intermediate",
      durationMinutes: 30,
      questionCount: 3,
      status: "published"
    },
    {
      id: "mock-tech-java",
      title: "Java Distributed Systems Interview",
      technology: "Java",
      type: "interview_prep",
      difficulty: "senior",
      durationMinutes: 45,
      questionCount: 3,
      status: "published"
    },
    {
      id: "mock-tech-dsa",
      title: "Algorithms & Data Structures Round",
      technology: "DSA",
      type: "interview_prep",
      difficulty: "intermediate",
      durationMinutes: 45,
      questionCount: 3,
      status: "published"
    }
  ];
  return res.json({ success: true, data: tests, tests });
});
app.get("/api/mock-tests/my-results", (req, res) => {
  const interviews = interviewStore.getInterviews().filter((i) => i.status === "completed");
  const results = interviews.map((i) => ({
    id: i.id,
    attemptId: i.id,
    title: `${i.technology} Technical Interview`,
    technology: i.technology,
    score: i.scorecard?.overallScore || 78,
    submittedAt: i.scheduledAt,
    scorecard: i.scorecard
  }));
  return res.json({ success: true, data: results, results });
});
app.get("/api/teacher/dashboard", (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const user = resolveUserFromToken(authHeader, req.query.email);
    const data = interviewStore.getTrainerDashboard(user?.email);
    return res.json({ success: true, data, dashboard: data });
  } catch (err) {
    const error = err;
    return res.status(500).json({ success: false, error: error.message });
  }
});
app.get("/api/teacher/classes", (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const user = resolveUserFromToken(authHeader, req.query.email);
    const list = interviewStore.getBatches().filter((b) => {
      if (!user) return true;
      const norm = user.email.toLowerCase();
      return b.trainerId === user.id || b.trainerName.toLowerCase().includes(norm) || b.trainerEmail && b.trainerEmail.toLowerCase() === norm;
    });
    const formatted = list.map(formatBatch);
    return res.json({ success: true, data: formatted, classes: formatted });
  } catch (err) {
    const error = err;
    return res.status(500).json({ success: false, error: error.message });
  }
});
app.get("/api/trainer/students/available", (req, res) => {
  try {
    const batchId = req.query.batchId;
    const allUsers = getAllUsers();
    const students = allUsers.filter((u) => u.role === "student");
    if (!batchId) {
      return res.json({ success: true, data: students });
    }
    const batch = interviewStore.getBatchById(batchId);
    const enrolledEmails = (batch?.students || []).map((e) => e.toLowerCase());
    const available = students.filter((s) => !enrolledEmails.includes(s.email.toLowerCase()));
    return res.json({ success: true, data: available, count: available.length });
  } catch (err) {
    const error = err;
    return res.status(500).json({ success: false, error: error.message });
  }
});
var interviewTracks = {
  python: [
    "Explain how Python manages memory using the Global Interpreter Lock (GIL) and reference counting.",
    "What are generators in Python and how do they optimize memory when processing large datasets?",
    "How do decorators work under the hood in Python?"
  ],
  java: [
    "How does the Java Garbage Collector differentiate between unreachable objects and softly reachable objects?",
    "Can you explain the internal working of ConcurrentHashMap in Java 8 compared to earlier versions?",
    "What happens when a deadlock occurs in Java threads and how would you diagnose it in a live production environment?"
  ],
  dsa: [
    "Given an array of integers, how would you find the subarray with the largest sum in O(n) time?",
    "What is the difference between Dijkstra algorithm and the Bellman-Ford algorithm for negative edge weights?",
    "How does a Bloom filter work and what are its trade-offs regarding false positives?"
  ],
  communication: [
    "Please give me a concise 90-second professional elevator pitch introducing your technical background and key strengths.",
    "Describe a situation where a critical software defect was identified right before launch. How did you communicate with stakeholders and resolve it under pressure?",
    "Where do you envision your technical engineering contributions 2 to 3 years from today?"
  ]
};
app.get("/api/interviews", (req, res) => {
  const id = req.query.id;
  if (id) {
    const interview = interviewStore.getInterviewById(id);
    if (!interview) return res.status(404).json({ success: false, error: "Interview not found" });
    return res.json({ success: true, data: interview });
  }
  return res.json({ success: true, data: interviewStore.getInterviews() });
});
app.post("/api/interviews", (req, res) => {
  try {
    const { track = "dsa", difficulty = "intermediate", studentName } = req.body;
    const normTrack = track.toLowerCase();
    const questions = interviewTracks[normTrack] || interviewTracks.dsa;
    const session = interviewStore.scheduleInterview({
      technology: track.toUpperCase(),
      difficulty,
      studentName: studentName || "Candidate",
      questionCount: questions.length,
      currentQuestion: questions[0]
    });
    session.currentQuestion = questions[0];
    session.totalTurns = questions.length;
    return res.json({ success: true, data: session });
  } catch (err) {
    const error = err;
    return res.status(500).json({ success: false, error: error.message });
  }
});
app.put("/api/interviews", async (req, res) => {
  try {
    const { sessionId, id, answer, action, proctoringEvents } = req.body;
    const activeId = sessionId || id;
    if (!activeId) {
      return res.status(400).json({ success: false, error: "sessionId is required" });
    }
    const session = interviewStore.getInterviewById(activeId);
    if (!session) {
      return res.status(404).json({ success: false, error: "Interview session not found" });
    }
    const normTrack = session.technology.toLowerCase();
    const questions = interviewTracks[normTrack] || interviewTracks.dsa;
    if (action === "end") {
      session.status = "completed";
      const historyTurns = session.history || [];
      const count = Math.max(1, historyTurns.length);
      const avgTech = Math.round(historyTurns.reduce((acc, t) => acc + (t.evaluation?.technicalAccuracy || t.score * 10 || 68), 0) / count);
      const avgConc = Math.round(historyTurns.reduce((acc, t) => acc + (t.evaluation?.conceptualDepth || t.score * 9.5 || 62), 0) / count);
      const avgComm = Math.round(historyTurns.reduce((acc, t) => acc + (t.evaluation?.communication || t.score * 10 || 70), 0) / count);
      const avgProb = Math.round(historyTurns.reduce((acc, t) => acc + (t.evaluation?.completeness || t.score * 9.5 || 60), 0) / count);
      const overall = Math.round((avgTech + avgConc + avgComm + avgProb) / 4);
      session.scorecard = {
        overallScore: overall,
        technicalAccuracy: avgTech,
        conceptualUnderstanding: avgConc,
        communication: avgComm,
        problemSolving: avgProb,
        strengths: [
          `Structured verbal communication on ${session.technology} core concepts`,
          "Clear technical vocabulary and domain terminology",
          "Prompt engagement and professional demeanor"
        ],
        weaknesses: [
          "Delve deeper into algorithmic trade-offs and error scenarios",
          "Provide more production-scale deployment context"
        ],
        recommendations: [
          `Review internal system mechanics and memory allocation for ${session.technology}`,
          "Practice mock interview sessions to build oral conciseness"
        ],
        aiFeedback: `Interview concluded voluntarily by candidate. Evaluation summarized across ${historyTurns.length} turn(s) with an overall score of ${overall}%.`
      };
      if (proctoringEvents && Array.isArray(proctoringEvents)) {
        session.proctoringEvents = proctoringEvents;
      }
      interviewStore.saveToDisk();
      return res.json({ success: true, data: session, scorecard: session.scorecard });
    }
    const aiEval = await evaluateAIInterviewAnswer(session.currentQuestion, answer, normTrack);
    let nextQuestion = void 0;
    if (session.currentTurn < session.totalTurns) {
      nextQuestion = questions[session.currentTurn];
    }
    const updated = interviewStore.recordTurn(
      activeId,
      session.currentQuestion,
      answer || "",
      aiEval?.score || 7,
      aiEval?.feedback || "Good explanation of technical concepts.",
      nextQuestion
    );
    if (updated) {
      const latestTurn = updated.history[updated.history.length - 1];
      if (latestTurn) {
        latestTurn.evaluation = aiEval;
      }
      if (updated.status === "completed" || updated.currentTurn >= updated.totalTurns) {
        updated.status = "completed";
        const historyTurns = updated.history || [];
        const count = Math.max(1, historyTurns.length);
        const avgTech = Math.round(historyTurns.reduce((acc, t) => acc + (t.evaluation?.technicalAccuracy || t.score * 10 || 65), 0) / count);
        const avgConc = Math.round(historyTurns.reduce((acc, t) => acc + (t.evaluation?.conceptualDepth || t.score * 9.5 || 60), 0) / count);
        const avgComm = Math.round(historyTurns.reduce((acc, t) => acc + (t.evaluation?.communication || t.score * 10 || 68), 0) / count);
        const avgProb = Math.round(historyTurns.reduce((acc, t) => acc + (t.evaluation?.completeness || t.score * 9.5 || 58), 0) / count);
        const overall = Math.round((avgTech + avgConc + avgComm + avgProb) / 4);
        const allStrengths = historyTurns.flatMap((t) => t.evaluation?.strengths || []);
        const allWeaknesses = historyTurns.flatMap((t) => t.evaluation?.weaknesses || []);
        const allRecs = historyTurns.flatMap((t) => t.evaluation?.recommendations || []);
        updated.scorecard = {
          overallScore: overall,
          technicalAccuracy: avgTech,
          conceptualUnderstanding: avgConc,
          communication: avgComm,
          problemSolving: avgProb,
          strengths: allStrengths.length > 0 ? Array.from(new Set(allStrengths)).slice(0, 3) : [
            `Solid grasp of core ${updated.technology} domain patterns`,
            "Concise verbal technical explanations under proctoring",
            "Consistent eye contact and audio clarity"
          ],
          weaknesses: allWeaknesses.length > 0 ? Array.from(new Set(allWeaknesses)).slice(0, 2) : [
            "Could delve deeper into memory lifecycle edge cases",
            "Include quantitative trade-offs under high concurrency"
          ],
          recommendations: allRecs.length > 0 ? Array.from(new Set(allRecs)).slice(0, 3) : [
            `Review system architecture documentation for ${updated.technology}`,
            "Practice timed 2-minute whiteboard responses"
          ],
          aiFeedback: `Completed full ${updated.totalTurns}-turn interview session. Overall performance demonstrates a solid foundational understanding of ${updated.technology}.`
        };
      }
      if (proctoringEvents && Array.isArray(proctoringEvents)) {
        updated.proctoringEvents = proctoringEvents;
      }
      interviewStore.saveToDisk();
    }
    return res.json({ success: true, data: updated, scorecard: updated?.scorecard });
  } catch (err) {
    const error = err;
    return res.status(500).json({ success: false, error: error.message });
  }
});
app.post("/api/tts", async (req, res) => {
  try {
    const { text, gender = "female" } = req.body;
    return res.json({
      success: true,
      mode: "browser_speech",
      text,
      rate: 0.98,
      pitch: gender === "female" ? 1.05 : 0.95
    });
  } catch (err) {
    const error = err;
    return res.status(500).json({ success: false, error: error.message });
  }
});
app.get("/api/trainer/questions", (req, res) => {
  const tech = req.query.technology;
  const search = req.query.search?.toLowerCase();
  let list = interviewStore.getQuestionBank();
  if (tech && tech !== "all") {
    list = list.filter((q) => q.technology.toLowerCase() === tech.toLowerCase());
  }
  if (search) {
    list = list.filter((q) => q.question.toLowerCase().includes(search) || q.topic.toLowerCase().includes(search));
  }
  return res.json({ success: true, data: list, count: list.length });
});
app.post("/api/trainer/questions", (req, res) => {
  try {
    const { questions, technology, topic, difficulty, question, expectedKeypoints, idealAnswer, tags } = req.body;
    if (Array.isArray(questions)) {
      const added = interviewStore.addBulkQuestions(questions);
      return res.status(201).json({ success: true, message: `Successfully imported ${added.length} questions`, data: added });
    }
    if (!question || !technology) {
      return res.status(400).json({ success: false, error: "Question text and technology are required" });
    }
    const newQ = interviewStore.addQuestion({
      technology,
      topic: topic || "Custom Topic",
      difficulty: difficulty || "intermediate",
      question,
      expectedKeypoints: Array.isArray(expectedKeypoints) ? expectedKeypoints : [expectedKeypoints].filter(Boolean),
      idealAnswer: idealAnswer || "",
      tags: tags || [technology, "CustomImport"]
    });
    return res.status(201).json({ success: true, message: "Question added to bank", data: newQ });
  } catch (err) {
    const error = err;
    return res.status(500).json({ success: false, error: error.message });
  }
});
app.delete("/api/trainer/questions", (req, res) => {
  const id = req.query.id;
  if (!id) return res.status(400).json({ success: false, error: "Question ID is required" });
  const deleted = interviewStore.deleteQuestion(id);
  if (!deleted) return res.status(404).json({ success: false, error: "Question not found" });
  return res.json({ success: true, message: "Question removed from bank" });
});
app.post("/api/proctoring", (req, res) => {
  try {
    const { interviewId, event, currentTranscript } = req.body;
    if (!interviewId || !event || !event.type || !event.message) {
      return res.status(400).json({ success: false, error: "interviewId and valid event payload are required" });
    }
    const result = interviewStore.recordProctoringFlag(
      interviewId,
      {
        type: event.type,
        severity: event.severity || "high",
        message: event.message,
        durationSeconds: event.durationSeconds
      },
      currentTranscript
    );
    return res.json({
      success: true,
      autoSubmitted: result.autoSubmitted,
      flagCount: result.flagCount,
      maxAllowedFlags: result.maxAllowedFlags,
      remainingFlags: result.remainingFlags,
      event: result.event,
      session: result.session,
      message: result.message
    });
  } catch (err) {
    const error = err;
    return res.status(500).json({ success: false, error: error.message });
  }
});
app.get("/api/proctoring", (req, res) => {
  try {
    const interviewId = req.query.interviewId;
    if (!interviewId) {
      return res.status(400).json({ success: false, error: "interviewId query parameter is required" });
    }
    const session = interviewStore.getInterviewById(interviewId);
    if (!session) {
      return res.status(404).json({ success: false, error: "Interview session not found" });
    }
    return res.json({
      success: true,
      data: {
        interviewId: session.id,
        studentName: session.studentName,
        technology: session.technology,
        status: session.status,
        submissionReason: session.submissionReason || "normal",
        autoSubmittedAt: session.autoSubmittedAt,
        flagCount: session.flagCount || 0,
        maxAllowedFlags: session.maxAllowedFlags || 3,
        proctoringEvents: session.proctoringEvents || [],
        scorecard: session.scorecard
      }
    });
  } catch (err) {
    const error = err;
    return res.status(500).json({ success: false, error: error.message });
  }
});
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: "NOT_FOUND",
      message: `API route '${req.method} ${req.originalUrl}' does not exist on linkview-backend.`
    }
  });
});
app.listen(PORT, () => {
  console.log(`\u{1F680} LinkView Backend API server listening on port ${PORT}`);
});
