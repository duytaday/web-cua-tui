# Case Tracking Google Sheets Automation

This repository stores the Google Apps Script used to automate the "CASE TRACKING" Google Sheet. The automation keeps the sheet tidy, assigns human-readable case identifiers, stamps timestamps, keeps SLA metrics fresh, highlights duplicate tickets, and moves resolved tickets to a dedicated archive tab with analytics. The code lives in [`sheetAutomation.gs`](./sheetAutomation.gs).

## Functions overview

| Function | Purpose |
| --- | --- |
| `onEdit(e)` | Main entry point triggered when a cell is edited. Runs under a document lock, ensures required columns exist, updates timestamps only on populated rows, deduplicates tickets, and moves resolved rows. |
| `installOnEdit()` | Utility helper that installs an installable onEdit trigger after clearing any existing ones. |
| `backfillCreatedAtDaysOpen()` | Bulk utility that fills in `CreatedAt` and `DaysOpen` for historical rows. |
| `rebuildResolved()` | Recreates the `Resolved case` sheet with the standard headers and numbering. |
| `testMoveFirst()` | Development helper: forces the first data row to become `RESOLVED` to test the flow. |
| `onOpen()` | Adds the **Case System** custom menu so common utilities are one click away. |
| `setupMainSheet()` | Applies freeze panes, alternating colours, duplicate highlighting, and status validation to `CASE TRACKING`. |
| `restoreSelectedFromResolved()` | Restores a single archived ticket back to `CASE TRACKING` with a default status. |
| `applyDuplicateHighlighting()` | Refreshes the conditional formatting rules that highlight duplicate tickets in both sheets. |
| `scanDuplicateTickets()` | Scans the main sheet for duplicate ticket IDs, shows a summary alert, and reapplies the red highlight rules. |
| `applySlaFormatting()` | Adds conditional formatting rules that highlight overdue or near-due deadlines. |
| `refreshAnalyticsDashboard()` | Generates the **Case Analytics** sheet with KPI tiles, status distribution, and a pie chart. |
| `detectHeaderRow_(sheet)` | Inspects the rows above the data region and guesses the best header row. |
| `getHeaderInfo_(sheet)` | Reads the header row and returns the map of normalised header names to column numbers. |
| `ensureColumns_(sheet, headerInfo, requiredNames)` | Guarantees that key columns exist by appending them if missing and updating the header map. |
| `statusCol_(headerInfo)` | Returns the column index containing the ticket status. Falls back to column `F` when the header is absent. |
| `withLock_(fn)` | Helper that serialises critical sections with `LockService` to avoid concurrent edits colliding. |
| `existsInResolvedByTicket_(ticket)` | Checks whether a ticket already exists in the archive to prevent duplicates. |
| `colToLetter_(col)` | Converts a column index into an A1 column letter for use in formulas and formatting rules. |
| `ensureCaseIdForRow_(sheet, ensured, row)` | Generates and assigns the next sequential `CaseID` for populated rows. |
| `generateNextCaseId_()` | Determines the next numeric suffix for `CaseID` based on sheet contents and script properties. |
| `ensureResolvedSheet_()` | Creates or resets the archive sheet, standardises headers, and seeds the auto-increment formula. |
| `appendToResolved_(record)` | Appends a resolved record, timestamps it, calculates `DaysToResolve`, and keeps the sheet sorted. |
| `normHeader_(value)` | Helper that normalises header names by stripping special characters and upper-casing. |
| `trimU_(value)` | Normalises free-text values (like status) by trimming and upper-casing. |

## Flow of the automation

1. **Edit detection:** When a cell is edited in the `CASE TRACKING` sheet, Google Sheets fires `onEdit(e)`.
2. **Serialisation:** `withLock_` acquires a document-level lock so concurrent editors cannot interleave archive operations.
3. **Header lookup:** `onEdit` retrieves header metadata (row number, column mapping). This allows the script to work even if columns move around.
4. **Column preparation:** `ensureColumns_` makes sure the `CreatedAt` and `DaysOpen` columns exist. Missing columns are appended automatically.
5. **Case ID allocation:** For populated rows the script allocates a sequential `CaseID` (for example `CASE-0007`) that travels with the ticket into the archive and back again if restored.
6. **Timestamp maintenance:** The script stamps the `CreatedAt` column (if empty) only when the row contains meaningful content (ticket or subject) and injects an `IF`-guarded `DaysOpen` formula.
7. **Resolved detection:** If the edited cell is in the status column and contains any of the configured resolved keywords (default: `RESOLVED`), the script prepares to archive the row.
8. **Deduplication:** `existsInResolvedByTicket_` confirms that the ticket is not already archived to prevent duplicate entries. Duplicate submissions simply remove the source row.
9. **Archive sheet preparation:** `ensureResolvedSheet_` standardises the `Resolved case` sheet, including the `#` running number formula and the case ID column.
10. **Row move:** `appendToResolved_` appends the resolved record with a new `ResolvedTime`, calculates `DaysToResolve`, keeps the archive sorted by most recent resolution, then the original row is deleted.
11. **Feedback:** A toast message is displayed confirming the move (or duplicate skip).

The supporting utility functions (`installOnEdit`, `backfillCreatedAtDaysOpen`, `rebuildResolved`, `testMoveFirst`, `setupMainSheet`, `restoreSelectedFromResolved`, `applyDuplicateHighlighting`, `scanDuplicateTickets`, `applySlaFormatting`, and `refreshAnalyticsDashboard`) streamline deployment, recovery, formatting, analytics, and quick smoke testing inside the Apps Script editor.

## Duplicate and analytics tooling

* **Duplicate tickets:** `setupMainSheet` and the custom menu option “Apply duplicate highlighting” both deploy conditional formatting rules that paint duplicate ticket rows light red. “Scan duplicate tickets” runs a quick audit, surfaces offending ticket IDs in an alert, and reapplies the highlight rules.
* **Sequential case IDs:** Every populated row is stamped with a durable `CaseID` so analysts can reconcile tickets even if subjects or ticket numbers change. Legacy rows can be updated by running `backfillCreatedAtDaysOpen`.
* **Analytics dashboard:** The “Refresh analytics dashboard” menu item builds a `Case Analytics` sheet containing KPI tiles (open cases, resolved this month, average resolution cycle time, oldest case age), a live status table, and a pie chart of open cases by status. The sheet can be refreshed on demand without disturbing operations.

## Configuration

The configuration block at the top of the script defines the sheet names, resolved keywords, and expected data start row. Adjust those constants to match your sheet naming conventions or additional resolved statuses.

## Deployment

1. Open the Apps Script editor connected to your Google Sheet.
2. Replace the script contents with [`sheetAutomation.gs`](./sheetAutomation.gs).
3. Run `installOnEdit` once from the editor to create the installable trigger.
4. (Optional) Run `setupMainSheet` to apply formatting/validation and `applySlaFormatting` if the sheet tracks deadlines.
5. Grant the required permissions when prompted.
6. Start editing your sheet—timestamps, automatic moves, dedupe logic, and the custom menu will now run automatically.

