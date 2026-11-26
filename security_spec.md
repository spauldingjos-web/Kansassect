# Firestore Security Specification (`SectionLine KS`)

## 1. Data Invariants
1. A `/users/{userId}` profile document can only exist for a signed-in user where `userId == request.auth.uid` and `data.uid == request.auth.uid`.
2. Users can never self-assign elevated privileges (`role` must strictly equal `'hunter'` on create and remain immutable on update).
3. `createdAt` and `updatedAt` timestamps must match `request.time` on creation, and `createdAt`, `uid`, `email`, and `role` remain immutable on update.
4. No collection-wide `list` queries on `/users` are allowed (PII isolation: `email`, `phone`, `displayName` are strictly owner-only `get`).
5. Every string field enforces explicit `.size()` bounds matching `firebase-blueprint.json` (`displayName` 2..80, `email` 3..160, `phone` 0..32, `uid` 1..128).

## 2. The "Dirty Dozen" Payloads (Expected: `PERMISSION_DENIED`)
1. Unauthenticated read of `/users/uidA` -> `PERMISSION_DENIED`.
2. Unauthenticated create of `/users/uidA` -> `PERMISSION_DENIED`.
3. Signed-in user `uidB` reading `/users/uidA` -> `PERMISSION_DENIED` (PII Isolation).
4. Signed-in user listing `/users` collection -> `PERMISSION_DENIED` (Query Scraping blocked).
5. Creating `/users/uidA` as `uidA` with `uid: "uidB"` -> `PERMISSION_DENIED` (Identity Spoofing).
6. Creating `/users/uidA` with `role: "admin"` -> `PERMISSION_DENIED` (Privilege Escalation).
7. Creating `/users/uidA` with shadow key `isVerified: true` -> `PERMISSION_DENIED` (`hasOnly` check).
8. Creating `/users/uidA` with oversized 1500-char `displayName` -> `PERMISSION_DENIED` (Resource Poisoning).
9. Creating `/users/uidA` with client-forged `createdAt` timestamp != `request.time` -> `PERMISSION_DENIED`.
10. Updating `/users/uidA` to change immutable `uid` or `role` -> `PERMISSION_DENIED`.
11. Updating `/users/uidA` with invalid type `phone: 12345` -> `PERMISSION_DENIED`.
12. Creating document in unlisted collection `/secrets/doc1` -> `PERMISSION_DENIED` (Global deny-all catch-all).
