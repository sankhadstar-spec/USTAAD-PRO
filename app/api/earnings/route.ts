import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

// Real, persistent earnings — backed by the ustaad_earnings_ledger table
// (see supabase_schema.sql at the project root; run it once in the
// Supabase SQL Editor before using this route).
//
// Uses the same public Supabase project already configured in
// lib/supabase.ts / .env.local. Identity is a per-browser device_id (see
// lib/device.ts) — read the security note in supabase_schema.sql for what
// that does and doesn't protect.

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

const VALID_SOURCES = ['recording', 'export', 'post', 'game', 'withdrawal', 'bonus'] as const;

export async function GET(req: NextRequest) {
  const deviceId = req.nextUrl.searchParams.get('deviceId');
  if (!deviceId) return NextResponse.json({ error: 'deviceId is required' }, { status: 400 });

  const supabase = getClient();
  if (!supabase) {
    return NextResponse.json(
      { error: 'Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).' },
      { status: 501 }
    );
  }

  const { data, error } = await supabase
    .from('ustaad_earnings_ledger')
    .select('amount, source, created_at')
    .eq('device_id', deviceId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: `Supabase error: ${error.message}` }, { status: 502 });
  }

  const balance = (data ?? []).reduce((sum, row) => sum + Number(row.amount), 0);
  return NextResponse.json({ balance, ledger: data ?? [] });
}

export async function POST(req: NextRequest) {
  let body: { deviceId?: string; amount?: number; source?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { deviceId, amount, source } = body;
  if (!deviceId || typeof amount !== 'number' || !source) {
    return NextResponse.json({ error: 'deviceId, amount and source are required' }, { status: 400 });
  }
  if (!VALID_SOURCES.includes(source as any)) {
    return NextResponse.json({ error: `source must be one of: ${VALID_SOURCES.join(', ')}` }, { status: 400 });
  }

  const supabase = getClient();
  if (!supabase) {
    return NextResponse.json(
      { error: 'Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).' },
      { status: 501 }
    );
  }

  const { error: insertError } = await supabase
    .from('ustaad_earnings_ledger')
    .insert({ device_id: deviceId, amount, source });

  if (insertError) {
    return NextResponse.json({ error: `Supabase error: ${insertError.message}` }, { status: 502 });
  }

  const { data, error: sumError } = await supabase
    .from('ustaad_earnings_ledger')
    .select('amount')
    .eq('device_id', deviceId);

  if (sumError) {
    return NextResponse.json({ error: `Supabase error: ${sumError.message}` }, { status: 502 });
  }

  const balance = (data ?? []).reduce((sum, row) => sum + Number(row.amount), 0);
  return NextResponse.json({ balance });
}
console.log("DEBUG_SUPABASE_URL:", process.env.NEXT_PUBLIC_SUPABASE_URL);
