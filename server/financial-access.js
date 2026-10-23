import {FINANCIAL_FEATURES_ENABLED} from '../src/features.js';
import {AppError} from './store.js';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const disabled = () => new AppError('Money features are temporarily unavailable. Your saved records are preserved.', 403);
const financialCollections = new Set(['payments', 'expenses']);
export const isFinancialField = key => /cost|price|amount|budget|salary|wage|payment|invoice|profit|revenue|payroll|currency|agreedrate|ratebasis|bankaccount|bankdetails|payrate|receiptreference|receiptimage|paiddate/i.test(key.replace(/[^a-z]/gi, ''));
const receipt = record => typeof record?.requestType === 'string' && record.requestType.trim().toLowerCase() === 'receipt';

export const financialCollectionAllowed = collection => FINANCIAL_FEATURES_ENABLED || !financialCollections.has(collection);
export const financialRecordAllowed = (collection, record) => financialCollectionAllowed(collection) && (FINANCIAL_FEATURES_ENABLED || collection !== 'purchaseRequests' || !receipt(record));

/** Remove structured money fields without changing a stored object or stock quantity. */
export function withoutFinancialFields(value) {
  if (FINANCIAL_FEATURES_ENABLED) return value;
  if (Array.isArray(value)) return value.map(withoutFinancialFields);
  if (!object(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !isFinancialField(key)).map(([key, child]) => [key, withoutFinancialFields(child)]));
}

export function assertNoFinancialFields(value) {
  if (FINANCIAL_FEATURES_ENABLED || !value || typeof value !== 'object') return;
  if (Array.isArray(value)) {value.forEach(assertNoFinancialFields); return;}
  for (const [key, child] of Object.entries(value)) {
    if (isFinancialField(key)) throw disabled();
    assertNoFinancialFields(child);
  }
}

export function assertFinancialMutation(collection, payload, previous) {
  if (!financialRecordAllowed(collection, previous) || !financialRecordAllowed(collection, payload)) throw disabled();
  assertNoFinancialFields(payload);
}

const containsFinancialFields = value => {
  if (!value || typeof value !== 'object') return false;
  return Array.isArray(value) ? value.some(containsFinancialFields) : Object.entries(value).some(([key, child]) => isFinancialField(key) || containsFinancialFields(child));
};
const identity = item => object(item) ? item.id || item.text || item.title || item.image || item.url || '' : typeof item === 'string' ? item : '';

/** Redacted operational forms must not erase hidden money fields on nested rows. */
export function preserveFinancialMetadata(payload, previous) {
  if (FINANCIAL_FEATURES_ENABLED || !previous || typeof previous !== 'object') return payload;
  if (Array.isArray(payload) && Array.isArray(previous)) {
    const matched = new Set();
    const result = payload.map(item => {
      const id = identity(item);
      const candidates = previous.map((old, index) => ({old, index})).filter(({old}) => id && identity(old) === id);
      if (candidates.length !== 1) return item;
      const {old, index} = candidates[0];
      if (matched.has(index) && containsFinancialFields(old)) throw new AppError('Keep each existing item once when updating its progress.', 409);
      matched.add(index);
      return preserveFinancialMetadata(item, old);
    });
    if (previous.some((old, index) => !matched.has(index) && containsFinancialFields(old))) throw new AppError('This edit would remove saved details from an existing item. Keep that item and update its progress instead.', 409);
    return result;
  }
  if (!object(payload) || !object(previous)) {
    if (containsFinancialFields(previous)) throw new AppError('Keep the existing item details when updating its progress.', 409);
    return payload;
  }
  const result = {...payload};
  for (const [key, value] of Object.entries(previous)) {
    if (isFinancialField(key) || !Object.hasOwn(payload, key) && containsFinancialFields(value)) result[key] = value;
  }
  for (const [key, value] of Object.entries(payload)) if (!isFinancialField(key) && Object.hasOwn(previous, key)) result[key] = preserveFinancialMetadata(value, previous[key]);
  return result;
}
