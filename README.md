# Voucher Manager

Offline-first, static web app to manage gift vouchers/gift cards. Built with plain HTML/CSS/JS, htmx, IndexedDB for storage, and PWA primitives. Suitable for static hosting (e.g. Cloudflare Pages) or embedding as the web bundle in Electron/Capacitor.

## Getting started

```bash
npm install
npm run dev
```

- `npm run dev` / `npm start`: run a simple static server on `src/` (default port 8080).
- `npm run build`: copy `src/` to `dist/` using a small Node build script.

`dist/` contains the production-ready static files that you can:
- deploy to any static host (Cloudflare Pages, GitHub Pages, etc.).
- load in an Electron app window.
- use as the Capacitor `webDir`.

## How data is stored

IndexedDB database `voucher-manager-db` contains:
- `vouchers` store (keyed by `id`, indexed by `merchantName`) with fields: `merchantName`, `initialAmount`, `currentBalance`, `currency`, `barcode`, `notes`, `created_at`.
- `payments` store (keyed by `id`, indexed by `voucherId`) with fields: `voucherId`, `amount`, `created_at`. Adding a payment atomically updates the related voucher balance.

No backend is used; exports/imports are JSON files the user downloads or selects locally.

## Project structure

```
package.json
build.mjs
src/
  index.html
  css/styles.css
  js/
    app.js
    db.js
    utils.js
    barcode.js
  sw.js
  manifest.webmanifest
  icons/
    icon-192.png
    icon-512.png
```
