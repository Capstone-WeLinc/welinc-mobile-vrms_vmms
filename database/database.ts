import * as SQLite from 'expo-sqlite';

import { ChecklistRepository } from '../repositories/ChecklistRepository';
import { MaintenanceRepository } from '../repositories/MaintenanceRepository';
import { VehicleRepository } from '../repositories/VehicleRepository';
import {
  ChecklistItem,
  ChecklistTemplate,
  CREATE_TABLES_SQL,
  DATABASE_NAME,
  DATABASE_VERSION,
  MaintenanceSchedule,
  Vehicle,
} from './tables';

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

export async function initializeDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync(DATABASE_NAME).then(async (database) => {
      await database.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
      await createTables(database);
      return database;
    });
  }

  try {
    return await databasePromise;
  } catch (error) {
    databasePromise = null;
    console.error('[SQLite] Database initialization failed', error);
    throw new Error(`Unable to initialize ${DATABASE_NAME}: ${getErrorMessage(error)}`);
  }
}

export async function createTables(database?: SQLite.SQLiteDatabase): Promise<void> {
  const db = database ?? (await SQLite.openDatabaseAsync(DATABASE_NAME));

  try {
    const versionRow = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    const currentVersion = versionRow?.user_version ?? 0;

    if (currentVersion > DATABASE_VERSION) {
      throw new Error(
        `Database version ${currentVersion} is newer than supported version ${DATABASE_VERSION}`,
      );
    }

    if (currentVersion < 1) {
      await db.execAsync(CREATE_TABLES_SQL);
      await db.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}`);
    }
  } catch (error) {
    console.error('[SQLite] Table creation failed', error);
    throw new Error(`Unable to create local tables: ${getErrorMessage(error)}`);
  }
}

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  return initializeDatabase();
}

export async function clearDatabase(): Promise<void> {
  const db = await getDatabase();

  try {
    await db.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync('DELETE FROM checklist_items');
      await transaction.runAsync('DELETE FROM checklist_templates');
      await transaction.runAsync('DELETE FROM maintenance_schedules');
      await transaction.runAsync('DELETE FROM vehicles');
      await transaction.runAsync('DELETE FROM sync_metadata');
    });
  } catch (error) {
    console.error('[SQLite] Clear database failed', error);
    throw new Error(`Unable to clear local data: ${getErrorMessage(error)}`);
  }
}

// Convenience service functions. Repositories remain available for dependency injection/testing.
export async function insertVehicle(vehicle: Vehicle): Promise<void> {
  return new VehicleRepository(await getDatabase()).insertVehicle(vehicle);
}

export async function updateVehicle(id: string, changes: Partial<Omit<Vehicle, 'id'>>): Promise<void> {
  return new VehicleRepository(await getDatabase()).updateVehicle(id, changes);
}

export async function deleteVehicle(id: string): Promise<void> {
  return new VehicleRepository(await getDatabase()).deleteVehicle(id);
}

export async function getVehicles(): Promise<Vehicle[]> {
  return new VehicleRepository(await getDatabase()).getVehicles();
}

export async function getVehicleById(id: string): Promise<Vehicle | null> {
  return new VehicleRepository(await getDatabase()).getVehicleById(id);
}

export async function insertMaintenanceSchedule(schedule: MaintenanceSchedule): Promise<void> {
  return new MaintenanceRepository(await getDatabase()).insertMaintenanceSchedule(schedule);
}

export async function getMaintenanceSchedules(vehicleId?: string): Promise<MaintenanceSchedule[]> {
  return new MaintenanceRepository(await getDatabase()).getMaintenanceSchedules(vehicleId);
}

export async function getChecklistTemplates(): Promise<ChecklistTemplate[]> {
  return new ChecklistRepository(await getDatabase()).getTemplates();
}

export async function getChecklistItems(templateId: string): Promise<ChecklistItem[]> {
  return new ChecklistRepository(await getDatabase()).getItems(templateId);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
