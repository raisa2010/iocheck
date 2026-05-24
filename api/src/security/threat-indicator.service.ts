import { Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { DatabaseService } from '../database/database.service';
import { MetricsService } from '../metrics/metrics.service';
import { MemcachedService } from './memcached.service';

export type IocType = 'ip' | 'domain' | 'sha256';

export interface IocRecord {
    type: IocType;
    value: string;
    source: string;
    score: number;
}

@Injectable()
export class ThreatIndicatorService {
    private readonly logger = new Logger(ThreatIndicatorService.name);
    private readonly maliciousIndicators = new Set<string>([
        '203.0.113.11',
        '198.51.100.42',
        // Add more known malicious IPs or indicators here.
    ]);
    private readonly iocRecords = new Map<string, IocRecord>();

    constructor(
        private readonly memcachedService?: MemcachedService,
        private readonly metricsService?: MetricsService,
        private readonly databaseService?: DatabaseService,
    ) {
        this.loadIndicatorsFromEnvironment();
    }

    getIndicators(): string[] {
        return Array.from(this.maliciousIndicators);
    }

    /** Returns the first matching indicator (cached or configured) or null. */
    async findMatchingIndicator(request: Request): Promise<string | null> {
        const ips = this.extractRequestIps(request);

        for (const ip of ips) {
            // check in memory cache first
            if (this.isMaliciousIndicator(ip)) {
                return ip;
            }

            // check distributed cache second
            try {
                const cached = await this.memcachedService?.get(`blocked:${ip}`);
                if (cached) return ip;
            } catch (_) {
                // ignore cache errors and fall back to in-memory list
            }

            // check database third
            try {
                const found = await this.databaseService?.findByTypeAndValue('ip', this.normalizeIndicator(ip));
                if (found) return ip;
            } catch (_) {
                // ignore database errors and fall back to in-memory list
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

    /** Upsert an IOC to local, memcached, and PostgreSQL. */
    async upsertIoc(ioc: IocRecord): Promise<IocRecord> {
        const normalized = this.normalizeValue(ioc.value, ioc.type);
        const key = this.formatKey(ioc.type, normalized);
        const record: IocRecord = { ...ioc, value: normalized };
        this.iocRecords.set(key, record);
        this.metricsService?.recordThreatIndicatorUpsert();

        if (ioc.type === 'ip') {
            this.maliciousIndicators.add(normalized);
        }

        try {
            await this.memcachedService?.set(`blocked:${key}`, JSON.stringify(record));
            this.metricsService?.recordMemcachedOperation('set', 'success');
        } catch (err) {
            this.metricsService?.recordMemcachedOperation('set', 'error');
        }

        try {
            await this.databaseService?.upsertIoc(ioc.type, ioc.value, ioc.source, ioc.score);
            this.metricsService?.recordDatabaseOperation('upsert', 'success');
        } catch (err) {
            this.metricsService?.recordDatabaseOperation('upsert', 'error');
        }

        return record;
    }

    /**
     * Lookup an IOC using 3-tier cache: local map → memcached → PostgreSQL.
     */
    async lookupIoc(type: IocType, value: string): Promise<{ found: boolean; source: string; ioc?: IocRecord }> {
        const normalized = this.normalizeValue(value, type);
        const key = this.formatKey(type, normalized);

        const local = this.iocRecords.get(key);
        if (local) {
            this.metricsService?.recordThreatIndicatorLookup(true, 'local');
            return { found: true, source: 'local', ioc: local };
        } else {
            this.metricsService?.recordThreatIndicatorLookup(false, 'local');
        }

        try {
            const cached = await this.memcachedService?.get(`blocked:${key}`);
            this.metricsService?.recordMemcachedOperation('get', 'success');
            if (cached) {
                try {
                    const record: IocRecord = JSON.parse(cached);
                    this.metricsService?.recordThreatIndicatorLookup(true, 'memcached');
                    return { found: true, source: 'memcached', ioc: record };
                } catch (err: any) {
                    this.logger.debug(`Failed to parse memcached IOC record for ${key}: ${err.message ?? err}`);
                }
            } else {
                this.metricsService?.recordThreatIndicatorLookup(false, 'memcached');
            }
        } catch (_) {
            this.metricsService?.recordMemcachedOperation('get', 'error');
        }

        try {
            const found = await this.databaseService?.findByTypeAndValue(type, normalized);
            if (found) {
                const dbRecord: IocRecord = { type, value: normalized, source: found.source, score: found.score };
                this.metricsService?.recordThreatIndicatorLookup(true, 'postgres');
                this.metricsService?.recordDatabaseOperation('find', 'success');
                return { found: true, source: 'postgres', ioc: dbRecord };
            } else {
                this.metricsService?.recordThreatIndicatorLookup(false, 'postgres');
            }
        } catch (_) {
            this.metricsService?.recordDatabaseOperation('find', 'error');
        }

        this.metricsService?.recordThreatIndicatorLookup(false, 'not_found');
        return { found: false, source: 'not_found' };
    }

    private formatKey(type: IocType, value: string): string {
        return `${type}:${value}`;
    }

    private normalizeValue(value: string, type: IocType): string {
        const normalized = value.trim();
        if (type === 'domain' || type === 'sha256') {
            return normalized.toLowerCase();
        }
        return normalized.replace(/^::ffff:/, '');
    }
}
