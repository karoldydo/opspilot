import {
  HttpErrorResponse,
  type HttpEvent,
  type HttpHandlerFn,
  type HttpRequest,
  HttpResponse,
} from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AuthStore } from '@app/core/auth/auth.store';
import { type Observable, of, throwError } from 'rxjs';

import { authInterceptor } from './auth.interceptor';

function runInterceptor(req: HttpRequest<unknown>, next: HttpHandlerFn): Observable<HttpEvent<unknown>> {
  return TestBed.runInInjectionContext(() => authInterceptor(req, next));
}

describe('authInterceptor', () => {
  const request = {} as HttpRequest<unknown>;

  it('clears the session and redirects on a 401', async () => {
    const clear = vi.fn();
    const navigate = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthStore, useValue: { clear } },
        { provide: Router, useValue: { navigate } },
      ],
    });

    const next: HttpHandlerFn = () => throwError(() => new HttpErrorResponse({ status: 401 }));

    await expect(
      new Promise((_, reject) => runInterceptor(request, next).subscribe({ error: reject }))
    ).rejects.toBeInstanceOf(HttpErrorResponse);

    expect(clear).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(['/login']);
  });

  it('passes non-401 responses through without clearing the session', async () => {
    const clear = vi.fn();
    const navigate = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthStore, useValue: { clear } },
        { provide: Router, useValue: { navigate } },
      ],
    });

    const response = new HttpResponse({ status: 200 });
    const next: HttpHandlerFn = () => of(response);

    const received = await new Promise<HttpEvent<unknown>>((resolve, reject) =>
      runInterceptor(request, next).subscribe({ error: reject, next: resolve })
    );

    expect(received).toBe(response);
    expect(clear).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
