import {createHash} from 'node:crypto';
import {AppError} from './store.js';

export {PROVIDER_LIMITS} from './store.js';

/** Hash an already validated request. Receipts never need raw prompts/photos. */
export function providerFingerprint(value) {
  const canonical = item => {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === 'object') return Object.fromEntries(Object.keys(item).sort().filter(key => item[key] !== undefined).map(key => [key, canonical(item[key])]));
    return item;
  };
  let encoded;
  try {encoded = JSON.stringify(canonical(value));} catch {throw new AppError('The request could not be identified.');}
  if (!encoded) throw new AppError('The request could not be identified.');
  return createHash('sha256').update(encoded).digest('hex');
}
