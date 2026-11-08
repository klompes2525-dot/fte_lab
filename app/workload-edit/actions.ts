'use server';

import { supabase } from '@/lib/supabase';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

export async function updateStaffMt(formData: FormData) {
  const hospitalCode = formData.get('hospital_code') as string;
  const month = formData.get('month') as string;
  const year = formData.get('year') as string;

  // วนลูปอัปเดตข้อมูลเจ้าหน้าที่ห้องแล็บรายวันลง Supabase
  for (const [key, value] of formData.entries()) {
    if (key.startsWith('staff_mt_')) {
      const id = parseInt(key.replace('staff_mt_', ''), 10);
      const staffMt = parseFloat(value as string) || 0;

      if (!isNaN(id)) {
        await supabase
          .from('workload_daily')
          .update({ staff_mt: staffMt })
          .eq('id', id);
      }
    }
  }

  // ล้าง Cache หน้าที่เกี่ยวข้องทั้งหมดเพื่อให้แสดงข้อมูลใหม่ทันที
  revalidatePath('/workload-edit');
  revalidatePath('/');
  revalidatePath('/report-productivity');
  revalidatePath('/report-fte-monthly');

  // Redirect พร้อมส่ง status=success กลับมาแสดงป้ายแจ้งเตือน
  redirect(`/workload-edit?hospital_code=${hospitalCode}&month=${month}&year=${year}&status=success`);
}