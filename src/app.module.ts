import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TcpServer } from './core/tcp-server';
import { ServiceDispatcher } from './core/bb-protocol';
import { BBConnection } from './core/bb-connection';

// Infrastructure
import { XboxPresClient } from './infrastructure/xboxpres-client';
import { UserFileRepository } from './infrastructure/persistance/repositories/user-file.repository';
import { ClipRepository } from './infrastructure/persistance/repositories/clip.repository';
import { DWSessionRepository } from './infrastructure/persistance/repositories/dw-session.repository';
import { UserFile, UserFileSchema } from './infrastructure/persistance/models/user-file.schema';
import { Clip, ClipSchema } from './infrastructure/persistance/models/clip.schema';
import { DWSession, DWSessionSchema } from './infrastructure/persistance/models/dw-session.schema';

// Handlers
import { SimpleHandlers } from './application/handlers/simple.handlers';
import { StorageHandler } from './application/handlers/storage.handler';
import { ProfileHandler } from './application/handlers/profile.handler';
import { StatsHandler } from './application/handlers/stats.handler';
import { MatchmakingHandler } from './application/handlers/matchmaking.handler';
import { ContentStreamingHandler } from './application/handlers/content-streaming.handler';
import { PooledStorageHandler } from './application/handlers/pooled-storage.handler';
import { AntiCheatHandler } from './application/handlers/anticheat.handler';
import { TagsHandler } from './application/handlers/tags.handler';

// Services
import { StatsParser } from './application/services/stats-parser';

@Module({
  imports: [
    MongooseModule.forRoot('mongodb+srv://120.0.0.1:12345/xenia-dw'),
    MongooseModule.forFeature([
      { name: UserFile.name, schema: UserFileSchema },
      { name: Clip.name, schema: ClipSchema },
      { name: DWSession.name, schema: DWSessionSchema },
    ]),
  ],
  providers: [
    TcpServer,
    ServiceDispatcher,
    XboxPresClient,
    UserFileRepository,
    ClipRepository,
    DWSessionRepository,
    SimpleHandlers,
    StorageHandler,
    ProfileHandler,
    StatsHandler,
    MatchmakingHandler,
    ContentStreamingHandler,
    PooledStorageHandler,
    AntiCheatHandler,
    TagsHandler,
    StatsParser,
  ],
})
export class AppModule implements OnModuleInit {
  private readonly logger = new Logger('AppModule');

  constructor(
    private dispatcher: ServiceDispatcher,
    private simple: SimpleHandlers,
    private storage: StorageHandler,
    private profile: ProfileHandler,
    private stats: StatsHandler,
    private matchmaking: MatchmakingHandler,
    private contentStreaming: ContentStreamingHandler,
    private pooledStorage: PooledStorageHandler,
    private anticheat: AntiCheatHandler,
    private tags: TagsHandler,
  ) {}

  onModuleInit() {
    // Register all service handlers with the dispatcher
    this.dispatcher.register(3, (op, body, conn) => this.simple.handleTeams(op, body, conn));
    this.dispatcher.register(4, (op, body, conn) => this.stats.handle(op, body, conn));
    this.dispatcher.register(8, (op, body, conn) => this.profile.handle(op, body, conn));
    this.dispatcher.register(10, (op, body, conn) => this.storage.handle(op, body, conn));
    this.dispatcher.register(12, (op, body, conn) => this.simple.handleTitleUtilities(op, body, conn));
    this.dispatcher.register(15, (op, body, conn) => this.simple.handleKeyArchive(op, body, conn));
    this.dispatcher.register(21, (op, body, conn) => this.matchmaking.handle(op, body, conn));
    this.dispatcher.register(23, (op, body, conn) => this.simple.handleCounter(op, body, conn));
    this.dispatcher.register(27, (op, body, conn) => this.simple.handleDml(op, body, conn));
    this.dispatcher.register(28, (op, body, conn) => this.simple.handleGroup(op, body, conn));
    this.dispatcher.register(38, (op, body, conn) => this.anticheat.handle(op, body, conn));
    this.dispatcher.register(50, (op, body, conn) => this.contentStreaming.handle(op, body, conn));
    this.dispatcher.register(52, (op, body, conn) => this.tags.handle(op, body, conn));
    this.dispatcher.register(58, (op, body, conn) => this.pooledStorage.handle(op, body, conn));
    this.dispatcher.register(67, (op, body, conn) => this.simple.handleEventLog(op, body, conn));
    this.dispatcher.register(68, (op, body, conn) => this.simple.handleRichPresence(op, body, conn));
    this.dispatcher.register(81, (op, body, conn) => this.simple.handleLeague(op, body, conn));

    // Register disconnect handler for session cleanup
    this.dispatcher.registerOnDisconnect((conn: BBConnection) => {
      this.matchmaking.onDisconnect(conn).catch((err) =>
        this.logger.error(`onDisconnect cleanup error: ${err}`),
      );
    });

    this.logger.log('All service handlers registered');
  }
}
