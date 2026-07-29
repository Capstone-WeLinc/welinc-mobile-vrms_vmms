import type { SQLiteDatabase } from "expo-sqlite";

import type { Vehicle } from "../database/tables";

export class VehicleRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async insertVehicle(vehicle: Vehicle): Promise<void> {
    try {
      await this.db.runAsync(
        `INSERT INTO vehicles
          (id, plateNumber, model, capacity, status, odometer, isActive, deletedAt, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        vehicle.id,
        vehicle.plateNumber,
        vehicle.model,
        vehicle.capacity,
        vehicle.status,
        vehicle.odometer,
        vehicle.isActive ? 1 : 0,
        vehicle.deletedAt,
        vehicle.createdAt,
        vehicle.updatedAt,
      );
    } catch (error) {
      console.error(`[SQLite] Failed to insert vehicle ${vehicle.id}`, error);
      throw error;
    }
  }

  async updateVehicle(
    id: string,
    changes: Partial<Omit<Vehicle, "id">>,
  ): Promise<void> {
    const allowedColumns = [
      "plateNumber",
      "model",
      "capacity",
      "status",
      "odometer",
      "isActive",
      "deletedAt",
      "updatedAt",
    ] as const;
    const entries = allowedColumns
      .filter((column) => changes[column] !== undefined)
      .map((column) => {
        const value = changes[column];
        if (column === "isActive" && typeof value === "boolean") {
          return [column, value ? 1 : 0] as const;
        }
        return [column, value] as const;
      });

    if (entries.length === 0) return;

    try {
      const assignments = entries.map(([column]) => `${column} = ?`).join(", ");
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
      await this.db.runAsync("DELETE FROM vehicles WHERE id = ?", id);
    } catch (error) {
      console.error(`[SQLite] Failed to delete vehicle ${id}`, error);
      throw error;
    }
  }

  async getVehicles(): Promise<Vehicle[]> {
    const rows = await this.db.getAllAsync<{
      id: string;
      plateNumber: string;
      model: string;
      capacity: number;
      status: string;
      odometer: number;
      isActive: number;
      deletedAt: string | null;
      createdAt: string;
      updatedAt: string;
    }>(
      "SELECT * FROM vehicles WHERE deletedAt IS NULL ORDER BY plateNumber ASC",
    );

    return rows.map((row) => ({
      ...row,
      status: row.status as any,
      isActive: row.isActive === 1,
    }));
  }

  async getVehicleById(id: string): Promise<Vehicle | null> {
    const row = await this.db.getFirstAsync<{
      id: string;
      plateNumber: string;
      model: string;
      capacity: number;
      status: string;
      odometer: number;
      isActive: number;
      deletedAt: string | null;
      createdAt: string;
      updatedAt: string;
    }>("SELECT * FROM vehicles WHERE id = ? AND deletedAt IS NULL", id);

    if (!row) return null;
    return {
      ...row,
      status: row.status as any,
      isActive: row.isActive === 1,
    };
  }

  async reconcileSnapshot(vehicles: Vehicle[]): Promise<void> {
    await this.db.execAsync(
      "CREATE TEMP TABLE IF NOT EXISTS incoming_vehicle_ids (id TEXT PRIMARY KEY)",
    );
    await this.db.execAsync("DELETE FROM incoming_vehicle_ids");

    try {
      for (const vehicle of vehicles) {
        const existingVehicle = await this.db.getFirstAsync<{
          id: string;
          plateNumber: string;
          model: string;
          capacity: number;
          status: string;
          odometer: number;
          isActive: number;
          deletedAt: string | null;
          createdAt: string;
          updatedAt: string;
        }>("SELECT * FROM vehicles WHERE plateNumber = ?", vehicle.plateNumber);

        if (!existingVehicle) {
          await this.upsertVehicle(vehicle);
          await this.db.runAsync(
            "INSERT OR IGNORE INTO incoming_vehicle_ids (id) VALUES (?)",
            vehicle.id,
          );
          continue;
        }

        if (existingVehicle.id === vehicle.id) {
          await this.upsertVehicle(vehicle);
          await this.db.runAsync(
            "INSERT OR IGNORE INTO incoming_vehicle_ids (id) VALUES (?)",
            vehicle.id,
          );
          continue;
        }

        const hasNewerData =
          vehicle.updatedAt > existingVehicle.updatedAt ||
          (vehicle.updatedAt === existingVehicle.updatedAt &&
            (vehicle.model !== existingVehicle.model ||
              vehicle.status !== existingVehicle.status ||
              vehicle.odometer !== existingVehicle.odometer));

        if (!hasNewerData) {
          await this.db.runAsync(
            "INSERT OR IGNORE INTO incoming_vehicle_ids (id) VALUES (?)",
            existingVehicle.id,
          );
          continue;
        }

        await this.db.runAsync(
          `UPDATE vehicles
           SET id = ?, plateNumber = ?, model = ?, capacity = ?, status = ?, odometer = ?, isActive = ?, deletedAt = ?, createdAt = ?, updatedAt = ?
           WHERE id = ?`,
          vehicle.id,
          vehicle.plateNumber,
          vehicle.model,
          vehicle.capacity,
          vehicle.status,
          vehicle.odometer,
          vehicle.isActive ? 1 : 0,
          vehicle.deletedAt,
          vehicle.createdAt,
          vehicle.updatedAt,
          existingVehicle.id,
        );
        await this.db.runAsync(
          "UPDATE maintenance_schedules SET vehicleId = ? WHERE vehicleId = ?",
          vehicle.id,
          existingVehicle.id,
        );
        await this.db.runAsync(
          "INSERT OR IGNORE INTO incoming_vehicle_ids (id) VALUES (?)",
          vehicle.id,
        );
      }

      await this.db.runAsync(
        "DELETE FROM vehicles WHERE id NOT IN (SELECT id FROM incoming_vehicle_ids)",
      );
    } catch (error) {
      console.error("[SQLite] Vehicle reconciliation failed", error);
      throw error;
    }
  }

  private async upsertVehicle(vehicle: Vehicle): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO vehicles
        (id, plateNumber, model, capacity, status, odometer, isActive, deletedAt, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         plateNumber = excluded.plateNumber,
         model = excluded.model,
         capacity = excluded.capacity,
         status = excluded.status,
         odometer = excluded.odometer,
         isActive = excluded.isActive,
         deletedAt = excluded.deletedAt,
         updatedAt = excluded.updatedAt`,
      vehicle.id,
      vehicle.plateNumber,
      vehicle.model,
      vehicle.capacity,
      vehicle.status,
      vehicle.odometer,
      vehicle.isActive ? 1 : 0,
      vehicle.deletedAt,
      vehicle.createdAt,
      vehicle.updatedAt,
    );
  }
}
