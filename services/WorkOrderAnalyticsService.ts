import axios, { type AxiosInstance } from "axios";
import * as SecureStore from "expo-secure-store";
import { installMobileAuthRefresh } from "./mobileAuthRefresh";
import { API_BASE_URL } from "./AuthService";

const ACCESS_TOKEN_KEY = "vmms_access_token";

export interface ChecklistRecommendationStep {
  stepNumber: number;
  title: string;
  description: string;
  priority: "HIGH" | "MEDIUM" | "NORMAL" | "LOW" | string;
}

export interface WorkOrderRecommendationsResponse {
  scheduleId: string;
  title: string;
  vehiclePlate: string;
  workOrder?: Record<string, unknown> | null;
  checklist: ChecklistRecommendationStep[];
  aiRecommendations: string;
}

export interface WorkOrderAiInsightsResponse {
  aiSummary: string;
}

export interface WorkOrderSummaryData {
  totalWorkOrders: number;
  openWorkOrders: number;
  inProgressWorkOrders: number;
  overdueWorkOrders: number;
  completedWorkOrders: number;
  cancelledWorkOrders: number;
  totalPartsCost: number;
  totalLaborCost: number;
  totalCost: number;
  avgCostPerWorkOrder: number;
  workOrdersWithCost: number;
}

export interface WorkOrderSummaryResponse {
  dataSource?: Record<string, unknown>;
  summary: WorkOrderSummaryData;
  statusBreakdown?: Array<{
    status: string;
    workOrderCount: number;
    percentage: number;
    totalCost: number;
  }>;
  mechanicWorkload?: Array<Record<string, unknown>>;
  timeline?: Array<Record<string, unknown>>;
  topMaintenanceTypes?: Array<Record<string, unknown>>;
}

export const ANALYTICS_API_BASE_URL = API_BASE_URL;

export class WorkOrderAnalyticsService {
  private readonly api: AxiosInstance;
  private readonly fallbackApi: AxiosInstance;

  constructor(apiBaseUrl: string = ANALYTICS_API_BASE_URL) {
    this.api = axios.create({
      baseURL: apiBaseUrl,
      timeout: 15_000,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });

    this.fallbackApi = axios.create({
      baseURL: API_BASE_URL,
      timeout: 15_000,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
    installMobileAuthRefresh(this.api, API_BASE_URL);
    installMobileAuthRefresh(this.fallbackApi, API_BASE_URL);
  }

  private async getAuthHeaders(): Promise<Record<string, string>> {
    try {
      const token = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
      if (token?.trim()) {
        return { Authorization: `Bearer ${token.trim()}` };
      }
    } catch {
      // Ignore secure store read errors when offline
    }
    return {};
  }

  /**
   * Fetch AI advisory and recommended checklist steps for a work order schedule.
   */
  async getWorkOrderRecommendations(
    id: string,
    title?: string,
    vehicle?: string,
    checklistItems?: Array<{ text: string }> | string[],
  ): Promise<WorkOrderRecommendationsResponse> {
    const headers = await this.getAuthHeaders();
    const payload = {
      title,
      vehicle,
      checklistItems: checklistItems?.map((item) =>
        typeof item === "string" ? { text: item } : item,
      ),
    };

    const instances = [this.api, this.fallbackApi];
    const endpoints = [
      `/analytics/workorders/recommendations/${encodeURIComponent(id)}`,
      `/workorders/recommendations/${encodeURIComponent(id)}`,
    ];

    for (const client of instances) {
      for (const endpoint of endpoints) {
        try {
          const response = await client.post<WorkOrderRecommendationsResponse>(
            endpoint,
            payload,
            { headers },
          );
          if (response.data) {
            return response.data;
          }
        } catch {
          // Continue to next endpoint attempt
        }
      }
    }

    for (const client of instances) {
      for (const endpoint of endpoints) {
        try {
          const response = await client.get<WorkOrderRecommendationsResponse>(
            endpoint,
            { headers, params: { title, vehicle } },
          );
          if (response.data) {
            return response.data;
          }
        } catch {
          // Continue
        }
      }
    }

    console.warn(
      "[WorkOrderAnalyticsService] Recommendations offline fallback triggered",
    );
    return this.getOfflineRecommendationsFallback(id, title, vehicle);
  }

  /**
   * Fetch overall AI insights for fleet work order metrics and mechanic performance.
   */
  async getWorkOrderAiInsights(): Promise<string> {
    const headers = await this.getAuthHeaders();
    try {
      const response = await this.api.get<WorkOrderAiInsightsResponse>(
        "/workorders/ai-insights",
        { headers },
      );
      return response.data.aiSummary;
    } catch {
      try {
        const response = await this.api.get<WorkOrderAiInsightsResponse>(
          "/analytics/workorders/ai-insights",
          { headers },
        );
        return response.data.aiSummary;
      } catch (err) {
        console.warn(
          "[WorkOrderAnalyticsService] AI Insights offline fallback triggered",
          err,
        );
        return (
          "Offline AI Summary:\n" +
          "1. Status Summary\n" +
          "Fleet operates on local offline SQLite cache. Synchronize when connected to backend to load live AI metrics.\n\n" +
          "2. Mechanic Performance\n" +
          "• Local work order progress is tracked on device.\n" +
          "• Review pending inspections and submit completed tasks when online.\n\n" +
          "3. Priority Actions\n" +
          "• Focus on overdue schedules.\n" +
          "• Ensure OEM torque specifications and safety procedures are followed."
        );
      }
    }
  }

  /**
   * Fetch Work Order summary and metrics from DuckDB DataMart.
   */
  async getWorkOrderSummary(): Promise<WorkOrderSummaryResponse | null> {
    const headers = await this.getAuthHeaders();
    try {
      const response = await this.api.get<WorkOrderSummaryResponse>(
        "/workorders",
        { headers },
      );
      return response.data;
    } catch {
      try {
        const response = await this.api.get<WorkOrderSummaryResponse>(
          "/analytics/workorders",
          { headers },
        );
        return response.data;
      } catch (err) {
        console.warn(
          "[WorkOrderAnalyticsService] WorkOrder Summary offline fallback",
          err,
        );
        return null;
      }
    }
  }

  private getOfflineRecommendationsFallback(
    id: string,
    title?: string,
    vehicle?: string,
  ): WorkOrderRecommendationsResponse {
    const workOrderTitle = title || "Maintenance Work Order";
    const vehiclePlate = vehicle || "Vehicle";

    return {
      scheduleId: id,
      title: workOrderTitle,
      vehiclePlate,
      workOrder: null,
      checklist: [
        {
          stepNumber: 1,
          title: "Pre-Work Safety & Visual Inspection",
          description:
            "Inspect workspace, secure vehicle, check for leaks/damage around area.",
          priority: "HIGH",
        },
        {
          stepNumber: 2,
          title: "Component Disassembly & Inspection",
          description: `Access and inspect components relevant to ${workOrderTitle}.`,
          priority: "HIGH",
        },
        {
          stepNumber: 3,
          title: "Part Replacement / Fluid Service",
          description:
            "Replace worn parts or fluids according to VMMS service manual standards.",
          priority: "HIGH",
        },
        {
          stepNumber: 4,
          title: "Torque & Fastener Verification",
          description:
            "Verify all bolts, fittings, and clamps are torqued to OEM specifications.",
          priority: "MEDIUM",
        },
        {
          stepNumber: 5,
          title: "Post-Service Test & Diagnostics",
          description:
            "Run engine/system test, verify zero leakage or error codes.",
          priority: "MEDIUM",
        },
        {
          stepNumber: 6,
          title: "Sign-off & Work Order Logging",
          description:
            "Log completed tasks, parts used, and updated odometer reading.",
          priority: "LOW",
        },
      ],
      aiRecommendations: `Technical Advisory for ${workOrderTitle} (${vehiclePlate}):\n- Perform standard pre-service safety isolation.\n- Refer to VMMS OEM manual for torque specs and fluid capacities.\n- Verify leak-free operation prior to sign-off.\n\n(Offline mode: displaying standard technical advisory)`,
    };
  }
}
