import {assignmentWarnings} from './workforce.ts';

type Row = Record<string, any>;
type Workspace = {[key: string]: any};
export type DayReminder = {id: string; title: string; detail: string; page: string; icon: string; tone?: string};

const rows = (data: Workspace, key: string): Row[] => Array.isArray(data[key]) ? data[key] : [];
const due = (job: Row) => job.type === 'Project' ? job.deadline || job.date || '' : job.date || job.deadline || '';
const taskLabel = (task: any) => typeof task === 'string' ? task : String(task?.text || task?.title || 'Checklist task');
const byTime = (a: Row, b: Row) => String(a.time || '99:99').localeCompare(String(b.time || '99:99')) || String(a.title || '').localeCompare(String(b.title || ''));

export function checklistProgress(job: Row) {
  const tasks = Array.isArray(job.tasks) ? job.tasks : [];
  const done = tasks.filter(task => task && typeof task === 'object' && task.done === true).length;
  return {total: tasks.length, done, remaining: tasks.length - done};
}

/** Operational facts only. This summary never includes pay, payments, or revenue. */
export function managerDay(data: Workspace, date: string) {
  const jobs = rows(data, 'jobs');
  const workers = rows(data, 'workers');
  const vehicles = rows(data, 'vehicles');
  const scheduled = jobs.filter(job => job.date === date).sort(byTime);
  const overdue = jobs.filter(job => job.status !== 'Completed' && due(job) && due(job) < date);
  const completedUnchecked = jobs.filter(job => job.status === 'Completed' && checklistProgress(job).remaining > 0);
  const dueToday = jobs.filter(job => job.status !== 'Completed' && due(job) === date);
  const assignmentChecks = scheduled.filter(job => job.status !== 'Completed').map(job => {
    const crewIds = Array.isArray(job.crewIds) ? job.crewIds : [];
    const warnings = [
      ...(!crewIds.length ? ['Choose a crew.'] : []),
      ...(!job.vehicleId ? ['Confirm whether transport is needed.'] : []),
      ...assignmentWarnings(job, jobs, workers, vehicles),
    ];
    return {job, warnings};
  }).filter(item => item.warnings.length > 0);
  const attentionJobs = [...new Map([...overdue, ...completedUnchecked, ...dueToday, ...assignmentChecks.map(item => item.job)].map(job => [job.id, job])).values()]
    .sort((a, b) => String(due(a) || '9999').localeCompare(String(due(b) || '9999')) || byTime(a, b));
  const lowStock = rows(data, 'inventory').filter(item => Number.isFinite(Number(item.quantity)) && Number(item.quantity) <= Number(item.minStock || 0));
  const horizon = new Date(`${date}T12:00:00Z`); horizon.setUTCDate(horizon.getUTCDate() + 7);
  const weekEnd = horizon.toISOString().slice(0, 10);
  const endingAgreements = workers.filter(worker => worker.available !== false && worker.engagementEnd && worker.engagementEnd <= weekEnd && worker.engagementType !== 'Permanent');
  const equipmentDue = rows(data, 'equipment').filter(item => (item.nextService || item.nextServiceDate) && (item.nextService || item.nextServiceDate) <= date);
  const issuesDue = rows(data, 'issues').filter(item => !['Resolved', 'Closed', 'Completed'].includes(item.status) && ((item.followUpDate && item.followUpDate <= date) || ['High', 'Urgent'].includes(item.priority)));
  const reminders: DayReminder[] = [];
  if (overdue.length) reminders.push({id: 'overdue', title: `${overdue.length} overdue ${overdue.length === 1 ? 'job' : 'jobs'}`, detail: overdue.slice(0, 2).map(job => job.title).join(', '), page: 'schedule', icon: 'CalendarClock', tone: 'warning'});
  if (completedUnchecked.length) reminders.push({id: 'checklists', title: `${completedUnchecked.length} completed ${completedUnchecked.length === 1 ? 'job needs' : 'jobs need'} a checklist check`, detail: 'Some tasks are still unchecked. Confirm the work with the crew.', page: 'schedule', icon: 'CalendarCheck2', tone: 'warning'});
  if (assignmentChecks.length) reminders.push({id: 'assignments', title: `${assignmentChecks.length} ${assignmentChecks.length === 1 ? 'assignment needs' : 'assignments need'} a check`, detail: 'Confirm people, transport, and other visits today.', page: 'schedule', icon: 'UsersRound'});
  if (lowStock.length) reminders.push({id: 'stock', title: `${lowStock.length} ${lowStock.length === 1 ? 'item is' : 'items are'} running low`, detail: lowStock.slice(0, 2).map(item => item.name).join(', '), page: 'inventory', icon: 'Sprout'});
  if (endingAgreements.length) reminders.push({id: 'agreements', title: `${endingAgreements.length} work ${endingAgreements.length === 1 ? 'agreement needs' : 'agreements need'} review`, detail: endingAgreements.slice(0, 2).map(worker => `${worker.name} · ${worker.engagementEnd < date ? 'ended' : 'ends'} ${worker.engagementEnd}`).join(', '), page: 'team', icon: 'UsersRound'});
  if (equipmentDue.length) reminders.push({id: 'equipment', title: `${equipmentDue.length} equipment service ${equipmentDue.length === 1 ? 'check' : 'checks'}`, detail: equipmentDue.slice(0, 2).map(item => item.name).join(', '), page: 'inventory', icon: 'Wrench'});
  if (issuesDue.length) reminders.push({id: 'issues', title: `${issuesDue.length} site ${issuesDue.length === 1 ? 'issue needs' : 'issues need'} follow-up`, detail: issuesDue.slice(0, 2).map(item => item.title).join(', '), page: 'sites', icon: 'MapPin'});
  return {scheduled, completed: scheduled.filter(job => job.status === 'Completed').length, overdue, completedUnchecked, dueToday, attentionJobs, assignmentChecks, lowStock, endingAgreements, equipmentDue, issuesDue, reminders};
}

/** The manager reviews and shares this text. Building it never sends a message. */
export function dailyWorkBrief(data: Workspace, date: string, {siteId}: {siteId?: string} = {}) {
  // Keep all assignments available to detect crew/vehicle reuse at other
  // sites, even when the printed plan includes only the selected location.
  const companyDay = managerDay(data, date);
  const scopedJobs = (jobs: Row[]) => siteId ? jobs.filter(job => job.placeId === siteId) : jobs;
  const scheduled = scopedJobs(companyDay.scheduled);
  const day = {...companyDay, scheduled, completed: scheduled.filter(job => job.status === 'Completed').length,
    overdue: scopedJobs(companyDay.overdue), completedUnchecked: scopedJobs(companyDay.completedUnchecked)};
  const workers = rows(data, 'workers');
  const places = rows(data, 'places');
  const vehicles = rows(data, 'vehicles');
  const label = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Accra'});
  const lines = [`${data.settings?.companyName || 'PotsHaven'} · Daily work plan`, label, '', `${day.scheduled.length} ${day.scheduled.length === 1 ? 'job' : 'jobs'} scheduled · ${day.completed} marked complete`, ''];
  if (siteId) lines.splice(2, 0, `Site focus: ${places.find(site => site.id === siteId)?.name || 'Selected site'}`);
  if (!day.scheduled.length) lines.push('No jobs are scheduled for today.', '');
  day.scheduled.forEach((job, index) => {
    const place = places.find(item => item.id === job.placeId);
    const crew = (Array.isArray(job.crewIds) ? job.crewIds : []).map((id: string) => workers.find(worker => worker.id === id)?.name || 'Worker to confirm');
    const vehicle = vehicles.find(item => item.id === job.vehicleId);
    lines.push(`${index + 1}. ${job.time || 'Time to confirm'} · ${job.title}`, `Status: ${job.status || 'To confirm'}`, `Site: ${place?.name || 'To confirm'}${place?.address ? ` · ${place.address}` : ''}`, `People: ${crew.join(', ') || 'To be assigned'}`, `Vehicle: ${vehicle ? `${vehicle.name}${vehicle.registration ? ` · ${vehicle.registration}` : ''}` : 'Confirm transport if needed'}`);
    for (const task of Array.isArray(job.tasks) ? job.tasks : []) lines.push(`${typeof task === 'object' && task?.done === true ? 'Done' : typeof task === 'object' && task?.done === false ? 'Pending' : 'Unconfirmed'}: ${taskLabel(task)}`);
    if (job.notes) lines.push(`Instructions: ${job.notes}`);
    const check = day.assignmentChecks.find(item => item.job.id === job.id);
    if (check) lines.push(...check.warnings.map(warning => `Check: ${warning}`));
    lines.push('');
  });
  if (day.overdue.length) lines.push('Follow up on overdue work:', ...day.overdue.map(job => `• ${job.title} · due ${due(job)}`), '');
  if (day.completedUnchecked.length) lines.push('Confirm unchecked tasks on completed jobs:', ...day.completedUnchecked.map(job => `• ${job.title} · ${checklistProgress(job).remaining} unchecked`), '');
  if (day.lowStock.length) lines.push('Stock to check before leaving:', ...day.lowStock.map(item => `• ${item.name}: ${item.quantity} ${item.unit || 'left'}`), '');
  lines.push('Please send completion photos and report any unfinished work or site issues.');
  return lines.join('\n');
}
