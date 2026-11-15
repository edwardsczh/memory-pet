/** A file the drop zone can see without opening it. */
export interface NamedFile {
  name: string;
  type: string;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i;
const SCREENSHOT_EXT = /\.(png|jpe?g|webp)$/i;

export function isImageFile(file: NamedFile): boolean {
  return file.type.startsWith("image/") || IMAGE_EXT.test(file.name);
}

/** png, jpg, and webp are the screenshots this build can read. */
export function isScreenshotFile(file: NamedFile): boolean {
  const type = file.type.toLowerCase();
  return (
    type === "image/png" ||
    type === "image/jpeg" ||
    type === "image/webp" ||
    SCREENSHOT_EXT.test(file.name)
  );
}

export interface ScreenshotDrop {
  images: { name: string }[];
  ignored: string[];
}

/** Split a drop into screenshots this build can read, and everything else. */
export function acceptScreenshotDrop(files: NamedFile[]): ScreenshotDrop {
  const images: { name: string }[] = [];
  const ignored: string[] = [];
  for (const file of files) {
    if (isScreenshotFile(file)) images.push({ name: file.name });
    else ignored.push(file.name);
  }
  return { images, ignored };
}
