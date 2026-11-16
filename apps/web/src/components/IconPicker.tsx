import { Search, Shuffle } from "lucide-react";
import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { ICON_COLORS, type IconColor, iconColorVar, lucideIcon, parseIcon, useIconSet, words } from "@/lib/icons";
import { cn, storage } from "@/lib/utils";
import { LucideGlyph } from "./PageIcon";
import { Spinner, Tabs } from "./ui";

/** Shown before searching: common picks for notes, projects, home and work. */
const SUGGESTED = (
  "FileText Notebook NotebookPen BookOpen Book Library Bookmark StickyNote Clipboard ClipboardList ListTodo " +
  "ListChecks CircleCheck SquareCheck Calendar CalendarDays Clock AlarmClock Timer Flag Target Rocket Lightbulb " +
  "Brain Sparkles Star Heart Zap Flame Trophy Award Gift PartyPopper Folder FolderOpen Archive Inbox Mail Send " +
  "MessageSquare MessagesSquare Users User UserRound Contact Briefcase Building Building2 Landmark Store " +
  "Home House Sofa Bed CookingPot Utensils Coffee Wine ShoppingCart ShoppingBag Wallet CreditCard PiggyBank " +
  "Receipt Banknote ChartLine ChartBar ChartPie TrendingUp Calculator Plane Car Bike Train Map MapPin Compass " +
  "Mountain TreePine Leaf Sprout Flower Sun Moon Cloud Snowflake Umbrella Dog Cat Bird Fish Bug " +
  "Code Terminal Braces Database Server HardDrive Cpu Monitor Laptop Smartphone Wifi Router Network Globe " +
  "Cog Wrench Hammer Settings Shield ShieldCheck Lock Key Fingerprint Camera Image Film Music Headphones " +
  "Gamepad2 Palette Brush PenTool Pencil Scissors Ruler Puzzle Dumbbell HeartPulse Stethoscope Pill Baby " +
  "GraduationCap School FlaskConical Microscope Atom Dna Telescope Newspaper Megaphone Bell Tag Tags Hash " +
  "Link Paperclip Layers LayoutGrid Kanban Table2 Workflow GitBranch Package Box Truck Anchor Ship Printer"
).split(" ");

const EMOJIS = (
  "📝 📄 📓 📒 📔 📕 📗 📘 📙 📚 🗂️ 📁 📂 📌 📍 📎 🔖 🏷️ ✅ ☑️ 📋 🗒️ 🗓️ 📅 ⏰ ⏳ 🎯 🚀 💡 🧠 🔍 🧪 🔬 🔭 🛠️ ⚙️ 🔧 🔨 🧰 " +
  "💻 🖥️ ⌨️ 📱 🗄️ 💾 🧮 📈 📉 📊 💰 💵 💳 🧾 🏦 🏠 🏡 🏢 🏗️ 🛋️ 🛏️ 🍳 🍽️ 🛒 🧺 ✈️ 🧳 🗺️ 🧭 🏔️ 🏕️ 🏖️ 🚗 🚲 🚆 ⛵ " +
  "⛳ 🏃 🏋️ 🧘 🚴 ⚽ 🏒 🎾 🎮 🎲 🧩 🎬 🎵 🎧 🎸 📷 🎨 ✏️ 🖋️ 🖌️ 📐 🌱 🌿 🌲 🌳 🍁 🌸 🌻 🌵 ☀️ 🌙 ⭐ ❄️ 🌧️ 🔥 💧 🌈 " +
  "☕ 🍵 🍷 🍺 🍕 🍎 🥑 🧁 🎉 🎁 🎂 🏆 🥇 🔒 🔑 🛡️ 💬 📣 📢 🔔 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🐝 🐶 🐱 🦊 🐻 🐼 🦉 🐢 🐟 🦋 " +
  "👶 👪 👥 🙂 😎 🤖 👻 💼 🎓 🏥 💊 🩺 ⚖️ 📦 🚚 🧱 🔌 🔋 💎 🧲 ♻️ 🌍 🇨🇦 ⚜️"
).split(" ");

/** French words → English terms used in Lucide names, so French searches find icons too. */
const FR: Record<string, string> = {
  maison: "house home",
  argent: "wallet coins banknote piggy",
  voyage: "plane luggage map",
  avion: "plane",
  voiture: "car",
  velo: "bike",
  vélo: "bike",
  livre: "book",
  note: "notebook sticky",
  notes: "notebook sticky",
  calendrier: "calendar",
  horloge: "clock",
  tache: "list check",
  tâche: "list check",
  projet: "folder briefcase kanban",
  travail: "briefcase building",
  ecole: "school graduation",
  école: "school graduation",
  sante: "heart pulse stethoscope pill",
  santé: "heart pulse stethoscope pill",
  sport: "dumbbell bike trophy",
  musique: "music headphones",
  photo: "camera image",
  cuisine: "cooking utensils chef",
  recette: "cooking utensils chef",
  cafe: "coffee",
  café: "coffee",
  vin: "wine",
  courses: "shopping cart basket",
  achat: "shopping cart bag",
  idee: "lightbulb sparkles",
  idée: "lightbulb sparkles",
  etoile: "star",
  étoile: "star",
  coeur: "heart",
  cœur: "heart",
  feu: "flame",
  soleil: "sun",
  lune: "moon",
  nuage: "cloud",
  neige: "snowflake",
  arbre: "tree",
  fleur: "flower",
  feuille: "leaf",
  chien: "dog",
  chat: "cat",
  oiseau: "bird",
  poisson: "fish",
  serveur: "server",
  reseau: "network wifi router",
  réseau: "network wifi router",
  code: "code terminal braces",
  outil: "wrench hammer tool",
  outils: "wrench hammer tool",
  reglages: "settings cog",
  réglages: "settings cog",
  securite: "shield lock key",
  sécurité: "shield lock key",
  cle: "key",
  clé: "key",
  courriel: "mail inbox",
  message: "message",
  personne: "user",
  equipe: "users",
  équipe: "users",
  famille: "users baby",
  bebe: "baby",
  bébé: "baby",
  carte: "map credit",
  graphique: "chart",
  budget: "wallet piggy calculator receipt",
  facture: "receipt",
  banque: "landmark banknote",
  jeu: "gamepad puzzle dice",
  film: "film clapperboard",
  art: "palette brush",
  science: "flask atom microscope",
  journal: "newspaper notebook",
  drapeau: "flag",
  cible: "target",
  fusee: "rocket",
  fusée: "rocket",
  cadeau: "gift",
  fete: "party",
  fête: "party",
  trophee: "trophy",
  trophée: "trophy",
  dossier: "folder",
  archive: "archive",
  lien: "link",
  image: "image",
  video: "video film",
  vidéo: "video film",
  telephone: "smartphone phone",
  téléphone: "smartphone phone",
  ordinateur: "laptop monitor",
  imprimante: "printer",
  camion: "truck",
  bateau: "ship sailboat",
  montagne: "mountain",
  plage: "palmtree umbrella sun",
  lit: "bed",
  canape: "sofa",
  canapé: "sofa",
  jardin: "sprout flower shovel",
};

const recentStore = storage<string[]>("recentIcons", []);
const remember = (icon: string) => recentStore.set([icon, ...recentStore.get().filter((i) => i !== icon)].slice(0, 20));

export function IconPicker({
  value,
  onPick,
  onRemove,
}: {
  value?: string | null;
  onPick: (icon: string) => void;
  onRemove?: () => void;
}) {
  const { t } = useI18n();
  const current = parseIcon(value);
  const [tab, setTab] = useState<"icons" | "emoji">(current?.kind === "emoji" ? "emoji" : "icons");
  const [query, setQuery] = useState("");
  const [color, setColor] = useState<IconColor>(current?.kind === "lucide" ? current.color : "default");
  const icons = useIconSet();
  const recent = useMemo(() => recentStore.get(), []);

  // The set lists aliases under several names: show each drawing once.
  const names = useMemo(() => {
    if (!icons) return [];
    const seen = new Set<unknown>();
    return Object.keys(icons).filter((n) => !seen.has(icons[n]) && seen.add(icons[n]));
  }, [icons]);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SUGGESTED.filter((n) => !icons || icons[n]);
    const terms = q.split(/\s+/);
    // Each typed word matches its own spelling or any English synonym.
    const alternatives = terms.map((term) => [term, ...(FR[term]?.split(" ") ?? [])]);
    return names
      .filter((n) => {
        const w = words(n);
        return alternatives.every((alts) => alts.some((a) => w.includes(a)));
      })
      .sort(
        (a, b) =>
          Number(!words(a).startsWith(terms[0]!)) - Number(!words(b).startsWith(terms[0]!)) || a.length - b.length,
      )
      .slice(0, 400);
  }, [query, names, icons]);

  const choose = (icon: string) => {
    remember(icon);
    onPick(icon);
  };

  return (
    <div className="flex w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-2 p-1">
      <div className="flex items-center justify-between gap-2">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: "icons", label: t("icon.icons") },
            { value: "emoji", label: t("icon.emoji") },
          ]}
        />
        <div className="flex items-center gap-0.5">
          {tab === "icons" && names.length > 0 && (
            <button
              title={t("icon.random")}
              aria-label={t("icon.random")}
              onClick={() => choose(lucideIcon(names[Math.floor(Math.random() * names.length)]!, color))}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Shuffle className="size-3.5" />
            </button>
          )}
          {onRemove && (
            <button
              onClick={onRemove}
              className="h-7 rounded-md px-2 text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {t("page.removeIcon")}
            </button>
          )}
        </div>
      </div>

      {tab === "icons" ? (
        <>
          <div className="flex items-center gap-2">
            <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-background px-2 shadow-xs">
              <Search className="size-3.5 shrink-0 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("icon.search", { n: names.length || "1700" })}
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </label>
          </div>
          <div className="flex items-center gap-1" role="radiogroup" aria-label={t("icon.color")}>
            {ICON_COLORS.map((c) => (
              <button
                key={c}
                role="radio"
                aria-checked={color === c}
                aria-label={c}
                title={c}
                onClick={() => setColor(c)}
                className={cn(
                  "flex size-6 items-center justify-center rounded-full border-2 transition-transform",
                  color === c ? "scale-110 border-ring" : "border-transparent hover:scale-110",
                )}
              >
                <span
                  className="size-4 rounded-full"
                  style={{ background: iconColorVar(c) ?? "var(--foreground)", opacity: c === "default" ? 0.8 : 1 }}
                />
              </button>
            ))}
          </div>
          <div className="max-h-72 overflow-y-auto">
            {!icons ? (
              <div className="flex justify-center py-8">
                <Spinner />
              </div>
            ) : (
              <>
                {!query && recent.some((r) => parseIcon(r)?.kind === "lucide") && (
                  <>
                    <div className="caps-label px-1 pb-1">{t("icon.recent")}</div>
                    <IconGrid
                      names={recent
                        .map((r) => parseIcon(r))
                        .flatMap((p) => (p?.kind === "lucide" && icons[p.name] ? [p.name] : []))
                        .filter((n, i, a) => a.indexOf(n) === i)}
                      color={color}
                      selected={current?.kind === "lucide" ? current.name : undefined}
                      onPick={(n) => choose(lucideIcon(n, color))}
                    />
                    <div className="caps-label px-1 pt-2 pb-1">{t("icon.suggested")}</div>
                  </>
                )}
                {results.length ? (
                  <IconGrid
                    names={results}
                    color={color}
                    selected={current?.kind === "lucide" ? current.name : undefined}
                    onPick={(n) => choose(lucideIcon(n, color))}
                  />
                ) : (
                  <div className="py-8 text-center text-sm text-muted-foreground">{t("icon.none")}</div>
                )}
              </>
            )}
          </div>
        </>
      ) : (
        <div className="grid max-h-80 grid-cols-10 gap-0.5 overflow-y-auto">
          {EMOJIS.map((e) => (
            <button
              key={e}
              onClick={() => choose(e)}
              className={cn(
                "flex size-8 items-center justify-center rounded-md text-lg transition-colors hover:bg-accent",
                current?.kind === "emoji" && current.value === e && "bg-accent",
              )}
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function IconGrid({
  names,
  color,
  selected,
  onPick,
}: {
  names: string[];
  color: IconColor;
  selected?: string;
  onPick: (name: string) => void;
}) {
  return (
    <div className="grid grid-cols-10 gap-0.5">
      {names.map((n) => (
        <button
          key={n}
          title={words(n)}
          aria-label={words(n)}
          onClick={() => onPick(n)}
          className={cn(
            "flex size-8 items-center justify-center rounded-md transition-colors hover:bg-accent",
            selected === n && "bg-accent",
          )}
        >
          <LucideGlyph
            name={n}
            size={18}
            color={iconColorVar(color)}
            className={color === "default" ? "text-foreground/80" : undefined}
          />
        </button>
      ))}
    </div>
  );
}
