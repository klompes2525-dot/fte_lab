import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { LEVEL_COLUMN_MAP, calculateWorkingDays } from '@/lib/fte-utils';

export const revalidate = 0;

interface PageProps {
  searchParams: Promise<{ year?: string }>;
}

const THAI_MONTHS_SHORT: Record<number, string> = {
  1: 'ม.ค.', 2: 'ก.พ.', 3: 'มี.ค.', 4: 'เม.ย.', 5: 'พ.ค.', 6: 'มิ.ย.',
  7: 'ก.ค.', 8: 'ส.ค.', 9: 'ก.ย.', 10: 'ต.ค.', 11: 'พ.ย.', 12: 'ธ.ค.'
};

export default async function ReportFteMonthlyPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const currentYearAD = new Date().getFullYear();
  let inputYear = params.year ? parseInt(params.year) : currentYearAD + 543;
  
  const adYear = inputYear > 2400 ? inputYear - 543 : inputYear;
  const buddhistYear = inputYear > 2400 ? inputYear : inputYear + 543;

  // 1. ดึง รพ. และกิจกรรม
  const { data: hospitals } = await supabase.from('hospitals').select('*').eq('is_active', 1).order('hcode', { ascending: true });
  const { data: activities } = await supabase.from('medical_tech_workload').select('*').order('id', { ascending: true });

  // 2. คำนวณวันทำงานมาตรฐานแต่ละเดือน (1-12)
  const monthlyStdHours: Record<number, number> = {};
  for (let m = 1; m <= 12; m++) {
    const startDateStr = `${adYear}-${String(m).padStart(2, '0')}-01`;
    const endDateStr = `${adYear}-${String(m).padStart(2, '0')}-${new Date(adYear, m, 0).getDate()}`;
    const { data: holidaysData } = await supabase.from('holidays').select('holiday_date').gte('holiday_date', startDateStr).lte('holiday_date', endDateStr);
    const { workingDays } = calculateWorkingDays(adYear, m, (holidaysData || []).map(h => h.holiday_date));
    monthlyStdHours[m] = workingDays * 7;
  }

  // 3. ดึงข้อมูลปริมาณงานประจำปี
  const startDate = `${adYear}-01-01`;
  const endDate = `${adYear}-12-31`;
  const { data: rawMonthly } = await supabase.from('workload_daily').select('*').gte('start_date', startDate).lte('start_date', endDate);

  // Group by [hcode][month]
  const workloadMatrix: Record<string, Record<number, Record<number, number>>> = {};
  rawMonthly?.forEach(row => {
    const hc = row.hospital_code;
    const m = new Date(row.start_date).getMonth() + 1;
    if (!workloadMatrix[hc]) workloadMatrix[hc] = {};
    if (!workloadMatrix[hc][m]) workloadMatrix[hc][m] = {};

    const actMap: Record<number, string> = {
      1: 'sample_collection', 2: 'hematology', 3: 'clinical_microscopy', 4: 'clinical_chemistry',
      5: 'clinical_immunology', 6: 'clinical_microbiology', 7: 'molecular_biology', 8: 'blood_bank_no_nat',
      9: 'blood_bank_has_nat', 10: 'blood_bank_prep', 11: 'blood_bank_donation', 12: 'blood_bank_nat_cert'
    };

    Object.entries(actMap).forEach(([actId, colName]) => {
      const id = parseInt(actId);
      workloadMatrix[hc][m][id] = (workloadMatrix[hc][m][id] || 0) + (row[colName] || 0);
    });
  });

  // Calculate FTE Matrix (+ Allowance 5%)
  const fteMatrix: Record<string, Record<number, number>> = {};
  const hasDataMatrix: Record<string, Record<number, boolean>> = {};

  hospitals?.forEach(h => {
    const hc = h.hcode;
    const stdCol = LEVEL_COLUMN_MAP[h.hospital_level] || 'hospital_f2';
    fteMatrix[hc] = {};
    hasDataMatrix[hc] = {};

    for (let m = 1; m <= 12; m++) {
      if (!workloadMatrix[hc] || !workloadMatrix[hc][m]) {
        fteMatrix[hc][m] = 0;
        hasDataMatrix[hc][m] = false;
        continue;
      }
      hasDataMatrix[hc][m] = true;
      const vData = workloadMatrix[hc][m];
      const hasSubItems = (vData[10] || 0) > 0 || (vData[11] || 0) > 0 || (vData[12] || 0) > 0;

      let totalMinutes = 0;
      activities?.forEach(act => {
        const stdTime = Number(act[stdCol]) || 0;
        const vol = vData[act.id] || 0;
        if ((act.id === 8 || act.id === 9) && hasSubItems) return;
        totalMinutes += (stdTime * vol);
      });

      const hours = totalMinutes / 60;
      const mStdHrs = monthlyStdHours[m];
      const fteMain = mStdHrs > 0 ? hours / mStdHrs : 0;
      fteMatrix[hc][m] = fteMain * 1.05; // รวม Allowance 5%
    }
  });

  return (
    <div className="container-fluid px-4 py-4">
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" />
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h3 className="m-0 fw-bold">รายงานสรุปกรอบอัตรากำลังที่ต้องการ (FTE) รายเดือน</h3>
        <Link href={`/?year=${buddhistYear}`} className="btn btn-outline-secondary">หน้าหลัก</Link>
      </div>

      <div className="card mb-4 p-3">
        <form method="GET" className="row g-3 align-items-end">
          <div className="col-md-4">
            <label className="form-label fw-bold small">เลือกปี พ.ศ.</label>
            <select name="year" defaultValue={buddhistYear} className="form-select">
              {[buddhistYear - 1, buddhistYear, buddhistYear + 1].map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div className="col-md-2">
            <button type="submit" className="btn text-white w-100" style={{ backgroundColor: '#8b5cf6' }}>แสดงรายงาน</button>
          </div>
        </form>
      </div>

      <div className="card border-0 shadow-sm">
        <div className="card-body p-0 table-responsive">
          <table className="table table-hover table-bordered mb-0 align-middle text-nowrap">
            <thead className="table-dark text-center">
              <tr>
                <th>ลำดับ</th>
                <th>HCODE</th>
                <th className="text-start">ชื่อสถานบริการ</th>
                <th>ระดับ</th>
                {[...Array(12)].map((_, i) => (
                  <th key={i + 1}>{THAI_MONTHS_SHORT[i + 1]}<br/><span className="badge bg-secondary">{monthlyStdHours[i + 1]} ชม.</span></th>
                ))}
                <th style={{ backgroundColor: '#6b21a8' }}>FTE เฉลี่ย/เดือน</th>
              </tr>
            </thead>
            <tbody>
              {hospitals?.map((h, idx) => {
                const activeFtes: number[] = [];
                return (
                  <tr key={h.hcode}>
                    <td className="text-center">{idx + 1}</td>
                    <td className="text-center"><span className="badge bg-secondary">{h.hcode}</span></td>
                    <td className="fw-bold">{h.hname}</td>
                    <td className="text-center">{h.hospital_level}</td>
                    {[...Array(12)].map((_, i) => {
                      const m = i + 1;
                      const fte = fteMatrix[h.hcode][m];
                      const hasData = hasDataMatrix[h.hcode][m];
                      if (hasData) activeFtes.push(fte);
                      return (
                        <td key={m} className={`text-center ${fte > 0 ? 'fw-bold text-purple' : 'text-muted'}`}>
                          {hasData ? fte.toFixed(2) : '-'}
                        </td>
                      );
                    })}
                    <td className="text-center fw-bold bg-light" style={{ color: '#7c3aed' }}>
                      {activeFtes.length > 0 ? (activeFtes.reduce((a, b) => a + b, 0) / activeFtes.length).toFixed(2) : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}