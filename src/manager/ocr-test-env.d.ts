declare module "node:fs" {
  export function readFileSync(path: string): Uint8Array;
}

declare module "pngjs" {
  interface PngImage {
    width: number;
    height: number;
    data: Uint8Array;
  }
  export class PNG {
    width: number;
    height: number;
    data: Uint8Array;
    constructor(opts: { width: number; height: number });
    static sync: {
      read(buf: Uint8Array): PngImage;
      write(png: PngImage): Uint8Array;
    };
  }
}
