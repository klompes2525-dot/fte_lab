import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { LEVEL_COLUMN_MAP, THAI_MONTHS, calculateWorkingDays } from '@/lib/fte-utils';

export const revalidate = 0;

interface PageProps {
  searchParams: Promise<{
    year?: string;
    month?: string;
    hcode?: string;
    hospital_code?: string;
  }>;
}

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const currentYearAD = new Date().getFullYear();

  // 1. จัดการปี ค.ศ. / พ.ศ.
  let selectedYear = params.year ? parseInt(params.year) : currentYearAD;
  if (selectedYear > 2400) selectedYear -= 543; // แปลง พ.ศ. -> ค.ศ.

  const selectedMonth = params.month ? parseInt(params.month) : new Date().getMonth() + 1;

  // รองรับทั้ง hcode และ hospital_code
  let selectedHcode = params.hcode || params.hospital_code || '';

  // 2. ดึงรายชื่อโรงพยาบาล
  const { data: hospitals } = await supabase
    .from('hospitals')
    .select('hcode, hname, hospital_level')
    .eq('is_active', 1)
    .order('hcode', { ascending: true });

  if (!selectedHcode && hospitals && hospitals.length > 0) {
    selectedHcode = String(hospitals[0].hcode);
  }

  // แปลง String ก่อนเปรียบเทียบเสมอ ป้องกันปัญหา Type mismatch
  const currentHosp = hospitals?.find((h) => String(h.hcode) === String(selectedHcode)) || hospitals?.[0];
  const hLevel = currentHosp?.hospital_level || 'F2';

  // ค้นหาคอลัมน์เวลามาตรฐานจาก hospital_level
  const levelKey = hLevel.toLowerCase().trim();
  const stdTimeCol = LEVEL_COLUMN_MAP[hLevel] || LEVEL_COLUMN_MAP[levelKey] || `hospital_${levelKey}`;

  // 3. ดึงข้อมูลกิจกรรมเกณฑ์เวลามาตรฐาน
  const { data: activities } = await supabase
    .from('medical_tech_workload')
    .select('*')
    .order('id', { ascending: true });

  // 4. ดึงและรวมปริมาณงาน daily ของโรงพยาบาลที่เลือก
  const startDateStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`;
  const endDateStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${new Date(
    selectedYear,
    selectedMonth,
    0
  ).getDate()}`;

  const { data: dailyWorkload } = await supabase
    .from('workload_daily')
    .select('*')
    .eq('hospital_code', selectedHcode)
    .gte('start_date', startDateStr)
    .lte('start_date', endDateStr);

  const sums: Record<string, number> = {};
  dailyWorkload?.forEach((row) => {
    Object.keys(row).forEach((key) => {
      if (typeof row[key] === 'number') {
        sums[key] = (sums[key] || 0) + row[key];
      }
    });
  });

  // ตรวจสอบการคีย์ข้อมูลรายการย่อยธนาคารเลือด 8.1 - 8.3
  const hasSubItemsVolume =
    (sums['blood_bank_prep'] || 0) > 0 ||
    (sums['blood_bank_donation'] || 0) > 0 ||
    (sums['blood_bank_nat_cert'] || 0) > 0;

  let grandTotalMinutes = 0;
  const workloadData = (activities || []).map((act) => {
    const actId = act.id;
    let volKey = '';
    switch (actId) {
      case 1:
        volKey = 'sample_collection';
        break;
      case 2:
        volKey = 'hematology';
        break;
      case 3:
        volKey = 'clinical_microscopy';
        break;
      case 4:
        volKey = 'clinical_chemistry';
        break;
      case 5:
        volKey = 'clinical_immunology';
        break;
      case 6:
        volKey = 'clinical_microbiology';
        break;
      case 7:
        volKey = 'molecular_biology';
        break;
      case 8:
        volKey = 'blood_bank_no_nat';
        break;
      case 9:
        volKey = 'blood_bank_has_nat';
        break;
      case 10:
        volKey = 'blood_bank_prep';
        break;
      case 11:
        volKey = 'blood_bank_donation';
        break;
      case 12:
        volKey = 'blood_bank_nat_cert';
        break;
    }

    const volume = sums[volKey] || 0;
    const stdTime = Number(act[stdTimeCol]) || 0;
    const totalMinutes = stdTime * volume;

    // หากมีการคีย์ 8.1-8.3 ให้ยกเว้นการคิดเวลาของรายการรวม (id 8 และ 9)
    const isSubCheck = (actId === 8 || actId === 9) && hasSubItemsVolume;
    const isCounted = !isSubCheck;

    if (isCounted) grandTotalMinutes += totalMinutes;

    return {
      ...act,
      std_time: stdTime,
      volume,
      total_minutes: totalMinutes,
      is_counted: isCounted,
      note: isSubCheck ? 'คิดเวลาจากรายการย่อย (8.1-8.3)' : '',
    };
  });

  // 5. ดึงวันหยุดนักขัตฤกษ์เพื่อคำนวณวันทำการ
  const { data: holidaysData } = await supabase
    .from('holidays')
    .select('holiday_date')
    .gte('holiday_date', startDateStr)
    .lte('holiday_date', endDateStr);

  const holidayList = (holidaysData || []).map((h) => h.holiday_date);
  const { workingDays, holidayCount } = calculateWorkingDays(selectedYear, selectedMonth, holidayList);

  const fteStandardHours = workingDays * 7;
  const grandTotalHours = grandTotalMinutes / 60;

  // คำนวณ FTE หลัก และ FTE + Allowance 5%
  const fteMain = fteStandardHours > 0 ? grandTotalHours / fteStandardHours : 0;
  const fteWithAllowance = fteMain * 1.05;

  const buddhistYear = selectedYear + 543;

  return (
    <div className="container-fluid px-3 py-2" style={{ fontSize: '0.8rem' }}>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" />
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />

      {/* Navigation Header */}
      <div className="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
        <h4 className="m-0 fw-bold text-dark fs-5">
          <i className="fa-solid fa-vial text-primary me-2"></i>
          ระบบรายงานภาระงานนักเทคนิคการแพทย์
        </h4>
        <div className="d-flex align-items-center gap-1 flex-wrap">
          <Link href="/import-workload" className="btn btn-primary btn-sm fw-bold py-1 px-2">
            <i className="fa-solid fa-file-excel me-1"></i> นำเข้าข้อมูล (Excel)
          </Link>
          <Link
            href={`/report-productivity?year=${buddhistYear}`}
            className="btn btn-outline-warning btn-sm text-dark fw-bold py-1 px-2"
          >
            Productivity (%)
          </Link>
          {/* เหลือไว้เฉพาะปุ่มรายงาน FTE รายปี (ทุก รพ.) */}
          <Link href={`/report-fte-yearly?year=${buddhistYear}`} className="btn btn-success btn-sm fw-bold py-1 px-2">
            <i className="fa-solid fa-calendar-days me-1"></i> สรุป FTE รายปี (ทุก รพ.)
          </Link>
          <Link
            href={`/report-summary?year=${buddhistYear}&month=${selectedMonth}`}
            className="btn btn-outline-primary btn-sm fw-bold py-1 px-2"
          >
            สรุปปริมาณงานรายเดือน/ปี
          </Link>
          <Link
            href={`/workload-edit?hospital_code=${selectedHcode}&month=${selectedMonth}&year=${selectedYear}`}
            className="btn btn-outline-dark btn-sm fw-bold py-1 px-2"
          >
            ผู้ปฏิบัติงานประจำวัน
          </Link>
          <span className="badge bg-dark fs-6 py-1 px-2 rounded-2 ms-1">ระดับ รพ.: {hLevel}</span>
        </div>
      </div>

      {/* Filter Form (Compact) */}
      <div className="card mb-2 p-2 shadow-sm border-0">
        <form method="GET" className="row g-2 align-items-end">
          <div className="col-md-5">
            <label className="form-label fw-bold small mb-1">เลือกสถานบริการ (HCODE)</label>
            <select name="hcode" defaultValue={String(selectedHcode)} className="form-select form-select-sm">
              {hospitals?.map((h) => (
                <option key={h.hcode} value={String(h.hcode)}>
                  [{h.hcode}] {h.hname} (ระดับ {h.hospital_level})
                </option>
              ))}
            </select>
          </div>
          <div className="col-md-3">
            <label className="form-label fw-bold small mb-1">ปี พ.ศ.</label>
            <select name="year" defaultValue={buddhistYear} className="form-select form-select-sm">
              {[currentYearAD - 2, currentYearAD - 1, currentYearAD, currentYearAD + 1].map((y) => (
                <option key={y} value={y + 543}>
                  {y + 543}
                </option>
              ))}
            </select>
          </div>
          <div className="col-md-3">
            <label className="form-label fw-bold small mb-1">เดือน</label>
            <select name="month" defaultValue={selectedMonth} className="form-select form-select-sm">
              {Object.entries(THAI_MONTHS).map(([mNum, mName]) => (
                <option key={mNum} value={mNum}>
                  {mName}
                </option>
              ))}
            </select>
          </div>
          <div className="col-md-1">
            <button type="submit" className="btn btn-success btn-sm fw-bold w-100 py-1">
              กรอง
            </button>
          </div>
        </form>
      </div>

      {/* Workload Table (Compact FHD Scale) */}
      <div className="card mb-2 border-0 shadow-sm">
        <div className="card-header bg-white py-1 px-3 border-0 d-flex justify-content-between align-items-center flex-wrap">
          <h6 className="m-0 text-primary fw-bold" style={{ fontSize: '0.85rem' }}>
            ตารางคำนวณภาระงานประจำเดือน {THAI_MONTHS[selectedMonth]} {buddhistYear} - {currentHosp?.hname}
          </h6>
          <span className="text-muted" style={{ fontSize: '11px' }}>
            (ดึงเวลามาตรฐานจากคอลัมน์ <code>{stdTimeCol}</code>)
          </span>
        </div>
        <div className="card-body p-0">
          <div
            style={{
              maxHeight: 'calc(100vh - 360px)',
              overflowY: 'auto',
              borderTop: '1px solid #e2e8f0',
              borderBottom: '1px solid #e2e8f0',
            }}
          >
            <table className="table table-hover align-middle mb-0" style={{ fontSize: '0.8rem' }}>
              <thead className="table-dark text-center" style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                <tr>
                  <th style={{ width: '50px', padding: '6px 4px' }}>ลำดับ</th>
                  <th className="text-start" style={{ padding: '6px 8px' }}>
                    กิจกรรมนักเทคนิคการแพทย์
                  </th>
                  <th style={{ width: '80px', padding: '6px 4px' }}>หน่วยนับ</th>
                  <th style={{ width: '130px', padding: '6px 4px' }}>เวลามาตรฐาน (นาที)</th>
                  <th style={{ width: '130px', padding: '6px 4px' }}>ปริมาณงานสะสม</th>
                  <th style={{ width: '150px', padding: '6px 4px' }}>รวมเวลาภาระงาน (นาที)</th>
                </tr>
              </thead>
              <tbody>
                {workloadData.map((row) => {
                  const isHeaderSummary = row.item_no === '8' || row.item_no === null;
                  const isSubItem = ['8.1', '8.2', '8.3'].includes(row.item_no);

                  return (
                    <tr key={row.id} className={isHeaderSummary ? 'table-secondary fw-bold' : ''}>
                      <td className="text-center" style={{ padding: '4px 4px' }}>
                        {row.item_no || '-'}
                      </td>
                      <td className={`text-start ${isSubItem ? 'ps-4' : ''}`} style={{ padding: '4px 8px' }}>
                        {row.activity_name}
                      </td>
                      <td className="text-center" style={{ padding: '4px 4px' }}>
                        <span className="badge bg-secondary" style={{ fontSize: '10px' }}>
                          {row.unit}
                        </span>
                      </td>
                      <td className="text-center fw-bold" style={{ padding: '4px 4px' }}>
                        {row.std_time.toFixed(1)}
                      </td>
                      <td className="text-center fw-bold text-dark" style={{ padding: '4px 4px' }}>
                        {row.volume.toLocaleString()}
                      </td>
                      <td
                        className={`text-center fw-bold ${row.is_counted ? 'text-primary' : 'text-muted'}`}
                        style={{ padding: '4px 4px' }}
                      >
                        <span className={!row.is_counted ? 'text-decoration-line-through opacity-50' : ''}>
                          {row.total_minutes.toLocaleString('en-US', {
                            minimumFractionDigits: 1,
                            maximumFractionDigits: 1,
                          })}
                        </span>
                        {row.note && (
                          <div className="text-danger fw-normal" style={{ fontSize: '10px' }}>
                            {row.note}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Summary Cards (Compact) */}
      <div className="row g-2">
        <div className="col-md-3">
          <div className="card p-2 border-0 shadow-sm border-start border-4 border-primary">
            <div className="text-muted small fw-bold">รวมเวลาภาระงานทั้งหมด</div>
            <div className="fs-4 fw-bold text-primary mt-1">
              {grandTotalMinutes.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} นาที
            </div>
          </div>
        </div>
        <div className="col-md-3">
          <div className="card p-2 border-0 shadow-sm border-start border-4 border-success">
            <div className="text-muted small fw-bold">รวมเวลาคิดเป็นชั่วโมง</div>
            <div className="fs-4 fw-bold text-success mt-1">{grandTotalHours.toFixed(2)} ชั่วโมง</div>
          </div>
        </div>
        <div className="col-md-3">
          <div className="card p-2 border-0 shadow-sm border-start border-4 border-warning">
            <div className="text-muted small fw-bold">เวลามาตรฐานประจำเดือน</div>
            <div className="fs-4 fw-bold text-warning mt-1">{fteStandardHours.toFixed(1)} ชม./คน</div>
            <div className="text-muted" style={{ fontSize: '11px' }}>
              {workingDays} วันทำงาน (หักวันหยุด {holidayCount} วัน) * 7 ชม.
            </div>
          </div>
        </div>
        <div className="col-md-3">
          <div className="card p-2 border-0 shadow-sm border-start border-4" style={{ borderColor: '#8b5cf6' }}>
            <div className="text-muted small fw-bold">กรอบอัตรากำลังที่ต้องการ (FTE)</div>
            <div className="fs-4 fw-bold mt-1" style={{ color: '#8b5cf6' }}>
              {fteWithAllowance.toFixed(2)} คน
            </div>
            <div className="text-muted" style={{ fontSize: '11px' }}>
              (FTE หลัก: {fteMain.toFixed(2)} + Allowance 5%)
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}