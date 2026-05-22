import { Injectable, Logger } from '@nestjs/common';

// Use dynamic require to avoid type import issues if memjs types aren't present.
const memjs = require('memjs');

@Injectable()
export class MemcachedService {
  private readonly logger = new Logger(MemcachedService.name);
  private client: any;

  constructor() {
    const servers = process.env.MEMCACHED_SERVERS ?? 'localhost:11211';
    try {
      this.client = memjs.Client.create(servers);
    } catch (err) {
      this.logger.warn('Failed to create memcached client; memcached operations will be no-ops');
      this.client = null;
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.client) return null;
    return new Promise((resolve) => {
      this.client.get(key, (err: any, val: any) => {
        if (err) {
          this.logger.debug(`memcached get error for ${key}: ${err.message ?? err}`);
          return resolve(null);
        }
        if (!val || !val.value) return resolve(null);
        return resolve(val.value.toString());
      });
    });
  }

  async set(key: string, value: string, ttlSeconds = 3600): Promise<void> {
    if (!this.client) return;
    return new Promise((resolve) => {
      this.client.set(key, value, { expires: ttlSeconds }, (err: any) => {
        if (err) this.logger.debug(`memcached set error for ${key}: ${err.message ?? err}`);
        resolve();
      });
    });
  }
}
