# Security Specification & Invariants — Libreta Escolar

## 1. Data Invariants
1. Every document across all collections belongs to an authenticated, email-verified teacher (`ownerId == request.auth.uid && request.auth.token.email_verified == true`).
2. Every subcollection document under `/classrooms/{classroomId}` MUST belong to a valid parent classroom whose `ownerId == request.auth.uid`, verified via `get()` on create/update/get/delete, and whose `classroomId` matches the path parameter.
3. All document IDs (`classroomId`, `studentId`, `fileId`, `dateId`, `assignmentId`, `incidentId`, `periodId`, `gradeId`) must satisfy `^[a-zA-Z0-9_\-]+$` and length `<= 128`.
4. `ownerId`, `classroomId`, and `createdAt` are immutable once created.
5. `createdAt` and `updatedAt` timestamps must match `request.time` (server timestamps).
6. All `allow list` rules check `resource.data.ownerId == request.auth.uid` directly without calling `get()` or `exists()`.
7. All strings enforce `.size()` upper bounds to prevent 1MB document poisoning / Denial-of-Wallet attacks.

## 2. Dirty Dozen Attack Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated read/write**: Writing to `/classrooms/c1` with `auth == null`.
2. **Unverified email**: Creating a classroom with `email_verified: false`.
3. **Cross-tenant owner spoofing**: Creating `/classrooms/c1` with `ownerId: "victim_uid"` while authenticated as `"attacker_uid"`.
4. **Shadow field injection**: Creating a classroom with an extra `"isAdmin": true` key not in `hasOnly(...)`.
5. **Immutable field mutation**: Updating `ownerId` or `createdAt` on `/classrooms/c1/students/s1`.
6. **Parent classroom hijacking**: Creating `/classrooms/victim_class/students/s1` while `ownerId` is set to `"attacker_uid"`.
7. **Path variable ID poisoning**: Creating `/classrooms/bad$id..with..chars` violating `^[a-zA-Z0-9_\-]+$`.
8. **Type / size poisoning on StudentFile**: Uploading `dataUrl` exceeding 750,000 characters or wrong `storageMode` enum.
9. **Client-forged timestamp**: Creating an incident with `createdAt` set to a past client `Timestamp` instead of `request.time`.
10. **Blanket list scraping**: Listing `/classrooms/c1/students` without `where('ownerId', '==', auth.uid)`.
11. **Out-of-range grading configuration**: Setting `examWeight: 500` or `examTotalQuestions: -5`.
12. **Orphaned classroomId mismatch**: Creating `/classrooms/c1/incidents/i1` with `classroomId: "c2"`.
