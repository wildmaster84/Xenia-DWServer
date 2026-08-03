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
    w.string((meta?.title || '').slice(0, 0x40));
    w.i16(meta?.i16_1 || 0);
    w.string((meta?.description || '').slice(0, 0x80));
    w.string((meta?.extraText || '').slice(0, 0x180));
    w.i16(meta?.i16_2 || 0);
    // blob extra_data (max 0x200)
    const extra = meta?.extraData;
    if (extra && typeof extra === 'string') {
      w.blob(Buffer.from(extra, 'hex').subarray(0, 0x200));
    } else if (extra && Buffer.isBuffer(extra)) {
      w.blob(extra.subarray(0, 0x200));
    } else {
      w.blob(Buffer.alloc(0));
    }
    w.u32(meta?.u32Trailer || 0);
    // Pairs array: 0x6E + 0x08 + raw_u32(byteCount) + raw_u32(totalU64Count) + [0x0A + u64 + 0x0A + u64] * pairs
    const pairs = meta?.pairs || [];
    const totalU64Count = pairs.length * 2;
    const byteCount = 9 * totalU64Count;
    const header = Buffer.alloc(1 + 1 + 4 + 4);
    header[0] = 0x6e;
    header[1] = 0x08;
    header.writeUInt32LE(byteCount, 2);
    header.writeUInt32LE(totalU64Count, 6);
    w.raw(header);
    for (const p of pairs) {
      w.u64(BigInt(p[0]));
      w.u64(BigInt(p[1]));
    }
    w.u32(meta?.u32Trailer2 || 0);
    w.u64(BigInt('0x' + (meta?.u64Trailer || '0')));
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
          const xuidHex = conn.xuid.toString(16).padStart(16, '0');
          this.logger.log(`[EMBLEM SAVE] name='${name}' xuid=${xuidHex} slot=${i16_1} type=0x${u32_1.toString(16)} cat=${i16_2} blob=${blob.length}B`);
          await this.userFileRepo.write(xuidHex, name, Buffer.from(blob));
          this.logger.log(`[EMBLEM SAVED] name='${name}'`);
          conn.replyEmpty(op);
        } else {
          this.logger.log(`[CONTENT QUERY] unknown name='${name}' -> empty`);
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
        pairs: [],
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
      r.u32();  // start
      r.i16();  // capacity
      r.i16();  // field_d
      const category = r.i16();

      let resultsCount = 0;

      // Clips (category 0 = all, 1 = clips)
      if (category === 0 || category === 1) {
        const xuidHex = conn.xuid.toString(16).padStart(16, '0');
        const clips = await this.clipRepo.getByAuthor(xuidHex);
        for (const clip of clips) {
          this.writeClipResult(w, clip);
          resultsCount++;
        }
      }

      // Emblems (category 0 = all, 6 = emblems)
      // Emblems are stored in userFileRepo, not clipRepo.
      // Python server reads from user_file_list and returns using clip_write_clip_result (15-field).
      if (category === 0 || category === 6) {
        const xuidHex = conn.xuid.toString(16).padStart(16, '0');
        const userFiles = await this.userFileRepo.list(xuidHex);
        for (const f of userFiles) {
          if (!f.fileName.startsWith('Emblem')) continue;
          const slotMatch = f.fileName.match(/Emblem_(\d+)/);
          const slot = slotMatch ? parseInt(slotMatch[1], 10) : 0;
          const emblemMeta = {
            clipId: xuidHex,
            type: 6,
            category: 6,
            flag: 0,
            authorXuid: xuidHex,
            title: f.fileName,
            i16_1: slot,
            description: '',
            extraText: '',
            i16_2: 0,
            extraData: Buffer.alloc(0),
            u32Trailer: 0,
            pairs: [],
            u32Trailer2: 0,
            u64Trailer: '0',
          };
          this.writeClipResult(w, emblemMeta);
          resultsCount++;
        }
        this.logger.log(`emblem listing: ${resultsCount} emblems (category=${category})`);
      }

      conn.sendTaskReply(op, w.toBuffer(), resultsCount);
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
