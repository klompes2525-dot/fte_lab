import Link from 'next/link';
import { supabase } from '@/lib/supabase';

export const revalidate = 0;

interface PageProps {
  searchParams: Promise<{
    year?: string;
    month?: string;
  }>;
}

const THAI_MONTHS: Record<number, string> = {
  1: 'มกราคม', 2: 'กุมภาพันธ์', 3: 'มีนาคม', 4: 'เมษายน',
  5: 'พฤษภาคม', 6: 'มิถุนายน', 7: 'กรกฎาคม', 8: 'สิงหาคม',
  9: 'กันยายน', 10: 'ตุลาคม', 11: 'พฤศจิกายน', 12: 'ธันวาคม',
};

export default async function ReportSummaryPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const currentYearAD = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;

  const rawYear = params.year ? parseInt(params.year) : currentYearAD + 543;
  const selectedMonth = params.month ? parseInt(params.month) : currentMonth;

  const adYear = rawYear > 2400 ? rawYear - 543 : rawYear;
  const buddhistYear = rawYear > 2400 ? rawYear : rawYear + 543;

  // 1. ดึงรายชื่อโรงพยาบาลทั้งหมดที่เปิดใช้งาน
  const { data: hospitalsData } = await supabase
    .from('hospitals')
    .select('hcode, hname, hospital_level')
    .eq('is_active', 1)
    .order('hcode', { ascending: true });

  const hospitals = hospitalsData || [];

  // 2. ดึงข้อมูลกิจกรรมภาระงานหลัก
  const { data: activitiesData } = await supabase
    .from('medical_tech_workload')
    .select('id, item_no, activity_name, unit')
    .order('id', { ascending: true });

  const activities = activitiesData || [];

  // 3. ดึงข้อมูลปริมาณงานสะสมรายเดือน แยกตามโรงพยาบาล
  const startDateStr = `${adYear}-${String(selectedMonth).padStart(2, '0')}-01`;
  const lastDay = new Date(adYear, selectedMonth, 0).getDate();
  const endDateStr = `${adYear}-${String(selectedMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const { data: rawData } = await supabase
    .from('workload_daily')
    .select('*')
    .gte('start_date', startDateStr)
    .lte('start_date', endDateStr)
    .range(0, 49999);

  // จัดโครงสร้างข้อมูล volumeMatrix[hcode][activity_id] = total_volume
  const volumeMatrix: Record<string, Record<number, number>> = {};

  (rawData || []).forEach((row: any) => {
    const hcode = row.hospital_code;
    if (!volumeMatrix[hcode]) {
      volumeMatrix[hcode] = {
        1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0,
        7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0,
      };
    }

    volumeMatrix[hcode][1] += Number(row.sample_collection || 0);
    volumeMatrix[hcode][2] += Number(row.hematology || 0);
    volumeMatrix[hcode][3] += Number(row.clinical_microscopy || 0);
    volumeMatrix[hcode][4] += Number(row.clinical_chemistry || 0);
    volumeMatrix[hcode][5] += Number(row.clinical_immunology || 0);
    volumeMatrix[hcode][6] += Number(row.clinical_microbiology || 0);
    volumeMatrix[hcode][7] += Number(row.molecular_biology || 0);
    volumeMatrix[hcode][8] += Number(row.blood_bank_no_nat || 0);
    volumeMatrix[hcode][9] += Number(row.blood_bank_has_nat || 0);
    volumeMatrix[hcode][10] += Number(row.blood_bank_prep || 0);
    volumeMatrix[hcode][11] += Number(row.blood_bank_donation || 0);
    volumeMatrix[hcode][12] += Number(row.blood_bank_nat_cert || 0);
  });

  // ตัวแปรสะสมยอดรวมรายโรงพยาบาล และยอดรวมทั้งหมด
  const hospitalTotals: Record<string, number> = {};
  hospitals.forEach((h) => {
    hospitalTotals[h.hcode] = 0;
  });
  let grandTotalAll = 0;

  const currY = currentYearAD + 543;
  const yearsList = [currY - 1, currY, currY + 1];

  return (
    <div className="container-fluid px-4 py-3">
      {/* Header */}
      <div className="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-2">
        <h2 className="m-0 fw-bold text-dark">
          <i className="fa-solid fa-chart-line text-primary me-2"></i>
          รายงานสรุปเปรียบเทียบปริมาณงานรายกิจกรรม (ทุก รพ.)
        </h2>
        <div className="d-flex gap-2">
          <Link
            href={`/?year=${buddhistYear}&month=${selectedMonth}`}
            className="btn btn-outline-secondary"
          >
            <i className="fa-solid fa-arrow-left me-1"></i> กลับหน้าหลัก (คำนวณ FTE)
          </Link>
        </div>
      </div>

      {/* ตัวกรอง ปี / เดือน */}
      <div className="card mb-4 shadow-sm border-0">
        <div className="card-body">
          <form method="GET" className="row g-3 align-items-end">
            <div className="col-md-4">
              <label className="form-label fw-bold">เลือกปี พ.ศ.</label>
              <select name="year" defaultValue={buddhistYear} className="form-select">
                {yearsList.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <div className="col-md-4">
              <label className="form-label fw-bold">เลือกเดือน</label>
              <select name="month" defaultValue={selectedMonth} className="form-select">
                {Object.entries(THAI_MONTHS).map(([mNum, mName]) => (
                  <option key={mNum} value={mNum}>{mName}</option>
                ))}
              </select>
            </div>
            <div className="col-md-2">
              <button type="submit" className="btn btn-success w-100 fw-bold">
                แสดงรายงาน
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* ตารางสรุปเปรียบเทียบ */}
      <div className="card mb-4 border-0 shadow-sm">
        <div className="card-header bg-white py-3 border-0">
          <h5 className="m-0 text-primary fw-bold">
            ตารางเปรียบเทียบปริมาณงานประจำเดือน {THAI_MONTHS[selectedMonth]} {buddhistYear}
          </h5>
        </div>
        <div className="card-body p-0">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead className="table-dark">
                <tr className="text-center">
                  <th style={{ width: '65px' }}>ลำดับ</th>
                  <th className="text-start" style={{ minWidth: '250px' }}>กิจกรรมนักเทคนิคการแพทย์</th>
                  <th style={{ width: '90px' }}>หน่วยนับ</th>
                  {hospitals.map((h) => (
                    <th key={h.hcode} style={{ minWidth: '120px' }}>
                      {h.hname}
                      <br />
                      <span className="badge bg-light text-dark fw-normal">
                        [{h.hcode}] ({h.hospital_level})
                      </span>
                    </th>
                  ))}
                  <th style={{ minWidth: '110px' }}>รวมทั้งหมด</th>
                </tr>
              </thead>
              <tbody>
                {activities.map((act) => {
                  const actId = Number(act.id);
                  const isSummaryRow = act.item_no === '8' || act.item_no === null;
                  let rowSum = 0;

                  return (
                    <tr key={actId} className={isSummaryRow ? 'table-secondary fw-bold' : ''}>
                      <td className="text-center">{act.item_no || '-'}</td>
                      <td className="text-start">{act.activity_name}</td>
                      <td className="text-center">
                        <span className="badge bg-secondary">{act.unit}</span>
                      </td>

                      {hospitals.map((h) => {
                        const hc = h.hcode;
                        const vol = volumeMatrix[hc]?.[actId] || 0;
                        rowSum += vol;

                        if (act.item_no !== '8') {
                          hospitalTotals[hc] += vol;
                        }

                        return (
                          <td
                            key={hc}
                            className={`text-center fw-bold ${vol > 0 ? 'text-dark' : 'text-muted'}`}
                          >
                            {vol.toLocaleString()}
                          </td>
                        );
                      })}

                      {(() => {
                        if (act.item_no !== '8') {
                          grandTotalAll += rowSum;
                        }

                        return (
                          <td className="text-center fw-bold text-primary bg-light">
                            {rowSum.toLocaleString()}
                          </td>
                        );
                      })()}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="table-secondary">
                <tr className="text-center fw-bold">
                  <td colSpan={3} className="text-end">รวมปริมาณงานทั้งหมด:</td>
                  {hospitals.map((h) => (
                    <td key={h.hcode} className="text-success">
                      {hospitalTotals[h.hcode].toLocaleString()}
                    </td>
                  ))}
                  <td className="text-danger fs-6 bg-warning bg-opacity-25">
                    {grandTotalAll.toLocaleString()}
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