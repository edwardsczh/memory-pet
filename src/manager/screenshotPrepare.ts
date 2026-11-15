import { prepareRgba } from "./screenshotImage";

/** Decode a png, jpg, or webp in the webview and hand the recognizer a high-contrast PNG. */
export async function prepareScreenshotFile(
  file: Blob,
): Promise<{ bytes: Uint8Array; width: number }> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("无法读取这张图片");
    ctx.drawImage(bitmap, 0, 0);
    const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    prepareRgba(image.data);
    ctx.putImageData(image, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (next) => (next ? resolve(next) : reject(new Error("无法读取这张图片"))),
        "image/png",
      );
    });
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width: bitmap.width };
  } finally {
    bitmap.close();
  }
}
