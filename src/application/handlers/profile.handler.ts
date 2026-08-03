import { Injectable, Logger } from '@nestjs/common';
import { BBWriter } from '../../core/bb-writer';
import { BBReader } from '../../core/bb-reader';
import { BD_NO_ERROR, BD_NO_FILE } from '../../core/bb-constants';
import { BBConnection } from '../../core/bb-connection';
import { UserFileRepository } from '../../infrastructure/persistance/repositories/user-file.repository';

@Injectable()
export class ProfileHandler {
  private readonly logger = new Logger('ProfileHandler');

  constructor(private userFileRepo: UserFileRepository) {}

  async handle(op: number, body: Buffer, conn: BBConnection): Promise<void> {
    const r = new BBReader(body);
    r.u8(); // skip op byte

    switch (op) {
      case 1:
        return this.getProfile(op, conn);
      case 3:
        return this.setProfile(op, r, conn);
      default:
        conn.replyEmpty(op);
        return;
    }
  }

  private async getProfile(op: number, conn: BBConnection): Promise<void> {
    const w = new BBWriter();
    const xuidHex = conn.xuid.toString(16).padStart(16, '0');
    const data = await this.userFileRepo.read(xuidHex, 'profile');

    if (data) {
      this.logger.log(`[GET PROFILE] xuid=${xuidHex} size=${data.length} hex=${data.subarray(0, Math.min(data.length, 64)).toString('hex')}`);
      w.u64(conn.xuid);
      w.i32(2);
      w.blob(data);
      conn.sendTaskReply(op, w.toBuffer(), 1);
    } else {
      this.logger.log(`[GET PROFILE] xuid=${xuidHex} NOT FOUND -> empty reply`);
      conn.replyEmpty(op);
    }
  }

  private async setProfile(op: number, r: BBReader, conn: BBConnection): Promise<void> {
    try {
      const ptype = r.i32();
      const data = r.blob();
      const xuidHex = conn.xuid.toString(16).padStart(16, '0');
      this.logger.log(`[SET PROFILE] xuid=${xuidHex} ptype=${ptype} size=${data.length} hex=${data.subarray(0, Math.min(data.length, 64)).toString('hex')}`);
      await this.userFileRepo.write(xuidHex, 'profile', Buffer.from(data));
      this.logger.log(`[SET PROFILE DONE] xuid=${xuidHex} size=${data.length}`);
    } catch (err) {
      this.logger.error(`setProfile: ${err}`);
    }
    conn.replyEmpty(op);
  }
}
