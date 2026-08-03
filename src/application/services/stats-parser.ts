import { Injectable } from '@nestjs/common';
import * as zlib from 'zlib';

// MP DDL stat names (index → name)
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

// bdStats ID → DDL index
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

// ZM leaderboard board → stat name
const ZM_BOARD_TO_STAT: Record<number, string> = {
  20000: 'bullets_fired', 20001: 'bullets_hit', 20002: 'gibs',
  20003: 'headshots', 20004: 'revives', 20005: 'downs',
  20006: 'doors_opened', 20007: 'perks_drank', 20008: 'grenade_kills',
  20009: 'kills', 20010: 'distance_traveled', 20011: 'time_played_total',
  20012: 'deaths',
};

// ZM PlayerStatsList fields: (name, type, offset)
const ZM_PSL_FIELDS: [string, 'u32' | 'u64', number][] = [
  ['kills', 'u32', 0x00],
  ['downs', 'u32', 0x04],
  ['revives', 'u32', 0x08],
  ['headshots', 'u32', 0x0c],
  ['gibs', 'u32', 0x10],
  ['bullets_fired', 'u64', 0x14],
  ['bullets_hit', 'u64', 0x1c],
  ['perks_drank', 'u32', 0x24],
  ['doors_opened', 'u32', 0x28],
  ['grenade_kills', 'u32', 0x2c],
  ['distance_traveled', 'u64', 0x30],
  ['time_played_total', 'u32', 0x38],
];

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

      for (const [idx, name] of Object.entries(DDL_STAT_NAMES)) {
        const bitOff = statsStart + Number(idx) * 48;
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
      const pslStart = 0x3c;

      for (const [name, type, offset] of ZM_PSL_FIELDS) {
        const pos = pslStart + offset;
        if (type === 'u32') {
          if (pos + 4 > dec.length) break;
          result[name] = dec.readUInt32LE(pos);
        } else {
          if (pos + 8 > dec.length) break;
          result[name] = Number(dec.readBigUInt64LE(pos));
        }
      }

      // RankData at offset 0x3C + 0x3C = 0x78 (4 uint8 fields)
      const rankStart = 0x78;
      if (rankStart + 4 <= dec.length) {
        result['rank'] = dec[rankStart];
        result['tally_marks'] = dec[rankStart + 1];
        result['blue_eyes'] = dec[rankStart + 2];
        result['plevel'] = dec[rankStart + 3];
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
