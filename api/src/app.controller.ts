import { Body, Controller, Get, Post, Response } from '@nestjs/common';
import type { Response as ExpressResponse } from 'express';
import { AppService } from './app.service';
import { MetricsService } from './metrics/metrics.service';
import { ThreatIndicatorService } from './security/threat-indicator.service';
import { MemcachedService } from './security/memcached.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly threatIndicatorService: ThreatIndicatorService,
    private readonly metricsService: MetricsService,
    private readonly memcachedService: MemcachedService,
  ) { }

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('/healthz')
  health(): { status: string } {
    return { status: 'ok' };
  }

  @Get('/readyz')
  async ready(): Promise<{ status: string }> {
    const ok = await this.memcachedService.ping();
    if (!ok) {
      throw new Error('Memcached connection unavailable');
    }
    return { status: 'ok' };
  }

  @Get('/metrics')
  async metrics(@Response() res: ExpressResponse): Promise<void> {
    const metricsOutput = await this.metricsService.getMetrics();
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(metricsOutput);
  }

  @Post('/upsert')
  async upsertIndicator(@Body() body: { indicator: string }): Promise<{ success: boolean; indicator: string }> {
    const { indicator } = body;
    if (!indicator || typeof indicator !== 'string') {
      throw new Error('Invalid indicator: must be a non-empty string');
    }
    await this.threatIndicatorService.upsertIndicator(indicator);
    return { success: true, indicator };
  }

  @Post('/lookup')
  async lookup(@Body() body: { indicator: string }): Promise<{ found: boolean; source: string; indicator: string }> {
    const { indicator } = body;
    if (!indicator || typeof indicator !== 'string') {
      throw new Error('Invalid indicator: must be a non-empty string');
    }
    return this.threatIndicatorService.lookup(indicator);
  }
}
