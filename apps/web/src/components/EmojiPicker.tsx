const EMOJIS = (
  "📝 📄 📓 📒 📚 🗂️ 📁 📌 📎 🔖 ✅ ☑️ 📋 🗒️ 📅 🗓️ ⏰ 🎯 🚀 💡 🧠 🔍 🧪 🛠️ ⚙️ 🔧 💻 🖥️ 📱 🗄️ " +
  "🏠 🏡 🛋️ 🍳 🛒 💰 💳 📈 📊 🧾 ✈️ 🧳 🗺️ 🏔️ 🏖️ 🚗 🚲 ⛳ 🏃 🎮 🎬 🎵 📷 🎨 ✏️ 🖋️ 🌱 🌲 🌸 ☀️ " +
  "❄️ 🔥 ⭐ 💬 📣 ❤️ 🧡 💛 💚 💙 💜 🐝 🐶 🐱 🍁 ☕ 🍷 🎉 🎁 🏆 🔒 🔑 🧩 🪴"
).split(" ");

export function EmojiPicker({ onPick, onRemove, removeLabel }: { onPick: (e: string) => void; onRemove?: () => void; removeLabel: string }) {
  return (
    <div className="w-[300px]">
      <div className="grid grid-cols-10 gap-0.5 p-1">
        {EMOJIS.map((e) => (
          <button
            key={e}
            onClick={() => onPick(e)}
            className="flex size-7 items-center justify-center rounded-md text-lg transition-colors hover:bg-accent"
          >
            {e}
          </button>
        ))}
      </div>
      {onRemove && (
        <div className="mt-1 border-t border-border px-1 pt-1.5">
          <button onClick={onRemove} className="w-full rounded-md px-2 py-1 text-left text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground">
            {removeLabel}
          </button>
        </div>
      )}
    </div>
  );
}
