import { describe, expect, it } from "vitest";
import { actorName, describeActivity } from "@/lib/activity";
import type { ActivityEvent } from "@/types/api";
import { makeActivity } from "../helpers/fixtures";

const text = (event: ActivityEvent) => describeActivity(makeActivity("a1", event));

describe("describeActivity", () => {
  it("describes tasks being created, moved and deleted", () => {
    expect(text({ action: "TASK_CREATED", entityType: "TASK", metadata: { taskTitle: "Auth", columnTitle: "Todo" } })).toBe("created task “Auth” in Todo");
    expect(text({ action: "TASK_MOVED", entityType: "TASK", metadata: { taskTitle: "Dashboard UI", fromColumn: { id: "c1", title: "Todo" }, toColumn: { id: "c2", title: "In Progress" } } })).toBe(
      "moved “Dashboard UI” from Todo to In Progress"
    );
    expect(text({ action: "TASK_DELETED", entityType: "TASK", metadata: { taskTitle: "Auth", columnTitle: "Done" } })).toBe("deleted task “Auth” from Done");
  });

  it("lists exactly what changed in an update", () => {
    expect(
      text({
        action: "TASK_UPDATED",
        entityType: "TASK",
        metadata: {
          taskTitle: "New name",
          changes: { title: { from: "Old name", to: "New name" }, priority: { from: "MEDIUM", to: "URGENT" }, dueDate: { from: null, to: "2026-12-01" }, description: true },
        },
      })
    ).toBe("updated “New name” (renamed from “Old name”, priority Medium → Urgent, due date → Dec 1, 2026, description)");
    expect(text({ action: "TASK_UPDATED", entityType: "TASK", metadata: { taskTitle: "T", changes: { dueDate: { from: "2026-12-01", to: null } } } })).toBe("updated “T” (due date removed)");
  });

  it("describes assigning, reassigning and unassigning", () => {
    const base = { action: "TASK_ASSIGNED", entityType: "TASK" } as const;
    expect(text({ ...base, metadata: { taskTitle: "DB", from: null, to: { id: "u3", name: "Rahul" } } })).toBe("assigned “DB” to Rahul");
    expect(text({ ...base, metadata: { taskTitle: "DB", from: { id: "u3", name: "Rahul" }, to: { id: "u4", name: "Priya" } } })).toBe("reassigned “DB” from Rahul to Priya");
    expect(text({ ...base, metadata: { taskTitle: "DB", from: { id: "u3", name: "Rahul" }, to: null } })).toBe("unassigned “DB” (was Rahul)");
  });

  it("describes column and comment events", () => {
    expect(text({ action: "COLUMN_CREATED", entityType: "COLUMN", metadata: { columnTitle: "Review" } })).toBe("added column “Review”");
    expect(text({ action: "COLUMN_RENAMED", entityType: "COLUMN", metadata: { from: "Doing", to: "In Progress" } })).toBe("renamed column “Doing” to “In Progress”");
    expect(text({ action: "COLUMN_DELETED", entityType: "COLUMN", metadata: { columnTitle: "Old", taskCount: 0 } })).toBe("deleted column “Old”");
    expect(text({ action: "COLUMN_DELETED", entityType: "COLUMN", metadata: { columnTitle: "Old", taskCount: 1 } })).toBe("deleted column “Old” and its 1 task");
    expect(text({ action: "COLUMN_DELETED", entityType: "COLUMN", metadata: { columnTitle: "Old", taskCount: 3 } })).toBe("deleted column “Old” and its 3 tasks");
    expect(text({ action: "COMMENT_ADDED", entityType: "COMMENT", metadata: { taskId: "t1", taskTitle: "Auth" } })).toBe("commented on “Auth”");
  });

  it("never throws on an entry it doesn't fully understand", () => {
    const unknown = { ...makeActivity("a1", { action: "COMMENT_ADDED", entityType: "COMMENT", metadata: { taskId: "t", taskTitle: "x" } }), action: "SOMETHING_NEW" } as never;
    expect(describeActivity(unknown)).toBe("did something");
    const missing = { ...makeActivity("a2", { action: "COMMENT_ADDED", entityType: "COMMENT", metadata: { taskId: "t", taskTitle: "x" } }), metadata: {} } as never;
    expect(describeActivity(missing)).toBe("commented on “a task”");
  });
});

describe("actorName", () => {
  const entry = makeActivity("a1", { action: "COLUMN_CREATED", entityType: "COLUMN", metadata: { columnTitle: "X" } });
  it("says You for the signed-in user and the name for everyone else", () => {
    expect(actorName(entry, "u2")).toBe("You");
    expect(actorName(entry, "u9")).toBe("Mia Member");
    expect(actorName(entry, undefined)).toBe("Mia Member");
  });
});
