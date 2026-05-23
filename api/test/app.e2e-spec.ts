import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AppModule } from './../src/app.module';
import { DatabaseService } from './../src/database/database.service';
import { ThreatIndicator } from './../src/database/entities/threat-indicator.entity';
import { getDatabaseConfig, setupDatabase } from './../src/database/setup-database';
import { MetricsService } from './../src/metrics/metrics.service';
import { MemcachedService } from './../src/security/memcached.service';

describe('AppController (e2e)', () => {
  let app: INestApplication;
  const cache = new Map<string, string>();
  const controllerMemcachedStub: Partial<MemcachedService> = {
    ping: async () => true,
    get: async (key: string) => cache.get(key) ?? null,
    set: async (key: string, value: string) => {
      cache.set(key, value);
    },
  };
  const databaseServiceStub: Partial<DatabaseService> = {
    ping: async () => true,
    findByTypeAndValue: async (type, value) => cache.has(`${type}:${value}`) ? JSON.parse(cache.get(`${type}:${value}`)!) : null,
    upsertIoc: async (type, value, source, score) => {
      cache.set(`${type}:${value}`, JSON.stringify({ type, value, source, score }));
      return { type, value, source, score } as ThreatIndicator;
    },
    getAllIndicators: async () => [],
    deleteIoc: async () => true,
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MemcachedService)
      .useValue(controllerMemcachedStub)
      .overrideProvider(DatabaseService)
      .useValue(databaseServiceStub)
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

  it('/readyz (GET) should call memcached and postgres ping', async () => {
    const spy = jest.spyOn(controllerMemcachedStub, 'ping');
    const databaseSpy = jest.spyOn(databaseServiceStub, 'ping');

    await request(app.getHttpServer())
      .get('/readyz')
      .expect(200)
      .expect({ status: 'ok' });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(databaseSpy).toHaveBeenCalledTimes(1);

    spy.mockRestore();
    databaseSpy.mockRestore();
  });

  it('/ioc (POST) and /lookup (POST)', async () => {
    const upsertSpy = jest.spyOn(controllerMemcachedStub, 'set');
    const lookupSpy = jest.spyOn(controllerMemcachedStub, 'get');
    const databaseUpsertSpy = jest.spyOn(databaseServiceStub, 'upsertIoc');
    const databaseLookupSpy = jest.spyOn(databaseServiceStub, 'findByTypeAndValue')
    const upsertMetricsSpy = jest.spyOn(MetricsService.prototype, 'recordThreatIndicatorUpsert');
    const lookupMetricsSpy = jest.spyOn(MetricsService.prototype, 'recordThreatIndicatorLookup');
    const databaseMetricsSpy = jest.spyOn(MetricsService.prototype, 'recordDatabaseOperation');
    const payload = {
      type: 'domain',
      value: 'evil.example',
      source: 'admin',
      score: 90,
    };

    await request(app.getHttpServer())
      .post('/ioc')
      .send(payload)
      .expect(201)
      .expect({ verdict: 'malicious', ioc: payload });

    expect(upsertMetricsSpy).toHaveBeenCalledTimes(1);
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    expect(databaseMetricsSpy).toHaveBeenCalledTimes(1);
    expect(databaseMetricsSpy).toHaveBeenCalledWith('upsert', 'success');
    expect(databaseUpsertSpy).toHaveBeenCalledTimes(1);
    expect(databaseUpsertSpy).toHaveBeenCalledWith(payload.type, payload.value, payload.source, payload.score);

    await request(app.getHttpServer())
      .post('/lookup')
      .send({ type: payload.type, value: payload.value })
      .expect(201)
      .expect({ verdict: 'malicious', ioc: payload });

    expect(lookupSpy).toHaveBeenCalledTimes(0);
    expect(databaseLookupSpy).toHaveBeenCalledTimes(0);
    expect(lookupMetricsSpy).toHaveBeenCalledTimes(1);
    expect(lookupMetricsSpy).toHaveBeenCalledWith(true, 'local');

    upsertMetricsSpy.mockRestore();
    lookupMetricsSpy.mockRestore();
    upsertSpy.mockRestore();
    lookupSpy.mockRestore();
    databaseUpsertSpy.mockRestore();
    databaseMetricsSpy.mockRestore();
    databaseLookupSpy.mockRestore();
  });

  it('/lookup (POST) should resolve from local ribbon filter without calling memcached', async () => {
    const lookupSpy = jest.spyOn(controllerMemcachedStub, 'get');
    const metricsSpy = jest.spyOn(MetricsService.prototype, 'recordThreatIndicatorLookup');
    const payload = {
      type: 'ip',
      value: '203.0.113.12',
      source: 'test-admin',
      score: 55,
    };

    await request(app.getHttpServer())
      .post('/ioc')
      .send(payload)
      .expect(201)
      .expect({ verdict: 'malicious', ioc: payload });

    await request(app.getHttpServer())
      .post('/lookup')
      .send({ type: payload.type, value: payload.value })
      .expect(201)
      .expect({ verdict: 'malicious', ioc: payload });

    expect(lookupSpy).not.toHaveBeenCalled();
    expect(metricsSpy).toHaveBeenCalledTimes(1);
    expect(metricsSpy).toHaveBeenCalledWith(true, 'local');

    lookupSpy.mockRestore();
    metricsSpy.mockRestore();
  });

  it('/lookup (POST) should resolve from memcached when not present locally', async () => {
    const spy = jest.spyOn(controllerMemcachedStub, 'get');
    const databaseSpy = jest.spyOn(databaseServiceStub, 'findByTypeAndValue')
    const metricsSpy = jest.spyOn(MetricsService.prototype, 'recordThreatIndicatorLookup');
    const memcachedOperationSpy = jest.spyOn(MetricsService.prototype, 'recordMemcachedOperation');
    const databaseOperationSpy = jest.spyOn(MetricsService.prototype, 'recordDatabaseOperation');
    const payload = {
      type: 'ip' as const,
      value: '198.18.0.1',
      source: 'cached-test',
      score: 73,
    };

    await controllerMemcachedStub.set?.(`blocked:${payload.type}:${payload.value}`, JSON.stringify(payload));

    await request(app.getHttpServer())
      .post('/lookup')
      .send({ type: payload.type, value: payload.value })
      .expect(201)
      .expect({ verdict: 'malicious', ioc: payload });

    expect(spy).toHaveBeenCalledWith(`blocked:${payload.type}:${payload.value}`);
    expect(metricsSpy).toHaveBeenCalledWith(true, 'memcached');
    expect(memcachedOperationSpy).toHaveBeenCalledTimes(1);
    expect(memcachedOperationSpy).toHaveBeenCalledWith('get', 'success');
    expect(databaseOperationSpy).toHaveBeenCalledTimes(0);
    expect(databaseSpy).toHaveBeenCalledTimes(0);

    spy.mockRestore();
    metricsSpy.mockRestore();
    memcachedOperationSpy.mockRestore();
    databaseOperationSpy.mockRestore();
    databaseSpy.mockRestore();
  });

  it('/lookup (POST) should return from the database when it is not present in either cache', async () => {
    const lookupSpy = jest.spyOn(controllerMemcachedStub, 'get');
    const databaseLookupSpy = jest.spyOn(databaseServiceStub, 'findByTypeAndValue')
    const lookupMetricsSpy = jest.spyOn(MetricsService.prototype, 'recordThreatIndicatorLookup');
    const memcachedOperationSpy = jest.spyOn(MetricsService.prototype, 'recordMemcachedOperation');
    const databaseMetricsSpy = jest.spyOn(MetricsService.prototype, 'recordDatabaseOperation');
    const payload = {
      type: 'ip' as const,
      value: '198.18.0.2',
      source: 'cached-test',
      score: 73,
    };

    await databaseServiceStub.upsertIoc?.(payload.type, payload.value, payload.source, payload.score);

    await request(app.getHttpServer())
      .post('/lookup')
      .send({ type: 'ip', value: '198.18.0.2' })
      .expect(201)
      .expect({ verdict: 'malicious', ioc: payload });

    expect(lookupSpy).toHaveBeenCalledTimes(1)
    expect(databaseLookupSpy).toHaveBeenCalledTimes(1);
    expect(memcachedOperationSpy).toHaveBeenCalledTimes(1);
    expect(databaseMetricsSpy).toHaveBeenCalledTimes(1);
    expect(lookupMetricsSpy).toHaveBeenCalledTimes(3);

    expect(memcachedOperationSpy).toHaveBeenCalledWith('get', 'success');
    expect(lookupMetricsSpy).toHaveBeenCalledWith(false, 'local');
    expect(lookupMetricsSpy).toHaveBeenCalledWith(false, 'memcached');
    expect(lookupMetricsSpy).toHaveBeenCalledWith(true, 'postgres');
    expect(databaseMetricsSpy).toHaveBeenCalledWith('find', 'success');

    lookupSpy.mockRestore();
    databaseLookupSpy.mockRestore();
    memcachedOperationSpy.mockRestore();
    lookupMetricsSpy.mockRestore();
    databaseMetricsSpy.mockRestore();
  });

  it('/lookup (POST) should return unknown for a missing IOC', async () => {
    const lookupSpy = jest.spyOn(controllerMemcachedStub, 'get');
    const databaseLookupSpy = jest.spyOn(databaseServiceStub, 'findByTypeAndValue')
    const lookupMetricsSpy = jest.spyOn(MetricsService.prototype, 'recordThreatIndicatorLookup');
    const memcachedOperationSpy = jest.spyOn(MetricsService.prototype, 'recordMemcachedOperation');
    const databaseMetricsSpy = jest.spyOn(MetricsService.prototype, 'recordDatabaseOperation');

    await request(app.getHttpServer())
      .post('/lookup')
      .send({ type: 'domain', value: 'missing.example' })
      .expect(201)
      .expect({ verdict: 'unknown' });

    expect(lookupSpy).toHaveBeenCalledTimes(1)
    expect(databaseLookupSpy).toHaveBeenCalledTimes(1);
    expect(memcachedOperationSpy).toHaveBeenCalledTimes(1);
    expect(databaseMetricsSpy).toHaveBeenCalledTimes(0);
    expect(lookupMetricsSpy).toHaveBeenCalledTimes(4);

    expect(memcachedOperationSpy).toHaveBeenCalledWith('get', 'success');
    expect(lookupMetricsSpy).toHaveBeenCalledWith(false, 'not_found');
    expect(lookupMetricsSpy).toHaveBeenCalledWith(false, 'local');
    expect(lookupMetricsSpy).toHaveBeenCalledWith(false, 'memcached');
    expect(lookupMetricsSpy).toHaveBeenCalledWith(false, 'postgres');

    lookupSpy.mockRestore();
    databaseLookupSpy.mockRestore();
    memcachedOperationSpy.mockRestore();
    lookupMetricsSpy.mockRestore();
    databaseMetricsSpy.mockRestore();
  });

  it('/metrics (GET)', async () => {
    const response = await request(app.getHttpServer())
      .get('/metrics')
      .expect(200)
      .expect('Content-Type', /text\/plain/);

    expect(response.text).toContain('ribbon_filter_blocks_total');
  });
});

describe('DatabaseService (e2e)', () => {
  let moduleFixture: TestingModule;
  let databaseService: DatabaseService;
  let threatIndicatorRepository: Repository<ThreatIndicator>;
  const memcachedStub: Partial<MemcachedService> = {
    ping: async () => true,
    get: async () => null,
    set: async () => { },
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';

    const dbConfig = getDatabaseConfig();
    await setupDatabase(dbConfig);

    moduleFixture = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'postgres',
          host: dbConfig.host,
          port: dbConfig.port,
          database: dbConfig.database,
          username: dbConfig.user,
          password: dbConfig.password,
          entities: [ThreatIndicator],
          synchronize: true,
          dropSchema: true,
          logging: false,
        }),
        TypeOrmModule.forFeature([ThreatIndicator]),
      ],
      providers: [DatabaseService],
    }).compile();

    databaseService = moduleFixture.get(DatabaseService);
    threatIndicatorRepository = moduleFixture.get(getRepositoryToken(ThreatIndicator));
  });

  beforeEach(async () => {
    await threatIndicatorRepository.clear();
  });

  afterAll(async () => {
    await moduleFixture.close();
  });

  it('ping() returns true when PostgreSQL is reachable', async () => {
    await expect(databaseService.ping()).resolves.toBe(true);
  });

  it('upsertIoc() inserts a new threat indicator', async () => {
    const saved = await databaseService.upsertIoc('domain', 'db-insert.example', 'e2e', 42);

    expect(saved).toMatchObject({
      type: 'domain',
      value: 'db-insert.example',
      source: 'e2e',
      score: 42,
    });
    expect(saved?.id).toEqual(expect.any(Number));
    expect(saved?.createdAt).toEqual(expect.any(Number));
    expect(saved?.updatedAt).toEqual(expect.any(Number));
  });

  it('findByTypeAndValue() returns a stored indicator', async () => {
    await databaseService.upsertIoc('ip', '198.18.0.50', 'e2e', 80);

    const found = await databaseService.findByTypeAndValue('ip', '198.18.0.50');

    expect(found).toMatchObject({
      type: 'ip',
      value: '198.18.0.50',
      source: 'e2e',
      score: 80,
    });
  });

  it('findByTypeAndValue() returns null when no indicator exists', async () => {
    await expect(databaseService.findByTypeAndValue('domain', 'missing.example')).resolves.toBeNull();
  });

  it('upsertIoc() updates an existing indicator', async () => {
    await databaseService.upsertIoc('sha256', 'abc123', 'initial', 10);

    const updated = await databaseService.upsertIoc('sha256', 'abc123', 'updated', 99);
    const found = await databaseService.findByTypeAndValue('sha256', 'abc123');

    expect(updated).toMatchObject({ source: 'updated', score: 99 });
    expect(found).toMatchObject({ source: 'updated', score: 99 });
    expect(await threatIndicatorRepository.count()).toBe(1);
  });

  it('getAllIndicators() returns type:value keys for stored rows', async () => {
    await databaseService.upsertIoc('domain', 'one.example', 'e2e', 1);
    await databaseService.upsertIoc('ip', '10.0.0.1', 'e2e', 2);

    const indicators = await databaseService.getAllIndicators();

    expect(indicators).toEqual(expect.arrayContaining(['domain:one.example', 'ip:10.0.0.1']));
    expect(indicators).toHaveLength(2);
  });

  it('getAllIndicators() returns an empty array when the table is empty', async () => {
    await expect(databaseService.getAllIndicators()).resolves.toEqual([]);
  });

  it('deleteIoc() removes an existing indicator', async () => {
    await databaseService.upsertIoc('domain', 'delete-me.example', 'e2e', 5);

    await expect(databaseService.deleteIoc('domain', 'delete-me.example')).resolves.toBe(true);
    await expect(databaseService.findByTypeAndValue('domain', 'delete-me.example')).resolves.toBeNull();
  });

  it('deleteIoc() returns false when the indicator does not exist', async () => {
    await expect(databaseService.deleteIoc('domain', 'never-there.example')).resolves.toBe(false);
  });
});
