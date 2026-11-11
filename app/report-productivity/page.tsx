import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { LEVEL_COLUMN_MAP } from '@/lib/fte-utils';

export const revalidate = 0;

interface PageProps {
  searchParams: Promise<{
    year?: string;
  }>;
}

const THAI_MONTHS_SHORT = [
  '', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
];

export default async function ReportProductivityPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const today = new Date();
  const currentYearAD = today.getFullYear();
  const currentMonth = today.getMonth() + 1; // เดือนปัจจุบัน (1-12)

  const inputYear = params.year ? parseInt(params.year) : currentYearAD + 543;

  const adYear = inputYear > 2400 ? inputYear - 543 : inputYear;
  const buddhistYear = inputYear > 2400 ? inputYear : inputYear + 543;

  // 1. ดึงรายชื่อโรงพยาบาลทั้งหมดที่เปิดใช้งาน
  const { data: hospitalsData } = await supabase
    .from('hospitals')
    .select('hcode, hname, hospital_level')
    .eq('is_active', 1)
    .order('hcode', { ascending: true });

  const hospitals = hospitalsData || [];

  // 2. ดึงเกณฑ์เวลามาตรฐานของทุกกิจกรรม
  const { data: activitiesData } = await supabase
    .from('medical_tech_workload')
    .select('*')
    .order('id', { ascending: true });

  const activities = activitiesData || [];

  // 3. ดึงวันหยุดประจำปี
  const startDateStr = `${adYear}-01-01`;
  const endDateStr = `${adYear}-12-31`;

  const { data: holidaysData } = await supabase
    .from('holidays')
    .select('holiday_date')
    .gte('holiday_date', startDateStr)
    .lte('holiday_date', endDateStr);

  const holidaysList = holidaysData || [];

  // คำนวณชั่วโมงทำงานมาตรฐานประจำเดือน (1-12)
  const monthlyStdHours: Record<number, number> = {};
  for (let m = 1; m <= 12; m++) {
    const daysInMonth = new Date(adYear, m, 0).getDate();
    const holidayMap = new Set<string>();

    holidaysList.forEach((h: { holiday_date: string }) => {
      if (h.holiday_date) {
        const hDate = new Date(h.holiday_date);
        if (hDate.getFullYear() === adYear && hDate.getMonth() + 1 === m) {
          holidayMap.add(h.holiday_date);
        }
      }
    });

    for (let d = 1; d <= daysInMonth; d++) {
      const dayOfWeek = new Date(adYear, m - 1, d).getDay(); // 0 = อาทิตย์, 6 = เสาร์
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        const dStr = `${adYear}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        holidayMap.add(dStr);
      }
    }

    const wDays = Math.max(1, daysInMonth - holidayMap.size);
    monthlyStdHours[m] = wDays * 7;
  }

  // 4. ดึงข้อมูลภาระงานรายวันของทั้งปี โดยใช้ Pagination (.range Loop) เพื่อปลดล็อกลิมิต 1,000 แถวของ Supabase
  let rawWorkload: any[] = [];
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
      rawWorkload = rawWorkload.concat(chunk);
      if (chunk.length < pageSize) {
        hasMore = false;
      } else {
        page++;
      }
    }
  }

  // สรุปข้อมูลรายเดือนรายโรงพยาบาล และนับจำนวนวันที่บันทึกจริง
  interface MonthlyAgg {
    staffMtList: number[];
    activities: Record<number, number>;
  }

  const workloadMatrix: Record<string, Record<number, MonthlyAgg>> = {};
  const recordedDaysMatrix: Record<string, Record<number, Set<string>>> = {};

  (rawWorkload || []).forEach((row: any) => {
    const hc = String(row.hospital_code).trim();
    
    // แกะเดือนตรงๆ จากสตริงวันที่เพื่อป้องกันปัญหา Timezone บน Server ชิฟต์เดือน
    let workMonth = 0;
    if (row.start_date) {
      const dateParts = String(row.start_date).split(/[-T]/);
      if (dateParts.length >= 2) {
        workMonth = parseInt(dateParts[1], 10);
      }
    }

    if (workMonth < 1 || workMonth > 12) return;

    if (!workloadMatrix[hc]) workloadMatrix[hc] = {};
    if (!workloadMatrix[hc][workMonth]) {
      workloadMatrix[hc][workMonth] = {
        staffMtList: [],
        activities: {
          1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0,
          7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0,
        },
      };
    }

    if (!recordedDaysMatrix[hc]) recordedDaysMatrix[hc] = {};
    if (!recordedDaysMatrix[hc][workMonth]) recordedDaysMatrix[hc][workMonth] = new Set();
    if (row.start_date) recordedDaysMatrix[hc][workMonth].add(row.start_date);

    const mObj = workloadMatrix[hc][workMonth];
    if (row.staff_mt !== null && row.staff_mt !== undefined) {
      mObj.staffMtList.push(Number(row.staff_mt));
    }

    mObj.activities[1] += Number(row.sample_collection || 0);
    mObj.activities[2] += Number(row.hematology || 0);
    mObj.activities[3] += Number(row.clinical_microscopy || 0);
    mObj.activities[4] += Number(row.clinical_chemistry || 0);
    mObj.activities[5] += Number(row.clinical_immunology || 0);
    mObj.activities[6] += Number(row.clinical_microbiology || 0);
    mObj.activities[7] += Number(row.molecular_biology || 0);
    mObj.activities[8] += Number(row.blood_bank_no_nat || 0);
    mObj.activities[9] += Number(row.blood_bank_has_nat || 0);
    mObj.activities[10] += Number(row.blood_bank_prep || 0);
    mObj.activities[11] += Number(row.blood_bank_donation || 0);
    mObj.activities[12] += Number(row.blood_bank_nat_cert || 0);
  });

  // 5. คำนวณ Productivity (%) และตรวจสอบเดือนที่สมบูรณ์เต็มเดือน
  const productivityMatrix: Record<string, Record<number, number>> = {};
  const actualStaffMatrix: Record<string, Record<number, number>> = {};
  const hasDataMatrix: Record<string, Record<number, boolean>> = {};
  const isCompleteMonthMatrix: Record<string, Record<number, boolean>> = {};

  hospitals.forEach((h) => {
    const hc = String(h.hcode).trim();
    const level = h.hospital_level;
    const levelKey = level ? level.toLowerCase().trim() : 'f2';
    const stdCol = LEVEL_COLUMN_MAP[level] || LEVEL_COLUMN_MAP[levelKey] || `hospital_${levelKey}`;

    if (!productivityMatrix[hc]) productivityMatrix[hc] = {};
    if (!actualStaffMatrix[hc]) actualStaffMatrix[hc] = {};
    if (!hasDataMatrix[hc]) hasDataMatrix[hc] = {};
    if (!isCompleteMonthMatrix[hc]) isCompleteMonthMatrix[hc] = {};

    for (let m = 1; m <= 12; m++) {
      const vData = workloadMatrix[hc]?.[m];
      if (!vData) {
        productivityMatrix[hc][m] = 0;
        actualStaffMatrix[hc][m] = 0;
        hasDataMatrix[hc][m] = false;
        isCompleteMonthMatrix[hc][m] = false;
        continue;
      }

      hasDataMatrix[hc][m] = true;

      const avgStaff = vData.staffMtList.length > 0
        ? vData.staffMtList.reduce((a, b) => a + b, 0) / vData.staffMtList.length
        : 0;

      const actualStaffM = avgStaff > 0 ? avgStaff : 1;
      actualStaffMatrix[hc][m] = avgStaff;

      const hasSubItems =
        (vData.activities[10] || 0) > 0 ||
        (vData.activities[11] || 0) > 0 ||
        (vData.activities[12] || 0) > 0;

      let totalMinutes = 0;
      activities.forEach((act: any) => {
        const actId = Number(act.id);
        const stdTime = parseFloat(act[stdCol] || 0);
        const vol = vData.activities[actId] || 0;

        if ((actId === 8 || actId === 9) && hasSubItems) return;
        totalMinutes += stdTime * vol;
      });

      const hours = totalMinutes / 60.0;
      const mStdHrs = monthlyStdHours[m] || 1;
      const fteMain = hours / mStdHrs;
      const fteWithAllowance = fteMain * 1.05;
      const prod = (fteWithAllowance / actualStaffM) * 100.0;

      productivityMatrix[hc][m] = prod;

      // ตรวจสอบความสมบูรณ์ของเดือน (ต้องเป็นเดือนที่ผ่านไปแล้ว + มีวันที่ลงข้อมูลครบตามจำนวนวันในเดือนนั้น)
      const totalDaysInMonth = new Date(adYear, m, 0).getDate();
      const recordedDaysCount = recordedDaysMatrix[hc]?.[m]?.size || 0;

      const isPastMonth = adYear < currentYearAD || (adYear === currentYearAD && m < currentMonth);
      const isFullMonthData = recordedDaysCount >= totalDaysInMonth;

      isCompleteMonthMatrix[hc][m] = isPastMonth && isFullMonthData;
    }
  });

  // ตัวแปรสำหรับคำนวณสรุปรวมท้ายตาราง
  const monthProdSums: Record<number, number> = {};
  const monthHospCounts: Record<number, number> = {};
  for (let m = 1; m <= 12; m++) {
    monthProdSums[m] = 0;
    monthHospCounts[m] = 0;
  }
  const allHospAvgProds: number[] = [];

  const currY = currentYearAD + 543;
  // เพิ่มตัวเลือกปีย้อนหลังให้ครอบคลุม 2567 (currY - 2) จนถึง 2570 (currY + 1)
  const yearsList = [currY - 2, currY - 1, currY, currY + 1];

  return (
    <div className="container-fluid px-3 py-3" style={{ fontSize: '0.8rem' }}>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" />
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />

      {/* Header Navigation Bar */}
      <div className="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
        <h4 className="m-0 fw-bold text-dark fs-5">
          <i className="fa-solid fa-chart-line text-warning me-2"></i>
          รายงานสรุปผลิตภาพ (Productivity %) รายเดือน (คิดจาก staff_mt รายวัน)
        </h4>
        <div className="d-flex gap-2">
          <Link href={`/?year=${buddhistYear}`} className="btn btn-outline-secondary btn-sm fw-bold">
            <i className="fa-solid fa-arrow-left me-1"></i> หน้าหลัก (คำนวณ FTE)
          </Link>
          <Link href={`/report-fte-monthly?year=${buddhistYear}`} className="btn btn-primary btn-sm fw-bold">
            <i className="fa-solid fa-users-gear me-1"></i> รายงานกรอบอัตรากำลัง (FTE)
          </Link>
        </div>
      </div>

      {/* ตัวกรอง ปี พ.ศ. */}
      <div className="card mb-3 p-2 shadow-sm border-0">
        <form method="GET" className="row g-2 align-items-end">
          <div className="col-auto">
            <label className="form-label fw-bold small mb-1">เลือกปี พ.ศ.</label>
            <select name="year" defaultValue={buddhistYear} className="form-select form-select-sm" style={{ width: '140px' }}>
              {yearsList.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div className="col-auto">
            <button type="submit" className="btn btn-sm btn-warning text-dark fw-bold px-3">
              แสดงรายงาน
            </button>
          </div>
        </form>
      </div>

      {/* ตารางแสดง Productivity พร้อม Sticky Columns และสัดส่วน FHD */}
      <div className="card border-0 shadow-sm">
        <div className="card-header bg-white py-2 d-flex justify-content-between align-items-center flex-wrap gap-2">
          <h6 className="m-0 text-dark fw-bold">
            ตารางแสดงผลิตภาพ Productivity (%) ประจำปี พ.ศ. {buddhistYear}
          </h6>
          <div className="d-flex gap-2 align-items-center flex-wrap" style={{ fontSize: '13px' }}>
            <span className="badge bg-danger px-2 py-1.5" style={{ fontSize: '12.5px' }}>&gt; 100% (งานเกินกำลัง)</span>
            <span className="badge bg-success px-2 py-1.5" style={{ fontSize: '12.5px' }}>85% - 100% (พอดี)</span>
            <span className="badge bg-info text-dark px-2 py-1.5" style={{ fontSize: '12.5px' }}>&lt; 85% (กำลังคนเหลือ)</span>
            <span className="badge bg-light text-dark border px-2 py-1.5" style={{ fontSize: '12.5px' }}>
              สูตร: Productivity (%) = [(FTEภาระงาน + Allowance 5%) / AVG(staff_mt)] × 100
            </span>
          </div>
        </div>

        <div className="card-body p-0">
          <div
            style={{
              maxHeight: 'calc(100vh - 230px)',
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
                minWidth: '1150px',
                fontSize: '0.8rem',
              }}
            >
              <thead>
                <tr className="text-center">
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

                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <th
                      key={m}
                      style={{
                        position: 'sticky',
                        top: 0,
                        zIndex: 10,
                        backgroundColor: '#0f172a',
                        color: '#ffffff',
                        minWidth: '65px',
                        borderBottom: '1px solid #334155',
                        borderRight: '1px solid #334155',
                        padding: '6px 2px',
                      }}
                    >
                      {THAI_MONTHS_SHORT[m]}
                    </th>
                  ))}

                  <th
                    style={{
                      position: 'sticky',
                      top: 0,
                      zIndex: 10,
                      backgroundColor: '#b45309',
                      color: '#ffffff',
                      minWidth: '100px',
                      borderBottom: '1px solid #334155',
                      padding: '6px 4px',
                    }}
                  >
                    Productivity เฉลี่ย
                  </th>
                </tr>
              </thead>
              <tbody>
                {hospitals.map((h, idx) => {
                  const hc = String(h.hcode).trim();
                  const completeProds: number[] = [];

                  return (
                    <tr key={hc} style={{ borderBottom: '1px solid #e2e8f0' }}>
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
                          whiteSpace: 'nowrap',
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

                      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                        const prod = productivityMatrix[hc]?.[m] || 0;
                        const staffM = actualStaffMatrix[hc]?.[m] || 0;
                        const hasData = hasDataMatrix[hc]?.[m] || false;
                        const isComplete = isCompleteMonthMatrix[hc]?.[m] || false;

                        if (hasData) {
                          if (isComplete) {
                            completeProds.push(prod);
                          }
                          monthProdSums[m] += prod;
                          monthHospCounts[m]++;
                        }

                        let textClass = 'text-muted';
                        if (hasData) {
                          if (prod > 100) textClass = 'fw-bold text-danger';
                          else if (prod >= 85) textClass = 'fw-bold text-success';
                          else textClass = 'fw-bold text-info';
                        }

                        return (
                          <td
                            key={m}
                            className={`text-center ${textClass}`}
                            style={{
                              borderRight: '1px solid #e2e8f0',
                              borderBottom: '1px solid #e2e8f0',
                              padding: '4px 2px',
                              lineHeight: '1.2',
                              backgroundColor: (hasData && !isComplete) ? '#fffbeb' : 'transparent',
                            }}
                            title={hasData && !isComplete ? 'เดือนนี้ยังไม่เต็มเดือน ไม่นำไปคิดค่าเฉลี่ย' : ''}
                          >
                            {hasData ? (
                              <>
                                <div>
                                  {prod.toFixed(1)}%
                                  {!isComplete && <span className="text-warning ms-1" style={{ fontSize: '0.75rem' }}>*</span>}
                                </div>
                                <div className="text-muted" style={{ fontSize: '9px', fontWeight: 'normal' }}>
                                  ({staffM.toFixed(1)} คน)
                                </div>
                              </>
                            ) : (
                              '-'
                            )}
                          </td>
                        );
                      })}

                      {/* Productivity เฉลี่ย คิดเฉพาะเดือนที่เต็มเดือนจริงเท่านั้น */}
                      {(() => {
                        const hAvgProd = completeProds.length > 0
                          ? completeProds.reduce((a, b) => a + b, 0) / completeProds.length
                          : 0;

                        if (completeProds.length > 0) {
                          allHospAvgProds.push(hAvgProd);
                        }

                        let avgBadge = 'text-muted';
                        if (hAvgProd > 100) avgBadge = 'bg-danger text-white';
                        else if (hAvgProd >= 85) avgBadge = 'bg-success text-white';
                        else if (hAvgProd > 0) avgBadge = 'bg-info text-dark';

                        return (
                          <td
                            style={{
                              textAlign: 'center',
                              fontWeight: 'bold',
                              borderBottom: '1px solid #e2e8f0',
                              padding: '4px 2px',
                              backgroundColor: '#f8fafc',
                            }}
                          >
                            {completeProds.length > 0 ? (
                              <span className={`badge ${avgBadge} px-2 py-1`} style={{ fontSize: '11px' }}>
                                {hAvgProd.toFixed(1)}%
                              </span>
                            ) : (
                              '-'
                            )}
                          </td>
                        );
                      })()}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ backgroundColor: '#e2e8f0', fontWeight: 'bold' }}>
                  <td
                    colSpan={4}
                    style={{
                      position: 'sticky',
                      left: 0,
                      bottom: 0,
                      zIndex: 35,
                      backgroundColor: '#e2e8f0',
                      borderTop: '2px solid #cbd5e1',
                      borderRight: '1px solid #cbd5e1',
                      textAlign: 'right',
                      padding: '8px 10px',
                      color: '#0f172a',
                    }}
                  >
                    Productivity เฉลี่ยรวมทุก รพ.:
                  </td>

                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                    const mAvgProd = monthHospCounts[m] > 0
                      ? monthProdSums[m] / monthHospCounts[m]
                      : 0;

                    return (
                      <td
                        key={m}
                        style={{
                          position: 'sticky',
                          bottom: 0,
                          zIndex: 20,
                          backgroundColor: '#e2e8f0',
                          borderTop: '2px solid #cbd5e1',
                          borderRight: '1px solid #cbd5e1',
                          textAlign: 'center',
                          color: '#0f172a',
                          padding: '8px 2px',
                        }}
                      >
                        {monthHospCounts[m] > 0 ? `${mAvgProd.toFixed(1)}%` : '-'}
                      </td>
                    );
                  })}

                  {(() => {
                    const overallProdAvg = allHospAvgProds.length > 0
                      ? allHospAvgProds.reduce((a, b) => a + b, 0) / allHospAvgProds.length
                      : 0;

                    return (
                      <td
                        style={{
                          position: 'sticky',
                          bottom: 0,
                          zIndex: 20,
                          backgroundColor: '#fef08a',
                          borderTop: '2px solid #cbd5e1',
                          textAlign: 'center',
                          color: '#dc2626',
                          fontSize: '0.9rem',
                          padding: '8px 2px',
                        }}
                      >
                        {overallProdAvg.toFixed(1)}%
                      </td>
                    );
                  })()}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        <div className="card-footer bg-white text-muted py-1.5 px-3" style={{ fontSize: '12px' }}>
          <i className="fa-solid fa-circle-info text-warning me-1"></i>
          <span>* หมายเหตุ: ตัวเลขที่มีเครื่องหมาย <strong>* (สีส้ม)</strong> เป็นข้อมูลของเดือนที่ยังไม่สิ้นสุดเต็มเดือน หรือมีจำนวนวันที่ลงข้อมูลไม่ครบตามจำนวนวันในเดือนนั้น ซึ่งจะไม่นำมาคำนวณในช่อง <strong>Productivity เฉลี่ย</strong></span>
        </div>
      </div>
    </div>
  );
}