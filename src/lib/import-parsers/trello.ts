export interface TrelloBoard {
  lists: TrelloList[];
  cards: TrelloCard[];
  checklists: TrelloChecklist[];
}

interface TrelloList {
  id: string;
  name: string;
  closed: boolean;
}

interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  due: string | null;
  closed: boolean;
  idList: string;
  labels: { name: string; color: string }[];
  idChecklists?: string[];
}

interface TrelloChecklist {
  id: string;
  idCard: string;
  name: string;
  checkItems: { name: string; state: string }[];
}

export interface TrelloProject {
  listId: string;
  name: string;
}

export interface TrelloTask {
  title: string;
  description: string;
  deadline: Date | null;
  status: "done" | "backlog";
  projectListId: string;
  labels: string[];
}

export interface TrelloSubtask {
  title: string;
  parentCardId: string;
  status: "done" | "backlog";
}

export interface TrelloParsed {
  projects: TrelloProject[];
  tasks: { cardId: string; task: TrelloTask }[];
  subtasks: { parentCardId: string; subtask: TrelloSubtask }[];
}

export function parseTrelloJSON(jsonContent: string): TrelloParsed {
  const board: TrelloBoard = JSON.parse(jsonContent);

  // Build list lookup (non-archived lists only)
  const lists = (board.lists || []).filter((l) => !l.closed);
  const listMap = new Map<string, string>();
  for (const list of lists) {
    listMap.set(list.id, list.name);
  }

  // Projects: one per active list
  const projects: TrelloProject[] = lists.map((l) => ({
    listId: l.id,
    name: l.name,
  }));

  // Cards → tasks
  const tasks: { cardId: string; task: TrelloTask }[] = [];
  for (const card of board.cards || []) {
    // Only include cards from active lists
    if (!listMap.has(card.idList)) continue;

    const labels = (card.labels || [])
      .map((l) => l.name)
      .filter((n) => n.length > 0);

    let description = card.desc || "";
    if (labels.length > 0) {
      description += `\n\n[Labels: ${labels.join(", ")}]`;
    }

    tasks.push({
      cardId: card.id,
      task: {
        title: card.name,
        description: description.trim(),
        deadline: card.due ? new Date(card.due) : null,
        status: card.closed ? "done" : "backlog",
        projectListId: card.idList,
        labels,
      },
    });
  }

  // Checklists → subtasks
  const subtasks: { parentCardId: string; subtask: TrelloSubtask }[] = [];
  for (const checklist of board.checklists || []) {
    for (const item of checklist.checkItems || []) {
      subtasks.push({
        parentCardId: checklist.idCard,
        subtask: {
          title: item.name,
          parentCardId: checklist.idCard,
          status: item.state === "complete" ? "done" : "backlog",
        },
      });
    }
  }

  return { projects, tasks, subtasks };
}
