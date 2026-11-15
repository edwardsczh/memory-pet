/** Turn bubble colors into black text on white so a local recognizer can see them. */
const TEXT_LUMINANCE = 160;

export function prepareRgba(data: Uint8Array | Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const v = y < TEXT_LUMINANCE ? 0 : 255;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
}
