import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { ApiError, apiErrorSchema } from '@opspilot/shared';
import { Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const message = exception instanceof HttpException ? exception.message : 'internal server error';

    const body: ApiError = apiErrorSchema.parse({
      message,
      status,
      timestamp: new Date().toISOString(),
    });
    response.status(status).json(body);
  }
}
