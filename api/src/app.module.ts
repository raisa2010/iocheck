import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LatencyMiddleware } from './metrics/latency.middleware';
import { MetricsService } from './metrics/metrics.service';
import { MemcachedService } from './security/memcached.service';
import { RibbonFilterMiddleware } from './security/ribbon-filter.middleware';
import { ThreatIndicatorService } from './security/threat-indicator.service';

@Module({
  imports: [],
  controllers: [AppController],
  providers: [AppService, ThreatIndicatorService, MemcachedService, MetricsService, RibbonFilterMiddleware, LatencyMiddleware],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LatencyMiddleware).forRoutes({ path: 'lookup', method: RequestMethod.POST });
    // consumer.apply(RibbonFilterMiddleware).forRoutes('*');
  }
}
