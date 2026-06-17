# Partnership Google Sheet Sync

This Apps Script belongs inside the `SSM Growth Operations Hub` Google Sheet.

## Deploy

1. Open the sheet.
2. Go to `Extensions` -> `Apps Script`.
3. Paste the script below into `Code.gs`.
4. In Apps Script, open `Project Settings` -> `Script properties`.
5. Add `SYNC_SECRET` with the same value used by `PARTNERSHIP_SHEET_SYNC_SECRET` in the app.
6. Click `Deploy` -> `New deployment`.
7. Type: `Web app`.
8. Execute as: `Me`.
9. Who has access: `Anyone`.
10. Copy the `/exec` web app URL into `PARTNERSHIP_SHEET_SYNC_URL`.

The app writes to the sheet only after a rep clicks `UPDATE SHEET` for one selected partner, enters an instruction, and submits it.

## Script

```javascript
const ACTION_LOG_SHEET = 'Partnership Inbox Actions';
const ACTIVE_PARTNERS_SHEET = 'Active Partners';
const TODO_SHEET = 'Referral To-Do';

const ACTION_LOG_HEADERS = [
  'Timestamp',
  'Contact ID',
  'Name',
  'Company',
  'City',
  'Phone',
  'Email',
  'Batch',
  'Latest Message',
  'Action',
  'Status',
  'Next Step',
  'Rep',
  'App Link'
];

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || '{}');
    const expectedSecret = PropertiesService.getScriptProperties().getProperty('SYNC_SECRET');

    if (!expectedSecret || payload.secret !== expectedSecret) {
      return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureActionLog(ss);

    appendActionLog(ss, payload);

    const wroteCustomTarget = upsertDescribedSheetTarget(ss, payload);

    if (!wroteCustomTarget && payload.action === 'active_partner') {
      upsertActivePartner(ss, payload);
    }

    if (!wroteCustomTarget && ['drop_cards', 'meeting_requested', 'needs_follow_up'].includes(payload.action)) {
      upsertReferralTodo(ss, payload);
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse({ ok: false, error: String(error && error.message ? error.message : error) }, 500);
  }
}

function ensureActionLog(ss) {
  let sheet = ss.getSheetByName(ACTION_LOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(ACTION_LOG_SHEET);
  }

  const existing = sheet.getRange(1, 1, 1, ACTION_LOG_HEADERS.length).getValues()[0];
  const needsHeaders = ACTION_LOG_HEADERS.some((header, index) => existing[index] !== header);
  if (needsHeaders) {
    sheet.getRange(1, 1, 1, ACTION_LOG_HEADERS.length).setValues([ACTION_LOG_HEADERS]);
    sheet.setFrozenRows(1);
  }
}

function appendActionLog(ss, payload) {
  const sheet = ss.getSheetByName(ACTION_LOG_SHEET);
  const contact = payload.contact || {};

  sheet.appendRow([
    payload.timestamp || new Date().toISOString(),
    contact.id || '',
    contact.name || '',
    contact.company || '',
    contact.city || '',
    contact.phone || '',
    contact.email || '',
    contact.batch_id || '',
    payload.latest_message || '',
    payload.action_label || payload.action || '',
    payload.status || '',
    payload.sheet_note || payload.next_step || '',
    payload.rep || '',
    payload.app_contact_url || ''
  ]);
}

function upsertActivePartner(ss, payload) {
  const sheet = ss.getSheetByName(ACTIVE_PARTNERS_SHEET);
  if (!sheet) return;

  const contact = payload.contact || {};
  const row = findPartnerRow(sheet, contact);
  const targetRow = row || nextBlankRow(sheet, 5, 200, 2);
  if (!targetRow) return;

  const note = buildNote(payload);

  // Preserve formula columns A, H, I, J.
  sheet.getRange(targetRow, 2, 1, 6).setValues([[
    contact.name || '',
    contact.company || '',
    contact.industry || 'Realtor',
    contact.phone || '',
    contact.email || '',
    0.05
  ]]);
  sheet.getRange(targetRow, 11).setValue(note);
}

function upsertReferralTodo(ss, payload) {
  const sheet = ss.getSheetByName(TODO_SHEET);
  if (!sheet) return;

  const contact = payload.contact || {};
  const task = taskForAction(payload.action);
  const row = findTodoRow(sheet, contact, task.type) || nextBlankRow(sheet, 5, 300, 2);
  if (!row) return;

  // Preserve formula column A.
  sheet.getRange(row, 2, 1, 9).setValues([[
    contact.name || '',
    contact.company || '',
    task.type,
    task.actionNeeded,
    task.due,
    task.priority,
    task.status,
    'No',
    buildNote(payload)
  ]]);
}

function upsertDescribedSheetTarget(ss, payload) {
  const target = String(payload.sheet_target || '').trim();
  if (!target) return false;

  const normalizedTarget = normalizeText(target);
  if (!normalizedTarget || normalizedTarget.includes('closest partnership sheet section')) return false;
  if (normalizedTarget.includes(normalizeText(ACTIVE_PARTNERS_SHEET))) return false;
  if (normalizedTarget.includes(normalizeText(TODO_SHEET))) return false;
  if (normalizedTarget.includes(normalizeText(ACTION_LOG_SHEET))) return false;

  const sheet = findSheetByDescription(ss, target);
  if (!sheet) return false;

  upsertFlexibleSheetRow(sheet, payload);
  return true;
}

function findSheetByDescription(ss, target) {
  const normalizedTarget = normalizeText(target);
  const sheets = ss.getSheets();

  for (let i = 0; i < sheets.length; i++) {
    if (normalizeText(sheets[i].getName()) === normalizedTarget) return sheets[i];
  }

  for (let i = 0; i < sheets.length; i++) {
    const name = normalizeText(sheets[i].getName());
    if (normalizedTarget.includes(name) || name.includes(normalizedTarget)) return sheets[i];
  }

  return null;
}

function upsertFlexibleSheetRow(sheet, payload) {
  const contact = payload.contact || {};
  const headerInfo = findHeaderRow(sheet);

  if (!headerInfo) {
    sheet.appendRow([
      payload.timestamp || new Date().toISOString(),
      contact.name || '',
      contact.company || '',
      contact.city || '',
      contact.phone || '',
      contact.email || '',
      payload.action_label || payload.action || '',
      payload.status || '',
      payload.sheet_note || payload.next_step || '',
      payload.rep || '',
      payload.app_contact_url || ''
    ]);
    return;
  }

  const row = findFlexibleContactRow(sheet, headerInfo, contact) || Math.max(sheet.getLastRow() + 1, headerInfo.row + 1);
  const width = Math.max(headerInfo.headers.length, sheet.getLastColumn());
  const values = sheet.getRange(row, 1, 1, width).getValues()[0];

  setByHeader(values, headerInfo.map, ['timestamp', 'date', 'updated'], payload.timestamp || new Date().toISOString());
  setByHeader(values, headerInfo.map, ['name', 'contact', 'partner'], contact.name || '');
  setByHeader(values, headerInfo.map, ['company', 'brokerage', 'office'], contact.company || '');
  setByHeader(values, headerInfo.map, ['city', 'area'], contact.city || '');
  setByHeader(values, headerInfo.map, ['phone', 'mobile', 'cell'], contact.phone || '');
  setByHeader(values, headerInfo.map, ['email'], contact.email || '');
  setByHeader(values, headerInfo.map, ['action', 'type'], payload.action_label || payload.action || '');
  setByHeader(values, headerInfo.map, ['status', 'stage'], payload.status || '');
  setByHeader(values, headerInfo.map, ['notes', 'note', 'next step', 'next action'], buildNote(payload));
  setByHeader(values, headerInfo.map, ['rep', 'owner'], payload.rep || '');
  setByHeader(values, headerInfo.map, ['app link', 'link', 'crm'], payload.app_contact_url || '');

  sheet.getRange(row, 1, 1, width).setValues([values]);
}

function findHeaderRow(sheet) {
  const rowsToScan = Math.min(10, Math.max(1, sheet.getLastRow()));
  const colsToScan = Math.min(20, Math.max(1, sheet.getLastColumn()));
  const values = sheet.getRange(1, 1, rowsToScan, colsToScan).getValues();

  for (let r = 0; r < values.length; r++) {
    const normalized = values[r].map(normalizeText);
    const hasName = normalized.some(value => ['name', 'contact', 'partner'].includes(value));
    const hasNotes = normalized.some(value => ['notes', 'note', 'next step', 'next action'].includes(value));
    if (hasName && hasNotes) {
      const map = {};
      normalized.forEach((header, index) => {
        if (header) map[header] = index;
      });
      return { row: r + 1, headers: normalized, map };
    }
  }

  return null;
}

function findFlexibleContactRow(sheet, headerInfo, contact) {
  const startRow = headerInfo.row + 1;
  const lastRow = sheet.getLastRow();
  if (lastRow < startRow) return null;

  const width = Math.max(headerInfo.headers.length, sheet.getLastColumn());
  const values = sheet.getRange(startRow, 1, lastRow - startRow + 1, width).getValues();
  const phone = normalizePhone(contact.phone);
  const name = normalizeText(contact.name);

  const phoneIndex = firstHeaderIndex(headerInfo.map, ['phone', 'mobile', 'cell']);
  const nameIndex = firstHeaderIndex(headerInfo.map, ['name', 'contact', 'partner']);

  for (let i = 0; i < values.length; i++) {
    if (phone && phoneIndex >= 0 && normalizePhone(values[i][phoneIndex]) === phone) return startRow + i;
    if (name && nameIndex >= 0 && normalizeText(values[i][nameIndex]) === name) return startRow + i;
  }

  return null;
}

function setByHeader(rowValues, headerMap, aliases, value) {
  const index = firstHeaderIndex(headerMap, aliases);
  if (index >= 0) rowValues[index] = value;
}

function firstHeaderIndex(headerMap, aliases) {
  for (let i = 0; i < aliases.length; i++) {
    const index = headerMap[normalizeText(aliases[i])];
    if (typeof index === 'number') return index;
  }
  return -1;
}

function findPartnerRow(sheet, contact) {
  const values = sheet.getRange(5, 2, 196, 10).getValues();
  const phone = normalizePhone(contact.phone);
  const name = normalizeText(contact.name);
  const company = normalizeText(contact.company);

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const rowName = normalizeText(row[0]);
    const rowCompany = normalizeText(row[1]);
    const rowPhone = normalizePhone(row[3]);
    if (phone && rowPhone === phone) return i + 5;
    if (name && rowName === name && rowCompany === company) return i + 5;
  }
  return null;
}

function findTodoRow(sheet, contact, taskType) {
  const values = sheet.getRange(5, 2, 296, 8).getValues();
  const name = normalizeText(contact.name);
  const company = normalizeText(contact.company);
  const normalizedTask = normalizeText(taskType);

  for (let i = 0; i < values.length; i++) {
    const rowName = normalizeText(values[i][0]);
    const rowCompany = normalizeText(values[i][1]);
    const rowTask = normalizeText(values[i][2]);
    const done = normalizeText(values[i][7]);
    if (rowName === name && rowCompany === company && rowTask === normalizedTask && done !== 'yes') {
      return i + 5;
    }
  }
  return null;
}

function nextBlankRow(sheet, startRow, endRow, keyColumn) {
  const values = sheet.getRange(startRow, keyColumn, endRow - startRow + 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (!values[i][0]) return startRow + i;
  }
  return null;
}

function taskForAction(action) {
  if (action === 'drop_cards') {
    return {
      type: 'Bring flyers',
      actionNeeded: 'Drop off cards/flyers at their office.',
      due: 'Next working day / route planning',
      priority: 'High',
      status: 'Needs visit'
    };
  }

  if (action === 'meeting_requested') {
    return {
      type: 'Meeting',
      actionNeeded: 'Book or confirm a meeting time.',
      due: 'ASAP',
      priority: 'High',
      status: 'Needs scheduling'
    };
  }

  return {
    type: 'Follow-up',
    actionNeeded: 'Follow up from the partnership inbox.',
    due: 'Within 2 working days',
    priority: 'Medium',
    status: 'Needs follow-up'
  };
}

function buildNote(payload) {
  if (payload.sheet_note) {
    const parts = [payload.sheet_note];
    if (payload.sheet_target) parts.push('Sheet target: ' + payload.sheet_target);
    if (payload.app_contact_url) parts.push('App: ' + payload.app_contact_url);
    return parts.join('\n');
  }

  const parts = [];
  if (payload.manual_instruction) parts.push('Rep instruction: ' + payload.manual_instruction);
  if (payload.relationship_summary) parts.push('AI summary: ' + payload.relationship_summary);
  if (payload.ai_status) parts.push('AI status: ' + payload.ai_status);
  if (payload.ai_next_step) parts.push('AI next step: ' + payload.ai_next_step);
  if (payload.latest_message) parts.push('Latest reply: ' + payload.latest_message);
  if (payload.next_step) parts.push('Next step: ' + payload.next_step);
  if (payload.app_contact_url) parts.push('App: ' + payload.app_contact_url);
  return parts.join('\n');
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '').slice(-10);
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function jsonResponse(data, status) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
```
