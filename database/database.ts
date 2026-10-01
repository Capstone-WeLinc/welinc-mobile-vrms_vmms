import * as SQLite from "expo-sqlite";

import { ChecklistRepository } from "../repositories/ChecklistRepository";
import { MaintenanceRepository } from "../repositories/MaintenanceRepository";
import { VehicleRepository } from "../repositories/VehicleRepository";
import {
  ChecklistItem,
  ChecklistTemplate,
  CREATE_TABLES_SQL,
  DATABASE_NAME,
  DATABASE_VERSION,
  MaintenanceSchedule,
  Vehicle,
} from "./tables";

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function openDatabase(): Promise<SQLite.SQLiteDatabase> {
  try {
    return await SQLite.openDatabaseAsync(DATABASE_NAME);
  } catch (error) {
    console.warn(
      "[SQLite] openDatabaseAsync failed, falling back to openDatabaseSync",
      error,
    );
    return SQLite.openDatabaseSync(DATABASE_NAME);
  }
}

async function execSqlStatements(
  db: SQLite.SQLiteDatabase,
  sql: string,
): Promise<void> {
  const statements = sql
    .split(/;\s*/)
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await db.execAsync(statement);
  }
}

export async function initializeDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = openDatabase().then(async (database) => {
      await database.execAsync("PRAGMA journal_mode = WAL");
      await database.execAsync("PRAGMA foreign_keys = ON");
      await createTables(database);
      return database;
    });
  }

  try {
    return await databasePromise;
  } catch (error) {
    databasePromise = null;
    console.error("[SQLite] Database initialization failed", error);
    throw new Error(
      `Unable to initialize ${DATABASE_NAME}: ${getErrorMessage(error)}`,
    );
  }
}

export async function createTables(
  database?: SQLite.SQLiteDatabase,
): Promise<void> {
  const db = database ?? (await openDatabase());

  try {
    const versionRow = await db.getFirstAsync<{ user_version: number }>(
      "PRAGMA user_version",
    );
    const currentVersion = versionRow?.user_version ?? 0;

    if (currentVersion > DATABASE_VERSION) {
      console.warn(
        `[SQLite] Database version ${currentVersion} is newer than supported version ${DATABASE_VERSION}; continuing with existing schema`,
      );
    }

    if (currentVersion < 1) {
      await execSqlStatements(db, CREATE_TABLES_SQL);
    }

    const needsSchemaRepair = await hasMissingRequiredColumns(db);
    const hasLegacyAuthTable = await hasTable(db, "authenticated_users");

    if (
      currentVersion < DATABASE_VERSION ||
      needsSchemaRepair ||
      hasLegacyAuthTable
    ) {
      await migrateToV4(db);
    }

    if (currentVersion < 5) {
      await migrateToV5(db);
    }

    if (currentVersion < DATABASE_VERSION) {
      await db.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}`);
    }
  } catch (error) {
    console.error("[SQLite] Table creation failed", error);
    throw new Error(`Unable to create local tables: ${getErrorMessage(error)}`);
  }
}

async function hasMissingRequiredColumns(
  db: SQLite.SQLiteDatabase,
): Promise<boolean> {
  const requiredTables: Array<{
    tableName: string;
    requiredColumns: string[];
  }> = [
    {
      tableName: "vehicles",
      requiredColumns: [
        "id",
        "plateNumber",
        "model",
        "capacity",
        "status",
        "odometer",
        "isActive",
        "deletedAt",
        "createdAt",
        "updatedAt",
      ],
    },
    {
      tableName: "maintenance_schedules",
      requiredColumns: [
        "id",
        "vehicleId",
        "title",
        "garageId",
        "status",
        "startDate",
        "assignedMechanic",
        "assignedMechanicId",
        "chiefMechanicId",
        "accountType",
        "checklistTemplateId",
        "odometerReading",
        "triggerType",
        "intervalKm",
        "bufferDistanceKm",
        "startingReferenceReadingKm",
        "intervalType",
        "startReferenceDate",
        "previousScheduleId",
        "workOrderProgress",
        "deletedAt",
        "createdAt",
        "updatedAt",
      ],
    },
    {
      tableName: "checklist_templates",
      requiredColumns: ["id", "type", "deletedAt", "createdAt", "updatedAt"],
    },
    {
      tableName: "checklist_items",
      requiredColumns: [
        "id",
        "checklistTemplateId",
        "text",
        "order",
        "deletedAt",
        "createdAt",
        "updatedAt",
      ],
    },
  ];

  for (const { tableName, requiredColumns } of requiredTables) {
    const tableInfo = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(${tableName})`,
    );
    const columns = new Set(tableInfo.map((column) => column.name));
    if (
      tableInfo.length > 0 &&
      requiredColumns.some((column) => !columns.has(column))
    ) {
      return true;
    }
  }

  return false;
}

async function hasTable(
  db: SQLite.SQLiteDatabase,
  tableName: string,
): Promise<boolean> {
  const rows = await db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    tableName,
  );
  return rows.length > 0;
}

async function migrateToV4(db: SQLite.SQLiteDatabase): Promise<void> {
  try {
    const hasLegacyAuthTable = await hasTable(db, "authenticated_users");
    if (hasLegacyAuthTable) {
      console.info("[SQLite] Dropping legacy authenticated_users table");
      await db.execAsync("DROP TABLE authenticated_users");
    }

    await ensureVehiclesSchema(db);
    await ensureMaintenanceSchedulesSchema(db);
    await ensureChecklistTemplatesSchema(db);
    await ensureChecklistItemsSchema(db);

    console.info("[SQLite] Schema migration completed successfully");
  } catch (error) {
    console.error("[SQLite] Schema migration failed", error);
    throw error;
  }
}

async function migrateToV5(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync("PRAGMA foreign_keys = OFF");
  try {
    await db.execAsync(`
      CREATE TABLE maintenance_schedules_v5 (
        id TEXT PRIMARY KEY NOT NULL,
        vehicleId TEXT NOT NULL,
        title TEXT NOT NULL,
        garageId TEXT,
        status TEXT NOT NULL CHECK (status IN ('PENDING', 'DUE', 'IN_PROGRESS', 'DONE', 'COMPLETED', 'OVERDUE', 'CANCELLED')),
        startDate TEXT,
        assignedMechanic TEXT,
        assignedMechanicId TEXT,
        chiefMechanicId TEXT,
        accountType TEXT CHECK (accountType IN ('IN_HOUSE', 'OUTSOURCED', NULL)),
        checklistTemplateId TEXT,
        odometerReading INTEGER,
        triggerType TEXT CHECK (triggerType IN ('MANUAL', 'ODOMETER', 'TIME', NULL)),
        intervalKm INTEGER,
        bufferDistanceKm INTEGER,
        startingReferenceReadingKm INTEGER,
        intervalType TEXT CHECK (intervalType IN ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'SEMI_ANNUALLY', 'ANNUALLY', NULL)),
        startReferenceDate TEXT,
        previousScheduleId TEXT UNIQUE,
        workOrderProgress TEXT,
        deletedAt TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (checklistTemplateId) REFERENCES checklist_templates(id) ON DELETE SET NULL,
        FOREIGN KEY (previousScheduleId) REFERENCES maintenance_schedules_v5(id) ON DELETE SET NULL
      );
      INSERT INTO maintenance_schedules_v5
        SELECT id, vehicleId, title, garageId, status, startDate, assignedMechanic,
          assignedMechanicId, chiefMechanicId, accountType, checklistTemplateId,
          odometerReading, triggerType, intervalKm, bufferDistanceKm,
          startingReferenceReadingKm, intervalType, startReferenceDate,
          previousScheduleId, workOrderProgress, deletedAt, createdAt, updatedAt
        FROM maintenance_schedules;
      DROP TABLE maintenance_schedules;
      ALTER TABLE maintenance_schedules_v5 RENAME TO maintenance_schedules;
      CREATE INDEX IF NOT EXISTS idx_maintenance_vehicleId ON maintenance_schedules(vehicleId);
      CREATE INDEX IF NOT EXISTS idx_maintenance_checklistTemplateId ON maintenance_schedules(checklistTemplateId);
      CREATE INDEX IF NOT EXISTS idx_maintenance_updatedAt ON maintenance_schedules(updatedAt);
      CREATE INDEX IF NOT EXISTS idx_maintenance_deletedAt ON maintenance_schedules(deletedAt);
      CREATE INDEX IF NOT EXISTS idx_maintenance_status ON maintenance_schedules(status);
    `);
  } finally {
    await db.execAsync("PRAGMA foreign_keys = ON");
  }
}

async function ensureVehiclesSchema(db: SQLite.SQLiteDatabase): Promise<void> {
  if (!(await hasTable(db, "vehicles"))) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS vehicles (
        id TEXT PRIMARY KEY NOT NULL,
        plateNumber TEXT NOT NULL UNIQUE,
        model TEXT NOT NULL,
        capacity INTEGER NOT NULL DEFAULT 0 CHECK (capacity >= 0),
        status TEXT NOT NULL CHECK (status IN ('AVAILABLE', 'UNDER_REPAIR', 'UNDER_MAINTENANCE')),
        odometer INTEGER NOT NULL DEFAULT 0 CHECK (odometer >= 0),
        isActive INTEGER NOT NULL DEFAULT 1 CHECK (isActive IN (0, 1)),
        deletedAt TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
    `);
    return;
  }

  const columns = await getTableColumns(db, "vehicles");
  await addColumnIfMissing(
    db,
    "vehicles",
    "model",
    "TEXT NOT NULL DEFAULT 'Unknown'",
  );
  await addColumnIfMissing(
    db,
    "vehicles",
    "capacity",
    "INTEGER NOT NULL DEFAULT 0",
  );
  await addColumnIfMissing(
    db,
    "vehicles",
    "status",
    "TEXT NOT NULL DEFAULT 'AVAILABLE'",
  );
  await addColumnIfMissing(
    db,
    "vehicles",
    "odometer",
    "INTEGER NOT NULL DEFAULT 0",
  );
  await addColumnIfMissing(
    db,
    "vehicles",
    "isActive",
    "INTEGER NOT NULL DEFAULT 1",
  );
  await addColumnIfMissing(db, "vehicles", "deletedAt", "TEXT");
  await addColumnIfMissing(
    db,
    "vehicles",
    "createdAt",
    "TEXT NOT NULL DEFAULT datetime('now')",
  );
  await addColumnIfMissing(
    db,
    "vehicles",
    "updatedAt",
    "TEXT NOT NULL DEFAULT datetime('now')",
  );

  if (
    columns.includes("vehicleModel") &&
    !(await hasColumn(db, "vehicles", "model"))
  ) {
    await db.execAsync(
      "ALTER TABLE vehicles ADD COLUMN model TEXT NOT NULL DEFAULT 'Unknown'",
    );
  }
  if (columns.includes("vehicleModel")) {
    await db.execAsync(
      "UPDATE vehicles SET model = COALESCE(model, vehicleModel, 'Unknown') WHERE model IS NULL OR model = ''",
    );
  }

  await db.execAsync(
    "CREATE INDEX IF NOT EXISTS idx_vehicles_deletedAt ON vehicles(deletedAt)",
  );
  await db.execAsync(
    "CREATE INDEX IF NOT EXISTS idx_vehicles_plateNumber ON vehicles(plateNumber)",
  );
}

async function ensureMaintenanceSchedulesSchema(
  db: SQLite.SQLiteDatabase,
): Promise<void> {
  if (!(await hasTable(db, "maintenance_schedules"))) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS maintenance_schedules (
        id TEXT PRIMARY KEY NOT NULL,
        vehicleId TEXT NOT NULL,
        title TEXT NOT NULL,
        garageId TEXT,
        status TEXT NOT NULL CHECK (status IN ('PENDING', 'DUE', 'IN_PROGRESS', 'DONE', 'COMPLETED', 'OVERDUE', 'CANCELLED')),
        assignedMechanic TEXT,
        accountType TEXT CHECK (accountType IN ('IN_HOUSE', 'OUTSOURCED', NULL)),
        checklistTemplateId TEXT,
        odometerReading INTEGER,
        triggerType TEXT CHECK (triggerType IN ('MANUAL', 'ODOMETER', 'TIME', NULL)),
        intervalKm INTEGER,
        bufferDistanceKm INTEGER,
        startingReferenceReadingKm INTEGER,
        intervalType TEXT CHECK (intervalType IN ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'SEMI_ANNUALLY', 'ANNUALLY', NULL)),
        startReferenceDate TEXT,
        previousScheduleId TEXT UNIQUE,
        workOrderProgress TEXT,
        deletedAt TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (checklistTemplateId) REFERENCES checklist_templates(id) ON DELETE SET NULL,
        FOREIGN KEY (previousScheduleId) REFERENCES maintenance_schedules(id) ON DELETE SET NULL
      );
    `);
    return;
  }

  const columns = await getTableColumns(db, "maintenance_schedules");
  if (!columns.includes("vehicleId") && columns.includes("vehicleID")) {
    await db.execAsync(
      "ALTER TABLE maintenance_schedules ADD COLUMN vehicleId TEXT",
    );
    await db.execAsync(
      "UPDATE maintenance_schedules SET vehicleId = COALESCE(vehicleID, '') WHERE vehicleId IS NULL OR vehicleId = ''",
    );
  } else {
    await addColumnIfMissing(db, "maintenance_schedules", "vehicleId", "TEXT");
  }

  await addColumnIfMissing(
    db,
    "maintenance_schedules",
    "title",
    "TEXT NOT NULL DEFAULT ''",
  );
  await addColumnIfMissing(db, "maintenance_schedules", "garageId", "TEXT");
  await addColumnIfMissing(
    db,
    "maintenance_schedules",
    "status",
    "TEXT NOT NULL DEFAULT 'PENDING'",
  );
  await addColumnIfMissing(db, "maintenance_schedules", "startDate", "TEXT");
  await addColumnIfMissing(
    db,
    "maintenance_schedules",
    "assignedMechanic",
    "TEXT",
  );
  await addColumnIfMissing(db, "maintenance_schedules", "assignedMechanicId", "TEXT");
  await addColumnIfMissing(db, "maintenance_schedules", "chiefMechanicId", "TEXT");
  await addColumnIfMissing(db, "maintenance_schedules", "accountType", "TEXT");
  await addColumnIfMissing(
    db,
    "maintenance_schedules",
    "checklistTemplateId",
    "TEXT",
  );
  await addColumnIfMissing(
    db,
    "maintenance_schedules",
    "odometerReading",
    "INTEGER",
  );
  await addColumnIfMissing(db, "maintenance_schedules", "triggerType", "TEXT");
  await addColumnIfMissing(
    db,
    "maintenance_schedules",
    "intervalKm",
    "INTEGER",
  );
  await addColumnIfMissing(
    db,
    "maintenance_schedules",
    "bufferDistanceKm",
    "INTEGER",
  );
  await addColumnIfMissing(
    db,
    "maintenance_schedules",
    "startingReferenceReadingKm",
    "INTEGER",
  );
  await addColumnIfMissing(db, "maintenance_schedules", "intervalType", "TEXT");
  await addColumnIfMissing(
    db,
    "maintenance_schedules",
    "startReferenceDate",
    "TEXT",
  );
  await addColumnIfMissing(
    db,
    "maintenance_schedules",
    "previousScheduleId",
    "TEXT",
  );
  await addColumnIfMissing(
    db,
    "maintenance_schedules",
    "workOrderProgress",
    "TEXT",
  );
  await addColumnIfMissing(db, "maintenance_schedules", "deletedAt", "TEXT");
  await addColumnIfMissing(
    db,
    "maintenance_schedules",
    "createdAt",
    "TEXT NOT NULL DEFAULT datetime('now')",
  );
  await addColumnIfMissing(
    db,
    "maintenance_schedules",
    "updatedAt",
    "TEXT NOT NULL DEFAULT datetime('now')",
  );

  if (
    columns.includes("dueDate") &&
    !(await hasColumn(db, "maintenance_schedules", "startReferenceDate"))
  ) {
    await db.execAsync(
      "ALTER TABLE maintenance_schedules ADD COLUMN startReferenceDate TEXT",
    );
  }
  if (columns.includes("dueDate")) {
    await db.execAsync(
      "UPDATE maintenance_schedules SET startReferenceDate = COALESCE(startReferenceDate, dueDate) WHERE startReferenceDate IS NULL",
    );
  }

  await db.execAsync(
    "CREATE INDEX IF NOT EXISTS idx_maintenance_vehicleId ON maintenance_schedules(vehicleId)",
  );
  await db.execAsync(
    "CREATE INDEX IF NOT EXISTS idx_maintenance_checklistTemplateId ON maintenance_schedules(checklistTemplateId)",
  );
  await db.execAsync(
    "CREATE INDEX IF NOT EXISTS idx_maintenance_updatedAt ON maintenance_schedules(updatedAt)",
  );
  await db.execAsync(
    "CREATE INDEX IF NOT EXISTS idx_maintenance_deletedAt ON maintenance_schedules(deletedAt)",
  );
  await db.execAsync(
    "CREATE INDEX IF NOT EXISTS idx_maintenance_status ON maintenance_schedules(status)",
  );
}

async function ensureChecklistTemplatesSchema(
  db: SQLite.SQLiteDatabase,
): Promise<void> {
  if (!(await hasTable(db, "checklist_templates"))) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS checklist_templates (
        id TEXT PRIMARY KEY NOT NULL,
        type TEXT NOT NULL UNIQUE,
        deletedAt TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
    `);
    return;
  }

  await addColumnIfMissing(
    db,
    "checklist_templates",
    "type",
    "TEXT NOT NULL DEFAULT 'Unknown'",
  );
  await addColumnIfMissing(db, "checklist_templates", "deletedAt", "TEXT");
  await addColumnIfMissing(
    db,
    "checklist_templates",
    "createdAt",
    "TEXT NOT NULL DEFAULT datetime('now')",
  );
  await addColumnIfMissing(
    db,
    "checklist_templates",
    "updatedAt",
    "TEXT NOT NULL DEFAULT datetime('now')",
  );
  await db.execAsync(
    "CREATE INDEX IF NOT EXISTS idx_checklist_templates_deletedAt ON checklist_templates(deletedAt)",
  );
}

async function ensureChecklistItemsSchema(
  db: SQLite.SQLiteDatabase,
): Promise<void> {
  if (!(await hasTable(db, "checklist_items"))) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS checklist_items (
        id TEXT PRIMARY KEY NOT NULL,
        checklistTemplateId TEXT NOT NULL,
        text TEXT NOT NULL,
        "order" INTEGER NOT NULL DEFAULT 0,
        deletedAt TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (checklistTemplateId) REFERENCES checklist_templates(id) ON DELETE CASCADE
      );
    `);
    return;
  }

  await addColumnIfMissing(
    db,
    "checklist_items",
    "checklistTemplateId",
    "TEXT NOT NULL DEFAULT ''",
  );
  await addColumnIfMissing(
    db,
    "checklist_items",
    "text",
    "TEXT NOT NULL DEFAULT ''",
  );
  await addColumnIfMissing(
    db,
    "checklist_items",
    "order",
    "INTEGER NOT NULL DEFAULT 0",
  );
  await addColumnIfMissing(db, "checklist_items", "deletedAt", "TEXT");
  await addColumnIfMissing(
    db,
    "checklist_items",
    "createdAt",
    "TEXT NOT NULL DEFAULT datetime('now')",
  );
  await addColumnIfMissing(
    db,
    "checklist_items",
    "updatedAt",
    "TEXT NOT NULL DEFAULT datetime('now')",
  );
  await db.execAsync(
    "CREATE INDEX IF NOT EXISTS idx_checklist_items_templateId ON checklist_items(checklistTemplateId)",
  );
  await db.execAsync(
    "CREATE INDEX IF NOT EXISTS idx_checklist_items_deletedAt ON checklist_items(deletedAt)",
  );
}

async function getTableColumns(
  db: SQLite.SQLiteDatabase,
  tableName: string,
): Promise<string[]> {
  const tableInfo = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(${tableName})`,
  );
  return tableInfo.map((column) => column.name);
}

async function hasColumn(
  db: SQLite.SQLiteDatabase,
  tableName: string,
  columnName: string,
): Promise<boolean> {
  const columns = await getTableColumns(db, tableName);
  return columns.includes(columnName);
}

async function addColumnIfMissing(
  db: SQLite.SQLiteDatabase,
  tableName: string,
  columnName: string,
  definition: string,
): Promise<void> {
  if (await hasColumn(db, tableName, columnName)) {
    return;
  }

  await db.execAsync(
    `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`,
  );
}

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  return initializeDatabase();
}

export async function clearDatabase(): Promise<void> {
  const db = await getDatabase();

  try {
    await db.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync("DELETE FROM checklist_items");
      await transaction.runAsync("DELETE FROM checklist_templates");
      await transaction.runAsync("DELETE FROM maintenance_schedules");
      await transaction.runAsync("DELETE FROM vehicles");
      await transaction.runAsync("DELETE FROM sync_metadata");
    });
  } catch (error) {
    console.error("[SQLite] Clear database failed", error);
    throw new Error(`Unable to clear local data: ${getErrorMessage(error)}`);
  }
}

// Convenience service functions. Repositories remain available for dependency injection/testing.
export async function insertVehicle(vehicle: Vehicle): Promise<void> {
  return new VehicleRepository(await getDatabase()).insertVehicle(vehicle);
}

export async function updateVehicle(
  id: string,
  changes: Partial<Omit<Vehicle, "id">>,
): Promise<void> {
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

export async function insertMaintenanceSchedule(
  schedule: MaintenanceSchedule,
): Promise<void> {
  return new MaintenanceRepository(
    await getDatabase(),
  ).insertMaintenanceSchedule(schedule);
}

export async function getMaintenanceSchedules(
  vehicleId?: string,
): Promise<MaintenanceSchedule[]> {
  return new MaintenanceRepository(await getDatabase()).getMaintenanceSchedules(
    vehicleId,
  );
}

export async function getChecklistTemplates(): Promise<ChecklistTemplate[]> {
  return new ChecklistRepository(await getDatabase()).getTemplates();
}

export async function getChecklistItems(
  templateId: string,
): Promise<ChecklistItem[]> {
  return new ChecklistRepository(await getDatabase()).getItems(templateId);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
