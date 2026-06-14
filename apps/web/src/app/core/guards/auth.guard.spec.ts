import { TestBed } from '@angular/core/testing';
import { type ActivatedRouteSnapshot, Router, type RouterStateSnapshot, type UrlTree } from '@angular/router';
import { AuthStore } from '@app/core/auth/auth.store';

import { authGuard } from './auth.guard';

function runGuard() {
  return TestBed.runInInjectionContext(() => authGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot));
}

describe('authGuard', () => {
  it('allows navigation when the session is authenticated', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthStore, useValue: { isAuthenticated: () => true } },
        { provide: Router, useValue: { createUrlTree: () => ({}) as UrlTree } },
      ],
    });

    expect(runGuard()).toBe(true);
  });

  it('redirects to /login when unauthenticated', () => {
    const urlTree = {} as UrlTree;
    const createUrlTree = vi.fn().mockReturnValue(urlTree);
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthStore, useValue: { isAuthenticated: () => false } },
        { provide: Router, useValue: { createUrlTree } },
      ],
    });

    expect(runGuard()).toBe(urlTree);
    expect(createUrlTree).toHaveBeenCalledWith(['/login']);
  });
});
