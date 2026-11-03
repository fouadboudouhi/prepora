# Prepora: Plan

Stand: 3. November 2026. Für eine Person gedacht, Portionszahl einstellbar. Freunde mit Volumora-Einladung können die App mit ihrem Konto nutzen.

## Die Idee

Prepora geht vom **Kochtag** aus, nicht vom einzelnen Rezept. Aus Ziel, Geschmack und verfügbarer Zeit entstehen ein bis zwei Kochtage pro Woche, die alle Mahlzeiten abdecken.

## Was die App kann

| Bereich | Inhalt |
| --- | --- |
| Heute | Was du heute isst, wo es liegt, wie du es aufwärmst, Stand von Kalorien und Eiweiß |
| Profil | Ziel (Muskelaufbau, Abnehmen, Definition, Halten, weitere), Körperdaten, Abneigungen, Geräte, Kochzeit |
| Geschmack | Start mit etwa 20 Gerichten zum Wischen, nach jedem Essen ein Tipp: nochmal, okay, nie wieder. Das Gelernte ist sichtbar und änderbar |
| Wochenplan | KI-Plan als Baukasten (zum Beispiel 2 Proteine, 2 Beilagen, 3 Saucen), einzelne Gerichte tauschen, bewährte Woche ohne KI wiederholen |
| Einkauf | Echte Packungsgrößen, Reste werden verplant, Abhaken im Laden |
| Kochmodus | Alle Rezepte als ein Ablauf, mehrere Timer, große Schrift, Bildschirm bleibt an, Helfer für Fragen wie „Ich habe keinen Koriander“, zum Schluss Portionieren mit Beschriftung für die Boxen |
| Vorrat | Tiefkühler mit Datum, der nächste Plan verbraucht ihn zuerst |
| Kühlschrank-Foto | Die KI erkennt, was noch da ist, und plant damit |
| Volumora | Gewicht und Training fließen in Kalorien und Eiweiß ein |
| Push | Timer-Alarm bei gesperrtem iPhone, Erinnerung ans Auftauen am Vorabend |

## Regeln im Plan

- **Haltbarkeit:** Gekochtes als Faustregel 3–4 Tage im Kühlschrank. Was später gegessen wird, plant die App für den Tiefkühler oder einen zweiten Kochtag. Das prüft der App-Code, nicht nur die KI.
- **Nährwerte:** Die KI liefert Zutaten und Mengen, die App rechnet mit einer Nährwerttabelle. Unbekannte Zutaten schätzt die KI und die App kennzeichnet sie. Angezeigt wird immer „ca.“.
- **Kalorienziel:** Feste Untergrenze beim Abnehmen, keine Crash-Diäten.

## Technik

- **App:** JavaScript ohne Build-Schritt, GitHub Pages unter `fouad-boudouhi.de/prepora/`. Volumora liegt auf derselben Domain, darum beginnen alle Speicher- und Cache-Namen mit `prepora-`.
- **Server:** Der Volumora-Server auf dem Raspberry Pi (`sync-server/` im Volumora-Repo) stellt Konten und KI-Weiterleitung mit Monatsbudget. Ein Konto, ein Claude-Schlüssel. Der Server lässt Anfragen von der ganzen Domain zu, dafür war keine Änderung nötig. Im selben Browser übernimmt Prepora die Volumora-Anmeldung automatisch. Auf dem iPhone hat jede installierte Web-App ihren eigenen Speicher, dort meldest du dich einmal an; die Volumora-Daten kommen später über den Server.
- **Nötige Server-Änderung:** `/v1/snapshot` kennt pro Konto genau einen Datenstand. Prepora bekommt einen eigenen Platz, sobald es Daten zum Abgleichen gibt; ein Test beweist, dass Volumora-Daten unberührt bleiben. Bis dahin ruft Prepora `/v1/snapshot` nie auf.
- **Datenhaltung:** Alles liegt zuerst auf dem Gerät. Gespeicherte Pläne und der Kochmodus funktionieren auch, wenn der Pi aus ist.
- **KI:** Claude über die Weiterleitung, Pläne als festes JSON-Format, das die App vor dem Speichern prüft. Geschätzte Kosten: 10–30 Cent pro Wochenplan (aus den Preisen gerechnet, noch nicht gemessen).
- **Grenzen auf dem iPhone:** Web-Apps können nicht vibrieren und laufen bei gesperrtem Bildschirm nicht weiter. Timer speichern deshalb ihre Endzeit und gehen nie falsch; der Alarm im Hintergrund kommt per Push vom Pi. Bildschirm-Anhalten und Push müssen auf dem echten iPhone getestet werden.

## Meilensteine

Ablauf: Branch, Pull Request, grüne Tests, Merge. Merge heißt live.

| # | Inhalt | Status |
| --- | --- | --- |
| M0 | Grundgerüst, Tests, GitHub Pages | fertig |
| M1 | Orange als Farbe, Anmeldung mit dem Volumora-Konto, Claude über den Server | fertig |
| M2 | Server: eigener Datenplatz; Abgleich in der App | offen |
| M3 | Profil und Ziele mit Kalorien- und Eiweißziel | offen |
| M4 | Rezepte und Nährwert-Tabelle | offen |
| M5 | KI-Wochenplan mit Haltbarkeitsprüfung, Tauschen, Woche wiederholen | offen |
| M6 | Einkaufsliste | offen |
| M7 | Kochmodus mit Timern und Helfer | offen |
| M8 | Heute und Tiefkühl-Vorrat | offen |
| M9 | Geschmack lernen | offen |
| M10 | Volumora-Verbindung | offen |
| M11 | Kühlschrank-Foto | offen |
| M12 | Push: Timer-Alarm und Auftau-Erinnerung | offen |

## Ideen für später

- Wochenbudget: geschätzte Kosten pro Plan, günstigere Varianten
- Eigene Rezepte aus Link oder Foto übernehmen
- Sprachbefehl „weiter“ im Kochmodus für nasse Hände (Sprache lief in Volumora auf dem iPhone unzuverlässig, vorher testen)
- Saisonale Zutaten bevorzugen
