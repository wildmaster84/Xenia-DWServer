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
        // Dump full body hex
        this.logger.log(`[ANTICHEAT op=4] full body (${body.length} bytes): ${body.toString('hex')}`);

        const fa00mac = r.blob(); // 8-byte blob: fa00 + 6-byte MAC
        this.logger.log(`[ANTICHEAT] blob1 (fa00+MAC): ${fa00mac.toString('hex')} (${fa00mac.length} bytes)`);

        const field1 = r.u32();
        this.logger.log(`[ANTICHEAT] u32 #1: ${field1} (0x${field1.toString(16)})`);

        const field2 = r.u32();
        this.logger.log(`[ANTICHEAT] u32 #2: ${field2} (0x${field2.toString(16)})`);

        const field3 = r.u64();
        this.logger.log(`[ANTICHEAT] u64 #1: ${field3} (0x${field3.toString(16)})`);

        const field4 = r.u64();
        this.logger.log(`[ANTICHEAT] u64 #2: ${field4} (0x${field4.toString(16)})`);

        const consoleId = r.u64();
        this.logger.log(`[ANTICHEAT] u64 #3 (consoleId?): ${consoleId} (0x${consoleId.toString(16)})`);

        const rawMac = r.blob(); // 6-byte raw MAC
        this.logger.log(`[ANTICHEAT] blob2 (raw MAC): ${rawMac.toString('hex')} (${rawMac.length} bytes)`);

        // Log any remaining data
        const remaining = r.remaining;
        if (remaining > 0) {
          const rest = r.raw(remaining);
          this.logger.log(`[ANTICHEAT] remaining (${remaining} bytes): ${rest.toString('hex')}`);
        }

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
