// A photo is sent small: it costs less and shows enough. It is never stored.
const PHOTO_SIZE = 1280;

export function shrink(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('photo'));
    };
    image.onload = () => {
      const scale = Math.min(1, PHOTO_SIZE / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.8).split(',')[1]);
    };
    image.src = url;
  });
}

export const imageBlock = (data) => ({
  type: 'image',
  source: { type: 'base64', media_type: 'image/jpeg', data },
});
