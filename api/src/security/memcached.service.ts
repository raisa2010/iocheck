import { Injectable, Logger } from '@nestjs/common';

// Use dynamic require to avoid type import issues if memjs types aren't present.
const memjs = require('memjs');

@Injectable()
export class MemcachedService {
    private readonly logger = new Logger(MemcachedService.name);
    private client: any;
    // private getAsync: (key: string) => Promise<any>;
    // private setAsync: (key: string, value: string, options: any) => Promise<any>;

    constructor() {
        console.log(process.env.MEMCACHED_SERVERS, '-------');
        const servers = process.env.MEMCACHED_SERVERS ?? 'localhost:11211';
        try {
            this.client = memjs.Client.create(servers);
            // this.getAsync = this.client.get;
            // this.setAsync = this.client.set;
        } catch (err) {
            console.log('warning! failed to create client')
            this.logger.warn('Failed to create memcached client; memcached operations will be no-ops');
            this.client = null;
            // this.getAsync = async () => null;
            // this.setAsync = async () => null;
        }
    }

    async get(key: string): Promise<string | null> {
        if (!this.client) return null;

        try {
            const val = await this.client.get(key);
            if (!val || !val.value) return null;
            return val.value.toString();
        } catch (err: any) {
            this.logger.debug(`memcached get error for ${key}: ${err.message ?? err}`);
            return null;
        }
    }

    async set(key: string, value: string, ttlSeconds = 3600): Promise<void> {
        if (!this.client) return;

        try {
            await this.client.set(key, value, { expires: ttlSeconds });
        } catch (err: any) {
            this.logger.debug(`memcached set error for ${key}: ${err.message ?? err}`);
        }
    }

    async ping(): Promise<boolean> {
        if (!this.client) return false;

        const key = `healthcheck:${Date.now()}`;
        try {
            await this.client.set(key, '1', 5);
            const value = await this.client.get(key);
            return Boolean(value);
        } catch (err: any) {
            this.logger.debug(`memcached ping error: ${err.message ?? err}`);
            return false;
        }
    }

    async delete(key: string): Promise<void> {
        if (!this.client) return;

        try {
            await this.client.delete(key);
        } catch (err: any) {
            this.logger.debug(`memcached delete error for ${key}: ${err.message ?? err}`);
        }
    }
}
