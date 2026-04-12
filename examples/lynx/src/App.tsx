import { Suspense, useEffect, useMemo, useState, type FC } from "@lynx-js/react";
import * as Evolu from "@evolu/common";
import {
  type EvoluFiber,
  createEvoluFiber,
  EvoluContext,
  formatTypeError,
  parseTodoTitle,
  useEvolu,
  useQuery,
} from "./db/evolu.js";
import { type TodoId, todosQuery } from "./db/schema.js";
import "./App.css";

export function App() {
  const [fiber] = useState<EvoluFiber>(() => createEvoluFiber());
  const [evolu, setEvolu] = useState<Awaited<EvoluFiber> | null>(null);

  useEffect(() => {
    let isDisposed = false;

    void fiber.then((value) => {
      if (!isDisposed) setEvolu(value);
    });

    return () => {
      isDisposed = true;
    };
  }, [fiber]);

  return (
    <page className="Page">
      <scroll-view className="Scroll" scroll-orientation="vertical">
        <view className="Wrapper">
          <view className="Header">
            <text className="Title">Evolu + ReactLynx</text>
            <text className="Subtitle">
              Minimal local-first todo example using @evolu/lynx.
            </text>
          </view>

          <Suspense fallback={<text className="Loading">Loading Evolu...</text>}>
            {evolu ? <BoundApp evolu={evolu} /> : <text className="Loading">Loading Evolu...</text>}
          </Suspense>
        </view>
      </scroll-view>
    </page>
  );
}

const BoundApp: FC<{ evolu: Awaited<EvoluFiber> }> = ({ evolu }) => (
  <EvoluContext.Provider value={evolu}>
    <Todos />
    <OwnerInfo />
  </EvoluContext.Provider>
);

const Todos: FC = () => {
  const todos = useQuery(todosQuery);
  const { insert, update } = useEvolu();

  const [newTodoTitle, setNewTodoTitle] = useState("");
  const [newTodoInputKey, setNewTodoInputKey] = useState(0);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<TodoId | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingInputKey, setEditingInputKey] = useState(0);

  const todoCountLabel = useMemo(
    () => `${todos.length} todo${todos.length === 1 ? "" : "s"}`,
    [todos.length],
  );

  const handleAddTodo = () => {
    const parsed = parseTodoTitle(newTodoTitle);
    if (!parsed.ok) {
      setValidationMessage(formatTypeError(parsed.error));
      return;
    }

    insert("todo", { title: parsed.value });
    setNewTodoTitle("");
    setNewTodoInputKey((value) => value + 1);
    setValidationMessage(null);
  };

  const handleToggleCompleted = (id: TodoId, isCompleted: boolean) => {
    update("todo", {
      id,
      isCompleted: Evolu.booleanToSqliteBoolean(!isCompleted),
    });
  };

  const handleDelete = (id: TodoId) => {
    update("todo", {
      id,
      isDeleted: Evolu.sqliteTrue,
    });
  };

  const startRename = (id: TodoId, title: string) => {
    setEditingId(id);
    setEditingTitle(title);
    setEditingInputKey((value) => value + 1);
    setValidationMessage(null);
  };

  const cancelRename = () => {
    setEditingId(null);
    setEditingTitle("");
    setValidationMessage(null);
  };

  const saveRename = (id: TodoId) => {
    const parsed = parseTodoTitle(editingTitle);
    if (!parsed.ok) {
      setValidationMessage(formatTypeError(parsed.error));
      return;
    }

    update("todo", { id, title: parsed.value });
    cancelRename();
  };

  return (
    <view className="Card">
      <view className="Row">
        <input
          key={newTodoInputKey}
          className="Input"
          placeholder="Add a new todo"
          bindinput={(event: { detail: { value: string } }) => {
            setNewTodoTitle(event.detail.value);
          }}
          bindconfirm={handleAddTodo}
        />
        <Button label="Add" variant="primary" onTap={handleAddTodo} />
      </view>

      {validationMessage && <text className="Hint">{validationMessage}</text>}

      <view style={{ marginTop: 10 }}>
        <text className="OwnerText">{todoCountLabel}</text>
      </view>

      <view style={{ marginTop: 12 }}>
        {todos.length === 0 ? (
          <text className="Empty">No todos yet. Add your first item.</text>
        ) : (
          <view className="TodoList">
            {todos.map((todo) => {
              const isCompleted = todo.isCompleted === Evolu.sqliteTrue;
              const isEditing = editingId === todo.id;

              return (
                <view className="TodoItem" key={todo.id}>
                  {isEditing ? (
                    <view className="Row">
                      <input
                        key={`${todo.id}-${editingInputKey}`}
                        className="InputCompact"
                        placeholder={todo.title}
                        bindinput={(event: { detail: { value: string } }) => {
                          setEditingTitle(event.detail.value);
                        }}
                        bindconfirm={() => {
                          saveRename(todo.id);
                        }}
                      />
                      <Button
                        label="Save"
                        variant="primary"
                        onTap={() => {
                          saveRename(todo.id);
                        }}
                      />
                      <Button label="Cancel" onTap={cancelRename} />
                    </view>
                  ) : (
                    <view className="TodoTop">
                      <view
                        style={{ flex: 1 }}
                        bindtap={() => {
                          handleToggleCompleted(todo.id, isCompleted);
                        }}
                      >
                        <text
                          className={`TodoTitle${isCompleted ? " TodoTitleCompleted" : ""}`}
                        >
                          {todo.title}
                        </text>
                      </view>

                      <view className="Actions">
                        <Button
                          label="Edit"
                          onTap={() => {
                            startRename(todo.id, todo.title);
                          }}
                        />
                        <Button
                          label="Delete"
                          variant="danger"
                          onTap={() => {
                            handleDelete(todo.id);
                          }}
                        />
                      </view>
                    </view>
                  )}
                </view>
              );
            })}
          </view>
        )}
      </view>
    </view>
  );
};

const OwnerInfo: FC = () => {
  const evolu = useEvolu();
  const [showMnemonic, setShowMnemonic] = useState(false);

  return (
    <view className="Card">
      <text className="Title" style={{ fontSize: 20 }}>
        Owner
      </text>
      <text className="OwnerText" style={{ marginTop: 8 }}>
        This example uses a fixed test owner to keep persistence deterministic.
      </text>

      <view style={{ marginTop: 12 }}>
        <Button
          label={showMnemonic ? "Hide Mnemonic" : "Show Mnemonic"}
          onTap={() => {
            setShowMnemonic((value) => !value);
          }}
        />
      </view>

      {showMnemonic && <text className="Mnemonic">{evolu.appOwner.mnemonic}</text>}
    </view>
  );
};

const Button: FC<{
  label: string;
  onTap: () => void;
  variant?: "primary" | "danger" | "default";
}> = ({ label, onTap, variant = "default" }) => {
  const className =
    variant === "primary"
      ? "Button ButtonPrimary"
      : variant === "danger"
        ? "Button ButtonDanger"
        : "Button";

  const textClassName =
    variant === "primary"
      ? "ButtonText ButtonTextPrimary"
      : variant === "danger"
        ? "ButtonText ButtonTextDanger"
        : "ButtonText";

  return (
    <view className={className} bindtap={onTap}>
      <text className={textClassName}>{label}</text>
    </view>
  );
};
