import { TAG } from './bb-constants';

/**
 * Tagged binary reader matching BO2's bdByteBuffer.
 * Tolerant — used to parse incoming requests.
 */
export class BBReader {
  private data: Buffer;
  private pos = 0;

  constructor(data: Buffer) {
    this.data = data;
  }

  get remaining(): number {
    return this.data.length - this.pos;
  }

  peekTag(): number {
    return this.pos < this.data.length ? this.data[this.pos] : -1;
  }

  private take(n: number): Buffer {
    if (this.pos + n > this.data.length) {
      throw new Error(`read past end (need ${n} at ${this.pos}, have ${this.data.length})`);
    }
    const out = this.data.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  private expectTag(tag: number): void {
    const t = this.take(1)[0];
    if (t !== tag) {
      throw new Error(`tag ${t} != expected ${tag} at pos ${this.pos - 1}`);
    }
  }

  u8(): number {
    this.expectTag(TAG.U8);
    return this.take(1)[0];
  }

  bool(): boolean {
    this.expectTag(TAG.BOOL);
    return this.take(1)[0] !== 0;
  }

  i16(): number {
    this.expectTag(TAG.I16);
    return this.take(2).readInt16LE(0);
  }

  i32(): number {
    this.expectTag(TAG.I32);
    return this.take(4).readInt32LE(0);
  }

  u32(): number {
    this.expectTag(TAG.U32);
    return this.take(4).readUInt32LE(0);
  }

  i64(): bigint {
    this.expectTag(TAG.I64);
    return this.take(8).readBigInt64LE(0);
  }

  u64(): bigint {
    this.expectTag(TAG.U64);
    return this.take(8).readBigUInt64LE(0);
  }

  f32(): number {
    this.expectTag(TAG.FLOAT);
    return this.take(4).readFloatLE(0);
  }

  string(): string {
    this.expectTag(TAG.STRING);
    let end = this.data.indexOf(0x00, this.pos);
    if (end === -1) end = this.data.length;
    const s = this.data.subarray(this.pos, end).toString('ascii');
    this.pos = end + 1;
    return s;
  }

  blob(): Buffer {
    this.expectTag(TAG.BLOB);
    const len = this.u32();
    return this.take(len);
  }

  /** Read a raw blob without tag check (for embedded blob sizes). */
  raw(n: number): Buffer {
    return this.take(n);
  }

  /** Skip the current tag byte without reading a value. */
  skipTag(): number {
    return this.take(1)[0];
  }

  /** Read a u64 array (0x6E marker). Returns array of bigint. */
  u64Array(): bigint[] {
    this.expectTag(TAG.ARRAY);
    const byteCount = this.u32();
    const count = this.take(4).readUInt32LE(0);
    const result: bigint[] = [];
    for (let i = 0; i < count; i++) {
      result.push(this.take(8).readBigUInt64LE(0));
    }
    return result;
  }

  /** Read a u32 array (0x6E or 0x6C marker). */
  u32Array(): number[] {
    const tag = this.peekTag();
    if (tag === TAG.U32_ARRAY) {
      // 0x6C: raw u32 array — tag + tagged_u32(byteCount) + raw_u32(count) + raw u32 values
      this.take(1); // consume 0x6C
      this.u32(); // byteCount (tagged, consumed but not needed)
      const count = this.take(4).readUInt32LE(0);
      const result: number[] = [];
      for (let i = 0; i < count; i++) {
        result.push(this.take(4).readUInt32LE(0));
      }
      return result;
    }
    // 0x6E: standard array marker
    this.expectTag(TAG.ARRAY);
    const byteCount = this.u32();
    const count = this.take(4).readUInt32LE(0);
    const result: number[] = [];
    for (let i = 0; i < count; i++) {
      result.push(this.take(4).readUInt32LE(0));
    }
    return result;
  }
}
