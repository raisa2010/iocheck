import { BadRequestException, Body, Controller, Get, Post, Response } from '@nestjs/common';
import type { Response as ExpressResponse } from 'express';
import { AppService } from './app.service';
import { DatabaseService } from './database/database.service';
import { MetricsService } from './metrics/metrics.service';
import { MemcachedService } from './security/memcached.service';
import { ThreatIndicatorService } from './security/threat-indicator.service';

type IocType = 'ip' | 'domain' | 'sha256';

interface LookupRequest {
  type: IocType;
  value: string;
}

interface IocRequest {
  type: IocType;
  value: string;
  source: string;
  score: number;
}

interface IocResponse {
  type: IocType;
  value: string;
  source: string;
  score: number;
}

interface LookupResponse {
  verdict: 'malicious' | 'unknown';
  ioc?: IocResponse;
}

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly threatIndicatorService: ThreatIndicatorService,
    private readonly metricsService: MetricsService,
    private readonly memcachedService: MemcachedService,
    private readonly databaseService: DatabaseService,
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
    const dbOk = await this.databaseService.ping();
    if (!dbOk) {
      throw new Error('Database connection unavailable');
    }
    return { status: 'ok' };
  }

  @Get('/metrics')
  async metrics(@Response() res: ExpressResponse): Promise<void> {
    const metricsOutput = await this.metricsService.getMetrics();
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(metricsOutput);
  }

  @Post('/ioc')
  async upsertIoc(@Body() body: IocRequest): Promise<LookupResponse> {
    const { type, value, source, score } = body;
    if (!this.isValidType(type)) {
      throw new BadRequestException('Invalid type, must be ip, domain, or sha256');
    }
    if (!value || typeof value !== 'string') {
      throw new BadRequestException('Invalid value: must be a non-empty string');
    }
    if (!source || typeof source !== 'string') {
      throw new BadRequestException('Invalid source: must be a non-empty string');
    }
    if (!Number.isInteger(score) || score < 0 || score > 100) {
      throw new BadRequestException('Invalid score: must be an integer between 0 and 100');
    }

    const ioc = await this.threatIndicatorService.upsertIoc({ type, value, source, score });
    return { verdict: 'malicious', ioc };
  }

  @Post('/lookup')
  async lookup(@Body() body: LookupRequest): Promise<LookupResponse> {
    const { type, value } = body;
    if (!this.isValidType(type)) {
      throw new BadRequestException('Invalid type, must be ip, domain, or sha256');
    }
    if (!value || typeof value !== 'string') {
      throw new BadRequestException('Invalid value: must be a non-empty string');
    }

    const result = await this.threatIndicatorService.lookupIoc(type, value);
    if (!result.found) {
      return { verdict: 'unknown' };
    }

    return { verdict: 'malicious', ioc: result.ioc };
  }

  private isValidType(type: string): type is IocType {
    return ['ip', 'domain', 'sha256'].includes(type);
  }
}
