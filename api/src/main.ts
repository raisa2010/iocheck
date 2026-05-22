import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ThreatIndicatorService } from './security/threat-indicator.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Expose a lightweight API that returns the currently configured malicious indicators.
  const threatService = app.get(ThreatIndicatorService);
  const server = app.getHttpAdapter().getInstance();

  server.get('/api/indicators', (req, res) => {
    try {
      res.json({ indicators: threatService.getIndicators() });
    } catch (err) {
      res.status(500).json({ error: 'failed to retrieve indicators' });
    }
  });

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
