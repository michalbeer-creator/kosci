# Kościany Turniej

Gra w kości na Androida z animowanymi rzutami 3D (three.js + fizyka cannon-es w WebView).

- 2 graczy na jednym telefonie albo gra z komputerem
- 5 kości, do 3 rzutów na turę, 13 rubryk

## Pobranie

Najnowszy APK: zakładka **Releases** → `KoscianyTurniej.apk`.

## Budowanie

Każdy push na `main` uruchamia GitHub Actions, które budują APK i publikują go jako Release.

Lokalnie: `npm ci && npm run build && ./gradlew assembleRelease` (wymaga Android SDK).
