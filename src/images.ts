/** Prepare photos before upload so mobile connections and serverless requests stay small. */
export type ImageOptions = {
  maxDimension?: number;
  maxBytes?: number;
  preserveTransparency?: boolean;
};

const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_INPUT_BYTES = 20 * 1024 * 1024;

export function dataUrlByteLength(source: string): number {
  if (!/^data:image\/(?:png|jpeg|webp);base64,/.test(source)) return 0;
  const content = source.slice(source.indexOf(',') + 1);
  return Math.max(0, Math.floor(content.length * 3 / 4) - (content.endsWith('==') ? 2 : content.endsWith('=') ? 1 : 0));
}

async function asDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('This photo could not be prepared. Please try another image.'));
    reader.readAsDataURL(blob);
  });
}

export async function prepareImage(file: File, options: ImageOptions = {}): Promise<string> {
  if (!imageTypes.has(file.type)) throw new Error('Choose a JPG, PNG, or WebP image.');
  if (!file.size || file.size > MAX_INPUT_BYTES) throw new Error('Choose an image smaller than 20 MB.');
  const maxDimension = Math.max(128, Math.min(2560, Math.floor(options.maxDimension || 1600)));
  const maxBytes = Math.max(16 * 1024, Math.min(1500 * 1024, options.maxBytes || 600 * 1024));
  const url = URL.createObjectURL(file);
  let image: HTMLImageElement;
  try {
    image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('That image could not be opened. Please try another photo.'));
      element.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('That image has no readable dimensions.');
    if (file.size <= maxBytes && Math.max(image.naturalWidth, image.naturalHeight) <= maxDimension) return await asDataURL(file);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser could not prepare this photo.');
    let ratio = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const mime = options.preserveTransparency ? 'image/webp' : 'image/jpeg';
    for (let resize = 0; resize < 9; resize++) {
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      if (!options.preserveTransparency) {
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.88, 0.78, 0.68]) {
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, mime, quality));
        if (!blob) throw new Error('Your browser could not prepare this photo.');
        if (blob.size <= maxBytes) return await asDataURL(blob);
      }
      ratio *= 0.8;
    }
    throw new Error('This image is still too large. Try a smaller photo.');
  } finally {
    URL.revokeObjectURL(url);
  }
}
