export interface PlatformUser {
  id: string;
  fullName: string;
  email: string;
  role: 'super_admin' | 'trainer' | 'student';
  status: 'active' | 'suspended';
  batchCode?: string;
  joinedAt: string;
  avatarUrl?: string;
}

export interface TrainerRecord {
  id: string;
  email: string;
  fullName: string;
  status: 'active' | 'suspended' | 'invited';
  batchCodes: string[];
  promotedAt: string;
  promotedBy: string;
}

export const ADMIN_EMAILS: string[] = [
  (process.env.ADMIN_EMAIL || 'rahul.sir@linktest.io').trim().toLowerCase(),
  (process.env.SUPER_ADMIN_EMAIL_1 || 'admin.linktest@gmail.com').trim().toLowerCase(),
  (process.env.SUPER_ADMIN_EMAIL_2 || 'superadmin.linktest@gmail.com').trim().toLowerCase(),
].filter(Boolean);

export const ADMIN_DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || 'RahulSir@2026';

const users: PlatformUser[] = [
  {
    id: 'admin-lead',
    fullName: 'Rahul Sir (Founder & Admin)',
    email: ADMIN_EMAILS[0],
    role: 'super_admin',
    status: 'active',
    batchCode: 'GLOBAL',
    joinedAt: new Date().toISOString(),
  },
];

const trainers: TrainerRecord[] = [];

export function getAllUsers(): PlatformUser[] {
  return users;
}

export function getUserByEmail(email: string): PlatformUser | undefined {
  const norm = email.trim().toLowerCase();
  return users.find((u) => u.email.toLowerCase() === norm);
}

export function getOrCreateGoogleUser(params: {
  email: string;
  fullName: string;
  avatarUrl?: string;
}): PlatformUser {
  const norm = params.email.trim().toLowerCase();

  // If Admin email
  if (ADMIN_EMAILS.includes(norm)) {
    let existing = users.find((u) => u.email.toLowerCase() === norm);
    if (!existing) {
      existing = {
        id: `admin-${Date.now()}`,
        fullName: params.fullName || 'Administrator',
        email: norm,
        role: 'super_admin',
        status: 'active',
        batchCode: 'GLOBAL',
        joinedAt: new Date().toISOString(),
        avatarUrl: params.avatarUrl,
      };
      users.unshift(existing);
    }
    return existing;
  }

  // If existing user
  const existing = users.find((u) => u.email.toLowerCase() === norm);
  if (existing) return existing;

  // STRICT REQUIREMENT: All new Google accounts strictly default to 'student'
  const newUser: PlatformUser = {
    id: `stu-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    fullName: params.fullName || norm.split('@')[0],
    email: norm,
    role: 'student',
    status: 'active',
    joinedAt: new Date().toISOString(),
    avatarUrl: params.avatarUrl,
  };

  users.push(newUser);
  return newUser;
}

export function promoteStudentToTrainer(userId: string, batchCodes: string[] = []): boolean {
  const user = users.find((u) => u.id === userId);
  if (!user || user.role === 'super_admin') return false;

  user.role = 'trainer';

  const existingTrainer = trainers.find((t) => t.email.toLowerCase() === user.email.toLowerCase());
  if (existingTrainer) {
    existingTrainer.status = 'active';
    existingTrainer.batchCodes = batchCodes;
  } else {
    trainers.push({
      id: `tr-${Date.now()}`,
      email: user.email,
      fullName: user.fullName,
      status: 'active',
      batchCodes,
      promotedAt: new Date().toISOString(),
      promotedBy: 'Rahul Sir (Admin)',
    });
  }

  return true;
}

export function demoteTrainerToStudent(userId: string): boolean {
  const user = users.find((u) => u.id === userId);
  if (!user || user.role === 'super_admin') return false;

  user.role = 'student';
  const trainerIdx = trainers.findIndex((t) => t.email.toLowerCase() === user.email.toLowerCase());
  if (trainerIdx !== -1) {
    trainers.splice(trainerIdx, 1);
  }

  return true;
}

export function getAllTrainers(): TrainerRecord[] {
  return trainers;
}

export function findTrainerByEmail(email: string): TrainerRecord | undefined {
  const norm = email.trim().toLowerCase();
  return trainers.find((t) => t.email.toLowerCase() === norm);
}

export function createTrainerInvitation(params: {
  fullName: string;
  email: string;
  batchCode?: string;
  baseUrl?: string;
}) {
  const token = `inv_tr_${Math.random().toString(36).slice(2, 10)}`;
  const norm = params.email.trim().toLowerCase();
  const base = params.baseUrl || 'http://localhost:3000';

  let user = users.find((u) => u.email.toLowerCase() === norm);
  if (!user) {
    user = {
      id: `usr-tr-${Date.now()}`,
      fullName: params.fullName,
      email: norm,
      role: 'trainer',
      status: 'active',
      batchCode: params.batchCode || 'BATCH-2026',
      joinedAt: new Date().toISOString(),
    };
    users.push(user);
  } else {
    user.role = 'trainer';
  }

  const trainer: TrainerRecord = {
    id: `tr-${Date.now()}`,
    email: norm,
    fullName: params.fullName,
    status: 'active',
    batchCodes: params.batchCode ? [params.batchCode] : ['BATCH-2026'],
    promotedAt: new Date().toISOString(),
    promotedBy: 'Rahul Sir (Admin)',
  };

  const existingIdx = trainers.findIndex((t) => t.email.toLowerCase() === norm);
  if (existingIdx !== -1) {
    trainers[existingIdx] = trainer;
  } else {
    trainers.push(trainer);
  }

  return {
    user,
    trainer,
    inviteLink: `${base}/login?inviteToken=${token}&email=${encodeURIComponent(norm)}`,
    inviteToken: token,
  };
}
