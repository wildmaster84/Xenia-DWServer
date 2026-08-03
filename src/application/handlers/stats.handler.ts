import { Injectable, Logger } from '@nestjs/common';
import { BBWriter } from '../../core/bb-writer';
import { BBReader } from '../../core/bb-reader';
import { BD_NO_ERROR } from '../../core/bb-constants';
import { BBConnection } from '../../core/bb-connection';
import { UserFileRepository } from '../../infrastructure/persistance/repositories/user-file.repository';
import { StatsParser } from '../services/stats-parser';
import * as zlib from 'zlib';

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

  private async getMpStats(conn: BBConnection): Promise<Record<string, number>> {
    const xuidHex = conn.xuid.toString(16).padStart(16, '0');
    let raw = await this.userFileRepo.read(xuidHex, 'mpstatsCompressed');
    this.logger.log(`getMpStats: xuid=${xuidHex} raw=${raw ? raw.length + ' bytes' : 'NOT FOUND'}`);
    if (raw && raw.length > 0 && raw[0] === 0x7b) {
      try {
        const json = JSON.parse(raw.toString('utf-8'));
        if (json._buffer) raw = zlib.deflateRawSync(Buffer.from(json._buffer, 'base64'));
      } catch {}
    }
    const stats = raw ? this.statsParser.parseMpStats(raw) : {};
    this.logger.log(`getMpStats: parsed ${Object.keys(stats).length} stats, kills=${stats['kills'] || 0} score=${stats['score'] || 0} rankxp=${stats['rankxp'] || 0}`);
    return stats;
  }

  private async getZmStats(conn: BBConnection): Promise<Record<string, number>> {
    const xuidHex = conn.xuid.toString(16).padStart(16, '0');
    let raw = await this.userFileRepo.read(xuidHex, 'zmstatsCompressed');
    this.logger.log(`getZmStats: xuid=${xuidHex} raw=${raw ? raw.length + ' bytes' : 'NOT FOUND'}`);
    if (raw && raw.length > 0 && raw[0] === 0x7b) {
      try {
        const json = JSON.parse(raw.toString('utf-8'));
        if (json._buffer) raw = zlib.deflateRawSync(Buffer.from(json._buffer, 'base64'));
      } catch {}
    }
    const stats = raw ? this.statsParser.parseZmStats(raw) : {};
    this.logger.log(`getZmStats parsed: kills=${stats['kills'] ?? 0} deaths=${stats['deaths'] ?? 0} downs=${stats['downs'] ?? 0} revives=${stats['revives'] ?? 0} headshots=${stats['headshots'] ?? 0} gibs=${stats['gibs'] ?? 0} bullets_fired=${stats['bullets_fired'] ?? 0} bullets_hit=${stats['bullets_hit'] ?? 0} grenade_kills=${stats['grenade_kills'] ?? 0} perks_drank=${stats['perks_drank'] ?? 0} distance_traveled=${stats['distance_traveled'] ?? 0}`);
    return stats;
  }

  private async readEntityStats(op: number, r: BBReader, conn: BBConnection): Promise<void> {
    const w = new BBWriter();
    try {
      const boardId = r.u32();
      const entityIds: bigint[] = [];
      while (r.remaining >= 9 && r.peekTag() === 0x0a) {
        entityIds.push(r.u64());
      }

      if (this.statsParser.isZmBoard(boardId)) {
        const zmStats = await this.getZmStats(conn);
        const statName = ZM_BOARD_TO_STAT_GET(boardId);
        const boardValue = computeZmBoardValue(boardId, statName, zmStats);
        const zmRankXp = zmStats['rank'] || 0;
        const boardType = getZmBoardType(boardId);

        this.logger.log(`[readEntityStats] boardId=${boardId} type=${boardType} statName=${statName || 'UNKNOWN'} boardValue=${boardValue} entities=${entityIds.length}`);

        for (const eid of entityIds) {
          w.u64(eid);
          w.i64(eid === conn.xuid ? boardValueToBigInt(boardId, boardValue) : 0n);
          w.u64(1n);
          w.string(eid === conn.xuid ? conn.player.gamertag : 'Player');
          w.u32(eid === conn.xuid ? zmRankXp : 0);
          if (eid === conn.xuid) {
            const fields = buildZmStatsFields(boardType, zmStats, boardValue);
            for (const v of fields) w.i32(v);
          } else {
            for (let i = 0; i < 10; i++) w.i32(0);
          }
        }
      } else {
        const mpStats = await this.getMpStats(conn);
        const score = mpStats['score'] || 0;
        const kills = mpStats['kills'] || 0;
        const deaths = mpStats['deaths'] || 0;
        const assists = mpStats['assists'] || 0;
        const headshots = mpStats['headshots'] || 0;
        const defends = mpStats['defends'] || 0;
        const plants = mpStats['plants'] || 0;
        const defuses = mpStats['defuses'] || 0;
        const captures = mpStats['captures'] || 0;
        const rankxp = mpStats['rankxp'] || 0;
        const level = this.statsParser.computeLevel(rankxp);

        for (const eid of entityIds) {
          w.u64(eid);
          w.i64(BigInt(eid === conn.xuid ? score : 0));
          w.u64(1n);
          w.string(eid === conn.xuid ? conn.player.gamertag : 'Player');
          w.u32(eid === conn.xuid ? level : 0);
          if (eid === conn.xuid) {
            w.i32(kills);
            w.i32(deaths);
            w.i32(assists);
            w.i32(headshots);
            w.i32(defends);
            w.i32(plants);
            w.i32(defuses);
            w.i32(captures);
            w.i32(mpStats['destructions'] || 0);
            w.i32(mpStats['suicides'] || 0);
          } else {
            for (let i = 0; i < 10; i++) w.i32(0);
          }
        }
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
      const startEntity = r.peekTag() === 0x0a ? r.u64() : 0n;
      const maxRows = r.peekTag() === 0x08 ? r.u32() : 10;

      if (this.statsParser.isZmBoard(boardId)) {
        const zmStats = await this.getZmStats(conn);
        const statName = ZM_BOARD_TO_STAT_GET(boardId);
        const boardValue = computeZmBoardValue(boardId, statName, zmStats);
        const zmRankXp = zmStats['rank'] || 0;
        const boardType = getZmBoardType(boardId);

        this.logger.log(`[readByIndex] boardId=${boardId} type=${boardType} statName=${statName || 'UNKNOWN'} boardValue=${boardValue}`);

        w.u64(conn.xuid);
        w.i64(boardValueToBigInt(boardId, boardValue));
        w.u64(1n);
        w.string(conn.player.gamertag);
        w.u32(zmRankXp);
        const fields = buildZmStatsFields(boardType, zmStats, boardValue);
        for (const v of fields) w.i32(v);
      } else {
        const mpStats = await this.getMpStats(conn);
        const score = mpStats['score'] || 0;
        const rankxp = mpStats['rankxp'] || 0;
        const level = this.statsParser.computeLevel(rankxp);

        w.u64(conn.xuid);
        w.i64(BigInt(score));
        w.u64(1n);
        w.string(conn.player.gamertag);
        w.u32(level);
        w.i32(mpStats['kills'] || 0);
        w.i32(mpStats['deaths'] || 0);
        w.i32(mpStats['assists'] || 0);
        w.i32(mpStats['headshots'] || 0);
        w.i32(mpStats['defends'] || 0);
        w.i32(mpStats['plants'] || 0);
        w.i32(mpStats['defuses'] || 0);
        w.i32(mpStats['captures'] || 0);
        w.i32(mpStats['destructions'] || 0);
        w.i32(mpStats['suicides'] || 0);
      }
      conn.sendTaskReply(op, w.toBuffer(), 1);
    } catch (err) {
      this.logger.error(`readByIndex: ${err}`);
      conn.replyEmpty(op);
    }
  }

  private async twoU32Query(op: number, r: BBReader, conn: BBConnection): Promise<void> {
    const w = new BBWriter();
    try {
      let statA = 0, statB = 0;
      if (r.peekTag() === 0x08) statA = r.u32();
      if (r.peekTag() === 0x08) statB = r.u32();

      if (this.statsParser.isZmStatId(statA) || this.statsParser.isZmStatId(statB)) {
        const zmStats = await this.getZmStats(conn);
        const valA = this.statsParser.isZmStatId(statA) ? zmStats[this.statsParser.getZmStatName(statA)!] || 0 : 0;
        const valB = this.statsParser.isZmStatId(statB) ? zmStats[this.statsParser.getZmStatName(statB)!] || 0 : 0;
        w.u64(conn.xuid);
        w.i64(BigInt(valA));
        w.u64(BigInt(valB));
        w.string('0');
        w.u32(1);
      } else {
        const mpStats = await this.getMpStats(conn);
        const plevel = mpStats['plevel'] || 0;
        const rankxp = mpStats['rankxp'] || 0;
        const level = this.statsParser.computeLevel(rankxp);
        const valA = this.statsParser.getMpStatByBdStatId(mpStats, statA);
        const valB = this.statsParser.getMpStatByBdStatId(mpStats, statB);

        w.u64(conn.xuid);
        w.i64(BigInt(valA));
        w.u64(BigInt(valB));
        w.string(String(plevel));
        w.u32(level);
      }
      conn.sendTaskReply(op, w.toBuffer(), 1);
    } catch (err) {
      this.logger.error(`twoU32Query: ${err}`);
      conn.replyEmpty(op);
    }
  }

  private async batchedRead(op: number, r: BBReader, conn: BBConnection): Promise<void> {
    const w = new BBWriter();
    try {
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

      const mpStats = await this.getMpStats(conn);
      const rankxp = mpStats['rankxp'] || 0;
      const level = this.statsParser.computeLevel(rankxp);

      for (const entityId of entityIds) {
        for (const statId of statIds) {
          w.u32(statId);
          w.u32(0); // status = 0 (success)
          w.u64(entityId);
          w.i64(BigInt(this.statsParser.getMpStatByBdStatId(mpStats, statId)));
          w.u64(1n); // rank
          w.string(entityId === conn.xuid ? conn.player.gamertag : '');
          w.u32(level);
        }
      }
      conn.sendTaskReply(op, w.toBuffer(), resultCount);
    } catch (err) {
      this.logger.error(`batchedRead: ${err}`);
      conn.replyEmpty(op);
    }
  }
}

// Helper to get ZM board stat name (avoids circular import)
function computeZmBoardValue(boardId: number, statName: string | undefined, stats: Record<string, number>): number {
  if (!statName) return 0;
  return stats[statName] || 0;
}

function boardValueToBigInt(boardId: number, boardValue: number): bigint {
  return BigInt(Math.round(boardValue));
}

function ZM_BOARD_TO_STAT_GET(boardId: number): string | undefined {
  const map: Record<number, string> = {
    // Global boards
    20009: 'kills',
    20000: 'bullets_fired',
    20005: 'downs',
    20012: 'revives',
    20007: 'grenade_kills',
    20008: 'headshots',
    20002: 'deaths',
    20006: 'gibs',
    20010: 'perks_drank',
    20004: 'doors_opened',
    20001: 'bullets_hit',
    20003: 'distance_traveled',
    // TranZit (transit) rounds 1-4
    20050: 'transit_highest_round',
    20051: 'transit_highest_round',
    20052: 'transit_highest_round',
    20053: 'transit_highest_round',
    // Die Rise (highrise) rounds 1-4
    20054: 'highrise_highest_round',
    20055: 'highrise_highest_round',
    20056: 'highrise_highest_round',
    20057: 'highrise_highest_round',
    // Mob of the Dead (prison) rounds 1-4
    20058: 'prison_highest_round',
    20059: 'prison_highest_round',
    20060: 'prison_highest_round',
    20061: 'prison_highest_round',
    // Buried rounds 1-4
    20062: 'buried_highest_round',
    20063: 'buried_highest_round',
    20064: 'buried_highest_round',
    20065: 'buried_highest_round',
    // Origins (tomb) rounds 1-4
    20066: 'tomb_highest_round',
    20067: 'tomb_highest_round',
    20068: 'tomb_highest_round',
    20069: 'tomb_highest_round',
    // Survival Farm (transit sub-mode) rounds 1-4
    20070: 'transit_highest_round',
    20071: 'transit_highest_round',
    20072: 'transit_highest_round',
    20073: 'transit_highest_round',
    // Survival Town (transit sub-mode) rounds 1-4
    20074: 'transit_highest_round',
    20075: 'transit_highest_round',
    20076: 'transit_highest_round',
    20077: 'transit_highest_round',
    // Survival Bus Depot (transit sub-mode) rounds 1-4
    20078: 'transit_highest_round',
    20079: 'transit_highest_round',
    20080: 'transit_highest_round',
    20081: 'transit_highest_round',
    // Nuketown (nuke) rounds 1-4
    20082: 'nuke_highest_round',
    20083: 'nuke_highest_round',
    20084: 'nuke_highest_round',
    20085: 'nuke_highest_round',
    // Grief boards (board value = wins)
    20020: 'grief_wins',
    20021: 'grief_wins',
    20023: 'grief_wins',
    20024: 'grief_wins',
    // Turned boards (board value = wins, unknown)
    20022: 'turned_wins',
    20025: 'turned_wins',
  };
  return map[boardId];
}

// Determine board type from board ID
function getZmBoardType(boardId: number): 'global' | 'permap' | 'grief' | 'turned' {
  // Grief boards
  if (boardId === 20020 || boardId === 20021 || boardId === 20023 || boardId === 20024) return 'grief';
  // Turned boards
  if (boardId === 20022 || boardId === 20025) return 'turned';
  // Per-map boards (20050-20085)
  if (boardId >= 20050 && boardId <= 20085) return 'permap';
  // Global boards
  return 'global';
}

// Build 10 stats fields based on board type
function buildZmStatsFields(boardType: string, zmStats: Record<string, number>, boardValue: number = 0): number[] {
  const g = (name: string) => zmStats[name] || 0;

  if (boardType === 'permap') {
    // Per-map order: [0, 0, 0, rounds, kills, revives, headshots, downs, 0, 0]
    // We only have per-map highest_round (boardValue); per-map kills/revives/headshots/downs
    // are not stored in the stats file, so return 0 for those.
    return [0, 0, 0, boardValue, 0, 0, 0, 0, 0, 0];
  }
  if (boardType === 'grief') {
    // Grief order: [???, ???, ???, wins, losses, taints, revives, downs, ???, ???]
    return [0, 0, 0, 0, 0, 0, g('revives'), g('downs'), 0, 0];
  }
  if (boardType === 'turned') {
    // Turned: [???, ???, ???, wins, losses, kills, returns, ???, ???, ???]
    return [0, 0, 0, 0, 0, g('kills'), 0, 0, 0, 0];
  }
  // Global: Xbox 360 PSL order (downs at position 3, deaths at position 9)
  return [g('kills'), g('grenade_kills'), g('revives'), g('downs'), g('gibs'), 0, 0, 0, 0, g('deaths')];
}
