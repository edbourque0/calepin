import { createReactBlockSpec } from "@blocknote/react";
import { Table2 } from "lucide-react";
import { DatabaseView } from "./DatabaseView";

/**
 * A database embedded in a page. The database itself is a child page; the block only points to it.
 * Must match the server schema (apps/server/src/lib/blocks.ts).
 */
export const DatabaseBlock = createReactBlockSpec(
  { type: "database", propSchema: { databaseId: { default: "" } }, content: "none" },
  {
    render: ({ block }) => (
      <div
        contentEditable={false}
        // Keep typing, pasting and drags inside the table from reaching the editor.
        onKeyDown={(e) => e.stopPropagation()}
        onPaste={(e) => e.stopPropagation()}
        onDrop={(e) => e.stopPropagation()}
        className="calepin-inline-db w-full py-2"
      >
        {block.props.databaseId ? (
          <DatabaseView databaseId={block.props.databaseId} inline />
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Table2 className="size-4" /> Database
          </div>
        )}
      </div>
    ),
  },
);
