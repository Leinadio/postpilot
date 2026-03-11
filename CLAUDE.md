# PostPilot - Extension Chrome LinkedIn Comment Generator

## Architecture

Extension Chrome Manifest V3 (vanilla JS, pas de framework, pas de build step).

### Fichiers

- `manifest.json` - Config extension, content scripts chargés en séquence, permissions (storage, activeTab, linkedin, anthropic API)
- `lib/prompts.js` - BASE_RULES, COMMENT_APPROACHES, REGISTRE_OPTIONS, EXPRESSION_OPTIONS, buildPrompt()
- `content/content.js` - Injection UI LinkedIn (Shadow DOM), panel, detection posts via MutationObserver, insertion commentaires
- `content/styles.css` - Styles du bouton trigger PostPilot (externe au Shadow DOM)
- `background/service-worker.js` - Appels API Claude Sonnet, reçoit {system, user} de buildPrompt()
- `popup/popup.html` + `popup.js` + `popup.css` - Config clé API Anthropic (stockée dans chrome.storage.local)

### Flux de donnees

1. `content.js` detecte les posts LinkedIn via les boutons "menu de commandes" (aria-label), remonte de 2 niveaux pour trouver la post card
2. Un bouton "PostPilot" est injecté dans la barre d'actions de chaque post (à côté de Commenter/Republier)
3. Au clic, un panel Shadow DOM s'ouvre avec les sélecteurs registre/expression et la grille des 8 approches
4. L'utilisateur choisit registre + expression + approche
5. `buildPrompt(type, postContent, registre, expression)` construit {system, user}
6. Le message est envoyé au service worker via `chrome.runtime.sendMessage`
7. Le service worker appelle l'API Claude et renvoie le commentaire
8. Le commentaire s'affiche dans le panel, l'utilisateur peut insérer, régénérer, ou changer d'approche

### Points techniques importants

- Les variables globales dans `prompts.js` utilisent `var` (pas const/let) pour être accessibles depuis `content.js` car les deux sont des content scripts chargés en séquence par le manifest
- Le panel UI utilise Shadow DOM pour isoler ses styles de ceux de LinkedIn
- L'interface {system, user} vers le service worker est stable. Modifier les prompts ne nécessite jamais de toucher au service worker
- La detection des posts utilise MutationObserver + debounce (500ms) + scroll listener + deux setTimeout initiaux (1.5s et 4s) pour couvrir le chargement dynamique de LinkedIn
- L'extraction du texte du post prend le `<p>` le plus long qui n'est pas dans un `<a>` ou `<button>`, avec fallback sur `span[dir]`
- L'insertion du commentaire clique d'abord le bouton "Commenter", attend 800ms, puis trouve l'éditeur le plus proche géographiquement du post. Fallback sur clipboard si l'éditeur est introuvable

## Systeme de commentaires

### 8 approches (terme UI, pas "stratégies")

| Clé | Label | Description | Points d'attention |
|-----|-------|-------------|-------------------|
| `rebond_concret` | Rebond concret | Exemple/fait externe lié au sujet | Pas de vécu inventé, éclairage factuel uniquement |
| `desaccord_nuance` | Désaccord / nuance | Contrepoint constructif | Respectueux, pas là pour corriger, assumer sans s'excuser |
| `apprentissage` | Apprentissage | Réagir à ce que le post apprend | Spécifique, pas de "ça fait réfléchir" vague |
| `question` | Question | Soulever un angle non abordé | Vraie question, pas rhétorique, bienveillante |
| `soutien` | Soutien | Valoriser sans être creux | Citer un passage précis, pas de surenchère |
| `complement` | Complément | Ajouter un point non couvert | Complément, pas un oubli de l'auteur |
| `opinion_franche` | Opinion franche | Prise de position directe | Ancré dans du concret (observation, logique, bon sens) |
| `legerete` | Légèreté | Observation malicieuse et bienveillante | PAS humour noir/moqueur/sarcasme, sourire complice, 1-2 phrases max |

### Registre (contextuel, choisi à chaque commentaire, défaut = neutre)

| Clé | Label | Comportement |
|-----|-------|-------------|
| `tutoiement` | Tutoiement | Comme un collègue qu'on connaît bien |
| `vouvoiement` | Vouvoiement | Formel mais ton oral/naturel quand même |
| `neutre` | Neutre | INTERDIT d'utiliser tu/toi/vous/votre. Tout en impersonnel ou 3e personne |

### Expression (contextuelle, choisie à chaque commentaire, défaut = neutre)

| Clé | Label | Comportement |
|-----|-------|-------------|
| `je` | Je | Première personne, point de vue personnel (mais JAMAIS de faux vécu) |
| `tu_vous` | Tu / Vous | S'adresser directement à l'auteur |
| `neutre` | Neutre | Le "je" n'est PAS le moteur. Formulations impersonnelles en priorité. Un "je" isolé peut passer |

### Combinaison des prompts

`buildPrompt()` assemble le system prompt dans cet ordre :
1. systemPrompt de l'approche (qui inclut déjà BASE_RULES via template literal)
2. prompt du registre
3. prompt de l'expression

Le user prompt contient le post + les instructions de raisonnement + un rappel formatage renforcé.

## Regles de ton (BASE_RULES)

### Posture

- Pair-à-pair. Affirmer son point de vue OK, mais JAMAIS corriger l'auteur ou donner l'impression qu'on sait mieux
- TOUJOURS bienveillant, même si le post original est provocateur/jugeant. Ne jamais reproduire un ton critique. Rebondir sur le positif
- Pas d'ironie condescendante, pas de sarcasme
- Pas de conclusions à la place de l'auteur ("ça veut dire que ton vrai problème c'est...")
- Pas de ton corporate creux ("Il est essentiel de...", "Force à toi", "Les synergies...")
- Ne pas paraphraser le post. Réagir au fond sans recopier la forme
- Première phrase direct dans le vif. Interdits en ouverture ("Super post", "Merci pour le partage", "Tellement vrai", etc.)

### Authenticite

- L'IA n'a PAS de passé, pas de mémoire, pas de relations, pas d'entourage
- JAMAIS de faux vécu, faux souvenirs, fausses observations personnelles, fausses anecdotes
- La règle est formulée comme un principe ("tu n'as pas de passé") plutôt qu'une liste de formulations interdites, car Claude contourne les listes
- S'applique à TOUTES les expressions (je, tu/vous, neutre)

### Ton

- Oral et naturel, comme un collègue. Vocabulaire du quotidien ("en vrai", "clairement", "le truc c'est que", "franchement", "genre")
- Ça vaut aussi en vouvoiement. Vouvoyer ne veut pas dire être guindé
- Varier les structures et tournures. Pas de formulations béquilles répétitives ("je me demande si", "le vrai problème c'est")
- Spécifique. Pas de compliments vagues

### Formatage (interdits absolus, sans exception)

- Zéro tiret cadratin (—)
- Zéro tiret demi-cadratin (–)
- Zéro emoji
- Zéro deux-points (:)
- Zéro hashtag
- Ces interdits sont renforcés dans le user prompt aussi (avec "sera rejeté"), car le system prompt seul ne suffit pas
- Le user prompt lui-même ne doit PAS contenir ces caractères (Claude imite ce qu'il voit)

### Longueur

- Dépend du contexte. 1 phrase si suffisant, 2-3 phrases max. La concision est reine

## Prompt engineering - Lecons apprises

### Technique du "sera rejeté"

Pour les règles strictes (formatage, registre neutre), ajouter "Si tu utilises X, le commentaire sera rejeté" est beaucoup plus efficace qu'un simple "n'utilise pas X".

### Coherence prompt / regles

Le user prompt ne doit jamais contenir de caractères interdits. Si le prompt utilise des deux-points, Claude les reproduit dans sa réponse.

### Principe vs liste

Pour les interdits comportementaux (faux vécu), formuler un principe ("tu n'as pas de passé") est plus robuste qu'une liste de formulations interdites. Claude contourne les listes en trouvant des variantes.

### Renforcement multi-couche

Les règles critiques doivent apparaître à la fois dans le system prompt (BASE_RULES) ET dans le user prompt (rappel formatage). Une seule couche ne suffit pas.

## Decisions de design

| Decision | Alternatives rejetees | Raison |
|---|---|---|
| 8 approches basées sur réactions naturelles | 6 stratégies artificielles (ancien système) | Plus ancré dans le comportement réel LinkedIn |
| Pas de "vécu perso" comme approche | Vécu perso, mini-profil, amorce à compléter | L'IA inventerait du faux vécu |
| "Rebond concret" au lieu de "vécu perso" | Anecdote personnelle | L'IA apporte un fait externe sans prétendre que c'est son vécu |
| Registre + expression contextuels | Réglage permanent | Ça dépend du post et de l'auteur |
| Ton oral toujours, même en vouvoiement | Ton formel en vouvoiement | Plus authentique LinkedIn |
| Affirmer OK, jamais corriger | Pair-à-pair strict (jamais affirmer) | Affirmer son point de vue est différent de juger |
| Pas de génération phrase-par-phrase | Génération incrémentale | La longueur dépend du contexte, mieux géré par prompt |
| Pas d'humour noir/moqueur, légèreté bienveillante | Humour comme stratégie | Trop risqué pour de l'IA, le sourire malicieux suffit |
| Panel ne se ferme PAS au clic extérieur | Fermeture au clic extérieur | L'utilisateur perdait son commentaire par accident |
| Principe "pas de passé" vs liste de formulations | Liste exhaustive de formulations | Claude contourne les listes, le principe est plus robuste |
| Interdits formatage dans system + user prompt | Seulement dans system prompt | Claude ne respectait pas les interdits du system prompt seul |
| Ton bienveillant même face à un post provoc | Reproduire le ton du post | Le commentaire ne doit jamais rabaisser, même si le post le fait |

## UI Panel

### Structure

Le panel est un Shadow DOM attaché à un div `.postpilot-panel-host`, inséré en fin de post card.

### Layout

1. Header (titre + bouton fermeture X)
2. Options (deux lignes de toggles pills)
   - Registre (Tutoiement / Vouvoiement / **Neutre**)
   - Expression (Je / Tu-Vous / **Neutre**)
3. Label "Approche"
4. Grille 4 colonnes x 2 rangées (8 approches, chacune avec emoji + label + description)
5. Zone résultat (loading spinner / commentaire + boutons Insérer/Régénérer / erreur + Réessayer)

### Comportements

- Un seul panel actif à la fois. Ouvrir un nouveau panel ferme l'ancien
- Le panel ne se ferme QUE via le bouton X (pas au clic extérieur)
- Cliquer une approche lance la génération immédiatement
- Après génération, la grille d'approches réapparaît pour permettre de changer d'approche
- Régénérer relance avec les mêmes paramètres (approche + registre + expression)
- Les toggles registre/expression peuvent être changés entre deux générations
