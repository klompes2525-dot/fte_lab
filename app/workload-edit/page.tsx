import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { updateStaffMt } from './actions';

export const revalidate = 0;

interface PageProps {
  searchParams: Promise<{ hospital_code?: string; month?: string; year?: string }>;
}

export default async function WorkloadEditPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const selectedHcode = params.hospital_code || '';
  const selectedMonth = params.month || String(new Date().getMonth() + 1).padStart(2, '0');
  const selectedYear = params.year || String(new Date().getFullYear());

  const { data: hospitals } = await supabase.from('hospitals').select('hcode, hname').order('hcode', { ascending: true });

  let workloads: any[] = [];
  if (selectedHcode) {
    const startDate = `${selectedYear}-${selectedMonth}-01`;
    const endDate = `${selectedYear}-${selectedMonth}-${new Date(parseInt(selectedYear), parseInt(selectedMonth), 0).getDate()}`;
    const { data } = await supabase.from('workload_daily')
      .select('*')
      .eq('hospital_code', selectedHcode)
      .gte('start_date', startDate)
      .lte('start_date', endDate)
      .order('start_date', { ascending: true });
    workloads = data || [];
  }

  return (
    <div className="container-fluid py-4 mb-5">
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" />
      <h4 className="mb-3 text-primary fw-bold">จัดการข้อมูลจำนวนเจ้าหน้าที่ ที่ปฏิบัติงาน (staff_mt)</h4>

      <div className="card mb-4 shadow-sm border-0">
        <div className="card-body">
          <form method="GET" className="row g-3 align-items-end">
            <div className="col-md-5">
              <label className="form-label fw-bold">เลือกโรงพยาบาล</label>
              <select name="hospital_code" defaultValue={selectedHcode} className="form-select" required>
                <option value="">-- เลือกโรงพยาบาล --</option>
                {hospitals?.map(h => (
                  <option key={h.hcode} value={h.hcode}>[{h.hcode}] {h.hname}</option>
                ))}
              </select>
            </div>
            <div className="col-md-3">
              <label className="form-label fw-bold">เลือกเดือน</label>
              <select name="month" defaultValue={selectedMonth} className="form-select" required>
                {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div className="col-md-2">
              <label className="form-label fw-bold">เลือกปี (ค.ศ.)</label>
              <input type="number" name="year" defaultValue={selectedYear} className="form-control" required />
            </div>
            <div className="col-md-2">
              <button type="submit" className="btn btn-primary w-100 fw-bold">ค้นหาข้อมูล</button>
            </div>
          </form>
        </div>
      </div>

      {selectedHcode && (
        <form action={updateStaffMt}>
          <input type="hidden" name="hospital_code" value={selectedHcode} />
          <input type="hidden" name="month" value={selectedMonth} />
          <input type="hidden" name="year" value={selectedYear} />

          <div className="card shadow-sm border-0">
            <div className="card-body p-0 table-responsive" style={{ maxHeight: '600px' }}>
              <table className="table table-bordered align-middle text-nowrap mb-0">
                <thead className="table-dark text-center">
                  <tr>
                    <th>วันที่ (start_date)</th>
                    <th>รวมภาระงาน (grand_total)</th>
                    <th className="bg-warning text-dark">เจ้าหน้าที่ที่ปฏิบัติงาน (staff_mt)</th>
                  </tr>
                </thead>
                <tbody>
                  {workloads.map(row => (
                    <tr key={row.start_date}>
                      <td className="text-center fw-bold">{row.start_date}</td>
                      <td className="text-end fw-bold text-primary">{(row.grand_total_workload || 0).toLocaleString()}</td>
                      <td className="bg-light">
                        <input
                          type="number"
                          name={`staff_mt[${row.start_date}]`}
                          defaultValue={row.staff_mt || 0}
                          className="form-control text-end fw-bold border-warning"
                          min="0"
                          required
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-3 bg-white border-top text-end">
              <button type="submit" className="btn btn-success px-4 fw-bold">บันทึกการแก้ไข</button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}