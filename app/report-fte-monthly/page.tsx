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
  const today = new Date();
  const currentYearAD = today.getFullYear();
  const currentMonth = today.getMonth() + 1; // เดือนปัจจุบัน (1-12)

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

  // Group by [hcode][month] และนับจำนวนวันที่บันทึกจริง
  const workloadMatrix: Record<string, Record<number, Record<number, number>>> = {};
  const recordedDaysMatrix: Record<string, Record<number, Set<string>>> = {};

  rawMonthly?.forEach(row => {
    const hc = String(row.hospital_code);
    const m = new Date(row.start_date).getMonth() + 1;

    if (!workloadMatrix[hc]) workloadMatrix[hc] = {};
    if (!workloadMatrix[hc][m]) workloadMatrix[hc][m] = {};

    if (!recordedDaysMatrix[hc]) recordedDaysMatrix[hc] = {};
    if (!recordedDaysMatrix[hc][m]) recordedDaysMatrix[hc][m] = new Set();
    if (row.start_date) recordedDaysMatrix[hc][m].add(row.start_date);

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

  // Calculate FTE Matrix (+ Allowance 5%) & Check Complete Months
  const fteMatrix: Record<string, Record<number, number>> = {};
  const hasDataMatrix: Record<string, Record<number, boolean>> = {};
  const isCompleteMonthMatrix: Record<string, Record<number, boolean>> = {};

  hospitals?.forEach(h => {
    const hc = String(h.hcode);
    const stdCol = LEVEL_COLUMN_MAP[h.hospital_level] || 'hospital_f2';
    fteMatrix[hc] = {};
    hasDataMatrix[hc] = {};
    isCompleteMonthMatrix[hc] = {};

    for (let m = 1; m <= 12; m++) {
      if (!workloadMatrix[hc] || !workloadMatrix[hc][m]) {
        fteMatrix[hc][m] = 0;
        hasDataMatrix[hc][m] = false;
        isCompleteMonthMatrix[hc][m] = false;
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

      // ตรวจสอบความสมบูรณ์ของเดือน (ต้องเป็นเดือนที่จบแล้ว + ส่งข้อมูลครบเต็มเดือน)
      const totalDaysInMonth = new Date(adYear, m, 0).getDate();
      const recordedDaysCount = recordedDaysMatrix[hc]?.[m]?.size || 0;
      
      const isPastMonth = adYear < currentYearAD || (adYear === currentYearAD && m < currentMonth);
      const isFullMonthData = recordedDaysCount >= totalDaysInMonth;

      isCompleteMonthMatrix[hc][m] = isPastMonth && isFullMonthData;
    }
  });

  return (
    <div className="container-fluid px-4 py-4" style={{ fontSize: '0.95rem' }}>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" />
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />

      {/* Header Navigation */}
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-3">
        <h3 className="m-0 fw-bold text-dark fs-4">
          <i className="fa-solid fa-users-gear text-primary me-2"></i>
          รายงานสรุปกรอบอัตรากำลังที่ต้องการ (FTE) รายเดือน
        </h3>
        <div className="d-flex gap-2">
          <Link href={`/?year=${buddhistYear}`} className="btn btn-outline-secondary fw-bold px-3 py-2" style={{ fontSize: '0.9rem' }}>
            <i className="fa-solid fa-arrow-left me-1"></i> หน้าหลัก (คำนวณ FTE)
          </Link>
          <Link href={`/report-productivity?year=${buddhistYear}`} className="btn btn-outline-warning text-dark fw-bold px-3 py-2" style={{ fontSize: '0.9rem' }}>
            Productivity (%)
          </Link>
          <Link href={`/report-summary?year=${buddhistYear}`} className="btn btn-outline-primary fw-bold px-3 py-2" style={{ fontSize: '0.9rem' }}>
            สรุปปริมาณงานรายเดือน
          </Link>
        </div>
      </div>

      {/* ตัวกรอง ปี พ.ศ. */}
      <div className="card mb-3 p-3 shadow-sm border-0">
        <form method="GET" className="row g-3 align-items-end">
          <div className="col-auto">
            <label className="form-label fw-bold mb-1" style={{ fontSize: '0.95rem' }}>เลือกปี พ.ศ.</label>
            <select name="year" defaultValue={buddhistYear} className="form-select form-select-md fw-bold" style={{ width: '160px', height: '42px', fontSize: '0.95rem' }}>
              {[buddhistYear - 1, buddhistYear, buddhistYear + 1].map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div className="col-auto">
            <button type="submit" className="btn text-white fw-bold px-4" style={{ backgroundColor: '#8b5cf6', height: '42px', fontSize: '0.95rem' }}>
              <i className="fa-solid fa-magnifying-glass me-2"></i>แสดงรายงาน
            </button>
          </div>
        </form>
      </div>

      {/* ตารางแสดง FTE พร้อม Fixed Left Columns + Large Dimensions */}
      <div className="card border-0 shadow-sm">
        <div className="card-body p-0">
          <div
            style={{
              maxHeight: 'calc(100vh - 210px)',
              overflow: 'auto',
              border: '1px solid #cbd5e1',
              borderRadius: '8px',
              backgroundColor: '#ffffff',
            }}
          >
            <table
              style={{
                borderCollapse: 'separate',
                borderSpacing: 0,
                width: '100%',
                minWidth: '1350px',
                fontSize: '0.95rem',
              }}
            >
              <thead>
                <tr className="text-center">
                  {/* Sticky Header Left Columns (1-4) */}
                  <th
                    style={{
                      position: 'sticky',
                      top: 0,
                      left: 0,
                      zIndex: 30,
                      backgroundColor: '#0f172a',
                      color: '#ffffff',
                      width: '55px',
                      minWidth: '55px',
                      borderBottom: '1px solid #334155',
                      borderRight: '1px solid #334155',
                      padding: '10px 4px',
                    }}
                  >
                    ลำดับ
                  </th>
                  <th
                    style={{
                      position: 'sticky',
                      top: 0,
                      left: 55,
                      zIndex: 30,
                      backgroundColor: '#0f172a',
                      color: '#ffffff',
                      width: '85px',
                      minWidth: '85px',
                      borderBottom: '1px solid #334155',
                      borderRight: '1px solid #334155',
                      padding: '10px 4px',
                    }}
                  >
                    HCODE
                  </th>
                  <th
                    style={{
                      position: 'sticky',
                      top: 0,
                      left: 140,
                      zIndex: 30,
                      backgroundColor: '#0f172a',
                      color: '#ffffff',
                      width: '210px',
                      minWidth: '210px',
                      textAlign: 'left',
                      borderBottom: '1px solid #334155',
                      borderRight: '1px solid #334155',
                      padding: '10px 8px',
                    }}
                  >
                    ชื่อสถานบริการ
                  </th>
                  <th
                    style={{
                      position: 'sticky',
                      top: 0,
                      left: 350,
                      zIndex: 30,
                      backgroundColor: '#0f172a',
                      color: '#ffffff',
                      width: '70px',
                      minWidth: '70px',
                      borderBottom: '1px solid #334155',
                      borderRight: '2px solid #94a3b8',
                      padding: '10px 4px',
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
                        minWidth: '75px',
                        borderBottom: '1px solid #334155',
                        borderRight: '1px solid #334155',
                        padding: '8px 4px',
                      }}
                    >
                      {THAI_MONTHS_SHORT[i + 1]}
                      <br />
                      <span className="badge bg-secondary fw-normal mt-1" style={{ fontSize: '11px', padding: '2px 5px' }}>
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
                      minWidth: '120px',
                      borderBottom: '1px solid #334155',
                      padding: '10px 6px',
                    }}
                  >
                    FTE เฉลี่ย/เดือน
                  </th>
                </tr>
              </thead>
              <tbody>
                {hospitals?.map((h, idx) => {
                  const completeFtes: number[] = [];
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
                          padding: '8px 4px',
                        }}
                      >
                        {idx + 1}
                      </td>
                      <td
                        style={{
                          position: 'sticky',
                          left: 55,
                          zIndex: 15,
                          backgroundColor: '#ffffff',
                          textAlign: 'center',
                          borderRight: '1px solid #e2e8f0',
                          borderBottom: '1px solid #e2e8f0',
                          padding: '8px 4px',
                        }}
                      >
                        <span className="badge bg-secondary px-2 py-1" style={{ fontSize: '11px' }}>{hc}</span>
                      </td>
                      <td
                        style={{
                          position: 'sticky',
                          left: 140,
                          zIndex: 15,
                          backgroundColor: '#ffffff',
                          textAlign: 'left',
                          fontWeight: 'bold',
                          color: '#1e293b',
                          borderRight: '1px solid #e2e8f0',
                          borderBottom: '1px solid #e2e8f0',
                          padding: '8px 8px',
                        }}
                      >
                        {h.hname}
                      </td>
                      <td
                        style={{
                          position: 'sticky',
                          left: 350,
                          zIndex: 15,
                          backgroundColor: '#ffffff',
                          textAlign: 'center',
                          borderRight: '2px solid #94a3b8',
                          borderBottom: '1px solid #e2e8f0',
                          padding: '8px 4px',
                        }}
                      >
                        <span className="badge bg-info text-dark px-2 py-1" style={{ fontSize: '11px' }}>{h.hospital_level}</span>
                      </td>

                      {/* ข้อมูล 12 เดือน */}
                      {[...Array(12)].map((_, i) => {
                        const m = i + 1;
                        const fte = fteMatrix[hc]?.[m] || 0;
                        const hasData = hasDataMatrix[hc]?.[m] || false;
                        const isComplete = isCompleteMonthMatrix[hc]?.[m] || false;

                        if (hasData && isComplete) {
                          completeFtes.push(fte);
                        }

                        return (
                          <td
                            key={m}
                            style={{
                              textAlign: 'center',
                              borderRight: '1px solid #e2e8f0',
                              borderBottom: '1px solid #e2e8f0',
                              padding: '8px 4px',
                              fontWeight: hasData ? 'bold' : 'normal',
                              color: !hasData 
                                ? '#94a3b8' 
                                : isComplete 
                                  ? '#7c3aed' 
                                  : '#d97706', // สีส้มสำหรับเดือนที่ไม่สมบูรณ์/ไม่เต็มเดือน
                              backgroundColor: (hasData && !isComplete) ? '#fffbeb' : 'transparent',
                            }}
                            title={hasData && !isComplete ? 'เดือนนี้ยังไม่เต็มเดือน ไม่นำไปคิดค่าเฉลี่ย' : ''}
                          >
                            {hasData 
                              ? (
                                  <span>
                                    {fte.toFixed(2)}
                                    {!isComplete && <span className="text-warning ms-1" style={{ fontSize: '0.75rem' }}>*</span>}
                                  </span>
                                ) 
                              : '-'}
                          </td>
                        );
                      })}

                      {/* FTE เฉลี่ยประจำ รพ. (คิดเฉพาะเดือนที่เต็มเดือนจริงเท่านั้น) */}
                      <td
                        style={{
                          textAlign: 'center',
                          fontWeight: 'bold',
                          fontSize: '1rem',
                          color: '#6b21a8',
                          backgroundColor: '#f8fafc',
                          borderBottom: '1px solid #e2e8f0',
                          padding: '8px 6px',
                        }}
                      >
                        {completeFtes.length > 0 
                          ? (completeFtes.reduce((a, b) => a + b, 0) / completeFtes.length).toFixed(2) 
                          : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card-footer bg-white text-muted small py-2">
          <i className="fa-solid fa-circle-info text-warning me-1"></i>
          <span>* หมายเหตุ: ตัวเลขที่มีเครื่องหมาย <strong>* (สีส้ม)</strong> เป็นข้อมูลของเดือนที่ยังไม่สิ้นสุดเต็มเดือน หรือมีจำนวนวันที่ลงข้อมูลไม่ครบตามจำนวนวันในเดือนนั้น ซึ่งจะไม่นำมาคำนวณในช่อง <strong>FTE เฉลี่ย/เดือน</strong></span>
        </div>
      </div>
    </div>
  );
}