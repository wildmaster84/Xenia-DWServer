/**
 * LSB-first bit reader for LSG hello/auth proof parsing.
 * Ported from Python BitReader.
 */
export class BitReader {
  private data: Buffer;
  private bit = 0;

  constructor(data: Buffer) {
    this.data = data;
  }

  read(bits: number): Buffer {
    const out = Buffer.alloc((bits + 7) >> 3);
    let cur = this.bit >> 3;
    let oi = 0;
    let left = bits;
    while (left > 0) {
      const n = Math.min(left, 8);
      const b = cur < this.data.length ? this.data[cur] : 0;
      const rem = this.bit & 7;
      if (n + rem <= 8) {
        out[oi] = (0xff >> (8 - n)) & (b >> rem);
      } else {
        const nxt = cur + 1 < this.data.length ? this.data[cur + 1] : 0;
        out[oi] = ((0xff >> (8 - n)) & ((nxt << (8 - rem)) | (b >> rem))) & 0xff;
      }
      oi++;
      this.bit += n;
      cur = this.bit >> 3;
      left -= n;
    }
    return out;
  }

  bits(n: number): number {
    return n <= 8 ? this.read(n)[0] : 0;
  }

  u32(): number {
    return this.read(32).readUInt32LE(0);
  }

  take(nbytes: number): Buffer {
    return this.read(nbytes * 8);
  }
}
