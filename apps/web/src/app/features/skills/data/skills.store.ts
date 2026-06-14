import { HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable } from '@angular/core';
import { SkillsClient } from '@app/features/skills/data/skills.client';
import { patchState, signalState } from '@ngrx/signals';
import { apiErrorSchema, type Skill, type SkillCreateRequest, type SkillUpdateRequest } from '@opspilot/shared';

// normalized result the skill screens render: a user-facing message on failure,
// null on success — mirrors DeviceActionResult.
export interface SkillActionResult {
  error: null | string;
}

interface SkillsState {
  error: null | string;
  loading: boolean;
  skills: Skill[];
}

// pulls the user-facing message out of an http failure — the global exception
// filter shapes every error body as apiErrorSchema, so prefer that message and fall
// back to a generic line for transport-level failures.
function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    const parsed = apiErrorSchema.safeParse(error.error);
    if (parsed.success) {
      return parsed.data.message;
    }
  }
  return fallback;
}

// signal-based skill state with mutate-then-refetch, mirroring DevicesStore. provided
// at the skills route (not providedIn: 'root') so the feature owns its lifecycle. the
// app is zoneless — async client callbacks don't trigger change detection, so state
// lives in a signalState container mutated through patchState (@ngrx/signals).
@Injectable()
export class SkillsStore {
  private readonly client = inject(SkillsClient);
  private readonly state = signalState<SkillsState>({ error: null, loading: false, skills: [] });

  readonly error = this.state.error;

  readonly isEmpty = computed(() => !this.state.loading() && this.state.skills().length === 0);

  readonly loading = this.state.loading;

  readonly skills = this.state.skills;

  // the server re-validates the parameter/placeholder parity and the per-scope name
  // uniqueness; a violation surfaces here as the domain error and no row is created.
  async create(input: SkillCreateRequest): Promise<SkillActionResult> {
    try {
      await this.client.create(input);
    } catch (error) {
      return { error: errorMessage(error, 'could not create skill') };
    }
    await this.load();
    return { error: null };
  }

  // hydrates the skill list from the server. parses through the shared contract so
  // timestamps normalize and any leaked column fails the strict parse.
  async load(): Promise<void> {
    patchState(this.state, { error: null, loading: true });
    try {
      const skills = await this.client.list();
      patchState(this.state, { loading: false, skills });
    } catch (error) {
      patchState(this.state, { error: errorMessage(error, 'could not load skills'), loading: false });
    }
  }

  async remove(id: string): Promise<SkillActionResult> {
    try {
      await this.client.remove(id);
    } catch (error) {
      return { error: errorMessage(error, 'could not delete skill') };
    }
    await this.load();
    return { error: null };
  }

  async update(id: string, input: SkillUpdateRequest): Promise<SkillActionResult> {
    try {
      await this.client.update(id, input);
    } catch (error) {
      return { error: errorMessage(error, 'could not update skill') };
    }
    await this.load();
    return { error: null };
  }
}
