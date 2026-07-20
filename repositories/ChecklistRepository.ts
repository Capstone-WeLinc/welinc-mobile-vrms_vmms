import type { SQLiteDatabase } from 'expo-sqlite';

import type { ChecklistItem, ChecklistTemplate } from '../database/tables';

export class ChecklistRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async getTemplates(): Promise<ChecklistTemplate[]> {
    return this.db.getAllAsync<ChecklistTemplate>(
      'SELECT * FROM checklist_templates ORDER BY name ASC',
    );
  }

  async getItems(templateId: string): Promise<ChecklistItem[]> {
    const rows = await this.db.getAllAsync<Omit<ChecklistItem, 'isChecked'> & { isChecked: number }>(
      'SELECT * FROM checklist_items WHERE templateId = ? ORDER BY rowid ASC',
      templateId,
    );
    return rows.map((row) => ({ ...row, isChecked: row.isChecked === 1 }));
  }

  async setItemChecked(id: string, isChecked: boolean): Promise<void> {
    const result = await this.db.runAsync(
      'UPDATE checklist_items SET isChecked = ? WHERE id = ?',
      isChecked ? 1 : 0,
      id,
    );
    if (result.changes === 0) throw new Error(`Checklist item ${id} was not found`);
  }

  async reconcileSnapshot(templates: ChecklistTemplate[], items: ChecklistItem[]): Promise<void> {
    await this.db.execAsync(`
      CREATE TEMP TABLE IF NOT EXISTS incoming_template_ids (id TEXT PRIMARY KEY);
      CREATE TEMP TABLE IF NOT EXISTS incoming_checklist_item_ids (id TEXT PRIMARY KEY);
      DELETE FROM incoming_template_ids;
      DELETE FROM incoming_checklist_item_ids;
    `);
    const templateIdStatement = await this.db.prepareAsync(
      'INSERT OR IGNORE INTO incoming_template_ids (id) VALUES (?)',
    );
    const templateStatement = await this.db.prepareAsync(`
      INSERT INTO checklist_templates (id, name, updatedAt) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, updatedAt = excluded.updatedAt
    `);
    const itemIdStatement = await this.db.prepareAsync(
      'INSERT OR IGNORE INTO incoming_checklist_item_ids (id) VALUES (?)',
    );
    // Deliberately do not overwrite isChecked: it is local, offline user state.
    const itemStatement = await this.db.prepareAsync(`
      INSERT INTO checklist_items (id, templateId, description, isChecked) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        templateId = excluded.templateId,
        description = excluded.description
    `);

    try {
      for (const template of templates) {
        await templateIdStatement.executeAsync(template.id);
        await templateStatement.executeAsync(template.id, template.name, template.updatedAt);
      }
      for (const item of items) {
        await itemIdStatement.executeAsync(item.id);
        await itemStatement.executeAsync(
          item.id,
          item.templateId,
          item.description,
          item.isChecked ? 1 : 0,
        );
      }
      await this.db.runAsync(
        'DELETE FROM checklist_items WHERE id NOT IN (SELECT id FROM incoming_checklist_item_ids)',
      );
      await this.db.runAsync(
        'DELETE FROM checklist_templates WHERE id NOT IN (SELECT id FROM incoming_template_ids)',
      );
    } finally {
      await templateIdStatement.finalizeAsync();
      await templateStatement.finalizeAsync();
      await itemIdStatement.finalizeAsync();
      await itemStatement.finalizeAsync();
    }
  }
}
