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
| Push und Zeiten | Feste Koch- und Einkaufszeiten mit Erinnerung und als Kalendereintrag, Timer-Alarm bei gesperrtem iPhone, Erinnerung ans Auftauen am Vorabend |
| Heute nicht | Ein Tipp: Die Box wandert in den Tiefkühler oder auf morgen, je nachdem, was sicher ist |
| Lücke im Tag | Bausteine ohne Kochen für den Rest des Tagesziels, ihre Zutaten stehen auf der Einkaufsliste |
| Echter Verlauf | Alle zwei Wochen passt die App das Kalorienziel an die echte Gewichtskurve an, in kleinen Schritten |
| Foto vom Gericht | Erst das Gericht erkennen, dann eine Kalorien-Spanne. Keine Zahl, wenn es nur geraten wäre |
| Supplements | Eigene Liste zum Abhaken, Claude beurteilt, was sich lohnt und was nicht |
| Eigene Rezepte | Aus Link, Foto oder Text, ein Tipp nimmt sie in die nächste Woche |
| Abwechslung und Budget | Kleine Varianten beim Aufwärmen, geschätzte Kosten, optionales Wochenbudget, Boxen-Check |

## Regeln im Plan

- **Haltbarkeit:** Gekochtes als Faustregel 3–4 Tage im Kühlschrank. Was später gegessen wird, plant die App für den Tiefkühler oder einen zweiten Kochtag. Das prüft der App-Code, nicht nur die KI.
- **Nährwerte:** Die KI liefert Zutaten und Mengen, die App rechnet mit einer Nährwerttabelle. Unbekannte Zutaten schätzt die KI und die App kennzeichnet sie. Angezeigt wird immer „ca.“.
- **Kalorienziel:** Beim Abnehmen und bei der Definition nie unter den Ruhebedarf (mindestens 1.500 kcal bei Männern, 1.200 bei Frauen, 1.350 ohne Angabe). Bei Untergewicht plant Prepora kein Defizit. Für Erwachsene ab 18.

## Technik

- **App:** JavaScript ohne Build-Schritt, GitHub Pages unter `fouad-boudouhi.de/prepora/`. Volumora liegt auf derselben Domain, darum beginnen alle Speicher- und Cache-Namen mit `prepora-`.
- **Server:** Der Volumora-Server auf dem Raspberry Pi (`sync-server/` im Volumora-Repo) stellt Konten und KI-Weiterleitung mit Monatsbudget. Ein Konto, ein Claude-Schlüssel. Der Server lässt Anfragen von der ganzen Domain zu, dafür war keine Änderung nötig. Im selben Browser übernimmt Prepora die Volumora-Anmeldung automatisch. Auf dem iPhone hat jede installierte Web-App ihren eigenen Speicher, dort meldest du dich einmal an; die Volumora-Daten kommen über den Server.
- **Nötige Server-Änderung:** `/v1/snapshot` kennt pro Konto genau einen Datenstand. Prepora hat deshalb einen eigenen Platz unter `/v1/apps/prepora/snapshot`. Die Volumora-Daten liest es nur, ein Test sichert das ab.
- **Datenhaltung:** Alles liegt zuerst auf dem Gerät. Gespeicherte Pläne und der Kochmodus funktionieren auch, wenn der Pi aus ist.
- **KI:** Claude über die Weiterleitung, Pläne als festes JSON-Format, das die App vor dem Speichern prüft. Geschätzte Kosten: 10–30 Cent pro Wochenplan (aus den Preisen gerechnet, noch nicht gemessen).
- **Grenzen auf dem iPhone:** Web-Apps können nicht vibrieren und laufen bei gesperrtem Bildschirm nicht weiter. Timer speichern deshalb ihre Endzeit und gehen nie falsch; der Alarm im Hintergrund kommt per Push vom Pi. Bildschirm-Anhalten und Push müssen auf dem echten iPhone getestet werden.

## Meilensteine

Ablauf: Branch, Pull Request, grüne Tests, Merge. Merge heißt live.

| # | Inhalt | Status |
| --- | --- | --- |
| M0 | Grundgerüst, Tests, GitHub Pages | fertig |
| M1 | Orange als Farbe, Anmeldung mit dem Volumora-Konto, Claude über den Server | fertig |
| M2 | Server: eigener Datenplatz; Abgleich in der App | fertig |
| M3 | Profil und Ziele mit Kalorien- und Eiweißziel | fertig |
| M4 | Rezepte und Nährwert-Tabelle | fertig |
| M5 | KI-Wochenplan mit Haltbarkeitsprüfung, Tauschen, Woche wiederholen | fertig |
| M6 | Einkaufsliste | fertig |
| M7 | Kochmodus mit Timern und Helfer | fertig |
| M8 | Heute und Tiefkühl-Vorrat | fertig |
| M9 | Geschmack lernen | fertig |
| M10 | Volumora-Verbindung | fertig |
| M11 | Kühlschrank-Foto | fertig |
| M12 | Push: Timer-Alarm und Auftau-Erinnerung | fertig |
| M13 | Heute nicht, Lücke im Tag, Echter Verlauf, Foto vom Gericht, Supplements, Eigene Rezepte, feste Zeiten, Einkauf für die ganze Woche, Budget, Boxen-Check | fertig |

## Ideen für später

- Sprachbefehl „weiter“ im Kochmodus für nasse Hände (Sprache lief in Volumora auf dem iPhone unzuverlässig, vorher testen)
- Saisonale Zutaten bevorzugen
