import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ThreatIndicator } from './entities/threat-indicator.entity';

@Injectable()
export class DatabaseService {
  private readonly logger = new Logger(DatabaseService.name);

  constructor(
    @InjectRepository(ThreatIndicator)
    private readonly threatIndicatorRepository: Repository<ThreatIndicator>,
  ) { }

  async ping(): Promise<boolean> {
    try {
      await this.threatIndicatorRepository.query('SELECT 1');
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Database ping error: ${message}`);
      return false;
    }
  }

  async findByTypeAndValue(type: string, value: string): Promise<ThreatIndicator | null> {
    try {
      return await this.threatIndicatorRepository.findOne({
        where: { type, value },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Database lookup error for ${type}:${value}: ${message}`);
      return null;
    }
  }

  async upsertIoc(
    type: string,
    value: string,
    source: string,
    score: number,
  ): Promise<ThreatIndicator | null> {
    try {
      let existing = await this.threatIndicatorRepository.findOne({
        where: { type, value },
      });

      if (existing) {
        existing.source = source;
        existing.score = score;
        return await this.threatIndicatorRepository.save(existing);
      }

      const ioc = this.threatIndicatorRepository.create({
        type,
        value,
        source,
        score,
      });
      console.log('saving new ioc to database', { type, value, source, score });
      return await this.threatIndicatorRepository.save(ioc);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Database upsert error for ${type}:${value}: ${message}`);
      return null;
    }
  }

  async getAllIndicators(): Promise<string[]> {
    try {
      const iocs = await this.threatIndicatorRepository.find({
        select: ['type', 'value'],
      });
      return iocs.map((ioc) => `${ioc.type}:${ioc.value}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Database getAllIndicators error: ${message}`);
      return [];
    }
  }

  async deleteIoc(type: string, value: string): Promise<boolean> {
    try {
      const result = await this.threatIndicatorRepository.delete({ type, value });
      return !!result.affected && result.affected > 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Database delete error for ${type}:${value}: ${message}`);
      return false;
    }
  }
}
