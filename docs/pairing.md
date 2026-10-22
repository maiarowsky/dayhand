# Pairing the phone with a QR code (idea, not built)

Today the Android app signs in with an app token pasted into Settings: an ES256 JWT that
`npm run app-token` in `backend/` signs with a private key kept outside the repository. This
works, but copying a long token to a phone is clumsy. This note describes a later replacement.
Nothing here is implemented.

## Goal

Scan one QR code on the computer, and the phone is connected to the right backend as the right
user, with no token ever typed, shown on screen for long, or sent through a chat or e-mail.

## Flow

1. On the computer: `npm run pair` (new script) asks the backend for a **pairing code**: a random
   one-time secret, valid for 5 minutes, stored on the server as a hash together with the user id
   it will sign in.
2. The script prints a QR code holding `helm://pair?url=<backend URL>&code=<pairing code>`.
3. The app scans it (CameraX with ZXing, or the Google code scanner, which needs no camera
   permission in the app), shows the backend address and asks the user to confirm.
4. The app calls a new action `pairing:redeem({ code, deviceName })`. The backend checks the hash
   and the expiry, deletes the code (one use only) and returns an app token for that user,
   signed with the deployment's private key, plus a device id.
5. The app stores the token as it does today (Tink, Android Keystore) and starts syncing.

## Why this shape

- **Short-lived and single-use.** A photographed QR code is useless after 5 minutes or after
  one scan. The long-lived secret (the token) never appears in the QR code.
- **No new permission in the app** if the Google code scanner is used; CameraX would add the
  camera permission, which needs a separate decision.
- **Same user as the agent.** The pairing code carries the user id, so the phone, the CLI and
  the agent see one task list (today the user id is `<issuer>|<subject>` from the token).
- **Revocable devices.** With a device id per phone, the backend can keep a list of paired
  devices and refuse tokens of a removed one (a `jti` or device check in `app.ts`), which
  pasted tokens cannot offer today.

## Open questions

- Signing in the backend needs the private key as a deployment secret (today it is used only by
  the local script). Alternative: the backend issues opaque session tokens instead of JWTs.
- Token refresh: today tokens last up to 366 days and are replaced by hand. Pairing could
  return a refresh token and use the Convex client's `AuthProvider.loginFromCache` hook.
- Whether pairing should also be possible from the app's own Settings on a second phone.
