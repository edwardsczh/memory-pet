/**
 * Alpha mask of the rendered avatar, used for per-pixel hit testing.
 *
 * The mask is rasterized at the image's on-screen CSS size, so lookups take
 * coordinates relative to the image element's bounding box.
 */
export class AlphaMask {
  private constructor(
    private readonly data: Uint8ClampedArray,
    private readonly width: number,
    private readonly height: number,
  ) {}

  static fromImage(img: HTMLImageElement): AlphaMask | null {
    const width = Math.round(img.clientWidth);
    const height = Math.round(img.clientHeight);
    if (!img.complete || width === 0 || height === 0) return null;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, width, height);
    return new AlphaMask(ctx.getImageData(0, 0, width, height).data, width, height);
  }

  isOpaque(x: number, y: number, threshold = 24): boolean {
    const px = Math.floor(x);
    const py = Math.floor(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return false;
    return this.data[(py * this.width + px) * 4 + 3] >= threshold;
  }
}
