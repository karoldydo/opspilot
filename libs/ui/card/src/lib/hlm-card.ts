import { Directive, input } from '@angular/core';

import { classes } from '../../../utils/src/lib/hlm';
import { HlmCardConfig, injectHlmCardConfig } from './hlm-card.token';

@Directive({
  host: {
    '[attr.data-size]': 'size()',
    'data-slot': 'card',
  },
  selector: '[hlmCard],hlm-card',
})
export class HlmCard {
  private readonly _defaultConfig = injectHlmCardConfig();
  public readonly size = input<HlmCardConfig['size']>(this._defaultConfig.size);

  constructor() {
    classes(
      () =>
        'ring-foreground/10 bg-card text-card-foreground gap-6 overflow-hidden rounded-xl py-6 text-sm shadow-xs ring-1 has-[>img:first-child]:pt-0 data-[size=sm]:gap-4 data-[size=sm]:py-4 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl group/card flex flex-col'
    );
  }
}
