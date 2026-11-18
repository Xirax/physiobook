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

---

## E2.4 — Admin availability UI → owed by **E7**

**Why deferred:** the same missing harness as E1.5 above — `e2e/` is still a
placeholder and standing Playwright up is E7's scope. Agreed when 2.4 was
planned.

**What this costs:** the RTL suite stubs the api-client, so it proves the screen
reacts to what `/slots` answers, but not that the real slot grid answers with
the new hours and timezone after a real save. That seam — PUT, then the 2.3 grid
recomputing over real Postgres — is untested end to end until E7.

### Cases still owed

- [ ] Admin edits the business hours, saves → the slot preview shows the slots
      those hours open.
- [ ] Admin changes the timezone, saves → the slot preview shows the slots in
      the new timezone (same wall-clock hours, shifted UTC instants).
- [ ] The **booking list** half of the ticket's case: after the save, the
      patient's slot picker (`/book`, landed in 3.5) offers the new slots.

### Already covered — do not rewrite

| Behaviour                                                       | Where                                                                   |
| --------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Add/remove windows, close<=open and overlap inline errors       | `frontend/src/features/availability/BusinessHoursEditor.test.tsx`       |
| Row mapping of the shared schema's issues, split-shift defaults | `frontend/src/features/availability/weekly-windows.test.ts`             |
| Invalid timezone and out-of-range hours rejected inline         | `frontend/src/features/availability/PracticeSettingsForm.test.tsx`      |
| Preview range and labels in the practice timezone, across DST   | `frontend/src/features/availability/slot-preview.test.ts`               |
| Saves invalidate the slot preview                               | `frontend/src/features/availability/availability-api.test.tsx`          |
| Preview follows a saved week and timezone; admin-only; guard    | `frontend/src/routes/admin/AdminAvailability.test.tsx`                  |
| The slot grid itself (hours, blocks, DST, horizon)              | `backend/src/modules/availability/slot-grid*.test.ts`, `slots*.test.ts` |

---

## E3.5 — Booking UI (slot picker) → owed by **E7.1 / E7.2**

**Why deferred:** the same missing harness as E1.5 above — `e2e/` is still a
placeholder and standing Playwright up is 7.1's scope; 7.2 (two-user race)
already depends on 3.5. Agreed when 3.5 was planned.

**What this costs:** the RTL suite stubs the api-client, so it proves the page
reacts correctly to a 201, a 409 and a 422, but not that a click reaches the
real backend. That seam is exactly where 3.5 found a bug no unit test could
see: `/appointments` was in neither proxy list, so a booking would have died at
the dev server. The proxy fix is now untested end to end until E7.

### Cases still owed

- [ ] **7.1 — book end-to-end:** a patient opens `/book`, picks an open slot,
      confirms → sees "Booked: …", the slot is gone from the picker, and it
      appears on `/my-appointments` once 6.2 lands.
- [ ] **7.2 — two-tab race:** two patients poised on the same slot confirm
      together → one sees "Booked", the other sees "Someone else has just booked
      that slot" and the slot leaves their picker; exactly one active
      appointment in Postgres.

### Already covered — do not rewrite

| Behaviour                                                  | Where                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------- |
| Slots per practice-tz day, taken slot absent, week limits  | `frontend/src/features/booking/SlotPicker.test.tsx`           |
| Confirm dialog: description, focus, Escape, Tab trap, lock | `frontend/src/features/booking/ConfirmBookingDialog.test.tsx` |
| Optimistic removal; rollback on 409, then refetch          | `frontend/src/features/booking/booking-api.test.tsx`          |
| Practice-tz today and the 62-day horizon                   | `frontend/src/features/booking/booking-week.test.ts`          |
| User-only; confirm before POST; 201 / 409 / 422 outcomes   | `frontend/src/routes/BookAppointment.test.tsx`                |
| The race itself (exactly one winner, no deadlock)          | `backend/tests/race/concurrent-booking.test.ts` (3.3)         |
