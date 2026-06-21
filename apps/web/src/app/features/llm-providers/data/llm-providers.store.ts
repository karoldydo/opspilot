import { HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable } from '@angular/core';
import { LlmProvidersClient } from '@app/features/llm-providers/data/llm-providers.client';
import { patchState, signalState } from '@ngrx/signals';
import {
  apiErrorSchema,
  type LlmProvider,
  type LlmProviderCreateRequest,
  type LlmProviderUpdateRequest,
} from '@opspilot/shared';

// normalized result the provider screens render: a user-facing message on failure,
// null on success — mirrors DeviceActionResult.
export interface LlmProviderActionResult {
  error: null | string;
}

interface LlmProvidersState {
  error: null | string;
  loading: boolean;
  providers: LlmProvider[];
}

// pulls the user-facing message out of an http failure — the global exception filter
// shapes every error body as apiErrorSchema; falls back to a generic transport line.
// test-call domain errors (502/503/504) arrive shaped this way too, so a
// bad-key/unreachable/timeout reaches the dialog as a legible line.
function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    const parsed = apiErrorSchema.safeParse(error.error);
    if (parsed.success) {
      return parsed.data.message;
    }
  }
  return fallback;
}

// signal-based llm-provider state with mutate-then-refetch, provided at the
// llm-providers route (not providedIn: 'root', per angular.md). zoneless — async
// client callbacks don't trigger cd, so state rides a signalState container mutated
// through patchState.
@Injectable()
export class LlmProvidersStore {
  private readonly client = inject(LlmProvidersClient);
  private readonly state = signalState<LlmProvidersState>({ error: null, loading: false, providers: [] });

  readonly error = this.state.error;

  readonly isEmpty = computed(() => !this.state.loading() && this.state.providers().length === 0);

  readonly loading = this.state.loading;

  readonly providers = this.state.providers;

  // atomically makes the chosen provider the only active one, then refetches so the
  // badge reflects the server's single-active invariant.
  async activate(id: string): Promise<LlmProviderActionResult> {
    try {
      await this.client.activate(id);
    } catch (error) {
      return { error: errorMessage(error, 'could not activate provider') };
    }
    await this.load();
    return { error: null };
  }

  // the server test-calls the endpoint before persisting; a bad key/url/timeout
  // surfaces here as the domain error message, and no row is created.
  async create(input: LlmProviderCreateRequest): Promise<LlmProviderActionResult> {
    try {
      await this.client.create(input);
    } catch (error) {
      return { error: errorMessage(error, 'could not create provider') };
    }
    await this.load();
    return { error: null };
  }

  // hydrates the provider list from the server. parses through the shared contract
  // so timestamps normalize and secret leaks fail the strict parse.
  async load(): Promise<void> {
    patchState(this.state, { error: null, loading: true });
    try {
      const providers = await this.client.list();
      patchState(this.state, { loading: false, providers });
    } catch (error) {
      patchState(this.state, { error: errorMessage(error, 'could not load providers'), loading: false });
    }
  }

  async remove(id: string): Promise<LlmProviderActionResult> {
    try {
      await this.client.remove(id);
    } catch (error) {
      return { error: errorMessage(error, 'could not delete provider') };
    }
    await this.load();
    return { error: null };
  }

  async update(id: string, input: LlmProviderUpdateRequest): Promise<LlmProviderActionResult> {
    try {
      await this.client.update(id, input);
    } catch (error) {
      return { error: errorMessage(error, 'could not update provider') };
    }
    await this.load();
    return { error: null };
  }
}
