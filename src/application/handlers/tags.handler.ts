import { Injectable } from '@nestjs/common';
import { BBWriter } from '../../core/bb-writer';
import { BBReader } from '../../core/bb-reader';
import { BD_NO_ERROR } from '../../core/bb-constants';
import { BBConnection } from '../../core/bb-connection';
import { ClipRepository } from '../../infrastructure/persistance/repositories/clip.repository';

@Injectable()
export class TagsHandler {
  constructor(private clipRepo: ClipRepository) {}

  async handle(op: number, body: Buffer, conn: BBConnection): Promise<void> {
    const r = new BBReader(body);
    r.u8(); // skip op byte

    const w = new BBWriter();
    if (op === 5) {
      try {
        r.u32(); // type
        r.u32(); // parent_id
        const maxResults = r.u32();
        r.bool();

        const clips = await this.clipRepo.getAll();
        for (const clip of clips) {
          w.u64(BigInt('0x' + (clip.clipId || '0')));
        }
        conn.sendTaskReply(op, w.toBuffer(), clips.length);
      } catch {
        conn.replyEmpty(op);
      }
    } else {
      conn.replyEmpty(op);
    }
  }
}
