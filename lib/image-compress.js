// Resize a phone photo to max 1600px and re-encode as JPEG (3-8 MB originals are slow on site signal).
// Browser only. Shared by Progress Photos and expense receipts.
export async function compressImage(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.82));
  return new File([blob], `${(file.name || 'photo').replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' });
}

// Company logo: any image the browser can open (PNG, JPG, WebP, SVG, GIF, AVIF, BMP) -> a PNG the
// PDF renderer accepts. Transparency is kept. Longest side 1200px (photos are never enlarged,
// vector files are drawn at 1200); steps down in size until the file is under 1 MB.
// `crop` (optional) = { x, y, w, h } as fractions of the image: only that part is kept.
export async function toLogoPng(file, crop) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('This file is not an image the browser can open')); i.src = url; });
    const W = img.naturalWidth || 1200, H = img.naturalHeight || 1200;
    const c0 = crop || { x: 0, y: 0, w: 1, h: 1 };
    const w0 = W * c0.w, h0 = H * c0.h;
    const vector = file.type === 'image/svg+xml';
    for (const max of [1200, 800, 500, 300]) {
      const k = max / Math.max(w0, h0), scale = vector ? k : Math.min(1, k);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w0 * scale)); c.height = Math.max(1, Math.round(h0 * scale));
      c.getContext('2d').drawImage(img, W * c0.x, H * c0.y, w0, h0, 0, 0, c.width, c.height);
      const blob = await new Promise(res => c.toBlob(res, 'image/png'));
      if (blob && blob.size <= 1024 * 1024) return { file: new File([blob], 'logo.png', { type: 'image/png' }), width: c.width, height: c.height };
    }
    throw new Error('This image is too detailed to store as a logo; use a simpler or smaller file');
  } finally { URL.revokeObjectURL(url); }
}
