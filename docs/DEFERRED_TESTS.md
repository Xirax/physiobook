# Deferred tests — the standing debt ledger

A ticket's acceptance criteria may be met while some of its **named test cases**
are not yet written. That is allowed only when the reason is a missing harness
rather than a missing decision, and only when it is recorded here.

**Rules:**

- A story that defers a test case adds it here in the same PR. "We'll get to it"
  with no entry is how a test case disappears.
- Each entry names the ticket that deferred it, the ticket expected to pay it,
  and the exact cases — written as a checklist someone can work from without
  re-reading the original ticket.
- Each entry also records **what _is_ covered**, so the paying ticket does not
  rewrite coverage that already exists at another level.
- The paying ticket ticks the boxes and deletes the entry. An entry that
  outlives its ticket is a bug in this file.

---

## E1.5 — Frontend auth flow → owed by **E7**

**Why deferred:** the ticket names Playwright E2E cases, but the `e2e/` package is
still a placeholder (`e2e/tests/placeholder.ts`, and its `package.json`
description says "wired up in E7"). Standing Playwright up — config, the
`webServer`/compose wiring, fixtures, and a seeded admin account — is E7's own
scope, and is a larger job than the cases themselves. Deferring was agreed
explicitly when E1.5 was planned.

**What this costs:** every case below turns on the **real httpOnly refresh
cookie** and a **real page reload**. Neither exists in jsdom, so RTL cannot cover
any of them, however thorough it is. Until E7 these paths are proven only by the
backend's own tests plus the frontend's stubbed equivalents — the seam between
them is untested.

### Cases still owed

- [ ] Register → land in the user area, already logged in (no second login step).
- [ ] Reload after registering → still logged in, with no flash of `/login`
      (silent refresh rehydrating from the httpOnly cookie).
- [ ] Log out → the app is in a logged-out state.
- [ ] After that logout, a guarded route redirects to `/login`.
- [ ] Admin logs in through the **same** form → lands in the admin area.

### Already covered — do not rewrite

| Behaviour                                                | Where                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------ |
| Login/register validation states, shared-schema messages | `frontend/src/features/auth/LoginForm.test.tsx`, `RegisterForm.test.tsx` |
| Auth-loading gate: spinner, then content                 | `frontend/src/App.test.tsx`                                              |
| Concurrent 401s trigger exactly one `/auth/refresh`      | `frontend/src/lib/api-client.test.ts`                                    |
| Refresh failure modes (401 vs 5xx/429 vs network)        | `frontend/src/lib/api-client.test.ts`                                    |
| Unauthenticated redirect, return-to, wrong-role redirect | `frontend/src/routes/RequireRole.test.tsx`                               |
| Role-based nav and logout                                | `frontend/src/routes/AppNav.test.tsx`                                    |
| Session restore, register/login/logout state moves       | `frontend/src/features/auth/AuthProvider.test.tsx`                       |

> The E2E is not a duplicate of these. It exists to prove the one thing they all
> stub: that the cookie the backend sets is the cookie the browser returns.
