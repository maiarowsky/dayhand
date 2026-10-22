# Helm for Android

Not started yet. The Android app (Kotlin) is the next build step.

Planned shape, from the approved plan:

- Room is the source of truth for the screens and holds a durable outbox of changes,
  sent by WorkManager when the network is back, so the app works offline.
- Convex (`dev.convex:android-convexmobile`) keeps Room in sync through live subscriptions.
- Reminders and the 05:00 morning summary are local alarms computed from Room.
- The app calls the public functions in `backend/convex/app.ts`; every change carries a
  `clientId` so retries from the outbox are applied once.
