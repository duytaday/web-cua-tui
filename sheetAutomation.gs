/**
 * Google Sheets automation script for case tracking.
 *
 * The workflow keeps the CASE TRACKING sheet clean, automatically stamps
 * CreatedAt / DaysOpen, and archives resolved cases in a dedicated sheet with
 * running numbers and resolution metrics.
 */

/******** CONFIG ********/
const SHEET_MAIN = 'CASE TRACKING';
const SHEET_RES = 'Resolved case';
const RES_KEYS = ['RESOLVED'];
const START_ROW = 5;
const CASE_ID_PREFIX = 'CASE-';
const CASE_ID_PAD = 4;
const CASE_ID_PROPERTY = 'CASE_ID_COUNTER';

/******** HELPERS ********/
const normHeader_ = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const trimU_ = value => String(value || '').trim().toUpperCase();

function withLock_(fn) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    fn();
  } finally {
    lock.releaseLock();
  }
}

function detectHeaderRow_(sheet) {
  const lastCol = sheet.getLastColumn();
  const maxRow = Math.max(1, START_ROW - 1);
  let best = { row: 1, score: -1 };

  for (let r = 1; r <= maxRow; r++) {
    const vals = sheet.getRange(r, 1, 1, lastCol).getDisplayValues()[0].map(normHeader_);
    let score = 0;
    ['ID', 'TICKET', 'STATUS'].forEach(key => {
      if (vals.includes(key)) score++;
    });
    if (score > best.score) best = { row: r, score };
  }

  return best.row;
}

function getHeaderInfo_(sheet) {
  const row = detectHeaderRow_(sheet);
  const lastCol = sheet.getLastColumn();
  const values = sheet.getRange(row, 1, 1, lastCol).getDisplayValues()[0];
  const map = {};

  values.forEach((value, idx) => {
    map[normHeader_(value)] = idx + 1;
  });

  return { row, map, lastCol };
}

function ensureColumns_(sheet, headerInfo, requiredNormNames) {
  let { row, map } = headerInfo;
  let lastCol = sheet.getLastColumn();

  requiredNormNames.forEach(name => {
    if (map[name]) return;

    lastCol += 1;
    sheet.insertColumnAfter(lastCol - 1);

    const label = name === 'CREATEDAT'
      ? 'CreatedAt'
      : name === 'DAYSOPEN'
        ? 'DaysOpen'
        : name === 'CASEID'
          ? 'CaseID'
          : name;

    sheet.getRange(row, lastCol).setValue(label);
    map[name] = lastCol;
  });

  return { headerRow: row, map, lastCol: sheet.getLastColumn() };
}

function statusCol_(headerInfo) {
  return headerInfo.map['STATUS'] || 6;
}

function existsInResolvedByTicket_(ticket) {
  if (!ticket) return false;

  const resolvedSheet = ensureResolvedSheet_();
  const lastRow = resolvedSheet.getLastRow();
  if (lastRow <= 1) return false;

  const tickets = resolvedSheet.getRange(2, 2, lastRow - 1, 1).getValues();
  return tickets.some(row => String(row[0]) === String(ticket));
}

function colToLetter_(col) {
  let letter = '';
  let temp = col;
  while (temp > 0) {
    const mod = (temp - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    temp = Math.floor((temp - mod) / 26);
  }
  return letter;
}

function formatCaseId_(num) {
  return CASE_ID_PREFIX + String(num).padStart(CASE_ID_PAD, '0');
}

function parseCaseIdNumber_(value) {
  const raw = String(value || '').trim();
  if (!raw || !raw.startsWith(CASE_ID_PREFIX)) return 0;
  const parsed = parseInt(raw.substring(CASE_ID_PREFIX.length), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function maxIdFromValues_(values) {
  return values.reduce((max, row) => {
    const candidate = parseCaseIdNumber_(row[0]);
    return candidate > max ? candidate : max;
  }, 0);
}

function computeMaxCaseId_() {
  const ss = SpreadsheetApp.getActive();
  let max = 0;

  const main = ss.getSheetByName(SHEET_MAIN);
  if (main) {
    const info = getHeaderInfo_(main);
    const caseIdCol = info.map['CASEID'];
    const firstDataRow = Math.max(info.row + 1, START_ROW);
    const lastRow = main.getLastRow();
    if (caseIdCol && lastRow >= firstDataRow) {
      const count = lastRow - firstDataRow + 1;
      const values = main.getRange(firstDataRow, caseIdCol, count, 1).getValues();
      max = Math.max(max, maxIdFromValues_(values));
    }
  }

  const resolved = ss.getSheetByName(SHEET_RES);
  if (resolved) {
    const lastRow = resolved.getLastRow();
    if (lastRow > 1) {
      const values = resolved.getRange(2, 2, lastRow - 1, 1).getValues();
      max = Math.max(max, maxIdFromValues_(values));
    }
  }

  return max;
}

function generateNextCaseId_() {
  const props = PropertiesService.getDocumentProperties();
  let stored = parseInt(props.getProperty(CASE_ID_PROPERTY) || '0', 10);
  if (!Number.isFinite(stored) || stored <= 0) {
    stored = computeMaxCaseId_();
  }

  const nextNumber = stored + 1;
  props.setProperty(CASE_ID_PROPERTY, String(nextNumber));
  return formatCaseId_(nextNumber);
}

function ensureCaseIdForRow_(sheet, ensured, row) {
  const caseIdCol = ensured.map['CASEID'];
  if (!caseIdCol) return '';

  const cell = sheet.getRange(row, caseIdCol);
  const existing = String(cell.getDisplayValue()).trim();
  if (existing) return existing;

  const generated = generateNextCaseId_();
  cell.setValue(generated);
  return generated;
}

/******** RESOLVED SHEET ********/
function ensureResolvedSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(SHEET_RES);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_RES);
  }

  const header = ['#', 'CASEID', 'TICKET', 'CREATEDAT', 'MC NAME', 'SUBJECT', 'TOPIC', 'STATUS', 'NOTE', 'ResolvedTime', 'DaysToResolve'];
  sheet.getRange(1, 1, 1, header.length).setValues([header]);

  const a2 = sheet.getRange('A2').getFormula();
  if (!a2) {
    sheet.getRange('A2').setFormula(
      '=ARRAYFORMULA(IF(B2:B="","",MATCH(ROW(B2:B),FILTER(ROW(B2:B),B2:B<>""),0)))'
    );
  }

  return sheet;
}

function appendToResolved_(record) {
  const resolvedSheet = ensureResolvedSheet_();
  const targetRow = resolvedSheet.getLastRow() + 1;

  resolvedSheet.getRange(targetRow, 1, 1, 10).setValues([[
    '', record.caseId || '', record.ticket, record.createdAt, record.mc, record.subject,
    record.topic, record.status, record.note, new Date()
  ]]);

  if (record.createdAt) {
    resolvedSheet.getRange(targetRow, 11).setFormulaR1C1('=R[0]C[-1]-R[0]C[-7]');
  } else {
    resolvedSheet.getRange(targetRow, 11).setValue('');
  }

  const lastRow = resolvedSheet.getLastRow();
  if (lastRow > 2) {
    resolvedSheet.getRange(2, 1, lastRow - 1, 11).sort([{ column: 10, ascending: false }]);
  }
}

/******** MAIN TRIGGER ********/
function onEdit(e) {
  if (!e || !e.range) return;

  const sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET_MAIN) return;

  withLock_(() => {
    const headerInfo = getHeaderInfo_(sheet);
    const firstDataRow = Math.max(headerInfo.row + 1, START_ROW);
    const r = e.range.getRow();
    const c = e.range.getColumn();
    if (r < firstDataRow) return;

    const ensured = ensureColumns_(sheet, headerInfo, ['CASEID', 'CREATEDAT', 'DAYSOPEN']);
    const createdAtCol = ensured.map['CREATEDAT'];
    const daysOpenCol = ensured.map['DAYSOPEN'];
    const statusCol = statusCol_(ensured);
    const caseIdCol = ensured.map['CASEID'];

    const ticketCol = ensured.map['TICKET'] || 2;
    const subjectCol = ensured.map['SUBJECT'] || 5;
    const ticketValue = sheet.getRange(r, ticketCol).getDisplayValue().trim();
    const subjectValue = sheet.getRange(r, subjectCol).getDisplayValue().trim();
    const hasContent = ticketValue !== '' || subjectValue !== '';

    let caseId = '';
    if (hasContent) {
      caseId = ensureCaseIdForRow_(sheet, ensured, r);
      const createdCell = sheet.getRange(r, createdAtCol);
      if (!createdCell.getValue()) {
        createdCell.setValue(new Date());
      }
      const offset = createdAtCol - daysOpenCol;
      sheet.getRange(r, daysOpenCol)
        .setFormulaR1C1('=IF(R[0]C[' + offset + ']="","",TODAY()-R[0]C[' + offset + '])');
    } else {
      sheet.getRange(r, daysOpenCol).clearContent();
      if (caseIdCol) {
        sheet.getRange(r, caseIdCol).clearContent();
      }
    }

    if (c !== statusCol) return;

    const statusDisp = trimU_(e.range.getDisplayValue());
    const isResolved = RES_KEYS.some(key => statusDisp.indexOf(key) !== -1);
    if (!isResolved) return;

    const m = ensured.map;
    const colMC = m['MCNAME'] || m['MC NAME'] || 4;
    const colTopic = m['TOPIC'] || 6;
    const colNote = m['NOTE'] || m['NOTES'] || 8;

    const ticket = sheet.getRange(r, ticketCol).getDisplayValue();
    const createdAt = sheet.getRange(r, createdAtCol).getValue();
    const mc = sheet.getRange(r, colMC).getDisplayValue();
    const subject = sheet.getRange(r, subjectCol).getDisplayValue();
    const topic = sheet.getRange(r, colTopic).getDisplayValue();
    const status = sheet.getRange(r, statusCol).getDisplayValue();
    const note = sheet.getRange(r, colNote).getDisplayValue();
    if (!caseId) {
      caseId = ensureCaseIdForRow_(sheet, ensured, r);
    }

    if (existsInResolvedByTicket_(ticket)) {
      sheet.deleteRow(r);
      SpreadsheetApp.getActive().toast('Already in "' + SHEET_RES + '" (skipped dup).', 'INFO', 2);
      return;
    }

    appendToResolved_({
      caseId,
      ticket,
      createdAt,
      mc,
      subject,
      topic,
      status,
      note
    });

    sheet.deleteRow(r);
    SpreadsheetApp.getActive().toast('Moved to "' + SHEET_RES + '" & sorted', 'OK', 2);
  });
}

/******** UTILITIES ********/
function installOnEdit() {
  const ss = SpreadsheetApp.getActive();
  ScriptApp.getUserTriggers(ss).forEach(trigger => {
    if (trigger.getHandlerFunction() === 'onEdit') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger('onEdit').forSpreadsheet(ss).onEdit().create();
  SpreadsheetApp.getActive().toast('Installable onEdit trigger installed', 'OK', 3);
}

function backfillCreatedAtDaysOpen() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SHEET_MAIN);
  if (!sheet) throw new Error('Sheet "' + SHEET_MAIN + '" not found.');

  const headerInfo = getHeaderInfo_(sheet);
  const ensured = ensureColumns_(sheet, headerInfo, ['CASEID', 'CREATEDAT', 'DAYSOPEN']);
  const createdAtCol = ensured.map['CREATEDAT'];
  const daysOpenCol = ensured.map['DAYSOPEN'];
  const firstDataRow = Math.max(ensured.headerRow + 1, START_ROW);
  const lastRow = sheet.getLastRow();

  for (let row = firstDataRow; row <= lastRow; row++) {
    ensureCaseIdForRow_(sheet, ensured, row);
    const createdCell = sheet.getRange(row, createdAtCol);
    if (!createdCell.getValue()) {
      createdCell.setValue(new Date());
    }
    const offset = createdAtCol - daysOpenCol;
    sheet.getRange(row, daysOpenCol).setFormulaR1C1('=IF(R[0]C[' + offset + ']="", "", TODAY()-R[0]C[' + offset + '])');
  }

  SpreadsheetApp.getActive().toast('Backfilled CreatedAt/DaysOpen', 'OK', 3);
}

function rebuildResolved() {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(SHEET_RES);
  if (sheet) ss.deleteSheet(sheet);
  ensureResolvedSheet_();
  SpreadsheetApp.getActive().toast('Resolved case rebuilt', 'OK', 3);
}

function testMoveFirst() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SHEET_MAIN);
  if (!sheet) throw new Error('Sheet "' + SHEET_MAIN + '" not found.');

  const headerInfo = getHeaderInfo_(sheet);
  const statusColumn = statusCol_(headerInfo);
  const firstDataRow = Math.max(headerInfo.row + 1, START_ROW);
  sheet.getRange(firstDataRow, statusColumn).setValue('RESOLVED');
}

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Case System')
    .addItem('Install onEdit trigger', 'installOnEdit')
    .addSeparator()
    .addItem('Backfill CreatedAt/DaysOpen', 'backfillCreatedAtDaysOpen')
    .addItem('Rebuild Resolved case', 'rebuildResolved')
    .addSeparator()
    .addItem('Setup formatting & validation', 'setupMainSheet')
    .addItem('Restore selected from Resolved', 'restoreSelectedFromResolved')
    .addSeparator()
    .addItem('Apply duplicate highlighting', 'applyDuplicateHighlighting')
    .addItem('Scan duplicate tickets', 'scanDuplicateTickets')
    .addItem('Apply SLA highlighting', 'applySlaFormatting')
    .addSeparator()
    .addItem('Refresh analytics dashboard', 'refreshAnalyticsDashboard')
    .addToUi();
}

function setupMainSheet() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_MAIN);
  if (!sheet) return;

  const headerInfo = getHeaderInfo_(sheet);
  const firstDataRow = Math.max(headerInfo.row + 1, START_ROW);

  sheet.setFrozenRows(headerInfo.row);

  const lastRow = Math.max(sheet.getLastRow(), firstDataRow);
  const lastCol = sheet.getLastColumn();
  sheet.getBandings().forEach(banding => banding.remove());
  sheet.getRange(headerInfo.row, 1, lastRow - headerInfo.row, lastCol)
    .applyRowBanding(SpreadsheetApp.BandingTheme.BLUE);

  const statusCol = statusCol_(headerInfo);
  const validation = SpreadsheetApp.newDataValidation()
    .requireValueInList(['WOC', 'DOING', 'PROGRESS', 'RESOLVED', 'WAITING', 'CANCEL'], true)
    .setAllowInvalid(false)
    .build();

  const dataRowCount = lastRow - headerInfo.row;
  if (dataRowCount > 0) {
    sheet.getRange(firstDataRow, statusCol, dataRowCount).setDataValidation(validation);
  }

  applyDuplicateHighlightingForSheet_(sheet, headerInfo, 'TICKET', { firstRow: firstDataRow });

  SpreadsheetApp.getActive().toast('Main sheet formatted & validation applied.', 'OK', 3);
}

function restoreSelectedFromResolved() {
  withLock_(() => {
    const ss = SpreadsheetApp.getActive();
    const resolvedSheet = ss.getSheetByName(SHEET_RES);
    const mainSheet = ss.getSheetByName(SHEET_MAIN);
    if (!resolvedSheet || !mainSheet) return;

    const range = resolvedSheet.getActiveRange();
    if (!range || range.getNumRows() !== 1) {
      SpreadsheetApp.getActive().toast('Select exactly 1 row in "' + SHEET_RES + '".', 'INFO', 3);
      return;
    }

    const row = range.getRow();
    if (row <= 1) return;

    const values = resolvedSheet.getRange(row, 1, 1, 11).getValues()[0];

    const headerInfo = getHeaderInfo_(mainSheet);
    const map = headerInfo.map;
    const lastCol = mainSheet.getLastColumn();
    const dataRow = Array.from({ length: lastCol }, () => '');

    const assign = (normName, value) => {
      const col = map[normName];
      if (col) dataRow[col - 1] = value;
    };

    assign('CASEID', values[1]);
    assign('TICKET', values[2]);
    assign('CREATEDAT', values[3]);
    assign('MCNAME', values[4]);
    assign('MC NAME', values[4]);
    assign('SUBJECT', values[5]);
    assign('TOPIC', values[6]);
    assign('STATUS', 'WOC');
    assign('NOTE', values[8]);

    mainSheet.appendRow(dataRow);
    resolvedSheet.deleteRow(row);
    SpreadsheetApp.getActive().toast('Restored to "' + SHEET_MAIN + '".', 'OK', 3);
  });
}

function applySlaFormatting() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_MAIN);
  if (!sheet) return;

  const headerInfo = getHeaderInfo_(sheet);
  const map = headerInfo.map;
  const deadlineCol = map['DEADLINE'];
  if (!deadlineCol) {
    SpreadsheetApp.getActive().toast('No DEADLINE column found.', 'INFO', 3);
    return;
  }

  const statusCol = statusCol_(headerInfo);
  const deadlineLetter = colToLetter_(deadlineCol);
  const statusLetter = colToLetter_(statusCol);

  const firstRow = Math.max(headerInfo.row + 1, START_ROW);
  const dataRowCount = sheet.getLastRow() - firstRow + 1;
  if (dataRowCount <= 0) {
    SpreadsheetApp.getActive().toast('No data rows to format.', 'INFO', 3);
    return;
  }

  const range = sheet.getRange(firstRow, 1, dataRowCount, sheet.getLastColumn());
  const overdueFormula = `=AND($${deadlineLetter}${firstRow}<TODAY(),$${statusLetter}${firstRow}<>"RESOLVED")`;
  const warningFormula = `=AND($${deadlineLetter}${firstRow}-TODAY()<=2,$${deadlineLetter}${firstRow}>=TODAY(),$${statusLetter}${firstRow}<>"RESOLVED")`;

  const filtered = sheet.getConditionalFormatRules().filter(rule => {
    const condition = typeof rule.getBooleanCondition === 'function' ? rule.getBooleanCondition() : null;
    if (!condition || condition.getCriteriaType() !== SpreadsheetApp.BooleanConditionType.CUSTOM_FORMULA) return true;
    const formula = condition.getCriteriaValues()[0];
    return formula !== overdueFormula && formula !== warningFormula;
  });

  filtered.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(overdueFormula)
    .setBackground('#F4CCCC')
    .setRanges([range])
    .build());

  filtered.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(warningFormula)
    .setBackground('#FFF2CC')
    .setRanges([range])
    .build());

  sheet.setConditionalFormatRules(filtered);
  SpreadsheetApp.getActive().toast('SLA formatting applied.', 'OK', 3);
}

function applyDuplicateHighlightingForSheet_(sheet, headerInfo, columnNormName, options) {
  const columnIndex = headerInfo.map[columnNormName];
  if (!columnIndex) return false;

  const firstRow = options && options.firstRow ? options.firstRow : headerInfo.row + 1;
  const lastRow = sheet.getLastRow();
  if (lastRow < firstRow) return false;

  const range = sheet.getRange(firstRow, 1, lastRow - firstRow + 1, sheet.getLastColumn());
  const letter = colToLetter_(columnIndex);
  const formula = `=AND(INDEX($${letter}:$${letter},ROW())<>"",COUNTIF($${letter}:$${letter},INDEX($${letter}:$${letter},ROW()))>1)`;

  const rules = sheet.getConditionalFormatRules().filter(rule => {
    const condition = typeof rule.getBooleanCondition === 'function' ? rule.getBooleanCondition() : null;
    if (!condition || condition.getCriteriaType() !== SpreadsheetApp.BooleanConditionType.CUSTOM_FORMULA) return true;
    return condition.getCriteriaValues()[0] !== formula;
  });

  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(formula)
    .setBackground('#F8CBAD')
    .setRanges([range])
    .build());

  sheet.setConditionalFormatRules(rules);
  return true;
}

function applyDuplicateHighlighting() {
  const ss = SpreadsheetApp.getActive();
  let applied = false;

  const main = ss.getSheetByName(SHEET_MAIN);
  if (main) {
    const info = getHeaderInfo_(main);
    applied = applyDuplicateHighlightingForSheet_(main, info, 'TICKET', { firstRow: Math.max(info.row + 1, START_ROW) }) || applied;
  }

  const resolved = ss.getSheetByName(SHEET_RES);
  if (resolved) {
    const info = getHeaderInfo_(resolved);
    applied = applyDuplicateHighlightingForSheet_(resolved, info, 'TICKET', { firstRow: info.row + 1 }) || applied;
  }

  SpreadsheetApp.getActive().toast(applied ? 'Duplicate highlighting refreshed.' : 'No ticket column found to highlight.', applied ? 'OK' : 'INFO', 3);
}

function scanDuplicateTickets() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SHEET_MAIN);
  if (!sheet) return;

  const headerInfo = getHeaderInfo_(sheet);
  const ticketCol = headerInfo.map['TICKET'];
  if (!ticketCol) {
    SpreadsheetApp.getActive().toast('No TICKET column found.', 'INFO', 3);
    return;
  }

  const firstRow = Math.max(headerInfo.row + 1, START_ROW);
  const lastRow = sheet.getLastRow();
  if (lastRow < firstRow) {
    SpreadsheetApp.getActive().toast('No data rows to scan.', 'INFO', 3);
    return;
  }

  const values = sheet.getRange(firstRow, ticketCol, lastRow - firstRow + 1, 1).getDisplayValues();
  const counts = {};
  values.forEach(row => {
    const ticket = String(row[0]).trim();
    if (!ticket) return;
    counts[ticket] = (counts[ticket] || 0) + 1;
  });

  const duplicates = Object.keys(counts).filter(ticket => counts[ticket] > 1).sort();
  const ui = SpreadsheetApp.getUi();
  if (duplicates.length === 0) {
    ui.alert('Duplicate scan', 'No duplicate tickets detected.', ui.ButtonSet.OK);
    applyDuplicateHighlighting();
    return;
  }

  const preview = duplicates.slice(0, 20).map(ticket => `${ticket} (${counts[ticket]}x)`).join('\n');
  const suffix = duplicates.length > 20 ? '\n\n...and more' : '';
  ui.alert('Duplicate scan', `Found ${duplicates.length} duplicate ticket${duplicates.length > 1 ? 's' : ''}:\n\n${preview}${suffix}`, ui.ButtonSet.OK);
  applyDuplicateHighlighting();
}

function refreshAnalyticsDashboard() {
  withLock_(() => {
    const ss = SpreadsheetApp.getActive();
    let sheet = ss.getSheetByName('Case Analytics');
    if (!sheet) {
      sheet = ss.insertSheet('Case Analytics');
    }

    sheet.clear();

    let openCount = 0;
    let oldestOpenAge = 0;
    const statusCounts = {};

    const main = ss.getSheetByName(SHEET_MAIN);
    if (main) {
      const info = getHeaderInfo_(main);
      const firstRow = Math.max(info.row + 1, START_ROW);
      const lastRow = main.getLastRow();
      if (lastRow >= firstRow) {
        const rowCount = lastRow - firstRow + 1;
        const ticketCol = info.map['TICKET'] || 2;
        const subjectCol = info.map['SUBJECT'];
        const statusCol = statusCol_(info);
        const daysOpenCol = info.map['DAYSOPEN'];

        const tickets = ticketCol ? main.getRange(firstRow, ticketCol, rowCount, 1).getDisplayValues() : [];
        const subjects = subjectCol ? main.getRange(firstRow, subjectCol, rowCount, 1).getDisplayValues() : [];
        const statuses = statusCol ? main.getRange(firstRow, statusCol, rowCount, 1).getDisplayValues() : [];
        const daysOpen = daysOpenCol ? main.getRange(firstRow, daysOpenCol, rowCount, 1).getValues() : [];

        for (let i = 0; i < rowCount; i++) {
          const ticket = tickets[i] ? String(tickets[i][0]).trim() : '';
          const subject = subjects[i] ? String(subjects[i][0]).trim() : '';
          if (!ticket && !subject) continue;
          openCount++;

          if (statuses[i]) {
            const status = String(statuses[i][0] || '').trim() || 'UNSPECIFIED';
            statusCounts[status] = (statusCounts[status] || 0) + 1;
          }

          if (daysOpenCol) {
            const dayValue = Number(daysOpen[i] ? daysOpen[i][0] : '');
            if (!Number.isNaN(dayValue)) {
              oldestOpenAge = Math.max(oldestOpenAge, dayValue);
            }
          }
        }
      }
    }

    let resolvedThisMonth = 0;
    const recentDurations = [];
    const resolved = ss.getSheetByName(SHEET_RES);
    if (resolved) {
      const lastRow = resolved.getLastRow();
      if (lastRow > 1) {
        const resolvedTimes = resolved.getRange(2, 10, lastRow - 1, 1).getValues();
        const daysToResolve = resolved.getRange(2, 11, lastRow - 1, 1).getValues();
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        for (let i = 0; i < resolvedTimes.length; i++) {
          const resolvedAt = resolvedTimes[i][0];
          if (!(resolvedAt instanceof Date)) continue;
          if (resolvedAt >= monthStart && resolvedAt < monthEnd) {
            resolvedThisMonth++;
          }
          if (resolvedAt >= cutoff) {
            const days = Number(daysToResolve[i][0]);
            if (!Number.isNaN(days)) {
              recentDurations.push(days);
            }
          }
        }
      }
    }

    const averageRecent = recentDurations.length
      ? Number((recentDurations.reduce((sum, value) => sum + value, 0) / recentDurations.length).toFixed(1))
      : '—';

    const metrics = [
      ['Metric', 'Value'],
      ['Open cases', openCount],
      ['Resolved this month', resolvedThisMonth],
      ['Average days to resolve (last 30d)', averageRecent],
      ['Oldest open case age (days)', oldestOpenAge || '—']
    ];

    sheet.getRange(1, 1, metrics.length, 2).setValues(metrics);
    sheet.getRange(1, 1, 1, 2).setFontWeight('bold');

    const statusStartRow = metrics.length + 2;
    const statusTable = [['Status', 'Count']];
    Object.keys(statusCounts).sort().forEach(status => {
      statusTable.push([status, statusCounts[status]]);
    });

    if (statusTable.length === 1) {
      sheet.getRange(statusStartRow, 1, 2, 2).setValues([
        ['Status', 'Count'],
        ['No active cases', 0]
      ]);
      sheet.getRange(statusStartRow, 1, 1, 2).setFontWeight('bold');
    } else {
      sheet.getRange(statusStartRow, 1, statusTable.length, 2).setValues(statusTable);
      sheet.getRange(statusStartRow, 1, 1, 2).setFontWeight('bold');
    }

    sheet.getCharts().forEach(chart => sheet.removeChart(chart));
    if (statusTable.length > 1) {
      const chartRangeRows = statusTable.length - 1;
      if (chartRangeRows > 0) {
        const chart = sheet.newChart()
          .setChartType(Charts.ChartType.PIE)
          .addRange(sheet.getRange(statusStartRow + 1, 1, chartRangeRows, 2))
          .setPosition(statusStartRow, 4, 0, 0)
          .setOption('title', 'Open cases by status')
          .build();
        sheet.insertChart(chart);
      }
    }

    SpreadsheetApp.getActive().toast('Analytics dashboard refreshed.', 'OK', 3);
  });
}
