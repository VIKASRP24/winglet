# Winglet app

Expo / React Native app. One codebase builds:

- the **Android APK** (see `.github/workflows/release.yml`)
- the **web app**, which the Hermes plugin serves to phones and browsers (installable on iPhone via
  Safari → Add to Home Screen)

## Layout

```
src/app/          screens (Expo Router): home, chat, inbox, pair, scan, settings
src/components/   UI: sidebar, chat view, inbox cards, markdown, bot faces
src/lib/          store (zustand), server connection, API, push, theme
public/           web-only files: service worker, manifest, icons
```

## Run it

```bash
npm install
npx expo start          # press "w" for the web version
npx tsc --noEmit        # typecheck
```

Pair it with a Hermes machine that runs the Winglet plugin (`hermes winglet pair`).

To bundle the web build into the plugin, run `../scripts/build-web.sh`.
