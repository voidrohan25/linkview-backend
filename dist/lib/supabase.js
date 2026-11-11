"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.supabase = exports.isSupabaseConfigured = exports.SUPER_ADMIN_EMAILS = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
// Default authorized Super Admin Gmail addresses
exports.SUPER_ADMIN_EMAILS = [
    process.env.SUPER_ADMIN_EMAIL_1 || 'admin.linktest@gmail.com',
    process.env.SUPER_ADMIN_EMAIL_2 || 'superadmin.linktest@gmail.com',
];
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'placeholder-key';
exports.isSupabaseConfigured = Boolean(supabaseUrl && !supabaseUrl.includes('placeholder') && supabaseKey && !supabaseKey.includes('placeholder'));
exports.supabase = (0, supabase_js_1.createClient)(supabaseUrl, supabaseKey, {
    auth: {
        persistSession: false,
        autoRefreshToken: false,
    },
});
