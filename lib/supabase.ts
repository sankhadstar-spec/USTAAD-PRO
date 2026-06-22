import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://zvasucmfgwddhxymfqgc.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp2YXN1Y21mZ3dkZHhoeW1mcWdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwMTEwMjksImV4cCI6MjA5NzU4NzAyOX0.z2WYCkJI5pJrRCDKTZkTKDPqMXXhpHX-7hNCBkMs7ps';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
