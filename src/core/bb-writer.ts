import { TAG } from './bb-constants';

/**
 * Little-endian tagged binary writer matching BO2's bdByteBuffer.
 * Every value is prefixed with a 1-byte type tag.
 */
export class BBWriter {
  private bufs: Buffer[] = [];

  get length(): number {
    return this.bufs.reduce((n, b) => n + b.length, 0);
  }

  raw(data: Buffer): this {
    this.bufs.push(Buffer.from(data));
    return this;
  }

  u8(v: number): this {
    this.bufs.push(Buffer.from([TAG.U8, v & 0xff]));
    return this;
  }

  bool(v: boolean): this {
    this.bufs.push(Buffer.from([TAG.BOOL, v ? 1 : 0]));
    return this;
  }

  i16(v: number): this {
    const b = Buffer.alloc(3);
    b[0] = TAG.I16;
    b.writeInt16LE(v, 1);
    this.bufs.push(b);
    return this;
  }

  i32(v: number): this {
    const b = Buffer.alloc(5);
    b[0] = TAG.I32;
    b.writeInt32LE(v, 1);
    this.bufs.push(b);
    return this;
  }

  u32(v: number): this {
    const b = Buffer.alloc(5);
    b[0] = TAG.U32;
    b.writeUInt32LE(v >>> 0, 1);
    this.bufs.push(b);
    return this;
  }

  i64(v: bigint): this {
    const b = Buffer.alloc(9);
    b[0] = TAG.I64;
    b.writeBigInt64LE(v, 1);
    this.bufs.push(b);
    return this;
  }

  u64(v: bigint): this {
    const b = Buffer.alloc(9);
    b[0] = TAG.U64;
    b.writeBigUInt64LE(v & 0xffffffffffffffffn, 1);
    this.bufs.push(b);
    return this;
  }

  f32(v: number): this {
    const b = Buffer.alloc(5);
    b[0] = TAG.FLOAT;
    b.writeFloatLE(v, 1);
    this.bufs.push(b);
    return this;
  }

  string(s: string): this {
    const encoded = Buffer.from(s, 'ascii');
    this.bufs.push(Buffer.from([TAG.STRING]), encoded, Buffer.from([0x00]));
    return this;
  }

  blob(data: Buffer): this {
    const lenBuf = Buffer.alloc(6);
    lenBuf[0] = TAG.BLOB;
    lenBuf[1] = TAG.U32;
    lenBuf.writeUInt32LE(data.length, 2);
    this.bufs.push(lenBuf, Buffer.from(data));
    return this;
  }

  /** Write a u32 array with the 0x6C marker.
   *  Response format (traced from assembly sub_8286A058):
   *  0x6C + TAG_U32(byteCount) + TAG_U32(count) + TAG_U32(gid1) + TAG_U32(gid2) + ...
   *  All values are tagged u32s (0x08 prefix), NOT raw u32s.
   */
  u32Array(values: number[]): this {
    const count = values.length;
    // Each value is a tagged u32: 0x08 + 4 bytes = 5 bytes
    const body = Buffer.allocUnsafe(count * 5);
    for (let i = 0; i < count; i++) {
      body[i * 5] = TAG.U32; // 0x08
      body.writeUInt32LE(values[i] >>> 0, i * 5 + 1);
    }
    // 0x6C + TAG_U32 + u32(byteCount) + TAG_U32 + u32(count) + tagged u32 values
    const header = Buffer.alloc(11);
    header[0] = TAG.U32_ARRAY; // 0x6C
    header[1] = TAG.U32;       // 0x08 (byte count tag)
    header.writeUInt32LE(count * 5, 2); // byte count value (tagged data size)
    header[6] = TAG.U32;       // 0x08 (element count tag)
    header.writeUInt32LE(count, 7);     // element count value
    this.bufs.push(header, body);
    return this;
  }

  /** Write a u64 array with the 0x6E array marker. */
  u64Array(values: bigint[]): this {
    // Array header: 0x6E + TAG_U32 + u32(byte_count) + raw u32 count
    const count = values.length;
    const body = Buffer.allocUnsafe(count * 8);
    for (let i = 0; i < count; i++) {
      body.writeBigUInt64LE(values[i] & 0xffffffffffffffffn, i * 8);
    }
    const header = Buffer.alloc(6);
    header[0] = TAG.ARRAY;
    header[1] = TAG.U32;
    header.writeUInt32LE(count * 8 + 4, 2); // byte_count includes the count u32 itself
    const countBuf = Buffer.allocUnsafe(4);
    countBuf.writeUInt32LE(count, 0);
    this.bufs.push(header, countBuf, body);
    return this;
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.bufs);
  }
}
