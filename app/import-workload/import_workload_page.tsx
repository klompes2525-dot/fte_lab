'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';

interface WorkloadRow {
  hospital_code: string;
  start_date: string;
  end_date: string;
  sample_collection: number;
  hematology: number;
  clinical_microscopy: number;
  clinical_chemistry: number;
  clinical_immunology: number;
  clinical_microbiology: number;
  molecular_biology: number;
  blood_bank_no_nat: number;
  blood_bank_has_nat: number;
  blood_bank_prep: number;
  blood_bank_donation: number;
  blood_bank_nat_cert: number;
  grand_total_workload: number;
  staff_mt: number;
  staff_other_mt: number;
}

const REQUIRED_COLUMNS = [
  'hospital_code',
  'start_date',
  'end_date',
  'sample_collection',
  'hematology',
  'clinical_microscopy',
  'clinical_chemistry',
  'clinical_immunology',
  'clinical_microbiology',
  'molecular_biology',
  'blood_bank_no_nat',
  'blood_bank_has_nat',
  'blood_bank_prep',
  'blood_bank_donation',
  'blood_bank_nat_cert',
  'grand_total_workload',
  'staff_mt',
  'staff_other_mt',
];

function formatExcelDate(val: unknown): string {
  if (val === null || val === undefined || val === '') return '';
  if (typeof val === 'number') {
    const parsed = XLSX.SSF.parse_date_code(val);
    if (parsed) {
      const y = String(parsed.y).padStart(4, '0');
      const m = String(parsed.m).padStart(2, '0');
      const d = String(parsed.d).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }
  const str = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.slice(0, 10);
  }
  const dObj = new Date(str);
  if (!isNaN(dObj.getTime())) {
    return dObj.toISOString().slice(0, 10);
  }
  return str;
}

function toInt(val: unknown, fallback = 0): number {
  if (val === null || val === undefined || val === '') return fallback;
  const cleaned = String(val).replace(/,/g, '').trim();
  const num = Number(cleaned);
  return Number.isFinite(num) ? Math.max(0, Math.round(num)) : fallback;
}

export default function ImportWorkloadPage() {
  const [apiToken, setApiToken] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [showSecrets, setShowSecrets] = useState(false);
  const [rememberCreds, setRememberCreds] = useState(true);

  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<WorkloadRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  useEffect(() => {
    try {
      const savedToken = localStorage.getItem('ftelab_api_token') || '';
      const savedSecret = localStorage.getItem('ftelab_secret_key') || '';
      if (savedToken) setApiToken(savedToken);
      if (savedSecret) setSecretKey(savedSecret);
    } catch {
      // ignore storage errors
    }
  }, []);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setSubmitStatus(null);
    setParseError(null);
    setRows([]);

    if (!file) {
      setFileName('');
      return;
    }

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'xlsx' && ext !== 'xls') {
      setFileName(file.name);
      setParseError('กรุณาเลือกไฟล์นามสกุล Excel (.xlsx หรือ .xls) เท่านั้น');
      return;
    }

    setFileName(file.name);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheetName = workbook.SheetNames.includes('workload_daily')
        ? 'workload_daily'
        : workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const rawJson = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
        defval: '',
      });

      if (!rawJson || rawJson.length === 0) {
        setParseError('ไม่พบข้อมูลในไฟล์ Excel ที่เลือก');
        return;
      }

      const firstKeys = Object.keys(rawJson[0]).map((k: string) => k.trim());
      const missingCols = ['hospital_code', 'start_date', 'grand_total_workload'].filter(
        (col: string) => !firstKeys.includes(col)
      );
      if (missingCols.length > 0) {
        setParseError(
          `โครงสร้างคอลัมน์ในไฟล์ Excel ไม่ถูกต้อง (ไม่พบคอลัมน์: ${missingCols.join(', ')})`
        );
        return;
      }

      const parsedRows: WorkloadRow[] = rawJson
        .map((r: Record<string, unknown>): WorkloadRow => {
          const sDate = formatExcelDate(r['start_date']);
          const eDate = formatExcelDate(r['end_date']) || sDate;
          return {
            hospital_code: String(r['hospital_code'] ?? '').trim(),
            start_date: sDate,
            end_date: eDate,
            sample_collection: toInt(r['sample_collection']),
            hematology: toInt(r['hematology']),
            clinical_microscopy: toInt(r['clinical_microscopy']),
            clinical_chemistry: toInt(r['clinical_chemistry']),
            clinical_immunology: toInt(r['clinical_immunology']),
            clinical_microbiology: toInt(r['clinical_microbiology']),
            molecular_biology: toInt(r['molecular_biology']),
            blood_bank_no_nat: toInt(r['blood_bank_no_nat']),
            blood_bank_has_nat: toInt(r['blood_bank_has_nat']),
            blood_bank_prep: toInt(r['blood_bank_prep']),
            blood_bank_donation: toInt(r['blood_bank_donation']),
            blood_bank_nat_cert: toInt(r['blood_bank_nat_cert']),
            grand_total_workload: toInt(r['grand_total_workload']),
            staff_mt: toInt(r['staff_mt'], 1),
            staff_other_mt: toInt(r['staff_other_mt'], 0),
          };
        })
        .filter((r: WorkloadRow) => r.hospital_code !== '' && r.start_date !== '');

      if (parsedRows.length === 0) {
        setParseError('ไม่พบแถวข้อมูลที่สมบูรณ์ (กรุณาตรวจสอบค่า hospital_code และ start_date)');
        return;
      }

      if (parsedRows.length > 366) {
        setParseError(`จำนวนข้อมูลเกินกำหนด (${parsedRows.length} วัน) สูงสุดไม่เกิน 366 วันต่อครั้ง`);
        return;
      }

      const uniqueHcodes = new Set(parsedRows.map((r: WorkloadRow) => r.hospital_code));
      if (uniqueHcodes.size > 1) {
        setParseError('พบข้อมูลหลายโรงพยาบาลปะปนกันในไฟล์เดียว กรุณาอัปโหลดทีละโรงพยาบาล');
        return;
      }

      setRows(parsedRows);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'ไม่สามารถอ่านไฟล์ Excel ได้';
      setParseError(`เกิดข้อผิดพลาดในการอ่านไฟล์: ${msg}`);
    }
  };

  const handleDownloadTemplate = () => {
    const sampleRow: Record<string, string | number> = {
      hospital_code: '11182',
      start_date: new Date().toISOString().slice(0, 10),
      end_date: new Date().toISOString().slice(0, 10),
      sample_collection: 0,
      hematology: 0,
      clinical_microscopy: 0,
      clinical_chemistry: 0,
      clinical_immunology: 0,
      clinical_microbiology: 0,
      molecular_biology: 0,
      blood_bank_no_nat: 0,
      blood_bank_has_nat: 0,
      blood_bank_prep: 0,
      blood_bank_donation: 0,
      blood_bank_nat_cert: 0,
      grand_total_workload: 0,
      staff_mt: 4,
      staff_other_mt: 0,
    };

    const ws = XLSX.utils.json_to_sheet([sampleRow], { header: REQUIRED_COLUMNS });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'workload_daily');
    XLSX.writeFile(wb, 'template_workload_daily.xlsx');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitStatus(null);

    if (!apiToken.trim() || !secretKey.trim()) {
      setSubmitStatus({
        type: 'error',
        message: 'กรุณากรอก API Token และ Secret Key ของโรงพยาบาลให้ครบถ้วน',
      });
      return;
    }

    if (rows.length === 0) {
      setSubmitStatus({
        type: 'error',
        message: 'กรุณาเลือกไฟล์ Excel (.xlsx) ที่มีข้อมูลถูกต้องก่อนกดนำเข้าข้อมูล',
      });
      return;
    }

    try {
      if (rememberCreds) {
        localStorage.setItem('ftelab_api_token', apiToken.trim());
        localStorage.setItem('ftelab_secret_key', secretKey.trim());
      } else {
        localStorage.removeItem('ftelab_api_token');
        localStorage.removeItem('ftelab_secret_key');
      }
    } catch {
      // ignore storage errors
    }

    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://mriqyjfltiffzmcyhmpv.supabase.co';
    const supabaseAnonKey =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      'sb_publishable_pInNrBqs1smiMiCbnTTIuw_JsDkndIw';

    const payloadList = rows.map((r: WorkloadRow) => ({
      hospital_code: r.hospital_code,
      start_date: r.start_date,
      end_date: r.end_date,
      staff_mt: r.staff_mt,
      staff_other_mt: r.staff_other_mt,
      metrics: {
        sample_collection: r.sample_collection,
        hematology: r.hematology,
        clinical_microscopy: r.clinical_microscopy,
        clinical_chemistry: r.clinical_chemistry,
        clinical_immunology: r.clinical_immunology,
        clinical_microbiology: r.clinical_microbiology,
        molecular_biology: r.molecular_biology,
        blood_bank_no_nat: r.blood_bank_no_nat,
        blood_bank_has_nat: r.blood_bank_has_nat,
        blood_bank_prep: r.blood_bank_prep,
        blood_bank_donation: r.blood_bank_donation,
        blood_bank_nat_cert: r.blood_bank_nat_cert,
        grand_total_workload: r.grand_total_workload,
      },
    }));

    setIsSubmitting(true);
    try {
      const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/submit-workload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${supabaseAnonKey}`,
          apikey: supabaseAnonKey,
          'x-api-token': apiToken.trim(),
          'x-secret-key': secretKey.trim(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ payload_list: payloadList }),
      });

      const result = await response.json().catch(() => ({}));

      if (response.ok) {
        setSubmitStatus({
          type: 'success',
          message: result.message || `นำเข้าข้อมูลสำเร็จจำนวน ${rows.length} วัน`,
        });
      } else {
        setSubmitStatus({
          type: 'error',
          message: result.error || `เกิดข้อผิดพลาดจากเซิร์ฟเวอร์ (${response.status})`,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้';
      setSubmitStatus({
        type: 'error',
        message: `การเชื่อมต่อล้มเหลว: ${msg}`,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalGrandWorkload = rows.reduce(
    (acc: number, r: WorkloadRow) => acc + r.grand_total_workload,
    0
  );

  return (
    <div className="container-fluid px-3 py-3" style={{ fontSize: '0.85rem', maxWidth: '1320px' }}>
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css"
      />
      <link
        rel="stylesheet"
        href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"
      />

      {/* Header */}
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <h4 className="m-0 fw-bold text-dark fs-5">
          <i className="fa-solid fa-file-excel text-success me-2"></i>
          นำเข้าข้อมูลภาระงานประจำวัน (Excel .xlsx)
        </h4>
        <div className="d-flex align-items-center gap-2">
          <button
            type="button"
            onClick={handleDownloadTemplate}
            className="btn btn-outline-success btn-sm fw-bold"
          >
            <i className="fa-solid fa-download me-1"></i> ดาวน์โหลดไฟล์ตัวอย่าง (.xlsx)
          </button>
          <Link href="/" className="btn btn-outline-secondary btn-sm fw-bold">
            <i className="fa-solid fa-arrow-left me-1"></i> กลับหน้าหลัก
          </Link>
        </div>
      </div>

      {/* Form Card */}
      <div className="card shadow-sm border-0 mb-3">
        <div className="card-header bg-white py-2 px-3 fw-bold text-primary">
          <i className="fa-solid fa-key me-1"></i> ยืนยันสิทธิ์โรงพยาบาลและเลือกไฟล์ Excel
        </div>
        <div className="card-body p-3">
          <form onSubmit={handleSubmit}>
            <div className="row g-3 mb-3">
              <div className="col-md-6">
                <label className="form-label fw-bold mb-1">
                  API Token ประจำโรงพยาบาล <span className="text-danger">*</span>
                </label>
                <input
                  type={showSecrets ? 'text' : 'password'}
                  className="form-control form-control-sm"
                  placeholder="กรอก API Token ของโรงพยาบาล"
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                  required
                />
              </div>
              <div className="col-md-6">
                <label className="form-label fw-bold mb-1">
                  Secret Key ประจำโรงพยาบาล <span className="text-danger">*</span>
                </label>
                <input
                  type={showSecrets ? 'text' : 'password'}
                  className="form-control form-control-sm"
                  placeholder="กรอก Secret Key ของโรงพยาบาล"
                  value={secretKey}
                  onChange={(e) => setSecretKey(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="d-flex align-items-center gap-4 mb-3">
              <div className="form-check">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="chkShowSecrets"
                  checked={showSecrets}
                  onChange={(e) => setShowSecrets(e.target.checked)}
                />
                <label className="form-check-label small" htmlFor="chkShowSecrets">
                  แสดงรหัส Token / Secret Key
                </label>
              </div>
              <div className="form-check">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="chkRememberCreds"
                  checked={rememberCreds}
                  onChange={(e) => setRememberCreds(e.target.checked)}
                />
                <label className="form-check-label small" htmlFor="chkRememberCreds">
                  จดจำรหัสไว้ในเบราว์เซอร์เครื่องนี้
                </label>
              </div>
            </div>

            <div className="mb-3">
              <label className="form-label fw-bold mb-1">
                เลือกไฟล์ Excel จากโปรแกรม FTE_medtech (.xlsx) <span className="text-danger">*</span>
              </label>
              <input
                type="file"
                accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                className="form-control form-control-sm"
                onChange={handleFileChange}
              />
              {fileName && (
                <div className="form-text text-muted mt-1">
                  ไฟล์ที่เลือก: <strong>{fileName}</strong>
                </div>
              )}
            </div>

            {parseError && (
              <div className="alert alert-danger py-2 px-3 mb-3" role="alert">
                <i className="fa-solid fa-triangle-exclamation me-2"></i>
                {parseError}
              </div>
            )}

            {submitStatus && (
              <div
                className={`alert ${
                  submitStatus.type === 'success' ? 'alert-success' : 'alert-danger'
                } py-2 px-3 mb-3`}
                role="alert"
              >
                <i
                  className={`fa-solid ${
                    submitStatus.type === 'success' ? 'fa-circle-check' : 'fa-circle-xmark'
                  } me-2`}
                ></i>
                {submitStatus.message}
              </div>
            )}

            <div className="d-flex justify-content-end gap-2">
              <button
                type="submit"
                disabled={isSubmitting || rows.length === 0}
                className="btn btn-success btn-sm fw-bold px-4 py-2"
              >
                {isSubmitting ? (
                  <>
                    <span
                      className="spinner-border spinner-border-sm me-2"
                      role="status"
                      aria-hidden="true"
                    ></span>
                    กำลังอัปโหลดข้อมูล...
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-cloud-arrow-up me-2"></i>
                    ยืนยันนำเข้าข้อมูล ({rows.length} วัน)
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Preview Table */}
      {rows.length > 0 && (
        <div className="card shadow-sm border-0">
          <div className="card-header bg-white py-2 px-3 d-flex justify-content-between align-items-center flex-wrap gap-2">
            <span className="fw-bold text-dark">
              <i className="fa-solid fa-table me-1 text-primary"></i>
              ตรวจสอบข้อมูลก่อนอัปโหลด (รหัส รพ.:{' '}
              <span className="badge bg-primary">{rows[0].hospital_code}</span> | ช่วงวันที่:{' '}
              <strong>{rows[0].start_date}</strong> ถึง{' '}
              <strong>{rows[rows.length - 1].start_date}</strong>)
            </span>
            <span className="badge bg-dark fs-6">
              รวม Workload ทั้งหมด: {totalGrandWorkload.toLocaleString()} ครั้ง ({rows.length} วัน)
            </span>
          </div>
          <div className="card-body p-0">
            <div style={{ maxHeight: '420px', overflow: 'auto' }}>
              <table
                className="table table-bordered table-hover table-sm mb-0 text-end align-middle"
                style={{ fontSize: '0.78rem' }}
              >
                <thead className="table-dark text-center" style={{ position: 'sticky', top: 0, zIndex: 5 }}>
                  <tr>
                    <th>วันที่</th>
                    <th>เก็บตัวอย่าง</th>
                    <th>Hema</th>
                    <th>Microscopy</th>
                    <th>Chemistry</th>
                    <th>Immuno</th>
                    <th>Microbio</th>
                    <th>Molecular</th>
                    <th>BB (No NAT)</th>
                    <th>BB (NAT)</th>
                    <th>เตรียมเลือด</th>
                    <th>บริจาค</th>
                    <th>รับรอง NAT</th>
                    <th>รวมทั้งหมด</th>
                    <th>จนท.Lab</th>
                    <th>งานอื่น</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: WorkloadRow, idx: number) => (
                    <tr key={`${r.start_date}-${idx}`}>
                      <td className="text-center fw-bold">{r.start_date}</td>
                      <td>{r.sample_collection.toLocaleString()}</td>
                      <td>{r.hematology.toLocaleString()}</td>
                      <td>{r.clinical_microscopy.toLocaleString()}</td>
                      <td>{r.clinical_chemistry.toLocaleString()}</td>
                      <td>{r.clinical_immunology.toLocaleString()}</td>
                      <td>{r.clinical_microbiology.toLocaleString()}</td>
                      <td>{r.molecular_biology.toLocaleString()}</td>
                      <td>{r.blood_bank_no_nat.toLocaleString()}</td>
                      <td>{r.blood_bank_has_nat.toLocaleString()}</td>
                      <td>{r.blood_bank_prep.toLocaleString()}</td>
                      <td>{r.blood_bank_donation.toLocaleString()}</td>
                      <td>{r.blood_bank_nat_cert.toLocaleString()}</td>
                      <td className="fw-bold text-primary">{r.grand_total_workload.toLocaleString()}</td>
                      <td className="text-center">{r.staff_mt}</td>
                      <td className="text-center">{r.staff_other_mt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}