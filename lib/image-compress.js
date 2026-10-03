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
