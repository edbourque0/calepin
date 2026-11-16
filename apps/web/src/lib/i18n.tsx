import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { storage } from "./utils";

const fr = {
  "app.tagline": "Vos notes, documents et bases de données, chez vous.",
  "auth.signIn": "Se connecter",
  "auth.signUp": "Créer un compte",
  "auth.name": "Nom",
  "auth.email": "Courriel",
  "auth.password": "Mot de passe",
  "auth.noAccount": "Pas encore de compte ?",
  "auth.haveAccount": "Déjà un compte ?",
  "auth.continueWith": "Continuer avec {name}",
  "auth.or": "ou",
  "auth.error": "Impossible de se connecter. Vérifiez vos informations.",
  "auth.signOut": "Se déconnecter",
  "nav.search": "Rechercher",
  "nav.home": "Accueil",
  "nav.pages": "Pages",
  "nav.trash": "Corbeille",
  "nav.settings": "Paramètres",
  "nav.newPage": "Créer une page",
  "nav.addSubpage": "Ajouter une sous-page",
  "nav.delete": "Supprimer",
  "nav.collapse": "Réduire la barre latérale",
  "nav.menu": "Menu",
  "page.untitled": "Sans titre",
  "page.titlePlaceholder": "Sans titre",
  "page.addIcon": "Ajouter une icône",
  "page.removeIcon": "Retirer",
  "page.notFound": "Cette page n'existe pas ou a été supprimée.",
  "page.backHome": "Retour à l'accueil",
  "page.editorPlaceholder": "Écrivez, ou tapez « / » pour les commandes…",
  "status.saved": "Enregistré",
  "status.savedDetail": "Enregistré sur votre serveur",
  "status.saving": "Enregistrement…",
  "status.offline": "Hors ligne",
  "status.offlineDetail": "Hors ligne — modifications gardées sur cet appareil",
  "status.connecting": "Connexion au serveur…",
  "status.readOnly": "Lecture seule",
  "home.greeting.morning": "Bonjour",
  "home.greeting.afternoon": "Bon après-midi",
  "home.greeting.evening": "Bonsoir",
  "home.recent": "Récemment modifiées",
  "home.empty": "Aucune page pour l'instant.",
  "home.emptyHint": "Créez votre première page pour commencer.",
  "home.pages": "Pages",
  "home.thisWeek": "Modifiées cette semaine",
  "home.today": "Modifiées aujourd'hui",
  "search.placeholder": "Rechercher des pages…",
  "search.empty": "Aucun résultat.",
  "search.recent": "Récentes",
  "search.results": "Résultats",
  "search.create": "Créer « {q} »",
  "trash.title": "Corbeille",
  "trash.empty":
    "La corbeille est vide. Les pages supprimées restent ici jusqu'à ce que vous les supprimiez définitivement.",
  "trash.restore": "Restaurer",
  "trash.deleteForever": "Supprimer définitivement",
  "trash.confirm": "Supprimer définitivement cette page et ses sous-pages ?",
  "settings.title": "Paramètres",
  "settings.theme": "Thème",
  "settings.dark": "Sombre",
  "settings.system": "Système",
  "settings.light": "Clair",
  "settings.language": "Langue",
  "settings.workspace": "Nom de l'espace",
  "time.justNow": "à l'instant",
  "time.minutes": "il y a {n} min",
  "time.hours": "il y a {n} h",
  "time.days": "il y a {n} j",
  "nav.shared": "Partagé avec moi",
  "ws.switch": "Changer d'espace",
  "ws.create": "Créer un espace",
  "ws.namePlaceholder": "Nom de l'espace",
  "ws.createSubmit": "Créer",
  "share.button": "Partager",
  "share.invitePlaceholder": "Ajouter des personnes par courriel",
  "share.invite": "Inviter",
  "share.workspaceAccess": "Tous les membres de {name}",
  "share.members": "{n} membres",
  "share.canEdit": "Peut modifier",
  "share.canView": "Peut lire",
  "share.remove": "Retirer l'accès",
  "share.via": "Via « {page} »",
  "share.pending": "Invitation en attente",
  "share.inviteLink": "Lien d'invitation créé. Envoyez-le à la personne :",
  "share.copy": "Copier le lien",
  "share.copied": "Lien copié",
  "share.alreadyMember": "Cette personne est déjà membre de l'espace.",
  "share.shared": "Accès accordé.",
  "share.private": "Seulement les personnes invitées",
  "share.privateHint": "Activez pour partager une page publique en lecture seule",
  "share.public": "Publiée sur le web",
  "share.publicHint": "Toute personne ayant le lien peut la consulter",
  "share.readOnlyNote": "Seuls les membres de l'espace qui peuvent modifier gèrent le partage.",
  "share.linkOnly": "Créer un lien sans courriel",
  "settings.tabGeneral": "Général",
  "settings.tabWorkspace": "Espace",
  "settings.tabTokens": "Jetons API",
  "members.title": "Membres",
  "members.invitePlaceholder": "Courriel (facultatif)",
  "members.owner": "Propriétaire",
  "members.editor": "Modification",
  "members.viewer": "Lecture",
  "members.leave": "Quitter l'espace",
  "members.remove": "Retirer de l'espace",
  "members.you": "vous",
  "members.added": "Ajouté à l'espace.",
  "members.pending": "Invitations en attente",
  "members.revoke": "Annuler l'invitation",
  "tokens.intro":
    "Les jetons permettent à des outils (n8n, scripts, assistants IA via MCP) d'agir en votre nom, avec vos accès.",
  "tokens.namePlaceholder": "Nom du jeton, ex. Claude",
  "tokens.create": "Créer un jeton",
  "tokens.copyNow": "Copiez ce jeton maintenant : il ne sera plus affiché.",
  "tokens.empty": "Aucun jeton pour l'instant.",
  "tokens.revoke": "Révoquer",
  "tokens.lastUsed": "Utilisé {when}",
  "tokens.never": "Jamais utilisé",
  "tokens.mcp": "Serveur MCP",
  "tokens.mcpHint": "Ajoutez cette adresse à votre client MCP avec l'en-tête Authorization: Bearer suivi du jeton.",
  "invite.titleWorkspace": "{inviter} vous invite à rejoindre {workspace}",
  "invite.titlePage": "{inviter} a partagé « {page} » avec vous",
  "invite.someone": "Quelqu'un",
  "invite.accept": "Accepter l'invitation",
  "invite.signInFirst": "Connectez-vous ou créez un compte pour accepter.",
  "invite.invalid": "Cette invitation n'est plus valide.",
  "invite.asRole": "Accès : {role}",
  "common.cancel": "Annuler",
  "common.copy": "Copier",
  "common.copied": "Copié",
};

type Key = keyof typeof fr;

const en: Record<Key, string> = {
  "app.tagline": "Your notes, docs and databases, at home.",
  "auth.signIn": "Sign in",
  "auth.signUp": "Create account",
  "auth.name": "Name",
  "auth.email": "Email",
  "auth.password": "Password",
  "auth.noAccount": "No account yet?",
  "auth.haveAccount": "Already have an account?",
  "auth.continueWith": "Continue with {name}",
  "auth.or": "or",
  "auth.error": "Could not sign in. Check your details.",
  "auth.signOut": "Sign out",
  "nav.search": "Search",
  "nav.home": "Home",
  "nav.pages": "Pages",
  "nav.trash": "Trash",
  "nav.settings": "Settings",
  "nav.newPage": "Create page",
  "nav.addSubpage": "Add a subpage",
  "nav.delete": "Delete",
  "nav.collapse": "Collapse sidebar",
  "nav.menu": "Menu",
  "page.untitled": "Untitled",
  "page.titlePlaceholder": "Untitled",
  "page.addIcon": "Add icon",
  "page.removeIcon": "Remove",
  "page.notFound": "This page doesn't exist or was deleted.",
  "page.backHome": "Back home",
  "page.editorPlaceholder": "Write, or type “/” for commands…",
  "status.saved": "Saved",
  "status.savedDetail": "Saved to your server",
  "status.saving": "Saving…",
  "status.offline": "Offline",
  "status.offlineDetail": "Offline — changes kept on this device",
  "status.connecting": "Connecting to your server…",
  "status.readOnly": "Read only",
  "home.greeting.morning": "Good morning",
  "home.greeting.afternoon": "Good afternoon",
  "home.greeting.evening": "Good evening",
  "home.recent": "Recently edited",
  "home.empty": "No pages yet.",
  "home.emptyHint": "Create your first page to get started.",
  "home.pages": "Pages",
  "home.thisWeek": "Edited this week",
  "home.today": "Edited today",
  "search.placeholder": "Search pages…",
  "search.empty": "No results.",
  "search.recent": "Recent",
  "search.results": "Results",
  "search.create": "Create “{q}”",
  "trash.title": "Trash",
  "trash.empty": "Trash is empty. Deleted pages stay here until you delete them forever.",
  "trash.restore": "Restore",
  "trash.deleteForever": "Delete forever",
  "trash.confirm": "Permanently delete this page and its subpages?",
  "settings.title": "Settings",
  "settings.theme": "Theme",
  "settings.dark": "Dark",
  "settings.system": "System",
  "settings.light": "Light",
  "settings.language": "Language",
  "settings.workspace": "Workspace name",
  "time.justNow": "just now",
  "time.minutes": "{n} min ago",
  "time.hours": "{n} h ago",
  "time.days": "{n} d ago",
  "nav.shared": "Shared with me",
  "ws.switch": "Switch workspace",
  "ws.create": "Create workspace",
  "ws.namePlaceholder": "Workspace name",
  "ws.createSubmit": "Create",
  "share.button": "Share",
  "share.invitePlaceholder": "Add people by email",
  "share.invite": "Invite",
  "share.workspaceAccess": "Everyone in {name}",
  "share.members": "{n} members",
  "share.canEdit": "Can edit",
  "share.canView": "Can view",
  "share.remove": "Remove access",
  "share.via": "Via “{page}”",
  "share.pending": "Pending invitation",
  "share.inviteLink": "Invitation link created. Send it to them:",
  "share.copy": "Copy link",
  "share.copied": "Link copied",
  "share.alreadyMember": "This person is already a member of the workspace.",
  "share.shared": "Access granted.",
  "share.private": "Only people invited",
  "share.privateHint": "Turn on to share a public, read-only page",
  "share.public": "Published to the web",
  "share.publicHint": "Anyone with the link can view",
  "share.readOnlyNote": "Only workspace members who can edit manage sharing.",
  "share.linkOnly": "Create a link without email",
  "settings.tabGeneral": "General",
  "settings.tabWorkspace": "Workspace",
  "settings.tabTokens": "API tokens",
  "members.title": "Members",
  "members.invitePlaceholder": "Email (optional)",
  "members.owner": "Owner",
  "members.editor": "Editor",
  "members.viewer": "Viewer",
  "members.leave": "Leave workspace",
  "members.remove": "Remove from workspace",
  "members.you": "you",
  "members.added": "Added to the workspace.",
  "members.pending": "Pending invitations",
  "members.revoke": "Cancel invitation",
  "tokens.intro": "Tokens let tools (n8n, scripts, AI assistants over MCP) act as you, with your access.",
  "tokens.namePlaceholder": "Token name, e.g. Claude",
  "tokens.create": "Create token",
  "tokens.copyNow": "Copy this token now — it won't be shown again.",
  "tokens.empty": "No tokens yet.",
  "tokens.revoke": "Revoke",
  "tokens.lastUsed": "Used {when}",
  "tokens.never": "Never used",
  "tokens.mcp": "MCP server",
  "tokens.mcpHint": "Add this URL to your MCP client with the header Authorization: Bearer followed by the token.",
  "invite.titleWorkspace": "{inviter} invited you to join {workspace}",
  "invite.titlePage": "{inviter} shared “{page}” with you",
  "invite.someone": "Someone",
  "invite.accept": "Accept invitation",
  "invite.signInFirst": "Sign in or create an account to accept.",
  "invite.invalid": "This invitation is no longer valid.",
  "invite.asRole": "Access: {role}",
  "common.cancel": "Cancel",
  "common.copy": "Copy",
  "common.copied": "Copied",
};

export type Lang = "fr" | "en";
const dictionaries: Record<Lang, Record<Key, string>> = { fr, en };

const langStore = storage<Lang | null>("lang", null);

function detectLang(): Lang {
  return langStore.get() ?? (navigator.language.toLowerCase().startsWith("fr") ? "fr" : "en");
}

type I18n = { lang: Lang; setLang: (l: Lang) => void; t: (key: Key, vars?: Record<string, string | number>) => string };

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);

  const setLang = useCallback((l: Lang) => {
    langStore.set(l);
    document.documentElement.lang = l;
    setLangState(l);
  }, []);

  const t = useCallback(
    (key: Key, vars?: Record<string, string | number>) => {
      let s = dictionaries[lang][key] ?? key;
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
      return s;
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n outside provider");
  return ctx;
}

export function useRelativeTime() {
  const { t, lang } = useI18n();
  return (iso: string) => {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return t("time.justNow");
    if (diff < 3600) return t("time.minutes", { n: Math.floor(diff / 60) });
    if (diff < 86400) return t("time.hours", { n: Math.floor(diff / 3600) });
    if (diff < 86400 * 7) return t("time.days", { n: Math.floor(diff / 86400) });
    return new Date(iso).toLocaleDateString(lang === "fr" ? "fr-CA" : "en-CA", { day: "numeric", month: "short" });
  };
}
