import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { LEVEL_COLUMN_MAP, THAI_MONTHS, calculateWorkingDays } from '@/lib/fte-utils';

export const revalidate = 0;

interface PageProps {
  searchParams: Promise<{
    year?: string;
  }>;
}

export default async function YearlyReportPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const currentYearAD = new Date().getFullYear();
  
  // 1. จัดการปี พ.ศ. / ค.ศ.
  let selectedYear = params.year ? parseInt(params.year) : currentYearAD;
  if (selectedYear > 2400) selectedYear -= 543;
  const buddhistYear = selectedYear + 543;

  // 2. ดึงรายชื่อโรงพยาบาลทั้งหมด
  const { data: hospitals } = await supabase
    .from('hospitals')
    .select('hcode, hname, hospital_level')
    .eq('is_active', 1)
    .order('hcode', { ascending: true });

  // 3. ดึงรายการกิจกรรมเวลามาตรฐาน
  const { data: activities } = await supabase
    .from('medical_tech_workload')
    .select('*')
    .order('id', { ascending: true });

  // 4. ดึงข้อมูลปริมาณงาน daily ตลอดทั้งปี
  const startDateStr = `${selectedYear}-01-01`;
  const endDateStr = `${selectedYear}-12-31`;

  const { data: yearlyDailyWorkload } = await supabase
    .from('workload_daily')
    .select('*')
    .gte('start_date', startDateStr)
    .lte('start_date', endDateStr);

  // 5. ดึงข้อมูลวันหยุดนักขัตฤกษ์ตลอดทั้งปี
  const { data: holidaysData } = await supabase
    .from('holidays')
    .select('holiday_date')
    .gte('holiday_date', startDateStr)
    .lte('holiday_date', endDateStr);

  const holidayList = (holidaysData || []).map(h => h.holiday_date);

  // จัดกลุ่มข้อมูล ปริมาณงานตาม [hcode][month][volKey]
  const workloadByHospMonth: Record<string, Record<number, Record<string, number>>> = {};

  yearlyDailyWorkload?.forEach(row => {
    const hcode = String(row.hospital_code);
    const month = new Date(row.start_date).getMonth() + 1;

    if (!workloadByHospMonth[hcode]) workloadByHospMonth[hcode] = {};
    if (!workloadByHospMonth[hcode][month]) workloadByHospMonth[hcode][month] = {};

    Object.keys(row).forEach(key => {
      if (typeof row[key] === 'number') {
        workloadByHospMonth[hcode][month][key] = (workloadByHospMonth[hcode][month][key] || 0) + row[key];
      }
    });
  });

  // คำนวณชั่วโมงมาตรฐานประจำแต่ละเดือน (1-12)
  const monthlyWorkingHours: Record<number, number> = {};
  for (let m = 1; m <= 12; m++) {
    const { workingDays } = calculateWorkingDays(selectedYear, m, holidayList);
    monthlyWorkingHours[m] = workingDays * 7;
  }

  // คำนวณ FTE แต่ละโรงพยาบาลในแต่ละเดือน
  const fteMatrix: Record<string, Record<number, number>> = {};
  const monthTotalFTE: Record<number, number> = {};
  for (let m = 1; m <= 12; m++) monthTotalFTE[m] = 0;

  (hospitals || []).forEach(h => {
    const hcode = String(h.hcode);
    fteMatrix[hcode] = {};

    const hLevel = h.hospital_level || 'F2';
    const levelKey = hLevel.toLowerCase().trim();
    const stdTimeCol = LEVEL_COLUMN_MAP[hLevel] || LEVEL_COLUMN_MAP[levelKey] || `hospital_${levelKey}`;

    for (let m = 1; m <= 12; m++) {
      const sums = workloadByHospMonth[hcode]?.[m] || {};
      const hasSubItemsVolume = (sums['blood_bank_prep'] || 0) > 0 || (sums['blood_bank_donation'] || 0) > 0 || (sums['blood_bank_nat_cert'] || 0) > 0;

      let grandTotalMinutes = 0;
      (activities || []).forEach(act => {
        const actId = act.id;
        let volKey = '';
        switch (actId) {
          case 1: volKey = 'sample_collection'; break;
          case 2: volKey = 'hematology'; break;
          case 3: volKey = 'clinical_microscopy'; break;
          case 4: volKey = 'clinical_chemistry'; break;
          case 5: volKey = 'clinical_immunology'; break;
          case 6: volKey = 'clinical_microbiology'; break;
          case 7: volKey = 'molecular_biology'; break;
          case 8: volKey = 'blood_bank_no_nat'; break;
          case 9: volKey = 'blood_bank_has_nat'; break;
          case 10: volKey = 'blood_bank_prep'; break;
          case 11: volKey = 'blood_bank_donation'; break;
          case 12: volKey = 'blood_bank_nat_cert'; break;
        }

        const volume = sums[volKey] || 0;
        const stdTime = Number(act[stdTimeCol]) || 0;
        const isSubCheck = (actId === 8 || actId === 9) && hasSubItemsVolume;
        if (!isSubCheck) {
          grandTotalMinutes += stdTime * volume;
        }
      });

      const grandTotalHours = grandTotalMinutes / 60;
      const stdHours = monthlyWorkingHours[m] || 147;
      const fteMain = stdHours > 0 ? grandTotalHours / stdHours : 0;
      const fteWithAllowance = fteMain * 1.05;

      fteMatrix[hcode][m] = fteWithAllowance;
      monthTotalFTE[m] += fteWithAllowance;
    }
  });

  // รวม FTE ทุกเดือนของทุก รพ. เพื่อหาค่าเฉลี่ย
  const grandTotalYearFTE = Object.values(monthTotalFTE).reduce((a, b) => a + b, 0);
  const totalHospCount = hospitals?.length || 0;
  const avgYearlyFTEPerHosp = totalHospCount > 0 ? grandTotalYearFTE / (12 * totalHospCount) : 0;

  return (
    <div className="container-fluid px-3 py-2 d-flex flex-column" style={{ fontSize: '0.8rem', minHeight: '100vh' }}>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" />
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />

      {/* Header & Filter */}
      <div className="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
        <h4 className="m-0 fw-bold text-dark fs-5">
          <i className="fa-solid fa-chart-line text-success me-2"></i>
          สรุปกรอบอัตรากำลัง FTE รายปี (ทุกโรงพยาบาล)
        </h4>
        <div className="d-flex align-items-center gap-2">
          <form method="GET" className="d-flex align-items-center gap-2">
            <label className="fw-bold small mb-0">เลือกปี พ.ศ.:</label>
            <select 
              name="year" 
              defaultValue={buddhistYear} 
              className="form-select form-select-sm"
              style={{ width: '110px' }}
            >
              {[currentYearAD - 1, currentYearAD, currentYearAD + 1].map(y => (
                <option key={y} value={y + 543}>{y + 543}</option>
              ))}
            </select>
            <button type="submit" className="btn btn-primary btn-sm fw-bold">กรอง</button>
          </form>
          <Link href="/" className="btn btn-outline-secondary btn-sm fw-bold">
            <i className="fa-solid fa-arrow-left me-1"></i> กลับหน้ารายเดือน
          </Link>
        </div>
      </div>

      {/* Main Table with Frozen Left Columns, Sticky Header & Sticky Footer */}
      <div className="card border-0 shadow-sm flex-grow-1 mb-2">
        <div className="card-body p-0">
          <div className="table-scroll-container">
            <table className="table table-hover table-bordered align-middle mb-0" style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
              <thead>
                <tr>
                  {/* Sticky Column 1 Header */}
                  <th className="sticky-head-1 text-center" style={{ width: '80px' }}>
                    HCODE
                  </th>
                  {/* Sticky Column 2 Header */}
                  <th className="sticky-head-2 text-start" style={{ width: '200px' }}>
                    ชื่อโรงพยาบาล
                  </th>
                  <th className="sticky-head-top text-center" style={{ width: '70px' }}>ระดับ</th>
                  
                  {/* 12 Months Header */}
                  {Object.values(THAI_MONTHS).map((mName) => (
                    <th key={mName} className="sticky-head-top text-center" style={{ width: '75px' }}>
                      {mName}
                    </th>
                  ))}
                  <th className="sticky-head-top text-center bg-primary text-white" style={{ width: '95px' }}>
                    เฉลี่ย FTE/ปี
                  </th>
                </tr>
              </thead>
              <tbody>
                {hospitals?.map((h) => {
                  const hcode = String(h.hcode);
                  let hospYearFTE = 0;

                  return (
                    <tr key={hcode}>
                      {/* Fixed Left Column 1: HCODE */}
                      <td className="sticky-col-1 text-center fw-bold">
                        {hcode}
                      </td>

                      {/* Fixed Left Column 2: ชื่อ รพ. */}
                      <td className="sticky-col-2 text-start fw-bold">
                        {h.hname}
                      </td>

                      <td className="text-center">
                        <span className="badge bg-secondary" style={{ fontSize: '10px' }}>{h.hospital_level}</span>
                      </td>

                      {/* แสดงค่า FTE แต่ละเดือน (1-12) */}
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                        const val = fteMatrix[hcode]?.[m] || 0;
                        hospYearFTE += val;
                        return (
                          <td key={m} className={`text-end ${val > 0 ? 'fw-bold text-dark' : 'text-muted'}`}>
                            {val > 0 ? val.toFixed(2) : '-'}
                          </td>
                        );
                      })}

                      {/* ค่าเฉลี่ยรายปีของโรงพยาบาลนี้ */}
                      <td className="text-end fw-bold text-primary bg-light">
                        {(hospYearFTE / 12).toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>

              {/* Fixed Bottom Total Row */}
              <tfoot>
                <tr className="sticky-foot-row fw-bold text-dark">
                  <td className="sticky-foot-1 text-center">รวม</td>
                  <td className="sticky-foot-2 text-start">
                    โรงพยาบาลทั้งหมด ({totalHospCount} แห่ง)
                  </td>
                  <td className="text-center">-</td>

                  {/* รวม FTE ทุก รพ. ในแต่ละเดือน */}
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <td key={m} className="text-end text-success fw-bold">
                      {(monthTotalFTE[m] || 0).toFixed(2)}
                    </td>
                  ))}
                  
                  {/* เฉลี่ยรวมทั้งจังหวัด/ระบบ */}
                  <td className="text-end text-primary bg-light fw-bold">
                    {grandTotalYearFTE.toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>

      {/* Sticky Bottom Summary Cards (ตรึงกล่องสรุปข้อมูลล่างสุด ไม่เลื่อนตาม Scroll) */}
      <div className="sticky-bottom-summary">
        <div className="row g-2">
          <div className="col-md-3">
            <div className="card p-2 border-0 shadow-sm border-start border-4 border-primary bg-white">
              <div className="text-muted small fw-bold">จำนวนโรงพยาบาลทั้งหมด</div>
              <div className="fs-5 fw-bold text-primary">{totalHospCount} แห่ง</div>
            </div>
          </div>
          <div className="col-md-3">
            <div className="card p-2 border-0 shadow-sm border-start border-4 border-success bg-white">
              <div className="text-muted small fw-bold">รวม FTE ทุก รพ. ตลอดทั้งปี</div>
              <div className="fs-5 fw-bold text-success">{grandTotalYearFTE.toFixed(2)} คน-เดือน</div>
            </div>
          </div>
          <div className="col-md-3">
            <div className="card p-2 border-0 shadow-sm border-start border-4 border-warning bg-white">
              <div className="text-muted small fw-bold">เฉลี่ย FTE / โรงพยาบาล / เดือน</div>
              <div className="fs-5 fw-bold text-warning">{avgYearlyFTEPerHosp.toFixed(2)} คน</div>
            </div>
          </div>
          <div className="col-md-3">
            <div className="card p-2 border-0 shadow-sm border-start border-4 bg-white" style={{ borderColor: '#8b5cf6' }}>
              <div className="text-muted small fw-bold">ปีงบประมาณ / พ.ศ.</div>
              <div className="fs-5 fw-bold" style={{ color: '#8b5cf6' }}>{buddhistYear}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}