export const DATABASE_NAME = "vmms_mobile.db";
export const DATABASE_VERSION = 6;

// Enums matching Prisma schema
export enum VehicleStatus {
  AVAILABLE = "AVAILABLE",
  UNDER_REPAIR = "UNDER_REPAIR",
  UNDER_MAINTENANCE = "UNDER_MAINTENANCE",
}

export enum MaintenanceStatus {
  PENDING = "PENDING",
  DUE = "DUE",
  IN_PROGRESS = "IN_PROGRESS",
  DONE = "DONE",
  COMPLETED = "COMPLETED",
  OVERDUE = "OVERDUE",
  CANCELLED = "CANCELLED",
}

export enum MaintenanceTriggerType {
  MANUAL = "MANUAL",
  ODOMETER = "ODOMETER",
  TIME = "TIME",
}

export enum MaintenanceIntervalType {
  DAILY = "DAILY",
  WEEKLY = "WEEKLY",
  MONTHLY = "MONTHLY",
  QUARTERLY = "QUARTERLY",
  SEMI_ANNUALLY = "SEMI_ANNUALLY",
  ANNUALLY = "ANNUALLY",
}

export enum AccountType {
  IN_HOUSE = "IN_HOUSE",
  OUTSOURCED = "OUTSOURCED",
}

export interface Vehicle {
  id: string;
  plateNumber: string;
  model: string;
  capacity: number;
  status: VehicleStatus;
  odometer: number;
  isActive: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MaintenanceSchedule {
  id: string;
  vehicleId: string;
  title: string;
  garageId: string | null;
  status: MaintenanceStatus;
  startDate: string | null;
  assignedMechanic: string | null;
  assignedMechanicId: string | null;
  chiefMechanicId: string | null;
  accountType: AccountType | null;
  checklistTemplateId: string | null;
  odometerReading: number | null;
  triggerType: MaintenanceTriggerType | null;
  intervalKm: number | null;
  bufferDistanceKm: number | null;
  startingReferenceReadingKm: number | null;
  intervalType: MaintenanceIntervalType | null;
  startReferenceDate: string | null;
  previousScheduleId: string | null;
  workOrderProgress: string | null; // JSON stored as string
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChecklistTemplate {
  id: string;
  type: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChecklistItem {
  id: string;
  checklistTemplateId: string;
  text: string;
  order: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// This SQL contains no user input. Values are always written with bound parameters.
export const CREATE_TABLES_SQL = `
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

  CREATE TABLE IF NOT EXISTS maintenance_schedules (
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
    FOREIGN KEY (previousScheduleId) REFERENCES maintenance_schedules(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS checklist_templates (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL UNIQUE,
    deletedAt TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

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

  CREATE TABLE IF NOT EXISTS sync_metadata (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_vehicles_deletedAt ON vehicles(deletedAt);
  CREATE INDEX IF NOT EXISTS idx_vehicles_plateNumber ON vehicles(plateNumber);
  CREATE INDEX IF NOT EXISTS idx_maintenance_vehicleId ON maintenance_schedules(vehicleId);
  CREATE INDEX IF NOT EXISTS idx_maintenance_checklistTemplateId ON maintenance_schedules(checklistTemplateId);
  CREATE INDEX IF NOT EXISTS idx_maintenance_updatedAt ON maintenance_schedules(updatedAt);
  CREATE INDEX IF NOT EXISTS idx_maintenance_deletedAt ON maintenance_schedules(deletedAt);
  CREATE INDEX IF NOT EXISTS idx_maintenance_status ON maintenance_schedules(status);
  CREATE INDEX IF NOT EXISTS idx_checklist_templates_deletedAt ON checklist_templates(deletedAt);
  CREATE INDEX IF NOT EXISTS idx_checklist_items_templateId ON checklist_items(checklistTemplateId);
  CREATE INDEX IF NOT EXISTS idx_checklist_items_deletedAt ON checklist_items(deletedAt);
`;
