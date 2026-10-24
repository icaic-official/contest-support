import { crc32, deflateSync } from "node:zlib";

export type Pixel = readonly [number, number, number, number];

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length);
  head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])));
  return Buffer.concat([head, data, tail]);
}

/** A real PNG that a browser can decode. `pixel` gives the RGBA color of each point. */
export function png(
  width: number,
  height: number,
  pixel: (x: number, y: number) => Pixel,
): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const start = y * (width * 4 + 1);
    for (let x = 0; x < width; x++) rows.set(pixel(x, y), start + 1 + x * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export const red: Pixel = [220, 30, 30, 255];
export const blue: Pixel = [30, 30, 220, 255];
export const green: Pixel = [30, 160, 60, 255];

/** A picture with the left half red and the right half blue. */
export function leftRedRightBlue(width: number, height: number): Buffer {
  return png(width, height, (x) => (x < width / 2 ? red : blue));
}

/** A picture of one color, such as a profile picture in a fixture. */
export function solid(width: number, height: number, color: Pixel): Buffer {
  return png(width, height, () => color);
}
