import { AppError } from './store.js';

const mediaKey = /^(?:uploads\/[a-f0-9]{64}|designs\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.(png|jpg|webp)$/;
const contentTypes = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

/** Store files durably and serve them only behind createApp's media auth check. */
export function createMediaStorage(store) {
  if (typeof store?.putMedia !== 'function' || typeof store?.getMedia !== 'function') throw new Error('Durable image storage is not configured.');
  return {
    async put(key, bytes, contentType) {
      const match = typeof key === 'string' && mediaKey.exec(key);
      if (!match || contentTypes[match[1]] !== contentType) throw new AppError('Use a supported image name and type.');
      if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 8 * 1024 * 1024) throw new AppError('Images must be between 1 byte and 8 MB.');
      await store.putMedia(key, bytes, contentType);
      return `/media/${key}`;
    },
    async serve(req, res, next) {
      try {
        if (!['GET', 'HEAD'].includes(req.method)) { res.set('Allow', 'GET, HEAD'); throw new AppError('Use GET to open an image.', 405); }
        const key = req.path.slice(1);
        const match = mediaKey.exec(key);
        if (!match) throw new AppError('Image not found.', 404);
        const image = await store.getMedia(key);
        if (!image || image.contentType !== contentTypes[match[1]] || !Buffer.isBuffer(image.bytes)) throw new AppError('Image not found.', 404);
        res.set('Cache-Control', 'private, max-age=31536000, immutable').type(image.contentType).send(image.bytes);
      } catch (error) { next(error); }
    },
  };
}
