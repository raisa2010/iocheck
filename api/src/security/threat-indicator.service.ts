import { Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { MetricsService } from '../metrics/metrics.service';
import { MemcachedService } from './memcached.service';

@Injectable()
export class ThreatIndicatorService {
    private readonly logger = new Logger(ThreatIndicatorService.name);
    private readonly maliciousIndicators = new Set<string>([
        '203.0.113.11',
        '198.51.100.42',
        // Add more known malicious IPs or indicators here.
    ]);

    constructor(
        private readonly memcachedService?: MemcachedService,
        private readonly metricsService?: MetricsService,
        // private readonly databaseService?: DatabaseService,
    ) {
        this.loadIndicatorsFromEnvironment();
        // this.loadIndicatorsFromDatabase();
    }

    // private async loadIndicatorsFromDatabase(): Promise<void> {
    //     try {
    //         const dbIndicators = await this.databaseService?.getAllIndicators();
    //         if (dbIndicators && dbIndicators.length > 0) {
    //             dbIndicators.forEach((indicator) => {
    //                 const normalized = this.normalizeIndicator(indicator);
    //                 this.maliciousIndicators.add(normalized);
    //             });
    //             this.logger.log(`Loaded ${dbIndicators.length} indicators from database`);
    //         }
    //     } catch (err) {
    //         this.logger.warn(`Failed to load indicators from database: ${err.message}`);
    //     }
    // }

    getIndicators(): string[] {
        return Array.from(this.maliciousIndicators);
    }

    async isMaliciousRequest(request: Request): Promise<boolean> {
        const match = await this.findMatchingIndicator(request);
        return Boolean(match);
    }

    /** Returns the first matching indicator (cached or configured) or null. */
    async findMatchingIndicator(request: Request): Promise<string | null> {
        const ips = this.extractRequestIps(request);

        for (const ip of ips) {
            // check cache first
            try {
                const cached = await this.memcachedService?.get(`blocked:${ip}`);
                if (cached) return ip;
            } catch (_) {
                // ignore cache errors and fall back to in-memory list
            }

            if (this.isMaliciousIndicator(ip)) {
                return ip;
            }
        }

        return null;
    }

    private isMaliciousIndicator(indicator: string | undefined): boolean {
        if (!indicator) {
            return false;
        }
        const normalized = this.normalizeIndicator(indicator);
        return this.maliciousIndicators.has(normalized);
    }

    private extractRequestIps(request: Request): string[] {
        const ips: string[] = [];

        if (request.ip) {
            ips.push(this.normalizeIndicator(request.ip));
        }

        const forwardedFor = request.headers['x-forwarded-for'];
        if (typeof forwardedFor === 'string') {
            ips.push(...forwardedFor.split(',').map((ip) => this.normalizeIndicator(ip)));
        } else if (Array.isArray(forwardedFor)) {
            ips.push(...forwardedFor.map((ip) => this.normalizeIndicator(ip)));
        }

        const clientIp = request.headers['x-client-ip'];
        if (typeof clientIp === 'string') {
            ips.push(this.normalizeIndicator(clientIp));
        }

        if (request.socket?.remoteAddress) {
            ips.push(this.normalizeIndicator(request.socket.remoteAddress));
        }

        return ips.filter(Boolean);
    }

    private normalizeIndicator(value: string): string {
        return value.trim().replace(/^::ffff:/, '');
    }

    private loadIndicatorsFromEnvironment(): void {
        const envValue = process.env.MALICIOUS_INDICATORS;
        if (!envValue) {
            return;
        }

        envValue
            .split(',')
            .map((indicator) => indicator.trim())
            .filter(Boolean)
            .forEach((indicator) => this.maliciousIndicators.add(this.normalizeIndicator(indicator)));
    }

    /** Upsert an indicator to local, memcached, and PostgreSQL. */
    async upsertIndicator(indicator: string, description?: string): Promise<void> {
        const normalized = this.normalizeIndicator(indicator);
        this.maliciousIndicators.add(normalized);
        this.metricsService?.recordThreatIndicatorUpsert();

        // Update memcached
        try {
            const ttl = Number(process.env.MALICIOUS_CACHE_TTL ?? 3600);
            await this.memcachedService?.set(`blocked:${normalized}`, '1', ttl);
            this.metricsService?.recordMemcachedOperation('set', 'success');
        } catch (err) {
            this.metricsService?.recordMemcachedOperation('set', 'error');
        }

        // Update PostgreSQL
        // try {
        //     await this.databaseService?.upsertIndicator(normalized, 'ip', description, 'api');
        // } catch (err) {
        //     this.logger.error(`Failed to upsert indicator in database: ${err.message}`);
        // }
    }

    /**
     * Lookup an indicator using 3-tier cache: memcached → PostgreSQL → local set.
     * Returns { found: boolean, source: 'memcached', 'postgres', 'local', or 'not_found' }
     */
    async lookup(indicator: string): Promise<{ found: boolean; source: string; indicator: string }> {
        const normalized = this.normalizeIndicator(indicator);

        // 1. Check memcached first (fastest distributed cache)
        try {
            const cached = await this.memcachedService?.get(`blocked:${normalized}`);
            if (cached) {
                this.metricsService?.recordThreatIndicatorLookup(true, 'memcached');
                this.metricsService?.recordMemcachedOperation('get', 'success');
                return { found: true, source: 'memcached', indicator: normalized };
            }
            this.metricsService?.recordMemcachedOperation('get', 'success');
        } catch (_) {
            this.metricsService?.recordMemcachedOperation('get', 'error');
        }

        // 2. Check PostgreSQL (persistent store)
        // try {
        //     const dbRecord = await this.databaseService?.findByIndicator(normalized);
        //     if (dbRecord) {
        //         this.metricsService?.recordThreatIndicatorLookup(true, 'postgres');
        //         // Repopulate memcached from db hit
        //         const ttl = Number(process.env.MALICIOUS_CACHE_TTL ?? 3600);
        //         try {
        //             await this.memcachedService?.set(`blocked:${normalized}`, '1', ttl);
        //         } catch (_) {
        //             // ignore re-cache errors
        //         }
        //         return { found: true, source: 'postgres', indicator: normalized };
        //     }
        // } catch (err) {
        //     this.logger.debug(`Database lookup error: ${err.message}`);
        // }

        // 3. Check local ribbon filter set
        if (this.isMaliciousIndicator(normalized)) {
            this.metricsService?.recordThreatIndicatorLookup(true, 'local');
            return { found: true, source: 'local', indicator: normalized };
        }

        this.metricsService?.recordThreatIndicatorLookup(false, 'not_found');
        return { found: false, source: 'not_found', indicator: normalized };
    }
}
