---
name: condense
description: Compacte JOURNAL.md à la racine du projet Oplix quand il devient trop long, en résumant les anciennes entrées sans perdre ce qui est encore pertinent. Utiliser quand l'utilisateur tape /condense, ou dit que le journal "devient trop gros", "illisible" ou "trop long à relire".
---

# Condense — compacter le journal

`JOURNAL.md` grossit à chaque `/wrap`. Sans entretien, il devient trop long à relire au démarrage de session (le hook `SessionStart` en injecte la fin dans le contexte à chaque fois) et finit par coûter plus qu'il n'aide. Ce skill ne s'exécute jamais tout seul — seulement quand l'utilisateur le demande explicitement.

## Étapes

1. **Lis `JOURNAL.md`** en entier.
2. **Garde le détail tel quel pour les sessions récentes** (les ~5 dernières entrées, ou moins si le fichier est petit) — elles sont encore les plus utiles pour comprendre où en est le travail en ce moment.
3. **Résume les entrées plus anciennes** en un texte plus court par grande période (par semaine ou par mois selon la densité), en gardant :
   - les décisions qui ont encore un effet aujourd'hui (choix d'architecture, de nom, de direction produit),
   - tout ce qui est resté ouvert/non résolu — ne condense jamais un point encore en suspens au point de le rendre invisible ; s'il n'est toujours pas réglé, il doit rester lisible.
   - Ce qu'il est possible de perdre sans dommage : le détail pas-à-pas de bugs déjà corrigés, les allers-retours de mise au point, tout ce qui est de toute façon visible dans le code actuel.
4. **Réécris `JOURNAL.md`** avec cette structure :

   ```
   # Journal Oplix

   ## Archives (condensé)

   ### [période] — résumé condensé des sessions les plus anciennes

   ## [date la plus ancienne conservée en détail]
   ...
   ## [date la plus récente]
   ...
   ```

   La section "Archives" est cumulative : si elle existe déjà, condense-la encore un peu plus si besoin plutôt que de la dupliquer.
5. **Dis à l'utilisateur** combien de lignes/entrées ont été condensées et signale explicitement si un point encore ouvert a été repéré dans les anciennes entrées, pour qu'il confirme qu'il est toujours d'actualité avant qu'il ne devienne trop compressé pour être compris plus tard.

## Principe directeur

En cas de doute entre condenser ou garder : garde. Le risque d'un journal un peu trop long est mineur (quelques lignes de contexte en plus à chaque session) ; le risque de perdre une décision ou un point encore ouvert est bien plus coûteux — il faudrait alors ré-expliquer à Claude quelque chose que ce fichier existe justement pour ne pas avoir à répéter.
