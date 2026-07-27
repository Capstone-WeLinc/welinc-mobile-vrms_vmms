import NetInfo, {
  type NetInfoSubscription,
} from "@react-native-community/netinfo";
import axios, { type AxiosInstance } from "axios";

import { initializeDatabase } from "../database/database";
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
  status: string;
  odometer?: number | string;
  odometerReading?: number | string;
  updatedAt?: string;
}

interface ServerMaintenanceSchedule {
  id: string;
  vehicleId: string;
  title: string;
  triggerType?: string | null;
  intervalType?: string | null;
  status: string;
  assignedMechanic?: string | null;
  assignedDriver?: string | null;
  dueDate?: string | null;
  startReferenceDate?: string | null;
  date?: string | null;
  updatedAt?: string;
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

    // Add request interceptor to include authorization token
    this.api.interceptors.request.use(async (config) => {
      const token = await options.getAccessToken?.();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
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
  return {
    id: requireText(record.id, "vehicle.id"),
    plateNumber: requireText(record.plateNumber, "vehicle.plateNumber"),
    vehicleModel: requireText(
      record.vehicleModel ?? record.model,
      "vehicle.model",
    ),
    status: requireText(record.status, "vehicle.status"),
    odometerReading: toNonNegativeInteger(
      record.odometerReading ?? record.odometer ?? 0,
      "vehicle.odometerReading",
    ),
    updatedAt: validTimestampOrFallback(record.updatedAt, fallbackTimestamp),
  };
}

function mapMaintenanceSchedule(
  record: ServerMaintenanceSchedule,
  fallbackTimestamp: string,
): MaintenanceSchedule {
  return {
    id: requireText(record.id, "maintenanceSchedule.id"),
    vehicleId: requireText(record.vehicleId, "maintenanceSchedule.vehicleId"),
    title: requireText(record.title, "maintenanceSchedule.title"),
    triggerType: optionalText(record.triggerType),
    intervalType: optionalText(record.intervalType),
    status: requireText(record.status, "maintenanceSchedule.status"),
    assignedMechanic: optionalText(
      record.assignedMechanic ?? record.assignedDriver,
    ),
    dueDate: optionalText(
      record.dueDate ?? record.startReferenceDate ?? record.date,
    ),
    updatedAt: validTimestampOrFallback(record.updatedAt, fallbackTimestamp),
  };
}

function mapChecklists(
  response: ServerChecklistResponse,
  fallbackTimestamp: string,
): { templates: ChecklistTemplate[]; items: ChecklistItem[] } {
  const templates: ChecklistTemplate[] = [];
  const items: ChecklistItem[] = [];

  for (const [name, serverItems] of Object.entries(response)) {
    const templateId = `type:${encodeURIComponent(name)}`;
    templates.push({ id: templateId, name, updatedAt: fallbackTimestamp });
    for (const item of serverItems) {
      items.push({
        id: requireText(item.id, `checklist item in ${name}`),
        templateId,
        description: requireText(
          item.description ?? item.text,
          `checklist item ${item.id}`,
        ),
        isChecked: false,
      });
    }
  }
  return { templates, items };
}

function unwrapArray<T>(value: unknown, key: string): T[] {
  if (Array.isArray(value)) return value as T[];
  if (isObject(value) && Array.isArray(value.data)) return value.data as T[];
  if (isObject(value) && Array.isArray(value[key])) return value[key] as T[];
  throw new Error(`The API returned an invalid ${key} response`);
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
