# Simulateur PEA

Projection d'un Plan d'Épargne en Actions sur 1 à 40 ans : intérêts composés
mensuels, inflation, frais, plafond de versements et fiscalité française 2026.

**En ligne : https://pierre-finance.github.io/simulateur-pea/**

Une page web autonome — HTML, CSS et JavaScript sans dépendance à installer ni
étape de construction. Tout se calcule dans le navigateur ; les réglages et les
scénarios sauvegardés restent dans son `localStorage`, rien n'est envoyé ailleurs.

## Ce qu'il fait

- **Projection** : versement mensuel, rendement, durée, apport initial, inflation,
  frais de l'ETF, hausse annuelle des versements. Capital final, valeur en euros
  d'aujourd'hui, plus-value, frais cumulés, part des versements et des intérêts.
- **Plafond du PEA** (150 000 € de versements, 300 000 € pour un couple) : année
  où il est atteint, et comparaison des enveloppes pour la suite — compte-titres,
  assurance-vie, PEA-PME — chacune avec sa règle d'imposition et ses limites.
- **Fiscalité** : prélèvements sociaux du PEA après 5 ans face à la flat tax d'un
  compte-titres.
- **Phases de vie et réglages fins** : versement et rendement différents selon les
  périodes, jusqu'au mois près ; scénarios prêts à l'emploi (krach, décennie
  perdue, carrière en U…) ; versements ponctuels (prime, héritage).
- **Phase de rente** : combien de temps le capital tient face à une rente
  mensuelle, et quelle rente il peut verser sans s'épuiser.
- **Monte Carlo** : éventail des trajectoires possibles pour une volatilité
  donnée, probabilité d'atteindre un objectif, risque de moins-value. Le tirage
  est reproductible : à réglages identiques, mêmes chiffres.
- **Backtest** : le même plan rejoué sur les rendements réels du MSCI World
  depuis 1970 (chocs pétroliers, bulle internet, 2008…).
- **Scénarios** : sauvegarde, rechargement et comparaison de deux plans, courbe
  superposée.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | La page |
| `styles.css` | Feuille de style, complète à elle seule |
| `simulation.js` | Le moteur : fonctions pures, sans accès à la page |
| `charts.js` | Graphiques ([Chart.js](https://www.chartjs.org/) 4, chargé depuis un CDN) |
| `ui.js` | Interface : curseurs, sections, tableaux, scénarios |

Pour l'essayer en local, ouvrir `index.html` dans un navigateur, ou servir le
dossier (`python -m http.server`).

La page fait aussi partie d'une application personnelle plus large : elle
référence `../common.css`, `../common.js` et `../manifest.json`, absents ici.
Leur absence est prévue — la page s'en passe.

## Hypothèses et limites

- Simulation **indicative** : un rendement constant n'existe pas, et les
  performances passées ne préjugent pas des performances futures. Monte Carlo et
  le backtest sont là pour le rappeler.
- Les rendements historiques du MSCI World sont approximatifs (annuels, en
  dollars, dividendes réinvestis).
- Fiscalité en vigueur en 2026 (prélèvements sociaux de 18,6 % sur le PEA,
  flat tax de 31,4 %, 17,2 % maintenus sur l'assurance-vie) : les taux sont des
  constantes en tête de `simulation.js`, à revoir à chaque loi de finances.
- Ce n'est pas un conseil en investissement.
