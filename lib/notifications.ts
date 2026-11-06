import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { addDays, todayISO, fmt } from './dates';
import { daysSince, noLabValues } from './study';
import { hba1cDue } from './labs';
import type { Patient, Progress, Slot, Visit } from './types';
import type { Role } from './supabase';

// In-app notifications, worked out from the study data each time (nothing to set up).
// Each one has a stable key so "read" survives refreshes; read state is per user.

export type Category = 'Follow-up' | 'Labs' | 'ENL & steroids' | 'Team' | 'Needs checking' | 'System';
export type Note = { key: string; category: Category; level: 'high' | 'medium' | 'info'; title: string; body: string; date: string;
  route?: string; patientId?: string; action?: { kind: 'access'; userId: string; email: string } };

const LAB_PENDING_DAYS = 7, CLOSING_DAYS = 7, MISSED_LOOKBACK = 45, ESS_LOOKBACK = 30;

export async function loadNotifications(role: Role | null): Promise<Note[]> {
  if (!role) return [];
  const today = todayISO(), owner = role === 'owner';
  const [pt, sl, pg, vs, fl, ep, st, sg, rv, ar, sq, se] = await Promise.all([
    supabase.from('patients').select('id, cr_no, patient_name, patient_status, mdt_status, enrollment_date').is('deleted_at', null),
    supabase.from('v_schedule').select('*'),
    supabase.from('v_patient_progress').select('*'),
    supabase.from('visits').select('*').is('deleted_at', null).order('visit_date'),
    supabase.from('v_steroid_flags').select('*'),
    supabase.from('v_episode_types').select('id, patient_id, onset_date, end_date, days'),
    supabase.from('study_settings').select('key, value'),
    supabase.from('suggestions').select('id, patient_id, visit_id, body, author_email, created_at').is('resolved_at', null),
    supabase.from('v_review_items').select('record_id', { count: 'exact', head: true }),
    owner ? supabase.from('access_requests').select('*').eq('status', 'pending') : Promise.resolve({ data: [] } as any),
    owner ? supabase.from('sync_queue').select('id, last_error, attempts, created_at').is('done_at', null).not('last_error', 'is', null) : Promise.resolve({ data: [] } as any),
    owner ? supabase.from('system_events').select('*').eq('kind', 'weekly_backup').order('at', { ascending: false }).limit(1) : Promise.resolve({ data: [] } as any),
  ]);
  const P = new Map(((pt.data ?? []) as Patient[]).map(p => [p.id, p]));
  const active = (id: string) => (P.get(id)?.patient_status ?? 'Active') === 'Active';
  const name = (id: string) => { const p = P.get(id); return p ? (p.patient_name === p.cr_no ? p.cr_no : `${p.patient_name} (${p.cr_no})`) : 'Patient'; };
  const setting = (k: string, d: number) => Number(((st.data ?? []) as { key: string; value: number }[]).find(x => x.key === k)?.value ?? d);
  const out: Note[] = [];
  const visitsBy = new Map<string, Visit[]>();
  for (const v of (vs.data ?? []) as Visit[]) visitsBy.set(v.patient_id, [...(visitsBy.get(v.patient_id) ?? []), v]);

  // ---- Follow-up
  const progress = new Map(((pg.data ?? []) as Progress[]).map(r => [r.patient_id, r]));
  for (const r of progress.values()) {
    if (!active(r.patient_id)) continue;
    if (r.consecutive_missed >= 2 || r.ltfu_flag)
      out.push({ key: `ltfu:${r.patient_id}:${r.followups_missed}`, category: 'Follow-up', level: 'high', title: `At risk of loss to follow-up: ${name(r.patient_id)}`,
        body: `${r.consecutive_missed} follow-up months missed in a row. Call before the next window closes.`, date: today, route: `/patient/${r.patient_id}`, patientId: r.patient_id });
  }
  for (const x of (sl.data ?? []) as Slot[]) {
    if (x.is_baseline || x.visit_uuid || !active(x.patient_id)) continue;
    if (x.opens_on <= today && today < x.closes_on && x.closes_on <= addDays(today, CLOSING_DAYS))
      out.push({ key: `closing:${x.patient_id}:${x.slot_month}`, category: 'Follow-up', level: 'medium', title: `Month ${x.slot_month} window closes ${fmt(x.closes_on)}`,
        body: `${name(x.patient_id)} has not come for Month ${x.slot_month} yet.`, date: x.closes_on, route: `/patient/${x.patient_id}`, patientId: x.patient_id });
    if (x.status === 'missed' && x.closes_on >= addDays(today, -MISSED_LOOKBACK) && (progress.get(x.patient_id)?.consecutive_missed ?? 0) < 2)
      out.push({ key: `missed:${x.patient_id}:${x.slot_month}`, category: 'Follow-up', level: 'medium', title: `Missed Month ${x.slot_month}: ${name(x.patient_id)}`,
        body: `The window closed on ${fmt(x.closes_on)} without a visit.`, date: x.closes_on, route: `/patient/${x.patient_id}`, patientId: x.patient_id });
  }

  // ---- Labs
  for (const [pid, list] of visitsBy) {
    for (const v of list) {
      if (noLabValues(v) && daysSince(v.visit_date) >= LAB_PENDING_DAYS)
        out.push({ key: `labs:${v.id}`, category: 'Labs', level: 'medium', title: `Reports not entered: ${name(pid)}`,
          body: `${v.visit_type} on ${fmt(v.visit_date)} has no lab values (${daysSince(v.visit_date)} days). Scan or type the report.`, date: v.visit_date, route: `/visit/${v.id}`, patientId: pid });
    }
  }

  // ---- ENL and steroids
  for (const f of (fl.data ?? []) as any[]) {
    if (!active(f.patient_id)) continue;
    if (f.steroid_dependent) out.push({ key: `dep:${f.patient_id}`, category: 'ENL & steroids', level: 'high', title: `Steroid dependent: ${name(f.patient_id)}`,
      body: `${f.taper_relapses} relapses during taper. Consider a steroid-sparing agent.`, date: f.last_taper_relapse ?? today, route: `/patient/${f.patient_id}`, patientId: f.patient_id });
    else if (f.taper_relapses > 0) out.push({ key: `taper:${f.patient_id}:${f.taper_relapses}`, category: 'ENL & steroids', level: 'medium', title: `Relapse during taper: ${name(f.patient_id)}`,
      body: `ENL came back while the dose was being reduced (×${f.taper_relapses}).`, date: f.last_taper_relapse ?? today, route: `/patient/${f.patient_id}`, patientId: f.patient_id });
    if (f.possible_nonresponder) out.push({ key: `nonresp:${f.patient_id}:${f.current_episode_onset}`, category: 'ENL & steroids', level: 'high', title: `Possible non-response: ${name(f.patient_id)}`,
      body: `ESS ${f.ess_start} → best ${f.ess_best} after ${f.adequate_days} days on an adequate dose.`, date: today, route: `/patient/${f.patient_id}`, patientId: f.patient_id });
  }
  const chronicDays = setting('chronic_weeks', 24) * 7;
  for (const e of (ep.data ?? []) as any[]) {
    if (!e.end_date && e.days >= chronicDays && active(e.patient_id))
      out.push({ key: `chronic:${e.id}`, category: 'ENL & steroids', level: 'medium', title: `ENL ongoing ${Math.round(e.days / 7)} weeks: ${name(e.patient_id)}`,
        body: `Episode since ${fmt(e.onset_date)} — chronic ENL (over ${chronicDays / 7} weeks). Close it if it has settled.`, date: e.onset_date, route: `/patient/${e.patient_id}`, patientId: e.patient_id });
  }
  const cutoff = setting('ess_cutoff', 9);
  for (const [pid, list] of visitsBy) {
    const last = list[list.length - 1];
    if (last?.ess_score != null && last.ess_score >= cutoff && daysSince(last.visit_date) <= ESS_LOOKBACK && active(pid))
      out.push({ key: `ess:${last.id}`, category: 'ENL & steroids', level: 'high', title: `Moderate–severe ENL: ${name(pid)}`,
        body: `ESS ${last.ess_score} on ${fmt(last.visit_date)} (${cutoff} or more).`, date: last.visit_date, route: `/visit/${last.id}`, patientId: pid });
    // HbA1c due while on prednisolone
    const onSteroid = list.some(v => (v.prednisolone_mg ?? 0) > 0);
    const pr = progress.get(pid);
    if (onSteroid && pr?.next_slot != null && hba1cDue(pr.next_slot, pr.enrollment_month) && pr.next_due_date && pr.next_due_date <= addDays(today, 14))
      out.push({ key: `hba1c:${pid}:${pr.next_slot}`, category: 'ENL & steroids', level: 'info', title: `HbA1c due at Month ${pr.next_slot}: ${name(pid)}`,
        body: `On prednisolone — add HbA1c to the next tests (due ${fmt(pr.next_due_date)}).`, date: pr.next_due_date, route: `/patient/${pid}`, patientId: pid });
  }

  // ---- Team
  for (const r of (ar.data ?? []) as any[])
    out.push({ key: `access:${r.user_id}`, category: 'Team', level: 'high', title: 'New user asking for access', body: `${r.email} signed up on ${fmt(String(r.requested_at).slice(0, 10))}.`,
      date: String(r.requested_at).slice(0, 10), action: { kind: 'access', userId: r.user_id, email: r.email } });
  for (const x of (sg.data ?? []) as any[])
    out.push({ key: `sugg:${x.id}`, category: 'Team', level: 'info', title: `Suggestion for ${name(x.patient_id)}`, body: `${x.body} — ${x.author_email ?? 'team member'}`,
      date: String(x.created_at).slice(0, 10), route: x.visit_id ? `/visit/${x.visit_id}` : `/patient/${x.patient_id}`, patientId: x.patient_id });

  // ---- Needs checking (the old Review list)
  if ((rv.count ?? 0) > 0)
    out.push({ key: `review:${rv.count}`, category: 'Needs checking', level: 'info', title: `${rv.count} records need checking`,
      body: 'Import notes and changes made in the old app. Open the list to review them.', date: today, route: '/review' });

  // ---- System (owner)
  const errs = (sq.data ?? []) as any[];
  if (errs.length) out.push({ key: `sync:${errs.length}:${errs[0].id}`, category: 'System', level: 'high', title: `Sheet copy failing for ${errs.length} record${errs.length === 1 ? '' : 's'}`,
    body: `Last error: ${String(errs[0].last_error).slice(0, 140)}`, date: today });
  if (owner) {
    const b = ((se.data ?? []) as any[])[0];
    if (b && !b.ok) out.push({ key: `backup:${b.id}`, category: 'System', level: 'high', title: 'Weekly backup failed', body: String(b.message ?? '').slice(0, 200), date: String(b.at).slice(0, 10) });
    else if (b && daysSince(String(b.at).slice(0, 10)) > 8) out.push({ key: `backup-old:${b.id}`, category: 'System', level: 'medium', title: 'No backup this week',
      body: `Last successful backup ${fmt(String(b.at).slice(0, 10))}. Check the Sheet Sync script triggers.`, date: today });
  }

  const rank = { high: 0, medium: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level] || b.date.localeCompare(a.date));
}

// Shared state so the tab badge and the Notifications screen agree.
let cache: { notes: Note[]; read: Set<string>; at: number } = { notes: [], read: new Set(), at: 0 };
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());

export async function refreshNotifications(role: Role | null) {
  const [notes, reads] = await Promise.all([loadNotifications(role), role ? supabase.from('notification_reads').select('key') : Promise.resolve({ data: [] } as any)]);
  cache = { notes, read: new Set(((reads.data ?? []) as { key: string }[]).map(r => r.key)), at: Date.now() };
  emit();
}
export async function markRead(keys: string[]) {
  const fresh = keys.filter(k => !cache.read.has(k));
  if (!fresh.length) return;
  fresh.forEach(k => cache.read.add(k)); emit();
  await supabase.from('notification_reads').upsert(fresh.map(key => ({ key })), { onConflict: 'user_id,key', ignoreDuplicates: true });
}

export function useNotifications(role: Role | null) {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick(x => x + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  const refresh = useCallback(() => refreshNotifications(role), [role]);
  useEffect(() => { if (role && Date.now() - cache.at > 60_000) refresh(); }, [role]);
  const unread = cache.notes.filter(n => !cache.read.has(n.key)).length;
  return { notes: cache.notes, read: cache.read, unread, refresh };
}
