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
    const hcode = String(row.hospital_code);
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
    hospitalTotals[String(h.hcode)] = 0;
  });
  let grandTotalAll = 0;

  const currY = currentYearAD + 543;
  const yearsList = [currY - 1, currY, currY + 1];

  return (
    <div className="container-fluid px-3 py-3" style={{ fontSize: '0.8rem' }}>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" />
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />

      {/* Header */}
      <div className="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
        <h4 className="m-0 fw-bold text-dark fs-5">
          <i className="fa-solid fa-chart-line text-primary me-2"></i>
          รายงานสรุปเปรียบเทียบปริมาณงานรายกิจกรรม (ทุก รพ.)
        </h4>
        <div className="d-flex gap-2">
          <Link
            href={`/?year=${buddhistYear}&month=${selectedMonth}`}
            className="btn btn-outline-secondary btn-sm fw-bold"
          >
            <i className="fa-solid fa-arrow-left me-1"></i> กลับหน้าหลัก (คำนวณ FTE)
          </Link>
        </div>
      </div>

      {/* ตัวกรอง ปี / เดือน */}
      <div className="card mb-3 p-2 shadow-sm border-0">
        <form method="GET" className="row g-2 align-items-end">
          <div className="col-auto">
            <label className="form-label fw-bold small mb-1">เลือกปี พ.ศ.</label>
            <select name="year" defaultValue={buddhistYear} className="form-select form-select-sm" style={{ width: '130px' }}>
              {yearsList.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div className="col-auto">
            <label className="form-label fw-bold small mb-1">เลือกเดือน</label>
            <select name="month" defaultValue={selectedMonth} className="form-select form-select-sm" style={{ width: '150px' }}>
              {Object.entries(THAI_MONTHS).map(([mNum, mName]) => (
                <option key={mNum} value={mNum}>{mName}</option>
              ))}
            </select>
          </div>
          <div className="col-auto">
            <button type="submit" className="btn btn-sm btn-success fw-bold px-3">
              แสดงรายงาน
            </button>
          </div>
        </form>
      </div>

      {/* ตารางสรุปเปรียบเทียบ พร้อม Sticky 3 Columns & Compact FHD Scale */}
      <div className="card border-0 shadow-sm">
        <div className="card-header bg-white py-2 border-0">
          <h6 className="m-0 text-primary fw-bold">
            ตารางเปรียบเทียบปริมาณงานประจำเดือน {THAI_MONTHS[selectedMonth]} {buddhistYear}
          </h6>
        </div>
        <div className="card-body p-0">
          <div
            style={{
              maxHeight: 'calc(100vh - 210px)',
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
                minWidth: '1200px',
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
                      width: '45px',
                      minWidth: '45px',
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
                      left: 45,
                      zIndex: 30,
                      backgroundColor: '#0f172a',
                      color: '#ffffff',
                      width: '230px',
                      minWidth: '230px',
                      textAlign: 'left',
                      borderBottom: '1px solid #334155',
                      borderRight: '1px solid #334155',
                      padding: '6px 6px',
                    }}
                  >
                    กิจกรรมนักเทคนิคการแพทย์
                  </th>
                  <th
                    style={{
                      position: 'sticky',
                      top: 0,
                      left: 275,
                      zIndex: 30,
                      backgroundColor: '#0f172a',
                      color: '#ffffff',
                      width: '65px',
                      minWidth: '65px',
                      borderBottom: '1px solid #334155',
                      borderRight: '1px solid #cbd5e1',
                      padding: '6px 2px',
                    }}
                  >
                    หน่วยนับ
                  </th>
                  {hospitals.map((h) => (
                    <th
                      key={h.hcode}
                      style={{
                        position: 'sticky',
                        top: 0,
                        zIndex: 10,
                        backgroundColor: '#0f172a',
                        color: '#ffffff',
                        minWidth: '100px',
                        borderBottom: '1px solid #334155',
                        borderRight: '1px solid #334155',
                        padding: '6px 4px',
                        fontWeight: 'normal',
                      }}
                    >
                      <div className="fw-bold" style={{ whiteSpace: 'nowrap' }}>{h.hname}</div>
                      <span className="badge bg-secondary mt-1" style={{ fontSize: '9px', padding: '1px 4px' }}>
                        [{h.hcode}] ({h.hospital_level})
                      </span>
                    </th>
                  ))}
                  <th
                    style={{
                      position: 'sticky',
                      top: 0,
                      zIndex: 10,
                      backgroundColor: '#1e293b',
                      color: '#ffffff',
                      minWidth: '100px',
                      borderBottom: '1px solid #334155',
                      padding: '6px 4px',
                    }}
                  >
                    รวมทั้งหมด
                  </th>
                </tr>
              </thead>
              <tbody>
                {activities.map((act) => {
                  const actId = Number(act.id);
                  const isSummaryRow = act.item_no === '8' || act.item_no === null;
                  const isSubItem = ['8.1', '8.2', '8.3'].includes(act.item_no);
                  let rowSum = 0;

                  return (
                    <tr
                      key={actId}
                      style={{
                        backgroundColor: isSummaryRow ? '#f1f5f9' : '#ffffff',
                        fontWeight: isSummaryRow ? 'bold' : 'normal',
                        borderBottom: '1px solid #e2e8f0',
                      }}
                    >
                      <td
                        style={{
                          position: 'sticky',
                          left: 0,
                          zIndex: 15,
                          backgroundColor: isSummaryRow ? '#f1f5f9' : '#ffffff',
                          textAlign: 'center',
                          borderRight: '1px solid #e2e8f0',
                          borderBottom: '1px solid #e2e8f0',
                          padding: '5px 2px',
                        }}
                      >
                        {act.item_no || '-'}
                      </td>
                      <td
                        style={{
                          position: 'sticky',
                          left: 45,
                          zIndex: 15,
                          backgroundColor: isSummaryRow ? '#f1f5f9' : '#ffffff',
                          textAlign: 'left',
                          whiteSpace: 'nowrap',
                          borderRight: '1px solid #e2e8f0',
                          borderBottom: '1px solid #e2e8f0',
                          padding: `5px 6px 5px ${isSubItem ? '18px' : '6px'}`,
                        }}
                      >
                        {act.activity_name}
                      </td>
                      <td
                        style={{
                          position: 'sticky',
                          left: 275,
                          zIndex: 15,
                          backgroundColor: isSummaryRow ? '#f1f5f9' : '#ffffff',
                          textAlign: 'center',
                          borderRight: '1px solid #cbd5e1',
                          borderBottom: '1px solid #e2e8f0',
                          padding: '5px 2px',
                        }}
                      >
                        <span className="badge bg-secondary" style={{ fontSize: '10px' }}>{act.unit}</span>
                      </td>

                      {hospitals.map((h) => {
                        const hc = String(h.hcode);
                        const vol = volumeMatrix[hc]?.[actId] || 0;
                        rowSum += vol;

                        if (act.item_no !== '8') {
                          hospitalTotals[hc] = (hospitalTotals[hc] || 0) + vol;
                        }

                        return (
                          <td
                            key={hc}
                            style={{
                              textAlign: 'center',
                              borderRight: '1px solid #e2e8f0',
                              borderBottom: '1px solid #e2e8f0',
                              padding: '5px 4px',
                              fontWeight: vol > 0 ? 'bold' : 'normal',
                              color: vol > 0 ? '#0f172a' : '#94a3b8',
                            }}
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
                          <td
                            style={{
                              textAlign: 'center',
                              fontWeight: 'bold',
                              color: '#2563eb',
                              backgroundColor: isSummaryRow ? '#e2e8f0' : '#f8fafc',
                              borderBottom: '1px solid #e2e8f0',
                              padding: '5px 4px',
                            }}
                          >
                            {rowSum.toLocaleString()}
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
                    colSpan={3}
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
                    รวมปริมาณงานทั้งหมด:
                  </td>
                  {hospitals.map((h) => {
                    const hc = String(h.hcode);
                    return (
                      <td
                        key={hc}
                        style={{
                          position: 'sticky',
                          bottom: 0,
                          zIndex: 20,
                          backgroundColor: '#e2e8f0',
                          borderTop: '2px solid #cbd5e1',
                          borderRight: '1px solid #cbd5e1',
                          textAlign: 'center',
                          color: '#16a34a',
                          padding: '8px 4px',
                        }}
                      >
                        {(hospitalTotals[hc] || 0).toLocaleString()}
                      </td>
                    );
                  })}
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
                      padding: '8px 4px',
                    }}
                  >
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