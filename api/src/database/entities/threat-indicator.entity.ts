import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('threat_indicators')
@Index(['indicator'], { unique: true })
export class ThreatIndicator {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  indicator: string;

  @Column({ type: 'varchar', length: 50, default: 'ip' })
  type: string; // e.g., 'ip', 'domain', 'hash'

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  source: string; // e.g., 'threat-feed', 'manual', 'api'

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
