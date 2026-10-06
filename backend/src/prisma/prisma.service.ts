import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppConfig } from '../config/app-config';
import { requestContext } from '../common/request-context';
import { Prisma, PrismaClient } from '../generated/prisma/client';

export type QueryListener = (event: Prisma.QueryEvent) => void;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  private readonly listeners = new Set<QueryListener>();
  private readonly logger = new Logger('SQL');

  constructor(config: AppConfig) {
    // statement_timeout applies to every query of the application pool (ASYNC-5 Fix); migrate and seed use their own connections.
    const adapter = new PrismaPg({ connectionString: config.databaseUrl, statement_timeout: config.statementTimeoutMs });
    super({
      adapter,
      // Defaults of Prisma 7.10 (runtime/client.js: maxWait 2e3, timeout 5e3), stated explicitly (spec 8).
      transactionOptions: { maxWait: 2000, timeout: 5000 },
      log: [{ emit: 'event', level: 'query' }],
    });
    // Query events always flow: tests count them (DoD-11); the log gets them only with LOG_SQL=true (CFG-2).
    const on = this.$on.bind(this) as (event: 'query', callback: QueryListener) => void;
    on('query', (event) => {
      for (const listener of this.listeners) listener(event);
      if (config.logSql) {
        this.logger.log({
          requestId: requestContext.getStore()?.requestId,
          query: event.query,
          durationMs: event.duration,
          ...(config.logSqlParams ? { params: event.params } : {}),
        });
      }
    });
  }

  onQuery(listener: QueryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
