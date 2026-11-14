# Kościany Turniej

Gra w kości na Androida z animowanymi rzutami 3D (three.js + fizyka cannon-es w WebView).

- 2 graczy na jednym telefonie, gra z komputerem albo **gra na dwóch telefonach** (Google Nearby Connections: Bluetooth / Wi-Fi, bez internetu i serwera; wymaga Usług Google Play)
- 5 kości, do 3 rzutów na turę, 13 rubryk

## Pobranie

Najnowszy APK: zakładka **Releases** → `KoscianyTurniej.apk`.

## Budowanie

Każdy push na `main` uruchamia GitHub Actions, które budują APK i publikują go jako Release.

Lokalnie: `npm ci && npm run build && ./gradlew assembleRelease` (wymaga Android SDK).

## Gra na dwóch telefonach

Jeden telefon wybiera „Załóż grę”, drugi „Dołącz do gry” i dotyka znalezionej gry. Telefon, który ma ruch, rzuca kośćmi i wysyła wynik; drugi odtwarza animację i pokazuje ten sam wynik. Po zerwaniu połączenia oba telefony same próbują połączyć się ponownie i wyrównują stan gry.

Test w przeglądarce bez telefonów: `npm run build`, serwer HTTP w `app/src/main/assets`, otwórz `index.html?mocknet` w dwóch kartach.
