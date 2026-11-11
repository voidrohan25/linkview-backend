// Default authorized Super Admin Gmail addresses
export const SUPER_ADMIN_EMAILS = [
  process.env.SUPER_ADMIN_EMAIL_1 || 'admin.linktest@gmail.com',
  process.env.SUPER_ADMIN_EMAIL_2 || 'superadmin.linktest@gmail.com',
];

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(
  supabaseUrl && !supabaseUrl.includes('placeholder') && supabaseKey && !supabaseKey.includes('placeholder')
);

export const supabase: any = null;
