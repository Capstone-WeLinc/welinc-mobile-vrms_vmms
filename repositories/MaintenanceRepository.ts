import type { SQLiteDatabase } from "expo-sqlite";

import type { MaintenanceSchedule } from "../database/tables";

export class MaintenanceRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async insertMaintenanceSchedule(
    schedule: MaintenanceSchedule,
  ): Promise<void> {
    try {
      await this.db.runAsync(
        `INSERT INTO maintenance_schedules
          (id, workOrderNumber, vehicleId, title, garageId, status, priority, startDate, assignedMechanic, assignedMechanicId, chiefMechanicId, accountType, checklistTemplateId, odometerReading, triggerType, intervalKm, bufferDistanceKm, startingReferenceReadingKm, intervalType, startReferenceDate, previousScheduleId, workOrderProgress, deletedAt, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        schedule.id,
        schedule.workOrderNumber,
        schedule.vehicleId,
        schedule.title,
        schedule.garageId,
        schedule.status,
        schedule.priority ?? "MEDIUM",
        schedule.startDate,
        schedule.assignedMechanic,
        schedule.assignedMechanicId,
        schedule.chiefMechanicId,
        schedule.accountType,
        schedule.checklistTemplateId,
        schedule.odometerReading,
        schedule.triggerType,
        schedule.intervalKm,
        schedule.bufferDistanceKm,
        schedule.startingReferenceReadingKm,
        schedule.intervalType,
        schedule.startReferenceDate,
        schedule.previousScheduleId,
        schedule.workOrderProgress,
        schedule.deletedAt,
        schedule.createdAt,
        schedule.updatedAt,
      );
    } catch (error) {
      console.error(
        `[SQLite] Failed to insert maintenance schedule ${schedule.id}`,
        error,
      );
      throw error;
    }
  }

  async getMaintenanceSchedules(
    vehicleId?: string,
  ): Promise<MaintenanceSchedule[]> {
    if (vehicleId) {
      return this.db.getAllAsync<MaintenanceSchedule>(
        `SELECT * FROM maintenance_schedules
         WHERE vehicleId = ? AND deletedAt IS NULL ORDER BY startReferenceDate ASC`,
        vehicleId,
      );
    }
    return this.db.getAllAsync<MaintenanceSchedule>(
      "SELECT * FROM maintenance_schedules WHERE deletedAt IS NULL ORDER BY startReferenceDate ASC",
    );
  }

  async getMaintenanceSchedulesByMechanic(
    mechanicName: string,
  ): Promise<MaintenanceSchedule[]> {
    return this.db.getAllAsync<MaintenanceSchedule>(
      `SELECT * FROM maintenance_schedules
       WHERE assignedMechanic = ? AND deletedAt IS NULL ORDER BY startReferenceDate ASC`,
      mechanicName,
    );
  }

  async getMaintenanceSchedulesByStatus(
    status: string,
  ): Promise<MaintenanceSchedule[]> {
    return this.db.getAllAsync<MaintenanceSchedule>(
      `SELECT * FROM maintenance_schedules
       WHERE status = ? AND deletedAt IS NULL ORDER BY startReferenceDate ASC`,
      status,
    );
  }

  async updateWorkOrderProgress(
    scheduleId: string,
    workOrderProgress: string,
    status?: string,
  ): Promise<void> {
    await this.db.runAsync(
      `UPDATE maintenance_schedules
       SET workOrderProgress = ?,
           status = COALESCE(?, status),
           updatedAt = ?
       WHERE id = ?`,
      workOrderProgress,
      status ?? null,
      new Date().toISOString(),
      scheduleId,
    );
  }

  async reconcileSnapshot(schedules: MaintenanceSchedule[]): Promise<void> {
    await this.db.execAsync(
      "CREATE TEMP TABLE IF NOT EXISTS incoming_schedule_ids (id TEXT PRIMARY KEY)",
    );
    await this.db.execAsync("DELETE FROM incoming_schedule_ids");

    try {
      for (const schedule of schedules) {
        await this.db.runAsync(
          "INSERT OR IGNORE INTO incoming_schedule_ids (id) VALUES (?)",
          schedule.id,
        );
        await this.db.runAsync(
          `INSERT INTO maintenance_schedules
            (id, workOrderNumber, vehicleId, title, garageId, status, priority, startDate, assignedMechanic, assignedMechanicId, chiefMechanicId, accountType, checklistTemplateId, odometerReading, triggerType, intervalKm, bufferDistanceKm, startingReferenceReadingKm, intervalType, startReferenceDate, previousScheduleId, workOrderProgress, deletedAt, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             workOrderNumber = excluded.workOrderNumber,
             vehicleId = excluded.vehicleId,
             title = excluded.title,
             garageId = excluded.garageId,
             status = excluded.status,
             priority = excluded.priority,
             startDate = excluded.startDate,
             assignedMechanic = excluded.assignedMechanic,
             assignedMechanicId = excluded.assignedMechanicId,
             chiefMechanicId = excluded.chiefMechanicId,
             accountType = excluded.accountType,
             checklistTemplateId = excluded.checklistTemplateId,
             odometerReading = excluded.odometerReading,
             triggerType = excluded.triggerType,
             intervalKm = excluded.intervalKm,
             bufferDistanceKm = excluded.bufferDistanceKm,
             startingReferenceReadingKm = excluded.startingReferenceReadingKm,
             intervalType = excluded.intervalType,
             startReferenceDate = excluded.startReferenceDate,
             previousScheduleId = excluded.previousScheduleId,
             workOrderProgress = CASE
               WHEN excluded.workOrderProgress IS NULL
                 AND maintenance_schedules.workOrderProgress IS NOT NULL
               THEN maintenance_schedules.workOrderProgress
               ELSE excluded.workOrderProgress
             END,
             deletedAt = excluded.deletedAt,
             updatedAt = excluded.updatedAt
           WHERE excluded.updatedAt >= maintenance_schedules.updatedAt
              OR (
                maintenance_schedules.intervalKm IS NULL AND excluded.intervalKm IS NOT NULL
              ) OR (
                maintenance_schedules.startDate IS NULL AND excluded.startDate IS NOT NULL
              ) OR (
                maintenance_schedules.bufferDistanceKm IS NULL AND excluded.bufferDistanceKm IS NOT NULL
              ) OR (
                maintenance_schedules.startingReferenceReadingKm IS NULL AND excluded.startingReferenceReadingKm IS NOT NULL
              ) OR (
                maintenance_schedules.previousScheduleId IS NULL AND excluded.previousScheduleId IS NOT NULL
              ) OR (
                maintenance_schedules.workOrderProgress IS NULL AND excluded.workOrderProgress IS NOT NULL
              ) OR (
                (maintenance_schedules.workOrderNumber IS NULL OR maintenance_schedules.workOrderNumber = '')
                AND excluded.workOrderNumber != ''
              ) OR (
                maintenance_schedules.deletedAt IS NULL AND excluded.deletedAt IS NOT NULL
              )`,
          schedule.id,
          schedule.workOrderNumber,
          schedule.vehicleId,
          schedule.title,
          schedule.garageId,
            schedule.status,
            schedule.priority ?? "MEDIUM",
          schedule.startDate,
          schedule.assignedMechanic,
        schedule.assignedMechanicId,
        schedule.chiefMechanicId,
          schedule.accountType,
          schedule.checklistTemplateId,
          schedule.odometerReading,
          schedule.triggerType,
          schedule.intervalKm,
          schedule.bufferDistanceKm,
          schedule.startingReferenceReadingKm,
          schedule.intervalType,
          schedule.startReferenceDate,
          schedule.previousScheduleId,
          schedule.workOrderProgress,
          schedule.deletedAt,
          schedule.createdAt,
          schedule.updatedAt,
        );
      }
      await this.db.runAsync(
        "DELETE FROM maintenance_schedules WHERE id NOT IN (SELECT id FROM incoming_schedule_ids)",
      );
    } catch (error) {
      console.error(
        "[SQLite] Maintenance schedule reconciliation failed",
        error,
      );
      throw error;
    }
  }
}
