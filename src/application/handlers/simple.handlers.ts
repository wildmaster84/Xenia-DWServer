import { Injectable, Logger } from '@nestjs/common';
import { BBWriter } from '../../core/bb-writer';
import { BBReader } from '../../core/bb-reader';
import { BD_NO_FILE, BD_NO_ERROR } from '../../core/bb-constants';
import { BBConnection } from '../../core/bb-connection';

@Injectable()
export class SimpleHandlers {
  private readonly logger = new Logger('SimpleHandlers');

  // bdTeams (3) — op 27 returns BD_NO_FILE
  handleTeams(op: number, body: Buffer, conn: BBConnection): void {
    const r = new BBReader(body);
    r.u8(); // skip op byte
    const w = new BBWriter();
    if (op === 27) {
      w.u32(BD_NO_FILE);
    }
    conn.sendTaskReply(op, w.toBuffer(), 0);
  }

  // bdTitleUtilities (12) — op 6 returns server time
  handleTitleUtilities(op: number, body: Buffer, conn: BBConnection): void {
    const r = new BBReader(body);
    r.u8(); // skip op byte
    const w = new BBWriter();
    if (op === 6) {
      w.u32(Math.floor(Date.now() / 1000));
      conn.sendTaskReply(op, w.toBuffer(), 1);
    } else {
      conn.replyEmpty(op);
    }
  }

  // bdCounter (23) — op 2 returns counter totals (online count per counter ID)
  handleCounter(op: number, body: Buffer, conn: BBConnection): void {
    const r = new BBReader(body);
    r.u8(); // skip op byte
    const w = new BBWriter();
    if (op === 2) {
      // Parse individual tagged u32 counter IDs (NOT an array)
      const ids: number[] = [];
      while (r.remaining >= 5 && r.peekTag() === 0x08) {
        ids.push(r.u32());
        if (ids.length > 4096) break;
      }
      for (const id of ids) {
        w.u32(id);
        w.i64(100n);  // test: all counters = 100, if Status=Avail+Groups → 200
      }
      conn.sendTaskReply(op, w.toBuffer(), ids.length);
    } else {
      conn.replyEmpty(op);
    }
  }

  // bdDml (27) — op 3 returns hardcoded geo-location
  handleDml(op: number, body: Buffer, conn: BBConnection): void {
    const r = new BBReader(body);
    r.u8(); // skip op byte
    const w = new BBWriter();
    if (op === 3) {
      w.u32(BD_NO_ERROR);
      w.u32(1);
      w.u32(1);
      w.string('US');
      w.string('California');
      w.string('Los Angeles');
      w.f32(34.0453);
      w.f32(-118.2413);
      conn.sendTaskReply(op, w.toBuffer(), 1);
    } else {
      conn.replyEmpty(op);
    }
  }

  // bdGroup (28) — op 1 stores group IDs, op 4 returns per-group member counts
  handleGroup(op: number, body: Buffer, conn: BBConnection): void {
    const r = new BBReader(body);
    r.u8(); // skip op byte

    if (op === 1) {
      // setGroups — store the player's group/playlist IDs
      try {
        const groupIds = r.u32Array();
        conn.player.groupIds = groupIds;
        this.logger.log(`setGroups: stored ${groupIds.length} IDs = [${groupIds.join(', ')}] for xuid=${conn.xuid.toString(16)}`);
      } catch (err) {
        this.logger.warn(`setGroups parse failed: ${err}`);
      }
      conn.replyEmpty(op);
      return;
    }

    if (op === 4) {
      // getGroupCounts — return per-group member count
      // Match Python format exactly: interleaved TAG_U32(gid) + TAG_U32(count), no array header
      let groupIds: number[] = [];
      try {
        groupIds = r.u32Array();
      } catch (err) {
        this.logger.warn(`getGroupCounts parse failed: ${err}`);
      }
      const onlineCount = BBConnection.activeCount;
      this.logger.log(`getGroupCounts: ${groupIds.length} groups, online=${onlineCount}`);
      const w = new BBWriter();
      for (const gid of groupIds) {
        w.u32(gid);           // groupId
        w.u32(onlineCount);   // memberCount = online count for all groups
      }
      conn.sendTaskReply(op, w.toBuffer(), groupIds.length);
      return;
    }

    conn.replyEmpty(op);
  }

  // bdKeyArchive (15) — op 1 empty, op 2 returns key data
  handleKeyArchive(op: number, body: Buffer, conn: BBConnection): void {
    const r = new BBReader(body);
    r.u8(); // skip op byte
    const w = new BBWriter();
    if (op === 2) {
      try {
        const ownerId = r.u64();
        const archiveId = r.i16();
        const flag = r.bool();
        const keyIds = r.u32Array();
        w.u32(BD_NO_ERROR);
        w.u32(keyIds.length);
        w.u32(keyIds.length);
        for (const kid of keyIds) {
          w.i16(kid & 0xffff);
          w.i64(0n);
        }
        conn.sendTaskReply(op, w.toBuffer(), keyIds.length);
      } catch {
        conn.replyEmpty(op);
      }
    } else {
      conn.replyEmpty(op);
    }
  }

  // bdEventLog (67) — all ops acknowledge with empty reply
  handleEventLog(op: number, body: Buffer, conn: BBConnection): void {
    const r = new BBReader(body);
    r.u8(); // skip op byte
    conn.replyEmpty(op);
  }

  // bdRichPresence (68) — op 1 stores presence blob
  handleRichPresence(op: number, body: Buffer, conn: BBConnection): void {
    const r = new BBReader(body);
    r.u8(); // skip op byte
    if (op === 1) {
      try {
        const xuid = r.u64();
        const data = r.blob();
        conn.player.presence = Buffer.from(data);
      } catch {
        // ignore
      }
    }
    conn.replyEmpty(op);
  }

  // bdLeague (81) — op 2 empty, op 1/6/8 return per-XUID data
  handleLeague(op: number, body: Buffer, conn: BBConnection): void {
    const r = new BBReader(body);
    r.u8(); // skip op byte
    const w = new BBWriter();
    if (op === 2) {
      w.u32(BD_NO_ERROR);
      w.u32(0);
      w.u32(0);
      conn.sendTaskReply(op, w.toBuffer(), 0);
      return;
    }
    if (op === 1 || op === 8) {
      try {
        const xuids = r.u64Array();
        w.u32(BD_NO_ERROR);
        w.u32(xuids.length);
        w.u32(xuids.length);
        for (const _ of xuids) {
          w.u64(0n);
          w.u64(0n);
        }
        conn.sendTaskReply(op, w.toBuffer(), xuids.length);
      } catch {
        conn.replyEmpty(op);
      }
      return;
    }
    if (op === 6) {
      try {
        const xuids = r.u64Array();
        w.u32(BD_NO_ERROR);
        w.u32(xuids.length);
        w.u32(xuids.length);
        for (const _ of xuids) {
          w.u64(0n);
          w.string('');
          w.blob(Buffer.alloc(0));
          w.u32(0);
        }
        conn.sendTaskReply(op, w.toBuffer(), xuids.length);
      } catch {
        conn.replyEmpty(op);
      }
      return;
    }
    conn.replyEmpty(op);
  }
}
