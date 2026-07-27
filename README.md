# BestandsMatch

## Lokal testen
npm install
npm run dev

## Deploy auf Vercel
1. Dieses Projekt in ein neues GitHub-Repo pushen.
2. Auf vercel.com -> "Add New..." -> "Project" -> Repo importieren.
3. Vercel erkennt Vite automatisch (Build: `npm run build`, Output: `dist`). Einfach "Deploy" klicken.

Die Supabase-Zugangsdaten stehen bereits fest im Code (src/App.jsx) - keine
Umgebungsvariablen noetig.

Hinweis: index.html enthaelt <meta name="robots" content="noindex, nofollow">,
damit dieses interne Tool nicht in Suchmaschinen auftaucht. Diesen Link nicht
oeffentlich verlinken.
