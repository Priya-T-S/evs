import { Capacitor } from "@capacitor/core";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";

const MAX_EDGE = 1600;

/**
 * Downscale to ≤1600 px and re-encode as JPEG (quality 0.8). Re-encoding through a canvas
 * drops all EXIF metadata (GPS, device, timestamps) on the device before upload; the server
 * strips metadata again on its side.
 */
export async function normalizePhoto(src: Blob): Promise<Blob> {
  let bitmap: ImageBitmap | HTMLImageElement;
  try {
    bitmap = await createImageBitmap(src, { imageOrientation: "from-image" });
  } catch {
    bitmap = await loadImage(src);
  }
  const w = bitmap.width;
  const h = bitmap.height;
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const g = canvas.getContext("2d");
  if (!g) return src;
  g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if ("close" in bitmap) bitmap.close();
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? src), "image/jpeg", 0.8));
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
}

export const isNative = () => Capacitor.isNativePlatform();

/** Native camera / gallery through Capacitor. On the web the UI uses a file input instead. */
export async function nativePhoto(source: "camera" | "gallery"): Promise<Blob | null> {
  try {
    const photo = await Camera.getPhoto({
      source: source === "camera" ? CameraSource.Camera : CameraSource.Photos,
      resultType: CameraResultType.Uri,
      quality: 80,
      width: MAX_EDGE,
      correctOrientation: true,
      saveToGallery: false,
    });
    if (!photo.webPath) return null;
    return await (await fetch(photo.webPath)).blob();
  } catch {
    return null; // user cancelled
  }
}
