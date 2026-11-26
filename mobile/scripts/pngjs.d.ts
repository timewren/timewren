declare module 'pngjs' {
  import type { Buffer } from 'node:buffer';

  type Image = { width: number; height: number; data: Buffer };

  export const PNG: {
    new (options: Pick<Image, 'width' | 'height'>): Image;
    sync: {
      read: (buffer: Buffer) => Image;
      write: (image: Image) => Buffer;
    };
  };
}
