import type { SQLiteDatabase } from 'expo-sqlite';

import type { MaintenanceSchedule } from '../database/tables';

export class MaintenanceRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async insertMaintenanceSchedule(schedule: MaintenanceSchedule): Promise<void> {
    try {
      await this.db.runAsync(
        `INSERT INTO maintenance_schedules
          (id, vehicleId, title, triggerType, intervalType, status, assignedMechanic, dueDate, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        schedule.id,
        schedule.vehicleId,
        schedule.title,
        schedule.triggerType,
        schedule.intervalType,
        schedule.status,
        schedule.assignedMechanic,
        schedule.dueDate,
        schedule.updatedAt,
      );
    } catch (error) {
      console.error(`[SQLite] Failed to insert maintenance schedule ${schedule.id}`, error);
      throw error;
    }
  }

  async getMaintenanceSchedules(vehicleId?: string): Promise<MaintenanceSchedule[]> {
    if (vehicleId) {
      return this.db.getAllAsync<MaintenanceSchedule>(
        `SELECT * FROM maintenance_schedules
         WHERE vehicleId = ? ORDER BY dueDate IS NULL, dueDate ASC`,
        vehicleId,
      );
    }
    return this.db.getAllAsync<MaintenanceSchedule>(
      'SELECT * FROM maintenance_schedules ORDER BY dueDate IS NULL, dueDate ASC',
    );
  }

  async reconcileSnapshot(schedules: MaintenanceSchedule[]): Promise<void> {
    await this.db.execAsync(
      'CREATE TEMP TABLE IF NOT EXISTS incoming_schedule_ids (id TEXT PRIMARY KEY); DELETE FROM incoming_schedule_ids;',
    );
    const idStatement = await this.db.prepareAsync(
      'INSERT OR IGNORE INTO incoming_schedule_ids (id) VALUES (?)',
    );
    const upsertStatement = await this.db.prepareAsync(`
      INSERT INTO maintenance_schedules
        (id, vehicleId, title, triggerType, intervalType, status, assignedMechanic, dueDate, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        vehicleId = excluded.vehicleId,
        title = excluded.title,
        triggerType = excluded.triggerType,
        intervalType = excluded.intervalType,
        status = excluded.status,
        assignedMechanic = excluded.assignedMechanic,
        dueDate = excluded.dueDate,
        updatedAt = excluded.updatedAt
      WHERE excluded.updatedAt >= maintenance_schedules.updatedAt
         OR excluded.vehicleId != maintenance_schedules.vehicleId
         OR excluded.title != maintenance_schedules.title
         OR excluded.status != maintenance_schedules.status
         OR excluded.triggerType IS NOT maintenance_schedules.triggerType
         OR excluded.intervalType IS NOT maintenance_schedules.intervalType
         OR excluded.assignedMechanic IS NOT maintenance_schedules.assignedMechanic
         OR excluded.dueDate IS NOT maintenance_schedules.dueDate
    `);

    try {
      for (const schedule of schedules) {
        await idStatement.executeAsync(schedule.id);
        await upsertStatement.executeAsync(
          schedule.id,
          schedule.vehicleId,
          schedule.title,
          schedule.triggerType,
          schedule.intervalType,
          schedule.status,
          schedule.assignedMechanic,
          schedule.dueDate,
          schedule.updatedAt,
        );
      }
      await this.db.runAsync(
        'DELETE FROM maintenance_schedules WHERE id NOT IN (SELECT id FROM incoming_schedule_ids)',
      );
    } finally {
      await idStatement.finalizeAsync();
      await upsertStatement.finalizeAsync();
    }
  }
}
