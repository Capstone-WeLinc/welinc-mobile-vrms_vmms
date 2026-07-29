import NetInfo, {
  type NetInfoSubscription,
} from "@react-native-community/netinfo";
import axios, { type AxiosInstance, type AxiosRequestHeaders } from "axios";

import { clearDatabase, initializeDatabase } from "../database/database";
import type {
  ChecklistItem,
  ChecklistTemplate,
  MaintenanceSchedule,
  Vehicle,
} from "../database/tables";
import { ChecklistRepository } from "../repositories/ChecklistRepository";
import { MaintenanceRepository } from "../repositories/MaintenanceRepository";
import { VehicleRepository } from "../repositories/VehicleRepository";

type AccessTokenProvider = () => Promise<string | null> | string | null;

export interface SyncServiceOptions {
  apiBaseUrl: string;
  getAccessToken?: AccessTokenProvider;
  requestTimeoutMs?: number;
  onUnauthorized?: () => Promise<void> | void;
}

export interface SyncResult {
  status: "synchronized" | "offline";
  synchronizedAt: string | null;
  vehicles: number;
  maintenanceSchedules: number;
  checklistTemplates: number;
  checklistItems: number;
}

interface ServerVehicle {
  id: string;
  plateNumber: string;
  model?: string;
  vehicleModel?: string;
  capacity?: number;
  status: string;
  odometer?: number | string;
  odometerReading?: number | string;
  isActive?: boolean;
  deletedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface ServerMaintenanceSchedule {
  id: string;
  vehicleId?: string;
  vehicleID?: string;
  title: string;
  garageId?: string | null;
  triggerType?: string | null;
  intervalType?: string | null;
  status: string;
  assignedMechanic?: string | null;
  assignedDriver?: string | null;
  accountType?: string | null;
  checklistTemplateId?: string | null;
  odometerReading?: number | null;
  intervalKm?: number | null;
  interval_km?: number | null;
  bufferDistanceKm?: number | null;
  buffer_distance_km?: number | null;
  startingReferenceReadingKm?: number | null;
  starting_reference_km?: number | null;
  dueDate?: string | null;
  startReferenceDate?: string | null;
  date?: string | null;
  previousScheduleId?: string | null;
  previous_schedule_id?: string | null;
  workOrderProgress?: string | null;
  work_order_progress?: string | null;
  deletedAt?: string | null;
  deleted_at?: string | null;
  createdAt?: string;
  created_at?: string;
  updatedAt?: string;
  updated_at?: string;
}

interface ServerChecklistItem {
  id: string;
  text?: string;
  description?: string;
}

type ServerChecklistResponse = Record<string, ServerChecklistItem[]>;

/**
 * Pull-only synchronization for server-owned reference data.
 *
 * Start this service after authentication. Reads should always come from the
 * repositories, so the UI behaves identically online and offline.
 */
export class SyncService {
  private readonly api: AxiosInstance;
  private readonly getAccessToken?: AccessTokenProvider;
  private readonly onUnauthorized?: () => Promise<void> | void;
  private unsubscribeFromNetwork: NetInfoSubscription | null = null;
  private syncInFlight: Promise<SyncResult> | null = null;
  private wasOnline = false;
  private readonly listeners = new Set<(result: SyncResult) => void>();

  constructor(options: SyncServiceOptions) {
    const apiBaseUrl = options.apiBaseUrl.trim().replace(/\/$/, "");
    if (!apiBaseUrl)
      throw new Error("SyncService requires a non-empty API base URL");

    this.api = axios.create({
      baseURL: apiBaseUrl,
      timeout: options.requestTimeoutMs ?? 15_000,
      headers: { Accept: "application/json" },
    });
    this.getAccessToken = options.getAccessToken;
    this.onUnauthorized = options.onUnauthorized;

    // Add request interceptor to include authorization token
    this.api.interceptors.request.use(async (config) => {
      const token = await options.getAccessToken?.();
      if (token) {
        if (!config.headers) {
          config.headers = {} as AxiosRequestHeaders;
        }
        (config.headers as AxiosRequestHeaders).Authorization =
          `Bearer ${token}`;
      }
      return config;
    });
  }

  /** Synchronize immediately. Concurrent callers share one request. */
  sync(): Promise<SyncResult> {
    if (!this.syncInFlight) {
      this.syncInFlight = this.performSync()
        .then((result) => {
          for (const listener of this.listeners) listener(result);
          return result;
        })
        .finally(() => {
          this.syncInFlight = null;
        });
    }
    return this.syncInFlight;
  }

  /** Clear the local cache and repopulate it from the backend. */
  async forceRefreshFromBackend(): Promise<SyncResult> {
    await clearDatabase();
    return this.sync();
  }

  subscribe(listener: (result: SyncResult) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Synchronize once now and whenever the device regains internet access. */
  startAutoSync(): () => void {
    if (this.unsubscribeFromNetwork) return () => this.stopAutoSync();

    this.unsubscribeFromNetwork = NetInfo.addEventListener((state) => {
      const isOnline =
        state.isConnected === true && state.isInternetReachable !== false;
      if (isOnline && !this.wasOnline) {
        void this.sync().catch((error) => {
          console.error("[Sync] Automatic synchronization failed", error);
        });
      }
      this.wasOnline = isOnline;
    });

    return () => this.stopAutoSync();
  }

  stopAutoSync(): void {
    this.unsubscribeFromNetwork?.();
    this.unsubscribeFromNetwork = null;
    this.wasOnline = false;
  }

  async getLastSuccessfulSyncAt(): Promise<string | null> {
    const db = await initializeDatabase();
    const row = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM sync_metadata WHERE key = 'lastSuccessfulSyncAt'",
    );
    return row?.value ?? null;
  }

  private async performSync(): Promise<SyncResult> {
    const network = await NetInfo.fetch();
    const isOnline =
      network.isConnected === true && network.isInternetReachable !== false;

    if (!isOnline) {
      console.info("[Sync] Offline; using the local SQLite cache");
      return this.getOfflineResult();
    }

    const synchronizedAt = new Date().toISOString();

    try {
      const [vehicleResponse, scheduleResponse, checklistResponse] =
        await Promise.all([
          this.api.get<ServerVehicle[]>("/vehicles"),
          this.api.get<ServerMaintenanceSchedule[]>("/maintenance-schedules"),
          this.api.get<ServerChecklistResponse>("/checklists"),
        ]);

      const vehicles = unwrapArray<ServerVehicle>(
        vehicleResponse.data,
        "vehicles",
      ).map((vehicle) => mapVehicle(vehicle, synchronizedAt));
      const schedules = unwrapArray<ServerMaintenanceSchedule>(
        scheduleResponse.data,
        "maintenanceSchedules",
      ).map((schedule) => mapMaintenanceSchedule(schedule, synchronizedAt));
      const { templates, items } = mapChecklists(
        unwrapObject(checklistResponse.data),
        synchronizedAt,
      );

      const db = await initializeDatabase();
      await db.withExclusiveTransactionAsync(async (transaction) => {
        await new VehicleRepository(transaction).reconcileSnapshot(vehicles);
        await new MaintenanceRepository(transaction).reconcileSnapshot(
          schedules,
        );
        await new ChecklistRepository(transaction).reconcileSnapshot(
          templates,
          items,
        );
        await transaction.runAsync(
          `INSERT INTO sync_metadata (key, value) VALUES ('lastSuccessfulSyncAt', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          synchronizedAt,
        );
      });

      console.info(
        `[Sync] Completed: ${vehicles.length} vehicles, ${schedules.length} schedules, ` +
          `${templates.length} templates, ${items.length} checklist items`,
      );
      return {
        status: "synchronized",
        synchronizedAt,
        vehicles: vehicles.length,
        maintenanceSchedules: schedules.length,
        checklistTemplates: templates.length,
        checklistItems: items.length,
      };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        await this.onUnauthorized?.();
        console.info(
          "[Sync] Session expired or unauthorized; using local SQLite cache",
        );
        return this.getOfflineResult();
      }

      const message = getSyncErrorMessage(error);
      console.error(`[Sync] Synchronization failed: ${message}`, error);
      throw new Error(`Unable to synchronize mobile data: ${message}`);
    }
  }

  private async getOfflineResult(): Promise<SyncResult> {
    const db = await initializeDatabase();
    const counts = await db.getFirstAsync<{
      vehicles: number;
      schedules: number;
      templates: number;
      items: number;
    }>(`SELECT
      (SELECT COUNT(*) FROM vehicles) AS vehicles,
      (SELECT COUNT(*) FROM maintenance_schedules) AS schedules,
      (SELECT COUNT(*) FROM checklist_templates) AS templates,
      (SELECT COUNT(*) FROM checklist_items) AS items`);

    return {
      status: "offline",
      synchronizedAt: await this.getLastSuccessfulSyncAt(),
      vehicles: counts?.vehicles ?? 0,
      maintenanceSchedules: counts?.schedules ?? 0,
      checklistTemplates: counts?.templates ?? 0,
      checklistItems: counts?.items ?? 0,
    };
  }
}

function mapVehicle(record: ServerVehicle, fallbackTimestamp: string): Vehicle {
  const vehicleRecord = record as unknown as Record<string, unknown>;

  return {
    id: requireText(getValue(vehicleRecord, ["id"]), "vehicle.id"),
    plateNumber: requireText(
      getValue(vehicleRecord, ["plateNumber", "plate_number", "plateNo"]),
      "vehicle.plateNumber",
    ),
    model: requireText(
      getValue(vehicleRecord, [
        "model",
        "vehicleModel",
        "vehicle_model",
        "name",
      ]),
      "vehicle.model",
    ),
    capacity: toNonNegativeInteger(
      getNumber(vehicleRecord, [
        "capacity",
        "vehicleCapacity",
        "capacityValue",
      ]),
      "vehicle.capacity",
    ),
    status: requireText(
      getValue(vehicleRecord, ["status", "vehicleStatus", "statusCode"]),
      "vehicle.status",
    ) as any,
    odometer: toNonNegativeInteger(
      getNumber(vehicleRecord, [
        "odometer",
        "odometerReading",
        "odometer_reading",
      ]),
      "vehicle.odometer",
    ),
    isActive: getBoolean(
      vehicleRecord,
      ["isActive", "is_active", "active"],
      true,
    ),
    deletedAt:
      optionalText(getValue(vehicleRecord, ["deletedAt", "deleted_at"])) ??
      null,
    createdAt: validTimestampOrFallback(
      getValue(vehicleRecord, ["createdAt", "created_at"]),
      fallbackTimestamp,
    ),
    updatedAt: validTimestampOrFallback(
      getValue(vehicleRecord, ["updatedAt", "updated_at"]),
      fallbackTimestamp,
    ),
  };
}

function mapMaintenanceSchedule(
  record: ServerMaintenanceSchedule,
  fallbackTimestamp: string,
): MaintenanceSchedule {
  const scheduleRecord = record as unknown as Record<string, unknown>;

  return {
    id: requireText(getValue(scheduleRecord, ["id"]), "maintenanceSchedule.id"),
    vehicleId: requireText(
      extractStringValue(scheduleRecord, [
        "vehicleId",
        "vehicleID",
        "vehicle_id",
        "vehicle",
        "vehicleNumber",
        "vehicleNo",
      ]),
      "maintenanceSchedule.vehicleId",
    ),
    title: requireText(
      extractStringValue(scheduleRecord, [
        "title",
        "name",
        "scheduleTitle",
        "maintenanceTitle",
      ]),
      "maintenanceSchedule.title",
    ),
    garageId:
      extractStringValue(scheduleRecord, [
        "garageId",
        "garageID",
        "garage_id",
        "garage",
      ]) ?? null,
    status: requireText(
      extractStringValue(scheduleRecord, [
        "status",
        "scheduleStatus",
        "statusCode",
        "schedule_status",
      ]),
      "maintenanceSchedule.status",
    ) as any,
    assignedMechanic: extractStringValue(scheduleRecord, [
      "assignedMechanic",
      "assignedMechanicName",
      "assigned_mechanic",
      "mechanicName",
      "mechanic_name",
      "mechanic",
      "assignedDriver",
      "assigned_driver",
      "assignedTo",
      "assigned_to",
      "assignee",
      "assigneeName",
      "employeeName",
      "fullName",
      "name",
    ]),
    accountType: extractStringValue(scheduleRecord, [
      "accountType",
      "account_type",
      "account",
    ]) as any,
    checklistTemplateId:
      optionalText(
        findFirstValue(scheduleRecord, [
          "checklistTemplateId",
          "checklistTemplateID",
          "checklist_template_id",
          "templateId",
          "template_id",
        ]),
      ) ?? null,
    odometerReading: getNumber(scheduleRecord, [
      "odometerReading",
      "odometer_reading",
      "currentOdometer",
      "odometer",
    ]),
    triggerType: extractStringValue(scheduleRecord, [
      "triggerType",
      "trigger_type",
      "trigger",
    ]) as any,
    intervalKm: getNumber(scheduleRecord, [
      "intervalKm",
      "interval_km",
      "intervalKM",
      "IntervalKM",
      "interval",
    ]),
    bufferDistanceKm: getNumber(scheduleRecord, [
      "bufferDistanceKm",
      "buffer_distance_km",
      "bufferDistance",
      "buffer_distance",
      "BufferDistanceKm",
      "bufferDistanceKm",
    ]),
    startingReferenceReadingKm: getNumber(scheduleRecord, [
      "startingReferenceReadingKm",
      "starting_reference_reading_km",
      "startingReferenceReading",
      "starting_reference_reading",
      "startingReferenceKm",
      "starting_reference_km",
      "StartingReferenceReadingKm",
    ]),
    intervalType: extractStringValue(scheduleRecord, [
      "intervalType",
      "interval_type",
      "interval",
    ]) as any,
    startReferenceDate:
      optionalText(
        findFirstValue(scheduleRecord, [
          "startReferenceDate",
          "start_reference_date",
          "dueDate",
          "due_date",
          "date",
        ]),
      ) ?? null,
    previousScheduleId:
      serializeOptionalText(
        findFirstValue(scheduleRecord, [
          "previousScheduleId",
          "previous_schedule_id",
          "previousScheduleID",
          "PreviousScheduleId",
          "previous_schedule",
        ]),
      ) ?? null,
    workOrderProgress:
      serializeOptionalText(
        findFirstValue(scheduleRecord, [
          "workOrderProgress",
          "work_order_progress",
          "WorkOrderProgress",
          "workorderprogress",
        ]),
      ) ?? null,
    deletedAt:
      serializeOptionalText(
        findFirstValue(scheduleRecord, [
          "deletedAt",
          "deleted_at",
          "DeletedAt",
        ]),
      ) ?? null,
    createdAt: validTimestampOrFallback(
      findFirstValue(scheduleRecord, ["createdAt", "created_at"]),
      fallbackTimestamp,
    ),
    updatedAt: validTimestampOrFallback(
      findFirstValue(scheduleRecord, ["updatedAt", "updated_at"]),
      fallbackTimestamp,
    ),
  };
}

function mapChecklists(
  response: ServerChecklistResponse,
  fallbackTimestamp: string,
): { templates: ChecklistTemplate[]; items: ChecklistItem[] } {
  const templates: ChecklistTemplate[] = [];
  const items: ChecklistItem[] = [];

  for (const [type, serverItems] of Object.entries(response)) {
    const templateId = `type:${encodeURIComponent(type)}`;
    templates.push({
      id: templateId,
      type,
      deletedAt: null,
      createdAt: fallbackTimestamp,
      updatedAt: fallbackTimestamp,
    });
    let order = 0;
    for (const item of serverItems) {
      items.push({
        id: requireText(item.id, `checklist item in ${type}`),
        checklistTemplateId: templateId,
        text: requireText(
          item.text ?? item.description,
          `checklist item ${item.id}`,
        ),
        order,
        deletedAt: null,
        createdAt: fallbackTimestamp,
        updatedAt: fallbackTimestamp,
      });
      order++;
    }
  }
  return { templates, items };
}

function unwrapArray<T>(value: unknown, key: string): T[] {
  if (Array.isArray(value)) return value as T[];

  if (typeof value === "string") {
    const parsed = parseCsvLikeRecords<T>(value, key);
    if (parsed.length > 0) return parsed;
    throw new Error(
      `The API returned an invalid ${key} response: unable to parse the string payload as an array`,
    );
  }

  if (!isObject(value)) {
    throw new Error(`The API returned an invalid ${key} response`);
  }

  const candidates = [
    "data",
    key,
    normalizeKey(key),
    key.replace(/s$/, ""),
    key.replace(/s$/, "_s"),
    key.replace(/s$/, "_schedule"),
    key.replace(/s$/, "_schedules"),
    key.toLowerCase(),
    key.toLowerCase().replace(/([a-z])([A-Z])/g, "$1_$2"),
    key.toLowerCase().replace(/([a-z])([A-Z])/g, "$1_$2") + "s",
    key
      .toLowerCase()
      .replace(/([a-z])([A-Z])/g, "$1_$2")
      .replace(/_s$/, "s"),
    key
      .toLowerCase()
      .replace(/([a-z])([A-Z])/g, "$1_$2")
      .replace(/s$/, "_s"),
    "maintenance_schedules",
    "maintenanceSchedules",
    "maintenance_schedule",
    "maintenanceSchedule",
    "records",
    "items",
    "result",
  ];

  for (const candidate of candidates) {
    const entry = value[candidate as keyof typeof value];
    if (Array.isArray(entry)) return entry as T[];
    if (typeof entry === "string") {
      const parsed = parseCsvLikeRecords<T>(entry, key);
      if (parsed.length > 0) return parsed;
    }
  }

  for (const nested of Object.values(value)) {
    if (Array.isArray(nested)) return nested as T[];
    if (typeof nested === "string") {
      const parsed = parseCsvLikeRecords<T>(nested, key);
      if (parsed.length > 0) return parsed;
    }
    if (isObject(nested)) {
      for (const candidate of candidates) {
        const entry = nested[candidate as keyof typeof nested];
        if (Array.isArray(entry)) return entry as T[];
        if (typeof entry === "string") {
          const parsed = parseCsvLikeRecords<T>(entry, key);
          if (parsed.length > 0) return parsed;
        }
      }
    }
  }

  const jsonObject = tryParseJsonObject(value);
  if (jsonObject) return unwrapArray<T>(jsonObject, key);

  throw new Error(`The API returned an invalid ${key} response`);
}

function parseCsvLikeRecords<T>(value: string, key: string): T[] {
  const trimmed = value.trim();
  if (!trimmed) return [];

  try {
    const parsedJson = JSON.parse(trimmed);
    if (Array.isArray(parsedJson)) return parsedJson as T[];
    if (isObject(parsedJson)) return unwrapArray<T>(parsedJson, key);
  } catch {
    // Fall through to CSV parsing below.
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("--"));

  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map((column) => column.trim());
  if (headers.length === 0) return [];

  const rows: T[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const values = splitCsvLine(lines[index]);
    if (values.length === 0) continue;

    const normalizedRow: Record<string, unknown> = {};
    for (let i = 0; i < headers.length; i += 1) {
      const header = headers[i] ?? `column_${i + 1}`;
      normalizedRow[header] =
        i < values.length ? parseCsvCell(values[i]) : null;
    }

    rows.push(normalizedRow as T);
  }

  return rows;
}

function splitCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const character = line[i];
    if (character === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  values.push(current);
  return values;
}

function parseCsvCell(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function tryParseJsonObject(value: unknown): Record<string, unknown> | null {
  if (!isObject(value)) return null;
  try {
    const serialized = JSON.stringify(value);
    const parsed = JSON.parse(serialized);
    return isObject(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function unwrapObject(value: unknown): ServerChecklistResponse {
  const candidate =
    isObject(value) && isObject(value.data) ? value.data : value;
  if (!isObject(candidate))
    throw new Error("The API returned an invalid checklists response");
  for (const [key, items] of Object.entries(candidate)) {
    if (!Array.isArray(items))
      throw new Error(`Checklist template ${key} is not an array`);
  }
  return candidate as ServerChecklistResponse;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`Missing ${field}`);
  return value.trim();
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function serializeOptionalText(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }
  return null;
}

function getValue(record: Record<string, unknown>, aliases: string[]): unknown {
  return findFirstValue(record, aliases);
}

function findFirstValue(
  record: Record<string, unknown>,
  aliases: string[],
): unknown {
  const normalized = new Map<string, unknown>();
  for (const [key, value] of Object.entries(record)) {
    normalized.set(normalizeKey(key), value);
  }

  for (const alias of aliases) {
    const match = normalized.get(normalizeKey(alias));
    if (match !== undefined) return match;
  }

  for (const value of Object.values(record)) {
    if (isObject(value)) {
      const nestedResult = findFirstValue(
        value as Record<string, unknown>,
        aliases,
      );
      if (nestedResult !== undefined) return nestedResult;
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (isObject(item)) {
          const nestedResult = findFirstValue(
            item as Record<string, unknown>,
            aliases,
          );
          if (nestedResult !== undefined) return nestedResult;
        }
      }
    }
  }

  return undefined;
}

function extractStringValue(
  record: Record<string, unknown>,
  aliases: string[],
): string | null {
  const value = findFirstValue(record, aliases);
  if (value == null || value === "") return null;

  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = extractStringValue(
        isObject(item) ? (item as Record<string, unknown>) : { value: item },
        ["name", "fullName", "displayName", "value", "label", ...aliases],
      );
      if (nested) return nested;
    }
    return null;
  }

  if (isObject(value)) {
    const objectValue = value as Record<string, unknown>;
    return (
      extractStringValue(objectValue, [
        "name",
        "fullName",
        "displayName",
        "value",
        "label",
        "mechanicName",
        "assignedMechanicName",
      ]) ?? extractStringValue(objectValue, aliases)
    );
  }

  return null;
}

function getNumber(
  record: Record<string, unknown>,
  aliases: string[],
  fallback: number | null = null,
): number | null {
  const value = getValue(record, aliases);
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.trunc(value) : fallback;
  }

  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  }

  return fallback;
}

function getBoolean(
  record: Record<string, unknown>,
  aliases: string[],
  fallback: boolean,
): boolean {
  const value = getValue(record, aliases);
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no") {
      return false;
    }
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  return fallback;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function toNonNegativeInteger(value: unknown, field: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0)
    throw new Error(`Invalid ${field}`);
  return Math.trunc(number);
}

function validTimestampOrFallback(value: unknown, fallback: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value)))
    return fallback;
  return new Date(value).toISOString();
}

function getSyncErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (error.response)
      return `API request failed with status ${error.response.status}`;
    if (error.code === "ECONNABORTED") return "API request timed out";
    return error.message || "Network request failed";
  }
  return error instanceof Error ? error.message : String(error);
}
