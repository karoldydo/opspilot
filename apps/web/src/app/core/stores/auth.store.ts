import { computed, Injectable } from '@angular/core';
import { patchState, signalState } from '@ngrx/signals';
import { type AuthLoginRequest, type AuthRegisterRequest, type AuthUser, authUserSchema } from '@opspilot/shared';

import { authClient } from '../clients/auth.client';

// normalized result our login/register screens render: error is a user-facing
// message on failure, null on success.
export interface AuthActionResult {
  error: null | string;
}

interface AuthState {
  user: AuthUser | null;
}

// the single source of truth for session state, provided explicitly at the app
// root (not providedIn: 'root', per angular.md) so guard, interceptor, and the
// auth screens all read/write the same state. the app is zoneless — better-auth's
// async client callbacks don't trigger change detection, so state lives in a
// signalState container mutated through patchState (@ngrx/signals).
@Injectable()
export class AuthStore {
  private readonly state = signalState<AuthState>({ user: null });

  readonly isAuthenticated = computed(() => this.state.user() !== null);

  readonly user = this.state.user;

  // drops local session state — called by the 401 interceptor when the server
  // rejects a stale session so the ui never stays half-authenticated.
  clear(): void {
    patchState(this.state, { user: null });
  }

  // hydrates the session state from the server cookie. run at app init (before the
  // guard's first navigation) so a page reload while logged in stays authenticated.
  async loadSession(): Promise<void> {
    try {
      const { data } = await authClient.getSession();
      // better-auth deserializes timestamps to Date; authUserSchema preprocesses
      // Date -> iso string, so parsing the client object is safe (see lessons.md).
      patchState(this.state, { user: data ? authUserSchema.parse(data.user) : null });
    } catch {
      patchState(this.state, { user: null });
    }
  }

  async signIn(input: AuthLoginRequest): Promise<AuthActionResult> {
    const { error } = await authClient.signIn.email(input);
    if (error) {
      return { error: error.message ?? 'invalid email or password' };
    }
    await this.loadSession();
    return { error: null };
  }

  async signOut(): Promise<void> {
    await authClient.signOut();
    this.clear();
  }

  async signUp(input: AuthRegisterRequest): Promise<AuthActionResult> {
    const { error } = await authClient.signUp.email(input);
    if (error) {
      return { error: error.message ?? 'could not create account' };
    }
    await this.loadSession();
    return { error: null };
  }
}
