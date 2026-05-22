import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MetricsService } from './metrics/metrics.service';
import { MemcachedService } from './security/memcached.service';
import { RibbonFilterMiddleware } from './security/ribbon-filter.middleware';
import { ThreatIndicatorService } from './security/threat-indicator.service';

@Module({
  imports: [],
  controllers: [AppController],
  providers: [AppService, ThreatIndicatorService, MemcachedService, MetricsService, RibbonFilterMiddleware],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // consumer.apply(RibbonFilterMiddleware).forRoutes('*');
  }
}
