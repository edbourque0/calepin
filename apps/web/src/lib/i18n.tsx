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
  "trash.empty": "La corbeille est vide. Les pages supprimées restent ici jusqu'à ce que vous les supprimiez définitivement.",
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
