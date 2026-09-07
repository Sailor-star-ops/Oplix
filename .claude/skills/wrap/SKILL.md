---
name: wrap
description: Clôture une session de travail sur Oplix en consignant ce qui s'est passé dans JOURNAL.md et en vérifiant que ROADMAP.md est à jour. Utiliser quand l'utilisateur tape /wrap, dit vouloir "clôturer la session" ou "faire le point", ou juste avant de faire /clear.
---

# Wrap — clôture de session

Objectif : que la prochaine session (après un `/clear`) puisse repartir sans que l'utilisateur ait à tout réexpliquer. `JOURNAL.md` est le carnet de bord ; `ROADMAP.md` est l'état courant du projet (En cours / Prévu / Fait). Les deux sont relus automatiquement au démarrage de chaque session (hook `SessionStart`), donc ce qui n'est pas écrit ici est perdu à la prochaine `/clear`.

## Étapes

1. **Relis `ROADMAP.md`** à la racine du projet pour savoir ce qui était déjà su avant cette session.
2. **Repasse la session en cours** (la conversation) et identifie ce qui s'est réellement passé : décisions prises, bugs trouvés et corrigés, fonctionnalités ajoutées, points laissés en suspens ou bloqués, questions posées à l'utilisateur restées sans réponse.
3. **Mets à jour `ROADMAP.md`** si besoin : déplace vers "Fait" ce qui est terminé, ajoute dans "Prévu" ce qui a été décidé mais pas encore fait, retire ou ajuste "En cours". Ne duplique pas ce qui y est déjà — ROADMAP.md est souvent déjà tenu à jour en direct pendant la session, dans ce cas ce sera un no-op.
4. **Ajoute une entrée dans `JOURNAL.md`** à la racine du projet (crée le fichier avec un titre `# Journal Oplix` s'il n'existe pas encore). Format d'une entrée :

   ```
   ## 2026-08-31

   - Ce qui a été fait, en quelques puces factuelles (pas une paraphrase du roadmap — ce que ROADMAP.md sait déjà, JOURNAL.md n'a pas besoin de le répéter en détail).
   - Décisions prises et pourquoi, quand la raison n'est pas évidente en relisant juste le code.
   - Ouvert / en attente : ce qui reste à trancher ou bloqué, pour que la prochaine session ne reparte pas de zéro dessus.
   ```

   Utilise la date du jour. Si une entrée existe déjà pour aujourd'hui (plusieurs `/wrap` le même jour), complète-la plutôt que d'en créer une deuxième.

5. **Reste concis.** Une entrée de journal est un résumé de session, pas une transcription — quelques puces suffisent la plupart du temps. Le but est qu'une lecture rapide de `JOURNAL.md` + `ROADMAP.md` donne une image fidèle de l'état du projet, pas un compte-rendu exhaustif.
6. **Termine en disant à l'utilisateur que c'est prêt** — quelque chose comme : "Journal et roadmap à jour, tu peux faire `/clear` maintenant."

## Ce que ce skill ne fait pas

Il n'exécute pas `/clear` lui-même — c'est à l'utilisateur de le faire une fois qu'il a vu la confirmation, pour qu'il garde la main sur le moment où le contexte se vide.
