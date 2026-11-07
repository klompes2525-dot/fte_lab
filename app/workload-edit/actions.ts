'server-only';
'use server';

import { revalidatePath } from 'next/cache';
import { supabase } from '@/lib/supabase';

export async function updateStaffMt(formData: FormData) {
  const hospitalCode = formData.get('hospital_code') as string;
  const month = formData.get('month') as string;
  const year = formData.get('year') as string;

  const updates: { start_date: string; staff_mt: number }[] = [];

  formData.forEach((value, key) => {
    if (key.startsWith('staff_mt[')) {
      const startDate = key.replace('staff_mt[', '').replace(']', '');
      updates.push({
        start_date: startDate,
        staff_mt: parseInt(value as string) || 0
      });
    }
  });

  for (const item of updates) {
    await supabase
      .from('workload_daily')
      .update({ staff_mt: item.staff_mt, updated_at: new Date().toISOString() })
      .eq('hospital_code', hospitalCode)
      .eq('start_date', item.start_date);
  }

  revalidatePath('/workload-edit');
  revalidatePath('/report-productivity');
}