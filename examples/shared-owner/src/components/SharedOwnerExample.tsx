import * as Evolu from "@evolu/common";
import { createEvoluBinding } from "@evolu/react";
import { EvoluIdenticon, createEvoluDeps } from "@evolu/react-web";
import { clsx } from "clsx";
import { Suspense, use, useEffect, useState, type FC } from "react";

const AppSchema = {
  note: {
    id: Evolu.id("Note"),
    text: Evolu.NonEmptyTrimmedString100,
  },
};

const createAppQuery = Evolu.createQueryBuilder(AppSchema);

const notesQuery = createAppQuery((db) =>
  db
    .selectFrom("note")
    .select(["id", "text", "ownerId"])
    .where("isDeleted", "is not", Evolu.sqliteTrue)
    .where("text", "is not", null)
    .where("ownerId", "is not", null)
    .$narrowType<{ text: Evolu.KyselyNotNull; ownerId: Evolu.KyselyNotNull }>()
    .orderBy("createdAt"),
);

type NoteRow = typeof notesQuery.Row;

const deps = createEvoluDeps({
  console: Evolu.createConsole({
    level: "debug",
    formatter: Evolu.createConsoleFormatter()({
      timestampFormat: "relative",
    }),
  }),
});

deps.evoluError.subscribe(() => {
  const error = deps.evoluError.get();
  if (!error) return;

  alert("Evolu error occurred. Check the console.");
});

const run = Evolu.createRun(deps);

const { EvoluContext, useEvolu, useQuery } = createEvoluBinding(AppSchema);

const STORAGE_KEY = "evolu-app-owner-mnemonic";

const getOrCreateAppOwner = (): Evolu.AppOwner => {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const result = Evolu.Mnemonic.from(stored);
    if (result.ok) {
      return Evolu.createAppOwner(Evolu.mnemonicToOwnerSecret(result.value));
    }
  }
  const secret = Evolu.OwnerSecret.orThrow(
    crypto.getRandomValues(new Uint8Array(32)),
  );
  const owner = Evolu.createAppOwner(secret);
  localStorage.setItem(STORAGE_KEY, owner.mnemonic);
  return owner;
};

const persistedAppOwner = getOrCreateAppOwner();

const parseNoteText = (value: string) =>
  Evolu.NonEmptyTrimmedString100.from(value.trim());

interface SharedSpace {
  owner: Evolu.SharedOwner;
  mnemonic: string;
}

export const SharedOwnerExample: FC = () => {
  const [sharedSpace, setSharedSpace] = useState<SharedSpace | null>(null);

  return (
    <div className="min-h-screen px-8 py-8">
      <div className="mx-auto max-w-md">
        <div className="mb-2 flex items-center justify-between pb-4">
          <h1 className="w-full text-center text-xl font-semibold text-gray-900">
            SharedOwner Example (Evolu + React + Vite + PWA)
          </h1>
        </div>
        <Suspense>
          <App sharedSpace={sharedSpace} setSharedSpace={setSharedSpace} />
        </Suspense>
      </div>
    </div>
  );
};

const appPromise = run.orThrow(
  Evolu.createEvolu(AppSchema, {
    appName: Evolu.AppName.orThrow("shared-owner-example"),
    appOwner: persistedAppOwner,
    transports: [
      Evolu.createOwnerWebSocketTransport({
        url: "wss://free.evoluhq.com",
        ownerId: persistedAppOwner.id,
      }),
    ],
  }),
);

const App: FC<{
  sharedSpace: SharedSpace | null;
  setSharedSpace: (space: SharedSpace | null) => void;
}> = ({ sharedSpace, setSharedSpace }) => (
  <EvoluContext value={use(appPromise)}>
    <SharedSpacePanel
      sharedSpace={sharedSpace}
      setSharedSpace={setSharedSpace}
    />
    <Notes sharedSpace={sharedSpace} />
    <OwnerActions />
  </EvoluContext>
);

const SharedSpacePanel: FC<{
  sharedSpace: SharedSpace | null;
  setSharedSpace: (space: SharedSpace | null) => void;
}> = ({ sharedSpace, setSharedSpace }) => {
  const evolu = useEvolu();
  const [mnemonicInput, setMnemonicInput] = useState("");
  const [showMnemonic, setShowMnemonic] = useState(false);

  useEffect(() => {
    if (!sharedSpace) return;
    const unuseOwner = evolu.useOwner(sharedSpace.owner, [
      Evolu.createOwnerWebSocketTransport({
        url: "wss://free.evoluhq.com",
        ownerId: sharedSpace.owner.id,
      }),
    ]);
    return unuseOwner;
  }, [evolu, sharedSpace]);

  const handleJoin = () => {
    const result = Evolu.Mnemonic.from(mnemonicInput.trim());
    if (!result.ok) {
      alert("Invalid mnemonic. Please enter 24 words separated by spaces.");
      return;
    }
    const secret = Evolu.mnemonicToOwnerSecret(result.value);
    const owner = Evolu.createSharedOwner(secret);
    setSharedSpace({ owner, mnemonic: result.value });
    setMnemonicInput("");
    setShowMnemonic(false);
  };

  const handleCreate = () => {
    const secret = Evolu.OwnerSecret.orThrow(
      crypto.getRandomValues(new Uint8Array(32)),
    );
    const mnemonic = Evolu.ownerSecretToMnemonic(secret);
    const owner = Evolu.createSharedOwner(secret);
    setSharedSpace({ owner, mnemonic });
    setShowMnemonic(true);
  };

  const handleLeave = () => {
    setSharedSpace(null);
    setShowMnemonic(false);
  };

  return (
    <div className="rounded-lg bg-white p-6 shadow-sm ring-1 ring-gray-200">
      <h2 className="mb-4 text-lg font-medium text-gray-900">Shared Space</h2>

      {sharedSpace ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <EvoluIdenticon id={sharedSpace.owner.id} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900">Connected</p>
              <p className="truncate font-mono text-xs text-gray-500">
                {sharedSpace.owner.id}
              </p>
            </div>
            <Button title="Leave" onClick={handleLeave} />
          </div>

          <p className="text-sm text-gray-600">
            Share this mnemonic so others can join the same space and
            collaborate in real time:
          </p>

          <Button
            title={showMnemonic ? "Hide Mnemonic" : "Show Mnemonic"}
            onClick={() => {
              setShowMnemonic((v) => !v);
            }}
            className="w-full"
          />

          {showMnemonic && (
            <textarea
              value={sharedSpace.mnemonic}
              readOnly
              rows={3}
              className="w-full rounded border border-gray-300 bg-gray-50 px-2 py-1 font-mono text-xs focus:outline-none"
            />
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            A shared space is identified by a 24-word BIP-39 mnemonic. Every
            user who enters the same mnemonic gets a{" "}
            <strong>SharedOwner</strong> with matching keys — allowing
            end-to-end encrypted collaborative writes.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={mnemonicInput}
              onChange={(e) => {
                setMnemonicInput(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleJoin();
              }}
              placeholder="Enter mnemonic (24 words)…"
              className="block w-full rounded-md bg-white px-3 py-1.5 text-sm text-gray-900 outline-1 -outline-offset-1 outline-gray-300 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600"
            />
            <Button title="Join" onClick={handleJoin} variant="primary" />
          </div>
          <Button
            title="Create new shared space"
            onClick={handleCreate}
            className="w-full"
          />
        </div>
      )}
    </div>
  );
};

const Notes: FC<{ sharedSpace: SharedSpace | null }> = ({ sharedSpace }) => {
  const { insert, appOwner } = useEvolu();
  const notes = useQuery(notesQuery);
  const [newText, setNewText] = useState("");

  const personalNotes = notes.filter((n) => n.ownerId === appOwner.id);
  const sharedNotes = sharedSpace
    ? notes.filter((n) => n.ownerId === sharedSpace.owner.id)
    : [];

  const addNote = (ownerId?: Evolu.OwnerId) => {
    const result = parseNoteText(newText);
    if (!result.ok) {
      alert(formatTypeError(result.error));
      return;
    }
    insert(
      "note",
      { text: result.value },
      {
        ownerId,
        onComplete: () => {
          setNewText("");
        },
      },
    );
  };

  return (
    <div className="mt-8 rounded-lg bg-white p-6 shadow-sm ring-1 ring-gray-200">
      <h2 className="mb-4 text-lg font-medium text-gray-900">Notes</h2>

      <div className="space-y-6">
        <section>
          <h3 className="mb-2 text-sm font-medium uppercase tracking-wide text-gray-500">
            Personal
          </h3>
          <NoteList notes={personalNotes} />
        </section>

        {sharedSpace && (
          <section>
            <h3 className="mb-2 text-sm font-medium uppercase tracking-wide text-indigo-600">
              Shared Space
            </h3>
            <NoteList notes={sharedNotes} />
          </section>
        )}
      </div>

      <div className="mt-6 space-y-2">
        <input
          type="text"
          value={newText}
          onChange={(e) => {
            setNewText(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") addNote();
          }}
          placeholder="Note text…"
          className="block w-full rounded-md bg-white px-3 py-1.5 text-sm text-gray-900 outline-1 -outline-offset-1 outline-gray-300 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600"
        />
        <div className="flex gap-2">
          <Button
            title="Add Personal"
            onClick={() => {
              addNote();
            }}
            className="flex-1"
          />
          {sharedSpace && (
            <Button
              title="Add to Shared"
              onClick={() => {
                addNote(sharedSpace.owner.id);
              }}
              variant="primary"
              className="flex-1"
            />
          )}
        </div>
      </div>
    </div>
  );
};

const NoteList: FC<{ notes: NoteRow[] }> = ({ notes }) => {
  const { update } = useEvolu();

  if (notes.length === 0) {
    return <p className="text-sm italic text-gray-400">No notes yet.</p>;
  }

  return (
    <ul className="space-y-1">
      {notes.map((note) => (
        <li
          key={note.id}
          className="-mx-2 flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-gray-50"
        >
          <span className="text-sm text-gray-900">{note.text}</span>
          <button
            onClick={() => {
              update("note", { id: note.id, isDeleted: Evolu.sqliteTrue });
            }}
            className="shrink-0 text-xs text-gray-400 transition-colors hover:text-red-500"
          >
            Delete
          </button>
        </li>
      ))}
    </ul>
  );
};

const OwnerActions: FC = () => {
  const evolu = useEvolu();
  const [showMnemonic, setShowMnemonic] = useState(false);

  const handleRestoreClick = () => {
    const input = window.prompt(
      "Enter your mnemonic to restore your identity:",
    );
    if (input == null) return;

    const result = Evolu.Mnemonic.from(input.trim());
    if (!result.ok) {
      alert("Invalid mnemonic. Please enter 24 words separated by spaces.");
      return;
    }

    localStorage.setItem(STORAGE_KEY, result.value);
    window.location.reload();
  };

  const handleResetClick = () => {
    if (
      !confirm(
        "Are you sure? A new identity will be created and you will lose access to your personal notes unless you have saved the mnemonic.",
      )
    )
      return;

    localStorage.removeItem(STORAGE_KEY);
    window.location.reload();
  };

  const handleDownloadClick = () => {
    void evolu.exportDatabase().then((data: Uint8Array<ArrayBuffer>) => {
      const objectUrl = URL.createObjectURL(
        new Blob([data], { type: "application/x-sqlite3" }),
      );
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `${evolu.name}.sqlite3`;
      link.click();
      setTimeout(() => {
        URL.revokeObjectURL(objectUrl);
      }, 1000);
    });
  };

  return (
    <div className="mt-8 rounded-lg bg-white p-6 shadow-sm ring-1 ring-gray-200">
      <h2 className="mb-4 text-lg font-medium text-gray-900">
        Personal Account
      </h2>
      <div className="mb-4 flex items-center gap-3">
        <EvoluIdenticon id={evolu.appOwner.id} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900">Your identity</p>
          <p className="truncate font-mono text-xs text-gray-500">
            {evolu.appOwner.id}
          </p>
        </div>
      </div>
      <p className="mb-4 text-sm text-gray-600">
        Personal notes are end-to-end encrypted and synced via the Evolu relay.
        Copy the mnemonic to access your notes on another device.
      </p>

      <div className="space-y-3">
        <Button
          title={showMnemonic ? "Hide Mnemonic" : "Show Mnemonic"}
          onClick={() => {
            setShowMnemonic((v) => !v);
          }}
          className="w-full"
        />

        {showMnemonic && (
          <div className="bg-gray-50 p-3">
            <label className="mb-2 block text-xs font-medium text-gray-700">
              Your Mnemonic (keep this safe!)
            </label>
            <textarea
              value={evolu.appOwner.mnemonic}
              readOnly
              rows={3}
              className="w-full border-b border-gray-300 bg-white px-2 py-1 font-mono text-xs focus:border-blue-500 focus:outline-none"
            />
          </div>
        )}

        <div className="flex gap-2">
          <Button title="Restore from Mnemonic" onClick={handleRestoreClick} />
          <Button title="Reset Identity" onClick={handleResetClick} />
          <Button title="Download Backup" onClick={handleDownloadClick} />
        </div>
      </div>
    </div>
  );
};

const Button: FC<{
  title: string;
  className?: string;
  onClick: () => void;
  variant?: "primary" | "secondary";
}> = ({ title, className, onClick, variant = "secondary" }) => {
  const baseClasses =
    "px-3 py-2 text-sm font-medium rounded-lg transition-colors";
  const variantClasses =
    variant === "primary"
      ? "bg-blue-600 text-white hover:bg-blue-700"
      : "bg-gray-100 text-gray-700 hover:bg-gray-200";

  return (
    <button
      className={clsx(baseClasses, variantClasses, className)}
      onClick={onClick}
    >
      {title}
    </button>
  );
};

const formatTypeError = Evolu.createFormatTypeError<
  Evolu.MinLengthError | Evolu.MaxLengthError
>((error): string => {
  switch (error.type) {
    case "MinLength":
      return `Text must be at least ${error.min} character${error.min === 1 ? "" : "s"} long`;
    case "MaxLength":
      return `Text is too long (maximum ${error.max} characters)`;
  }
});
