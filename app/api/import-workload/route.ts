import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

interface PayloadItem {
  hospital_code: string;
  start_date: string;
  end_date?: string;
  staff_mt?: number;
  staff_other_mt?: number;
  metrics?: Record<string, number>;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const payloadList: PayloadItem[] = Array.isArray(body?.payload_list) ? body.payload_list : [];

    const apiToken = (req.headers.get('x-api-token') || '').trim();
    const secretKey = (req.headers.get('x-secret-key') || '').trim();

    if (!apiToken || !secretKey) {
      return NextResponse.json(
        { error: 'กรุณาระบุ API Token และ Secret Key ให้ครบถ้วน' },
        { status: 401 }
      );
    }

    if (payloadList.length === 0) {
      return NextResponse.json(
        { error: 'ไม่พบรายการข้อมูลสำหรับนำเข้า' },
        { status: 400 }
      );
    }

    const hospitalCode = String(payloadList[0].hospital_code || '').trim();

    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://mriqyjfltiffzmcyhmpv.supabase.co';
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      'sb_publishable_pInNrBqs1smiMiCbnTTIuw_JsDkndIw';

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. ตรวจสอบสิทธิ์โรงพยาบาลจากตาราง hospitals
    const { data: hosp, error: hospError } = await supabase
      .from('hospitals')
      .select('hcode, hname, api_token, secret_key, is_active')
      .eq('hcode', hospitalCode)
      .maybeSingle();

    if (hospError) {
      return NextResponse.json(
        { error: `ไม่สามารถตรวจสอบข้อมูลโรงพยาบาลได้: ${hospError.message}` },
        { status: 500 }
      );
    }

    if (!hosp) {
      return NextResponse.json(
        { error: `ไม่พบรหัสสถานบริการ (${hospitalCode}) ในระบบ` },
        { status: 404 }
      );
    }

    if (hosp.is_active !== 1) {
      return NextResponse.json(
        { error: `รหัสสถานบริการ (${hospitalCode}) ถูกระงับการใช้งาน` },
        { status: 403 }
      );
    }

    if (String(hosp.api_token).trim() !== apiToken || String(hosp.secret_key).trim() !== secretKey) {
      return NextResponse.json(
        { error: 'API Token หรือ Secret Key ไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง' },
        { status: 401 }
      );
    }

    // 2. เตรียมข้อมูลสำหรับบันทึกลงตาราง workload_daily
    const rowsToInsert = payloadList.map((item) => {
      const m = item.metrics || {};
      return {
        hospital_code: String(item.hospital_code).trim(),
        start_date: item.start_date,
        end_date: item.end_date || item.start_date,
        sample_collection: Number(m.sample_collection) || 0,
        hematology: Number(m.hematology) || 0,
        clinical_microscopy: Number(m.clinical_microscopy) || 0,
        clinical_chemistry: Number(m.clinical_chemistry) || 0,
        clinical_immunology: Number(m.clinical_immunology) || 0,
        clinical_microbiology: Number(m.clinical_microbiology) || 0,
        molecular_biology: Number(m.molecular_biology) || 0,
        blood_bank_no_nat: Number(m.blood_bank_no_nat) || 0,
        blood_bank_has_nat: Number(m.blood_bank_has_nat) || 0,
        blood_bank_prep: Number(m.blood_bank_prep) || 0,
        blood_bank_donation: Number(m.blood_bank_donation) || 0,
        blood_bank_nat_cert: Number(m.blood_bank_nat_cert) || 0,
        grand_total_workload: Number(m.grand_total_workload) || 0,
        staff_mt: Number(item.staff_mt) || 1,
        staff_other_mt: Number(item.staff_other_mt) || 0,
      };
    });

    // 3. แบ่งชุดข้อมูลทีละ 300 วัน เพื่อป้องกัน URL ยาวเกินกำหนดของ Supabase เมื่ออัปโหลดหลายปี
    const CHUNK_SIZE = 300;
    for (let i = 0; i < rowsToInsert.length; i += CHUNK_SIZE) {
      const chunk = rowsToInsert.slice(i, i + CHUNK_SIZE);
      const chunkDates = chunk.map((r) => r.start_date);

      const { error: delError } = await supabase
        .from('workload_daily')
        .delete()
        .eq('hospital_code', hospitalCode)
        .in('start_date', chunkDates);

      if (delError) {
        return NextResponse.json(
          { error: `ไม่สามารถอัปเดตข้อมูลเดิมได้ (RLS/Delete): ${delError.message}` },
          { status: 500 }
        );
      }

      const { error: insertError } = await supabase
        .from('workload_daily')
        .insert(chunk);

      if (insertError) {
        return NextResponse.json(
          { error: `บันทึกข้อมูลลงตาราง workload_daily ไม่สำเร็จ: ${insertError.message}` },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      message: `นำเข้าข้อมูลของ ${hosp.hname} (${hospitalCode}) สำเร็จจำนวน ${rowsToInsert.length} วัน`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown server error';
    return NextResponse.json(
      { error: `เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์: ${msg}` },
      { status: 500 }
    );
  }
}