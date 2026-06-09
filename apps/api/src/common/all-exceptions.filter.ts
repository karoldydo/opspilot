import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ApiError, apiErrorSchema } from '@opspilot/shared';
import { Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const message = exception instanceof HttpException ? exception.message : 'internal server error';

    // log unknown (non-http) failures server-side only — the client still gets
    // the generic 500 message, so internals never leak but stay diagnosable.
    if (!(exception instanceof HttpException)) {
      this.logger.error(exception);
    }

    const body: ApiError = apiErrorSchema.parse({
      message,
      status,
      timestamp: new Date().toISOString(),
    });
    response.status(status).json(body);
  }
}
