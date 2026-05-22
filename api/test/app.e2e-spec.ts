import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { MetricsService } from './../src/metrics/metrics.service';
import { MemcachedService } from './../src/security/memcached.service';

describe('AppController (e2e)', () => {
  let app: INestApplication;
  const cache = new Map<string, string>();
  const memcachedStub: Partial<MemcachedService> = {
    ping: async () => true,
    get: async (key: string) => { return cache.get(key) ?? null; },
    set: async (key: string, value: string) => {
      cache.set(key, value);
    },
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MemcachedService)
      .useValue(memcachedStub)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('/healthz (GET)', () => {
    return request(app.getHttpServer())
      .get('/healthz')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('/readyz (GET) should call memcached ping', async () => {
    const spy = jest.spyOn(memcachedStub, 'ping');

    await request(app.getHttpServer())
      .get('/readyz')
      .expect(200)
      .expect({ status: 'ok' });

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('/upsert (POST) and /lookup (POST)', async () => {
    const upsertSpy = jest.spyOn(memcachedStub, 'set');
    const lookupSpy = jest.spyOn(memcachedStub, 'get');
    const upsertMetricsSpy = jest.spyOn(MetricsService.prototype, 'recordThreatIndicatorUpsert');
    const lookupMetricsSpy = jest.spyOn(MetricsService.prototype, 'recordThreatIndicatorLookup');
    const newIndicator = '203.0.113.55';

    await request(app.getHttpServer())
      .post('/upsert')
      .send({ indicator: newIndicator })
      .expect(201)
      .expect({ success: true, indicator: newIndicator });

    expect(upsertMetricsSpy).toHaveBeenCalledTimes(1);
    expect(upsertSpy).toHaveBeenCalledTimes(1);

    await request(app.getHttpServer())
      .post('/lookup')
      .send({ indicator: newIndicator })
      .expect(201)
      .expect({ found: true, source: 'local', indicator: newIndicator });

    expect(lookupSpy).toHaveBeenCalledTimes(0);
    expect(lookupMetricsSpy).toHaveBeenCalledTimes(1);
    expect(lookupMetricsSpy).toHaveBeenCalledWith(true, 'local');

    upsertMetricsSpy.mockRestore();
    lookupMetricsSpy.mockRestore();
    upsertSpy.mockRestore();
    lookupSpy.mockRestore();
  });

  it('/lookup (POST) should resolve from local ribbon filter without calling memcached', async () => {
    const upsertSpy = jest.spyOn(memcachedStub, 'set');
    const lookupSpy = jest.spyOn(memcachedStub, 'get');
    const metricsSpy = jest.spyOn(MetricsService.prototype, 'recordThreatIndicatorLookup');
    const indicator = '203.0.113.12';

    await request(app.getHttpServer())
      .post('/upsert')
      .send({ indicator })
      .expect(201)
      .expect({ success: true, indicator });

    expect(upsertSpy).toHaveBeenCalledTimes(1);

    await request(app.getHttpServer())
      .post('/lookup')
      .send({ indicator })
      .expect(201)
      .expect({ found: true, source: 'local', indicator });

    expect(metricsSpy).toHaveBeenCalledTimes(1);
    expect(metricsSpy).toHaveBeenCalledWith(true, 'local');

    upsertSpy.mockRestore();
    lookupSpy.mockRestore();
    metricsSpy.mockRestore();
  });

  it('/lookup (POST) should resolve from memcached when not present locally', async () => {
    const spy = jest.spyOn(memcachedStub, 'get');
    const metricsSpy = jest.spyOn(MetricsService.prototype, 'recordThreatIndicatorLookup');
    const memcachedOperationSpy = jest.spyOn(MetricsService.prototype, 'recordMemcachedOperation');
    const indicator = '198.18.0.1';

    await memcachedStub.set?.(`blocked:${indicator}`, '1');

    await request(app.getHttpServer())
      .post('/lookup')
      .send({ indicator })
      .expect(201)
      .expect({ found: true, source: 'memcached', indicator });

    expect(spy).toHaveBeenCalledWith(`blocked:${indicator}`);
    expect(metricsSpy).toHaveBeenCalledTimes(2);
    expect(metricsSpy).toHaveBeenCalledWith(false, 'local');
    expect(metricsSpy).toHaveBeenCalledWith(true, 'memcached');
    expect(memcachedOperationSpy).toHaveBeenCalledTimes(1);
    expect(memcachedOperationSpy).toHaveBeenCalledWith('get', 'success');

    spy.mockRestore();
    metricsSpy.mockRestore();
    memcachedOperationSpy.mockRestore();
  });

  it('/metrics (GET)', async () => {
    const response = await request(app.getHttpServer())
      .get('/metrics')
      .expect(200)
      .expect('Content-Type', /text\/plain/);

    expect(response.text).toContain('ribbon_filter_blocks_total');
  });
});
