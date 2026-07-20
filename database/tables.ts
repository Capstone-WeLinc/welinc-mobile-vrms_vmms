export const DATABASE_NAME = 'vmms_mobile.db';
export const DATABASE_VERSION = 1;

export interface Vehicle {
  id: string;
  plateNumber: string;
  vehicleModel: string;
  status: string;
  odometerReading: number;
  updatedAt: string;
}

export interface MaintenanceSchedule {
  id: string;
  vehicleId: string;
  title: string;
  triggerType: string | null;
  intervalType: string | null;
  status: string;
  assignedMechanic: string | null;
  dueDate: string | null;
  updatedAt: string;
}

export interface ChecklistTemplate {
  id: string;
  name: string;
  updatedAt: string;
}

export interface ChecklistItem {
  id: string;
  templateId: string;
  description: string;
  isChecked: boolean;
}

// This SQL contains no user input. Values are always written with bound parameters.
export const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS vehicles (
    id TEXT PRIMARY KEY NOT NULL,
    plateNumber TEXT NOT NULL UNIQUE,
    vehicleModel TEXT NOT NULL,
    status TEXT NOT NULL,
    odometerReading INTEGER NOT NULL DEFAULT 0 CHECK (odometerReading >= 0),
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS maintenance_schedules (
    id TEXT PRIMARY KEY NOT NULL,
    vehicleId TEXT NOT NULL,
    title TEXT NOT NULL,
    triggerType TEXT,
    intervalType TEXT,
    status TEXT NOT NULL,
    assignedMechanic TEXT,
    dueDate TEXT,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS checklist_templates (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL UNIQUE,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS checklist_items (
    id TEXT PRIMARY KEY NOT NULL,
    templateId TEXT NOT NULL,
    description TEXT NOT NULL,
    isChecked INTEGER NOT NULL DEFAULT 0 CHECK (isChecked IN (0, 1)),
    FOREIGN KEY (templateId) REFERENCES checklist_templates(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS sync_metadata (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_maintenance_vehicleId
    ON maintenance_schedules(vehicleId);
  CREATE INDEX IF NOT EXISTS idx_maintenance_updatedAt
    ON maintenance_schedules(updatedAt);
  CREATE INDEX IF NOT EXISTS idx_checklist_items_templateId
    ON checklist_items(templateId);
`;
