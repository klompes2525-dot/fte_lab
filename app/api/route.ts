import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const apiToken = req.headers.get('x-api-token') || '';
    const secretKey = req.headers.get('x-secret-key') || '';

    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://mriqyjfltiffzmcyhmpv.supabase.co';
    const supabaseAnonKey =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      'sb_publishable_pInNrBqs1smiMiCbnTTIuw_JsDkndIw';

    const response = await fetch(
      `${supabaseUrl.replace(/\/$/, '')}/functions/v1/submit-workload`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${supabaseAnonKey}`,
          apikey: supabaseAnonKey,
          'x-api-token': apiToken,
          'x-secret-key': secretKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );

    const text = await response.text();
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text || `เซิร์ฟเวอร์ตอบกลับสถานะ ${response.status}` };
    }

    return NextResponse.json(data, { status: response.status });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown server error';
    return NextResponse.json(
      { error: `เชื่อมต่อ Supabase Edge Function ไม่สำเร็จ: ${msg}` },
      { status: 500 }
    );
  }
}