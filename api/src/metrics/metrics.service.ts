import { Injectable, Logger } from '@nestjs/common';
import * as promClient from 'prom-client';

@Injectable()
export class MetricsService {
    private readonly logger = new Logger(MetricsService.name);

    private ribbonFilterBlocksCounter!: promClient.Counter<string>;
    private ribbonFilterPassesCounter!: promClient.Counter<string>;
    private threatIndicatorLookupsCounter!: promClient.Counter<string>;
    private threatIndicatorUpsertsCounter!: promClient.Counter<string>;
    private memcachedOperationsCounter!: promClient.Counter<string>;
    private databaseOperationsCounter!: promClient.Counter<string>;
    private httpRequestsTotal!: promClient.Counter<string>;
    private httpRequestDurationHistogram!: promClient.Histogram<string>;

    constructor() {
        this.initializeMetrics();
    }

    private initializeMetrics(): void {
        // Ribbon filter metrics
        this.ribbonFilterBlocksCounter = new promClient.Counter({
            name: 'ribbon_filter_blocks_total',
            help: 'Total number of requests blocked by ribbon filter',
            labelNames: ['reason'],
        });

        this.ribbonFilterPassesCounter = new promClient.Counter({
            name: 'ribbon_filter_passes_total',
            help: 'Total number of requests passed by ribbon filter',
        });

        // Threat indicator lookup metrics
        this.threatIndicatorLookupsCounter = new promClient.Counter({
            name: 'threat_indicator_lookups_total',
            help: 'Total number of threat indicator lookups',
            labelNames: ['found', 'source'],
        });

        // Threat indicator upsert metrics
        this.threatIndicatorUpsertsCounter = new promClient.Counter({
            name: 'threat_indicator_upserts_total',
            help: 'Total number of threat indicator upserts',
        });

        // Memcached operation metrics
        this.memcachedOperationsCounter = new promClient.Counter({
            name: 'memcached_operations_total',
            help: 'Total number of memcached operations',
            labelNames: ['operation', 'status'],
        });

         // Database operation metrics
         this.databaseOperationsCounter = new promClient.Counter({
            name: 'database_operations_total',
            help: 'Total number of database operations',
            labelNames: ['operation', 'status'],
        });

        this.httpRequestsTotal = new promClient.Counter({
            name: 'http_requests_total',
            help: 'Total number of HTTP requests',
            labelNames: ['method', 'route', 'status'],
        });

        this.httpRequestDurationHistogram = new promClient.Histogram({
            name: 'http_request_duration_seconds',
            help: 'Bucketed latency for HTTP requests',
            labelNames: ['method', 'route'],
            buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
        });
    }

    recordRibbonFilterBlock(reason = 'malicious_indicator'): void {
        this.ribbonFilterBlocksCounter.inc({ reason });
    }

    recordRibbonFilterPass(): void {
        this.ribbonFilterPassesCounter.inc();
    }

    recordThreatIndicatorLookup(found: boolean, source: string): void {
        this.threatIndicatorLookupsCounter.inc({
            found: found ? 'true' : 'false',
            source,
        });
    }

    recordThreatIndicatorUpsert(): void {
        this.threatIndicatorUpsertsCounter.inc();
    }

    recordMemcachedOperation(operation: 'get' | 'set', status: 'success' | 'error'): void {
        this.memcachedOperationsCounter.inc({ operation, status });
    }

    recordDatabaseOperation(operation: 'upsert' | 'find', status: 'success' | 'error'): void {
        this.databaseOperationsCounter.inc({ operation, status });
    }

    recordHttpRequest(method: string, route: string, status: number): void {
        this.httpRequestsTotal.inc({ method, route, status: status.toString() });
    }

    recordRequestLatency(method: string, route: string, durationSeconds: number): void {
        this.httpRequestDurationHistogram.observe({ method, route }, durationSeconds);
    }

    /**
     * Returns all metrics in Prometheus exposition format
     */
    async getMetrics(): Promise<string> {
        return promClient.register.metrics();
    }
}
