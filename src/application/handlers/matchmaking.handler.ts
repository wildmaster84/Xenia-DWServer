import { Injectable, Logger } from '@nestjs/common';
import { BBWriter } from '../../core/bb-writer';
import { BBReader } from '../../core/bb-reader';
import { BD_NO_ERROR, STATIC_XNKEY } from '../../core/bb-constants';
import { BBConnection } from '../../core/bb-connection';
import { XboxPresClient } from '../../infrastructure/xboxpres-client';
import { DWSessionRepository } from '../../infrastructure/persistance/repositories/dw-session.repository';

@Injectable()
export class MatchmakingHandler {
  private readonly logger = new Logger('MatchmakingHandler');

  constructor(
    private xboxPres: XboxPresClient,
    private sessionRepo: DWSessionRepository,
  ) {}

  async handle(op: number, body: Buffer, conn: BBConnection): Promise<void> {
    const r = new BBReader(body);
    r.u8(); // skip op byte

    switch (op) {
      case 1:
        return this.createSession(op, r, conn);
      case 3:
        return this.leaveSession(op, r, conn);
      case 5:
        return this.searchSessions(op, r, conn);
      case 12:
        return this.updateSession(op, r, conn);
      default:
        conn.replyEmpty(op);
        return;
    }
  }

  private parseSessionFields(r: BBReader): {
    xnaddr: Buffer;
    flags: number;
    publicSlots: number;
    sessionId: bigint;
    xnkey: Buffer;
    intFields: number[];
    floatField?: number;
    intFields2: number[];
  } {
    const xnaddr = r.blob();
    const flags = r.u32();
    const publicSlots = r.u32();
    const sessionId = r.u64();
    const xnkey = r.blob();

    const intFields: number[] = [];
    for (let i = 0; i < 8; i++) {
      intFields.push(r.i32());
    }

    let floatField: number | undefined;
    let intFields2: number[] = [];
    if (r.remaining > 0 && r.peekTag() === 0x0d) {
      floatField = r.f32();
      intFields2 = [];
      for (let i = 0; i < 4; i++) {
        intFields2.push(r.i32());
      }
    }

    return { xnaddr, flags, publicSlots, sessionId, xnkey, intFields, floatField, intFields2 };
  }

  private async createSession(op: number, r: BBReader, conn: BBConnection): Promise<void> {
    const w = new BBWriter();
    try {
      const fields = this.parseSessionFields(r);
      const xuidHex = conn.xuid.toString(16).padStart(16, '0');
      const sessionIdHex = fields.sessionId.toString(16).padStart(16, '0');

      await this.sessionRepo.create({
        sessionId: sessionIdHex,
        xuid: xuidHex,
        hostIp: '',
        macAddress: conn.player.macAddress || undefined,
        macAddressStr: conn.player.macAddressStr,
        port: 36000,
        flags: fields.flags,
        publicSlots: fields.publicSlots,
        privateSlots: 0,
        titleId: conn.player.titleId,
        xnkey: Buffer.from(fields.xnkey),
        intFields: fields.intFields,
        floatField: fields.floatField,
        intFields2: fields.intFields2,
      });

      w.u64(fields.sessionId);
      conn.sendTaskReply(op, w.toBuffer(), 1);
    } catch (err) {
      this.logger.error(`createSession: ${err}`);
      conn.replyEmpty(op);
    }
  }

  private async leaveSession(op: number, r: BBReader, conn: BBConnection): Promise<void> {
    conn.replyEmpty(op);
  }

  private async searchSessions(op: number, r: BBReader, conn: BBConnection): Promise<void> {
    const w = new BBWriter();
    try {
      // Parse search params (mode, skip, max) — extra data is ignored
      let mode = 0, skip = 0, maxResults = 50;
      if (r.remaining > 0 && r.peekTag() === 0x08) mode = r.u32();
      if (r.remaining > 0 && r.peekTag() === 0x08) skip = r.u32();
      if (r.remaining > 0 && r.peekTag() === 0x08) maxResults = r.u32();

      const searcherXuid = conn.xuid.toString(16).padStart(16, '0');
      const results = await this.xboxPres.searchSessions(searcherXuid, maxResults);

      this.logger.log(`searchSessions: xuid=${searcherXuid} mode=${mode} max=${maxResults} → ${results.length} sessions`);

      for (const sess of results) {
        // Build 42-byte XNADDR matching the format the game expects:
        // offset 0:  flags (u32 big-endian, =1)
        // offset 4:  16 bytes padding (zeros)
        // offset 20: MAC reversed (6 bytes LE)
        // offset 26: port (u16 LE)
        // offset 28: IP reversed (4 bytes LE)
        // offset 32: IP reversed again (4 bytes LE)
        // offset 36: 0x3E8 (u32 LE = 1000)
        // offset 40: 2 bytes padding
        const xnaddr = Buffer.alloc(42);
        xnaddr.writeUInt32BE(1, 0); // flags = 1

        // Parse MAC
        const macStr = sess.macAddress || '';
        const cleanMac = macStr.replace(/:/g, '');
        if (cleanMac.length >= 12) {
          const macBytes = Buffer.from(cleanMac, 'hex');
          // MAC reversed (LE) at offset 20
          for (let i = 0; i < 6; i++) {
            xnaddr[20 + i] = macBytes[5 - i];
          }
        }

        // Port at offset 26 (u16 LE)
        const port = sess.port || 36000;
        xnaddr.writeUInt16LE(port, 26);

        // Parse IP and reverse at offset 28 and 32
        const hostIp = sess.hostAddress || '0.0.0.0';
        const ipParts = hostIp.split('.').map(Number);
        if (ipParts.length === 4) {
          // IP reversed (LE) at offset 28
          xnaddr[28] = ipParts[3];
          xnaddr[29] = ipParts[2];
          xnaddr[30] = ipParts[1];
          xnaddr[31] = ipParts[0];
          // IP reversed again at offset 32
          xnaddr[32] = ipParts[3];
          xnaddr[33] = ipParts[2];
          xnaddr[34] = ipParts[1];
          xnaddr[35] = ipParts[0];
        }

        // 0x3E8 (1000) at offset 36 (u32 LE)
        xnaddr.writeUInt32LE(0x3e8, 36);

        // Session ID
        const sid = BigInt('0x' + (sess.sessionId || '0'));
        const sidHex = sid.toString(16).padStart(16, '0');

        // Look up stored session data for XNKEY + fields
        let stored: any = null;
        try {
          stored = await this.sessionRepo.getBySessionId(sidHex);
        } catch {}

        const xnkey = stored?.xnkey ? Buffer.from(stored.xnkey) : STATIC_XNKEY;

        // Build response matching Python format:
        // 1. BLOB XNADDR (42 bytes)
        w.blob(xnaddr);
        // 2. BLOB 8-byte value (session nonce — session ID as LE bytes)
        const nonce = Buffer.alloc(8);
        nonce.writeBigUInt64LE(sid, 0);
        w.blob(nonce);
        // 3-5. U32 × 3
        w.u32(0);
        w.u32(0);
        w.u32(0);
        // 6. U64 session_id
        w.u64(sid);
        // 7. BLOB XNKEY (16 bytes)
        w.blob(xnkey);
        // 8-15. I32 × 8
        const intFields = stored?.intFields || [0x3e8, 0, 0x82c, 0, 0, 0, 0, 0];
        for (let i = 0; i < 8; i++) w.i32(intFields[i] || 0);
        // 16. FLOAT
        w.f32(stored?.floatField || 0);
        // 17-20. I32 × 4
        const intFields2 = stored?.intFields2 || [0, 0, 0, 0];
        for (let i = 0; i < 4; i++) w.i32(intFields2[i] || 0);

        this.logger.log(`  session sid=${sidHex} host=${hostIp}:${port} mac=${cleanMac}`);
      }
      conn.sendTaskReply(op, w.toBuffer(), results.length);
    } catch (err) {
      this.logger.error(`searchSessions: ${err}`);
      conn.replyEmpty(op);
    }
  }

  private async updateSession(op: number, r: BBReader, conn: BBConnection): Promise<void> {
    // op=12 body format may differ from op=1 — parse what we can, ignore errors
    try {
      const fields = this.parseSessionFields(r);
      const sessionIdHex = fields.sessionId.toString(16).padStart(16, '0');
      await this.sessionRepo.update(sessionIdHex, {
        xnkey: Buffer.from(fields.xnkey),
        intFields: fields.intFields,
        floatField: fields.floatField,
        intFields2: fields.intFields2,
      });
    } catch {
      // Parse may fail — op=12 format can differ from op=1
      // Python code also catches and ignores, then replies empty
    }
    conn.replyEmpty(op);
  }

  async onDisconnect(conn: BBConnection): Promise<void> {
    const xuidHex = conn.xuid.toString(16).padStart(16, '0');
    await this.sessionRepo.deleteByXuid(xuidHex);
    await this.xboxPres.deleteSession(xuidHex);
  }
}
