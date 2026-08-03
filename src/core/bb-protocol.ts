import { Injectable, Logger } from '@nestjs/common';
import { BBConnection } from './bb-connection';

/**
 * Service dispatcher — routes incoming service calls to registered handlers.
 * Replaces Python's SERVICE_HANDLERS dict + Connection.service() method.
 */
export type ServiceHandler = (
  op: number,
  body: Buffer,
  conn: BBConnection,
) => void | Promise<void>;

@Injectable()
export class ServiceDispatcher {
  private readonly logger = new Logger('ServiceDispatcher');
  private handlers = new Map<number, ServiceHandler>();
  private onDisconnectCallbacks: ((conn: BBConnection) => void)[] = [];

  register(serviceType: number, handler: ServiceHandler): void {
    this.handlers.set(serviceType, handler);
  }

  registerOnDisconnect(cb: (conn: BBConnection) => void): void {
    this.onDisconnectCallbacks.push(cb);
  }

  async dispatch(serviceType: number, op: number, body: Buffer, conn: BBConnection): Promise<void> {
    const handler = this.handlers.get(serviceType);
    if (!handler) {
      this.logger.debug(`no handler for service ${serviceType} — empty reply`);
      conn.replyEmpty(op);
      return;
    }
    try {
      await handler(op, body, conn);
    } catch (err) {
      this.logger.error(
        `service ${serviceType} op=${op} error: ${err instanceof Error ? err.message : String(err)}`,
      );
      conn.replyEmpty(op);
    }
  }

  onDisconnect(conn: BBConnection): void {
    for (const cb of this.onDisconnectCallbacks) {
      try {
        cb(conn);
      } catch (err) {
        this.logger.error(`onDisconnect callback error: ${err}`);
      }
    }
  }
}
