import { Controller, Get, Inject } from '@nestjs/common';
import { ServiceWithStatus } from '@opspilot/shared';

import { ServiceService } from './service.service';

// top-level fleet read the device-nested ServiceController (@Controller('devices/:deviceId'))
// cannot host. mirrors OverviewController: thin controller, the latest-run aggregation lives in
// the service, guarded by the global AuthAppGuard like every operational endpoint. the
// device/service domain is single-tenant (no userId column), so this returns the whole fleet —
// consistent with GET /devices and the device-scoped GET /devices/:id/services.
@Controller('services')
export class ServiceAggregateController {
  constructor(@Inject(ServiceService) private readonly serviceService: ServiceService) {}

  @Get()
  findAll(): Promise<ServiceWithStatus[]> {
    return this.serviceService.findAllWithStatus();
  }
}
