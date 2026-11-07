import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { updateStaffMt } from './actions';

export const revalidate = 0;

interface PageProps {
  searchParams: Promise<{
    hospital_code?: string;
    month?: string;
    year?: string;
  }>;
}

export default async function WorkloadEditPage({ searchParams }: PageProps) {
  const params = await searchParams;

  const currentYearAD = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;

  const selectedHcode = params.hospital_code || '11182';
  const selectedMonth = params.month ? parseInt(params.month) : currentMonth;
  const rawYear = params.year ? parseInt(params.year) : currentYearAD;
  
  const adYear = rawYear > 2400 ? rawYear - 543 : rawYear;
  const buddhistYear = rawYear > 2400 ? rawYear : rawYear + 543;

  // 1. ดึงรายชื่อโรงพยาบาลทั้งหมด
  const { data: hospitalsData } = await supabase
    .from('hospitals')
    .select('hcode, hname')
    .eq('is_active', 1)
    .order('hcode', { ascending: true });

  const hospitals = hospitalsData || [];

  // 2. ดึงข้อมูลรายวันประจำเดือนที่เลือก
  const startDateStr = `${adYear}-${String(selectedMonth).padStart(2, '0')}-01`;
  const lastDay = new Date(adYear, selectedMonth, 0).getDate();
  const endDateStr = `${adYear}-${String(selectedMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const { data: dailyRows } = await supabase
    .from('workload_daily')
    .select('id, start_date, staff_mt, sample_collection, hematology, clinical_microscopy, clinical_chemistry, clinical_immunology, clinical_microbiology, molecular_biology, blood_bank_no_nat, blood_bank_has_nat, blood_bank_prep, blood_bank_donation, blood_bank_nat_cert')
    .eq('hospital_code', selectedHcode)
    .gte('start_date', startDateStr)
    .lte('start_date', endDateStr)
    .order('start_date', { ascending: true });

  const rows = dailyRows || [];

  return (
    <div className="container py-4">
      {/* Header ด้านบนพร้อมปุ่มกลับหน้าหลัก */}
      <div className="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-2">
        <h3 className="m-0 fw-bold text-primary">
          จัดการข้อมูลจำนวนเจ้าหน้าที่ ที่ปฏิบัติงาน (staff_mt)
        </h3>
        <Link
          href={`/?hospital_code=${selectedHcode}&month=${selectedMonth}&year=${buddhistYear}`}
          className="btn btn-outline-secondary fw-bold"
        >
          <i className="fa-solid fa-arrow-left me-1"></i> กลับหน้าหลัก
        </Link>
      </div>

      {/* ตัวกรอง ค้นหาข้อมูล */}
      <div className="card mb-4 shadow-sm border-0">
        <div className="card-body">
          <form method="GET" className="row g-3 align-items-end">
            <div className="col-md-5">
              <label className="form-label fw-bold">เลือกโรงพยาบาล</label>
              <select name="hospital_code" defaultValue={selectedHcode} className="form-select">
                {hospitals.map((h) => (
                  <option key={h.hcode} value={h.hcode}>
                    [{h.hcode}] {h.hname}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-3">
              <label className="form-label fw-bold">เลือกเดือน</label>
              <select name="month" defaultValue={selectedMonth} className="form-select">
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-2">
              <label className="form-label fw-bold">เลือกปี (ค.ศ.)</label>
              <input
                type="number"
                name="year"
                defaultValue={adYear}
                className="form-control"
              />
            </div>
            <div className="col-md-2">
              <button type="submit" className="btn btn-primary w-100 fw-bold">
                ค้นหาข้อมูล
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* ฟอร์มกรอกข้อมูลพร้อมการ Fixed หัวตาราง */}
      <form action={updateStaffMt}>
        <input type="hidden" name="hospital_code" value={selectedHcode} />
        <input type="hidden" name="month" value={selectedMonth} />
        <input type="hidden" name="year" value={adYear} />

        <div
          className="table-responsive shadow-sm border rounded mb-3"
          style={{ maxHeight: '62vh', overflowY: 'auto' }}
        >
          <table className="table table-hover align-middle mb-0">
            <thead
              className="table-dark text-center"
              style={{ position: 'sticky', top: 0, zIndex: 10 }}
            >
              <tr>
                <th style={{ width: '30%' }}>วันที่ (start_date)</th>
                <th style={{ width: '35%' }}>รวมภาระงาน (grand_total)</th>
                <th style={{ width: '35%', backgroundColor: '#ffc107', color: '#000' }}>
                  เจ้าหน้าที่ปฏิบัติงาน (staff_mt)
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="text-center py-4 text-muted">
                    ไม่พบข้อมูลภาระงานรายวันในเดือนนี้
                  </td>
                </tr>
              ) : (
                rows.map((r: any) => {
                  const grandTotal =
                    Number(r.sample_collection || 0) +
                    Number(r.hematology || 0) +
                    Number(r.clinical_microscopy || 0) +
                    Number(r.clinical_chemistry || 0) +
                    Number(r.clinical_immunology || 0) +
                    Number(r.clinical_microbiology || 0) +
                    Number(r.molecular_biology || 0) +
                    Number(r.blood_bank_no_nat || 0) +
                    Number(r.blood_bank_has_nat || 0) +
                    Number(r.blood_bank_prep || 0) +
                    Number(r.blood_bank_donation || 0) +
                    Number(r.blood_bank_nat_cert || 0);

                  return (
                    <tr key={r.id}>
                      <td className="text-center fw-bold">{r.start_date}</td>
                      <td className="text-center fw-bold text-primary">
                        {grandTotal.toLocaleString()}
                      </td>
                      <td className="text-center">
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          name={`staff_mt_${r.id}`}
                          defaultValue={r.staff_mt ?? 0}
                          className="form-control text-center fw-bold border-warning ms-auto me-auto"
                          style={{ maxWidth: '200px' }}
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="d-flex justify-content-end">
          <button type="submit" className="btn btn-success btn-lg fw-bold px-4">
            บันทึกการแก้ไข
          </button>
        </div>
      </form>
    </div>
  );
}