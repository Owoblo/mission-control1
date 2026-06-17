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

The app writes to the sheet only after a partnership inbox quick action is clicked.

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

    if (payload.action === 'active_partner') {
      upsertActivePartner(ss, payload);
    }

    if (['drop_cards', 'meeting_requested', 'needs_follow_up'].includes(payload.action)) {
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
    payload.next_step || '',
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
  const parts = [];
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
