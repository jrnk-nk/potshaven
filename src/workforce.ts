type Row = Record<string, any>;

export const engagementTypes = ['Permanent', 'Daily', 'Weekly', 'Fixed contract', 'Until job complete'];
export const rateBases = ['Daily', 'Weekly', 'Fixed'];

/** An engagement is separate from availability and from the day's assignments. */
export function engagementState(worker: Row, jobs: Row[], date: string) {
  if ((worker.engagementType || 'Permanent') === 'Permanent') return 'Ongoing';
  if (worker.engagementType === 'Until job complete' && worker.relatedJobId) {
    const job = jobs.find(item => item.id === worker.relatedJobId);
    if (job?.status === 'Completed') return 'Work complete';
    if (!job) return 'Check linked job';
  }
  if (worker.engagementEnd && worker.engagementEnd < date) return 'Ended';
  if (worker.engagementStart && worker.engagementStart > date) return 'Not started';
  return 'Active';
}

export function workerCanBeAssigned(worker: Row, jobs: Row[], date: string) {
  return worker.available !== false && ['Ongoing', 'Active'].includes(engagementState(worker, jobs, date));
}

export function assignmentWarnings(job: Row, jobs: Row[], workers: Row[], vehicles: Row[]) {
  const warnings: string[] = [];
  if (!job.date || job.status === 'Completed') return warnings;
  const others = jobs.filter(item => item.id !== job.id && item.date === job.date && item.status !== 'Completed');
  for (const id of job.crewIds || []) {
    const worker = workers.find(item => item.id === id);
    if (!worker) {warnings.push('One assigned worker is no longer in the team list.'); continue;}
    const state = engagementState(worker, jobs, job.date);
    if (worker.available === false) warnings.push(`${worker.name} is marked unavailable.`);
    if (!['Ongoing', 'Active'].includes(state)) warnings.push(`${worker.name}: ${state.toLowerCase()} on the scheduled date.`);
    const assigned = others.filter(item => (item.crewIds || []).includes(id));
    if (assigned.length) warnings.push(`${worker.name} also has ${assigned.map(item => item.title).join(', ')} on this date. Check travel and timing.`);
  }
  if (job.vehicleId) {
    const vehicle = vehicles.find(item => item.id === job.vehicleId);
    if (!vehicle) warnings.push('The assigned vehicle is no longer in the vehicle list.');
    else {
      if (['Servicing', 'Unavailable'].includes(vehicle.status)) warnings.push(`${vehicle.name} is marked ${vehicle.status.toLowerCase()}.`);
      const assigned = others.filter(item => item.vehicleId === vehicle.id);
      if (assigned.length) warnings.push(`${vehicle.name} is also assigned to ${assigned.map(item => item.title).join(', ')} on this date. Check travel and timing.`);
    }
  }
  return warnings;
}
