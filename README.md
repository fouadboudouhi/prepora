# Prepora

Einmal kochen, die ganze Woche essen. Prepora ist eine installierbare Web-App (PWA), die dir für dein Ziel einen Wochenplan für ein bis zwei Kochtage erstellt, die Einkaufsliste rechnet und dich mit Timern durch den Kochtag führt.

Live: https://fouad-boudouhi.de/prepora/

Was die App kann und warum, steht in [PLAN.md](PLAN.md).

## Lokal starten

```bash
npm install
npm start
```

Danach läuft die App auf http://localhost:8080.

## Tests

```bash
npx playwright install chromium
npm test
```

## Aufbau

Reines JavaScript ohne Build-Schritt, wie [Volumora](https://github.com/fouadboudouhi/volumora). Was auf `main` landet, ist über GitHub Pages sofort live. Konten, Datenspeicher und die KI-Anbindung laufen über den Server aus dem Volumora-Repo (`sync-server/`).

Schriften und ihre Lizenz: [THIRD_PARTY_ASSETS.md](THIRD_PARTY_ASSETS.md).
