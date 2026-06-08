---
paths:
  - apps/web/**/*.ts
---
# NgRx SignalStore

## Store Creation

- Use `signalStore()` with `providedIn: 'root'` for singleton stores
- Compose with features: `withState()`, `withMethods()`, `withComputed()`, `withHooks()`, `withProps()`
- Inject services via `withProps(() => ({ service: inject(MyService) }))`

## State Updates

- Always use `patchState(store, { ... })` -- never mutate state directly
- Use `patchState()` inside `withMethods()` only
- For arrays, create new references: `patchState(store, { items: [...store.items(), newItem] })`

## Toolkit Extensions

- `withDevtools('storeName')` from `@angular-architects/ngrx-toolkit` for Redux DevTools
- `withStorageSync()` / `withSessionStorage()` for persistence

## Reactive Patterns

- Use `rxMethod()` for RxJS-based side effects inside `withMethods()`
- Convert signals to observables with `toObservable()` when needed
- Read signals directly (`store.value()`) when no reactive operators are needed

## Usage

- Inject stores directly: `private store = inject(MyStore)`
- Access state as signals: `store.items()`, `store.loading()`
- Access computed: `store.count()`
- Call methods: `store.load()`
