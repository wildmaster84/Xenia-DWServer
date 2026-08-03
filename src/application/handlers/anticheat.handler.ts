import { Injectable, Logger } from '@nestjs/common';
import { BBWriter } from '../../core/bb-writer';
import { BBReader } from '../../core/bb-reader';
import { BD_NO_ERROR } from '../../core/bb-constants';
import { BBConnection } from '../../core/bb-connection';

@Injectable()
export class AntiCheatHandler {
  private readonly logger = new Logger('AntiCheatHandler');

  handle(op: number, body: Buffer, conn: BBConnection): void {
    const r = new BBReader(body);
    r.u8(); // skip op byte
    if (op === 4) {
      try {
        const fa00mac = r.blob(); // 8-byte blob: fa00 + 6-byte MAC
        r.u32();
        r.u32();
        r.u64();
        r.u64();
        const consoleId = r.u64();
        const rawMac = r.blob(); // 6-byte raw MAC

        if (rawMac.length >= 6) {
          conn.player.macAddress = Buffer.from(rawMac.subarray(0, 6));
          const mac = conn.player.macAddress;
          conn.player.macAddressStr = `${mac[0].toString(16).padStart(2,'0')}${mac[1].toString(16).padStart(2,'0')}${mac[2].toString(16).padStart(2,'0')}${mac[3].toString(16).padStart(2,'0')}${mac[4].toString(16).padStart(2,'0')}${mac[5].toString(16).padStart(2,'0')}`;
          this.logger.debug(`[${conn['connId']}] MAC: ${conn.player.macAddressStr}`);
        }
      } catch (err) {
        this.logger.error(`anticheat op4 parse: ${err}`);
      }
      // Must be NoError; non-zero code causes retry loop + disconnect
      conn.sendTaskReply(op, new BBWriter().u32(0).toBuffer(), 1);
    } else {
      conn.replyEmpty(op);
    }
  }
}
