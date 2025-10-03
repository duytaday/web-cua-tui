# Business Requirements Document (BRD)

## 1. Project overview
- **Project name:** Case Tracking Automation Enhancements
- **Prepared for:** Business Operations / Customer Success leadership
- **Prepared by:** Automation & Analytics Team
- **Date:** 2025-10-03

## 2. Background & problem statement
The CASE TRACKING Google Sheet is the operational hub for monitoring incoming customer issues. As volume has increased, the manual processes around timestamping, tracking ownership, and closing tickets created inconsistent data, duplicate entries, and minimal visibility into SLA performance. Prior iterations of automation partially addressed archival of resolved tickets but lacked durable identifiers, duplicate detection, and actionable analytics.

## 3. Objectives
1. Guarantee that every ticket has a persistent identifier so business analysts can reconcile cases across systems.
2. Prevent duplicate ticket handling by front-line agents through near-real-time detection and visual cues.
3. Standardise timestamp and SLA metrics to enable reliable reporting without manual intervention.
4. Provide a self-service analytics workspace that summarises caseload health for leadership.
5. Maintain user-friendly utilities (menus, backfills, restore tooling) to minimise operational disruption.

## 4. Scope
### In scope
- Automation executed via Google Apps Script attached to the CASE TRACKING spreadsheet.
- Automatic creation and maintenance of the following fields: `CaseID`, `CreatedAt`, `DaysOpen`, `ResolvedTime`, `DaysToResolve`.
- Movement of resolved tickets from the CASE TRACKING sheet to the Resolved case archive.
- Duplicate ticket highlighting and alerting within CASE TRACKING and Resolved case sheets.
- Generation of the Case Analytics dashboard tab with KPI tiles and charts.
- Custom menu actions for installing triggers, formatting, duplicate scanning, SLA highlighting, analytics refresh, and restores.

### Out of scope
- Integration with external CRMs or ticketing systems (e.g., Zendesk, Salesforce).
- Automated emailing or Slack notifications.
- Machine-learning-based prioritisation or sentiment analysis.
- Advanced access control beyond Apps Script permissions.

## 5. Stakeholders
| Role | Responsibility |
| --- | --- |
| Customer Success Agents | Enter and update ticket data, respond to duplicate alerts. |
| Team Leads / Managers | Monitor SLA compliance, review analytics dashboard, approve process tweaks. |
| Business Analysts | Audit data quality, extract insights for leadership reporting. |
| Automation Engineer | Maintain Apps Script, deploy enhancements, triage issues. |
| IT / Google Workspace Admin | Provide permissions and governance for Apps Script execution. |

## 6. Functional requirements
1. **Case ID assignment**
   - FR-1.1: When a row in CASE TRACKING contains a ticket number or subject, the system shall assign a sequential `CaseID` using the format `CASE-####`.
   - FR-1.2: Case IDs shall persist when rows move to the Resolved case sheet and when restored back to CASE TRACKING.
   - FR-1.3: Backfill utilities shall populate missing Case IDs for historical records.
2. **Timestamp management**
   - FR-2.1: `CreatedAt` shall be set when a populated row lacks a timestamp.
   - FR-2.2: `DaysOpen` shall calculate as `TODAY() - CreatedAt` and remain blank for empty rows.
   - FR-2.3: Resolved tickets shall capture `ResolvedTime` and `DaysToResolve`.
3. **Duplicate detection**
   - FR-3.1: Conditional formatting shall highlight duplicate ticket IDs in red within CASE TRACKING and Resolved case sheets.
   - FR-3.2: Users shall be able to run “Scan duplicate tickets” to view a list of duplicates and refresh highlighting.
   - FR-3.3: When a ticket already exists in the archive, the system shall skip creating another record and remove the duplicate source row.
4. **Ticket archival flow**
   - FR-4.1: When a status is edited to a configured resolved keyword, the row shall move to the Resolved case sheet.
   - FR-4.2: The Resolved case sheet shall maintain sequential numbering, sorted by most recent resolution time.
   - FR-4.3: Users shall be able to restore a single archived ticket back to CASE TRACKING with status `WOC`.
5. **Analytics dashboard**
   - FR-5.1: Running “Refresh analytics dashboard” shall create/update a `Case Analytics` sheet.
   - FR-5.2: The dashboard shall display: total open cases, cases resolved this month, average days to resolve (last 30 days), and oldest open case age.
   - FR-5.3: The dashboard shall contain a table and pie chart summarising open cases by status.
6. **User utilities & governance**
   - FR-6.1: The Apps Script shall surface a “Case System” menu providing quick access to all utilities.
   - FR-6.2: The script shall run critical operations under a document-level lock to avoid race conditions.
   - FR-6.3: Setup utilities shall apply freeze panes, alternating colours, data validation, duplicate highlighting, and SLA highlighting as requested.

## 7. Non-functional requirements
- **Performance:** Archive and duplicate checks should complete within <2 seconds for sheets under 2,000 rows.
- **Reliability:** Locking must prevent simultaneous edits from creating duplicate archives.
- **Usability:** Menu options shall be labelled with plain-language descriptions for non-technical users.
- **Maintainability:** Configuration constants (`SHEET_MAIN`, `SHEET_RES`, `RES_KEYS`, etc.) must be editable in one location.
- **Security:** Script shall only require spreadsheet-level permissions; no external service credentials.

## 8. Data considerations
- Case IDs must remain unique even if tickets are manually copied or restored.
- Duplicate detection relies on the `Ticket` column; business teams must ensure ticket numbers are entered consistently.
- Analytics metrics assume `ResolvedTime` and `DaysToResolve` are populated via the automation; manual edits could skew results.

## 9. Reporting & analytics
- Dashboard metrics update on demand via the custom menu.
- Analysts can export the Case Analytics sheet for monthly reporting.
- Conditional formatting provides immediate visual cues without requiring Pivot Tables.

## 10. Process flow summary
1. Agent edits a row in CASE TRACKING.
2. Automation acquires a lock, ensures required columns exist, and assigns `CaseID`/timestamps.
3. If status changes to resolved, the script deduplicates, archives the row, and stamps resolution metrics.
4. Duplicate highlighting refreshes via utilities or scheduled runs.
5. Analysts refresh the dashboard for KPI reporting.

## 11. Assumptions
- Google Sheets remains the system of record for the foreseeable future.
- Ticket numbers are unique identifiers entered by agents or imported from external tools.
- Users accept that the automation may reorder archive rows (latest first).

## 12. Risks & mitigations
| Risk | Impact | Mitigation |
| --- | --- | --- |
| Agents override CaseID or timestamps manually | Loss of referential integrity | Use protected ranges and training; rerun backfill utilities periodically. |
| High-volume edits exceed Apps Script quotas | Automation delay | Monitor execution logs; consider batching or scheduled maintenance scripts. |
| Duplicate detection misses variations (e.g., typos) | Partial duplicate handling | Encourage consistent ticket entry; consider future fuzzy matching enhancements. |

## 13. Success metrics
- 100% of new tickets receive a CaseID automatically.
- Duplicate tickets reduce by >80% compared to baseline month.
- SLA dashboard adopted by management (measured by weekly refresh count).
- Zero incidents of double-archived tickets post-deployment.

## 14. Implementation & rollout plan
1. Deploy updated Apps Script to production spreadsheet and run `installOnEdit`.
2. Execute `backfillCreatedAtDaysOpen` to populate CaseIDs/timestamps for historical data.
3. Run `setupMainSheet`, `applyDuplicateHighlighting`, and `refreshAnalyticsDashboard` to initialise formatting and analytics.
4. Communicate new workflows and dashboard usage to agents and leadership.
5. Monitor execution logs for two weeks; adjust RES_KEYS or menu options as needed.

## 15. Approval
- **Business Owner:** ________________________
- **Operations Lead:** ________________________
- **Automation Engineer:** ________________________

