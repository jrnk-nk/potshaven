import {AppError} from './store.js';

export function decodeDesignReference(value) {
  const match = typeof value === 'string' && /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new AppError('Upload a PNG, JPG or WebP reference photo.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 8 * 1024 * 1024 || bytes.toString('base64') !== match[2]) {
    throw new AppError('The reference photo could not be read. Upload a PNG, JPG or WebP file.');
  }
  return {bytes, contentType: `image/${match[1]}`, extension: match[1] === 'jpeg' ? 'jpg' : match[1]};
}

export function referenceUploads({referenceImages, originalImage}) {
  if (referenceImages !== undefined && !Array.isArray(referenceImages)) throw new AppError('Reference photos must be a list.');
  if (originalImage !== undefined && typeof originalImage !== 'string') throw new AppError('Upload a PNG, JPG or WebP reference photo.');
  const uploads = [...(referenceImages || [])];
  if (originalImage && !uploads.includes(originalImage)) uploads.push(originalImage);
  if (uploads.length > 4) throw new AppError('Add up to four reference photos per message.');
  // Stay comfortably below Vercel's request-body limit after JSON encoding.
  if (uploads.some(image => typeof image !== 'string')) throw new AppError('Upload a PNG, JPG or WebP reference photo.');
  if (uploads.reduce((size, image) => size + image.length, 0) > 3.2 * 1024 * 1024) throw new AppError('These photos are too large. Resize them or send fewer photos.', 413);
  return uploads.map(value => ({value, ...decodeDesignReference(value)}));
}

export function instructionHistory(parent, prompt) {
  const previous = Array.isArray(parent?.instructionHistory)
    ? parent.instructionHistory.filter(value => typeof value === 'string' && value.trim()).map(value => value.slice(0, 6000))
    : typeof parent?.prompt === 'string' && parent.prompt.trim() ? [parent.prompt.slice(0, 6000)] : [];
  const history = [...previous, prompt];
  // Always retain the original brief and the latest request. Remove older
  // intermediate edits first when a long conversation exceeds the context cap.
  while (history.length > 12 || history.reduce((length, text) => length + text.length, 0) > 18000) history.splice(1, 1);
  return history;
}

export function conversationPrompt(history, measurements, editing) {
  const original = history[0];
  const changes = history.slice(1);
  return [
    'Create a professional landscaping and decorating design concept.',
    'Preserve the site architecture, camera angle, access routes and permanent structures in reference photos unless the client explicitly requests a change.',
    'Treat any dimensions mentioned in the brief as contextual guidance, not a certified scale drawing.',
    editing ? 'The first attached image is the selected design version to edit. Apply the latest request to that image while retaining earlier approved choices. Other attached photos provide additional site or style context.' : 'Use the attached photos as the site and design references for the client brief.',
    measurements ? `Additional site notes: ${measurements}.` : '',
    `Original client brief: ${original}`,
    ...changes.map((text, index) => `${index === changes.length - 1 ? 'Latest client request' : 'Earlier client request'}: ${text}`),
    'Do not include text, logos or watermarks; company branding will be applied separately.',
  ].filter(Boolean).join('\n\n');
}
