import { TAG } from './bb-constants';

/**
 * Little-endian tagged binary writer matching BO2's bdByteBuffer.
 * Every value is prefixed with a 1-byte type tag.
 * Uses a single growable buffer instead of many small allocations.
 */
export class BBWriter {
  private buf: Buffer = Buffer.allocUnsafe(256);
  private len = 0;

  get length(): number {
    return this.len;
  }

  private ensure(n: number): void {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.len + n) cap *= 2;
    const grown = Buffer.allocUnsafe(cap);
    this.buf.copy(grown, 0, 0, this.len);
    this.buf = grown;
  }

  raw(data: Buffer): this {
    this.ensure(data.length);
    data.copy(this.buf, this.len);
    this.len += data.length;
    return this;
  }

  u8(v: number): this {
    this.ensure(2);
    this.buf[this.len] = TAG.U8;
    this.buf[this.len + 1] = v & 0xff;
    this.len += 2;
    return this;
  }

  bool(v: boolean): this {
    this.ensure(2);
    this.buf[this.len] = TAG.BOOL;
    this.buf[this.len + 1] = v ? 1 : 0;
    this.len += 2;
    return this;
  }

  i16(v: number): this {
    this.ensure(3);
    this.buf[this.len] = TAG.I16;
    this.buf.writeInt16LE(v, this.len + 1);
    this.len += 3;
    return this;
  }

  i32(v: number): this {
    this.ensure(5);
    this.buf[this.len] = TAG.I32;
    this.buf.writeInt32LE(v, this.len + 1);
    this.len += 5;
    return this;
  }

  u32(v: number): this {
    this.ensure(5);
    this.buf[this.len] = TAG.U32;
    this.buf.writeUInt32LE(v >>> 0, this.len + 1);
    this.len += 5;
    return this;
  }

  i64(v: bigint): this {
    this.ensure(9);
    this.buf[this.len] = TAG.I64;
    this.buf.writeBigInt64LE(v, this.len + 1);
    this.len += 9;
    return this;
  }

  u64(v: bigint): this {
    this.ensure(9);
    this.buf[this.len] = TAG.U64;
    this.buf.writeBigUInt64LE(v & 0xffffffffffffffffn, this.len + 1);
    this.len += 9;
    return this;
  }

  f32(v: number): this {
    this.ensure(5);
    this.buf[this.len] = TAG.FLOAT;
    this.buf.writeFloatLE(v, this.len + 1);
    this.len += 5;
    return this;
  }

  string(s: string): this {
    const encoded = Buffer.from(s, 'ascii');
    this.ensure(1 + encoded.length + 1);
    this.buf[this.len] = TAG.STRING;
    encoded.copy(this.buf, this.len + 1);
    this.len += 1 + encoded.length;
    this.buf[this.len++] = 0x00;
    return this;
  }

  blob(data: Buffer): this {
    this.ensure(6 + data.length);
    this.buf[this.len] = TAG.BLOB;
    this.buf[this.len + 1] = TAG.U32;
    this.buf.writeUInt32LE(data.length, this.len + 2);
    this.len += 6;
    data.copy(this.buf, this.len);
    this.len += data.length;
    return this;
  }

  /** Write a u32 array with the 0x6C marker.
   *  Response format (traced from assembly sub_8286A058):
   *  0x6C + TAG_U32(byteCount) + TAG_U32(count) + TAG_U32(gid1) + TAG_U32(gid2) + ...
   *  All values are tagged u32s (0x08 prefix), NOT raw u32s.
   */
  u32Array(values: number[]): this {
    const count = values.length;
    const bodySize = count * 5;
    this.ensure(11 + bodySize);
    this.buf[this.len] = TAG.U32_ARRAY; // 0x6C
    this.buf[this.len + 1] = TAG.U32;   // 0x08 (byte count tag)
    this.buf.writeUInt32LE(bodySize, this.len + 2);
    this.buf[this.len + 6] = TAG.U32;   // 0x08 (element count tag)
    this.buf.writeUInt32LE(count, this.len + 7);
    this.len += 11;
    for (let i = 0; i < count; i++) {
      this.buf[this.len] = TAG.U32;
      this.buf.writeUInt32LE(values[i] >>> 0, this.len + 1);
      this.len += 5;
    }
    return this;
  }

  /** Write a u64 array with the 0x6E array marker. */
  u64Array(values: bigint[]): this {
    const count = values.length;
    const bodySize = count * 8;
    this.ensure(10 + bodySize);
    this.buf[this.len] = TAG.ARRAY;     // 0x6E
    this.buf[this.len + 1] = TAG.U32;   // 0x08
    this.buf.writeUInt32LE(bodySize + 4, this.len + 2); // byte_count includes count u32
    this.len += 6;
    this.buf.writeUInt32LE(count, this.len);
    this.len += 4;
    for (let i = 0; i < count; i++) {
      this.buf.writeBigUInt64LE(values[i] & 0xffffffffffffffffn, this.len);
      this.len += 8;
    }
    return this;
  }

  toBuffer(): Buffer {
    // Return a copy to match original behavior (Buffer.concat returned new buffer)
    return Buffer.from(this.buf.subarray(0, this.len));
  }
}
