import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { MetricsService } from './metrics.service';

@Injectable()
export class LatencyMiddleware implements NestMiddleware {
    constructor(private readonly metricsService: MetricsService) { }

    use(req: Request, res: Response, next: NextFunction): void {
        const start = process.hrtime.bigint();

        res.once('finish', () => {
            const elapsedNanos = process.hrtime.bigint() - start;
            const elapsedSeconds = Number(elapsedNanos) / 1e9;
            const route = req.route?.path ?? req.path;
            this.metricsService.recordRequestLatency(req.method, route, elapsedSeconds);
            this.metricsService.recordHttpRequest(req.method, route, res.statusCode);
        });

        next();
    }
}
