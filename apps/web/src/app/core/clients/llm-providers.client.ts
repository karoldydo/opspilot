import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  type LlmProvider,
  type LlmProviderCreateRequest,
  llmProviderSchema,
  type LlmProviderUpdateRequest,
} from '@opspilot/shared';
import { firstValueFrom } from 'rxjs';

// typed http i/o against the llm-provider endpoints. relative '/api' urls ride the
// same-origin session cookie automatically (withFetch). every entity-returning
// response is parsed through llmProviderSchema so timestamps normalize to iso
// strings and any leaked secret-bearing key fails the strict parse at the boundary.
@Injectable()
export class LlmProvidersClient {
  private readonly http = inject(HttpClient);

  // activate has no body — the server flips the single-active invariant by id.
  activate(id: string): Promise<LlmProvider> {
    return firstValueFrom(this.http.patch<unknown>(`/api/llm-providers/${id}/activate`, {})).then((row) =>
      llmProviderSchema.parse(row)
    );
  }

  create(input: LlmProviderCreateRequest): Promise<LlmProvider> {
    return firstValueFrom(this.http.post<unknown>('/api/llm-providers', input)).then((row) =>
      llmProviderSchema.parse(row)
    );
  }

  get(id: string): Promise<LlmProvider> {
    return firstValueFrom(this.http.get<unknown>(`/api/llm-providers/${id}`)).then((row) =>
      llmProviderSchema.parse(row)
    );
  }

  list(): Promise<LlmProvider[]> {
    return firstValueFrom(this.http.get<unknown[]>('/api/llm-providers')).then((rows) =>
      llmProviderSchema.array().parse(rows)
    );
  }

  remove(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/llm-providers/${id}`));
  }

  update(id: string, input: LlmProviderUpdateRequest): Promise<LlmProvider> {
    return firstValueFrom(this.http.patch<unknown>(`/api/llm-providers/${id}`, input)).then((row) =>
      llmProviderSchema.parse(row)
    );
  }
}
