import { Socket } from 'net';
import { Logger } from '@nestjs/common';
import {
  TAG,
  STAGE_CONNECTED,
  STAGE_AUTHENTICATED,
  MAX_FRAME_SIZE,
  KEEPALIVE_FRAME,
  KEEPALIVE_INTERVAL_MS,
  MAX_SERVICE_CALLS_PER_SEC,
  SERVICE_TYPES,
  BD_NO_ERROR,
} from './bb-constants';
import { BBReader } from './bb-reader';
import { BBWriter } from './bb-writer';
import { BitReader } from './bb-bit-reader';
import { ServiceDispatcher } from './bb-protocol';

export interface PlayerState {
  xuid: bigint;
  gamertag: string;
  titleId: number;
  stage: number;
  presence: Buffer | null;
  macAddress: Buffer | null;
  macAddressStr: string;
  pendingClipIds: bigint[];
  groupIds: number[];
  connectTime: number;
  serviceCallTimes: number[];
}

export class BBConnection {
  private readonly logger = new Logger('BBConnection');
  private socket: Socket;
  private remoteAddr: string;
  private connId: number;
  private dispatcher: ServiceDispatcher;

  // Connection state
  private buffer = Buffer.alloc(0);
  private alive = true;
  private keepaliveTimer: NodeJS.Timeout | null = null;

  // Player state
  public player: PlayerState = {
    xuid: 0n,
    gamertag: '',
    titleId: 0,
    stage: STAGE_CONNECTED,
    presence: null,
    macAddress: null,
    macAddressStr: '',
    pendingClipIds: [],
    groupIds: [],
    connectTime: Date.now(),
    serviceCallTimes: [],
  };

  // Transaction counter
  public txn = 0;

  private static connIdCounter = 0;
  private static activeConnections: BBConnection[] = [];
  private static ipConnections: Map<string, number> = new Map();

  constructor(socket: Socket, dispatcher: ServiceDispatcher) {
    this.socket = socket;
    this.dispatcher = dispatcher;
    this.connId = ++BBConnection.connIdCounter;
    this.remoteAddr = `${socket.remoteAddress}:${socket.remotePort}`;

    // Track per-IP connections
    const ipKey = socket.remoteAddress || '';
    const count = BBConnection.ipConnections.get(ipKey) || 0;
    BBConnection.ipConnections.set(ipKey, count + 1);
    BBConnection.activeConnections.push(this);
  }

  get xuid(): bigint {
    return this.player.xuid;
  }

  get isAuthenticated(): boolean {
    return this.player.stage === STAGE_AUTHENTICATED;
  }

  start(): void {
    this.socket.on('data', (data: Buffer) => this.feed(data));
    this.socket.on('error', (err) => {
      this.logger.debug(`[${this.connId}] socket error: ${err.message}`);
      this.cleanup();
    });
    this.socket.on('close', () => {
      this.logger.debug(`[${this.connId}] connection closed`);
      this.cleanup();
    });

    // Start keepalive
    this.keepaliveTimer = setInterval(() => this.sendKeepalive(), KEEPALIVE_INTERVAL_MS);
  }

  private feed(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data]);

    while (this.alive && this.buffer.length >= 4) {
      const size = this.buffer.readUInt32LE(0);
      if (size === 0) {
        // Client keepalive — consume, no reply
        this.buffer = this.buffer.subarray(4);
        continue;
      }
      if (size === 200) {
        // Buffer-available notification — 8 bytes total, no reply
        if (this.buffer.length < 8) break;
        this.buffer = this.buffer.subarray(8);
        continue;
      }
      if (size > MAX_FRAME_SIZE) {
        this.logger.warn(`[${this.connId}] frame too large: ${size}`);
        this.destroy();
        return;
      }
      if (this.buffer.length < 4 + size) break;

      const body = this.buffer.subarray(4, 4 + size);
      this.buffer = this.buffer.subarray(4 + size);

      // body[0] = padding (0x00), body[1] = msg_type
      const msgType = body[1];
      const payload = body.subarray(2);

      if (msgType === 0x07) {
        this.handleHello(payload);
      } else {
        this.handleService(msgType, payload);
      }
    }
  }

  private handleHello(payload: Buffer): void {
    try {
      // Parse bit-packed auth proof:
      // more_data(1) | tag(5) | titleId(32) | tag(5) | seed(32) | auth_proof(128 bytes)
      const br = new BitReader(payload);
      br.bits(1);  // more_data flag
      br.bits(5);  // type tag for titleId
      const titleId = br.u32();
      br.bits(5);  // type tag for seed
      const seed = br.u32();
      const authProof = br.take(128);

      // Extract XUID (offset +0x19 u64 LE), gamertag (offset +0x21 ASCIIZ), title_id (offset +0x05 u16 LE)
      this.player.xuid = authProof.readBigUInt64LE(0x19);
      const gtEnd = authProof.indexOf(0x00, 0x21);
      this.player.gamertag = authProof.subarray(0x21, gtEnd > 0x21 ? gtEnd : 0x21).toString('ascii').replace(/\0+$/, '');
      this.player.titleId = authProof.readUInt16LE(0x05);
      this.player.stage = STAGE_AUTHENTICATED;

      this.logger.log(
        `[${this.connId}] auth: xuid=${this.player.xuid.toString(16)} gt="${this.player.gamertag}" title=${this.player.titleId.toString(16)}`,
      );

      // Send ConnectionIdResponse (msg_type=4):
      // tagged u64(conn_id) + 64 raw bytes containing
      // raw u64(conn_id), 5 zero bytes, u16(title_id), 49 zero bytes
      const w = new BBWriter();
      w.u64(BigInt(this.connId));
      const extra = Buffer.alloc(64);
      extra.writeBigUInt64LE(BigInt(this.connId), 0); // raw u64 conn_id
      // 5 zero bytes at offset 8-12
      extra.writeUInt16LE(this.player.titleId, 13); // u16 title_id
      // 49 zero bytes at offset 15-63
      this.sendFrame(4, Buffer.concat([w.toBuffer(), extra]));
    } catch (err) {
      this.logger.error(`[${this.connId}] hello parse error: ${err}`);
      this.destroy();
    }
  }

  private handleService(serviceType: number, payload: Buffer): void {
    if (!this.isAuthenticated) {
      this.logger.warn(`[${this.connId}] service call before auth (type=${serviceType})`);
      this.sendFrame(serviceType, Buffer.alloc(0));
      return;
    }

    // Rate limiting
    const now = Date.now();
    this.player.serviceCallTimes = this.player.serviceCallTimes.filter(
      (t) => now - t < 1000,
    );
    if (this.player.serviceCallTimes.length > MAX_SERVICE_CALLS_PER_SEC) {
      this.logger.warn(`[${this.connId}] rate limited`);
      return;
    }
    this.player.serviceCallTimes.push(now);

    // Extract op byte (same logic as Python: body[1] if body[0]==TAG.U8, else body[0])
    // But pass the FULL body to handlers — Python handlers read the op byte themselves
    let op = 0;
    if (payload.length >= 2 && payload[0] === TAG.U8) {
      op = payload[1];
    } else if (payload.length >= 1) {
      op = payload[0];
    }

    const serviceName = SERVICE_TYPES[serviceType] || `unknown_${serviceType}`;
    this.logger.log(`[${this.connId}] RX ${serviceName}(${serviceType}) op=${op} len=${payload.length} body=${payload.toString('hex').substring(0, 80)}`);

    this.dispatcher
      .dispatch(serviceType, op, payload, this)
      .catch((err) => this.logger.error(`[${this.connId}] dispatch error: ${err}`));
  }

  /** Build and send a TaskReply frame (msg_type=1).
   * Format: u64(txn) + u32(error) + u8(op) + u32(n) + u32(n) + results
   * This matches Python's send_task_reply / reply_ok / reply_empty. */
  sendTaskReply(op: number, results: Buffer, n: number = 0, error: number = BD_NO_ERROR): void {
    const w = new BBWriter();
    w.u64(BigInt(++this.txn));
    w.u32(error);
    w.u8(op);
    w.u32(n);
    w.u32(n);
    if (results && results.length > 0) {
      w.raw(results);
    }
    const payload = w.toBuffer();
    if (this.logger && results && results.length > 0) {
      this.logger.debug(`[${this.connId}] reply op=${op} n=${n} results_hex=${results.toString('hex').slice(0, 200)}`);
    }
    this.sendFrame(1, payload);
  }

  /** Shorthand for empty reply (n=0, no results) */
  replyEmpty(op: number): void {
    this.sendTaskReply(op, Buffer.alloc(0), 0);
  }

  sendFrame(msgType: number, payload: Buffer): void {
    const padding = Buffer.from([0x00]);
    const typeByte = Buffer.from([msgType]);
    const body = Buffer.concat([padding, typeByte, payload]);
    const sizeBuf = Buffer.alloc(4);
    sizeBuf.writeUInt32LE(body.length, 0);
    const frame = Buffer.concat([sizeBuf, body]);

    if (!this.socket.destroyed) {
      this.socket.write(frame);
      // Log full frame hex for debugging (first 100 bytes)
      if (frame.length > 2 && frame[5] === 0x01) {
        this.logger.debug(`[${this.connId}] TX frame hex=${frame.toString('hex').slice(0, 200)}`);
      }
    }
  }

  private sendKeepalive(): void {
    if (this.alive && !this.socket.destroyed) {
      this.socket.write(KEEPALIVE_FRAME);
    }
  }

  private cleanup(): void {
    this.alive = false;
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }

    // Remove from active connections
    const idx = BBConnection.activeConnections.indexOf(this);
    if (idx >= 0) BBConnection.activeConnections.splice(idx, 1);

    // Decrement per-IP count
    const ipKey = this.socket.remoteAddress || '';
    const count = BBConnection.ipConnections.get(ipKey) || 0;
    if (count <= 1) {
      BBConnection.ipConnections.delete(ipKey);
    } else {
      BBConnection.ipConnections.set(ipKey, count - 1);
    }

    // Notify dispatcher for session cleanup
    this.dispatcher.onDisconnect(this);

    if (!this.socket.destroyed) {
      this.socket.destroy();
    }
  }

  destroy(): void {
    this.cleanup();
  }

  static get activeCount(): number {
    return BBConnection.activeConnections.length;
  }

  /** Count how many active players have the given group ID in their list */
  static getGroupCount(groupId: number): number {
    return BBConnection.activeConnections.filter(
      (c) => c.player.groupIds.includes(groupId),
    ).length;
  }

  static getConnectionsForIP(ip: string): number {
    return BBConnection.ipConnections.get(ip) || 0;
  }
}
