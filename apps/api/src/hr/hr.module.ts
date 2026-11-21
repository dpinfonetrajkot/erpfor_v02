import { Module } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { AdmsController, AttendanceController } from './attendance.controller';
import { DepartmentsController, EmployeesController } from './employees.controller';
import { LeavesController } from './leaves.controller';
import { LoansController } from './loans.controller';
import { PayrollService } from './payroll.service';
import { PayrollController } from './payroll.controller';
import { CompanyAssetsController, SafetyAssetsController } from './assets.controller';

@Module({
  controllers: [
    EmployeesController,
    DepartmentsController,
    AttendanceController,
    AdmsController,
    LeavesController,
    LoansController,
    PayrollController,
    CompanyAssetsController,
    SafetyAssetsController,
  ],
  providers: [AttendanceService, PayrollService],
  exports: [AttendanceService, PayrollService],
})
export class HrModule {}
