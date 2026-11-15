/** A file the drop zone can see without opening it. Bytes are never read. */
export interface NamedFile {
  name: string;
  type: string;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i;

export const SCREENSHOT_UNREAD =
  "这个版本还不能读取图片里的文字，没有从截图里抽出任何句子。你可以先写一段提示来创建角色。";

export function isImageFile(file: NamedFile): boolean {
  return file.type.startsWith("image/") || IMAGE_EXT.test(file.name);
}

export interface ScreenshotDrop {
  images: { name: string }[];
  /** Set when at least one image was accepted. It never includes extracted lines. */
  message: string | null;
  ignored: string[];
}

/** Accepts images for the local drop zone and records only their names. */
export function acceptScreenshotDrop(files: NamedFile[]): ScreenshotDrop {
  const images: { name: string }[] = [];
  const ignored: string[] = [];
  for (const file of files) {
    if (isImageFile(file)) images.push({ name: file.name });
    else ignored.push(file.name);
  }
  return {
    images,
    message: images.length > 0 ? SCREENSHOT_UNREAD : null,
    ignored,
  };
}
