# AlphaTex → MusicXML — PWA

Une vraie Progressive Web App : conversion **entièrement côté client** (rien
n'est envoyé à un serveur), installable sur écran d'accueil, fonctionne
hors-ligne après le premier chargement.

## Contenu du paquet

```
index.html            page principale
styles.css             identité visuelle
app.js                  logique d'interface (drag & drop, conversion, téléchargement, sélecteur de sens)
converter.mjs           AlphaTex → MusicXML (sérialiseur écrit pour cet outil)
converter-x2t.mjs        MusicXML → AlphaTex (glue autour de l'import/export natifs d'AlphaTab)
manifest.json            manifeste PWA (nom, icônes, couleurs, mode standalone)
sw.js                     service worker (cache l'app pour l'usage hors-ligne)
vendor/alphaTab.mjs            bibliothèque AlphaTab, vendorisée en local
vendor/alphaTab.core.mjs       (pas de dépendance à un CDN externe — 100% autonome)
icons/                    icônes 192px / 512px, versions standard et "maskable"
```

Aucune étape de build n'est nécessaire : ce sont des fichiers statiques
prêts à être servis tels quels.

## Les quatre sens de conversion

Un sélecteur en haut de page bascule entre eux :

- **AlphaTex → MusicXML** (`converter.mjs`) : la sérialisation MusicXML a
  été écrite pour cet outil — voir la portée détaillée plus bas.
- **MusicXML → AlphaTex** (`converter-x2t.mjs`) : glue autour de l'import
  MusicXML natif et de l'`AlphaTexExporter` natif d'AlphaTab.
- **AlphaTex → Guitar Pro** (`converter-t2gp.mjs`) : glue autour du parseur
  AlphaTex natif et du `Gp7Exporter` natif d'AlphaTab (Guitar Pro 7+, depuis
  la version 1.2.0). Entrée texte, **sortie fichier binaire** (`.gp`).
- **Guitar Pro → AlphaTex** (`converter-gp2t.mjs`) : glue autour de
  l'importeur Guitar Pro natif (détection automatique GP3/4/5/GPX/GP7+) et
  de l'`AlphaTexExporter`. **Entrée fichier binaire**, sortie texte.

Pour les deux sens impliquant Guitar Pro, l'interface s'adapte : la zone de
texte devient une zone de dépôt de fichier en entrée binaire, et l'aperçu
affiche la taille du fichier généré plutôt qu'un contenu illisible en sortie
binaire.

Un test en aller-retour (AlphaTex → export MusicXML maison → import/export
natifs d'AlphaTab → AlphaTex, et séparément AlphaTex → .gp → AlphaTex)
reproduit fidèlement les frettes, cordes, n-olets, nuances et changements de
mesure d'origine dans tous les sens.

**Limite connue pour MusicXML → AlphaTex** : la qualité dépend de l'import
MusicXML d'AlphaTab, qualifié de "basique" par ses propres contributeurs,
avec des bugs connus sur certains cas (balises de navigation D.C./segno/
fine mal placées selon leur position dans le XML, calcul de tempo incorrect
quand l'unité de métronome n'est pas la noire). Pour un MusicXML simple
(notes, rythme, mesures, armure), la conversion est fiable.

## Tester en local

Un service worker exige `http://` ou `https://` (pas `file://`). Le plus
simple :

```bash
cd alphatex-to-musicxml-pwa
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

(`npx serve`, `php -S localhost:8000`, etc. fonctionnent tout aussi bien.)

## Déployer pour de vrai

N'importe quel hébergement de fichiers statiques en HTTPS convient. Deux
options simples et gratuites :

**GitHub Pages**
1. Pousse ce dossier dans un dépôt GitHub (le contenu de ce dossier à la
   racine, ou dans `/docs`).
2. Repo → *Settings* → *Pages* → choisis la branche et le dossier.
3. L'app sera servie sur `https://<utilisateur>.github.io/<repo>/`.

**Netlify / Vercel**
1. Crée un compte, glisse-dépose ce dossier dans l'interface ("deploy
   manually" / drag & drop), ou connecte un dépôt Git.
2. Aucune commande de build à configurer — c'est du statique.

Une fois déployé en HTTPS, le navigateur (Chrome, Edge, Android) proposera
d'installer l'app ; sur iOS/Safari, on l'ajoute via *Partager → Sur l'écran
d'accueil*.

## Mettre à jour l'app après un déploiement

Le service worker met le cache en cache-first pour les fichiers de l'app.
Après toute modification d'un fichier livré ici, incrémente le numéro de
version dans `sw.js` :

```js
const CACHE_NAME = 'alphatex2musicxml-shell-v2'; // v1 → v2
```

Sans ça, les visiteurs déjà installés continueront de voir l'ancienne
version tant que le cache n'a pas expiré naturellement.

## Portée fonctionnelle du convertisseur

Identique à la version en ligne de commande livrée précédemment : notes,
silences, durées, points, triolets/n-olets, accords, liaisons de tenue,
armure/mesure/clé, tempo, nuances, articulations, paroles, reprises,
plusieurs voix/pistes, tablature (corde/frette/accordage), hammer-on/
pull-off, glissandos, harmoniques, bends (approximatifs), trilles — tout en
s'appuyant sur des éléments **natifs** de MusicXML uniquement.

Sont volontairement ignorés : palm-mute, let-ring, rasgueado, golpe,
wah-pedal, notes fantômes/mortes — aucun de ces éléments n'a d'équivalent
natif en MusicXML.

## Vie privée

Aucune donnée ne quitte le navigateur : le fichier AlphaTex est lu, analysé
et converti localement par WebAssembly/JS (AlphaTab), et le fichier XML
résultant est généré en mémoire avant d'être proposé au téléchargement.
Aucun serveur n'est impliqué dans la conversion elle-même — seul
l'hébergement statique sert les fichiers de l'app.

## Licence d'AlphaTab

`vendor/alphaTab.mjs` et `vendor/alphaTab.core.mjs` sont distribués sous
licence MPL 2.0 (voir `vendor/LICENSE`), incluse telle quelle depuis le
paquet npm officiel `@coderline/alphatab`.
