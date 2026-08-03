import { Injectable } from '@nestjs/common';
import * as zlib from 'zlib';

const DDL_STAT_NAMES: Record<number, string> = {
  0: 'accuracy', 5: 'assist', 12: 'assists', 18: 'captures', 19: 'career_score',
  23: 'codpoints', 33: 'cur_win_streak', 34: 'currencyspent', 35: 'deaths',
  38: 'defends', 39: 'defuses', 57: 'destructions', 62: 'emblem_version',
  75: 'hasprestiged', 78: 'headshots', 80: 'hits', 83: 'kdratio',
  128: 'kills', 129: 'killsasflagcarrier', 130: 'killsconfirmed', 131: 'killsdenied',
  147: 'losses', 296: 'misses', 304: 'offends', 325: 'plants',
  326: 'plevel', 329: 'rank', 330: 'rankxp', 336: 'score',
  349: 'stats_version', 354: 'suicides', 358: 'teamkills',
  360: 'ties', 367: 'time_played_total', 375: 'total_shots',
  379: 'wins', 382: 'wlratio',
};

const BDSTAT_TO_DDL: Record<number, number> = {
  0x2711: 336, 0x2712: 128, 0x2713: 35, 0x2714: 12, 0x2715: 38,
  0x2716: 325, 0x2717: 39, 0x2718: 333, 0x2719: 18, 0x271a: 57,
  0x271b: 83, 0x271c: 354, 0x271d: 304, 0x271e: 131, 0x271f: 130,
  0x2720: 19, 0x2721: 78,
};

// ZM stat IDs
const ZM_STAT_IDS: Record<number, string> = {
  0x14dc: 'kills', 0x138a: 'downs',
};

const ZM_BOARD_TO_STAT: Record<number, string> = {
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
};

const ZM_PSL_OFFSET = 0xd0;
const ZM_PSL_FIELDS: [string, 'u32', number][] = [
  ['unknown_0', 'u32', 0x00],     // 45 — unknown
  ['kills', 'u32', 0x04],
  ['downs', 'u32', 0x08],
  ['revives', 'u32', 0x0c],
  ['perks_drank', 'u32', 0x10],
  ['gibs', 'u32', 0x14],
  ['unknown_6', 'u32', 0x18],      // 104 — unknown
  ['unknown_7', 'u32', 0x1c],      // unknown
  ['unknown_8', 'u32', 0x20],      // 35 — unknown
  ['unknown_9', 'u32', 0x24],      // 26 — unknown
  ['unknown_10', 'u32', 0x28],    // 20 — unknown
  ['grenade_kills', 'u32', 0x2c],
  ['doors_opened', 'u32', 0x30],
  ['distance_traveled', 'u32', 0x34],
  ['bullets_fired', 'u32', 0x38],
  ['bullets_hit', 'u32', 0x3c],
  ['deaths', 'u32', 0x40],
  ['unknown_16', 'u32', 0x44],   // 44 — unknown
];

// DDL section: headshots stored at offset 0x4c (DDL base=0x3c, +0x10)
const ZM_DDL_OFFSET = 0x3c;
const ZM_DDL_HEADSHOTS_OFFSET = 0x10;

// RankData: uint8 fields at PSL + 0x48 — all unknown
const ZM_RANK_FIELDS: [string, number][] = [];

// Map stats: 6 maps × 14 bytes (u16 + 3×u32) starting at PSL + 0x4c
const ZM_MAP_NAMES = ['transit', 'nuke', 'highrise', 'prison', 'buried', 'tomb'];
const ZM_MAP_FIELDS = ['highest_round', 'score', 'time', 'games_played'];

@Injectable()
export class StatsParser {
  /**
   * Parse MP stats from zlib-compressed data.
   * Returns a map of stat_name → value.
   */
  parseMpStats(raw: Buffer): Record<string, number> {
    try {
      const dec = zlib.inflateRawSync(raw);
      const result: Record<string, number> = {};
      const ddlStartBit = 0x30 * 8;
      const statsStart = ddlStartBit + 0x40;

      for (const [idxStr, name] of Object.entries(DDL_STAT_NAMES)) {
        const idx = Number(idxStr);
        const bitOff = statsStart + idx * 48;
        if (bitOff + 32 > dec.length * 8) break;
        const val = this.readBits(dec, bitOff, 32);
        result[name] = val >= 0x80000000 ? val - 0x100000000 : val;
      }
      return result;
    } catch {
      return {};
    }
  }

  /**
   * Parse ZM stats from zlib-compressed data.
   * Returns a map of stat_name → value.
   */
  parseZmStats(raw: Buffer): Record<string, number> {
    try {
      const dec = zlib.inflateRawSync(raw);
      const result: Record<string, number> = {};
      const base = ZM_PSL_OFFSET;

      // Layer A: PlayerStatsList (PSL at 0xd0, all u32)
      for (const [name, type, offset] of ZM_PSL_FIELDS) {
        const pos = base + offset;
        if (type === 'u32') {
          if (pos + 4 > dec.length) { result[name] = 0; continue; }
          result[name] = dec.readUInt32LE(pos);
        } else {
          if (pos + 8 > dec.length) { result[name] = 0; continue; }
          result[name] = Number(dec.readBigUInt64LE(pos));
        }
      }

      // headshots comes from DDL section (0x4c), not PSL
      const hsPos = ZM_DDL_OFFSET + ZM_DDL_HEADSHOTS_OFFSET;
      result['headshots'] = hsPos + 4 <= dec.length ? dec.readUInt32LE(hsPos) : 0;

      // Bank points: DDL bit-packed at bit offset 0xCB5B, stored as value/1000
      result['bank_points'] = this.readBits(dec, 0xCB5B, 32) * 1000;

      // Layer B: RankData (uint8 fields at PSL + 0x48)
      for (const [name, offset] of ZM_RANK_FIELDS) {
        const pos = base + offset;
        result[name] = pos < dec.length ? dec[pos] : 0;
      }

      // Layer C: MapStats (6 maps × 14 bytes, starting at PSL + 0x4c)
      const mapBase = base + 0x4c;
      for (let m = 0; m < 6; m++) {
        for (let fi = 0; fi < ZM_MAP_FIELDS.length; fi++) {
          const fname = ZM_MAP_FIELDS[fi];
          if (fname === 'highest_round') {
            const off = mapBase + m * 14;
            if (off + 2 <= dec.length) {
              result[`${ZM_MAP_NAMES[m]}_${fname}`] = dec.readUInt16LE(off);
            }
          } else {
            const off = mapBase + m * 14 + 2 + (fi - 1) * 4;
            if (off + 4 <= dec.length) {
              result[`${ZM_MAP_NAMES[m]}_${fname}`] = dec.readUInt32LE(off);
            }
          }
        }
      }

      return result;
    } catch {
      return {};
    }
  }

  /**
   * Get a stat value by bdStats ID from parsed MP stats.
   */
  getMpStatByBdStatId(stats: Record<string, number>, bdStatId: number): number {
    const ddlIdx = BDSTAT_TO_DDL[bdStatId];
    if (ddlIdx === undefined) return 0;
    const name = DDL_STAT_NAMES[ddlIdx];
    return stats[name] || 0;
  }

  /**
   * Get a ZM stat by leaderboard board ID.
   */
  getZmStatByBoardId(stats: Record<string, number>, boardId: number): number {
    const name = ZM_BOARD_TO_STAT[boardId];
    return name ? stats[name] || 0 : 0;
  }

  /**
   * Check if a stat ID is a ZM stat.
   */
  isZmStatId(statId: number): boolean {
    return statId in ZM_STAT_IDS;
  }

  /**
   * Get ZM stat name by stat ID.
   */
  getZmStatName(statId: number): string | undefined {
    return ZM_STAT_IDS[statId];
  }

  /**
   * Check if a board ID is a ZM board.
   */
  isZmBoard(boardId: number): boolean {
    return boardId >= 20000 && boardId < 30000;
  }

  /**
   * Compute level from rankxp.
   */
  computeLevel(rankxp: number): number {
    return rankxp > 0 ? Math.max(1, Math.floor(rankxp / 1000) + 1) : 1;
  }

  private readBits(data: Buffer, bitOffset: number, numBits: number): number {
    let val = 0;
    for (let i = 0; i < numBits; i++) {
      const byteIdx = (bitOffset + i) >> 3;
      const bitIdx = (bitOffset + i) & 7;
      const bit = (data[byteIdx] >> bitIdx) & 1;
      val |= bit << i;
    }
    return val >>> 0;
  }
}
