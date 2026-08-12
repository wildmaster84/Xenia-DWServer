import { Injectable, Logger } from '@nestjs/common';
import { BBWriter } from '../../core/bb-writer';
import { BBReader } from '../../core/bb-reader';
import { BD_NO_ERROR, BD_NO_FILE } from '../../core/bb-constants';
import { BBConnection } from '../../core/bb-connection';
import { UserFileRepository } from '../../infrastructure/persistance/repositories/user-file.repository';
import { StatsCacheService } from '../services/stats-cache.service';
import * as fsp from 'fs/promises';
import * as path from 'path';

const STATS_FILES = new Set(['zmstatsCompressed', 'mpstatsCompressed']);

@Injectable()
export class StorageHandler {
  private readonly logger = new Logger('StorageHandler');
  private pubCache = new Map<string, Buffer>();
  private readonly filesDir: string;

  constructor(
    private userFileRepo: UserFileRepository,
    private statsCache: StatsCacheService,
  ) {
    this.filesDir = path.join(process.cwd(), 'files');
  }

  async handle(op: number, body: Buffer, conn: BBConnection): Promise<void> {
    const r = new BBReader(body);
    r.u8(); // skip op byte

    switch (op) {
      case 1:
        return this.writeUserFile(op, r, conn);
      case 3:
        return this.readUserFile(op, r, conn);
      case 5:
        return this.getUserFileList(op, conn);
      case 6:
        return this.listPublisherFiles(op, conn);
      case 7:
        return this.readPublisherFile(op, r, conn);
      default:
        conn.replyEmpty(op);
        return;
    }
  }

  private async writeUserFile(op: number, r: BBReader, conn: BBConnection): Promise<void> {
    const w = new BBWriter();
    try {
      const fileName = r.string();
      if (r.peekTag() === 0x01) r.bool();
      const data = r.blob();
      const xuidHex = conn.xuid.toString(16).padStart(16, '0');

      this.logger.log(`[WRITE] name='${fileName}' xuid=${xuidHex} size=${data.length}`);

      if (STATS_FILES.has(fileName)) {
        // Write-back cache: update cache instantly, flush to MongoDB every 5 min
        this.statsCache.setRaw(xuidHex, fileName, Buffer.from(data));
      } else {
        // Non-stats files: write directly to MongoDB
        await this.userFileRepo.write(xuidHex, fileName, Buffer.from(data));
      }

      // StorageFileInfo (7 fields)
      w.u32(0);
      w.u64(conn.xuid);
      w.u32(data.length);
      w.u32(0);
      w.bool(true);
      w.u64(0n);
      w.string(fileName);

      conn.sendTaskReply(op, w.toBuffer(), 1);
    } catch (err) {
      this.logger.error(`writeUserFile: ${err}`);
      conn.replyEmpty(op);
    }
  }

  private async readUserFile(op: number, r: BBReader, conn: BBConnection): Promise<void> {
    const w = new BBWriter();
    try {
      const fileName = r.string();
      const xuidHex = conn.xuid.toString(16).padStart(16, '0');

      this.logger.log(`[READ] name='${fileName}' xuid=${xuidHex}`);

      const data = await this.userFileRepo.read(xuidHex, fileName);
      if (data) {
        let outData = data;

        // Stats files: use cache for raw compressed binary
        if (STATS_FILES.has(fileName)) {
          const cached = this.statsCache.getRaw(xuidHex, fileName);
          if (cached) {
            outData = cached;
          } else {
            // Cache miss — populate from MongoDB data
            const { raw } = this.statsCache.populate(xuidHex, fileName, data);
            outData = raw;
          }
        }

        this.logger.log(`[READ FOUND] name='${fileName}' size=${outData.length}`);
        w.blob(outData);
        conn.sendTaskReply(op, w.toBuffer(), 1);
      } else {
        this.logger.log(`[READ NOT FOUND] name='${fileName}' xuid=${xuidHex} -> BD_NO_FILE`);
        w.u32(BD_NO_FILE);
        conn.sendTaskReply(op, w.toBuffer(), 0, BD_NO_FILE);
      }
    } catch (err) {
      this.logger.error(`readUserFile: ${err}`);
      conn.replyEmpty(op);
    }
  }

  private async getUserFileList(op: number, conn: BBConnection): Promise<void> {
    const w = new BBWriter();
    try {
      const xuidHex = conn.xuid.toString(16).padStart(16, '0');
      const files = await this.userFileRepo.list(xuidHex);

      for (const f of files) {
        w.u32(0);
        w.u64(conn.xuid);
        w.u32(f.size);
        w.u32(0);
        w.bool(true);
        w.u64(0n);
        w.string(f.fileName);
      }
      conn.sendTaskReply(op, w.toBuffer(), files.length);
    } catch (err) {
      this.logger.error(`getUserFileList: ${err}`);
      conn.replyEmpty(op);
    }
  }

  private async listPublisherFiles(op: number, conn: BBConnection): Promise<void> {
    const w = new BBWriter();
    try {
      let entries: string[];
      try {
        entries = await fsp.readdir(this.filesDir);
      } catch {
        conn.replyEmpty(op);
        return;
      }
      for (const name of entries) {
        const stat = await fsp.stat(path.join(this.filesDir, name));
        w.u32(0);
        w.u64(0n);
        w.u32(stat.size);
        w.u32(0);
        w.bool(true);
        w.u64(0n);
        w.string(name);
      }
      conn.sendTaskReply(op, w.toBuffer(), entries.length);
    } catch (err) {
      this.logger.error(`listPublisherFiles: ${err}`);
      conn.replyEmpty(op);
    }
  }

  private async readPublisherFile(op: number, r: BBReader, conn: BBConnection): Promise<void> {
    const w = new BBWriter();
    try {
      const fileName = r.string();
      const safe = path.basename(fileName);

      let data = this.pubCache.get(safe);
      if (!data) {
        const filePath = path.join(this.filesDir, safe);
        try {
          data = await fsp.readFile(filePath);
        } catch {
          w.u32(BD_NO_FILE);
          conn.sendTaskReply(op, w.toBuffer(), 0, BD_NO_FILE);
          return;
        }
        this.pubCache.set(safe, data);
      }

      w.blob(data);
      conn.sendTaskReply(op, w.toBuffer(), 1);
    } catch (err) {
      this.logger.error(`readPublisherFile: ${err}`);
      conn.replyEmpty(op);
    }
  }
}
