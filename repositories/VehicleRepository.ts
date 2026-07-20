import type { SQLiteDatabase } from 'expo-sqlite';

import type { Vehicle } from '../database/tables';

export class VehicleRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async insertVehicle(vehicle: Vehicle): Promise<void> {
    try {
      await this.db.runAsync(
        `INSERT INTO vehicles
          (id, plateNumber, vehicleModel, status, odometerReading, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
        vehicle.id,
        vehicle.plateNumber,
        vehicle.vehicleModel,
        vehicle.status,
        vehicle.odometerReading,
        vehicle.updatedAt,
      );
    } catch (error) {
      console.error(`[SQLite] Failed to insert vehicle ${vehicle.id}`, error);
      throw error;
    }
  }

  async updateVehicle(id: string, changes: Partial<Omit<Vehicle, 'id'>>): Promise<void> {
    const allowedColumns = [
      'plateNumber',
      'vehicleModel',
      'status',
      'odometerReading',
      'updatedAt',
    ] as const;
    const entries = allowedColumns
      .filter((column) => changes[column] !== undefined)
      .map((column) => [column, changes[column]] as const);

    if (entries.length === 0) return;

    try {
      const assignments = entries.map(([column]) => `${column} = ?`).join(', ');
      const result = await this.db.runAsync(
        `UPDATE vehicles SET ${assignments} WHERE id = ?`,
        ...entries.map(([, value]) => value as string | number),
        id,
      );
      if (result.changes === 0) throw new Error(`Vehicle ${id} was not found`);
    } catch (error) {
      console.error(`[SQLite] Failed to update vehicle ${id}`, error);
      throw error;
    }
  }

  async deleteVehicle(id: string): Promise<void> {
    try {
      await this.db.runAsync('DELETE FROM vehicles WHERE id = ?', id);
    } catch (error) {
      console.error(`[SQLite] Failed to delete vehicle ${id}`, error);
      throw error;
    }
  }

  async getVehicles(): Promise<Vehicle[]> {
    return this.db.getAllAsync<Vehicle>('SELECT * FROM vehicles ORDER BY plateNumber ASC');
  }

  async getVehicleById(id: string): Promise<Vehicle | null> {
    return this.db.getFirstAsync<Vehicle>('SELECT * FROM vehicles WHERE id = ?', id);
  }

  async reconcileSnapshot(vehicles: Vehicle[]): Promise<void> {
    await this.db.execAsync(
      'CREATE TEMP TABLE IF NOT EXISTS incoming_vehicle_ids (id TEXT PRIMARY KEY); DELETE FROM incoming_vehicle_ids;',
    );
    const idStatement = await this.db.prepareAsync(
      'INSERT OR IGNORE INTO incoming_vehicle_ids (id) VALUES (?)',
    );
    const upsertStatement = await this.db.prepareAsync(`
      INSERT INTO vehicles (id, plateNumber, vehicleModel, status, odometerReading, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        plateNumber = excluded.plateNumber,
        vehicleModel = excluded.vehicleModel,
        status = excluded.status,
        odometerReading = excluded.odometerReading,
        updatedAt = excluded.updatedAt
      WHERE excluded.updatedAt >= vehicles.updatedAt
         OR excluded.plateNumber != vehicles.plateNumber
         OR excluded.vehicleModel != vehicles.vehicleModel
         OR excluded.status != vehicles.status
         OR excluded.odometerReading != vehicles.odometerReading
    `);

    try {
      for (const vehicle of vehicles) {
        await idStatement.executeAsync(vehicle.id);
        await upsertStatement.executeAsync(
          vehicle.id,
          vehicle.plateNumber,
          vehicle.vehicleModel,
          vehicle.status,
          vehicle.odometerReading,
          vehicle.updatedAt,
        );
      }
      await this.db.runAsync(
        'DELETE FROM vehicles WHERE id NOT IN (SELECT id FROM incoming_vehicle_ids)',
      );
    } finally {
      await idStatement.finalizeAsync();
      await upsertStatement.finalizeAsync();
    }
  }
}
