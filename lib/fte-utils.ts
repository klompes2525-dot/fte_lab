export const LEVEL_COLUMN_MAP: Record<string, string> = {
  'A': 'hospital_a',
  'a': 'hospital_a_small',
  'S': 'hospital_s',
  's': 'hospital_s_small',
  'M1': 'hospital_m1',
  'M2': 'hospital_m2',
  'F1': 'hospital_f1',
  'F2': 'hospital_f2',
  'F3': 'hospital_f3'
};

export const THAI_MONTHS: Record<number, string> = {
  1: 'มกราคม', 2: 'กุมภาพันธ์', 3: 'มีนาคม', 4: 'เมษายน',
  5: 'พฤษภาคม', 6: 'มิถุนายน', 7: 'กรกฎาคม', 8: 'สิงหาคม',
  9: 'กันยายน', 10: 'ตุลาคม', 11: 'พฤศจิกายน', 12: 'ธันวาคม'
};

export const ACT_COLUMN_MAP: Record<number, string> = {
  1: 'sample_collection',
  2: 'hematology',
  3: 'clinical_microscopy',
  4: 'clinical_chemistry',
  5: 'clinical_immunology',
  6: 'clinical_microbiology',
  7: 'molecular_biology',
  8: 'blood_bank_no_nat',
  9: 'blood_bank_has_nat',
  10: 'blood_bank_prep',
  11: 'blood_bank_donation',
  12: 'blood_bank_nat_cert'
};

export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function calculateWorkingDays(year: number, month: number, holidaysList: string[] = []): { workingDays: number; holidayCount: number } {
  const totalDays = getDaysInMonth(year, month);
  const holidaySet = new Set<string>(holidaysList);

  for (let d = 1; d <= totalDays; d++) {
    const date = new Date(year, month - 1, d);
    const dayOfWeek = date.getDay(); // 0 = Sun, 6 = Sat
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      holidaySet.add(dateStr);
    }
  }

  const holidayCount = holidaySet.size;
  const workingDays = Math.max(1, totalDays - holidayCount);
  return { workingDays, holidayCount };
}