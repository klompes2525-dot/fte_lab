import Link from 'next/link';
import { supabase } from '@/lib/supabase';

export const revalidate = 0;

interface PageProps {
  searchParams: Promise<{
    year?: string;
  }>;
}

const LEVEL_COLUMN_MAP: Record<string, string> = {
  A: 'hospital_a',
  a: 'hospital_a_small',
  S: 'hospital_s',
  s: 'hospital_s_small',
  M1: 'hospital_m1',
  M2: 'hospital_m2',
  F1: 'hospital_f1',
  F2: 'hospital_f2',
  F3: 'hospital_f3',
};

const THAI_MONTHS_SHORT = [
  '', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
];

export default async function ReportProductivityPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const currentYearAD = new Date().getFullYear();
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

  // 4. ดึงข้อมูลภาระงานรายวันของทั้งปี
  const { data: rawWorkload } = await supabase
    .from('workload_daily')
    .select('*')
    .gte('start_date', startDateStr)
    .lte('start_date', endDateStr)
    .range(0, 49999);

  // สรุปข้อมูลรายเดือนรายโรงพยาบาล
  interface MonthlyAgg {
    staffMtList: number[];
    activities: Record<number, number>;
  }

  const workloadMatrix: Record<string, Record<number, MonthlyAgg>> = {};

  (rawWorkload || []).forEach((row: any) => {
    const hc = row.hospital_code;
    const workMonth = new Date(row.start_date).getMonth() + 1;

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

  // 5. คำนวณ Productivity (%) และ Staff MT
  const productivityMatrix: Record<string, Record<number, number>> = {};
  const actualStaffMatrix: Record<string, Record<number, number>> = {};
  const hasDataMatrix: Record<string, Record<number, boolean>> = {};

  hospitals.forEach((h) => {
    const hc = h.hcode;
    const level = h.hospital_level;
    const stdCol = LEVEL_COLUMN_MAP[level] || 'hospital_f2';

    if (!productivityMatrix[hc]) productivityMatrix[hc] = {};
    if (!actualStaffMatrix[hc]) actualStaffMatrix[hc] = {};
    if (!hasDataMatrix[hc]) hasDataMatrix[hc] = {};

    for (let m = 1; m <= 12; m++) {
      const vData = workloadMatrix[hc]?.[m];
      if (!vData) {
        productivityMatrix[hc][m] = 0;
        actualStaffMatrix[hc][m] = 0;
        hasDataMatrix[hc][m] = false;
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
  const yearsList = [currY - 1, currY, currY + 1];

  return (
    <div className="container-fluid px-4 py-3">
      {/* Header Navigation Bar */}
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <div>
          <h3 className="m-0 fw-bold text-dark">
            <i className="fa-solid fa-chart-line text-warning me-2"></i>
            รายงานสรุปผลิตภาพ (Productivity %) รายเดือน (คิดจาก staff_mt รายวัน)
          </h3>
        </div>
        <div className="d-flex gap-2">
          <Link href={`/?year=${buddhistYear}`} className="btn btn-outline-secondary">
            <i className="fa-solid fa-arrow-left me-1"></i> หน้าหลัก (คำนวณ FTE)
          </Link>
          <Link href={`/report-fte-monthly?year=${buddhistYear}`} className="btn btn-outline-primary">
            <i className="fa-solid fa-users-gear me-1"></i> รายงานกรอบอัตรากำลัง (FTE)
          </Link>
        </div>
      </div>

      {/* ตัวกรอง ปี พ.ศ. */}
      <div className="card mb-4 shadow-sm border-0">
        <div className="card-body py-3">
          <form method="GET" className="row g-3 align-items-end">
            <div className="col-md-4">
              <label className="form-label fw-bold small">เลือกปี พ.ศ.</label>
              <select name="year" defaultValue={buddhistYear} className="form-select">
                {yearsList.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <div className="col-md-2">
              <button type="submit" className="btn btn-warning text-dark fw-bold w-100">
                แสดงรายงาน
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* ตารางแสดง Productivity */}
      <div className="card mb-4 border-0 shadow-sm">
        <div className="card-header bg-white py-3 d-flex justify-content-between align-items-center flex-wrap gap-2">
          <h5 className="m-0 text-dark fw-bold">
            ตารางแสดงผลิตภาพ Productivity (%) ประจำปี พ.ศ. {buddhistYear}
          </h5>
          <div className="d-flex gap-2 align-items-center flex-wrap">
            <span className="badge bg-danger">&gt; 100% (งานเกินกำลัง)</span>
            <span className="badge bg-success">85% - 100% (พอดี)</span>
            <span className="badge bg-info text-dark">&lt; 85% (กำลังคนเหลือ)</span>
            <span className="badge bg-light text-dark border">
              สูตร: Productivity (%) = [(FTEภาระงาน + Allowance 5%) / AVG(staff_mt)] × 100
            </span>
          </div>
        </div>

        <div className="card-body p-0">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead className="table-dark">
                <tr className="text-center">
                  <th style={{ width: '50px' }}>ลำดับ</th>
                  <th style={{ width: '90px' }}>HCODE</th>
                  <th className="text-start">ชื่อสถานบริการ</th>
                  <th style={{ width: '70px' }}>ระดับ</th>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <th key={m} style={{ minWidth: '80px' }}>{THAI_MONTHS_SHORT[m]}</th>
                  ))}
                  <th style={{ minWidth: '110px' }}>Productivity เฉลี่ย</th>
                </tr>
              </thead>
              <tbody>
                {hospitals.map((h, idx) => {
                  const hc = h.hcode;
                  const hActiveProds: number[] = [];

                  return (
                    <tr key={hc}>
                      <td className="text-center">{idx + 1}</td>
                      <td className="text-center">
                        <span className="badge bg-secondary">{hc}</span>
                      </td>
                      <td className="fw-bold text-dark">{h.hname}</td>
                      <td className="text-center">
                        <span className="badge bg-info text-dark">{h.hospital_level}</span>
                      </td>

                      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                        const prod = productivityMatrix[hc]?.[m] || 0;
                        const staffM = actualStaffMatrix[hc]?.[m] || 0;
                        const hasData = hasDataMatrix[hc]?.[m] || false;

                        if (hasData) {
                          hActiveProds.push(prod);
                          monthProdSums[m] += prod;
                          monthHospCounts[m]++;
                        }

                        let badgeClass = 'text-muted';
                        if (hasData) {
                          if (prod > 100) badgeClass = 'fw-bold text-danger';
                          else if (prod >= 85) badgeClass = 'fw-bold text-success';
                          else badgeClass = 'fw-bold text-info';
                        }

                        return (
                          <td key={m} className={`text-center ${badgeClass}`}>
                            {hasData ? (
                              <>
                                <div>{prod.toFixed(1)}%</div>
                                <small className="text-muted" style={{ fontSize: '10px' }}>
                                  ({staffM.toFixed(1)} คน)
                                </small>
                              </>
                            ) : (
                              '-'
                            )}
                          </td>
                        );
                      })}

                      {(() => {
                        const hAvgProd = hActiveProds.length > 0
                          ? hActiveProds.reduce((a, b) => a + b, 0) / hActiveProds.length
                          : 0;

                        if (hActiveProds.length > 0) {
                          allHospAvgProds.push(hAvgProd);
                        }

                        let avgBadge = 'text-muted';
                        if (hAvgProd > 100) avgBadge = 'bg-danger text-white';
                        else if (hAvgProd >= 85) avgBadge = 'bg-success text-white';
                        else if (hAvgProd > 0) avgBadge = 'bg-info text-dark';

                        return (
                          <td className="text-center fw-bold">
                            {hActiveProds.length > 0 ? (
                              <span className={`badge ${avgBadge} px-2 py-1 fs-6`}>
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
              <tfoot className="table-secondary">
                <tr className="text-center fw-bold">
                  <td colSpan={4} className="text-end">Productivity เฉลี่ยรวมทุก รพ.:</td>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                    const mAvgProd = monthHospCounts[m] > 0
                      ? monthProdSums[m] / monthHospCounts[m]
                      : 0;
                    return (
                      <td key={m}>
                        {monthHospCounts[m] > 0 ? `${mAvgProd.toFixed(1)}%` : '-'}
                      </td>
                    );
                  })}
                  {(() => {
                    const overallProdAvg = allHospAvgProds.length > 0
                      ? allHospAvgProds.reduce((a, b) => a + b, 0) / allHospAvgProds.length
                      : 0;
                    return (
                      <td className="text-danger fs-6 bg-warning bg-opacity-25">
                        {overallProdAvg.toFixed(1)}%
                      </td>
                    );
                  })()}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}