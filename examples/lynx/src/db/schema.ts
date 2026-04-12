import * as Evolu from "@evolu/common";

const TodoId = Evolu.id("Todo");
export type TodoId = typeof TodoId.Type;

export const AppSchema = {
  todo: {
    id: TodoId,
    title: Evolu.NonEmptyTrimmedString100,
    isCompleted: Evolu.nullOr(Evolu.SqliteBoolean),
  },
};

const createQuery = Evolu.createQueryBuilder(AppSchema);

export const todosQuery = createQuery((db) =>
  db
    .selectFrom("todo")
    .select(["id", "title", "isCompleted"])
    .where("isDeleted", "is not", Evolu.sqliteTrue)
    .where("title", "is not", null)
    .$narrowType<{ title: Evolu.KyselyNotNull }>()
    .orderBy("createdAt"),
);
