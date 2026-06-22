import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

// Real money-movement via Razorpay's Payouts API (a.k.a. RazorpayX).
//
// ⚠️ This is genuine integration code, but it can only ever be as "real" as
// your Razorpay account: you need RazorpayX enabled (separate approval from
// regular Razorpay Payments, requires KYC/business verification) and an
// actual funded account balance to pay out from. No code — mine or anyone
// else's — can substitute for that approval. Until it's approved, this
// route will fail with Razorpay's real error message, which is the honest
// behaviour (better than pretending to succeed).
//
// Docs: https://razorpay.com/docs/payouts/
// Env vars needed: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_ACCOUNT_NUMBER
// (the RazorpayX virtual account you're paying out from).

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function razorpayAuthHeader() {
  const id = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!id || !secret) return null;
  return 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
}

async function razorpay(path: string, body: object, auth: string) {
  const res = await fetch(`https://api.razorpay.com/v1/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.description ?? `Razorpay ${path} failed (${res.status})`);
  }
  return data;
}

export async function POST(req: NextRequest) {
  let body: { deviceId?: string; amount?: number; vpa?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { deviceId, amount, vpa, name = 'USTAAD Creator' } = body;
  if (!deviceId || typeof amount !== 'number' || amount <= 0 || !vpa) {
    return NextResponse.json({ error: 'deviceId, amount (>0) and vpa (UPI id) are required' }, { status: 400 });
  }

  const auth = razorpayAuthHeader();
  const accountNumber = process.env.RAZORPAY_ACCOUNT_NUMBER;
  if (!auth || !accountNumber) {
    return NextResponse.json(
      { error: 'Razorpay is not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_ACCOUNT_NUMBER).' },
      { status: 501 }
    );
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 501 });
  }

  // 1. Verify real, persisted balance covers this withdrawal.
  const { data: ledgerRows, error: ledgerError } = await supabase
    .from('ustaad_earnings_ledger')
    .select('amount')
    .eq('device_id', deviceId);

  if (ledgerError) {
    return NextResponse.json({ error: `Supabase error: ${ledgerError.message}` }, { status: 502 });
  }

  const balance = (ledgerRows ?? []).reduce((sum, row) => sum + Number(row.amount), 0);
  if (amount > balance) {
    return NextResponse.json({ error: `Insufficient balance: ₹${balance.toFixed(2)} available, ₹${amount.toFixed(2)} requested.` }, { status: 400 });
  }

  // 2. Log the payout attempt before calling Razorpay, so we never lose track of it.
  const { data: payoutRow, error: insertError } = await supabase
    .from('ustaad_payouts')
    .insert({ device_id: deviceId, amount, vpa, status: 'pending' })
    .select('id')
    .single();

  if (insertError) {
    return NextResponse.json({ error: `Supabase error: ${insertError.message}` }, { status: 502 });
  }

  try {
    // 3. Real Razorpay calls: contact → fund_account → payout.
    const contact = await razorpay('contacts', { name, type: 'customer', reference_id: deviceId }, auth);
    const fundAccount = await razorpay('fund_accounts', {
      contact_id: contact.id,
      account_type: 'vpa',
      vpa: { address: vpa },
    }, auth);
    const payout = await razorpay('payouts', {
      account_number: accountNumber,
      fund_account_id: fundAccount.id,
      amount: Math.round(amount * 100), // paise
      currency: 'INR',
      mode: 'UPI',
      purpose: 'payout',
      queue_if_low_balance: true,
      reference_id: `ustaad_${payoutRow.id}`,
    }, auth);

    await supabase
      .from('ustaad_payouts')
      .update({ status: payout.status ?? 'queued', razorpay_payout_id: payout.id })
      .eq('id', payoutRow.id);

    // 4. Only now record the real deduction in the ledger.
    await supabase
      .from('ustaad_earnings_ledger')
      .insert({ device_id: deviceId, amount: -amount, source: 'withdrawal', meta: { payout_id: payout.id } });

    return NextResponse.json({ success: true, payout });
  } catch (err: any) {
    await supabase
      .from('ustaad_payouts')
      .update({ status: 'failed', failure_reason: String(err?.message ?? err) })
      .eq('id', payoutRow.id);

    return NextResponse.json({ error: `Razorpay payout failed: ${err?.message ?? err}` }, { status: 502 });
  }
}
