import { inject, InjectionToken, type ValueProvider } from '@angular/core';

import type { ButtonVariants } from './hlm-button';

export interface BrnButtonConfig {
  size: ButtonVariants['size'];
  variant: ButtonVariants['variant'];
}

const defaultConfig: BrnButtonConfig = {
  size: 'default',
  variant: 'default',
};

const BrnButtonConfigToken = new InjectionToken<BrnButtonConfig>('BrnButtonConfig');

export function injectBrnButtonConfig(): BrnButtonConfig {
  return inject(BrnButtonConfigToken, { optional: true }) ?? defaultConfig;
}

export function provideBrnButtonConfig(config: Partial<BrnButtonConfig>): ValueProvider {
  return { provide: BrnButtonConfigToken, useValue: { ...defaultConfig, ...config } };
}
