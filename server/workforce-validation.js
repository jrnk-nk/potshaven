const engagementTypes = ['Permanent', 'Daily', 'Weekly', 'Fixed contract', 'Until job complete'];
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

/** Optional fields keep existing crew profiles valid; new agreements are checked. */
export function validateWorkforce(collection, record, ErrorType = Error) {
  if (collection !== 'workers') return;
  const fail = message => {throw new ErrorType(message);};
  if (record.workforceType !== undefined && !['Internal', 'External'].includes(record.workforceType)) fail('Choose company staff or an external worker.');
  if (record.engagementType !== undefined && !engagementTypes.includes(record.engagementType)) fail('Choose a valid work agreement.');
  for (const key of ['engagementStart', 'engagementEnd']) {
    if (record[key] !== undefined && record[key] !== '' && !validDate(record[key])) fail('Choose valid agreement dates.');
  }
  if (record.engagementStart && record.engagementEnd && record.engagementEnd < record.engagementStart) fail('The agreement end date must be on or after its start date.');
  if (record.agreedRate !== undefined && (typeof record.agreedRate !== 'number' || !Number.isFinite(record.agreedRate) || record.agreedRate < 0)) fail('Agreed pay must be a nonnegative amount.');
  if (record.rateBasis !== undefined && !['Daily', 'Weekly', 'Fixed'].includes(record.rateBasis)) fail('Choose daily, weekly, or fixed pay.');
  if (record.available !== undefined && typeof record.available !== 'boolean') fail('Availability must be available or unavailable.');
  if (record.skills !== undefined && (!Array.isArray(record.skills) || record.skills.length > 50 || record.skills.some(skill => typeof skill !== 'string' || skill.length > 200))) fail('Add up to 50 short skills.');
  if (record.engagementType && record.engagementType !== 'Permanent' && !validDate(record.engagementStart)) fail('Add the agreement start date.');
  if (record.engagementType === 'Fixed contract' && !validDate(record.engagementEnd)) fail('Add the fixed contract end date.');
  if (record.engagementType === 'Until job complete' && (typeof record.relatedJobId !== 'string' || !record.relatedJobId.trim())) fail('Choose the job this agreement covers.');
  if (record.relatedJobId !== undefined && (typeof record.relatedJobId !== 'string' || record.relatedJobId.length > 200)) fail('Choose a valid linked job.');
  if (record.agreementStatus !== undefined && !['Not recorded', 'Pending', 'Signed'].includes(record.agreementStatus)) fail('Choose a valid agreement status.');
  for (const key of ['agreementNotes', 'agreementReference']) if (record[key] !== undefined && (typeof record[key] !== 'string' || record[key].length > 2000)) fail('Agreement notes and references must be short text.');
}
