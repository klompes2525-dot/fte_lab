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
    <div className="container-fluid px-3 py-3" style={{ fontSize: '0.8rem' }}>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" />
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />

      {/* Header Navigation */}
      <div className="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
        <h4 className="m-0 fw-bold text-dark fs-5">
          <i className="fa-solid fa-users-gear text-primary me-2"></i>
          รายงานสรุปกรอบอัตรากำลังที่ต้องการ (FTE) รายเดือน
        </h4>
        <div className="d-flex gap-2">
          <Link href={`/?year=${buddhistYear}`} className="btn btn-outline-secondary btn-sm fw-bold">
            <i className="fa-solid fa-arrow-left me-1"></i> หน้าหลัก (คำนวณ FTE)
          </Link>
          <Link href={`/report-productivity?year=${buddhistYear}`} className="btn btn-outline-warning btn-sm text-dark fw-bold">
            Productivity (%)
          </Link>
          <Link href={`/report-summary?year=${buddhistYear}`} className="btn btn-outline-primary btn-sm fw-bold">
            สรุปปริมาณงานรายเดือน
          </Link>
        </div>
      </div>

      {/* ตัวกรอง ปี พ.ศ. (แบบกะทัดรัด) */}
      <div className="card mb-3 p-2 shadow-sm border-0">
        <form method="GET" className="row g-2 align-items-end">
          <div className="col-auto">
            <label className="form-label fw-bold small mb-1">เลือกปี พ.ศ.</label>
            <select name="year" defaultValue={buddhistYear} className="form-select form-select-sm" style={{ width: '140px' }}>
              {[buddhistYear - 1, buddhistYear, buddhistYear + 1].map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div className="col-auto">
            <button type="submit" className="btn btn-sm text-white fw-bold px-3" style={{ backgroundColor: '#8b5cf6' }}>
              แสดงรายงาน
            </button>
          </div>
        </form>
      </div>

      {/* ตารางแสดง FTE พร้อม Fixed Left Columns + Compact Dimensions */}
      <div className="card border-0 shadow-sm">
        <div className="card-body p-0">
          <div
            style={{
              maxHeight: 'calc(100vh - 180px)',
              overflow: 'auto',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              backgroundColor: '#ffffff',
            }}
          >
            <table
              style={{
                borderCollapse: 'separate',
                borderSpacing: 0,
                width: '100%',
                minWidth: '1100px',
                fontSize: '0.8rem',
              }}
            >
              <thead>
                <tr className="text-center">
                  {/* Sticky Header Top & Left Columns (1-4) */}
                  <th
                    style={{
                      position: 'sticky',
                      top: 0,
                      left: 0,
                      zIndex: 30,
                      backgroundColor: '#0f172a',
                      color: '#ffffff',
                      width: '40px',
                      minWidth: '40px',
                      borderBottom: '1px solid #334155',
                      borderRight: '1px solid #334155',
                      padding: '6px 2px',
                    }}
                  >
                    ลำดับ
                  </th>
                  <th
                    style={{
                      position: 'sticky',
                      top: 0,
                      left: 40,
                      zIndex: 30,
                      backgroundColor: '#0f172a',
                      color: '#ffffff',
                      width: '70px',
                      minWidth: '70px',
                      borderBottom: '1px solid #334155',
                      borderRight: '1px solid #334155',
                      padding: '6px 2px',
                    }}
                  >
                    HCODE
                  </th>
                  <th
                    style={{
                      position: 'sticky',
                      top: 0,
                      left: 110,
                      zIndex: 30,
                      backgroundColor: '#0f172a',
                      color: '#ffffff',
                      width: '160px',
                      minWidth: '160px',
                      textAlign: 'left',
                      borderBottom: '1px solid #334155',
                      borderRight: '1px solid #334155',
                      padding: '6px 6px',
                    }}
                  >
                    ชื่อสถานบริการ
                  </th>
                  <th
                    style={{
                      position: 'sticky',
                      top: 0,
                      left: 270,
                      zIndex: 30,
                      backgroundColor: '#0f172a',
                      color: '#ffffff',
                      width: '55px',
                      minWidth: '55px',
                      borderBottom: '1px solid #334155',
                      borderRight: '1px solid #cbd5e1',
                      padding: '6px 2px',
                    }}
                  >
                    ระดับ
                  </th>

                  {/* Header 12 เดือน */}
                  {[...Array(12)].map((_, i) => (
                    <th
                      key={i + 1}
                      style={{
                        position: 'sticky',
                        top: 0,
                        zIndex: 10,
                        backgroundColor: '#0f172a',
                        color: '#ffffff',
                        minWidth: '60px',
                        borderBottom: '1px solid #334155',
                        borderRight: '1px solid #334155',
                        padding: '6px 2px',
                      }}
                    >
                      {THAI_MONTHS_SHORT[i + 1]}
                      <br />
                      <span className="badge bg-secondary font-weight-normal" style={{ fontSize: '9px', padding: '1px 3px' }}>
                        {monthlyStdHours[i + 1]} ชม.
                      </span>
                    </th>
                  ))}

                  {/* Header FTE เฉลี่ย */}
                  <th
                    style={{
                      position: 'sticky',
                      top: 0,
                      zIndex: 10,
                      backgroundColor: '#6b21a8',
                      color: '#ffffff',
                      minWidth: '95px',
                      borderBottom: '1px solid #334155',
                      padding: '6px 4px',
                    }}
                  >
                    FTE เฉลี่ย/เดือน
                  </th>
                </tr>
              </thead>
              <tbody>
                {hospitals?.map((h, idx) => {
                  const activeFtes: number[] = [];
                  const hc = String(h.hcode);

                  return (
                    <tr key={hc} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      {/* Body Left Sticky Columns (1-4) */}
                      <td
                        style={{
                          position: 'sticky',
                          left: 0,
                          zIndex: 15,
                          backgroundColor: '#ffffff',
                          textAlign: 'center',
                          borderRight: '1px solid #e2e8f0',
                          borderBottom: '1px solid #e2e8f0',
                          padding: '5px 2px',
                        }}
                      >
                        {idx + 1}
                      </td>
                      <td
                        style={{
                          position: 'sticky',
                          left: 40,
                          zIndex: 15,
                          backgroundColor: '#ffffff',
                          textAlign: 'center',
                          borderRight: '1px solid #e2e8f0',
                          borderBottom: '1px solid #e2e8f0',
                          padding: '5px 2px',
                        }}
                      >
                        <span className="badge bg-secondary" style={{ fontSize: '10px' }}>{hc}</span>
                      </td>
                      <td
                        style={{
                          position: 'sticky',
                          left: 110,
                          zIndex: 15,
                          backgroundColor: '#ffffff',
                          textAlign: 'left',
                          fontWeight: 'bold',
                          color: '#1e293b',
                          borderRight: '1px solid #e2e8f0',
                          borderBottom: '1px solid #e2e8f0',
                          padding: '5px 6px',
                        }}
                      >
                        {h.hname}
                      </td>
                      <td
                        style={{
                          position: 'sticky',
                          left: 270,
                          zIndex: 15,
                          backgroundColor: '#ffffff',
                          textAlign: 'center',
                          borderRight: '1px solid #cbd5e1',
                          borderBottom: '1px solid #e2e8f0',
                          padding: '5px 2px',
                        }}
                      >
                        <span className="badge bg-info text-dark" style={{ fontSize: '10px' }}>{h.hospital_level}</span>
                      </td>

                      {/* ข้อมูล 12 เดือน */}
                      {[...Array(12)].map((_, i) => {
                        const m = i + 1;
                        const fte = fteMatrix[hc]?.[m] || 0;
                        const hasData = hasDataMatrix[hc]?.[m] || false;
                        if (hasData) activeFtes.push(fte);

                        return (
                          <td
                            key={m}
                            style={{
                              textAlign: 'center',
                              borderRight: '1px solid #e2e8f0',
                              borderBottom: '1px solid #e2e8f0',
                              padding: '5px 2px',
                              fontWeight: hasData ? 'bold' : 'normal',
                              color: hasData ? '#7c3aed' : '#94a3b8',
                            }}
                          >
                            {hasData ? fte.toFixed(2) : '-'}
                          </td>
                        );
                      })}

                      {/* FTE เฉลี่ยประจำ รพ. */}
                      <td
                        style={{
                          textAlign: 'center',
                          fontWeight: 'bold',
                          color: '#6b21a8',
                          backgroundColor: '#f8fafc',
                          borderBottom: '1px solid #e2e8f0',
                          padding: '5px 4px',
                        }}
                      >
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
    </div>
  );
}