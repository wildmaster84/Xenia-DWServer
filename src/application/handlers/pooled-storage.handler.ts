import { Injectable, Logger } from '@nestjs/common';
import { BBWriter } from '../../core/bb-writer';
import { BBReader } from '../../core/bb-reader';
import { BD_NO_ERROR, BD_NO_FILE } from '../../core/bb-constants';
import { BBConnection } from '../../core/bb-connection';
import { ClipRepository } from '../../infrastructure/persistance/repositories/clip.repository';
import { UserFileRepository } from '../../infrastructure/persistance/repositories/user-file.repository';

@Injectable()
export class PooledStorageHandler {
  private readonly logger = new Logger('PooledStorageHandler');

  constructor(
    private clipRepo: ClipRepository,
    private userFileRepo: UserFileRepository,
  ) {}

  async handle(op: number, body: Buffer, conn: BBConnection): Promise<void> {
    const r = new BBReader(body);
    r.u8(); // skip op byte

    switch (op) {
      case 1:
        return this.createEntries(op, r, conn);
      case 2:
        return this.deleteEntries(op, r, conn);
      case 3:
        return this.readById(op, r, conn);
      case 5:
        return this.getFile(op, r, conn);
      case 6:
        return this.writeMetadata(op, r, conn);
      case 9:
        return this.getClipInfo(op, r, conn);
      case 17:
        return this.uploadData(op, r, conn);
      case 18:
        return this.noResults(op, conn);
      case 19:
        return this.query(op, r, conn);
      default:
        conn.replyEmpty(op);
        return;
    }
  }

  private writeClipResult(w: BBWriter, meta: any): void {
    w.u64(BigInt('0x' + (meta?.clipId || '0')));
    w.u32(meta?.type || 0);
    w.u32(meta?.category || 0);
    w.u32(meta?.flag || 0);
    w.u64(BigInt('0x' + (meta?.authorXuid || '0')));
    w.string(meta?.title || '');
    w.i16(meta?.i16_1 || 0);
    w.string(meta?.description || '');
    w.string(meta?.extraText || '');
    w.i16(meta?.i16_2 || 0);
    w.blob(meta?.extraData ? Buffer.from(meta.extraData, 'hex') : Buffer.alloc(0));
    w.u32(meta?.u32Trailer || 0);
    const pairs = meta?.pairs || [['3', '8']];
    w.u32(pairs.length);
    for (const p of pairs) {
      w.u64(BigInt(p[0]));
      w.u64(BigInt(p[1]));
    }
    w.u32(meta?.u32Trailer2 || 0);
    w.u64(BigInt('0x' + (meta?.u64Trailer || meta?.clipId || '0')));
  }

  private async createEntries(op: number, r: BBReader, conn: BBConnection): Promise<void> {
    const w = new BBWriter();
    try {
      const poolIds = r.u64Array();
      const xuidHex = conn.xuid.toString(16).padStart(16, '0');

      for (const poolId of poolIds) {
        const clipIdHex = poolId.toString(16).padStart(16, '0');
        let clip = await this.clipRepo.getById(clipIdHex);

        if (!clip) {
          await this.clipRepo.save({
            clipId: clipIdHex,
            type: 0,
            category: 0,
            authorXuid: xuidHex,
            title: '',
            description: '',
            pairs: [['3', '8']],
          });
          clip = await this.clipRepo.getById(clipIdHex);
        }

        this.writeClipResult(w, clip);
      }
      conn.sendTaskReply(op, w.toBuffer(), poolIds.length);
    } catch (err) {
      this.logger.error(`createEntries: ${err}`);
      conn.replyEmpty(op);
    }
  }

  private async deleteEntries(op: number, r: BBReader, conn: BBConnection): Promise<void> {
    const w = new BBWriter();
    try {
      const poolIds = r.u64Array();

      for (const poolId of poolIds) {
        const clipIdHex = poolId.toString(16).padStart(16, '0');
        await this.clipRepo.delete(clipIdHex);
      }
      conn.replyEmpty(op);
    } catch (err) {
      this.logger.error(`deleteEntries: ${err}`);
      conn.replyEmpty(op);
    }
  }

  private async readById(op: number, r: BBReader, conn: BBConnection): Promise<void> {
    const w = new BBWriter();
    try {
      const fileName = r.string();
      const xuidHex = conn.xuid.toString(16).padStart(16, '0');
      const data = await this.userFileRepo.read(xuidHex, fileName);

      if (data) {
        w.string(fileName);
        w.i16(0);
        w.string('');
        w.u64(conn.xuid);
        conn.sendTaskReply(op, w.toBuffer(), 1);
      } else {
        w.u32(BD_NO_FILE);
        conn.sendTaskReply(op, w.toBuffer(), 0, BD_NO_FILE);
      }
    } catch (err) {
      this.logger.error(`readById: ${err}`);
      conn.replyEmpty(op);
    }
  }

  private async getFile(op: number, r: BBReader, conn: BBConnection): Promise<void> {
    const w = new BBWriter();
    try {
      const fileName = r.string();
      const xuidHex = conn.xuid.toString(16).padStart(16, '0');
      const data = await this.userFileRepo.read(xuidHex, fileName);

      if (data) {
        w.string(fileName);
        w.i16(0);
        w.string('');
        w.u64(conn.xuid);
        conn.sendTaskReply(op, w.toBuffer(), 1);
      } else {
        w.u32(BD_NO_FILE);
        conn.sendTaskReply(op, w.toBuffer(), 0, BD_NO_FILE);
      }
    } catch (err) {
      this.logger.error(`getFile: ${err}`);
      conn.replyEmpty(op);
    }
  }

  private async writeMetadata(op: number, r: BBReader, conn: BBConnection): Promise<void> {
    try {
      const fileId = r.u64();
      const type = r.i16();
      const name = r.string();
      const size = r.u32();
    } catch (err) {
      this.logger.error(`writeMetadata: ${err}`);
    }
    conn.replyEmpty(op);
  }

  private async getClipInfo(op: number, r: BBReader, conn: BBConnection): Promise<void> {
    const w = new BBWriter();
    try {
      const clipId = r.u64();
      const clipIdHex = clipId.toString(16).padStart(16, '0');
      const clip = await this.clipRepo.getById(clipIdHex);

      if (clip) {
        this.writeClipResult(w, clip);
        conn.sendTaskReply(op, w.toBuffer(), 1);
      } else {
        w.u32(BD_NO_FILE);
        conn.sendTaskReply(op, w.toBuffer(), 0, BD_NO_FILE);
      }
    } catch (err) {
      this.logger.error(`getClipInfo: ${err}`);
      conn.replyEmpty(op);
    }
  }

  private async uploadData(op: number, r: BBReader, conn: BBConnection): Promise<void> {
    try {
      const fileId = r.u64();
      r.u32();
      const data = r.blob();

      const xuidHex = conn.xuid.toString(16).padStart(16, '0');
      const fileName = `pool_${fileId.toString(16).padStart(16, '0')}`;
      await this.userFileRepo.write(xuidHex, fileName, Buffer.from(data));

      const clipIdHex = fileId.toString(16).padStart(16, '0');
      await this.clipRepo.save({
        clipId: clipIdHex,
        type: 1,
        category: 1,
        authorXuid: xuidHex,
      });
    } catch (err) {
      this.logger.error(`uploadData: ${err}`);
    }
    conn.replyEmpty(op);
  }

  private async noResults(op: number, conn: BBConnection): Promise<void> {
    conn.replyEmpty(op);
  }

  private async query(op: number, r: BBReader, conn: BBConnection): Promise<void> {
    const w = new BBWriter();
    try {
      const fileId = r.u64();
      w.string('');
      w.u32(0);
      conn.sendTaskReply(op, w.toBuffer(), 1);
    } catch (err) {
      this.logger.error(`query: ${err}`);
      conn.replyEmpty(op);
    }
  }
}
