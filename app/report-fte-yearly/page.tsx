import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { LEVEL_COLUMN_MAP, calculateWorkingDays } from '@/lib/fte-utils';

export const revalidate = 0;

interface PageProps {
  searchParams: Promise<{
    year?: string;
  }>;
}

const THAI_MONTH_FULL: Record<number, string> = {
  1: 'มกราคม',
  2: 'กุมภาพันธ์',
  3: 'มีนาคม',
  4: 'เมษายน',
  5: 'พฤษภาคม',
  6: 'มิถุนายน',
  7: 'กรกฎาคม',
  8: 'สิงหาคม',
  9: 'กันยายน',
  10: 'ตุลาคม',
  11: 'พฤศจิกายน',
  12: 'ธันวาคม',
};

// ลำดับเดือนตามปีงบประมาณ (ต.ค. - ก.ย.)
const FISCAL_MONTHS = [10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9];

export default async function YearlyReportPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const today = new Date();
  const currentYearAD = today.getFullYear();
  const currentMonth = today.getMonth() + 1;

  // ปีงบประมาณปัจจุบัน (หากเป็นเดือน ต.ค.-ธ.ค. จะนับเป็นปีงบประมาณของปีถัดไป)
  const defaultFiscalYearAD = currentMonth >= 10 ? currentYearAD + 1 : currentYearAD;
  const defaultFiscalYearBE = defaultFiscalYearAD + 543;

  // 1. จัดการปี พ.ศ. / ค.ศ. ของปีงบประมาณที่เลือก
  const parsedYear = params.year ? parseInt(params.year, 10) : NaN;
  let selectedYear = !isNaN(parsedYear) ? parsedYear : defaultFiscalYearAD;
  if (selectedYear > 2400) selectedYear -= 543;

  const buddhistYear = selectedYear + 543;
  const prevAdYear = selectedYear - 1;

  // คืนค่าปี ค.ศ. จริงของแต่ละเดือนในปีงบประมาณ (ต.ค.-ธ.ค. = ปีก่อนหน้า, ม.ค.-ก.ย. = ปีงบประมาณ)
  const getMonthAdYear = (m: number) => (m >= 10 ? prevAdYear : selectedYear);

  // 2. ดึงรายชื่อโรงพยาบาลทั้งหมด พร้อมคอลัมน์ fte_lab
  const { data: hospitals } = await supabase
    .from('hospitals')
    .select('hcode, hname, hospital_level, fte_lab')
    .eq('is_active', 1)
    .order('hcode', { ascending: true });

  // 3. ดึงรายการกิจกรรมเวลามาตรฐาน
  const { data: activities } = await supabase
    .from('medical_tech_workload')
    .select('*')
    .order('id', { ascending: true });

  // 4. ดึงข้อมูลปริมาณงาน daily ตลอดปีงบประมาณ (1 ต.ค. ปีก่อนหน้า - 30 ก.ย. ปีงบประมาณ)
  const startDateStr = `${prevAdYear}-10-01`;
  const endDateStr = `${selectedYear}-09-30`;

  let yearlyDailyWorkload: any[] = [];
  let page = 0;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data: chunk, error } = await supabase
      .from('workload_daily')
      .select('*')
      .gte('start_date', startDateStr)
      .lte('start_date', endDateStr)
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error || !chunk || chunk.length === 0) {
      hasMore = false;
    } else {
      yearlyDailyWorkload = yearlyDailyWorkload.concat(chunk);
      if (chunk.length < pageSize) {
        hasMore = false;
      } else {
        page++;
      }
    }
  }

  // 5. ดึงข้อมูลวันหยุดนักขัตฤกษ์ตลอดปีงบประมาณ
  const { data: holidaysData } = await supabase
    .from('holidays')
    .select('holiday_date')
    .gte('holiday_date', startDateStr)
    .lte('holiday_date', endDateStr);

  const holidayList = (holidaysData || []).map((h) => h.holiday_date);
  const holidaySet = new Set(holidayList.map((d) => String(d).split('T')[0].trim()));

  // จัดกลุ่มข้อมูล ปริมาณงานตาม [hcode][month][volKey] และคำนวณค่าเฉลี่ยเจ้าหน้าที่ปฏิบัติงานจริง (staff_mt) เฉพาะวันทำการ
  const workloadByHospMonth: Record<string, Record<number, Record<string, number>>> = {};
  const staffStatsByHosp: Record<string, { sum: number; count: number }> = {};

  yearlyDailyWorkload.forEach((row) => {
    const hcode = String(row.hospital_code).trim();

    let month = 0;
    if (row.start_date) {
      const dateOnly = String(row.start_date).split('T')[0].trim();
      const dateParts = dateOnly.split('-');
      if (dateParts.length >= 3) {
        const y = parseInt(dateParts[0], 10);
        month = parseInt(dateParts[1], 10);
        const d = parseInt(dateParts[2], 10);

        // ตรวจสอบว่าเป็นวันทำการ (ไม่ใช่วันเสาร์-อาทิตย์ และไม่ใช่วันหยุดนักขัตฤกษ์)
        const dateObj = new Date(y, month - 1, d);
        const dayOfWeek = dateObj.getDay(); // 0 = อาทิตย์, 6 = เสาร์
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const isPublicHoliday = holidaySet.has(dateOnly);

        if (!isWeekend && !isPublicHoliday) {
          const staffVal = Number(row.staff_mt);
          if (
            row.staff_mt !== null &&
            row.staff_mt !== undefined &&
            row.staff_mt !== '' &&
            !isNaN(staffVal) &&
            staffVal > 0
          ) {
            if (!staffStatsByHosp[hcode]) {
              staffStatsByHosp[hcode] = { sum: 0, count: 0 };
            }
            staffStatsByHosp[hcode].sum += staffVal;
            staffStatsByHosp[hcode].count += 1;
          }
        }
      }
    }

    if (month >= 1 && month <= 12) {
      if (!workloadByHospMonth[hcode]) workloadByHospMonth[hcode] = {};
      if (!workloadByHospMonth[hcode][month]) workloadByHospMonth[hcode][month] = {};

      Object.keys(row).forEach((key) => {
        const val = Number(row[key]);
        if (!isNaN(val) && row[key] !== null && row[key] !== '') {
          workloadByHospMonth[hcode][month][key] = (workloadByHospMonth[hcode][month][key] || 0) + val;
        }
      });
    }
  });

  // คำนวณค่าเฉลี่ยเจ้าหน้าที่ปฏิบัติงานจริงรายโรงพยาบาล (ปัดเป็นจำนวนเต็ม)
  const actualStaffByHosp: Record<string, number | null> = {};
  (hospitals || []).forEach((h) => {
    const hcode = String(h.hcode).trim();
    const stat = staffStatsByHosp[hcode];
    actualStaffByHosp[hcode] = stat && stat.count > 0 ? Math.round(stat.sum / stat.count) : null;
  });

  // คำนวณชั่วโมงมาตรฐานประจำแต่ละเดือนตามปี ค.ศ. จริงของเดือนนั้นๆ
  const monthlyWorkingHours: Record<number, number> = {};
  for (const m of FISCAL_MONTHS) {
    const targetAdYear = getMonthAdYear(m);
    const { workingDays } = calculateWorkingDays(targetAdYear, m, holidayList);
    monthlyWorkingHours[m] = workingDays * 7;
  }

  // คำนวณ FTE แต่ละโรงพยาบาลในแต่ละเดือน
  const fteMatrix: Record<string, Record<number, number>> = {};
  const monthTotalFTE: Record<number, number> = {};
  for (const m of FISCAL_MONTHS) monthTotalFTE[m] = 0;

  (hospitals || []).forEach((h) => {
    const hcode = String(h.hcode).trim();
    fteMatrix[hcode] = {};

    const hLevel = h.hospital_level || 'F2';
    const levelKey = hLevel.toLowerCase().trim();
    const stdTimeCol = LEVEL_COLUMN_MAP[hLevel] || LEVEL_COLUMN_MAP[levelKey] || `hospital_${levelKey}`;

    for (const m of FISCAL_MONTHS) {
      const sums = workloadByHospMonth[hcode]?.[m] || {};
      const hasSubItemsVolume =
        (sums['blood_bank_prep'] || 0) > 0 ||
        (sums['blood_bank_donation'] || 0) > 0 ||
        (sums['blood_bank_nat_cert'] || 0) > 0;

      let grandTotalMinutes = 0;
      (activities || []).forEach((act) => {
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

  // คำนวณผลรวมกรอบ FTE (fte_lab) และผลรวมเจ้าหน้าที่ปฏิบัติงานจริงของทุกโรงพยาบาล
  const totalFteLab = (hospitals || []).reduce((sum, h) => sum + (Number(h.fte_lab) || 0), 0);
  const totalActualStaff = (hospitals || []).reduce((sum, h) => {
    const hcode = String(h.hcode).trim();
    return sum + (actualStaffByHosp[hcode] || 0);
  }, 0);

  const yearsList = [
    defaultFiscalYearBE - 3,
    defaultFiscalYearBE - 2,
    defaultFiscalYearBE - 1,
    defaultFiscalYearBE,
    defaultFiscalYearBE + 1,
  ];

  const prevBeShort = String(buddhistYear - 1).slice(-2);
  const currBeShort = String(buddhistYear).slice(-2);

  return (
    <div className="container-fluid px-3 py-2 d-flex flex-column" style={{ fontSize: '0.8rem', minHeight: '100vh' }}>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" />
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />

      {/* Header & Filter */}
      <div className="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
        <h4 className="m-0 fw-bold text-dark fs-5">
          <i className="fa-solid fa-chart-line text-success me-2"></i>
          สรุปกรอบอัตรากำลัง FTE รายปีงบประมาณ (ทุกโรงพยาบาล)
        </h4>
        <div className="d-flex align-items-center gap-2">
          <form method="GET" className="d-flex align-items-center gap-2">
            <label className="fw-bold small mb-0">เลือกปีงบประมาณ:</label>
            <select
              name="year"
              defaultValue={buddhistYear}
              className="form-select form-select-sm"
              style={{ width: '215px' }}
            >
              {yearsList.map((y) => (
                <option key={y} value={y}>
                  ปีงบ {y} (ต.ค. {String(y - 1).slice(-2)} - ก.ย. {String(y).slice(-2)})
                </option>
              ))}
            </select>
            <button type="submit" className="btn btn-primary btn-sm fw-bold">กรอง</button>
          </form>
          <Link href="/" className="btn btn-outline-secondary btn-sm fw-bold">
            <i className="fa-solid fa-arrow-left me-1"></i> กลับหน้ารายเดือน
          </Link>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="mb-2">
        <div className="row g-2">
          <div className="col-md-3">
            <div className="card p-2 border-0 shadow-sm border-start border-4 border-primary bg-white">
              <div className="text-muted small fw-bold">จำนวนโรงพยาบาลทั้งหมด</div>
              <div className="fs-5 fw-bold text-primary">{totalHospCount} แห่ง</div>
            </div>
          </div>
          <div className="col-md-3">
            <div className="card p-2 border-0 shadow-sm border-start border-4 border-success bg-white">
              <div className="text-muted small fw-bold">รวม FTE ทุก รพ. ตลอดทั้งปีงบประมาณ</div>
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
              <div className="text-muted small fw-bold">ปีงบประมาณ (พ.ศ.)</div>
              <div className="fs-5 fw-bold" style={{ color: '#8b5cf6' }}>
                {buddhistYear}{' '}
                <span className="fs-6 fw-normal text-muted">
                  (ต.ค. {prevBeShort} - ก.ย. {currBeShort})
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Table with Frozen Left Columns, Sticky Header & Sticky Footer */}
      <div className="card border-0 shadow-sm flex-grow-1 mb-2">
        <div className="card-body p-0">
          <div className="table-scroll-container">
            <table className="table table-hover table-bordered align-middle mb-0" style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
              <thead>
                <tr>
                  <th className="sticky-head-1 text-center" style={{ width: '80px' }}>
                    HCODE
                  </th>
                  <th className="sticky-head-2 text-start" style={{ width: '200px' }}>
                    ชื่อโรงพยาบาล
                  </th>
                  <th className="sticky-head-top text-center" style={{ width: '70px' }}>ระดับ</th>
                  <th className="sticky-head-top text-center bg-secondary text-white" style={{ width: '90px' }}>
                    กรอบ FTE
                  </th>
                  <th className="sticky-head-top text-center bg-info text-dark" style={{ width: '115px' }}>
                    จนท.ปฏิบัติงานจริง
                  </th>

                  {FISCAL_MONTHS.map((m) => {
                    const monthBeShort = String(getMonthAdYear(m) + 543).slice(-2);
                    return (
                      <th key={m} className="sticky-head-top text-center" style={{ width: '85px' }}>
                        {THAI_MONTH_FULL[m]} {monthBeShort}
                      </th>
                    );
                  })}
                  <th className="sticky-head-top text-center bg-primary text-white" style={{ width: '95px' }}>
                    เฉลี่ย FTE/ปี
                  </th>
                </tr>
              </thead>
              <tbody>
                {hospitals?.map((h) => {
                  const hcode = String(h.hcode).trim();
                  let hospYearFTE = 0;
                  const fteLabVal = h.fte_lab !== null && h.fte_lab !== undefined ? Number(h.fte_lab) : null;
                  const actualStaffVal = actualStaffByHosp[hcode];

                  return (
                    <tr key={hcode}>
                      <td className="sticky-col-1 text-center fw-bold">
                        {hcode}
                      </td>

                      <td className="sticky-col-2 text-start fw-bold">
                        {h.hname}
                      </td>

                      <td className="text-center">
                        <span className="badge bg-secondary" style={{ fontSize: '10px' }}>{h.hospital_level}</span>
                      </td>

                      {/* กรอบ FTE (fte_lab) */}
                      <td className="text-center fw-bold text-dark">
                        {fteLabVal !== null ? fteLabVal.toFixed(2) : '-'}
                      </td>

                      {/* จำนวนเจ้าหน้าที่ปฏิบัติงานจริง (ค่าเฉลี่ย staff_mt เฉพาะวันทำการ ปัดเป็นจำนวนเต็ม) */}
                      <td className="text-center fw-bold text-dark">
                        {actualStaffVal !== null ? actualStaffVal : '-'}
                      </td>

                      {FISCAL_MONTHS.map((m) => {
                        const val = fteMatrix[hcode]?.[m] || 0;
                        hospYearFTE += val;
                        return (
                          <td key={m} className={`text-end ${val > 0 ? 'fw-bold text-dark' : 'text-muted'}`}>
                            {val > 0 ? val.toFixed(2) : '-'}
                          </td>
                        );
                      })}

                      <td className="text-end fw-bold text-primary bg-light">
                        {(hospYearFTE / 12).toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>

              <tfoot>
                <tr className="sticky-foot-row fw-bold text-dark">
                  <td className="sticky-foot-1 text-center">รวม</td>
                  <td className="sticky-foot-2 text-start">
                    โรงพยาบาลทั้งหมด ({totalHospCount} แห่ง)
                  </td>
                  <td className="text-center">-</td>

                  {/* รวม กรอบ FTE (fte_lab) */}
                  <td className="text-center text-primary fw-bold">
                    {totalFteLab > 0 ? totalFteLab.toFixed(2) : '-'}
                  </td>

                  {/* รวม จนท.ปฏิบัติงานจริง */}
                  <td className="text-center text-primary fw-bold">
                    {totalActualStaff > 0 ? totalActualStaff : '-'}
                  </td>

                  {FISCAL_MONTHS.map((m) => (
                    <td key={m} className="text-end text-success fw-bold">
                      {(monthTotalFTE[m] || 0).toFixed(2)}
                    </td>
                  ))}

                  <td className="text-end text-primary bg-light fw-bold">
                    {grandTotalYearFTE.toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}