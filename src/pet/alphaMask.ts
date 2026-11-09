/**
 * Alpha mask of the rendered avatar, used for per-pixel hit testing.
 *
 * The mask is rasterized at the element's layout size in CSS px; `hitTest.ts`
 * scales lookups by the element's current bounding box.
 */
export class AlphaMask {
  private constructor(
    private readonly alpha: Uint8Array,
    readonly width: number,
    readonly height: number,
  ) {}

  /** Composites fully loaded layers (drawn in order, stretched to the size) into one mask. */
  static fromLayers(layers: CanvasImageSource[], width: number, height: number): AlphaMask | null {
    width = Math.round(width);
    height = Math.round(height);
    if (width === 0 || height === 0) return null;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    for (const layer of layers) ctx.drawImage(layer, 0, 0, width, height);
    const rgba = ctx.getImageData(0, 0, width, height).data;
    const alpha = new Uint8Array(width * height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
    return new AlphaMask(alpha, width, height);
  }

  isOpaque(x: number, y: number, threshold = 24): boolean {
    const px = Math.floor(x);
    const py = Math.floor(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return false;
    return this.alpha[py * this.width + px] >= threshold;
  }
}
