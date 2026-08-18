# FRONTEND_DEV.md — Frontend Agent Guide

> Read `CLAUDE.md` first. This file governs work in `frontend/` (React + Vite + TypeScript). These rules override personal preference.

---

## 1. Structure & organisation

```
frontend/src/
├── routes/      route-level views (booking, my-appointments, admin/*)
├── features/    feature-scoped logic: hooks, state, data access (auth, booking, notifications)
├── components/  reusable presentational components (no data fetching)
├── lib/         api-client.ts (typed fetch), auth.ts (JWT handling)
├── styles/  ·  types/
```

- **Feature-first.** Logic for a feature (its hooks, API calls, local state) lives under `features/<name>/`, not scattered.
- **Presentational vs container split.** Components in `components/` render props and emit events; they do not fetch data or know about auth. Data flows in from feature hooks.
- Keep components small and single-purpose. If a component both fetches and renders complex UI, split it.

---

## 1a. Components are arrow functions

Every React component is a `const` bound to an arrow function. No `function` declarations:

```tsx
export const AuthGate = ({ children }: AuthGateProps) => {
  ...
};
```

- **One shape for every component**, so a file never mixes two spellings of the same thing.
- A component is a **value**: it gets wrapped (`memo`, `lazy`), passed, and re-exported. `const` keeps the definition and the wrapping symmetrical.
- **No hoisting is the point.** A component cannot be referenced above its own definition, so a file reads top-down.
- A component whose body is just its JSX drops the braces and the `return`.

**This applies to components only.** Hooks, factories, and plain helpers stay `function` declarations — `useAuthProvider`, `createApiClient`, `createTokenStore`. The two spellings then tell you which kind of thing you are looking at before you read the name.

Not currently lint-enforced: the rule (`react/function-component-definition`) needs `eslint-plugin-react`, and only `eslint-plugin-react-hooks` is installed. Adding it is a fine call to make — with the reason recorded, per §9.

---

## 2. Types & the API contract

- **Import request/response types from `shared/`.** Never hand-redefine a shape the backend already owns — that is how frontend and backend drift.
- The `lib/api-client.ts` layer is the **only** place that talks to the backend. Components and hooks call the client, never `fetch` directly.
- TypeScript is **strict**. No `any`. Prefer discriminated unions for loading/error/success states over loose booleans.
- React error handling keys off the backend error **`code`** (e.g. `SLOT_TAKEN`), not off message strings.

---

## 3. Data fetching & state

- Use a proper server-state layer (e.g. TanStack Query) for fetching, caching, and invalidation — do not roll manual `useEffect` fetch-and-store for server data.
- **Client state** (form inputs, UI toggles) stays local with `useState`/`useReducer`. Do not put server data in global client state.
- After a mutation (book, cancel), **invalidate/refetch** the affected queries so the UI reflects truth — never assume success mutated the cache correctly by hand unless doing deliberate optimistic updates.
- **Optimistic booking must handle rollback.** A slot can be taken between render and click; on `409 SLOT_TAKEN`, roll back and refresh the slot list with a clear message.

---

## 4. The booking UX (domain-specific)

- Only render **open** hourly slots; disable/hide taken and out-of-hours slots based on the availability endpoint.
- Treat the slot list as **stale by nature** — always be ready for a booking to fail because someone else won the race. The failure path is a normal case, not an edge case; design and test it.
- **Nearest-appointment countdown** ticks client-side but is anchored to server timestamps (UTC) rendered in the practice timezone. Use fake timers in tests; never assert against real wall-clock.
- **Cancellation within 24h is disabled in the UI** with a visible explanation — but never rely on the UI alone; the backend enforces it too.

---

## 5. Auth

- JWT handling lives in `lib/auth.ts`. Store the token in memory (with a refresh strategy) — **do not** hand-roll long-lived tokens in `localStorage` without a deliberate decision.
- The api-client attaches the token; individual calls don't manage headers.
- Route guards redirect unauthenticated users and hide admin areas from non-admins. UI role checks are for UX only — real authorisation is server-side.

---

## 6. Time & timezones

- The server is the source of truth for time; the client **displays** it. Always render from UTC timestamps into the practice timezone.
- Never compute booking eligibility (the 24h rule) purely client-side as authority — mirror it for UX, but the server decides.
- All time-dependent components are tested with controlled/fake timers.

---

## 7. Accessibility & quality

- Semantic HTML, labelled form controls, keyboard-navigable slot picker and dialogs, visible focus states.
- Every interactive element reachable and operable without a mouse.
- Loading, empty, and error states are designed for every data view — not just the happy path.
- Forms show inline validation mirroring the `shared/` Zod rules.

---

## 8. Testing

- **Component/logic tests: Vitest + React Testing Library**, co-located as `*.test.tsx`. Test behaviour (what the user sees/does), not implementation details.
- Cover: form validation states, disabled-cancel-within-24h, the countdown, and the `409` slot-taken path.
- **E2E: Playwright** for full journeys, including the **two-user race** (two browser contexts on one slot) and notification flows via Mailpit. E2E lives in the root `e2e/` package.
- Use fake timers for anything time-based. Keep tests deterministic and independent.

---

## 9. Styling & dependencies

- Keep styling approach consistent with what the repo already uses; don't introduce a second styling system.
- No new dependency without a recorded reason in the PR. Prefer the platform and small, well-scoped libraries.

---

## 9a. Comments — write few

Clean code explains itself. A comment is a cost: it is unversioned by the compiler, it rots the moment the code beside it changes, and a wall of them buries the one remark that mattered.

- **Default to none.** Prefer a clearer name, a smaller component, or an extracted constant over a sentence explaining the unclear version.
- **Never narrate the code.** If the comment restates what the line does, delete it.
- **Comment only what the code cannot say:** a non-obvious _why_, a deliberate deviation from a ticket or doc, a workaround for a browser/library bug (with a link), or an accessibility or effect-ordering constraint a future reader would otherwise "simplify" away.
- **Prose belongs in docs.** Design rationale and trade-offs go in `PROJECT_STRUCTURE.md` or the PR description — not in a header block above every component.
- Tests follow the same rule: a precise `it(...)` name replaces most comments.

---

## 10. Definition of Done (frontend)

Acceptance criteria met · types imported from `shared/` (no redefinition) · all data access through `api-client` · loading/empty/error states handled · `409`/conflict path handled and tested · accessible and keyboard-operable · RTL tests co-located and green · relevant Playwright E2E green · lint + typecheck clean · coverage gate passing.
