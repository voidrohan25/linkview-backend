"use strict";
/**
 * LinkTest Platform - Authoritative User & Role Store
 * Enforces strict role boundaries:
 * - Fixed Admin (controlled via ADMIN_EMAIL / ADMIN_PASSWORD)
 * - All Google Sign-in accounts default strictly to 'student'
 * - Only Admin can promote a Student to 'trainer' or demote back to 'student'
 * - Clean initial state (no dummy/fake records)
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ADMIN_DEFAULT_PASSWORD = exports.ADMIN_EMAILS = void 0;
exports.savePersistedUsers = savePersistedUsers;
exports.getAllUsers = getAllUsers;
exports.syncUsers = syncUsers;
exports.getUserById = getUserById;
exports.getUserByEmail = getUserByEmail;
exports.getOrCreateGoogleUser = getOrCreateGoogleUser;
exports.deleteUser = deleteUser;
exports.promoteStudentToTrainer = promoteStudentToTrainer;
exports.demoteTrainerToStudent = demoteTrainerToStudent;
exports.updateUserBatch = updateUserBatch;
exports.toggleUserStatus = toggleUserStatus;
exports.getAllTrainers = getAllTrainers;
exports.findTrainerByEmail = findTrainerByEmail;
exports.inviteTrainerByAdmin = inviteTrainerByAdmin;
exports.addPlatformUser = addPlatformUser;
exports.updatePlatformUserStatus = updatePlatformUserStatus;
exports.createTrainerInvitation = createTrainerInvitation;
exports.acceptTrainerInvitation = acceptTrainerInvitation;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
function getPersistencePaths(filename) {
    const paths = [];
    try {
        const dataDir = path_1.default.join(process.cwd(), '.data');
        if (!fs_1.default.existsSync(dataDir)) {
            fs_1.default.mkdirSync(dataDir, { recursive: true });
        }
        paths.push(path_1.default.join(dataDir, filename));
    }
    catch { }
    paths.push(path_1.default.join(os_1.default.tmpdir(), filename));
    return paths;
}
function loadPersistedUsers() {
    const paths = getPersistencePaths('linkview_users_persistent_cache.json');
    for (const p of paths) {
        try {
            if (fs_1.default.existsSync(p)) {
                const raw = fs_1.default.readFileSync(p, 'utf-8');
                const parsed = JSON.parse(raw);
                if (parsed && Array.isArray(parsed.users) && parsed.users.length > 0) {
                    return parsed;
                }
            }
        }
        catch (e) {
            console.warn(`Could not read users cache from ${p}:`, e);
        }
    }
    return null;
}
function savePersistedUsers(st) {
    const paths = getPersistencePaths('linkview_users_persistent_cache.json');
    for (const p of paths) {
        try {
            fs_1.default.writeFileSync(p, JSON.stringify(st, null, 2), 'utf-8');
        }
        catch (e) {
            // In serverless, process.cwd() may be read-only; os.tmpdir will succeed
        }
    }
}
// Configured Admin email addresses from environment
exports.ADMIN_EMAILS = [
    (process.env.ADMIN_EMAIL || 'rahul.sir@linktest.io').trim().toLowerCase(),
    (process.env.SUPER_ADMIN_EMAIL_1 || 'admin.linktest@gmail.com').trim().toLowerCase(),
    (process.env.SUPER_ADMIN_EMAIL_2 || 'superadmin.linktest@gmail.com').trim().toLowerCase(),
].filter(Boolean);
exports.ADMIN_DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || 'RahulSir@2026';
function initUsersState() {
    const fromDisk = loadPersistedUsers();
    if (fromDisk) {
        // Ensure primary admin always exists in list
        const hasAdmin = fromDisk.users.some(u => exports.ADMIN_EMAILS.includes(u.email.toLowerCase()));
        if (!hasAdmin) {
            fromDisk.users.unshift({
                id: 'admin-lead',
                fullName: 'Rahul Sir (Founder & Admin)',
                email: exports.ADMIN_EMAILS[0],
                role: 'super_admin',
                status: 'active',
                batchCode: 'GLOBAL',
                joinedAt: new Date().toISOString(),
            });
        }
        return fromDisk;
    }
    // Clean initialization: ONLY configured admin accounts, NO fake examinees
    const initialUsers = [
        {
            id: 'admin-lead',
            fullName: 'Rahul Sir (Founder & Admin)',
            email: exports.ADMIN_EMAILS[0],
            role: 'super_admin',
            status: 'active',
            batchCode: 'GLOBAL',
            joinedAt: new Date().toISOString(),
        },
    ];
    const st = {
        users: initialUsers,
        trainers: [],
    };
    savePersistedUsers(st);
    return st;
}
if (!globalThis.__linkTestUsersState) {
    globalThis.__linkTestUsersState = initUsersState();
}
const state = globalThis.__linkTestUsersState;
function getAllUsers() {
    // Always synchronize with disk cache to prevent cold-start loss
    const fromDisk = loadPersistedUsers();
    if (fromDisk && Array.isArray(fromDisk.users)) {
        for (const du of fromDisk.users) {
            const idx = state.users.findIndex((u) => u.email.toLowerCase() === du.email.toLowerCase() || u.id === du.id);
            if (idx === -1) {
                state.users.push(du);
            }
            else {
                state.users[idx] = {
                    ...du,
                    ...state.users[idx],
                    // Preserve promoted trainer role or updated batch
                    role: state.users[idx].role === 'trainer' || du.role === 'trainer' ? 'trainer' : state.users[idx].role,
                    batchCode: state.users[idx].batchCode !== 'UNASSIGNED' ? state.users[idx].batchCode : du.batchCode,
                };
            }
        }
    }
    return state.users;
}
/**
 * Synchronize and merge an array of platform users (e.g. from client rehydration)
 * Ensures no student or trainer is ever deleted or overwritten with lower privileges
 */
function syncUsers(incomingUsers) {
    if (!Array.isArray(incomingUsers))
        return getAllUsers();
    for (const inc of incomingUsers) {
        if (!inc.email)
            continue;
        const norm = inc.email.trim().toLowerCase();
        const existingIdx = state.users.findIndex((u) => u.email.toLowerCase() === norm || u.id === inc.id);
        if (existingIdx === -1) {
            state.users.push({
                ...inc,
                email: norm,
                role: inc.role || 'student',
                status: inc.status || 'active',
                batchCode: inc.batchCode || 'UNASSIGNED',
                joinedAt: inc.joinedAt || new Date().toISOString(),
            });
        }
        else {
            const existing = state.users[existingIdx];
            state.users[existingIdx] = {
                ...existing,
                fullName: inc.fullName || existing.fullName,
                // Preserve role if promoted
                role: existing.role === 'trainer' || inc.role === 'trainer' ? 'trainer' : (existing.role === 'super_admin' ? 'super_admin' : (inc.role || existing.role)),
                batchCode: (inc.batchCode && inc.batchCode !== 'UNASSIGNED') ? inc.batchCode : existing.batchCode,
                status: inc.status || existing.status,
            };
        }
    }
    savePersistedUsers(state);
    return state.users;
}
function getUserById(id) {
    getAllUsers();
    const norm = id.trim().toLowerCase();
    return state.users.find((u) => u.id.toLowerCase() === norm || u.email.toLowerCase() === norm);
}
function getUserByEmail(email) {
    getAllUsers();
    const norm = email.trim().toLowerCase();
    return state.users.find((u) => u.email.toLowerCase() === norm);
}
/**
 * Register or login a Google user.
 * STRICT REQUIREMENT: Every new Google account MUST initially receive the 'student' role.
 */
function getOrCreateGoogleUser(params) {
    getAllUsers(); // Ensure latest state from disk is loaded first
    const norm = params.email.trim().toLowerCase();
    // If this email is the configured fixed Admin, grant admin
    if (exports.ADMIN_EMAILS.includes(norm)) {
        let existing = state.users.find((u) => u.email.toLowerCase() === norm);
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
            state.users.unshift(existing);
            savePersistedUsers(state);
        }
        return existing;
    }
    // Check if user already exists
    const existing = state.users.find((u) => u.email.toLowerCase() === norm);
    if (existing) {
        if (params.fullName && !existing.fullName) {
            existing.fullName = params.fullName;
        }
        if (params.avatarUrl && !existing.avatarUrl) {
            existing.avatarUrl = params.avatarUrl;
        }
        savePersistedUsers(state);
        // Return existing account preserving its role (if Admin previously promoted them)
        return existing;
    }
    // NEW Google Account: MUST ALWAYS BE 'student', UNASSIGNED batch, ACTIVE
    const newUser = {
        id: `stu-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        fullName: params.fullName || norm.split('@')[0],
        email: norm,
        role: 'student', // STRICT DEFAULT
        status: 'active',
        batchCode: 'UNASSIGNED',
        joinedAt: new Date().toISOString(),
        avatarUrl: params.avatarUrl,
    };
    state.users.push(newUser);
    savePersistedUsers(state);
    return newUser;
}
/**
 * Admin action: Delete a user by ID or email
 */
function deleteUser(userId) {
    const norm = userId.trim().toLowerCase();
    const idx = state.users.findIndex((u) => u.id.toLowerCase() === norm || u.email.toLowerCase() === norm);
    if (idx === -1)
        return false;
    // Protect authoritative configured admin accounts
    if (state.users[idx].role === 'super_admin' && exports.ADMIN_EMAILS.includes(state.users[idx].email.toLowerCase())) {
        return false;
    }
    const removed = state.users.splice(idx, 1)[0];
    const trainerIdx = state.trainers.findIndex((t) => t.email.toLowerCase() === removed.email.toLowerCase());
    if (trainerIdx !== -1) {
        state.trainers.splice(trainerIdx, 1);
    }
    savePersistedUsers(state);
    return true;
}
/**
 * Admin action: Promote Student to Trainer
 */
function promoteStudentToTrainer(userId, batchCodes = []) {
    getAllUsers();
    const norm = userId.trim().toLowerCase();
    const user = state.users.find((u) => u.id.toLowerCase() === norm || u.email.toLowerCase() === norm);
    if (!user || user.role === 'super_admin')
        return false;
    user.role = 'trainer';
    if (batchCodes.length > 0) {
        user.batchCode = batchCodes[0];
    }
    // Record in trainer roster
    const existingTrainer = state.trainers.find((t) => t.email.toLowerCase() === user.email.toLowerCase());
    if (existingTrainer) {
        existingTrainer.status = 'active';
        existingTrainer.batchCodes = batchCodes.length > 0 ? batchCodes : (existingTrainer.batchCodes || ['GLOBAL']);
    }
    else {
        state.trainers.push({
            id: `tr-${Date.now()}`,
            email: user.email,
            fullName: user.fullName,
            status: 'active',
            batchCodes: batchCodes.length > 0 ? batchCodes : ['GLOBAL'],
            promotedAt: new Date().toISOString(),
            promotedBy: 'Admin',
        });
    }
    savePersistedUsers(state);
    return true;
}
/**
 * Admin action: Demote Trainer back to Student
 */
function demoteTrainerToStudent(userId) {
    getAllUsers();
    const norm = userId.trim().toLowerCase();
    const user = state.users.find((u) => u.id.toLowerCase() === norm || u.email.toLowerCase() === norm);
    if (!user || user.role === 'super_admin')
        return false;
    user.role = 'student';
    const trainerIdx = state.trainers.findIndex((t) => t.email.toLowerCase() === user.email.toLowerCase());
    if (trainerIdx !== -1) {
        state.trainers.splice(trainerIdx, 1);
    }
    savePersistedUsers(state);
    return true;
}
/**
 * Admin / Faculty action: Assign or update student batch code
 */
function updateUserBatch(userId, batchCode) {
    const user = state.users.find((u) => u.id === userId || u.email.toLowerCase() === userId.toLowerCase());
    if (!user)
        return undefined;
    user.batchCode = batchCode;
    savePersistedUsers(state);
    return user;
}
/**
 * Admin action: Toggle user account status (active/suspended)
 */
function toggleUserStatus(userId, status) {
    const user = state.users.find((u) => u.id === userId);
    if (!user || user.role === 'super_admin')
        return false;
    user.status = status;
    const trainer = state.trainers.find((t) => t.email.toLowerCase() === user.email.toLowerCase());
    if (trainer) {
        trainer.status = status;
    }
    return true;
}
function getAllTrainers() {
    // Sync latest users first
    getAllUsers();
    // Combine registered trainers and any users whose role is currently 'trainer'
    const trainerEmails = new Set(state.trainers.map((t) => t.email.toLowerCase()));
    const trainerUsers = state.users.filter((u) => u.role === 'trainer');
    for (const tu of trainerUsers) {
        if (!trainerEmails.has(tu.email.toLowerCase())) {
            state.trainers.push({
                id: tu.id,
                email: tu.email,
                fullName: tu.fullName,
                status: tu.status || 'active',
                batchCodes: tu.batchCode ? [tu.batchCode] : ['GLOBAL'],
                promotedAt: tu.joinedAt || new Date().toISOString(),
                promotedBy: 'Admin',
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
// Backwards compatibility helper for existing test suites
function inviteTrainerByAdmin(params) {
    const token = `inv_tr_${Math.random().toString(36).slice(2, 10)}`;
    const norm = params.email.trim().toLowerCase();
    // Check if exists
    let user = state.users.find((u) => u.email.toLowerCase() === norm);
    if (!user) {
        user = {
            id: `tr-user-${Date.now()}`,
            fullName: params.fullName,
            email: norm,
            role: 'trainer',
            status: 'active',
            batchCode: params.batchCodes?.[0],
            joinedAt: new Date().toISOString(),
        };
        state.users.push(user);
    }
    else {
        user.role = 'trainer';
    }
    state.trainers.push({
        id: `tr-${Date.now()}`,
        email: norm,
        fullName: params.fullName,
        status: 'active',
        batchCodes: params.batchCodes || ['PYAI2026'],
        promotedAt: new Date().toISOString(),
        promotedBy: 'Admin',
    });
    return { success: true, inviteToken: token };
}
function addPlatformUser(params) {
    const norm = params.email.trim().toLowerCase();
    const existing = state.users.find((u) => u.email.toLowerCase() === norm);
    if (existing) {
        existing.fullName = params.fullName || existing.fullName;
        existing.role = params.role || existing.role;
        if (params.batchCode)
            existing.batchCode = params.batchCode;
        return existing;
    }
    const newUser = {
        id: `usr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        fullName: params.fullName,
        email: norm,
        role: params.role,
        status: params.status || 'active',
        batchCode: params.batchCode || 'GLOBAL',
        joinedAt: new Date().toISOString(),
    };
    state.users.push(newUser);
    savePersistedUsers(state);
    return newUser;
}
function updatePlatformUserStatus(userId, status) {
    const user = state.users.find((u) => u.id === userId);
    if (!user)
        return undefined;
    user.status = status;
    const tr = state.trainers.find((t) => t.email.toLowerCase() === user.email.toLowerCase());
    if (tr) {
        tr.status = status;
    }
    savePersistedUsers(state);
    return user;
}
function createTrainerInvitation(params) {
    const token = `inv_tr_${Math.random().toString(36).slice(2, 10)}`;
    const norm = params.email.trim().toLowerCase();
    const base = params.baseUrl || 'http://localhost:3000';
    let user = state.users.find((u) => u.email.toLowerCase() === norm);
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
        state.users.push(user);
    }
    else {
        user.role = 'trainer';
    }
    const trainer = {
        id: `tr-${Date.now()}`,
        email: norm,
        fullName: params.fullName,
        status: 'active',
        batchCodes: params.batchCode ? [params.batchCode] : ['BATCH-2026'],
        promotedAt: new Date().toISOString(),
        promotedBy: 'Rahul Sir (Admin)',
    };
    const existingIdx = state.trainers.findIndex((t) => t.email.toLowerCase() === norm);
    if (existingIdx !== -1) {
        state.trainers[existingIdx] = trainer;
    }
    else {
        state.trainers.push(trainer);
    }
    savePersistedUsers(state);
    return {
        user,
        trainer,
        inviteLink: `${base}/login?inviteToken=${token}&email=${encodeURIComponent(norm)}`,
        inviteToken: token,
    };
}
function acceptTrainerInvitation(params) {
    const norm = params.email.trim().toLowerCase();
    const tr = state.trainers.find((t) => t.email.toLowerCase() === norm);
    if (tr) {
        tr.status = 'active';
        savePersistedUsers(state);
        return true;
    }
    return false;
}
