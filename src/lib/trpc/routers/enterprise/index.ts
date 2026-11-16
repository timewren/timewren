import { mergeRouters } from "../../trpc";
import { enterpriseAbsenceRouter } from "./absence";
import { enterpriseActivityTypesRouter } from "./activityTypes";
import { enterpriseCheckInRouter } from "./checkin";
import { enterpriseClosurePeriodsRouter } from "./closurePeriods";
import { enterpriseComplianceRouter } from "./compliance";
import { enterpriseDepartmentManagersRouter } from "./departmentManagers";
import { enterpriseEmployeeRouter } from "./employee";
import { enterpriseFlexRouter } from "./flex";
import { enterpriseFlexNormRouter } from "./flexNorm";
import { enterpriseHolidaysRouter } from "./holidays";
import { enterpriseNotificationsRouter } from "./notifications";
import { enterpriseOrganizationRouter } from "./organization";
import { enterpriseOvertimeRouter } from "./overtime";
import { enterprisePayrollRouter } from "./payroll";
import { enterprisePeriodClosingRouter } from "./periodClosing";
import { enterpriseProjectAssignmentsRouter } from "./projectAssignments";
import { enterpriseReportsRouter } from "./reports";
import { enterpriseSsoRouter } from "./sso";
import { enterpriseTeamRouter } from "./team";
import { enterpriseTimelogImportRouter } from "./timelog-import";
import { enterpriseTimesheetRouter } from "./timesheet";
import { enterpriseWorkPlansRouter } from "./workPlans";

export const enterpriseRouter = mergeRouters(
  enterpriseOrganizationRouter,
  enterpriseEmployeeRouter,
  enterpriseAbsenceRouter,
  enterpriseHolidaysRouter,
  enterpriseFlexRouter,
  enterpriseComplianceRouter,
  enterpriseTimesheetRouter,
  enterpriseCheckInRouter,
  enterpriseReportsRouter,
  enterpriseTeamRouter,
  enterpriseTimelogImportRouter,
  enterpriseOvertimeRouter,
  enterpriseProjectAssignmentsRouter,
  enterpriseClosurePeriodsRouter,
  enterpriseActivityTypesRouter,
  enterpriseDepartmentManagersRouter,
  enterprisePayrollRouter,
  enterpriseNotificationsRouter,
  enterpriseSsoRouter,
  enterpriseWorkPlansRouter,
  enterpriseFlexNormRouter,
  enterprisePeriodClosingRouter,
);
