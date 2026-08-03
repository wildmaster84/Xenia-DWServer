import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { createServer, Server as TCPServer, Socket } from 'net';
import { BBConnection } from './bb-connection';
import { ServiceDispatcher } from './bb-protocol';
import { MAX_CONNECTIONS_PER_IP } from './bb-constants';

@Injectable()
export class TcpServer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('TcpServer');
  private server: TCPServer | null = null;

  constructor(private dispatcher: ServiceDispatcher) {}

  onModuleInit() {
    this.server = createServer((socket: Socket) => {
      const ip = socket.remoteAddress || '';
      if (BBConnection.getConnectionsForIP(ip) >= MAX_CONNECTIONS_PER_IP) {
        this.logger.warn(`connection limit reached for ${ip} — rejecting`);
        socket.destroy();
        return;
      }

      const conn = new BBConnection(socket, this.dispatcher);
      conn.start();
      this.logger.debug(`new connection from ${ip}:${socket.remotePort} (id=${conn['connId']})`);
    });

    this.server.listen(30003, '0.0.0.0', () => {
      this.logger.log('Demonware TCP server listening on 0.0.0.0:30003');
    });
  }

  onModuleDestroy() {
    this.logger.log('Shutting down TCP server...');
    for (const conn of BBConnection.allActiveConnections) {
      conn.destroy();
    }
    this.server?.close();
  }
}
