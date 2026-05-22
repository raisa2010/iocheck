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

    async findByIndicator(indicator: string): Promise<ThreatIndicator | null> {
        try {
            return await this.threatIndicatorRepository.findOne({
                where: { indicator },
            });
        } catch (err) {
            this.logger.error(`Database lookup error for ${indicator}: ${err.message}`);
            return null;
        }
    }

    async upsertIndicator(
        indicator: string,
        type = 'ip',
        description?: string,
        source = 'api',
    ): Promise<ThreatIndicator | null> {
        try {
            let threatIndicator = await this.threatIndicatorRepository.findOne({
                where: { indicator },
            });

            if (threatIndicator) {
                threatIndicator.updatedAt = new Date();
                if (description) threatIndicator.description = description;
                if (source) threatIndicator.source = source;
                return await this.threatIndicatorRepository.save(threatIndicator);
            }

            threatIndicator = this.threatIndicatorRepository.create({
                indicator,
                type,
                description,
                source,
            });
            return await this.threatIndicatorRepository.save(threatIndicator);
        } catch (err) {
            this.logger.error(`Database upsert error for ${indicator}: ${err.message}`);
            return null;
        }
    }

    async getAllIndicators(): Promise<string[]> {
        try {
            const indicators = await this.threatIndicatorRepository.find({
                select: ['indicator'],
            });
            return indicators.map((t) => t.indicator);
        } catch (err) {
            this.logger.error(`Database getAllIndicators error: ${err.message}`);
            return [];
        }
    }

    async deleteIndicator(indicator: string): Promise<boolean> {
        try {
            const result = await this.threatIndicatorRepository.delete({ indicator });
            return !result ? false : !result.affected ? false : result.affected > 0;
        } catch (err) {
            this.logger.error(`Database delete error for ${indicator}: ${err.message}`);
            return false;
        }
    }
}
