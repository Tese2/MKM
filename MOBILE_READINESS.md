# MKM mobile readiness

## Existing mobile support retained

- The React/Vite frontend continues to use the existing Express REST API and PostgreSQL database.
- The UI already has responsive breakpoints, a mobile customer footer menu, a separate admin mobile footer menu, stacked dashboard cards, responsive forms, and horizontally scrollable data tables.
- Recharge proof upload accepts camera/gallery-compatible image formats and PDF, with server-side content validation and a 5 MB upload limit.
- Referral sharing uses the Web Share API where available and clipboard fallback.
- Financial state continues to come from authenticated server endpoints; wallet and transaction API responses are not cached by the service worker.

## Changes made

- Added a web app manifest, branded 192px/512px PNG install icons plus SVG favicon, theme/description metadata, and a production service worker.
- The service worker only caches the static application shell, hashed frontend assets, manifest, and icon. It explicitly bypasses `/api/` and does not cache mutation requests or authenticated financial responses.
- Improved small-screen input sizing to avoid mobile Safari auto-zoom and added touch-friendly minimum heights to common controls.

## Verification and remaining work

- Client production build passed and all 36 backend tests passed.
- Browser viewport overflow check passed at widths 320, 360, 375, 390, 412, 430, 768 and 1024 px for the shared page. This is not a full page-by-page visual test.
- Layout has not been tested in physical Android/iPhone browsers or in both portrait and landscape across every route.
- Production preview returned HTTP 200 for the manifest, service worker, and SVG icon. PNG install icons were added to the manifest; target-device install prompts still need verification.
- PWA installation and offline behavior require a production/preview HTTPS origin (localhost is also treated as secure by modern browsers); verify on target devices before release.
- Verify final production HTTPS, `CLIENT_URL`, cookie policy, trusted origins, database TLS, backups and deployment secrets for the actual hosting environment.
