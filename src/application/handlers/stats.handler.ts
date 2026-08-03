import { Injectable, Logger } from '@nestjs/common';
import { BBWriter } from '../../core/bb-writer';
import { BBReader } from '../../core/bb-reader';
import { BD_NO_ERROR } from '../../core/bb-constants';
import { BBConnection } from '../../core/bb-connection';
import { UserFileRepository } from '../../infrastructure/persistance/repositories/user-file.repository';
import { StatsParser } from '../services/stats-parser';

@Injectable()
export class StatsHandler {
  private readonly logger = new Logger('StatsHandler');

  constructor(
    private userFileRepo: UserFileRepository,
    private statsParser: StatsParser,
  ) {}

  async handle(op: number, body: Buffer, conn: BBConnection): Promise<void> {
    const r = new BBReader(body);
    r.u8(); // skip op byte

    switch (op) {
      case 1:
        conn.replyEmpty(op);
        return;
      case 3:
        return this.readEntityStats(op, r, conn);
      case 4:
      case 5:
        return this.readByIndex(op, r, conn);
      case 8:
        return this.twoU32Query(op, r, conn);
      case 11:
        return this.batchedRead(op, r, conn);
      default:
        conn.replyEmpty(op);
        return;
    }
  }

  private async readEntityStats(op: number, r: BBReader, conn: BBConnection): Promise<void> {
    const w = new BBWriter();
    try {
      const boardId = r.u32();
      // Entity IDs are individual u64 values, NOT an array
      const entityIds: bigint[] = [];
      while (r.remaining >= 9 && r.peekTag() === 0x0a) {
        entityIds.push(r.u64());
      }

      for (const entityId of entityIds) {
        // bdStatsRowEx: u64, i64, u64, string(64), u32, i32×10
        w.u64(entityId);
        w.i64(0n); // score
        w.u64(1n); // rank
        w.string(entityId === conn.xuid ? conn.player.gamertag : 'Player');
        w.u32(0); // level
        for (let i = 0; i < 10; i++) w.i32(0);
      }
      conn.sendTaskReply(op, w.toBuffer(), entityIds.length);
    } catch (err) {
      this.logger.error(`readEntityStats: ${err}`);
      conn.replyEmpty(op);
    }
  }

  private async readByIndex(op: number, r: BBReader, conn: BBConnection): Promise<void> {
    const w = new BBWriter();
    try {
      const boardId = r.u32();
      const start = r.u64();
      const maxRows = r.u32();

      w.u32(BD_NO_ERROR);
      w.u32(1);
      w.u32(1);
      w.u64(conn.xuid);
      w.i64(0n);
      w.u64(0n);
      w.string(conn.player.gamertag);
      w.u32(0);
      for (let i = 0; i < 10; i++) w.i32(0);
      conn.sendTaskReply(op, w.toBuffer(), 1);
    } catch (err) {
      this.logger.error(`readByIndex: ${err}`);
      conn.replyEmpty(op);
    }
  }

  private async twoU32Query(op: number, r: BBReader, conn: BBConnection): Promise<void> {
    const w = new BBWriter();
    try {
      // Python uses peek_tag to conditionally read — same pattern
      let statA = 0, statB = 0;
      if (r.peekTag() === 0x08) statA = r.u32();
      if (r.peekTag() === 0x08) statB = r.u32();

      // Result: bdStatsRow: u64, i64, u64, string(64), u32
      w.u64(conn.xuid);
      w.i64(0n);
      w.u64(0n);
      w.string('0');
      w.u32(1);
      conn.sendTaskReply(op, w.toBuffer(), 1);
    } catch (err) {
      this.logger.error(`twoU32Query: ${err}`);
      conn.replyEmpty(op);
    }
  }

  private async batchedRead(op: number, r: BBReader, conn: BBConnection): Promise<void> {
    const w = new BBWriter();
    try {
      // Python reads individual values in loops, NOT arrays
      let numEntities = 0;
      let numStats = 0;
      const entityIds: bigint[] = [];
      const statIds: number[] = [];

      if (r.peekTag() === 0x08) numEntities = r.u32();
      for (let i = 0; i < numEntities; i++) {
        entityIds.push(r.u64());
      }
      if (r.peekTag() === 0x08) numStats = r.u32();
      for (let i = 0; i < numStats; i++) {
        statIds.push(r.u32());
      }

      const resultCount = numStats * numEntities;
      if (resultCount === 0) {
        conn.replyEmpty(op);
        return;
      }

      for (const entityId of entityIds) {
        for (const statId of statIds) {
          // bdStatsSlot: u32 statId, u32 status(0), bdStatsRow
          w.u32(statId);
          w.u32(0); // status = 0 (success)
          // bdStatsRow: u64, i64, u64, string(64), u32
          w.u64(entityId);
          w.i64(0n); // stat value
          w.u64(1n); // rank
          w.string(entityId === conn.xuid ? conn.player.gamertag : '');
          w.u32(1); // level
        }
      }
      conn.sendTaskReply(op, w.toBuffer(), resultCount);
    } catch (err) {
      this.logger.error(`batchedRead: ${err}`);
      conn.replyEmpty(op);
    }
  }
}
