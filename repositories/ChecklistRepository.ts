import type { SQLiteDatabase } from "expo-sqlite";

import type { ChecklistItem, ChecklistTemplate } from "../database/tables";

export class ChecklistRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async getTemplates(): Promise<ChecklistTemplate[]> {
    return this.db.getAllAsync<ChecklistTemplate>(
      "SELECT * FROM checklist_templates WHERE deletedAt IS NULL ORDER BY type ASC",
    );
  }

  async getTemplateById(id: string): Promise<ChecklistTemplate | null> {
    return this.db.getFirstAsync<ChecklistTemplate>(
      "SELECT * FROM checklist_templates WHERE id = ? AND deletedAt IS NULL",
      id,
    );
  }

  async getTemplateByType(type: string): Promise<ChecklistTemplate | null> {
    return this.db.getFirstAsync<ChecklistTemplate>(
      "SELECT * FROM checklist_templates WHERE deletedAt IS NULL AND LOWER(type) = LOWER(?)",
      type.trim(),
    );
  }

  async resolveTemplateId(value: string): Promise<string | null> {
    const lookup = value.trim();
    const byId = await this.getTemplateById(lookup);
    if (byId) return byId.id;

    const byType = await this.getTemplateByType(lookup);
    if (byType) return byType.id;

    if (lookup.startsWith("type:")) {
      const decodedType = decodeURIComponent(
        lookup.slice("type:".length),
      ).trim();
      const decodedById = await this.getTemplateById(decodedType);
      if (decodedById) return decodedById.id;
      const decodedByType = await this.getTemplateByType(decodedType);
      if (decodedByType) return decodedByType.id;
      const encodedTypeId = `type:${encodeURIComponent(decodedType)}`;
      const encodedById = await this.getTemplateById(encodedTypeId);
      if (encodedById) return encodedById.id;
    } else {
      const encodedTypeId = `type:${encodeURIComponent(lookup)}`;
      const encodedById = await this.getTemplateById(encodedTypeId);
      if (encodedById) return encodedById.id;
    }

    return null;
  }

  async getItemsByTemplateId(templateId: string): Promise<ChecklistItem[]> {
    const normalizedTemplateId = templateId?.trim();
    if (!normalizedTemplateId) {
      return [];
    }

    return this.db.getAllAsync<ChecklistItem>(
      'SELECT * FROM checklist_items WHERE checklistTemplateId = ? AND deletedAt IS NULL ORDER BY "order" ASC, createdAt ASC',
      normalizedTemplateId,
    );
  }

  async getItems(templateId: string): Promise<ChecklistItem[]> {
    return this.getItemsByTemplateId(templateId);
  }

  async setItemCompleted(id: string): Promise<void> {
    const result = await this.db.runAsync(
      "UPDATE checklist_items SET updatedAt = datetime('now') WHERE id = ?",
      id,
    );
    if (result.changes === 0)
      throw new Error(`Checklist item ${id} was not found`);
  }

  async reconcileSnapshot(
    templates: ChecklistTemplate[],
    items: ChecklistItem[],
  ): Promise<void> {
    await this.db.execAsync(`
      CREATE TEMP TABLE IF NOT EXISTS incoming_template_ids (id TEXT PRIMARY KEY);
      CREATE TEMP TABLE IF NOT EXISTS incoming_checklist_item_ids (id TEXT PRIMARY KEY);
      DELETE FROM incoming_template_ids;
      DELETE FROM incoming_checklist_item_ids;
    `);

    try {
      for (const template of templates) {
        await this.db.runAsync(
          "INSERT OR IGNORE INTO incoming_template_ids (id) VALUES (?)",
          template.id,
        );
        await this.db.runAsync(
          `INSERT INTO checklist_templates (id, type, deletedAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET 
             type = excluded.type, 
             deletedAt = excluded.deletedAt,
             updatedAt = excluded.updatedAt`,
          template.id,
          template.type,
          template.deletedAt,
          template.createdAt,
          template.updatedAt,
        );
      }

      for (const item of items) {
        await this.db.runAsync(
          "INSERT OR IGNORE INTO incoming_checklist_item_ids (id) VALUES (?)",
          item.id,
        );
        await this.db.runAsync(
          `INSERT INTO checklist_items (id, checklistTemplateId, text, "order", deletedAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             checklistTemplateId = excluded.checklistTemplateId,
             text = excluded.text,
             "order" = excluded."order",
             deletedAt = excluded.deletedAt,
             updatedAt = excluded.updatedAt`,
          item.id,
          item.checklistTemplateId,
          item.text,
          item.order,
          item.deletedAt,
          item.createdAt,
          item.updatedAt,
        );
      }

      await this.db.runAsync(
        "DELETE FROM checklist_items WHERE id NOT IN (SELECT id FROM incoming_checklist_item_ids)",
      );
      await this.db.runAsync(
        "DELETE FROM checklist_templates WHERE id NOT IN (SELECT id FROM incoming_template_ids)",
      );
    } catch (error) {
      console.error("[SQLite] Checklist reconciliation failed", error);
      throw error;
    }
  }
}
