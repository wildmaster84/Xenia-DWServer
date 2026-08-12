import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as zlib from 'zlib';
import { StatsParser } from './stats-parser';
import { UserFileRepository } from '../../infrastructure/persistance/repositories/user-file.repository';

interface CacheEntry {
  raw: Buffer;                        // raw compressed binary (what game expects)
  parsed: Record<string, number>;     // parsed stats (what stats handler uses)
  dirty: boolean;                     // needs flush to MongoDB
  timestamp: number;
}

const STATS_FILES = new Set(['zmstatsCompressed', 'mpstatsCompressed']);
const FLUSH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Write-back cache for stats files.
 *
 * Write path: game writes stats → cache.setRaw() (instant) → reply to game immediately.
 *   MongoDB is NOT written — the dirty entry is flushed later by a background timer.
 * Read path: cache.getParsed()/getRaw() → if hit, return instantly (0ms).
 *   If miss, read from MongoDB → decompress → parse → cache → return.
 * Flush: every 5 minutes, dirty entries are written to MongoDB in the background.
 *
 * Tradeoff: if the server crashes, up to 5 minutes of stats writes could be lost.
 * MongoDB always has the last flushed copy. The cache is a performance layer.
 */
@Injectable()
export class StatsCacheService implements OnModuleDestroy {
  private readonly logger = new Logger('StatsCache');
  private cache = new Map<string, CacheEntry>();
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(
    private statsParser: StatsParser,
    private userFileRepo: UserFileRepository,
  ) {
    // Start background flush timer
    this.flushTimer = setInterval(() => this.flushDirty(), FLUSH_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    // Final flush on shutdown — don't lose dirty data
    this.flushDirty();
  }

  private key(xuidHex: string, fileName: string): string {
    return `${xuidHex}:${fileName}`;
  }

  private parseKey(k: string): { xuidHex: string; fileName: string } {
    const idx = k.indexOf(':');
    return { xuidHex: k.substring(0, idx), fileName: k.substring(idx + 1) };
  }

  /**
   * Get cached parsed stats. Returns null on miss.
   */
  getParsed(xuidHex: string, fileName: string): Record<string, number> | null {
    const entry = this.cache.get(this.key(xuidHex, fileName));
    return entry ? entry.parsed : null;
  }

  /**
   * Get cached raw compressed binary. Returns null on miss.
   */
  getRaw(xuidHex: string, fileName: string): Buffer | null {
    const entry = this.cache.get(this.key(xuidHex, fileName));
    return entry ? entry.raw : null;
  }

  /**
   * Populate cache from raw MongoDB data.
   * Handles JSON → compressed binary reconstruction, then decompress + parse.
   * Returns { raw, parsed }.
   */
  populate(xuidHex: string, fileName: string, mongoData: Buffer): { raw: Buffer; parsed: Record<string, number> } {
    let raw = mongoData;

    // Reconstruct compressed binary from JSON if needed
    if (mongoData.length > 0 && mongoData[0] === 0x7b /* '{' */) {
      try {
        const json = JSON.parse(mongoData.toString('utf-8'));
        if (json._buffer) {
          raw = zlib.deflateRawSync(Buffer.from(json._buffer, 'base64'));
        }
      } catch {
        // Not JSON or parse failed — use raw data as-is
      }
    }

    // Parse stats from compressed binary
    let parsed: Record<string, number> = {};
    try {
      if (fileName === 'zmstatsCompressed') {
        parsed = this.statsParser.parseZmStats(raw);
      } else if (fileName === 'mpstatsCompressed') {
        parsed = this.statsParser.parseMpStats(raw);
      }
    } catch {
      // Parse failed — return empty stats
    }

    this.cache.set(this.key(xuidHex, fileName), {
      raw,
      parsed,
      dirty: false, // came from MongoDB, not dirty
      timestamp: Date.now(),
    });

    return { raw, parsed };
  }

  /**
   * Write-back: store new raw data from the game, mark as dirty.
   * Does NOT write to MongoDB — the flush timer handles that.
   * Decompresses and parses the raw data so subsequent reads are instant.
   */
  setRaw(xuidHex: string, fileName: string, rawData: Buffer): void {
    // Parse stats from compressed binary
    let parsed: Record<string, number> = {};
    try {
      if (fileName === 'zmstatsCompressed') {
        parsed = this.statsParser.parseZmStats(rawData);
      } else if (fileName === 'mpstatsCompressed') {
        parsed = this.statsParser.parseMpStats(rawData);
      }
    } catch {
      // Parse failed — cache raw anyway, parsed stays empty
    }

    this.cache.set(this.key(xuidHex, fileName), {
      raw: Buffer.from(rawData),
      parsed,
      dirty: true,
      timestamp: Date.now(),
    });
  }

  /**
   * Flush all dirty entries to MongoDB.
   * Called by the background timer every 5 minutes, and on shutdown.
   */
  async flushDirty(): Promise<void> {
    const dirtyEntries: Array<{ xuidHex: string; fileName: string; raw: Buffer }> = [];

    for (const [k, entry] of this.cache) {
      if (entry.dirty) {
        const { xuidHex, fileName } = this.parseKey(k);
        dirtyEntries.push({ xuidHex, fileName, raw: entry.raw });
        entry.dirty = false; // mark as clean immediately
      }
    }

    if (dirtyEntries.length === 0) return;

    this.logger.log(`Flushing ${dirtyEntries.length} dirty entries to MongoDB...`);

    // Write all dirty entries in parallel
    await Promise.all(
      dirtyEntries.map(({ xuidHex, fileName, raw }) =>
        this.userFileRepo.write(xuidHex, fileName, raw).catch((err) => {
          this.logger.error(`Flush failed for ${xuidHex}:${fileName}: ${err}`);
          // Re-mark as dirty so it retries next cycle
          const entry = this.cache.get(this.key(xuidHex, fileName));
          if (entry) entry.dirty = true;
        }),
      ),
    );

    this.logger.log(`Flush complete (${dirtyEntries.length} entries)`);
  }

  /**
   * Invalidate all entries for a xuid (on disconnect).
   * Flushes dirty data before removing.
   */
  async invalidateAll(xuidHex: string): Promise<void> {
    const prefix = `${xuidHex}:`;
    const toFlush: Array<{ fileName: string; raw: Buffer }> = [];

    for (const [k, entry] of this.cache) {
      if (k.startsWith(prefix) && entry.dirty) {
        const { fileName } = this.parseKey(k);
        toFlush.push({ fileName, raw: entry.raw });
        entry.dirty = false;
      }
    }

    // Flush dirty data for this xuid before removing
    if (toFlush.length > 0) {
      await Promise.all(
        toFlush.map(({ fileName, raw }) =>
          this.userFileRepo.write(xuidHex, fileName, raw).catch((err) =>
            this.logger.error(`Flush on disconnect failed for ${xuidHex}:${fileName}: ${err}`),
          ),
        ),
      );
    }

    // Remove all entries for this xuid
    for (const k of this.cache.keys()) {
      if (k.startsWith(prefix)) this.cache.delete(k);
    }
  }

  /**
   * Get cache stats for monitoring.
   */
  get size(): number {
    return this.cache.size;
  }

  get dirtyCount(): number {
    let count = 0;
    for (const entry of this.cache.values()) {
      if (entry.dirty) count++;
    }
    return count;
  }
}
