import { Injectable, Logger } from '@nestjs/common';
import { BBWriter } from '../../core/bb-writer';
import { BBReader } from '../../core/bb-reader';
import { BD_NO_ERROR, BD_NO_FILE } from '../../core/bb-constants';
import { BBConnection } from '../../core/bb-connection';
import { ClipRepository } from '../../infrastructure/persistance/repositories/clip.repository';
import { UserFileRepository } from '../../infrastructure/persistance/repositories/user-file.repository';

@Injectable()
export class ContentStreamingHandler {
  private readonly logger = new Logger('ContentStreamingHandler');

  constructor(
    private clipRepo: ClipRepository,
    private userFileRepo: UserFileRepository,
  ) {}

  async handle(op: number, body: Buffer, conn: BBConnection): Promise<void> {
    const r = new BBReader(body);
    r.u8(); // skip op byte

    switch (op) {
      case 1:
      case 2:
        return this.getClipById(op, r, conn);
      case 3:
        return this.queryClips(op, conn);
      case 4:
      case 5:
      case 6:
        return this.contentQuery(op, r, conn);
      case 7:
        return this.uploadClip(op, r, conn);
      case 8:
        return this.listClips(op, conn);
      case 9:
        return this.deleteClip(op, r, conn);
      case 14:
        return this.subscribeToContentStream(op, r, conn);
      case 20:
      case 21:
        return this.queryClipsWithFilter(op, r, conn);
      default:
        conn.replyEmpty(op);
        return;
    }
  }

  private writeCSResult(w: BBWriter, meta: any): void {
    w.string(meta?.extraText || meta?.title || '');
    w.i16(meta?.i16_1 || 0);
    w.string(meta?.description || '');
    w.u64(BigInt('0x' + (meta?.clipId || '0')));
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

  private async getClipById(op: number, r: BBReader, conn: BBConnection): Promise<void> {
    const w = new BBWriter();
    try {
      let clipId: bigint;
      if (r.peekTag() === 0x08) {
        clipId = BigInt(r.u32());
      } else {
        clipId = r.u64();
      }
      const clipIdHex = clipId.toString(16).padStart(16, '0');
      const clip = await this.clipRepo.getById(clipIdHex);

      if (clip) {
        this.writeCSResult(w, clip);
        conn.sendTaskReply(op, w.toBuffer(), 1);
      } else {
        w.u32(BD_NO_FILE);
        conn.sendTaskReply(op, w.toBuffer(), 0, BD_NO_FILE);
      }
    } catch (err) {
      this.logger.error(`getClipById: ${err}`);
      conn.replyEmpty(op);
    }
  }

  private async queryClips(op: number, conn: BBConnection): Promise<void> {
    const w = new BBWriter();
    try {
      const xuidHex = conn.xuid.toString(16).padStart(16, '0');
      const clips = await this.clipRepo.getByAuthor(xuidHex);

      for (const clip of clips) {
        this.writeCSResult(w, clip);
      }
      conn.sendTaskReply(op, w.toBuffer(), clips.length);
    } catch (err) {
      this.logger.error(`queryClips: ${err}`);
      conn.replyEmpty(op);
    }
  }

  private async contentQuery(op: number, r: BBReader, conn: BBConnection): Promise<void> {
    const w = new BBWriter();
    try {
      const tag = r.peekTag();

      if (tag === 0x6e) {
        // Array of clip IDs → return results
        const clipIds = r.u64Array();
        let found = 0;
        for (const cid of clipIds) {
          const clipIdHex = cid.toString(16).padStart(16, '0');
          const clip = await this.clipRepo.getById(clipIdHex);
          if (clip) {
            this.writeCSResult(w, clip);
            found++;
          }
        }
        conn.sendTaskReply(op, w.toBuffer(), found);
      } else if (tag === 0x10) {
        // Content query (emblems, screenshots, etc.)
        // Format: string name, i16, u32, i16, blob, string
        const name = r.string();
        const i16_1 = r.peekTag() === 0x06 ? r.i16() : 0;
        const u32_1 = r.peekTag() === 0x08 ? r.u32() : 0;
        const i16_2 = r.peekTag() === 0x06 ? r.i16() : 0;
        const blob = r.peekTag() === 0x13 ? r.blob() : Buffer.alloc(0);
        const str2 = r.peekTag() === 0x10 ? r.string() : '';

        if (name.startsWith('Emblem')) {
          // Save emblem data + metadata to MongoDB
          const xuidHex = conn.xuid.toString(16).padStart(16, '0');
          await this.userFileRepo.write(xuidHex, name, Buffer.from(blob));
          // Reply empty (metadata-only for op=5)
          conn.replyEmpty(op);
        } else {
          conn.replyEmpty(op);
        }
      } else {
        conn.replyEmpty(op);
      }
    } catch (err) {
      this.logger.error(`contentQuery: ${err}`);
      conn.replyEmpty(op);
    }
  }

  private async uploadClip(op: number, r: BBReader, conn: BBConnection): Promise<void> {
    try {
      const clipId = r.u64();
      const type = r.u32();
      const title = r.blob().toString('ascii').replace(/\0+$/, '');
      const desc = r.blob().toString('ascii').replace(/\0+$/, '');
      r.bool();
      const category = r.u32();
      const extra = r.blob();
      const clipData = r.blob();

      const clipIdHex = clipId.toString(16).padStart(16, '0');
      const xuidHex = conn.xuid.toString(16).padStart(16, '0');

      await this.clipRepo.save({
        clipId: clipIdHex,
        type,
        category,
        authorXuid: xuidHex,
        title,
        description: desc,
        extraData: Buffer.from(extra),
        clipData: Buffer.from(clipData),
        pairs: [['3', '8']],
      });
    } catch (err) {
      this.logger.error(`uploadClip: ${err}`);
    }
    conn.replyEmpty(op);
  }

  private async listClips(op: number, conn: BBConnection): Promise<void> {
    const w = new BBWriter();
    try {
      const clips = await this.clipRepo.getAll();
      for (const clip of clips) {
        this.writeCSResult(w, clip);
      }
      conn.sendTaskReply(op, w.toBuffer(), clips.length);
    } catch (err) {
      this.logger.error(`listClips: ${err}`);
      conn.replyEmpty(op);
    }
  }

  private async deleteClip(op: number, r: BBReader, conn: BBConnection): Promise<void> {
    try {
      const clipId = r.u64();
      const clipIdHex = clipId.toString(16).padStart(16, '0');
      await this.clipRepo.delete(clipIdHex);
    } catch (err) {
      this.logger.error(`deleteClip: ${err}`);
    }
    conn.replyEmpty(op);
  }

  private async subscribeToContentStream(op: number, r: BBReader, conn: BBConnection): Promise<void> {
    const w = new BBWriter();
    try {
      const xuids = r.u64Array();
      r.u32();
      r.i16();
      r.i16();
      const category = r.i16();

      const clips = await this.clipRepo.getByCategory(category);
      const emblems = category === 6 ? await this.clipRepo.getByCategory(0) : [];
      const allResults = [...clips, ...emblems];

      for (const clip of allResults) {
        this.writeClipResult(w, clip);
      }
      conn.sendTaskReply(op, w.toBuffer(), allResults.length);
    } catch (err) {
      this.logger.error(`subscribeToContentStream: ${err}`);
      conn.replyEmpty(op);
    }
  }

  private async queryClipsWithFilter(op: number, r: BBReader, conn: BBConnection): Promise<void> {
    const w = new BBWriter();
    try {
      let category = -1;
      if (r.remaining > 0 && r.peekTag() === 0x08) {
        category = r.u32();
      }

      const clips = category >= 0
        ? await this.clipRepo.getByCategory(category)
        : await this.clipRepo.getAll();

      for (const clip of clips) {
        this.writeCSResult(w, clip);
      }
      conn.sendTaskReply(op, w.toBuffer(), clips.length);
    } catch (err) {
      this.logger.error(`queryClipsWithFilter: ${err}`);
      conn.replyEmpty(op);
    }
  }
}
