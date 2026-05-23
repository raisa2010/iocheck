import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseService } from './database/database.service';
import { ThreatIndicator } from './database/entities/threat-indicator.entity';
import { LatencyMiddleware } from './metrics/latency.middleware';
import { MetricsService } from './metrics/metrics.service';
import { MemcachedService } from './security/memcached.service';
import { RibbonFilterMiddleware } from './security/ribbon-filter.middleware';
import { ThreatIndicatorService } from './security/threat-indicator.service';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.POSTGRES_HOST ?? 'localhost',
      port: Number(process.env.POSTGRES_PORT ?? 5432),
      database: process.env.POSTGRES_DB ?? 'myapp',
      username: process.env.POSTGRES_USER ?? 'strongkeep',
      password: process.env.POSTGRES_PASSWORD ?? 'postgres',
      entities: [ThreatIndicator],
      synchronize: true,
      dropSchema: process.env.NODE_ENV === 'test',
      logging: false,
    }),
    TypeOrmModule.forFeature([ThreatIndicator]),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    ThreatIndicatorService,
    MemcachedService,
    MetricsService,
    RibbonFilterMiddleware,
    LatencyMiddleware,
    DatabaseService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LatencyMiddleware).forRoutes({ path: 'lookup', method: RequestMethod.POST });
    // consumer.apply(RibbonFilterMiddleware).forRoutes('*');
  }
}
