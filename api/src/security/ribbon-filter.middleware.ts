import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { MetricsService } from '../metrics/metrics.service';
import { MemcachedService } from './memcached.service';
import { ThreatIndicatorService } from './threat-indicator.service';

@Injectable()
export class RibbonFilterMiddleware implements NestMiddleware {
    private readonly logger = new Logger(RibbonFilterMiddleware.name);

    constructor(
        private readonly threatIndicatorService: ThreatIndicatorService,
        private readonly memcachedService: MemcachedService,
        private readonly metricsService: MetricsService,
    ) { }

    async use(req: Request, res: Response, next: NextFunction): Promise<void> {
        const matched = await this.threatIndicatorService.findMatchingIndicator(req);
        if (matched) {
            const indicator = matched || req.ip || req.socket.remoteAddress || 'unknown';
            this.logger.warn(`Blocked request from known malicious indicator: ${indicator}`);
            this.metricsService.recordRibbonFilterBlock('malicious_indicator');
            // cache the blocked indicator so subsequent checks are fast
            const ttl = Number(process.env.MALICIOUS_CACHE_TTL ?? 3600);
            try {
                await this.memcachedService.set(`blocked:${indicator}`, '1', ttl);
                this.metricsService.recordMemcachedOperation('set', 'success');
            } catch (err) {
                this.metricsService.recordMemcachedOperation('set', 'error');
                // ignore cache set errors
            }

            res.setHeader('X-Ribbon-Filter', 'blocked');
            res.status(403).json({
                statusCode: 403,
                message: 'Access denied. Known malicious indicator detected.',
            });
            return;
        }

        this.metricsService.recordRibbonFilterPass();
        res.setHeader('X-Ribbon-Filter', 'passed');
        next();
    }
}
