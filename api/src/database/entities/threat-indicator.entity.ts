import { BeforeInsert, BeforeUpdate, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('ioc')
@Index(['type', 'value'], { unique: true })
export class ThreatIndicator {
    @PrimaryGeneratedColumn()
    id!: number;

    @Column({ type: 'varchar', length: 50 })
    type!: string;

    @Column({ type: 'varchar', length: 255 })
    value!: string;

    @Column({ type: 'varchar', length: 100 })
    source!: string;

    @Column({ type: 'int' })
    score!: number;

    @Column({ type: 'bigint' })
    createdAt!: number;

    @Column({ type: 'bigint' })
    updatedAt!: number;

    @BeforeInsert()
    setCreatedAt(): void {
        const now = Math.floor(Date.now() / 1000);
        this.createdAt = now;
        this.updatedAt = now;
    }

    @BeforeUpdate()
    setUpdatedAt(): void {
        this.updatedAt = Math.floor(Date.now() / 1000);
    }
}
